import { randomInt } from 'node:crypto';
import type { PairingMessage } from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

const lifetime = 30 * 60_000;
const peerLimit = 2;

interface Session { sockets: Set<WebSocket>; expires: number }

function relay(data: unknown): PairingMessage | undefined {
  if (!data || typeof data !== 'object' || !('type' in data)) return undefined;
  const id = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 160;
  switch (data.type) {
    case 'open_place':
      if ('place_id' in data && id(data.place_id)) return data as PairingMessage;
      break;
    case 'open_dish':
      if ('place_id' in data && 'dish_id' in data && id(data.place_id) && id(data.dish_id)) return data as PairingMessage;
      break;
    case 'send_trip':
      if ('trip' in data && data.trip && typeof data.trip === 'object' && !Array.isArray(data.trip)) return data as PairingMessage;
      break;
    case 'sync_filters':
      if ('filters' in data && data.filters && typeof data.filters === 'object' && !Array.isArray(data.filters)) return data as PairingMessage;
      break;
  }
  return undefined;
}

function send(socket: WebSocket, message: PairingMessage) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

export function registerPairing(app: FastifyInstance) {
  const sessions = new Map<string, Session>();

  app.post('/api/pairing/create', async (_request, reply) => {
    const now = Date.now();
    for (const [code, session] of sessions) {
      if (!session.sockets.size && session.expires <= now) sessions.delete(code);
    }
    if (sessions.size >= 4096) return reply.code(503).send({ error: 'Pairing capacity reached' });
    let code: string;
    do code = String(randomInt(10000)).padStart(4, '0');
    while (sessions.has(code));
    sessions.set(code, { sockets: new Set(), expires: now + lifetime });
    return reply.code(201).send({ code });
  });

  app.get<{ Params: { code: string } }>('/ws/pair/:code', { websocket: true }, (socket, request) => {
    const session = sessions.get(request.params.code);
    if (!session || (!session.sockets.size && session.expires <= Date.now()) || session.sockets.size >= peerLimit) {
      socket.close(1008, 'Pairing code expired, invalid or in use');
      return;
    }
    session.sockets.add(socket);
    session.expires = Date.now() + lifetime;
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
      for (const peer of session.sockets) if (peer !== socket) send(peer, message);
    });

    for (const peer of session.sockets) send(peer, { type: 'peer_joined', peers: session.sockets.size });
  });
}
