import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerRealtime } from '../dist/routes/realtime.js';

const url = '/api/realtime/session';
const openaiBaseUrl = 'https://api.openai.com/v1';
const realtimeModel = 'gpt-realtime';

test('Realtime sessions require server credentials', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerRealtime(app, { openaiBaseUrl, openaiKey: undefined }, () => assert.fail('unexpected network request'));
  const response = await app.inject({ method: 'POST', url });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: 'OPENAI_API_KEY is not configured' });
});

test('Realtime session minting returns only the ephemeral credential, expiration and model', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const mint = t.mock.fn(async () => Response.json({ value: 'mock-ephemeral', expires_at: 1_900_000_000, session: { id: 'mock-session' } }));
  registerRealtime(app, { openaiBaseUrl, openaiKey: 'mock-server-key' }, mint);
  const response = await app.inject({ method: 'POST', url });
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.deepEqual(response.json(), { client_secret: 'mock-ephemeral', expires_at: 1_900_000_000, model: realtimeModel });
  assert.equal(mint.mock.callCount(), 1);
  const [endpoint, init] = mint.mock.calls[0].arguments;
  assert.equal(endpoint, `${openaiBaseUrl}/realtime/client_secrets`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer mock-server-key');
  assert.deepEqual(JSON.parse(init.body), { session: { type: 'realtime', model: realtimeModel, audio: { output: { voice: 'ballad' } } } });
});

test('Realtime minting does not forward upstream error details', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  registerRealtime(app, { openaiBaseUrl, openaiKey: 'mock-server-key' }, async () =>
    Response.json({ error: 'private upstream detail' }, { status: 401 }));
  const response = await app.inject({ method: 'POST', url });
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: 'Could not start GPT Live' });
});

test('Realtime minting rejects malformed successful responses and releases failed slots', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const malformed = [
    null, [], { value: 42, expires_at: 1_900_000_000 }, { value: ' ', expires_at: 1_900_000_000 },
    { value: 'secret', expires_at: '1900000000' }, { value: 'secret', expires_at: 1 },
  ];
  let index = 0;
  const mint = t.mock.fn(async () => Response.json(malformed[index++ % malformed.length]));
  registerRealtime(app, { openaiBaseUrl, openaiKey: 'mock-server-key' }, mint);
  for (let i = 0; i < 18; i++) {
    const response = await app.inject({ method: 'POST', url });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.json(), { error: 'Could not start GPT Live' });
  }
  assert.equal(mint.mock.callCount(), 18);
});

test('OpenAI Live rejects malformed answer SDP and keeps upstream error details private', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const { registerLive } = await import('../dist/routes/live.js');
  registerLive(app, { all: () => [] }, { openaiBaseUrl, openaiKey: 'mock-server-key', openaiLiveVoice: 'ballad' });
  const upstream = t.mock.method(globalThis, 'fetch', async () => responses.shift());
  const responses = [
    Response.json({ transport: { sdp: 42 } }),
    Response.json({ sdp: 'something private' }),
    new Response('v=0'),
    Response.json({ error: { message: 'Invalid argument near web_search with private details' } }, { status: 400 }),
  ];
  for (let i = 0; i < 4; i++) {
    const response = await app.inject({ method: 'POST', url: '/api/live/sessions', payload: { sdp: 'v=0\nm=audio 9 RTP/AVP 0\n' } });
    assert.equal(response.statusCode, 502);
    assert.doesNotMatch(response.body, /private|mock-server-key/);
  }
  assert.equal(upstream.mock.callCount(), 4);
});

test('Realtime minting bounds active sessions per client', async (t) => {
  const app = Fastify();
  t.after(() => app.close());
  const mint = t.mock.fn(async () => Response.json({ value: 'mock-ephemeral', expires_at: Math.floor(Date.now() / 1000) + 60 }));
  registerRealtime(app, { openaiBaseUrl, openaiKey: 'mock-server-key' }, mint);
  const results = await Promise.all(Array.from({ length: 13 }, () => app.inject({ method: 'POST', url })));
  assert.equal(results.filter(({ statusCode }) => statusCode === 200).length, 12);
  assert.equal(results.filter(({ statusCode }) => statusCode === 429).length, 1);
  assert.equal(mint.mock.callCount(), 12);
  assert.equal((await app.inject({ method: 'POST', url, remoteAddress: '127.0.0.2' })).statusCode, 200);
});
