import { api } from '../api/client';
import { realtimeTools, type RealtimeToolName } from './tools';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export type VoiceTranscript = { kind: 'user' | 'assistant' | 'action'; text: string; id?: string };

type Speaker = Exclude<VoiceTranscript['kind'], 'action'>;

interface VoiceCallbacks {
  onState: (state: VoiceState, detail?: string) => void;
  onModel: (model: string) => void;
  onTool: (name: RealtimeToolName, args: Record<string, unknown>) => Promise<{ result: Record<string, unknown>; actionLabel?: string }>;
  onTranscript: (entry: VoiceTranscript) => void;
  getContext: () => string;
}

interface VoiceSession {
  cancel: AbortController;
  peer?: RTCPeerConnection;
  channel?: RTCDataChannel;
  stream?: MediaStream;
  audio?: HTMLAudioElement;
  timer?: number;
  reconnectTimer?: number;
  audioMeterTimer?: number;
  hasOutputBufferEvents?: boolean;
  responding: boolean;
  playing: boolean;
  tools: Promise<void>;
  handled: Map<string, ToolBatch>;
  batches: Set<ToolBatch>;
  drafts: Partial<Record<Speaker, TranscriptDraft>>;
  pendingResponseId?: string;
}

interface ToolBatch {
  responseId?: string;
  delegationId?: string;
  pending: number;
  completed: boolean;
}

interface TranscriptDraft {
  id: string;
  itemId?: string;
  text: string;
  completed: boolean;
}

interface FunctionCall {
  type?: string;
  name?: string;
  call_id?: string;
  arguments?: unknown;
}

interface LiveError {
  type?: string;
  code?: string;
  message?: string;
  client_event_id?: string;
}

interface LiveEvent extends FunctionCall {
  type: string;
  event?: LiveEvent;
  delegation_id?: string;
  response_id?: string;
  item_id?: string;
  item?: FunctionCall;
  delta?: string;
  transcript?: string;
  error?: LiveError;
  response?: { id?: string; status?: string; output?: FunctionCall[]; status_details?: { error?: LiveError } };
}

const fatalLiveErrors = new Set([
  'authentication_error', 'invalid_api_key', 'session_closed', 'session_ended', 'session_expired', 'session_not_found',
]);

function parseArguments(raw: unknown): Record<string, unknown> {
  const value: unknown = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw ?? {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool arguments');
  return value as Record<string, unknown>;
}

function waitForIceGathering(peer: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (peer.iceGatheringState === 'complete' || signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      peer.removeEventListener('icegatheringstatechange', changed);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const changed = () => { if (peer.iceGatheringState === 'complete') finish(); };
    const timer = window.setTimeout(finish, 1200);
    peer.addEventListener('icegatheringstatechange', changed);
    signal.addEventListener('abort', finish, { once: true });
  });
}

export class RealtimeVoice {
  private session?: VoiceSession;
  private current: VoiceState = 'idle';
  private muted = false;
  private nextTranscriptId = 0;

  constructor(private readonly callbacks: VoiceCallbacks) {}

  get state(): VoiceState { return this.current; }
  get isMuted(): boolean { return this.muted; }

  toggle(): void {
    if (this.session) this.stop();
    else void this.start();
  }

