import { randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Dish, GenerationJob, MarbleTier, Vector3 } from '@faresight/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import { publicJob } from '../db/database.ts';
import type { JobRecord, Store } from '../db/database.ts';
import { selectReferencePhotos } from '../services/geminiSelector.ts';
import { decodeImageBase64, MAX_IMAGE_BYTES, prepareImage } from '../services/imagePrep.ts';
import { measureScale } from '../services/splatProcessor.ts';

interface ImageFields { filename: string; mimeType: string; place_id: string; dish_id?: string; source_url?: string }
interface UploadBody extends ImageFields { dataBase64: string }
interface IntakeBody { place_id: string; upload_ids: string[] }
interface JobBody extends IntakeBody {
  kind: 'room' | 'dish';
  dish_id?: string;
  dish_name?: string;
  plate_diameter_m?: number;
  model_tier?: MarbleTier;
}
interface PublishBody { spawn_point?: Vector3; plate_diameter_m?: number; rotation_y?: number; approve?: boolean }

const idSchema = { type: 'string', minLength: 1, maxLength: 96 };
const idList = (maxItems: number) => ({ type: 'array', minItems: 1, maxItems, uniqueItems: true, items: idSchema });
const plateSize = { type: 'number', exclusiveMinimum: 0, maximum: 2 };
const defaultVector: Vector3 = [0, 0, 0];

