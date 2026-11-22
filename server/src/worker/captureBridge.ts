import { ROOM_PHOTO_REQUIREMENT } from '@faresight/shared';
import { pipelineProvider } from '../config.ts';
import type { Config } from '../config.ts';
import type { JobRecord, Store } from '../db/database.ts';
import { listen } from '../db/pg.ts';
import { setCaptureJob, syncJob } from '../services/captures.ts';
import type { CaptureJobRow, CaptureRow, Captures } from '../services/captures.ts';
import { prepareImage } from '../services/imagePrep.ts';

const POLL_MS = 15_000;
const HEARTBEAT_MS = 30_000;
const REAP_MS = 60_000;
const STALE = '2 minutes';
const active = "('claimed', 'generating', 'downloading', 'converting')";

/** The photos themselves are the problem, so trying again cannot help. */
class Rejected extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Feeds captures into the generation pipeline. Postgres is the queue: this claims a queued job,
 * copies its photos from the raw bucket to the pipeline's working folder, and hands the pipeline
 * a job with the same id. From there the job worker builds the splat as it does for any upload.
 */
export function startCaptureBridge(store: Store, config: Config, captures: Captures, onError: (error: unknown) => void = console.error) {
  const { pool, storage, settings } = captures;
  let draining: Promise<void> | undefined;
  let stopped = false;
  let reconcileDue = false;

  async function claim() {
    const { rows } = await pool.query<CaptureJobRow>(`
      update jobs
      set status = 'claimed', worker_id = $1, claimed_at = now(), heartbeat_at = now(),
          attempts = attempts + 1, updated_at = now()
      where id = (
        select id from jobs where status = 'queued' order by created_at for update skip locked limit 1
      )
      returning *
    `, [settings.workerId]);
    return rows[0];
  }

  async function handOver(job: CaptureJobRow) {
    // After a restart or a requeue the pipeline may already hold this job. It resumes on its own.
    const existing = store.get('jobs', job.id);
    if (existing) return syncJob(captures, existing);

    const { rows: [capture] } = await pool.query<CaptureRow>('select * from captures where id = $1', [job.capture_id]);
    await setCaptureJob(captures, job.id, { status: 'claimed', progress: 5, status_message: 'Fetching the photos from storage' });
    const { rows: frames } = await pool.query<{ seq: number; object_key: string }>(
      'select seq, object_key from frames where capture_id = $1 order by seq', [job.capture_id]);
    const uploadIds = new Set<string>();
    for (const frame of frames) {
      const bytes = await storage.get(settings.rawBucket, frame.object_key);
      let upload;
      try {
        upload = prepareImage(store, config, {
          filename: `capture-${capture.id.slice(0, 8)}-${String(frame.seq).padStart(3, '0')}.jpg`,
          mimeType: 'image/jpeg', bytes, place_id: capture.place_id,
        });
      } catch (error) {
        if (error instanceof TypeError) throw new Rejected('invalid_frames', `Photo ${frame.seq + 1}: ${error.message}`);
        throw error;
      }
      uploadIds.add(upload.id);
      await pool.query('update frames set width = $3, height = $4 where capture_id = $1 and seq = $2',
        [capture.id, frame.seq, upload.width, upload.height]);
    }
    // Identical photos are stored once, so duplicates collapse here.
    if (uploadIds.size < 2) throw new Rejected('insufficient_frames', ROOM_PHOTO_REQUIREMENT);

    const { provider } = pipelineProvider(config, 'room');
    const now = new Date().toISOString();
    const record: JobRecord = {
      id: job.id, capture_id: capture.id, kind: 'room', place_id: capture.place_id, dish_id: null, dish_name: null,
      input_upload_ids: [...uploadIds], status: 'queued', progress: 0, provider, provider_task_id: null,
      plate_diameter_m: null, model_tier: job.params.model_tier ?? 'atlas-draft',
      status_message: provider === 'demo-sim' ? 'Demo simulation · Queued' : 'Queued',
      created_at: job.created_at.toISOString(), updated_at: now,
    };
    store.put('jobs', record);
  }

  async function giveUp(job: CaptureJobRow, error: unknown) {
    const detail = error instanceof Error ? error.message : 'Could not prepare the capture';
    if (!(error instanceof Rejected) && job.attempts < job.max_attempts) {
      onError(error);
      await pool.query("update jobs set status = 'queued', status_message = 'Queued for another try', updated_at = now() where id = $1", [job.id]);
      return;
    }
    await setCaptureJob(captures, job.id, {
      status: 'failed', progress: job.progress, status_message: 'Failed while fetching the photos',
      failure_code: error instanceof Rejected ? error.code : 'internal', failure_detail: detail,
    });
  }

  function drain() {
    if (draining || stopped) return;
    draining = (async () => {
      // Runs inside the drain, so it never looks at a job that is being handed over at that moment.
      if (reconcileDue) {
        reconcileDue = false;
        await reconcile();
      }
      for (let job = await claim(); job && !stopped; job = await claim()) {
        await handOver(job).catch((error) => giveUp(job, error));
      }
    })().catch(onError).finally(() => { draining = undefined; });
  }

  async function heartbeat() {
    await pool.query(`update jobs set heartbeat_at = now() where worker_id = $1 and status in ${active}`, [settings.workerId]);
    reconcileDue = true;
    drain();
  }

  /**
   * Brings Postgres back in line with the pipeline for the jobs this worker holds. The heartbeat keeps
   * those jobs away from the reaper, so anything that went wrong on this side has to be repaired here.
   */
  async function reconcile() {
    const { rows } = await pool.query<CaptureJobRow>(`
      select * from jobs where worker_id = $1
        and (status in ${active} or (status = 'needs_review' and updated_at > now() - interval '1 hour'))
    `, [settings.workerId]);
    for (const job of rows) {
      const record = store.get('jobs', job.id);
      // The pipeline's word wins, which repairs a progress update that never reached Postgres.
      if (record) await syncJob(captures, record);
      // Claimed but never handed over, because the process stopped midway.
      else if (job.status === 'claimed') await giveUp(job, new Error('The worker restarted before the photos were fetched'));
    }
  }

  /** Jobs whose worker went quiet go back to the queue, or fail once they are out of attempts. */
  async function reap() {
    const { rows } = await pool.query<{ id: string; capture_id: string; status: string }>(`
      update jobs set
        status = case when attempts < max_attempts then 'queued' else 'failed' end,
        status_message = case when attempts < max_attempts then 'Queued for another try' else 'The worker stopped responding' end,
        failure_code = case when attempts < max_attempts then null else 'internal' end,
        failure_detail = case when attempts < max_attempts then null else 'The worker stopped responding' end,
        updated_at = now()
      where status in ${active} and heartbeat_at < now() - interval '${STALE}'
      returning id, capture_id, status
    `);
    for (const row of rows) {
      if (row.status !== 'failed') continue;
      await pool.query("update captures set status = 'failed', updated_at = now() where id = $1", [row.capture_id]);
      await captures.notify(row.capture_id, 'failed');
    }
    if (rows.some((row) => row.status === 'queued')) drain();
  }

  // The API announces new jobs on `jobs_queued`. The poll covers a missed notification.
  const listener = listen(settings.databaseUrlDirect, ['jobs_queued'], drain, onError, drain);
  const timers = [
    setInterval(drain, POLL_MS),
    setInterval(() => void heartbeat().catch(onError), HEARTBEAT_MS),
    setInterval(() => void reap().catch(onError), REAP_MS),
  ];
  drain();
  void reap().catch(onError);

  return async () => {
    stopped = true;
    for (const timer of timers) clearInterval(timer);
    await listener.close();
    await draining;
  };
}
