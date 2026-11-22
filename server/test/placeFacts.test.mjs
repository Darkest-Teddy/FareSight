import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../dist/app.js';
import { getConfig } from '../dist/config.js';

test('researched hours and details reach the catalog and refresh stale stored places', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'faresight-facts-'));
  const config = { ...getConfig(), database: join(dir, 'catalog.db'), uploads: join(dir, 'uploads'),
    outputs: join(dir, 'outputs'), adminPasscode: 'test-passcode' };
  let app;
  t.after(async () => {
    try { await app?.close(); } finally { await rm(dir, { recursive: true, force: true }); }
  });
  app = await createApp(config, { worker: false });

  const art = (await app.inject('/api/restaurants/harvard-art-01')).json();
  assert.equal(art.hours.mon, undefined);
  assert.deepEqual(art.hours.tue, ['10:00', '17:00']);
  assert.equal(art.details.hours_verified, true);
  assert.ok(art.details.ratings.length > 0 && art.details.review_highlights.length > 0);
  assert.equal((await app.inject('/api/restaurants/harvard-cafe-01')).json().details, undefined);

  // Simulate a database written before facts existed: drop details and restore old uniform hours.
  await app.close();
  const sqlite = new DatabaseSync(config.database);
  try {
    const row = sqlite.prepare('SELECT data FROM places WHERE id = ?').get('chinatown-taiwan-01');
    const stale = { ...JSON.parse(String(row.data)), hours: { mon: ['11:30', '22:00'] }, room_asset_id: 'kept-asset' };
    delete stale.details;
    sqlite.prepare('UPDATE places SET data = ? WHERE id = ?').run(JSON.stringify(stale), 'chinatown-taiwan-01');
  } finally {
    sqlite.close();
  }

  app = await createApp(config, { worker: false });
  const taiwan = (await app.inject('/api/restaurants/chinatown-taiwan-01')).json();
  assert.deepEqual(taiwan.hours.fri, ['11:00', '01:00']);
  assert.ok(taiwan.details.awards.some(({ org }) => org === 'Boston Magazine'));
  assert.equal(taiwan.room_asset_id, 'kept-asset');
});
