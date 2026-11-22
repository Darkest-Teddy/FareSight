import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { registerRealtime } from '../dist/routes/realtime.js';

const url = '/api/realtime/session';
const openaiBaseUrl = 'https://api.openai.com/v1';

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
  assert.deepEqual(response.json(), { client_secret: 'mock-ephemeral', expires_at: 1_900_000_000, model: 'gpt-realtime' });
  assert.equal(mint.mock.callCount(), 1);
  const [endpoint, init] = mint.mock.calls[0].arguments;
  assert.equal(endpoint, `${openaiBaseUrl}/realtime/client_secrets`);
  assert.equal(init.method, 'POST');
  assert.equal(init.headers.Authorization, 'Bearer mock-server-key');
  assert.deepEqual(JSON.parse(init.body), { session: { type: 'realtime', model: 'gpt-realtime', audio: { output: { voice: 'ash' } } } });
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
