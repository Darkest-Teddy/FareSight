// pnpm --filter @faresight/server migrate [up|down]
import { getConfig } from '../config.ts';
import { createPool, migrate } from '../db/pg.ts';

const direction = process.argv[2] ?? 'up';
const { captures } = getConfig();
if (direction !== 'up' && direction !== 'down') throw new Error('Usage: migrate [up|down]');
if (!captures) throw new Error('Set DATABASE_URL and the VULTR_S3_* variables first (see .env.example).');
const pool = createPool(captures.databaseUrlDirect);
try {
  const names = await migrate(pool, direction);
  console.log(names.length ? `${direction === 'up' ? 'Applied' : 'Reverted'}: ${names.join(', ')}` : 'Nothing to do.');
} finally {
  await pool.end();
}
