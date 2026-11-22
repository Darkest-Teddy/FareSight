import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync } from 'node:fs';
import { copyFile, rm } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { Asset, Vector3 } from '@faresight/shared';
import type { Config } from '../config.ts';
import { WorkerLeaseLost, type JobRecord, type Store, type Upload, type WorkerLease } from '../db/database.ts';
import { downloadAtlasSplat, pollAtlasPose, pollAtlasSplats, submitAtlasPose, submitAtlasSplats, uploadAtlasImage } from '../services/atlasClient.ts';
import { publishSplats } from '../services/captures.ts';
import type { Captures } from '../services/captures.ts';
import { findDemoAsset } from '../services/demoAssets.ts';
import { MAX_IMAGE_BYTES } from '../services/imagePrep.ts';
import { downloadFile, ProviderHttpError, TerminalProviderError, type CommitFile } from '../services/providerHttp.ts';
import { publishAsset } from '../services/publish.ts';
import { convertSplat, measureScale } from '../services/splatProcessor.ts';
import { pollTrellis, submitTrellis } from '../services/trellisClient.ts';

const tickMs = 1500;
const failedSubmission = 'Provider submission may have been accepted. Verify it with the provider before creating a replacement job.';
const progress = { queued: 0, generating: 15, downloading: 65, converting: 85, needs_review: 100 };
const outputUrl = (path: string) => `/storage/outputs/${basename(path)}`;

function demoFilename(job: JobRecord): string {
  return job.kind === 'room' ? 'room-study-cafe.ply' : 'dish-matcha-tiramisu.ply';
}

function description(job: JobRecord, live: string): string {
  return job.provider === 'demo-sim' ? `Demo simulation · ${live}` : live;
}

async function copyAtomically(source: string, destination: string, commit: CommitFile): Promise<string> {
  const temporary = `${destination}.${randomUUID()}.part`;
  try {
    await copyFile(source, temporary);
    await commit(temporary, destination);
    return destination;
  } finally {
    await rm(temporary, { force: true });
  }
}

