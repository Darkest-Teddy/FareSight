import { randomInt } from 'node:crypto';
import type { PairingMessage } from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { ipRateLimit } from '../services/requestLimits.ts';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codePattern = /^[A-HJ-NP-Z2-9]{6}$/;
const lifetime = 30 * 60_000;
const maxBuffered = 64 * 1024;
const categories = ['restaurant', 'study', 'music', 'activity', 'shop', 'market', 'outdoor', 'museum', 'event_space', 'hotel', 'stadium'];

interface Session { sockets: Map<WebSocket, boolean>; expires: number }

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 160;
const nonnegative = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const tripNumbers = [
  'transfers', 'walk_to_station_min', 'wait_min', 'ride_min', 'transfer_min', 'walk_to_venue_min',
  'total_min', 'fare', 'round_trip_fare',
];
const tripKeys = new Set([
  ...tripNumbers, 'from_stop_id', 'to_stop_id', 'route_id', 'transfer_station',
  'planner_url', 'prediction_source', 'last_train_time', 'schedule_source',
]);
const filterChecks: Record<string, (value: unknown) => boolean> = {
  categories: (value) => Array.isArray(value) && value.length <= categories.length && value.every((entry) => categories.includes(entry)),
  category_groups: (value) => Array.isArray(value) && value.length <= 4 && value.every((entry) => ['A', 'B', 'C', 'D'].includes(entry)),
  cravings: (value) => Array.isArray(value) && value.length <= 30 && value.every(id),
  max_price: (value) => value === null || nonnegative(value),
  max_trip_min: (value) => value === null || nonnegative(value),
  family_friendly: (value) => typeof value === 'boolean',
  evening_only: (value) => typeof value === 'boolean',
  stop_id: (value) => value === null || id(value),
};

function plannerUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return;
  const url = URL.parse(value);
  if (url?.protocol === 'https:' && (url.hostname === 'mbta.com' || url.hostname === 'www.mbta.com')
    && !url.username && !url.password && !url.port) return url.href;
}

function relay(data: unknown): PairingMessage | undefined {
  if (!record(data)) return;
  switch (data.type) {
    case 'open_place':
      if (id(data.place_id)) return { type: data.type, place_id: data.place_id as string };
      break;
    case 'open_dish':
      if (id(data.place_id) && id(data.dish_id)) return { type: data.type, place_id: data.place_id as string, dish_id: data.dish_id as string };
      break;
    case 'send_trip': {
      const trip = data.trip;
      if (!record(trip) || Object.keys(trip).some((key) => !tripKeys.has(key))
        || !id(trip.from_stop_id) || !id(trip.to_stop_id)
        || !(trip.route_id === null || id(trip.route_id)) || !(trip.transfer_station === null || id(trip.transfer_station))
        || !tripNumbers.every((key) => nonnegative(trip[key])) || !Number.isSafeInteger(trip.transfers)
        || (trip.prediction_source !== undefined && !['live', 'simulated', 'estimate'].includes(trip.prediction_source as string))
        || (trip.schedule_source !== undefined && !['live', 'simulated'].includes(trip.schedule_source as string))
        || (trip.last_train_time != null && !(typeof trip.last_train_time === 'string' && Number.isFinite(Date.parse(trip.last_train_time))))) return;
      const { planner_url, ...fields } = trip;
      const url = plannerUrl(planner_url);
      return { type: data.type, trip: { ...fields, ...(url ? { planner_url: url } : {}) } } as PairingMessage;
    }
    case 'sync_filters':
      if (record(data.filters) && Object.entries(data.filters).every(([key, value]) =>
        Object.hasOwn(filterChecks, key) && filterChecks[key](value))) return { type: data.type, filters: data.filters };
      break;
  }
}

function send(socket: WebSocket, message: PairingMessage) {
  if (socket.readyState !== socket.OPEN) return;
  const payload = JSON.stringify(message);
  if (socket.bufferedAmount + Buffer.byteLength(payload) > maxBuffered) socket.terminate();
  else socket.send(payload);
}

export function registerPairing(app: FastifyInstance) {
  const sessions = new Map<string, Session>();
  const creations = ipRateLimit(20, 60_000);
  const failures = ipRateLimit(12, 60_000);

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [code, session] of sessions) {
      if (!session.sockets.size && session.expires <= now) sessions.delete(code);
      for (const [peer, alive] of session.sockets) {
        if (!alive || peer.readyState !== peer.OPEN || peer.bufferedAmount > maxBuffered) peer.terminate();
        else {
          session.sockets.set(peer, false);
          peer.ping();
        }
      }
    }
  }, 15_000).unref();
  app.addHook('preClose', async () => {
    clearInterval(sweep);
    for (const { sockets } of sessions.values()) for (const peer of sockets.keys()) peer.terminate();
    sessions.clear();
  });

  app.post('/api/pairing/create', async ({ ip }, reply) => {
    if (!creations.take(ip)) return reply.code(429).send({ error: 'Too many pairing codes requested' });
    if (sessions.size >= 4096) return reply.code(503).send({ error: 'Pairing capacity reached' });
    let code: string;
    do code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join('');
    while (sessions.has(code));
    sessions.set(code, { sockets: new Map(), expires: Date.now() + lifetime });
    return reply.code(201).send({ code });
  });

  app.get<{ Params: { code: string } }>('/ws/pair/:code', {
    websocket: true,
    onRequest: async ({ ip }, reply) => {
      if (failures.blocked(ip)) return reply.code(429).send({ error: 'Too many failed pairing attempts' });
    },
  }, (socket, request) => {
    const { code } = request.params;
    const session = codePattern.test(code) ? sessions.get(code) : undefined;
    if (!session || (!session.sockets.size && session.expires <= Date.now()) || session.sockets.size >= 2) {
      failures.record(request.ip);
      socket.close(1008, 'Pairing code expired, invalid or in use');
      return;
    }
    session.sockets.set(socket, true);
    socket.on('pong', () => { if (session.sockets.has(socket)) session.sockets.set(socket, true); });
    socket.on('close', () => {
      session.sockets.delete(socket);
      if (!session.sockets.size) session.expires = Date.now() + lifetime;
    });
    socket.on('error', () => socket.terminate());
    socket.on('message', (raw, binary) => {
      if (binary) return;
      let message: PairingMessage | undefined;
      try {
        message = relay(JSON.parse(raw.toString()));
      } catch {
        return;
      }
      if (!message) return;
      for (const peer of session.sockets.keys()) if (peer !== socket) send(peer, message);
    });

    for (const peer of session.sockets.keys()) send(peer, { type: 'peer_joined', peers: session.sockets.size });
  });
}
