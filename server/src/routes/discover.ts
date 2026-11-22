import type {
  Category, DiscoverArrival, DiscoverQuery, DiscoverSort, DiscoverWindow, EngagementKind,
  NotificationFeed, ReportReason,
} from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { Store } from '../db/database.ts';
import { sessionHash } from '../services/accounts.ts';
import type { Accounts } from '../services/accounts.ts';
import type { ContributedRow, Discover } from '../services/discover.ts';
import { nearestStation } from '../services/discover.ts';
import type { DiscoverEvents } from '../services/discoverEvents.ts';
import type { GooglePlaces } from '../services/googlePlaces.ts';
import { ipRateLimit } from '../services/requestLimits.ts';
import type { AuthGuards } from './auth.ts';

const KEEP_ALIVE_MS = 25_000;
const SORTS = new Set<DiscoverSort>(['new', 'rated', 'popular']);
const WINDOWS = new Set<DiscoverWindow>(['today', 'week', 'month']);
const REASONS = new Set<ReportReason>(['not_a_place', 'wrong_info', 'offensive', 'spam', 'duplicate']);
const CATEGORIES = new Set<Category>([
  'restaurant', 'study', 'music', 'activity', 'shop', 'market',
  'outdoor', 'museum', 'event_space', 'hotel', 'stadium',
]);

interface CreateBody {
  name?: unknown; category?: unknown; lat?: unknown; lon?: unknown;
  price_typical?: unknown; note?: unknown; address?: unknown;
  google_place_id?: unknown; capture_id?: unknown; photo_urls?: unknown;
  rating?: unknown; rating_count?: unknown;
}

