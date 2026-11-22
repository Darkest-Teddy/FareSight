import { MAX_ROOM_PHOTOS, ROOM_MODEL_TIERS } from '@faresight/shared';
import type { RoomModelTier } from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import { pipelineProvider } from '../config.ts';
import type { Config } from '../config.ts';
import type { Store } from '../db/database.ts';
import type { CaptureEvents } from '../services/captureEvents.ts';
import { capturePrefix, frameKey, framesJsonKey, MAX_FRAMES_JSON_BYTES, splatPrefix, uploadTarget } from '../services/captureKeys.ts';
import { captureView } from '../services/captures.ts';
import type { CaptureEventType, CaptureJobRow, CaptureRow, CaptureView, Captures } from '../services/captures.ts';
import { MAX_IMAGE_BYTES } from '../services/imagePrep.ts';
import { PRESIGN_SECONDS } from '../services/objectStorage.ts';
import type { PasscodeGuards } from '../services/passcodes.ts';

interface FrameBody {
  seq: number;
  key: string;
  t_ms?: number;
  orientation?: number[] | null;
  pose?: number[] | null;
  blur?: number | null;
  parallax_px?: number | null;
  width?: number | null;
  height?: number | null;
}
type Id = { Params: { id: string } };

const MAX_BATCH = 50;
const KEEP_ALIVE_MS = 25_000;
const params = {
  type: 'object', required: ['id'],
  properties: { id: { type: 'string', pattern: '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$' } },
};
const numbers = (length: number) => ({ type: ['array', 'null'], items: { type: 'number' }, minItems: length, maxItems: length });
const optionalNumber = { type: ['number', 'null'] };
const optionalSize = { type: ['integer', 'null'], minimum: 1, maximum: 100_000 };

