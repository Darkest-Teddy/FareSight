import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { MAX_ROOM_PHOTOS, ROOM_MODEL_TIERS, ROOM_PHOTO_REQUIREMENT } from '@faresight/shared';
import type { Asset, RoomModelTier } from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import { pipelineProvider } from '../config.ts';
import type { Config } from '../config.ts';
import { publicJob } from '../db/database.ts';
import type { JobRecord, Store } from '../db/database.ts';
import { places } from '../db/seed.ts';
import { selectReferencePhotos } from '../services/geminiSelector.ts';
import { decodeImageBase64, MAX_IMAGE_BYTES, prepareImage } from '../services/imagePrep.ts';
import type { PasscodeGuards } from '../services/passcodes.ts';
import { publishAsset } from '../services/publish.ts';
import type { PublishOptions } from '../services/publish.ts';

interface ImageFields { filename: string; mimeType: string; place_id: string; dish_id?: string; source_url?: string }
interface UploadBody extends ImageFields { dataBase64: string }
interface IntakeBody { place_id: string; upload_ids: string[] }
interface JobBody extends IntakeBody {
  kind: 'room' | 'dish';
  dish_id?: string;
  dish_name?: string;
  dish_price?: number;
  plate_diameter_m?: number;
  model_tier?: RoomModelTier;
}
interface PublishBody extends PublishOptions { approve?: boolean }

const idSchema = { type: 'string', minLength: 1, maxLength: 96 };
const idList = (maxItems: number) => ({ type: 'array', minItems: 1, maxItems, uniqueItems: true, items: idSchema });
const plateSize = { type: 'number', exclusiveMinimum: 0, maximum: 2 };
/** Contributors state the menu price with the photo, so an uploaded dish is never priceless. */
const dishPrice = { type: 'number', exclusiveMinimum: 0, maximum: 500 };

const multipartLimit = MAX_IMAGE_BYTES + 64 * 1024;

