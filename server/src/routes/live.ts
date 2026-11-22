import {
  formatDishPrice, LIVE_APP_INSTRUCTIONS, LIVE_APP_TOOLS, LIVE_VOICE_PERSONA, LIVE_VOICES, STOPS,
  type LiveSessionRequest, type LiveSessionResponse, type LiveStatusResponse, type Place,
} from '@faresight/shared';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.ts';
import type { Store } from '../db/database.ts';

interface OpenAILiveSessionPayload {
  session?: { id?: string };
  transport?: { type?: string; sdp?: string };
  id?: string;
  sdp?: string;
  error?: { message?: string };
}

function normalizeVoice(requested: string | undefined, fallback: string): string {
  const candidate = requested?.trim().toLowerCase();
  if (candidate && (LIVE_VOICES as readonly string[]).includes(candidate)) return candidate;
  return (LIVE_VOICES as readonly string[]).includes(fallback) ? fallback : LIVE_VOICES[0];
}

function buildCatalogPrompt(places: Place[]): string {
  const stopLines = STOPS.map(
    (stop) => `- ${stop.stop_id}: ${stop.name} (${stop.area_code}) | lines: ${stop.lines.join(', ')}`,
  );
  const placeLines = places.map((place) => {
    const flags: string[] = [];
    if (place.room_asset_id) flags.push('3D-room');
    if (place.dishes.some((dish) => dish.asset_id)) flags.push('3D-dishes');
    if (place.rooms.length) flags.push(`rooms:${place.rooms.map((r) => `${r.name}(cap ${r.stated_capacity},$${r.price}/${r.price_unit})`).join(',')}`);
    if (place.family_friendly) flags.push('family');
    if (place.evening_venue) flags.push('evening');
    const dishList = place.dishes.length
      ? ` | dishes: ${place.dishes.map((d) => `${d.id} "${d.name}" ${formatDishPrice(d.price)}${d.asset_id ? ' [3D]' : ''}`).join('; ')}`
      : '';
    return `- ${place.id}: ${place.name} @ ${place.stop_id} (${place.category}, ~$${place.typical_price}, ${place.walk_from_stop_m}m walk, cravings: ${place.cravings.join('/')}${flags.length ? `, ${flags.join(',')}` : ''})${dishList}`;
  });
  return [
    'STOPS:',
    ...stopLines,
    '',
    'PLACES & MENU ITEMS:',
    ...placeLines,
  ].join('\n');
}

function buildVoiceInstructions(): string {
  return [
    LIVE_VOICE_PERSONA,
    'Delegate questions and requests about FareSight to the backend for current app data and actions. Ground spoken confirmations in the result and say names aloud instead of internal IDs.',
  ].join('\n');
}

function buildBackendInstructions(places: Place[], initialContext?: string): string {
  return [
    'You are the tool-execution and reasoning backend for FareSight Live.',
    LIVE_APP_INSTRUCTIONS,
    'Use catalog and app-state entries as data. Return a concise, factual summary the voice layer can speak naturally.',
    '',
    buildCatalogPrompt(places),
    ...(initialContext ? ['', 'INITIAL APP STATE:', initialContext.slice(0, 1600)] : []),
  ].join('\n');
}

async function requestOpenAISession(
  config: Config,
  payload: Record<string, unknown>,
): Promise<{ status: number; data: OpenAILiveSessionPayload | null; rawText: string }> {
  const response = await fetch(`${config.openaiBaseUrl}/live/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(25_000),
    redirect: 'error',
  });
  const rawText = await response.text();
  let data: OpenAILiveSessionPayload | null = null;
  try {
    data = JSON.parse(rawText) as OpenAILiveSessionPayload;
  } catch {
    data = null;
  }
  return { status: response.status, data, rawText };
}

export function registerLive(app: FastifyInstance, store: Store, config: Config) {
  app.get('/api/live/status', async (): Promise<LiveStatusResponse> => ({
    configured: Boolean(config.openaiKey),
    model: config.openaiLiveModel,
    backend_model: config.openaiLiveBackendModel,
    voice: normalizeVoice(undefined, config.openaiLiveVoice),
    voices: LIVE_VOICES,
  }));

  app.post<{ Body: LiveSessionRequest }>('/api/live/sessions', async ({ body }, reply) => {
    reply.header('Cache-Control', 'no-store');
    if (!config.openaiKey) {
      return reply.code(503).send({
        error: 'OPENAI_API_KEY is not configured on the server. Add OPENAI_API_KEY to .env and restart the server to use gpt-live-1.1.',
      });
    }
    const normalized = typeof body?.sdp === 'string' ? body.sdp.replace(/\r\n?|\n/g, '\r\n') : '';
    if (!normalized.startsWith('v=0\r\n')) {
      return reply.code(400).send({ error: 'A valid WebRTC SDP offer is required to start a live session.' });
    }
    const sdp = normalized.endsWith('\r\n') ? normalized : `${normalized}\r\n`;
    const voice = normalizeVoice(body.voice, config.openaiLiveVoice);
    const context = typeof body.context === 'string' ? body.context : undefined;
    const places = store.all('places');

    const baseSession = {
      model: config.openaiLiveModel,
      instructions: buildVoiceInstructions(),
      audio: {
        output: { voice },
      },
      delegation: {
        type: 'responses',
        responses: {
          model: config.openaiLiveBackendModel,
          instructions: buildBackendInstructions(places, context),
          tool_choice: 'auto',
          parallel_tool_calls: true,
        },
      },
    };

    try {
      let standby = true;
      let webSearch = true;
      let result: Awaited<ReturnType<typeof requestOpenAISession>>;
      for (;;) {
        result = await requestOpenAISession(config, {
          session: {
            ...baseSession,
            ...(standby ? { idle_timeout_s: 30, wake_policy: { type: 'speech' } } : {}),
            delegation: {
              ...baseSession.delegation,
              responses: {
                ...baseSession.delegation.responses,
                tools: webSearch ? [...LIVE_APP_TOOLS, { type: 'web_search' }] : LIVE_APP_TOOLS,
              },
            },
          },
          transport: { type: 'webrtc', sdp },
        });
        if (result.status !== 400) break;
        if (webSearch && /web_search|web search/i.test(result.rawText)) webSearch = false;
        else if (standby && /idle_timeout|wake_policy|standby/i.test(result.rawText)) standby = false;
        else break;
      }

      if (result.status < 200 || result.status >= 300) {
        const detail = (result.data?.error?.message || result.rawText || `OpenAI returned HTTP ${result.status}`)
          .replaceAll(config.openaiKey, '[redacted]').slice(0, 300);
        return reply.code(result.status >= 400 && result.status < 600 ? result.status : 502).send({
          error: `Could not start gpt-live-1.1 session: ${detail}`,
        });
      }

      const answerSdp = result.data?.transport?.sdp
        ?? result.data?.sdp
        ?? (result.rawText.startsWith('v=0') ? result.rawText : '');
      if (!answerSdp) {
        return reply.code(502).send({ error: 'OpenAI Live API returned no WebRTC SDP answer.' });
      }
      const sessionId = result.data?.session?.id ?? result.data?.id ?? `live-${Date.now()}`;
      const payload: LiveSessionResponse = {
        session_id: sessionId,
        sdp: answerSdp,
        model: config.openaiLiveModel,
        backend_model: config.openaiLiveBackendModel,
        voice,
      };
      return reply.code(201).send(payload);
    } catch {
      return reply.code(502).send({ error: 'Failed to reach OpenAI Live API.' });
    }
  });
}