  async start(): Promise<void> {
    if (this.session) return;
    const session: VoiceSession = {
      cancel: new AbortController(), responding: false, playing: false,
      tools: Promise.resolve(), handled: new Map(), batches: new Set(), drafts: {},
    };
    this.session = session;
    this.setState('connecting');

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
        throw new Error('GPT Live needs microphone and WebRTC access over HTTPS or localhost.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.session !== session) { stream.getTracks().forEach((track) => track.stop()); return; }
      session.stream = stream;
      session.timer = window.setTimeout(() => this.fail(session, 'GPT Live connection timed out.'), 55_000);
      const peer = session.peer = new RTCPeerConnection();
      const audio = session.audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.hidden = true;
      document.body.append(audio);
      peer.ontrack = (event) => {
        if (this.session !== session) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void audio.play().catch(() => this.fail(session, 'The browser blocked GPT Live audio. Start it again from the voice control.'));
        if (event.receiver?.track.kind === 'audio') this.watchRemoteAudio(session, event.receiver);
      };
      peer.onconnectionstatechange = () => {
        if (this.session !== session) return;
        window.clearTimeout(session.reconnectTimer);
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
          this.fail(session, 'GPT Live connection closed.');
        } else if (peer.connectionState === 'disconnected') {
          session.reconnectTimer = window.setTimeout(() => this.fail(session, 'GPT Live connection lost.'), 5_000);
        }
      };
      for (const track of stream.getAudioTracks()) {
        track.enabled = false;
        peer.addTrack(track, stream);
      }

      const channel = session.channel = peer.createDataChannel('oai-events');
      channel.addEventListener('open', () => {
        if (this.session !== session) return;
        window.clearTimeout(session.timer);
        this.applyMute();
        this.setState('listening');
      });
      channel.addEventListener('close', () => this.fail(session, 'GPT Live session ended.'));
      channel.addEventListener('error', () => this.fail(session, 'GPT Live could not exchange session events.'));
      channel.addEventListener('message', ({ data }) => {
        if (this.session !== session || typeof data !== 'string') return;
        let event: LiveEvent;
        try { event = JSON.parse(data); } catch { return; }
        if (event && typeof event.type === 'string') this.handleEvent(session, event);
      });

      const offer = await peer.createOffer();
      if (this.session !== session) return;
      await peer.setLocalDescription(offer);
      await waitForIceGathering(peer, session.cancel.signal);
      if (this.session !== session) return;
      const sdp = peer.localDescription?.sdp ?? offer.sdp;
      if (!sdp) throw new Error('Could not create the GPT Live WebRTC offer.');
      const answer = await api.createLiveSession({ sdp, context: this.callbacks.getContext() }, session.cancel.signal);
      if (this.session !== session) return;
      if (!answer.sdp || !answer.model) throw new Error('GPT Live returned an invalid session.');
      this.callbacks.onModel(answer.model);
      await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } catch (error) {
      const detail = error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access was denied.'
        : error instanceof DOMException && error.name === 'NotFoundError' ? 'No microphone is available.'
          : error instanceof Error ? error.message : 'Could not start GPT Live.';
      this.fail(session, detail);
    }
  }

  private handleEvent(session: VoiceSession, event: LiveEvent, delegationId = event.delegation_id): void {
    switch (event.type) {
      case 'response.event':
        if (event.event && typeof event.event.type === 'string' && event.event.type !== 'response.event') {
          this.handleEvent(session, event.event, delegationId ?? event.event.delegation_id);
        }
        break;
      case 'session.started':
      case 'session.resumed':
        this.refreshState(session);
        break;
      case 'session.paused':
        session.pendingResponseId = undefined;
        session.responding = session.playing = false;
        this.refreshState(session);
        break;
      case 'session.closed':
      case 'session.ended':
      case 'session.expired':
        this.fail(session, 'GPT Live session ended. Start it again to continue.');
        break;
      case 'input_audio_buffer.speech_started':
        delete session.drafts.user;
        delete session.drafts.assistant;
        session.pendingResponseId = undefined;
        session.responding = session.playing = false;
        this.setState('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        session.responding = true;
        this.refreshState(session);
        break;
      case 'response.created':
        if (!delegationId) delete session.drafts.assistant;
        session.pendingResponseId = undefined;
        session.responding = true;
        this.refreshState(session);
        break;
      case 'output_audio_buffer.started':
        session.hasOutputBufferEvents = true;
        this.setPlayback(session, true);
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        session.hasOutputBufferEvents = true;
        this.setPlayback(session, false);
        break;
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') this.queueTool(session, event.item, event, delegationId);
        break;
      case 'response.function_call_arguments.done':
        this.queueTool(session, event, event, delegationId);
        break;
      case 'response.done':
      case 'response.completed':
        this.completeResponse(session, event, delegationId);
        break;
      case 'session.input_transcript.delta':
      case 'conversation.item.input_audio_transcription.delta':
        this.transcript(session, 'user', event, false);
        break;
      case 'session.output_transcript.delta':
      case 'response.output_audio_transcript.delta':
        this.transcript(session, 'assistant', event, false);
        break;
      case 'conversation.item.input_audio_transcription.completed':
      case 'session.input_transcript.done':
        this.transcript(session, 'user', event, true);
        break;
      case 'response.output_audio_transcript.done':
      case 'session.output_transcript.done':
        this.transcript(session, 'assistant', event, true);
        break;
      case 'error':
        this.handleError(session, event.error);
        break;
    }
  }

  private watchRemoteAudio(session: VoiceSession, receiver: RTCRtpReceiver): void {
    // Live can send speech over RTP without any output buffer events on the data channel.
    let lastAudibleAt = -Infinity;
    const sample = async () => {
      if (this.session !== session || session.hasOutputBufferEvents) return;
      const stats = await receiver.getStats().catch(() => undefined);
      if (this.session !== session || session.hasOutputBufferEvents) return;
      stats?.forEach((report) => {
        if (report.type === 'inbound-rtp' && report.audioLevel >= 0.004) lastAudibleAt = performance.now();
      });
      const playing = performance.now() - lastAudibleAt < 320;
      if (playing !== session.playing) this.setPlayback(session, playing);
      session.audioMeterTimer = window.setTimeout(sample, 100);
    };
    window.clearTimeout(session.audioMeterTimer);
    void sample();
  }

  private setPlayback(session: VoiceSession, playing: boolean): void {
    if (playing) {
      session.pendingResponseId = undefined;
      session.responding = false;
    }
    session.playing = playing;
    this.refreshState(session);
  }

  private handleError(session: VoiceSession, error: LiveError | undefined): void {
    console.warn('[FareSight GPT Live]', error);
    if (fatalLiveErrors.has(error?.code ?? '') || fatalLiveErrors.has(error?.type ?? '')) {
      this.fail(session, 'GPT Live session ended. Start it again to continue.');
      return;
    }
    if (session.pendingResponseId && error?.client_event_id === session.pendingResponseId) {
      session.pendingResponseId = undefined;
      session.responding = false;
    }
    this.refreshState(session);
  }

  private refreshState(session: VoiceSession): void {
    this.setState(session.playing ? 'speaking' : session.responding || session.batches.size ? 'thinking' : 'listening');
  }

  private transcript(session: VoiceSession, speaker: Speaker, event: LiveEvent, completed: boolean): void {
    const value = completed ? event.transcript : event.delta;
    if (typeof value !== 'string' || !value) return;
    const itemId = typeof event.item_id === 'string' ? event.item_id : undefined;
    let draft = session.drafts[speaker];
    if (!draft || (!completed && draft.completed) || (itemId && draft.itemId && itemId !== draft.itemId)) {
      draft = { id: 'live-transcript-' + ++this.nextTranscriptId, itemId, text: '', completed: false };
      session.drafts[speaker] = draft;
    }
    draft.itemId ??= itemId;
    draft.text = completed ? value.trim() || draft.text : draft.text + value;
    draft.completed = completed;
    if (draft.text.trim()) this.callbacks.onTranscript({ id: draft.id, kind: speaker, text: draft.text });
  }

  private findBatch(session: VoiceSession, event: LiveEvent, delegationId?: string): ToolBatch | undefined {
    const responseId = event.response_id ?? event.response?.id;
    const batches = [...session.batches];
    return (responseId ? batches.find((batch) => batch.responseId === responseId) : undefined)
      ?? batches.find((batch) => batch.delegationId === delegationId &&
        (!responseId || !batch.responseId || batch.responseId === responseId))
      ?? (delegationId ? batches.find((batch) => !batch.delegationId && !batch.responseId) : undefined);
  }

  private queueTool(session: VoiceSession, call: FunctionCall, event: LiveEvent, delegationId?: string, existing?: ToolBatch): ToolBatch | undefined {
    const callId = call.call_id;
    if (typeof callId !== 'string' || !callId || session.handled.has(callId)) return;
    const batch = existing ?? this.findBatch(session, event, delegationId) ?? { pending: 0, completed: false };
    batch.responseId ??= event.response_id ?? event.response?.id;
    batch.delegationId ??= delegationId;
    session.batches.add(batch);
    session.handled.set(callId, batch);
    batch.pending++;
    this.refreshState(session);
    session.tools = session.tools.then(async () => {
      if (this.session !== session || !session.batches.has(batch)) return;
      const tool = realtimeTools.find(({ name }) => name === call.name);
      let result: Record<string, unknown>;
      let label: string | undefined;
      try {
        if (!tool) throw new Error('Unknown tool');
        const completed = await this.callbacks.onTool(tool.name, parseArguments(call.arguments));
        result = completed.result;
        label = completed.actionLabel;
      } catch {
        result = { ok: false, error: 'FareSight could not perform that action. Check the tool and its arguments.' };
      }
      if (this.session !== session || !session.batches.has(batch)) return;
      if (label) this.callbacks.onTranscript({ kind: 'action', text: label });
      const output = JSON.stringify({ ...result, currentView: this.callbacks.getContext() });
      if (!this.send(session, { type: 'response.item.create', item: { type: 'function_call_output', call_id: callId, output } })) return;
      batch.pending--;
      this.resumeAfterTools(session, batch);
    }).catch(() => this.fail(session, 'GPT Live could not return the app action.'));
    return batch;
  }

  private completeResponse(session: VoiceSession, event: LiveEvent, delegationId?: string): void {
    const status = event.response?.status;
    if (!delegationId || status === 'failed' || status === 'cancelled' || status === 'incomplete') session.responding = false;
    const output = Array.isArray(event.response?.output) ? event.response.output.filter((item) => item?.type === 'function_call') : [];
    let batch = this.findBatch(session, event, delegationId);
    if (!batch) {
      batch = output.map(({ call_id }) => session.handled.get(call_id ?? '')).find((match) => match && session.batches.has(match));
    }
    if (status === 'cancelled' || status === 'incomplete' || status === 'failed') {
      if (batch) session.batches.delete(batch);
      if (status === 'failed') this.handleError(session, event.response?.status_details?.error);
      else this.refreshState(session);
      return;
    }
    for (const call of output) {
      batch = this.queueTool(session, call, event, delegationId, batch) ?? batch;
    }
    if (batch) {
      batch.completed = true;
      this.resumeAfterTools(session, batch);
    }
    this.refreshState(session);
  }

  private resumeAfterTools(session: VoiceSession, batch: ToolBatch): void {
    if (!batch.completed || batch.pending || !session.batches.delete(batch)) return;
    this.requestResponse(session);
  }

  private requestResponse(session: VoiceSession): boolean {
    const eventId = crypto.randomUUID();
    if (!this.send(session, { type: 'response.create', event_id: eventId })) return false;
    session.pendingResponseId = eventId;
    session.responding = true;
    this.refreshState(session);
    return true;
  }

  sendText(text: string): boolean {
    const session = this.session;
    const message = text.trim();
    if (!session || !message || session.responding || session.playing || session.batches.size) return false;
    if (!this.send(session, {
      type: 'response.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: message }] },
    })) return false;
    if (!this.requestResponse(session)) return false;
    delete session.drafts.user;
    delete session.drafts.assistant;
    this.callbacks.onTranscript({ kind: 'user', text: message });
    return true;
  }

  private send(session: VoiceSession, event: object): boolean {
    if (this.session !== session || session.channel?.readyState !== 'open') return false;
    try { session.channel.send(JSON.stringify(event)); return true; }
    catch { this.fail(session, 'GPT Live could not exchange session events.'); return false; }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyMute();
  }

  private applyMute(): void {
    const enabled = !this.muted && this.session?.channel?.readyState === 'open';
    this.session?.stream?.getAudioTracks().forEach((track) => { track.enabled = enabled; });
  }

  stop(): void {
    this.release();
    this.setState('idle');
  }

  destroy(): void { this.stop(); }

  private fail(session: VoiceSession, detail: string): void {
    if (this.session !== session) return;
    this.release();
    this.setState('error', detail);
  }

  private setState(state: VoiceState, detail?: string): void {
    if (state === this.current && !detail) return;
    this.current = state;
    this.callbacks.onState(state, detail);
  }

  private release(): void {
    const session = this.session;
    this.session = undefined;
    if (!session) return;
    window.clearTimeout(session.timer);
    window.clearTimeout(session.reconnectTimer);
    window.clearTimeout(session.audioMeterTimer);
    session.cancel.abort();
    session.channel?.close();
    session.peer?.close();
    session.stream?.getTracks().forEach((track) => track.stop());
    if (session.audio) {
      session.audio.pause();
      session.audio.srcObject = null;
      session.audio.remove();
    }
  }
}