export function registerPipeline(app: FastifyInstance, store: Store, config: Config, guards: PasscodeGuards) {
  app.post<{ Body: UploadBody }>('/api/uploads', {
    onRequest: guards.contributor,
    bodyLimit: Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 16 * 1024,
  }, async (request, reply) => {
    let input: ImageFields & { bytes: Buffer };
    if (request.isMultipart()) {
      if (Number(request.headers['content-length']) > multipartLimit) {
        return reply.code(413).send({ error: 'Multipart upload is too large' });
      }
      const fields: Record<string, string> = Object.create(null);
      let file: Pick<typeof input, 'filename' | 'mimeType' | 'bytes'> | undefined;
      let bytes = 0;
      let overLimit = false;
      let stopReading: () => void;
      const oversized = new Promise<void>((resolve) => { stopReading = resolve; });
      const count = (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > multipartLimit) {
          overLimit = true;
          stopReading();
        }
      };
      const parse = async () => {
        for await (const part of request.parts({ limits: { files: 1, fields: 5, fileSize: MAX_IMAGE_BYTES } })) {
          if (overLimit) break;
          if (part.type === 'file') {
            file = { filename: part.filename, mimeType: part.mimetype, bytes: await part.toBuffer() };
          } else if (typeof part.value === 'string' && !part.valueTruncated) fields[part.fieldname] = part.value;
          else throw Object.assign(new Error('Invalid multipart field'), { statusCode: 400 });
        }
      };
      request.raw.on('data', count);
      try {
        await Promise.race([oversized, parse()]);
      } finally {
        request.raw.off('data', count);
      }
      if (overLimit) {
        request.raw.unpipe();
        request.raw.pause();
        return reply.header('Connection', 'close').code(413).send({ error: 'Multipart upload is too large' });
      }
      if (!file) return reply.code(400).send({ error: 'Upload requires one image file' });
      input = { ...file, place_id: fields.place_id, dish_id: fields.dish_id, source_url: fields.source_url };
    } else {
      if (typeof request.body?.filename !== 'string' || typeof request.body?.mimeType !== 'string'
        || typeof request.body?.dataBase64 !== 'string') {
        return reply.code(400).send({ error: 'Provide filename, mimeType and dataBase64' });
      }
      try {
        input = { ...request.body, bytes: decodeImageBase64(request.body.dataBase64) };
      } catch {
        return reply.code(400).send({ error: 'Invalid image base64' });
      }
    }

    if (typeof input.place_id !== 'string' || !input.place_id || !input.filename.trim()) {
      return reply.code(400).send({ error: 'Provide place_id and a filename' });
    }
    const place = store.get('places', input.place_id);
    if (!place) return reply.code(404).send({ error: 'Place not found' });
    if (input.dish_id !== undefined && !place.dishes.some((dish) => dish.id === input.dish_id)) {
      return reply.code(400).send({ error: 'dish_id must refer to a dish at this place' });
    }
    if (input.source_url !== undefined && (typeof input.source_url !== 'string' || input.source_url.length > 2048)) {
      return reply.code(400).send({ error: 'Invalid source_url' });
    }
    try {
      const upload = prepareImage(store, config, input);
      return reply.code(upload.deduplicated ? 200 : 201).send(upload);
    } catch (error) {
      if (error instanceof TypeError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  app.post<{ Body: IntakeBody }>('/api/intake', {
    onRequest: guards.contributor,
    schema: { body: {
      type: 'object', required: ['place_id', 'upload_ids'],
      properties: { place_id: idSchema, upload_ids: idList(MAX_ROOM_PHOTOS + 1) },
    } },
  }, async ({ body }, reply) => {
    if (!store.get('places', body.place_id)) return reply.code(404).send({ error: 'Place not found' });
    const uploads = store.uploadsForPlace(body.place_id, body.upload_ids);
    if (!uploads) return reply.code(400).send({ error: 'All uploads must belong to this place' });
    return selectReferencePhotos(config, body.place_id, uploads);
  });

  app.post<{ Body: JobBody }>('/api/jobs', {
    onRequest: guards.contributor,
    schema: { body: {
      type: 'object', required: ['kind', 'place_id', 'upload_ids'],
      properties: {
        kind: { enum: ['room', 'dish'] }, place_id: idSchema, dish_id: idSchema,
        dish_name: { type: 'string', minLength: 1, maxLength: 120 }, dish_price: dishPrice,
        upload_ids: idList(MAX_ROOM_PHOTOS),
        plate_diameter_m: plateSize, model_tier: { enum: ROOM_MODEL_TIERS },
      },
    } },
  }, async ({ body, headers }, reply) => {
    const keyHeader = headers['idempotency-key'];
    if (keyHeader !== undefined && (typeof keyHeader !== 'string' || !/^[!-~]{1,200}$/.test(keyHeader))) {
      return reply.code(400).send({ error: 'Invalid Idempotency-Key' });
    }
    const fingerprint = keyHeader && createHash('sha256').update(JSON.stringify([
      body.kind, body.place_id, body.upload_ids, body.dish_id, body.dish_name, body.dish_price,
      body.plate_diameter_m, body.model_tier,
    ])).digest('hex');
    return store.transaction(() => {
      if (keyHeader) {
        const prior = store.jobByIdempotencyKey(keyHeader);
        if (prior) {
          if (prior.request_fingerprint !== fingerprint) return reply.code(409).send({ error: 'Idempotency-Key already used for a different job' });
          return reply.code(202).send(publicJob(prior));
        }
      }
      const place = store.get('places', body.place_id);
      if (!place) return reply.code(404).send({ error: 'Place not found' });
      const uploads = store.uploadsForPlace(body.place_id, body.upload_ids);
      if (!uploads) return reply.code(400).send({ error: 'All uploads must belong to this place' });
      const dishName = body.dish_name?.trim();
      const dishId = body.dish_id ?? (!dishName ? uploads[0].dish_id : null);
      const dish = dishId ? place.dishes.find((entry) => entry.id === dishId)
        : place.dishes.find((entry) => entry.name.toLowerCase() === dishName?.toLowerCase());
      if (body.kind === 'dish' && (uploads.length !== 1 || (body.dish_id && !dish))) {
        return reply.code(400).send({ error: 'Dish generation requires one image and any supplied dish_id must belong to the place' });
      }
      // A food photo carries its own menu price, so nothing reaches the catalog unpriced.
      if (body.kind === 'dish' && body.dish_price === undefined) {
        return reply.code(400).send({ error: 'Dish generation requires the menu price of the dish' });
      }
      if (body.kind === 'dish' && !dish && !dishName) {
        return reply.code(400).send({ error: 'Dish generation requires the name of the dish' });
      }
      const { provider, missingKey } = pipelineProvider(config, body.kind);
      if (provider === 'atlas-v2' && uploads.length < 2) return reply.code(400).send({ error: ROOM_PHOTO_REQUIREMENT });
      if (missingKey) return reply.code(503).send({ error: `Missing API credentials for ${provider}` });
      const now = new Date().toISOString();
      const job: JobRecord = {
        id: randomUUID(), kind: body.kind, place_id: place.id,
        dish_id: body.kind === 'dish' ? dish?.id ?? null : null,
        dish_name: body.kind === 'dish' ? dish?.name ?? (dishName || 'Untitled dish') : null,
        dish_price: body.kind === 'dish' ? body.dish_price ?? null : null,
        input_upload_ids: body.upload_ids, status: 'queued', progress: 0, provider, provider_task_id: null,
        plate_diameter_m: body.kind === 'dish' ? body.plate_diameter_m ?? dish?.plate_diameter_m ?? null : null,
        model_tier: body.kind === 'room' ? body.model_tier ?? 'atlas-draft' : undefined,
        status_message: provider === 'demo-sim' ? 'Demo simulation · Queued' : 'Queued',
        created_at: now, updated_at: now, idempotency_key: keyHeader, request_fingerprint: fingerprint,
      };
      store.put('jobs', job);
      return reply.code(202).send(publicJob(job));
    });
  });

  app.get('/api/jobs', { onRequest: guards.contributor }, async () => store.all('jobs').reverse().map(publicJob));
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async ({ params }, reply) => {
    const job = store.get('jobs', params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return publicJob(job);
  });
  app.post<{ Params: { id: string } }>('/api/jobs/:id/retry', { onRequest: guards.contributor }, async ({ params }, reply) => {
    return store.transaction(() => {
      const job = store.get('jobs', params.id);
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      if (job.status !== 'failed') return reply.code(409).send({ error: 'Only failed jobs can be retried' });
      if (!store.get('places', job.place_id)) return reply.code(409).send({ error: 'The job venue is no longer in the catalog' });
      if (job.terminal_failure) return reply.code(409).send({ error: job.error ?? 'This job cannot be retried' });
      if (job.submission_pending && !job.provider_task_id && job.provider !== 'atlas-v2') {
        return reply.code(409).send({ error: job.error });
      }
      if (String(job.provider) === 'marble-1.1') {
        return reply.code(409).send({ error: 'This Marble job used a retired API. Create a new Atlas room job.' });
      }
      const original = job.original_spz_path ?? job.original_ply_path;
      const status = original && existsSync(original) && !job.preview_download_pending ? 'converting'
        : job.provider === 'atlas-v2' ? (job.atlas_splat ? 'downloading' : 'generating')
        : job.provider_task_id ? 'downloading' : 'queued';
      const updated = store.updateJob(job, {
        status, status_message: `${job.provider === 'demo-sim' ? 'Demo simulation · ' : ''}Resuming ${status}`,
        error: null, progress: status === 'converting' ? 85 : status === 'downloading' ? 65 : status === 'generating' ? job.progress : 0,
      });
      return reply.code(202).send(publicJob(updated));
    });
  });

  app.get<{ Params: { id: string } }>('/api/assets/:id', async ({ params }, reply) => {
    const asset = store.get('assets', params.id);
    if (!asset) return reply.code(404).send({ error: 'Asset not found' });
    return asset;
  });
  for (const url of ['/api/assets/:id/publish', '/api/jobs/:id/publish']) app.route<{ Params: { id: string }; Body: PublishBody }>({
    method: 'POST',
    url,
    onRequest: guards.admin,
    schema: { body: {
      type: 'object',
      properties: {
        spawn_point: { type: 'array', items: { type: 'number', minimum: -10000, maximum: 10000 }, minItems: 3, maxItems: 3 },
        plate_diameter_m: plateSize, rotation_y: { type: 'number', minimum: -360, maximum: 360 }, approve: { type: 'boolean' },
      },
    } },
    handler: async ({ params, body = {} }, reply) => store.transaction(() => {
      const asset = store.get('assets', params.id);
      if (!asset) return reply.code(404).send({ error: 'Asset not found' });
      const job = store.get('jobs', params.id);
      const place = job && store.get('places', job.place_id);
      if (!job || !place || !['needs_review', 'ready'].includes(job.status)) {
        return reply.code(409).send({ error: 'Asset is not associated with a reviewable job' });
      }
      return body.approve === false ? rejectAsset(store, asset, job) : publishAsset(store, asset, job, body);
    }),
  });
}

export function rejectAsset(store: Store, asset: Asset, job?: JobRecord) {
  const place = job && store.get('places', job.place_id);
  if (place) {
    const seed = places.find(({ id }) => id === place.id);
    if (place.room_asset_id === asset.id) place.room_asset_id = seed?.room_asset_id ?? null;
    const seedPreviews = [...(seed?.rooms ?? []), ...(seed?.dishes ?? []), ...(seed?.seat_views ?? [])];
    for (const entry of [...place.rooms, ...place.dishes, ...place.seat_views]) {
      if (entry.asset_id === asset.id) entry.asset_id = seedPreviews.find(({ id }) => id === entry.id)?.asset_id ?? null;
    }
    store.put('places', place);
  }
  asset.status = 'rejected';
  store.put('assets', asset);
  if (job) store.updateJob(job, { status: 'failed', terminal_failure: true, status_message: 'Asset rejected', error: 'Asset rejected' });
  return asset;
}
