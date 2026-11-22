import { readFile } from 'node:fs/promises';
import type { GenerationJob } from '@faresight/shared';
import type pg from 'pg';
import { pipelineProvider } from '../config.ts';
import type { CaptureConfig, Config } from '../config.ts';
import { publicJob } from '../db/database.ts';
import type { JobRecord, Store } from '../db/database.ts';
import { createPool, migrate } from '../db/pg.ts';
import { splatKey } from './captureKeys.ts';
import { createObjectStorage } from './objectStorage.ts';
import type { ObjectStorage } from './objectStorage.ts';

export interface CaptureRow {
  id: string;
  place_id: string;
  mode: 'room' | 'object';
  status: 'created' | 'uploading' | 'uploaded' | 'processing' | 'ready' | 'failed';
  device_info: object;
  frame_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface CaptureJobRow {
  id: string;
  capture_id: string;
  status: 'queued' | 'claimed' | 'generating' | 'downloading' | 'converting' | 'needs_review' | 'ready' | 'failed';
  progress: number;
  status_message: string;
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  failure_code: string | null;
  failure_detail: string | null;
  params: { model_tier?: GenerationJob['model_tier'] };
  created_at: Date;
  updated_at: Date;
}

export interface SplatAssetRow {
  quality: 'preview' | 'full';
  format: 'ply' | 'sog' | 'spz';
  object_key: string;
  bytes: number | null;
  splat_count: number | null;
}

export type CaptureEventType = 'status' | 'asset' | 'failed';

export interface Captures {
  settings: CaptureConfig;
  pool: pg.Pool;
  storage: ObjectStorage;
  /** Tells every API process that a capture changed, so they can push it to the browsers watching it. */
  notify(captureId: string, type: CaptureEventType, db?: Pick<pg.Pool, 'query'>): Promise<void>;
  assetUrl(objectKey: string): string;
  close(): Promise<void>;
}

/** Connects capture storage and brings its schema up to date. Returns nothing when it is not configured. */
export async function openCaptures(config: Config): Promise<Captures | undefined> {
  const settings = config.captures;
  if (!settings) return undefined;
  // Migrations take a session-level advisory lock, so they go over the direct connection.
  const direct = createPool(settings.databaseUrlDirect);
  try {
    await migrate(direct);
  } finally {
    await direct.end();
  }
  const pool = createPool(settings.databaseUrl);
  const storage = createObjectStorage(settings);
  return {
    settings, pool, storage,
    async notify(captureId, type, db = pool) {
      await db.query('select pg_notify($1, $2)', ['capture_events', JSON.stringify({ capture_id: captureId, type })]);
    },
    assetUrl: (objectKey) => `${settings.cdnBaseUrl}/${objectKey}`,
    async close() {
      storage.close();
      await pool.end();
    },
  };
}

const captureStatus = (status: CaptureJobRow['status']): CaptureRow['status'] =>
  status === 'failed' ? 'failed' : status === 'needs_review' || status === 'ready' ? 'ready' : 'processing';

/** Records a capture job's progress in Postgres and announces it when something changed. */
export async function setCaptureJob(captures: Captures, jobId: string, changes: {
  status: CaptureJobRow['status']; progress: number; status_message: string;
  failure_code?: string | null; failure_detail?: string | null;
}) {
  const { rows } = await captures.pool.query<{ capture_id: string }>(`
    update jobs set status = $2, progress = $3, status_message = $4, failure_code = $5, failure_detail = $6, updated_at = now()
    where id = $1 and (status, progress, status_message) is distinct from ($2, $3, $4)
    returning capture_id
  `, [jobId, changes.status, changes.progress, changes.status_message, changes.failure_code ?? null, changes.failure_detail ?? null]);
  if (!rows.length) return;
  const captureId = rows[0].capture_id;
  await captures.pool.query('update captures set status = $2, updated_at = now() where id = $1 and status <> $2',
    [captureId, captureStatus(changes.status)]);
  await captures.notify(captureId, changes.status === 'failed' ? 'failed' : 'status');
}

/** Copies the generation pipeline's view of a job into Postgres. */
export function syncJob(captures: Captures, job: JobRecord) {
  const failed = job.status === 'failed';
  return setCaptureJob(captures, job.id, {
    // The pipeline's own `queued` means "photos fetched, waiting for a turn", which Postgres calls claimed.
    status: job.status === 'queued' ? 'claimed' : job.status,
    progress: job.progress, status_message: job.status_message,
    failure_code: failed ? 'internal' : null, failure_detail: failed ? job.error ?? job.status_message : null,
  });
}

/**
 * Mirrors every change to a capture's job into Postgres, in order. Returns a function that
 * stops mirroring and resolves once the pending writes have landed.
 */
export function mirrorJobs(store: Store, captures: Captures, onError: (error: unknown) => void) {
  let chain = Promise.resolve();
  store.onJobUpdate = (job) => {
    if (job.capture_id) chain = chain.then(() => syncJob(captures, job)).catch(onError);
  };
  return () => {
    store.onJobUpdate = undefined;
    return chain;
  };
}

/** Uploads a job's finished splat files to the splat bucket and records them. Returns each format's public URL. */
export async function publishSplats(captures: Captures, captureId: string, jobId: string,
  files: { path: string; format: SplatAssetRow['format']; count?: number }[], assertCurrent: () => void) {
  const urls: Partial<Record<SplatAssetRow['format'], string>> = {};
  for (const file of files) {
    const key = splatKey(captureId, jobId, 'full', file.format);
    const body = await readFile(file.path);
    assertCurrent();
    await captures.storage.put(captures.settings.splatBucket, key, body, 'application/octet-stream', { public: true });
    assertCurrent();
    // Keyed by job, so a retried job overwrites its own files and rows.
    await captures.pool.query(`
      insert into splat_assets (capture_id, job_id, quality, format, object_key, bytes, splat_count)
      values ($1, $2, 'full', $3, $4, $5, $6)
      on conflict (job_id, quality, format) do update
        set object_key = excluded.object_key, bytes = excluded.bytes, splat_count = excluded.splat_count
    `, [captureId, jobId, file.format, key, body.length, file.count ?? null]);
    urls[file.format] = captures.assetUrl(key);
  }
  assertCurrent();
  await captures.notify(captureId, 'asset');
  return urls;
}

/** What the API returns for a capture: its row, latest job, splat URLs, and the job in the shape the apps already use. */
export async function captureView(captures: Captures, store: Store, config: Config, id: string) {
  const { rows: [capture] } = await captures.pool.query<CaptureRow>('select * from captures where id = $1', [id]);
  if (!capture) return undefined;
  const { rows: [job] } = await captures.pool.query<CaptureJobRow>(
    'select * from jobs where capture_id = $1 order by created_at desc limit 1', [id]);
  const { rows: assets } = job ? await captures.pool.query<SplatAssetRow>(
    'select quality, format, object_key, bytes, splat_count from splat_assets where job_id = $1 order by created_at', [job.id]) : { rows: [] };
  return {
    capture: {
      id: capture.id, place_id: capture.place_id, mode: capture.mode, status: capture.status,
      frame_count: capture.frame_count, created_at: capture.created_at, updated_at: capture.updated_at,
    },
    job: job ? {
      id: job.id, status: job.status, progress: job.progress, status_message: job.status_message,
      attempts: job.attempts, failure_code: job.failure_code, failure_detail: job.failure_detail,
      created_at: job.created_at, updated_at: job.updated_at,
    } : null,
    assets: assets.map(({ object_key, bytes, ...asset }) => ({
      ...asset, bytes: bytes === null ? null : Number(bytes), url: captures.assetUrl(object_key),
    })),
    generation_job: job ? generationJob(store, config, capture, job) : null,
  };
}

export type CaptureView = NonNullable<Awaited<ReturnType<typeof captureView>>>;

function generationJob(store: Store, config: Config, capture: CaptureRow, job: CaptureJobRow): GenerationJob {
  const local = store.get('jobs', job.id);
  // Postgres alone knows about a job that failed outside the pipeline: unreadable photos, or a worker that went quiet.
  if (local && (job.status !== 'failed' || local.status === 'failed')) return publicJob(local);
  return {
    id: job.id, capture_id: capture.id, kind: 'room', place_id: capture.place_id,
    status: job.status === 'claimed' ? 'queued' : job.status, progress: job.progress,
    provider: local?.provider ?? pipelineProvider(config, 'room').provider,
    input_upload_ids: local?.input_upload_ids ?? [], model_tier: job.params.model_tier,
    status_message: job.status_message, error: job.failure_detail,
    // A room built on another machine is imported under its job's id (see captureSync).
    asset_id: local?.asset_id ?? (job.status === 'ready' && store.get('assets', job.id) ? job.id : undefined),
    created_at: job.created_at.toISOString(), updated_at: job.updated_at.toISOString(),
  };
}
