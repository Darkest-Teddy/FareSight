import {
  FARESIGHT_LIVE_TOOLS, LIVE_VOICES, STOPS,
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
      ? ` | dishes: ${place.dishes.map((d) => `${d.id} "${d.name}" $${d.price}${d.asset_id ? '[3D]' : ''}`).join('; ')}`
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
    'You are FareSight Live, a crisp, warm, knowledgeable Boston transit and dining guide built directly into the FareSight 3D and WebXR app.',
    'You can listen and speak naturally, handle interruptions cleanly, and control everything in the app by delegating to your backend tools.',
    'Delegation policy:',
    '- Delegate immediately whenever the user asks to navigate, open a station, open a place, show or inspect a menu, put a dish on the 3D table, compare dishes, rotate a dish, highlight stops or pins on the map, adjust filters or budget or group size, test "Will we fit?", check live MBTA trains or trip times, move the 3D camera, or toggle UI/modals/audio.',
    '- Keep spoken replies short, natural, and grounded in what is actually in FareSight. Never read internal IDs like "place-bucen" or "bu-ramen-01" aloud; say the real place, dish, and station names.',
    '- When you highlight or open something, briefly confirm what you changed on screen and offer a helpful next step only when natural.',
    '- Stay honest about data: distinguish 3D previews from photo previews, and live MBTA arrivals from simulated estimates when reported by tools.',
  ].join('\n');
}

function buildBackendInstructions(places: Place[], initialContext?: string): string {
  return [
    'You are the tool-execution and reasoning backend for FareSight Live.',
    'You have direct control over the FareSight 3D/WebXR Boston MBTA map, station dioramas, venue Gaussian splat rooms, 3D dish table, physical menu book, filters, camera, MBTA transit data, and UI controls.',
    'Rules:',
    '1. Always use the provided tools to act on the app immediately when the user asks to view, open, highlight, compare, filter, rotate, navigate, or inspect anything.',
    '2. You may call multiple tools in sequence when helpful (for example: set_filters then highlight_map_stops, or open_place then show_menu).',
    '3. For map highlights, use highlight_map_stops so the 3D Boston sculpture pulses and illuminates the relevant stations and MBTA lines.',
    '4. For station pin highlights, use highlight_station_places so glowing beacons point out venues inside the neighborhood diorama.',
    '5. For menu items, use show_menu to display and spotlight items on the 3D menu book, and use open_dish or compare_dishes to place 3D dishes on the table.',
    '6. Keep your final summary concise, factual, and ready for the voice layer to speak naturally (no raw IDs, no markdown tables, no em dashes).',
    '',
    buildCatalogPrompt(places),
    ...(initialContext ? ['', 'INITIAL APP STATE:', initialContext.slice(0, 1200)] : []),
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
    if (!config.openaiKey) {
      return reply.code(503).send({
        error: 'OPENAI_API_KEY is not configured on the server. Add OPENAI_API_KEY to .env and restart the server to use gpt-live-1.1.',
      });
    }
    const sdp = typeof body?.sdp === 'string' ? body.sdp.trim() : '';
    if (!sdp || !sdp.includes('v=0')) {
      return reply.code(400).send({ error: 'A valid WebRTC SDP offer is required to start a live session.' });
    }
    const voice = normalizeVoice(body.voice, config.openaiLiveVoice);
    const context = typeof body.context === 'string' ? body.context : undefined;
    const places = store.all('places');

    const baseSession: Record<string, unknown> = {
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
          tools: FARESIGHT_LIVE_TOOLS,
          tool_choice: 'auto',
          parallel_tool_calls: true,
        },
      },
    };

    const requestWithStandby = {
      session: {
        ...baseSession,
        idle_timeout_s: 30,
        wake_policy: { type: 'speech' },
      },
      transport: {
        type: 'webrtc',
        sdp,
      },
    };

    try {
      let result = await requestOpenAISession(config, requestWithStandby);
      // If a snapshot/tier rejects optional standby fields, retry once with the core WebRTC session payload.
      if (result.status === 400 && /idle_timeout|wake_policy|standby/i.test(result.rawText)) {
        result = await requestOpenAISession(config, {
          session: baseSession,
          transport: { type: 'webrtc', sdp },
        });
      }

      if (result.status < 200 || result.status >= 300) {
        const detail = result.data?.error?.message || result.rawText.slice(0, 300) || `OpenAI returned HTTP ${result.status}`;
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
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.code(502).send({ error: `Failed to reach OpenAI Live API: ${message}` });
    }
  });
}