async function advance(store: Store, config: Config, initialJob: JobRecord, lease: WorkerLease, captures?: Captures) {
  let job = initialJob;
  const assertCurrent = () => store.assertWorker(lease);
  const commit: CommitFile = (temporary, destination) => store.transaction(() => {
    assertCurrent();
    renameSync(temporary, destination);
  });
  const set = (changes: Partial<JobRecord>) => { job = store.updateJob(job, changes, lease); };
  const inputs = (): Upload[] => {
    const uploads = store.uploadsForPlace(job.place_id, job.input_upload_ids);
    if (!uploads?.length) throw new TerminalProviderError('Job uploads are missing');
    return uploads;
  };
  const next = (status: keyof typeof progress, message: string, fields: Partial<JobRecord> = {}) => {
    set({ ...fields, status, progress: progress[status], status_message: description(job, message), error: null });
  };

  try {
    if (!store.get('places', job.place_id)) throw new TerminalProviderError('The job venue is no longer in the catalog');
    if (String(job.provider) === 'marble-1.1') throw new Error('This Marble job used a retired API. Create a new Atlas room job.');
    if (job.status === 'queued') {
      next('generating', 'Generating spatial preview', job.provider === 'demo-sim' ? { provider_task_id: `demo-${job.id}` } : {});
      return;
    }

    if (job.status === 'generating') {
      if (job.provider === 'demo-sim') {
        next('downloading', 'Copying the prebuilt demo splat', { preview_download_pending: job.kind === 'dish' });
        return;
      }
      if (job.provider === 'atlas-v2') {
        if (!job.pose_operation_id) {
          const assetIds = [...(job.atlas_input_asset_ids ?? [])];
          for (const upload of inputs().slice(assetIds.length)) {
            assetIds.push(await uploadAtlasImage(config, upload, assertCurrent));
            set({ atlas_input_asset_ids: [...assetIds] });
          }
          assertCurrent();
          const pose_operation_id = await submitAtlasPose(config, job.id, assetIds);
          set({ pose_operation_id, progress: 25, status_message: 'Atlas is estimating camera poses and depth' });
          return;
        }
        if (!job.posed_frames) {
          const posed_frames = await pollAtlasPose(config, job.pose_operation_id);
          set(posed_frames ? { posed_frames, progress: 40, status_message: 'Atlas camera poses and depth are ready' } : {});
          return;
        }
        const refine = job.model_tier === 'atlas-refined';
        if (!job.provider_task_id) {
          assertCurrent();
          const provider_task_id = await submitAtlasSplats(config, job.id, job.posed_frames, refine);
          set({ provider_task_id, progress: 50, status_message: `Atlas is generating the ${refine ? 'refined' : 'draft'} splat` });
          return;
        }
        const atlas_splat = await pollAtlasSplats(config, job.provider_task_id, refine);
        if (!atlas_splat) {
          set({}); // Let other jobs advance while Atlas is still running.
          return;
        }
        next('downloading', 'Saving the Atlas SPZ', { atlas_splat });
      } else {
        if (!job.provider_task_id) {
          if (job.submission_pending) throw new Error(failedSubmission);
          const provider_task_id = await submitTrellis(config, inputs()[0], assertCurrent, () => set({ submission_pending: true }));
          set({ provider_task_id, submission_pending: false, progress: 25 });
          return;
        }
        const result = await pollTrellis(config, job.provider_task_id);
        if (!result) {
          set({ progress: 45, status_message: 'Waiting for TRELLIS prediction' });
          return;
        }
        next('downloading', 'Saving TRELLIS outputs', { preview_download_pending: Boolean(result.preview) });
        await saveTrellis(result);
        return;
      }
    }

    if (job.status === 'downloading') {
      const original = resolve(config.outputs, `${job.id}-original.ply`);
      if (job.provider === 'demo-sim') {
        const file = demoFilename(job);
        const source = findDemoAsset(config, file);
        if (!source) throw new Error(`Demo asset ${file} has not been generated yet`);
        await copyAtomically(source, original, commit);
        set({ original_ply_path: original });
        if (job.kind === 'dish') await useReferencePreview();
      } else if (job.provider === 'atlas-v2') {
        const spz = resolve(config.outputs, `${job.id}-original.spz`);
        if (!existsSync(spz)) {
          if (!job.provider_task_id) throw new TerminalProviderError('Atlas splat operation ID is missing');
          const atlas_splat = job.atlas_splat ?? await pollAtlasSplats(config, job.provider_task_id, job.model_tier === 'atlas-refined');
          if (!atlas_splat) return;
          if (!job.atlas_splat) set({ atlas_splat });
          await downloadAtlasSplat(config, atlas_splat, spz, commit);
        }
        set({ original_spz_path: spz });
      } else {
        if (!job.provider_task_id) throw new TerminalProviderError('Replicate prediction ID is missing');
        const preview = savedPreview();
        if (existsSync(original) && (!job.preview_download_pending || preview)) {
          set({ original_ply_path: original, preview_image_path: preview ?? null, preview_download_pending: false });
          if (!preview) await useReferencePreview();
          next('converting', 'Validating and preparing the Gaussian splat');
          return;
        }
        const result = await pollTrellis(config, job.provider_task_id);
        if (!result) return;
        await saveTrellis(result);
        return;
      }
      next('converting', 'Validating and preparing the Gaussian splat');
      return;
    }

    if (job.status === 'converting') {
      const original = job.original_spz_path ?? job.original_ply_path;
      if (!original) throw new TerminalProviderError('Original splat checkpoint is missing');
      const converted = await convertSplat(config, job.id, job.kind, original, commit);
      const scale = measureScale(job.plate_diameter_m, converted.metadata.measured_width);
      const spawn_point: Vector3 | null = job.kind === 'room' ? [0, 1.55, 2] : null;
      // A capture's splat is served from the splat bucket. Other jobs keep serving it from this server's disk.
      assertCurrent();
      const hosted = captures && job.capture_id ? await publishSplats(captures, job.capture_id, job.id, [
        { path: converted.path, format: converted.format, count: converted.count },
        ...(job.original_spz_path && converted.format !== 'spz' ? [{ path: job.original_spz_path, format: 'spz' as const }] : []),
      ], assertCurrent) : undefined;
      const asset: Asset = {
        id: job.id, kind: job.kind, backend: job.provider === 'atlas-v2' ? job.model_tier ?? 'atlas-draft' : job.provider,
        provenance: job.provider === 'demo-sim' ? 'demo_splat' : job.kind === 'room' ? 'ai_spatial_preview' : 'trellis_dish_splat',
        provenance_label: job.provider === 'demo-sim' ? 'Demo simulation using a prebuilt splat'
          : job.kind === 'room' ? 'AI spatial preview from restaurant photos' : 'TRELLIS Gaussian splat from a dish photo',
        ...scale, gaussian_count: converted.count, format: converted.format,
        url: hosted?.[converted.format] ?? outputUrl(converted.path),
        ...(job.original_ply_path ? { original_ply_url: outputUrl(job.original_ply_path) } : {}),
        ...(job.original_spz_path ? { original_spz_url: (converted.format !== 'spz' || converted.path === job.original_spz_path ? hosted?.spz : undefined)
          ?? outputUrl(job.original_spz_path) } : {}),
        preview_url: job.preview_image_path ? outputUrl(job.preview_image_path) : null,
        thumbnail_url: job.preview_image_path ? outputUrl(job.preview_image_path) : null,
        spawn_point, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: scale.scale_factor },
        source_photos: inputs().map((upload) => upload.url), captured_on: new Date().toISOString().slice(0, 10),
        status: 'needs_review', metadata: converted.metadata,
      };
      store.transaction(() => {
        const reviewed = store.updateJob(job, {
          status: 'needs_review', progress: progress.needs_review, status_message: description(job, 'Ready to review'),
          error: null, asset_id: asset.id, converted_asset_path: converted.path,
        }, lease);
        if (config.autoPublish) publishAsset(store, asset, reviewed, {}, lease);
        else store.put('assets', asset);
      });
    }
  } catch (error) {
    if (error instanceof WorkerLeaseLost) return;
    const definiteRejection = error instanceof ProviderHttpError && error.status >= 400 && error.status < 500
      && ![408, 409, 425, 429].includes(error.status);
    const submission_pending = job.submission_pending && !definiteRejection
      && !(error instanceof ProviderHttpError && error.status === 429);
    const terminal_failure = error instanceof TerminalProviderError || (definiteRejection && Boolean(job.provider_task_id || job.pose_operation_id));
    try {
      set({
        status: 'failed', submission_pending, terminal_failure, status_message: description(job, `Failed during ${job.status}`),
        error: submission_pending ? failedSubmission : error instanceof Error ? error.message : 'Job failed',
      });
    } catch (failure) {
      if (!(failure instanceof WorkerLeaseLost)) throw failure;
    }
  }

  async function useReferencePreview() {
    if (job.preview_image_path && existsSync(job.preview_image_path)) return;
    const upload = inputs()[0];
    const file = resolve(config.outputs, `${job.id}-preview${extname(upload.file)}`);
    const preview_image_path = await copyAtomically(resolve(config.uploads, upload.file), file, commit);
    set({ preview_image_path, preview_download_pending: false });
  }

  function savedPreview() {
    return ['png', 'jpg', 'webp'].map((ext) => resolve(config.outputs, `${job.id}-preview.${ext}`)).find(existsSync);
  }

  async function saveTrellis(result: { ply: string; preview?: string }) {
    const original = resolve(config.outputs, `${job.id}-original.ply`);
    const transfers: Promise<void>[] = [];
    if (!job.original_ply_path || !existsSync(job.original_ply_path)) {
      transfers.push((existsSync(original) ? Promise.resolve(original) : downloadFile(result.ply, () => original, 'trellis', commit))
        .then((original_ply_path) => set({ original_ply_path })));
    }
    if (!job.preview_image_path || !existsSync(job.preview_image_path)) {
      const saved = savedPreview();
      if (saved) set({ preview_image_path: saved, preview_download_pending: false });
      else if (result.preview) {
        transfers.push(downloadFile(result.preview, (mime) => {
          const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
          return resolve(config.outputs, `${job.id}-preview.${extension}`);
        }, 'trellis', commit, MAX_IMAGE_BYTES).then((preview_image_path) => set({ preview_image_path, preview_download_pending: false })));
      } else if (job.preview_download_pending) {
        transfers.push(Promise.reject(new TerminalProviderError('Replicate no longer exposes the foreground preview')));
      }
    }
    const outcomes = await Promise.allSettled(transfers);
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    if (!job.preview_image_path) await useReferencePreview();
    next('converting', 'Validating and preparing the Gaussian splat');
  }
}

export function startJobWorker(store: Store, config: Config, onError: (error: unknown) => void = console.error, captures?: Captures) {
  mkdirSync(config.uploads, { recursive: true });
  mkdirSync(config.outputs, { recursive: true });
  const owner = randomUUID();
  let running: Promise<void> | undefined;
  const tick = () => {
    try {
      const lease = store.claimWorker(owner);
      if (!lease || running) return;
      const job = store.nextJob();
      if (job) {
        running = advance(store, config, job, lease, captures).catch(onError).finally(() => { running = undefined; });
      }
    } catch (error) {
      onError(error);
    }
  };
  const timer = setInterval(tick, tickMs);
  tick();
  return async () => {
    clearInterval(timer);
    const heartbeat = setInterval(() => {
      try {
        store.claimWorker(owner);
      } catch (error) {
        onError(error);
      }
    }, tickMs);
    try {
      await running;
    } finally {
      clearInterval(heartbeat);
      store.releaseWorker(owner);
    }
  };
}
