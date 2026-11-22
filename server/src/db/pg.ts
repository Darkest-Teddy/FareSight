import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { projectRoot } from '../config.ts';

const migrationsDir = resolve(projectRoot, 'server/migrations');
// Any constant works: it only has to be the same for every process that migrates this database.
const MIGRATION_LOCK = 4_711_001;

export function createPool(connectionString: string) {
  const pool = new pg.Pool({ connectionString, max: 5, keepAlive: true, connectionTimeoutMillis: 10_000 });
  // A hosted database closes idle connections now and then. Without a listener that error would stop the
  // whole process; the pool has already discarded the connection and opens a new one on the next query.
  pool.on('error', (error) => console.error('Postgres dropped an idle connection:', error.message));
  return pool;
}

/** Applies every pending `NNN_name.up.sql`, or with `down` reverts the most recent applied migration. */
export async function migrate(pool: pg.Pool, direction: 'up' | 'down' = 'up'): Promise<string[]> {
  const client = await pool.connect();
  const done: string[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const applied = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map(({ name }) => name));
    const names = readdirSync(migrationsDir).filter((file) => file.endsWith('.up.sql')).map((file) => file.slice(0, -7)).sort();
    const pending = direction === 'up' ? names.filter((name) => !applied.has(name))
      : names.filter((name) => applied.has(name)).slice(-1);
    for (const name of pending) {
      await client.query('begin');
      try {
        await client.query(readFileSync(resolve(migrationsDir, `${name}.${direction}.sql`), 'utf8'));
        await client.query(direction === 'up' ? 'insert into schema_migrations (name) values ($1)'
          : 'delete from schema_migrations where name = $1', [name]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
      done.push(name);
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
  return done;
}

/**
 * A dedicated connection that stays subscribed to NOTIFY channels and reconnects when it drops.
 * `onReconnect` lets the caller catch up on anything sent while the connection was down.
 */
export function listen(
  connectionString: string, channels: string[],
  onNotify: (channel: string, payload: string) => void,
  onError: (error: unknown) => void, onReconnect?: () => void,
) {
  let client: pg.Client | undefined;
  let closed = false;
  let timer: NodeJS.Timeout | undefined;
  let first = true;
  const retry = () => {
    if (closed || timer) return;
    timer = setTimeout(() => { timer = undefined; void connect(); }, 2000);
  };
  async function connect() {
    const next = new pg.Client({ connectionString });
    next.on('notification', ({ channel, payload }) => onNotify(channel, payload ?? ''));
    next.on('error', (error) => { onError(error); });
    next.on('end', () => { if (client === next) { client = undefined; retry(); } });
    try {
      await next.connect();
      for (const channel of channels) await next.query(`listen ${pg.escapeIdentifier(channel)}`);
      if (closed) return void next.end().catch(() => undefined);
      client = next;
      if (!first) onReconnect?.();
      first = false;
    } catch (error) {
      onError(error);
      next.end().catch(() => undefined);
      retry();
    }
  }
  const ready = connect();
  return {
    ready,
    async close() {
      closed = true;
      clearTimeout(timer);
      await ready;
      const current = client;
      client = undefined;
      await current?.end().catch(() => undefined);
    },
  };
}