export function registerPipeline(app: FastifyInstance, store: Store, config: Config) {
  async function admin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (!config.adminPasscode) return;
    const provided = request.headers['x-admin-passcode'] ?? request.headers.authorization?.replace(/^Bearer /i, '');
    const expected = Buffer.from(config.adminPasscode);
    if (typeof provided !== 'string' || Buffer.byteLength(provided) !== expected.length
      || !timingSafeEqual(Buffer.from(provided), expected)) {
      reply.code(401).send({ error: 'Admin passcode is required' });
    }
  }

  app.post<{ Body: UploadBody }>('/api/uploads', { preHandler: admin }, async (request, reply) => {
    let input: ImageFields & { bytes: Buffer };
    if (request.isMultipart()) {
      const fields: Record<string, string> = {};
      let file: Pick<typeof input, 'filename' | 'mimeType' | 'bytes'> | undefined;
      for await (const part of request.parts({ limits: { files: 1, fields: 5, fileSize: MAX_IMAGE_BYTES } })) {
        if (part.type === 'file') {
          file = { filename: part.filename, mimeType: part.mimetype, bytes: await part.toBuffer() };
        } else if (typeof part.value === 'string') fields[part.fieldname] = part.value;
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
    preHandler: admin,
    schema: { body: {
      type: 'object', required: ['place_id', 'upload_ids'],
      properties: { place_id: idSchema, upload_ids: idList(24) },
    } },
  }, async ({ body }, reply) => {
    if (!store.get('places', body.place_id)) return reply.code(404).send({ error: 'Place not found' });
    const uploads = store.uploadsForPlace(body.place_id, body.upload_ids);
    if (!uploads) return reply.code(400).send({ error: 'All uploads must belong to this place' });
    return selectReferencePhotos(config, body.place_id, uploads);
  });

  app.post<{ Body: JobBody }>('/api/jobs', {
    preHandler: admin,
    schema: { body: {
      type: 'object', required: ['kind', 'place_id', 'upload_ids'],
      properties: {
        kind: { enum: ['room', 'dish'] }, place_id: idSchema, dish_id: idSchema,
        dish_name: { type: 'string', minLength: 1, maxLength: 120 }, upload_ids: idList(8),
        plate_diameter_m: plateSize, model_tier: { enum: ['marble-1.1', 'marble-1.1-draft'] },
      },
    } },
  }, async ({ body }, reply) => {
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
    const key = body.kind === 'room' ? config.marbleKey : config.replicateKey;
    let provider: GenerationJob['provider'] = body.kind === 'room' ? 'marble-1.1' : 'trellis-replicate';
    if (config.mode === 'demo' || (config.mode === 'auto' && !key)) provider = 'demo-sim';
    if (config.mode === 'live' && !key) return reply.code(503).send({ error: `Missing API credentials for ${provider}` });
    const now = new Date().toISOString();
    const job: JobRecord = {
      id: randomUUID(), kind: body.kind, place_id: place.id,
      dish_id: body.kind === 'dish' ? dish?.id ?? null : null,
      dish_name: body.kind === 'dish' ? dish?.name ?? (dishName || 'Untitled dish') : null,
      input_upload_ids: body.upload_ids, status: 'queued', progress: 0, provider, provider_task_id: null,
      plate_diameter_m: body.kind === 'dish' ? body.plate_diameter_m ?? dish?.plate_diameter_m ?? null : null,
      model_tier: body.kind === 'room' ? body.model_tier ?? 'marble-1.1' : undefined,
      status_message: provider === 'demo-sim' ? 'Demo simulation · Queued' : 'Queued',
      created_at: now, updated_at: now,
    };
    store.put('jobs', job);
    return reply.code(202).send(publicJob(job));
  });

  app.get('/api/jobs', async () => store.all('jobs').reverse().map(publicJob));
  app.get<{ Params: { id: string } }>('/api/jobs/:id', async ({ params }, reply) => {
    const job = store.get('jobs', params.id);
    if (!job) return reply.code(404).send({ error: 'Job not found' });
    return publicJob(job);
  });
  app.post<{ Params: { id: string } }>('/api/jobs/:id/retry', { preHandler: admin }, async ({ params }, reply) => {
    return store.transaction(() => {
      const job = store.get('jobs', params.id);
      if (!job) return reply.code(404).send({ error: 'Job not found' });
      if (job.status !== 'failed') return reply.code(409).send({ error: 'Only failed jobs can be retried' });
      if (job.submission_pending && !job.provider_task_id) {
        return reply.code(409).send({ error: job.error });
      }
      const hasOriginal = job.original_ply_path && existsSync(job.original_ply_path);
      const status = hasOriginal && !job.preview_download_pending ? 'converting' : job.provider_task_id ? 'downloading' : 'queued';
      const updated = store.updateJob(job, {
        status, status_message: `${job.provider === 'demo-sim' ? 'Demo simulation · ' : ''}Resuming ${status}`,
        error: null, progress: status === 'converting' ? 85 : status === 'downloading' ? 65 : 0,
      });
      return reply.code(202).send(publicJob(updated));
    });
  });

  app.get<{ Params: { id: string } }>('/api/assets/:id', async ({ params }, reply) => {
    const asset = store.get('assets', params.id);
    if (!asset) return reply.code(404).send({ error: 'Asset not found' });
    return asset;
  });
  app.post<{ Params: { id: string }; Body: PublishBody }>('/api/assets/:id/publish', {
    preHandler: admin,
    schema: { body: {
      type: 'object',
      properties: {
        spawn_point: { type: 'array', items: { type: 'number', minimum: -10000, maximum: 10000 }, minItems: 3, maxItems: 3 },
        plate_diameter_m: plateSize, rotation_y: { type: 'number', minimum: -360, maximum: 360 }, approve: { type: 'boolean' },
      },
    } },
  }, async ({ params, body = {} }, reply) => store.transaction(() => {
    const asset = store.get('assets', params.id);
    if (!asset) return reply.code(404).send({ error: 'Asset not found' });
    const job = store.get('jobs', params.id);
    if (!job || (job.status !== 'needs_review' && job.status !== 'ready')) {
      return reply.code(409).send({ error: 'Asset is not associated with a reviewable job' });
    }
    if (body.approve === false) {
      if (job.status === 'ready') return reply.code(409).send({ error: 'This asset has already been published' });
      asset.status = 'rejected';
      store.put('assets', asset);
      store.updateJob(job, { status_message: 'Asset rejected during review' });
      return asset;
    }
    const place = store.get('places', job.place_id);
    if (!place) return reply.code(404).send({ error: 'Place not found' });
    if (job.status === 'ready') return asset;
    if (job.kind === 'dish' && body.plate_diameter_m !== undefined) {
      Object.assign(asset, measureScale(body.plate_diameter_m, asset.metadata?.measured_width));
    }
    asset.spawn_point = body.spawn_point ?? asset.spawn_point;
    const rotation = asset.transform?.rotation ?? defaultVector;
    asset.transform = {
      position: asset.transform?.position ?? defaultVector,
      rotation: [rotation[0], body.rotation_y ?? rotation[1], rotation[2]], scale: asset.scale_factor,
    };
    asset.status = 'ready';
    if (job.kind === 'room') {
      for (const room of place.rooms) {
        if (room.asset_id === place.room_asset_id) room.asset_id = asset.id;
      }
      place.room_asset_id = asset.id;
    } else {
      const name = job.dish_name!;
      let dish = place.dishes.find((entry) => entry.id === job.dish_id || entry.name.toLowerCase() === name.toLowerCase());
      if (!dish) {
        dish = { id: `${place.id}-dish-${job.id}`, place_id: place.id, name, price: place.typical_price, portion_note: '' } satisfies Dish;
        place.dishes.push(dish);
      }
      dish.asset_id = asset.id;
      dish.plate_diameter_m = asset.plate_diameter_m ?? dish.plate_diameter_m;
      job.dish_id = dish.id;
      job.plate_diameter_m = asset.plate_diameter_m;
    }
    store.put('assets', asset);
    store.put('places', place);
    store.updateJob(job, { status: 'ready', status_message: 'Published', progress: 100 });
    return asset;
  }));
}
