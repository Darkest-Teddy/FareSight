import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createApp } from '../dist/app.js';
import { getConfig } from '../dist/config.js';

test('the catalog seeds labeled reviews once and preserves moderated diner submissions', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'faresight-reviews-'));
  const config = { ...getConfig(), database: join(dir, 'catalog.db'), uploads: join(dir, 'uploads'),
    outputs: join(dir, 'outputs'), adminPasscode: 'test-passcode' };
  let app = await createApp(config, { worker: false });
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const placeUrl = '/api/restaurants/bu-ramen-01';
  const catalog = (await app.inject('/api/restaurants')).json();
  assert.equal(catalog.length, 30);
  assert.ok(catalog.every(({ reviews }) => reviews.length === 2 && reviews.every(({ sample }) => sample === true)));
  const seeded = (await app.inject(placeUrl)).json().reviews;
  const submit = await app.inject({ method: 'POST', url: `${placeUrl}/reviews`,
    payload: { author_label: 'Taylor B.', text: 'The counter was practical for a quick lunch between lectures.' } });
  assert.equal(submit.statusCode, 201);
  const { id } = submit.json();
  assert.deepEqual((await app.inject(placeUrl)).json().reviews, seeded);
  const moderation = (action) => app.inject({ method: 'POST', url: '/api/admin/moderation',
    headers: { 'x-admin-passcode': 'test-passcode' }, payload: { type: 'review', id, action } });
  assert.equal((await moderation('approve')).statusCode, 200);
  await app.close();
  app = await createApp(config, { worker: false });
  const reviews = (await app.inject(placeUrl)).json().reviews;
  assert.equal(reviews.length, 3);
  assert.deepEqual(reviews.filter(({ sample }) => sample), seeded);
  assert.equal(reviews.find((review) => review.id === id)?.author, 'Taylor B.');
  assert.equal((await moderation('reject')).statusCode, 200);
  assert.deepEqual((await app.inject(placeUrl)).json().reviews, seeded);
});
