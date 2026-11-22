import type { AuthStatus } from '@faresight/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import {
  createHandoff, createSession, emailProblem, hashPassword, passwordProblem, publicUser,
  redeemHandoff, revokeSession, upsertGoogleUser, userForToken, verifyGoogleIdToken, verifyPassword,
} from '../services/accounts.ts';
import type { Accounts, UserRow } from '../services/accounts.ts';
import { ipRateLimit } from '../services/requestLimits.ts';

/**
 * The session token travels in `Authorization: Bearer`, not a cookie. The API is served from a
 * different origin than both front ends and CORS here is wide open, which a cookie could not
 * safely accompany. The browser keeps the token in localStorage; the Expo app keeps it in the
 * platform keychain through expo-secure-store.
 */
export function bearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (typeof header !== 'string') return undefined;
  const [scheme, token] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && token ? token : undefined;
}

export interface AuthGuards {
  /** Resolves the signed-in user, or undefined. Never rejects the request. */
  optional(request: FastifyRequest): Promise<UserRow | undefined>;
  /** Replies 401 and stops the request when nobody is signed in. */
  required(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  /** The user resolved by `required` on this request. */
  user(request: FastifyRequest): UserRow;
}

const USERS = new WeakMap<FastifyRequest, UserRow>();

export function createAuthGuards(accounts: Accounts | undefined): AuthGuards {
  return {
    async optional(request) {
      if (!accounts) return undefined;
      const cached = USERS.get(request);
      if (cached) return cached;
      const user = await userForToken(accounts, bearerToken(request));
      if (user) USERS.set(request, user);
      return user;
    },
    async required(request, reply) {
      if (!accounts) {
        return reply.code(503).send({ error: 'Accounts are unavailable: the server has no DATABASE_URL' });
      }
      const user = await userForToken(accounts, bearerToken(request));
      if (!user) return reply.code(401).send({ error: 'Sign in to continue' });
      USERS.set(request, user);
    },
    user(request) {
      const user = USERS.get(request);
      if (!user) throw new Error('auth.user() called on a request that did not pass auth.required');
      return user;
    },
  };
}

interface Credentials { email?: unknown; password?: unknown; display_name?: unknown }

export function registerAuth(app: FastifyInstance, config: Config, accounts: Accounts | undefined, auth: AuthGuards) {
  // Per-IP, and separately per-email, so neither a single address nor a single account can be
  // attacked quickly. Registration is limited too, so one host cannot fill the table.
  const byIp = ipRateLimit(20, 60_000);
  const byEmail = ipRateLimit(8, 60_000);
  const registrations = ipRateLimit(config.accounts?.registrationsPerHour ?? 5, 60 * 60_000);

  const unavailable = (reply: FastifyReply) =>
    reply.code(503).send({ error: 'Accounts are unavailable: the server has no DATABASE_URL' });

  app.get('/api/auth/status', async (request): Promise<AuthStatus> => {
    const user = await auth.optional(request);
    return {
      user: user ? publicUser(user) : null,
      google_client_id: config.accounts?.googleClientId ?? null,
      enabled: Boolean(accounts),
    };
  });

  app.post<{ Body: Credentials }>('/api/auth/register', { bodyLimit: 4096 }, async (request, reply) => {
    if (!accounts) return unavailable(reply);
    if (!byIp.take(request.ip) || !registrations.take(request.ip)) {
      return reply.code(429).send({ error: 'Too many attempts. Wait a minute and try again.' });
    }
    const email = String(request.body?.email ?? '').trim();
    const password = String(request.body?.password ?? '');
    const displayName = String(request.body?.display_name ?? '').trim() || email.split('@')[0];
    const problem = emailProblem(email) ?? passwordProblem(password);
    if (problem) return reply.code(400).send({ error: problem });
    if (displayName.length > 80) return reply.code(400).send({ error: 'Display name must be 80 characters or fewer' });

    const passwordHash = await hashPassword(password);
    try {
      const { rows } = await accounts.pool.query<UserRow>(
        'insert into users (email, password_hash, display_name) values ($1, $2, $3) returning *',
        [email, passwordHash, displayName],
      );
      const { token, expiresAt } = await createSession(accounts, rows[0].id, request.headers['user-agent']);
      return reply.code(201).send({ user: publicUser(rows[0]), token, expires_at: expiresAt.toISOString() });
    } catch (error) {
      // 23505 is a unique-constraint violation, which here can only be the email index.
      if ((error as { code?: string }).code === '23505') {
        return reply.code(409).send({ error: 'An account already exists for that email address' });
      }
      throw error;
    }
  });

  app.post<{ Body: Credentials }>('/api/auth/login', { bodyLimit: 4096 }, async (request, reply) => {
    if (!accounts) return unavailable(reply);
    const email = String(request.body?.email ?? '').trim();
    const password = String(request.body?.password ?? '');
    if (!byIp.take(request.ip) || !byEmail.take(email.toLowerCase())) {
      return reply.code(429).send({ error: 'Too many attempts. Wait a minute and try again.' });
    }
    const { rows } = await accounts.pool.query<UserRow>(
      "select * from users where lower(email) = lower($1) and status = 'active'", [email],
    );
    const user = rows[0];
    // Hash even when the account does not exist, so the reply takes the same time either way and
    // does not reveal which addresses are registered.
    const ok = await verifyPassword(password, user?.password_hash ?? null);
    if (!user || !ok) {
      if (user && !user.password_hash) {
        return reply.code(401).send({ error: 'That account signs in with Google' });
      }
      return reply.code(401).send({ error: 'That email address and password do not match' });
    }
    const { token, expiresAt } = await createSession(accounts, user.id, request.headers['user-agent']);
    return { user: publicUser(user), token, expires_at: expiresAt.toISOString() };
  });

  app.post<{ Body: { id_token?: unknown } }>('/api/auth/google', { bodyLimit: 8192 }, async (request, reply) => {
    if (!accounts) return unavailable(reply);
    if (!byIp.take(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Wait a minute and try again.' });
    const idToken = String(request.body?.id_token ?? '');
    if (!idToken) return reply.code(400).send({ error: 'id_token is required' });
    const claims = await verifyGoogleIdToken(accounts, idToken);
    if ('error' in claims) return reply.code(401).send({ error: claims.error });
    const user = await upsertGoogleUser(accounts, claims);
    const { token, expiresAt } = await createSession(accounts, user.id, request.headers['user-agent']);
    return { user: publicUser(user), token, expires_at: expiresAt.toISOString() };
  });

  app.post('/api/auth/logout', async (request, reply) => {
    if (accounts) await revokeSession(accounts, bearerToken(request));
    return reply.code(204).send();
  });

  app.get('/api/auth/me', { onRequest: auth.required }, async (request) => ({ user: publicUser(auth.user(request)) }));

  /**
   * The Expo app signs in natively, then mints a handoff token and passes it into the WebView. The
   * web app exchanges it here for its own session. The handoff token lasts 60 seconds and works
   * once, so the long-lived token never enters the WebView.
   */
  app.post('/api/auth/handoff', { onRequest: auth.required }, async (request) => {
    const token = await createHandoff(accounts!, auth.user(request).id);
    return { handoff_token: token, expires_in: 60 };
  });

  app.post<{ Body: { handoff_token?: unknown } }>('/api/auth/exchange', { bodyLimit: 4096 }, async (request, reply) => {
    if (!accounts) return unavailable(reply);
    if (!byIp.take(request.ip)) return reply.code(429).send({ error: 'Too many attempts. Wait a minute and try again.' });
    const handoff = String(request.body?.handoff_token ?? '');
    if (!handoff) return reply.code(400).send({ error: 'handoff_token is required' });
    const userId = await redeemHandoff(accounts, handoff);
    if (!userId) return reply.code(401).send({ error: 'That sign-in link has already been used or has expired' });
    const { rows } = await accounts.pool.query<UserRow>("select * from users where id = $1 and status = 'active'", [userId]);
    if (!rows[0]) return reply.code(401).send({ error: 'That account is no longer active' });
    const { token, expiresAt } = await createSession(accounts, userId, request.headers['user-agent']);
    return { user: publicUser(rows[0]), token, expires_at: expiresAt.toISOString() };
  });
}
