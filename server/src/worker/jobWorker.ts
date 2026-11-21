import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { copyFile, rename } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import type { Asset, Vector3 } from '@faresight/shared';
import type { Config } from '../config.ts';
import type { JobRecord, Store, Upload } from '../db/database.ts';
import { findDemoAsset } from '../services/demoAssets.ts';
import { exportMarblePly, marbleModel, pollMarble, submitMarble } from '../services/marbleClient.ts';
import { downloadFile, ProviderHttpError } from '../services/providerHttp.ts';
import { convertSplat, measureScale } from '../services/splatProcessor.ts';
import { pollTrellis, submitTrellis } from '../services/trellisClient.ts';

const tickMs = 1500;
const failedSubmission = 'Provider submission may have been accepted. Verify it with the provider before creating a replacement job.';
const progress = { queued: 0, generating: 15, downloading: 65, converting: 85, needs_review: 100 };
const outputUrl = (path: string) => `/storage/outputs/${basename(path)}`;

function demoFilename(job: JobRecord): string {
  if (job.kind === 'room') {
    if (job.place_id === 'allston-karaoke-01') return 'room-karaoke-suite.ply';
    if (job.place_id === 'harvard-cafe-01') return 'room-study-cafe.ply';
    return 'room-ramen-house.ply';
  }
  const dish = `${job.dish_id ?? ''} ${job.dish_name ?? ''}`.toLowerCase();
  if (/katsu|curry/.test(dish)) return 'dish-katsu-curry.ply';
  if (/matcha|tiramisu/.test(dish)) return 'dish-matcha-tiramisu.ply';
  return 'dish-tonkotsu-ramen.ply';
}

function description(job: JobRecord, live: string): string {
  return job.provider === 'demo-sim' ? `Demo simulation · ${live}` : live;
}

async function copyAtomically(source: string, destination: string): Promise<string> {
  await copyFile(source, `${destination}.part`);
  await rename(`${destination}.part`, destination);
  return destination;
}