export function registerDiscover(
  app: FastifyInstance,
  store: Store,
  config: Config,
  auth: AuthGuards,
  accounts: Accounts | undefined,
  discover: Discover | undefined,
  events: DiscoverEvents | undefined,
  places: GooglePlaces | undefined,
) {
  const engagementLimit = ipRateLimit(120, 60_000);
  const createLimit = ipRateLimit(config.accounts?.placesPerHour ?? 10, 60 * 60_000);
  const reportLimit = ipRateLimit(10, 60 * 60_000);
  const streams = new Set<() => void>();
  app.addHook('onClose', async () => {
    for (const end of [...streams]) end();
  });

  const off = (reply: { code: (n: number) => { send: (b: object) => unknown } }) =>
    reply.code(503).send({ error: 'Discover is unavailable: the server has no DATABASE_URL' });

  app.get<{ Querystring: Record<string, string> }>('/api/discover', async ({ query }, reply) => {
    if (!discover) return off(reply);
    const request: DiscoverQuery = {
      q: query.q?.slice(0, 120),
      chip: query.chip,
      station: query.station,
      sort: SORTS.has(query.sort as DiscoverSort) ? query.sort as DiscoverSort : 'new',
      window: WINDOWS.has(query.window as DiscoverWindow) ? query.window as DiscoverWindow : 'today',
      cursor: query.cursor,
      limit: query.limit ? Number(query.limit) : undefined,
    };
    reply.header('Cache-Control', 'no-store');
    return discover.list(request);
  });

  /**
   * Nearby venues for the contributor to choose from. `suggested` marks the one matching what
   * Gemini read off the photographs, which the app preselects.
   *
   * Returns an empty list when Places is not configured, rather than an error: typing a name is
   * always available, so an unconfigured key must not block an upload.
   */
  app.get<{ Querystring: { lat?: string; lon?: string; name?: string } }>(
    '/api/places/nearby', { onRequest: auth.required }, async ({ query }, reply) => {
      const lat = Number(query.lat);
      const lon = Number(query.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return reply.code(400).send({ error: 'lat and lon are required' });
      }
      const candidates = places ? await places.nearby(lat, lon, query.name?.slice(0, 120)) : [];
      const station = nearestStation(lat, lon);
      return {
        candidates,
        configured: Boolean(places?.enabled),
        station: station ? { stop_id: station.stop_id, name: station.name, distance_m: Math.round(station.distance) } : null,
      };
    },
  );

  /**
   * Creates a contributed place. It is published at once (specification D18) and announced to
   * every open Discover page.
   *
   * The place is deliberately not added to any station map. `station_id` is derived purely as a
   * label, and is null when nothing is within 800 metres (D6, D9).
   */
  app.post<{ Body: CreateBody }>('/api/places', { onRequest: auth.required, bodyLimit: 16 * 1024 }, async (request, reply) => {
    if (!accounts || !discover) return off(reply);
    if (!createLimit.take(request.ip)) {
      return reply.code(429).send({ error: 'Too many places added from here in the last hour' });
    }
    const body = request.body ?? {};
    const name = String(body.name ?? '').trim();
    const category = String(body.category ?? 'restaurant') as Category;
    if (!name) return reply.code(400).send({ error: 'A place needs a name' });
    if (name.length > 120) return reply.code(400).send({ error: 'Name must be 120 characters or fewer' });
    if (!CATEGORIES.has(category)) return reply.code(400).send({ error: 'Unknown category' });

    const lat = Number.isFinite(Number(body.lat)) ? Number(body.lat) : null;
    const lon = Number.isFinite(Number(body.lon)) ? Number(body.lon) : null;
    const station = nearestStation(lat, lon);
    const photoUrls = Array.isArray(body.photo_urls)
      ? body.photo_urls.filter((url): url is string => typeof url === 'string').slice(0, 32) : [];
    const user = auth.user(request);

    const { rows } = await accounts.pool.query<{ id: string; created_at: Date }>(
      `insert into contributed_places
         (created_by, name, category, station_id, lat, lon, price_typical, note, address,
          capture_id, google_place_id, photo_urls)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       returning id, created_at`,
      [
        user.id, name, category, station?.stop_id ?? null, lat, lon,
        Number.isFinite(Number(body.price_typical)) ? Number(body.price_typical) : null,
        String(body.note ?? '').trim().slice(0, 500) || null,
        String(body.address ?? '').trim().slice(0, 300) || null,
        typeof body.capture_id === 'string' ? body.capture_id : null,
        typeof body.google_place_id === 'string' ? body.google_place_id : null,
        JSON.stringify(photoUrls),
      ],
    );
    const created = rows[0];

    // Cache whatever rating the nearby search already returned, so the card can show a score
    // without a second Places call. Only the latest value is kept, never a history.
    if (places && typeof body.google_place_id === 'string') {
      const rating = Number.isFinite(Number(body.rating)) ? Number(body.rating) : null;
      const count = Number.isFinite(Number(body.rating_count)) ? Number(body.rating_count) : null;
      await places.cache(body.google_place_id, {
        rating, ratingCount: count, address: String(body.address ?? '') || null,
      }).catch((error) => app.log.error(error));
    }

    // An upload is the strongest popularity signal there is, so the place enters the ranking the
    // moment it exists rather than waiting for its first visitor.
    await discover.record(created.id, 'upload', sessionHash(request.ip, request.headers['user-agent']));
    discover.invalidateScores();

    const arrival: DiscoverArrival = {
      place_id: created.id,
      name,
      station_name: station?.name ?? null,
      category,
      created_at: created.created_at.toISOString(),
    };
    await events?.publish(arrival).catch((error) => app.log.error(error));
    return reply.code(201).send({ place_id: created.id, station_id: station?.stop_id ?? null, created_at: arrival.created_at });
  });

  app.patch<{ Params: { id: string }; Body: CreateBody }>(
    '/api/places/:id', { onRequest: auth.required, bodyLimit: 16 * 1024 }, async (request, reply) => {
      if (!accounts) return off(reply);
      const body = request.body ?? {};
      const name = body.name === undefined ? undefined : String(body.name).trim().slice(0, 120);
      if (name === '') return reply.code(400).send({ error: 'A place needs a name' });
      const category = body.category === undefined ? undefined : String(body.category) as Category;
      if (category && !CATEGORIES.has(category)) return reply.code(400).send({ error: 'Unknown category' });
      const { rowCount } = await accounts.pool.query(
        `update contributed_places
            set name = coalesce($3, name), category = coalesce($4, category),
                note = coalesce($5, note), price_typical = coalesce($6, price_typical),
                updated_at = now()
          where id = $1 and created_by = $2 and status <> 'removed'`,
        [
          request.params.id, auth.user(request).id, name ?? null, category ?? null,
          body.note === undefined ? null : String(body.note).slice(0, 500),
          Number.isFinite(Number(body.price_typical)) ? Number(body.price_typical) : null,
        ],
      );
      if (!rowCount) return reply.code(404).send({ error: 'That place is not yours to edit' });
      return reply.code(204).send();
    },
  );

  app.get<{ Params: { id: string } }>('/api/places/:id', async ({ params }, reply) => {
    if (!accounts || !discover) return off(reply);
    const { rows } = await accounts.pool.query<ContributedRow>(
      `select p.*, u.display_name, u.avatar_url, g.rating, g.rating_count, g.attribution,
              j.status as build_stage
         from contributed_places p
         join users u on u.id = p.created_by
         left join place_google_cache g on g.google_place_id = p.google_place_id
         left join lateral (
           select status from jobs where jobs.capture_id = p.capture_id order by created_at desc limit 1
         ) j on true
        where p.id = $1 and p.status = 'published'`,
      [params.id],
    );
    if (!rows[0]) return reply.code(404).send({ error: 'Place not found' });
    return discover.fromContributed(rows[0]);
  });

  /**
   * Records a view or a 3D open. Anonymous by design: visitors have no account, so the only
   * identity here is a daily-rotating hash that exists to stop one person counting many times.
   */
  app.post<{ Body: { place_id?: unknown; kind?: unknown } }>(
    '/api/engagement', { bodyLimit: 2048 }, async (request, reply) => {
      if (!discover) return reply.code(204).send();
      if (!engagementLimit.take(request.ip)) return reply.code(429).send({ error: 'Too many events' });
      const placeId = String(request.body?.place_id ?? '');
      const kind = String(request.body?.kind ?? '') as EngagementKind;
      if (!placeId || (kind !== 'card_view' && kind !== 'splat_open')) {
        return reply.code(400).send({ error: 'place_id and a kind of card_view or splat_open are required' });
      }
      await discover.record(placeId, kind, sessionHash(request.ip, request.headers['user-agent']));
      return reply.code(204).send();
    },
  );

  app.get<{ Querystring: { since?: string } }>('/api/notifications', async (request, reply) => {
    if (!accounts || !discover) return off(reply);
    const user = await auth.optional(request);
    const { rows: fresh } = await accounts.pool.query<{
      id: string; name: string; category: Category; station_id: string | null; created_at: Date;
    }>(
      `select id, name, category, station_id, created_at from contributed_places
        where status = 'published' order by created_at desc limit 12`,
    );
    const scores = await discover.velocity('today');
    const names = new Map(fresh.map((row) => [row.id, row.name]));
    for (const place of store.all('places')) names.set(place.id, place.name);
    const popular = [...scores.entries()]
      .sort(([, a], [, b]) => b - a).slice(0, 6)
      .map(([place_id, score]) => ({ place_id, name: names.get(place_id) ?? 'A place', score }));

    // The unread count is "added since you last opened the bell". A signed-in person's marker is
    // stored; an anonymous visitor passes their own in `since`.
    let readAt: Date | undefined;
    if (user) {
      const { rows } = await accounts.pool.query<{ read_at: Date }>(
        'select read_at from notification_reads where user_id = $1', [user.id],
      );
      readAt = rows[0]?.read_at;
    } else if (request.query.since) {
      const parsed = new Date(request.query.since);
      if (!Number.isNaN(parsed.getTime())) readAt = parsed;
    }
    const feed: NotificationFeed = {
      new_places: fresh.map((row) => ({
        place_id: row.id, name: row.name, category: row.category,
        station_name: row.station_id ? (store.get('places', row.station_id)?.name ?? null) : null,
        created_at: row.created_at.toISOString(),
      })),
      popular_now: popular,
      now: new Date().toISOString(),
      unread: readAt ? fresh.filter((row) => row.created_at > readAt!).length : fresh.length,
    };
    reply.header('Cache-Control', 'no-store');
    return feed;
  });

  app.post('/api/notifications/read', async (request, reply) => {
    const user = await auth.optional(request);
    if (user && accounts) {
      await accounts.pool.query(
        `insert into notification_reads (user_id, read_at) values ($1, now())
         on conflict (user_id) do update set read_at = now()`,
        [user.id],
      );
    }
    return reply.code(204).send();
  });

  /**
   * Reports a place. Places publish immediately, so this is what bounds the time a bad entry can
   * stay up: once enough distinct visitors report one, it hides itself pending admin review.
   */
  app.post<{ Params: { id: string }; Body: { reason?: unknown; detail?: unknown } }>(
    '/api/places/:id/report', { bodyLimit: 2048 }, async (request, reply) => {
      if (!accounts) return off(reply);
      if (!reportLimit.take(request.ip)) return reply.code(429).send({ error: 'Too many reports from here' });
      const reason = String(request.body?.reason ?? '') as ReportReason;
      if (!REASONS.has(reason)) return reply.code(400).send({ error: 'Unknown reason' });
      const session = sessionHash(request.ip, request.headers['user-agent']);
      await accounts.pool.query(
        `insert into place_reports (place_id, reason, detail, session_hash) values ($1, $2, $3, $4)
         on conflict (place_id, session_hash) do nothing`,
        [request.params.id, reason, String(request.body?.detail ?? '').slice(0, 500) || null, session],
      );
      const { rows } = await accounts.pool.query<{ count: string }>(
        'select count(distinct session_hash) as count from place_reports where place_id = $1',
        [request.params.id],
      );
      const total = Number(rows[0]?.count ?? 0);
      if (total >= config.accounts!.reportsToHide) {
        await accounts.pool.query(
          "update contributed_places set status = 'hidden', updated_at = now() where id = $1 and status = 'published'",
          [request.params.id],
        );
      }
      return reply.code(202).send({ reports: total });
    },
  );

  app.get('/api/admin/reports', async (request, reply) => {
    if (!accounts) return off(reply);
    const { rows } = await accounts.pool.query(
      `select p.id, p.name, p.status, p.created_at,
              count(distinct r.session_hash) as reports,
              array_agg(distinct r.reason) as reasons
         from contributed_places p
         join place_reports r on r.place_id = p.id::text
        group by p.id order by count(distinct r.session_hash) desc limit 100`,
    );
    reply.header('Cache-Control', 'no-store');
    return rows;
  });

  /** Server-sent arrivals. Every open Discover page gets a toast when somebody adds a place. */
  app.get('/api/discover/events', async ({ raw }, reply) => {
    if (!events) return off(reply);
    reply.hijack();
    const stream = reply.raw;
    stream.writeHead(200, {
      ...reply.getHeaders() as Record<string, string>,
      'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive', 'x-accel-buffering': 'no',
    });
    const send = (event: string, data: object) => {
      if (!stream.writableEnded) stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const unsubscribe = events.subscribe((arrival) => send('arrival', arrival));
    const keepAlive = setInterval(() => {
      if (!stream.writableEnded) stream.write(': keep-alive\n\n');
    }, KEEP_ALIVE_MS);
    const end = () => {
      if (!streams.delete(end)) return;
      clearInterval(keepAlive);
      unsubscribe();
      stream.end();
    };
    streams.add(end);
    raw.on('close', end);
    // Carries the server's clock so a client that reconnects knows exactly what to ask for.
    send('ready', { now: new Date().toISOString() });
  });
}