export function registerCaptures(app: FastifyInstance, store: Store, config: Config, guards: PasscodeGuards, captures: Captures | undefined, events: CaptureEvents | undefined) {
  if (!captures || !events) {
    // The apps read /api/health first, so this only answers clients that skipped the check.
    app.all('/api/captures*', async (_request, reply) => reply.code(503).send({ error: 'Capture storage is not configured on this server' }));
    return;
  }
  const { pool, storage, settings } = captures;
  const streams = new Set<() => void>();
  app.addHook('preClose', async () => { for (const end of [...streams]) end(); });

  const find = async (id: string) => (await pool.query<CaptureRow>('select * from captures where id = $1', [id])).rows[0];
  const missing = { error: 'Capture not found' };
  const sealed = { error: 'This capture has already been completed' };
  const open = (capture: CaptureRow) => capture.status === 'created' || capture.status === 'uploading';

  app.post<{ Body: { place_id: string; mode?: 'room'; device_info?: object } }>('/api/captures', {
    onRequest: guards.contributor,
    schema: { body: {
      type: 'object', required: ['place_id'],
      properties: {
        place_id: { type: 'string', minLength: 1, maxLength: 96 },
        // Dishes are built from a single photo and keep using /api/uploads.
        mode: { enum: ['room'] },
        device_info: { type: 'object', maxProperties: 24 },
      },
    } },
  }, async ({ body }, reply) => {
    if (!store.get('places', body.place_id)) return reply.code(404).send({ error: 'Place not found' });
    const { rows } = await pool.query<{ id: string }>(
      'insert into captures (place_id, mode, device_info) values ($1, $2, $3) returning id',
      [body.place_id, body.mode ?? 'room', JSON.stringify(body.device_info ?? {})]);
    return reply.code(201).send({ capture_id: rows[0].id });
  });

  app.get<{ Querystring: { place_id?: string } }>('/api/captures', {
    onRequest: guards.admin,
    schema: { querystring: { type: 'object', properties: { place_id: { type: 'string', maxLength: 96 } } } },
  }, async ({ query }) => {
    const { rows } = await pool.query<{ id: string }>(
      'select id from captures where ($1::text is null or place_id = $1) order by created_at desc limit 100', [query.place_id ?? null]);
    const views = await Promise.all(rows.map(({ id }) => captureView(captures, store, config, id)));
    return { captures: views.filter(Boolean) };
  });

  app.post<Id & { Body: { files: { name: string; content_type: string; size: number }[] } }>('/api/captures/:id/upload-urls', {
    onRequest: guards.contributor,
    schema: { params, body: {
      type: 'object', required: ['files'],
      properties: { files: {
        type: 'array', minItems: 1, maxItems: MAX_BATCH,
        items: {
          type: 'object', required: ['name', 'content_type', 'size'],
          properties: {
            name: { type: 'string', maxLength: 64 }, content_type: { type: 'string', maxLength: 64 },
            size: { type: 'integer', minimum: 1 },
          },
        },
      } },
    } },
  }, async ({ params: { id }, body }, reply) => {
    const capture = await find(id);
    if (!capture) return reply.code(404).send(missing);
    if (!open(capture)) return reply.code(409).send(sealed);
    const expires_at = new Date(Date.now() + PRESIGN_SECONDS * 1000).toISOString();
    const urls = [];
    for (const file of body.files) {
      const target = uploadTarget(id, file);
      if ('error' in target) return reply.code(400).send({ error: target.error });
      urls.push({ name: file.name, key: target.key, url: await storage.presignPut(settings.rawBucket, target.key, file.content_type), expires_at });
    }
    return { urls };
  });

  app.post<Id & { Body: { frames: FrameBody[] } }>('/api/captures/:id/frames', {
    onRequest: guards.contributor,
    schema: { params, body: {
      type: 'object', required: ['frames'],
      properties: { frames: {
        type: 'array', minItems: 1, maxItems: MAX_BATCH,
        items: {
          type: 'object', required: ['seq', 'key'],
          properties: {
            seq: { type: 'integer', minimum: 0, maximum: 999_999 }, key: { type: 'string', maxLength: 128 },
            t_ms: { type: 'integer', minimum: 0 }, orientation: numbers(4), pose: numbers(16),
            blur: optionalNumber, parallax_px: optionalNumber, width: optionalSize, height: optionalSize,
          },
        },
      } },
    } },
  }, async ({ params: { id }, body }, reply) => {
    const wrong = body.frames.find((frame) => frame.key !== frameKey(id, frame.seq));
    if (wrong) return reply.code(400).send({ error: `Frame ${wrong.seq} must use the key ${frameKey(id, wrong.seq)}` });
    const client = await pool.connect();
    try {
      await client.query('begin');
      const { rows: [capture] } = await client.query<CaptureRow>('select * from captures where id = $1 for update', [id]);
      if (!capture || !open(capture)) {
        await client.query('rollback');
        return capture ? reply.code(409).send(sealed) : reply.code(404).send(missing);
      }
      for (const frame of body.frames) {
        await client.query(`
          insert into frames (capture_id, seq, object_key, t_ms, orientation, pose, blur_score, parallax_score, width, height)
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          on conflict (capture_id, seq) do update set
            t_ms = excluded.t_ms, orientation = excluded.orientation, pose = excluded.pose, blur_score = excluded.blur_score,
            parallax_score = excluded.parallax_score, width = excluded.width, height = excluded.height
        `, [id, frame.seq, frame.key, frame.t_ms ?? 0, frame.orientation ?? null, frame.pose ?? null,
          frame.blur ?? null, frame.parallax_px ?? null, frame.width ?? null, frame.height ?? null]);
      }
      const { rows: [{ frame_count }] } = await client.query<{ frame_count: number }>(`
        update captures set status = 'uploading', updated_at = now(),
          frame_count = (select count(*) from frames where capture_id = $1)
        where id = $1 returning frame_count
      `, [id]);
      if (frame_count > MAX_ROOM_PHOTOS) {
        await client.query('rollback');
        return reply.code(400).send({ error: `A capture can hold up to ${MAX_ROOM_PHOTOS} photos` });
      }
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return reply.code(204).send();
  });

  app.post<Id & { Body?: { model_tier?: RoomModelTier } }>('/api/captures/:id/complete', {
    onRequest: guards.contributor,
    schema: { params, body: { type: ['object', 'null'], properties: { model_tier: { enum: ROOM_MODEL_TIERS } } } },
  }, async ({ params: { id }, body }, reply) => {
    const { provider, missingKey } = pipelineProvider(config, 'room');
    if (missingKey) return reply.code(503).send({ error: `Missing API credentials for ${provider}` });
    const client = await pool.connect();
    try {
      await client.query('begin');
      const end = async (code: number, payload: object) => {
        await client.query('rollback');
        return reply.code(code).send(payload);
      };
      // The row lock makes two simultaneous calls queue up, so the second one finds the first one's job.
      const { rows: [capture] } = await client.query<CaptureRow>('select * from captures where id = $1 for update', [id]);
      if (!capture) return await end(404, missing);
      const { rows: [latest] } = await client.query<CaptureJobRow>(
        'select * from jobs where capture_id = $1 order by created_at desc limit 1', [id]);
      if (latest && latest.status !== 'failed') return await end(200, { job_id: latest.id });

      const { rows: frames } = await client.query<{ seq: number; object_key: string }>(
        'select seq, object_key from frames where capture_id = $1 order by seq', [id]);
      if (frames.length < settings.minFrames || frames.length > MAX_ROOM_PHOTOS) {
        return await end(400, { error: `A capture needs ${settings.minFrames} to ${MAX_ROOM_PHOTOS} photos. This one has ${frames.length}.` });
      }
      const stored = new Map((await storage.list(settings.rawBucket, capturePrefix(id))).map(({ key, size }) => [key, size]));
      const manifestBytes = stored.get(framesJsonKey(id));
      if (!manifestBytes) return await end(409, { error: 'frames.json has not been uploaded' });
      if (manifestBytes > MAX_FRAMES_JSON_BYTES) return await end(400, { error: 'frames.json exceeds 1 MiB' });
      for (const frame of frames) {
        const size = stored.get(frame.object_key);
        if (!size) return await end(409, { error: `Photo ${frame.seq + 1} has not been uploaded` });
        if (size > MAX_IMAGE_BYTES) return await end(400, { error: `Photo ${frame.seq + 1} exceeds 8 MiB` });
      }

      const { rows: [job] } = await client.query<{ id: string }>(
        'insert into jobs (capture_id, params) values ($1, $2) returning id', [id, JSON.stringify({ model_tier: body?.model_tier ?? 'atlas-draft' })]);
      await client.query("update captures set status = 'uploaded', frame_count = $2, updated_at = now() where id = $1", [id, frames.length]);
      // Both notifications are delivered when the transaction commits.
      await client.query("select pg_notify('jobs_queued', $1)", [job.id]);
      await captures.notify(id, 'status', client);
      await client.query('commit');
      return reply.code(202).send({ job_id: job.id });
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  });

  app.get<Id>('/api/captures/:id', { schema: { params } }, async ({ params: { id } }, reply) => {
    return await captureView(captures, store, config, id) ?? reply.code(404).send(missing);
  });

  app.get<Id>('/api/captures/:id/events', { schema: { params } }, async ({ params: { id }, raw }, reply) => {
    const first = await captureView(captures, store, config, id);
    if (!first) return reply.code(404).send(missing);
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, {
      ...reply.getHeaders() as Record<string, string>,
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: string, data: object) => stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    const push = (view: CaptureView, type: CaptureEventType | 'snapshot') => {
      const { capture, job, assets } = view;
      send('status', {
        capture_status: capture.status, job_status: job?.status ?? null,
        progress: job?.progress ?? 0, status_message: job?.status_message ?? '',
      });
      if (type === 'asset' || type === 'snapshot') {
        for (const { quality, format, url } of assets) send('asset', { quality, format, url });
      }
      if (job?.status === 'failed' && type !== 'asset') {
        send('failed', { failure_code: job.failure_code ?? 'internal', message: job.failure_detail ?? job.status_message });
      }
    };
    let queue = Promise.resolve();
    const unsubscribe = events.subscribe(id, (type) => {
      queue = queue.then(async () => {
        const view = await captureView(captures, store, config, id);
        if (view && !stream.writableEnded) push(view, type);
      }).catch((error) => app.log.error(error));
    });
    const keepAlive = setInterval(() => stream.write(': keep-alive\n\n'), KEEP_ALIVE_MS);
    const end = () => {
      if (!streams.delete(end)) return;
      clearInterval(keepAlive);
      unsubscribe();
      stream.end();
    };
    streams.add(end);
    raw.on('close', end);
    push(first, 'snapshot');
  });

  app.delete<Id>('/api/captures/:id', { onRequest: guards.admin, schema: { params } }, async ({ params: { id } }, reply) => {
    const capture = await find(id);
    if (!capture) return reply.code(404).send(missing);
    const { rows: jobs } = await pool.query<CaptureJobRow>('select * from jobs where capture_id = $1', [id]);
    if (jobs.some(({ status }) => status !== 'failed' && status !== 'needs_review' && status !== 'ready')) {
      return reply.code(409).send({ error: 'This capture is still being built. Delete it once the build has finished.' });
    }
    const place = store.get('places', capture.place_id);
    if (jobs.some((job) => job.id === place?.room_asset_id || place?.rooms.some((room) => room.asset_id === job.id))) {
      return reply.code(409).send({ error: 'This capture is the published room for its place. Publish another room first.' });
    }
    // Objects first: if this stops halfway, the rows still say what is left to delete.
    await storage.deletePrefix(settings.rawBucket, capturePrefix(id));
    await storage.deletePrefix(settings.splatBucket, splatPrefix(id));
    for (const job of jobs) {
      const asset = store.get('assets', job.id);
      if (asset) store.put('assets', { ...asset, status: 'rejected' });
    }
    await pool.query('delete from captures where id = $1', [id]);
    return reply.code(204).send();
  });
}