async function advance(store: Store, config: Config, initialJob: JobRecord) {
  let job = initialJob;
  const set = (changes: Partial<JobRecord>) => { job = store.updateJob(job, changes); };
  const inputs = (): Upload[] => {
    const uploads = store.uploadsForPlace(job.place_id, job.input_upload_ids);
    if (!uploads?.length) throw new Error('Job uploads are missing');
    return uploads;
  };
  const next = (status: keyof typeof progress, message: string, fields: Partial<JobRecord> = {}) => {
    set({ ...fields, status, progress: progress[status], status_message: description(job, message), error: null });
  };

  try {
    if (job.status === 'queued') {
      next('generating', 'Generating spatial preview', job.provider === 'demo-sim' ? { provider_task_id: `demo-${job.id}` } : {});
      return;
    }

    if (job.status === 'generating') {
      if (!job.provider_task_id) {
        if (job.submission_pending) throw new Error(failedSubmission);
        const beforeSubmit = () => set({ submission_pending: true });
        const provider_task_id = job.provider === 'marble-1.1'
          ? await submitMarble(config, inputs(), job.model_tier ?? 'marble-1.1', beforeSubmit)
          : await submitTrellis(config, inputs()[0], beforeSubmit);
        set({ provider_task_id, submission_pending: false, progress: 25 });
        return;
      }

      if (job.provider === 'demo-sim') {
        next('downloading', 'Copying the prebuilt demo splat', { preview_download_pending: job.kind === 'dish' });
        return;
      }
      if (job.provider === 'marble-1.1') {
        const world_id = await pollMarble(config, job.provider_task_id);
        if (!world_id) {
          set({ progress: 45, status_message: 'Waiting for Marble reconstruction' });
          return;
        }
        next('downloading', 'Exporting the 100k Gaussian PLY', { world_id });
      } else {
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
        await copyAtomically(source, original);
        set({ original_ply_path: original });
        if (job.kind === 'dish') await useReferencePreview();
      } else if (job.provider === 'marble-1.1') {
        if (!job.world_id) {
          if (!job.provider_task_id) throw new Error('Marble operation ID is missing');
          const worldId = await pollMarble(config, job.provider_task_id);
          if (!worldId) return;
          set({ world_id: worldId });
        }
        const original_ply_path = existsSync(original)
          ? original
          : await downloadFile(await exportMarblePly(config, job.world_id!), () => original);
        set({ original_ply_path });
      } else {
        if (!job.provider_task_id) throw new Error('Replicate prediction ID is missing');
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
      if (!job.original_ply_path) throw new Error('Original PLY checkpoint is missing');
      const converted = await convertSplat(config, job.id, job.kind, job.original_ply_path);
      const scale = measureScale(job.plate_diameter_m, converted.metadata.measured_width);
      const spawn_point: Vector3 | null = job.kind === 'room' ? [0, 1.55, 2] : null;
      const asset: Asset = {
        id: job.id, kind: job.kind, backend: job.provider === 'marble-1.1' ? marbleModel(job.model_tier) : job.provider,
        provenance: job.provider === 'demo-sim' ? 'demo_splat' : job.kind === 'room' ? 'ai_spatial_preview' : 'trellis_dish_splat',
        provenance_label: job.provider === 'demo-sim' ? 'Demo simulation using a prebuilt splat'
          : job.kind === 'room' ? 'AI spatial preview from restaurant photos' : 'TRELLIS Gaussian splat from a dish photo',
        ...scale, gaussian_count: converted.count, format: converted.format, url: outputUrl(converted.path),
        original_ply_url: outputUrl(job.original_ply_path),
        preview_url: job.preview_image_path ? outputUrl(job.preview_image_path) : null,
        thumbnail_url: job.preview_image_path ? outputUrl(job.preview_image_path) : null,
        spawn_point, transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: scale.scale_factor },
        source_photos: inputs().map((upload) => upload.url), captured_on: new Date().toISOString().slice(0, 10),
        status: 'needs_review', metadata: converted.metadata,
      };
      store.transaction(() => {
        store.put('assets', asset);
        next('needs_review', 'Ready to review', { asset_id: asset.id, converted_asset_path: converted.path });
      });
    }
  } catch (error) {
    const definiteRejection = error instanceof ProviderHttpError && error.status >= 400 && error.status < 500
      && ![408, 409].includes(error.status);
    const submission_pending = job.submission_pending && !definiteRejection;
    set({
      status: 'failed', submission_pending, status_message: description(job, `Failed during ${job.status}`),
      error: submission_pending ? failedSubmission : error instanceof Error ? error.message : 'Job failed',
    });
  }

  async function useReferencePreview() {
    if (job.preview_image_path && existsSync(job.preview_image_path)) return;
    const upload = inputs()[0];
    const file = resolve(config.outputs, `${job.id}-preview${extname(upload.file)}`);
    const preview_image_path = await copyAtomically(resolve(config.uploads, upload.file), file);
    set({ preview_image_path, preview_download_pending: false });
  }

  function savedPreview() {
    return ['png', 'jpg', 'webp'].map((ext) => resolve(config.outputs, `${job.id}-preview.${ext}`)).find(existsSync);
  }

  async function saveTrellis(result: { ply: string; preview?: string }) {
    const original = resolve(config.outputs, `${job.id}-original.ply`);
    const transfers: Promise<void>[] = [];
    if (!job.original_ply_path || !existsSync(job.original_ply_path)) {
      transfers.push((existsSync(original) ? Promise.resolve(original) : downloadFile(result.ply, () => original))
        .then((original_ply_path) => set({ original_ply_path })));
    }
    if (!job.preview_image_path || !existsSync(job.preview_image_path)) {
      const saved = savedPreview();
      if (saved) set({ preview_image_path: saved, preview_download_pending: false });
      else if (result.preview) {
        transfers.push(downloadFile(result.preview, (mime) => {
          const extension = mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : 'png';
          return resolve(config.outputs, `${job.id}-preview.${extension}`);
        }).then((preview_image_path) => set({ preview_image_path, preview_download_pending: false })));
      } else if (job.preview_download_pending) {
        transfers.push(Promise.reject(new Error('Replicate no longer exposes the foreground preview')));
      }
    }
    const outcomes = await Promise.allSettled(transfers);
    const failure = outcomes.find((outcome) => outcome.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    if (!job.preview_image_path) await useReferencePreview();
    next('converting', 'Validating and preparing the Gaussian splat');
  }
}

export function startJobWorker(store: Store, config: Config, onError: (error: unknown) => void = console.error) {
  mkdirSync(config.uploads, { recursive: true });
  mkdirSync(config.outputs, { recursive: true });
  const owner = randomUUID();
  let running: Promise<void> | undefined;
  const tick = () => {
    try {
      if (!store.claimWorker(owner) || running) return;
      const job = store.nextJob();
      if (job) {
        running = advance(store, config, job).catch(onError).finally(() => { running = undefined; });
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
