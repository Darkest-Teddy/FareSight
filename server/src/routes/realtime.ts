import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';

export function registerRealtime(app: FastifyInstance, config: Pick<Config, 'openaiKey' | 'openaiBaseUrl'>, fetchSecret = fetch): void {
  const model = 'gpt-realtime';
  app.post('/api/realtime/session', async (_request, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!config.openaiKey) return reply.code(503).send({ error: 'OPENAI_API_KEY is not configured' });

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
        if (typeof data?.value === 'string' && data.value && Number.isFinite(data.expires_at)) {
          return { client_secret: data.value, expires_at: data.expires_at, model };
        }
      }
    } catch {
      // Upstream errors may include sensitive request details.
    }
    return reply.code(502).send({ error: 'Could not start GPT Live' });
  });
}
