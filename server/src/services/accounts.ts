import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { AuthUser } from '@faresight/shared';
import type pg from 'pg';
import type { AccountsConfig, Config } from '../config.ts';
import { createPool, migrate } from '../db/pg.ts';

const scrypt = promisify(scryptCallback) as (
  password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// Argon2id would be the better choice, but it needs a native module. scrypt is built into Node and
// at these parameters costs roughly 100 ms per hash, which is the point: it makes guessing slow.
const SCRYPT = { N: 1 << 16, r: 8, p: 1, maxmem: 160 * 1024 * 1024 };
const HANDOFF_SECONDS = 60;

export interface UserRow {
  id: string;
  email: string;
  password_hash: string | null;
  display_name: string;
  avatar_url: string | null;
  google_sub: string | null;
  status: 'active' | 'suspended' | 'deleted';
  created_at: Date;
}

export interface Accounts {
  settings: AccountsConfig;
  pool: pg.Pool;
  close(): Promise<void>;
}

/** Opens the Postgres pool that accounts and Discover share, and brings the schema up to date. */
export async function openAccounts(config: Config): Promise<Accounts | undefined> {
  const settings = config.accounts;
  if (!settings) return undefined;
  // Migrations take a session-level advisory lock, so they go over the direct connection.
  const direct = createPool(settings.databaseUrlDirect);
  try {
    await migrate(direct);
  } finally {
    await direct.end();
  }
  const pool = createPool(settings.databaseUrl);
  return { settings, pool, close: () => pool.end() };
}

export function publicUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    avatar_url: row.avatar_url,
    google_only: !row.password_hash,
    created_at: row.created_at.toISOString(),
  };
}

// --- Passwords ---------------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 32, SCRYPT);
  // The parameters travel with the hash so they can be raised later without invalidating old ones.
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, n, r, p, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt') return false;
  const salt = Buffer.from(saltB64, 'base64');
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, salt, expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem,
  }).catch(() => undefined);
  return Boolean(actual && actual.length === expected.length && timingSafeEqual(actual, expected));
}

/**
 * Rejects passwords that are short or obviously guessable. There are no composition rules, because
 * they push people towards predictable shapes like "Password1!" without adding real strength.
 */
const COMMON = new Set([
  'password1234', 'passwordpassword', '123456789012', 'qwertyuiop12', 'iloveyou1234',
  'letmein12345', 'administrator', 'welcome12345', 'faresight123', 'bostonhacks1',
]);

export function passwordProblem(password: string): string | undefined {
  if (password.length < 12) return 'Password must be at least 12 characters';
  if (password.length > 200) return 'Password must be 200 characters or fewer';
  if (COMMON.has(password.toLowerCase())) return 'That password is too easy to guess';
  return undefined;
}

export function emailProblem(email: string): string | undefined {
  if (email.length > 320) return 'Email address is too long';
  // Deliberately permissive: the only authority on whether an address works is sending to it.
  if (!/^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(email)) return 'Enter a valid email address';
  return undefined;
}

// --- Tokens and sessions -----------------------------------------------------------------------

const digest = (token: string) => createHash('sha256').update(token).digest();
const newToken = () => randomBytes(32).toString('base64url');

/**
 * Creates a session and returns the bearer token. Only the SHA-256 digest is stored, so reading the
 * database does not yield a usable session.
 */
export async function createSession(
  accounts: Accounts, userId: string, userAgent: string | undefined,
): Promise<{ token: string; expiresAt: Date }> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + accounts.settings.sessionDays * 86_400_000);
  await accounts.pool.query(
    'insert into sessions (user_id, token_hash, user_agent, expires_at) values ($1, $2, $3, $4)',
    [userId, digest(token), userAgent?.slice(0, 400) ?? null, expiresAt],
  );
  return { token, expiresAt };
}

/** Returns the signed-in user for a token, or undefined. Expired and revoked sessions do not match. */
export async function userForToken(accounts: Accounts, token: string | undefined): Promise<UserRow | undefined> {
  if (!token) return undefined;
  const { rows } = await accounts.pool.query<UserRow>(
    `select u.* from sessions s
       join users u on u.id = s.user_id
      where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.status = 'active'`,
    [digest(token)],
  );
  return rows[0];
}

export async function revokeSession(accounts: Accounts, token: string | undefined): Promise<void> {
  if (!token) return;
  await accounts.pool.query('update sessions set revoked_at = now() where token_hash = $1', [digest(token)]);
}

/**
 * Mints a one-minute, single-use token so the Expo app can hand its native sign-in to the WebView
 * without the long-lived session token ever entering the WebView.
 */
