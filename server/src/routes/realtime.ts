import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import { sessionLimits } from '../services/requestLimits.ts';

export function registerRealtime(app: FastifyInstance, config: Pick<Config, 'openaiKey' | 'openaiBaseUrl'>, fetchSecret = fetch): void {
  const model = 'gpt-realtime';
  const limits = sessionLimits();
  app.post('/api/realtime/session', { bodyLimit: 4096 }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!config.openaiKey) return reply.code(503).send({ error: 'OPENAI_API_KEY is not configured' });

    const slot = limits.reserve(request.ip);
    if (!slot) return reply.code(429).send({ error: 'Too many Realtime sessions' });
    let started = false;
    try {
      const response = await fetchSecret(`${config.openaiBaseUrl}/realtime/client_secrets`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.openaiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ session: { type: 'realtime', model, audio: { output: { voice: 'ballad' } } } }),
        signal: AbortSignal.timeout(12_000),
        redirect: 'error',
      });
      if (response.ok) {
        const data = await response.json();
        const credentialLifetime = typeof data?.expires_at === 'number' ? data.expires_at * 1000 - Date.now() : NaN;
        if (typeof data?.value === 'string' && data.value.trim() && Number.isSafeInteger(data.expires_at) && credentialLifetime > 0) {
          slot.hold(Math.max(credentialLifetime, 15 * 60_000));
          started = true;
          return { client_secret: data.value, expires_at: data.expires_at, model };
        }
      }
    } catch {
      // Upstream errors may include sensitive request details.
    } finally {
      if (!started) slot.release();
    }
    return reply.code(502).send({ error: 'Could not start GPT Live' });
  });
}
