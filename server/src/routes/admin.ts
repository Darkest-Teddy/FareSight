import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import type { PendingReview, Store } from '../db/database.ts';

interface ReviewBody {
  author_label: string;
  text: string;
  rating?: number;
}

interface ModerateBody {
  type: 'review' | 'upload';
  id: string;
  action: 'approve' | 'reject';
}

interface DebugLogsBody {
  logs: string[];
}

export function registerAdminAndCommunity(app: FastifyInstance, store: Store, config: Config) {
  function verifyAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
    const expectedPasscode = config.adminPasscode || 'bostonhacks2026';
    const provided = request.headers['x-admin-passcode'] ?? request.headers.authorization?.replace(/^Bearer /i, '');
    const expected = Buffer.from(expectedPasscode);
    if (typeof provided !== 'string' || Buffer.byteLength(provided) !== expected.length
      || !timingSafeEqual(Buffer.from(provided), expected)) {
      reply.code(401).send({ error: 'Valid admin passcode is required' });
      return false;
    }
    return true;
  }

  app.post<{ Params: { id: string }; Body: ReviewBody }>('/api/restaurants/:id/reviews', {
    schema: {
      body: {
        type: 'object',
        required: ['author_label', 'text'],
        properties: {
          author_label: { type: 'string', minLength: 1, maxLength: 80 },
          text: { type: 'string', minLength: 1, maxLength: 1000 },
          // Stars out of five. Optional, so a plain visit note is still accepted.
          rating: { type: 'integer', minimum: 1, maximum: 5 },
        },
      },
    },
  }, async ({ params, body }, reply) => {
    const place = store.get('places', params.id);
    if (!place) return reply.code(404).send({ error: 'Place not found' });
    const author_label = body.author_label.trim();
    const text = body.text.trim();
    if (!author_label || !text) return reply.code(400).send({ error: 'Provide author_label and text' });
    const review: PendingReview = {
      id: randomUUID(),
      place_id: place.id,
      author_label,
      text,
      rating: body.rating,
      status: 'pending_review',
      created_at: new Date().toISOString(),
    };
    store.put('reviews', review);
    return reply.code(201).send(review);
  });

  app.get('/api/admin/moderation', async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const reviews = store.all('reviews').filter((review) => review.status === 'pending_review');
    const uploads = store.all('assets')
      .filter((asset) => asset.status === 'needs_review' || asset.status === 'pending_review')
      .map((asset) => {
        const job = store.get('jobs', asset.id);
        return {
          id: asset.id,
          place_id: job?.place_id ?? 'unknown',
          filename: `${asset.kind} · ${asset.backend}`,
          url: asset.preview_url ?? asset.url,
          status: asset.status,
        };
      });
    return { reviews, uploads };
  });

  app.post<{ Body: ModerateBody }>('/api/admin/moderation', {
    schema: {
      body: {
        type: 'object',
        required: ['type', 'id', 'action'],
        properties: {
          type: { enum: ['review', 'upload'] },
          id: { type: 'string', minLength: 1, maxLength: 96 },
          action: { enum: ['approve', 'reject'] },
        },
      },
    },
  }, async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    const { type, id, action } = request.body;
    if (type === 'review') {
      return store.transaction(() => {
        const review = store.get('reviews', id);
        if (!review) return reply.code(404).send({ error: 'Review not found' });
        review.status = action === 'approve' ? 'approved' : 'rejected';
        store.put('reviews', review);
        if (action === 'approve') {
          const place = store.get('places', review.place_id);
          if (place && !place.reviews.some((entry) => entry.id === review.id)) {
            place.reviews.push({
              id: review.id,
              rating: review.rating ?? 5,
              author: review.author_label,
              text: review.text,
              created_at: review.created_at,
            });
            store.put('places', place);
          }
        }
        return review;
      });
    }

    return store.transaction(() => {
      const asset = store.get('assets', id);
      if (!asset) return reply.code(404).send({ error: 'Asset not found' });
      const job = store.get('jobs', id);
      if (action === 'reject') {
        asset.status = 'rejected';
        store.put('assets', asset);
        if (job) store.updateJob(job, { status_message: 'Asset rejected during moderation' });
        return asset;
      }
      asset.status = 'ready';
      store.put('assets', asset);
      if (job) {
        const place = store.get('places', job.place_id);
        if (place) {
          if (job.kind === 'room') {
            for (const room of place.rooms) {
              if (room.asset_id === place.room_asset_id) room.asset_id = asset.id;
            }
            place.room_asset_id = asset.id;
          } else {
            const dish = place.dishes.find((entry) => entry.id === job.dish_id
              || (job.dish_name && entry.name.toLowerCase() === job.dish_name.toLowerCase()));
            if (dish) dish.asset_id = asset.id;
          }
          store.put('places', place);
        }
        store.updateJob(job, { status: 'ready', status_message: 'Published', progress: 100 });
      }
      return asset;
    });
  });

  app.post<{ Body: DebugLogsBody }>('/api/debug/logs', {
    schema: {
      body: {
        type: 'object',
        required: ['logs'],
        properties: {
          logs: { type: 'array', maxItems: 200, items: { type: 'string', maxLength: 500 } },
        },
      },
    },
  }, async ({ body }, reply) => {
    const entry = { id: randomUUID(), logs: body.logs, created_at: new Date().toISOString() };
    store.put('debug_logs', entry);
    return reply.code(201).send({ id: entry.id, count: entry.logs.length });
  });

  app.get('/api/debug/logs', async (request, reply) => {
    if (!verifyAdmin(request, reply)) return;
    return store.all('debug_logs').slice(-25).reverse();
  });
}