export async function createHandoff(accounts: Accounts, userId: string): Promise<string> {
  const token = newToken();
  await accounts.pool.query(
    'insert into auth_handoffs (user_id, token_hash, expires_at) values ($1, $2, now() + make_interval(secs => $3))',
    [userId, digest(token), HANDOFF_SECONDS],
  );
  return token;
}

/** Redeems a handoff token. The update is conditional, so a replay finds nothing and returns undefined. */
export async function redeemHandoff(accounts: Accounts, token: string): Promise<string | undefined> {
  const { rows } = await accounts.pool.query<{ user_id: string }>(
    `update auth_handoffs set used_at = now()
      where token_hash = $1 and used_at is null and expires_at > now()
      returning user_id`,
    [digest(token)],
  );
  return rows[0]?.user_id;
}

// --- Google ------------------------------------------------------------------------------------

interface GoogleTokenInfo {
  sub: string; email?: string; email_verified?: string | boolean;
  name?: string; picture?: string; aud: string;
}

/**
 * Verifies a Google ID token and returns its claims.
 *
 * This calls Google's tokeninfo endpoint rather than validating the JWT signature locally. That is
 * one network round trip per sign-in, which is the right trade for a demo: it needs no JWKS cache
 * and no key-rotation handling. A high-traffic deployment should verify locally instead.
 */
export async function verifyGoogleIdToken(
  accounts: Accounts, idToken: string,
): Promise<{ sub: string; email: string; name: string; picture: string | null } | { error: string }> {
  const audiences = accounts.settings.googleAudiences;
  if (!audiences.length) return { error: 'Google sign-in is not configured on this server' };
  let info: GoogleTokenInfo;
  try {
    const response = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return { error: 'Google rejected that sign-in' };
    info = await response.json() as GoogleTokenInfo;
  } catch {
    return { error: 'Could not reach Google to verify that sign-in' };
  }
  // Without the audience check any Google token for any app would be accepted here.
  if (!audiences.includes(info.aud)) return { error: 'That sign-in was issued for a different app' };
  if (!info.email) return { error: 'That Google account has no email address' };
  if (info.email_verified !== true && info.email_verified !== 'true') {
    return { error: 'That Google account has an unverified email address' };
  }
  return {
    sub: info.sub,
    email: info.email,
    name: info.name?.trim() || info.email.split('@')[0],
    picture: info.picture ?? null,
  };
}

/**
 * Finds or creates the account behind a verified Google identity.
 *
 * Matching on email as well as `google_sub` is what lets someone who registered with a password
 * later sign in with Google and land in the same account instead of a duplicate.
 */
export async function upsertGoogleUser(
  accounts: Accounts, claims: { sub: string; email: string; name: string; picture: string | null },
): Promise<UserRow> {
  const { rows: bySub } = await accounts.pool.query<UserRow>(
    'select * from users where google_sub = $1', [claims.sub],
  );
  if (bySub[0]) {
    const { rows } = await accounts.pool.query<UserRow>(
      'update users set avatar_url = $2, updated_at = now() where id = $1 returning *',
      [bySub[0].id, claims.picture],
    );
    return rows[0];
  }
  const { rows: byEmail } = await accounts.pool.query<UserRow>(
    'select * from users where lower(email) = lower($1)', [claims.email],
  );
  if (byEmail[0]) {
    const { rows } = await accounts.pool.query<UserRow>(
      `update users set google_sub = $2, avatar_url = coalesce($3, avatar_url), updated_at = now()
        where id = $1 returning *`,
      [byEmail[0].id, claims.sub, claims.picture],
    );
    return rows[0];
  }
  const { rows } = await accounts.pool.query<UserRow>(
    `insert into users (email, display_name, avatar_url, google_sub)
     values ($1, $2, $3, $4) returning *`,
    [claims.email, claims.name, claims.picture, claims.sub],
  );
  return rows[0];
}

// --- Anonymous visitors ------------------------------------------------------------------------

let saltDay = '';
let salt = randomBytes(32);

/**
 * Identifies an anonymous visitor well enough to deduplicate engagement, without storing an IP
 * address. The salt is replaced each day, so yesterday's hashes cannot be matched to today's and
 * the value cannot be used to follow someone over time.
 */
export function sessionHash(ip: string, userAgent: string | undefined): Buffer {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== saltDay) {
    saltDay = today;
    salt = randomBytes(32);
  }
  return createHash('sha256').update(salt).update(ip).update(userAgent ?? '').digest();
}
