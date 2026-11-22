import { api } from '../api/client.ts';
import { realtimeTools, type RealtimeToolName } from './tools.ts';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export type VoiceTranscript = { kind: 'user' | 'assistant' | 'action'; text: string; id?: string };

type Speaker = Exclude<VoiceTranscript['kind'], 'action'> | 'backend';

interface VoiceCallbacks {
  onState: (state: VoiceState, detail?: string) => void;
  onNotice: (detail?: string) => void;
  onMicrophone: (hasMic: boolean, muted: boolean, requesting: boolean) => void;
  onAudioBlocked: (blocked: boolean) => void;
  onPaused: (paused: boolean) => void;
  onAudioLevel?: (level: number) => void;
  onUnsentText: (text: string) => void;
  onModel: (model: string) => void;
  onTool: (name: RealtimeToolName, args: Record<string, unknown>, current: () => boolean) => Promise<{ result: Record<string, unknown>; actionLabel?: string }>;
  onTranscript: (entry: VoiceTranscript) => void;
  getContext: () => string;
}

interface VoiceSession {
  cancel: AbortController;
  peer?: RTCPeerConnection;
  sender?: RTCRtpSender;
  ready: boolean;
  requestingMic: boolean;
  queuedText?: string;
  textTurn: boolean;
  responseTimer?: number;
  pendingEvents: Set<string>;
  channel?: RTCDataChannel;
  stream?: MediaStream;
  audio?: HTMLAudioElement;
  timer?: number;
  reconnectTimer?: number;
  audioMeterTimer?: number;
  pauseTimer?: number;
  playbackTimer?: number;
  paused: boolean;
  pausedBatches: Set<ToolBatch>;
  audioArmed: boolean;
  rejectedResponses: Set<string>;
  responding: boolean;
  playing: boolean;
  handled: Map<string, ToolBatch>;
  batches: Set<ToolBatch>;
  drafts: Partial<Record<Speaker, TranscriptDraft>>;
}

interface ToolBatch {
  responseId?: string;
  delegationId?: string;
  completed: boolean;
  calls: FunctionCall[];
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
  text?: string;
  error?: LiveError;
  response?: { id?: string; status?: string; output?: FunctionCall[]; error?: LiveError; status_details?: { error?: LiveError } };
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

  private readonly callbacks: VoiceCallbacks;

  constructor(callbacks: VoiceCallbacks) {
    this.callbacks = callbacks;
  }

  get state(): VoiceState { return this.current; }
  get isMuted(): boolean { return this.muted; }

  toggle(): void {
    if (this.session) this.stop();
    else void this.connect(true);
  }

  async start(): Promise<void> {
    const session = this.session;
    if (!session) {
      await this.connect(true);
    } else if (session.ready && !session.stream && !session.requestingMic) {
      this.enableAudio();
      this.callbacks.onNotice();
      await this.acquireMicrophone(session);
    }
  }

  private async connect(withMic: boolean, queuedText?: string): Promise<void> {
    const session: VoiceSession = {
      cancel: new AbortController(), ready: false, requestingMic: false, queuedText, textTurn: false,
      responding: false, playing: false, pendingEvents: new Set(), handled: new Map(), batches: new Set(), drafts: {},
      paused: false, pausedBatches: new Set(), audioArmed: true, rejectedResponses: new Set(),
    };
    this.session = session;
    this.setState('connecting');

    try {
      if (typeof RTCPeerConnection === 'undefined') {
        throw new Error('GPT Live needs WebRTC over HTTPS or localhost.');
      }
      const peer = session.peer = new RTCPeerConnection();
      // Negotiate audio in both directions so enabling a microphone later only needs replaceTrack.
      session.sender = peer.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      const audio = session.audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', '');
      audio.hidden = true;
      document.body.append(audio);
      peer.ontrack = (event) => {
        if (this.session !== session) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        this.enableAudio();
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
      if (withMic) void this.acquireMicrophone(session);
      session.timer = window.setTimeout(() => this.fail(session, 'GPT Live connection timed out.'), 55_000);

      const channel = session.channel = peer.createDataChannel('oai-events');
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
      const detail = error instanceof Error ? error.message : 'Could not start GPT Live.';
      this.fail(session, detail);
    }
  }

  private async acquireMicrophone(session: VoiceSession): Promise<void> {
    session.requestingMic = true;
    this.updateMicrophone();
    let stream: MediaStream | undefined;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new DOMException('Microphone unavailable', 'NotFoundError');
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.session !== session) return;
      const track = stream.getAudioTracks()[0];
      if (!track) throw new DOMException('Microphone unavailable', 'NotFoundError');
      track.enabled = false;
      await session.sender!.replaceTrack(track);
      if (this.session !== session) return;
      session.stream = stream;
      track.addEventListener('ended', () => {
        if (this.session !== session || session.stream !== stream) return;
        session.stream = undefined;
        this.updateMicrophone();
        this.callbacks.onNotice('Microphone disconnected. Keep typing or enable the mic again.');
      }, { once: true });
    } catch (error) {
      if (this.session !== session) return;
      const reason = error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access was denied.'
        : error instanceof DOMException && error.name === 'NotFoundError' ? 'No microphone is available.'
          : 'Could not enable the microphone.';
      this.callbacks.onNotice(reason + ' You can still type.');
    } finally {
      if (this.session !== session || session.stream !== stream) stream?.getTracks().forEach((track) => track.stop());
      if (this.session === session) {
        session.requestingMic = false;
        this.updateMicrophone();
      }
    }
  }

  enableAudio(): void {
    const session = this.session;
    const audio = session?.audio;
    if (!audio?.srcObject) return;
    void audio.play().then(
      () => { if (this.session === session) this.callbacks.onAudioBlocked(false); },
      () => { if (this.session === session) this.callbacks.onAudioBlocked(true); },
    );
  }

  private handleEvent(session: VoiceSession, event: LiveEvent, delegationId = event.delegation_id): void {
    switch (event.type) {
      case 'response.event':
        if (event.event && typeof event.event.type === 'string' && event.event.type !== 'response.event') {
          this.handleEvent(session, event.event, delegationId ?? event.event.delegation_id);
        }
        break;
      case 'session.started':
        session.ready = true;
        window.clearTimeout(session.timer);
        this.updateMicrophone();
        this.refreshState(session);
        if (session.queuedText && this.submitText(session, session.queuedText)) session.queuedText = undefined;
        break;
      case 'session.resumed':
        session.paused = false;
        session.audioArmed = true;
        this.callbacks.onPaused(false);
        this.refreshState(session);
        break;
      case 'session.paused':
        this.pause(session);
        break;
      case 'session.closed':
      case 'session.ended':
      case 'session.expired':
        this.fail(session, 'GPT Live session ended. Start it again to continue.');
        break;
      case 'input_audio_buffer.speech_started':
        delete session.drafts.user;
        delete session.drafts.assistant;
        if (!session.textTurn) this.finishResponse(session);
        this.stopPlayback(session);
        break;
      case 'input_audio_buffer.speech_stopped':
        session.audioArmed = true;
        break;
      case 'session.delegation.created':
      case 'response.created':
        if (!delegationId) session.audioArmed = true;
        this.expectResponse(session);
        break;
      case 'output_audio_buffer.started':
        session.audioArmed = true;
        this.noteAudio(session);
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        this.stopPlayback(session);
        break;
      case 'response.output_item.done':
        if (event.item?.type === 'function_call') this.queueTool(session, event.item, event, delegationId);
        break;
      case 'response.done':
      case 'response.completed':
      case 'response.cancelled':
      case 'response.incomplete':
      case 'response.failed':
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
      case 'response.output_text.delta':
        if (session.textTurn) this.transcript(session, 'backend', event, false);
        break;
      case 'response.output_text.done':
        if (session.textTurn) this.transcript(session, 'backend', event, true);
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

  private pause(session: VoiceSession): void {
    session.paused = true;
    this.callbacks.onPaused(true);
    if (!session.textTurn) {
      this.finishResponse(session);
      for (const batch of session.batches) session.pausedBatches.add(batch);
      if (session.pausedBatches.size) this.schedulePauseExpiry(session);
    }
    this.stopPlayback(session);
  }

  private schedulePauseExpiry(session: VoiceSession): void {
    if (session.pauseTimer !== undefined) return;
    session.pauseTimer = window.setTimeout(() => {
      if (this.session !== session) return;
      session.pauseTimer = undefined;
      for (const batch of session.pausedBatches) {
        if (session.batches.delete(batch)) this.rejectBatch(session, batch.responseId ?? batch.delegationId);
      }
      session.pausedBatches.clear();
      this.refreshState(session);
    }, 8_000);
  }

  private watchRemoteAudio(session: VoiceSession, receiver: RTCRtpReceiver): void {
    let energy: number | undefined;
    let duration: number | undefined;
    const sample = async () => {
      if (this.session !== session) return;
      const stats = await receiver.getStats().catch(() => undefined);
      if (this.session !== session) return;
      let level = 0;
      stats?.forEach((report) => {
        if (report.type !== 'inbound-rtp' || (report.kind && report.kind !== 'audio')) return;
        const nextEnergy = report.totalAudioEnergy;
        const nextDuration = report.totalSamplesDuration;
        const rms = energy !== undefined && duration !== undefined && nextDuration > duration
          ? Math.sqrt(Math.max(0, nextEnergy - energy) / (nextDuration - duration)) : 0;
        energy = nextEnergy;
        duration = nextDuration;
        const sampleLevel = Math.max(report.audioLevel ?? 0, rms);
        level = Math.max(level, sampleLevel);
        if (session.audioArmed && sampleLevel >= 0.004) this.noteAudio(session);
      });
      if (session.playing) this.callbacks.onAudioLevel?.(level);
      session.audioMeterTimer = window.setTimeout(sample, 100);
    };
    window.clearTimeout(session.audioMeterTimer);
    void sample();
  }

  private noteAudio(session: VoiceSession): void {
    if (!session.playing) this.setPlayback(session, true);
    window.clearTimeout(session.playbackTimer);
    session.playbackTimer = window.setTimeout(() => this.setPlayback(session, false), 1_100);
  }

  private stopPlayback(session: VoiceSession): void {
    session.audioArmed = false;
    window.clearTimeout(session.playbackTimer);
    this.setPlayback(session, false);
  }

  private setPlayback(session: VoiceSession, playing: boolean): void {
    session.playing = playing;
    this.refreshState(session);
  }

  private handleError(session: VoiceSession, error: LiveError | undefined): void {
    if (fatalLiveErrors.has(error?.code ?? '') || fatalLiveErrors.has(error?.type ?? '')) {
      this.fail(session, 'GPT Live session ended. Start it again to continue.');
      return;
    }
    const eventId = error?.client_event_id;
    if (!eventId || session.pendingEvents.has(eventId)) {
      for (const batch of session.batches) this.rejectBatch(session, batch.responseId ?? batch.delegationId);
      session.batches.clear();
      session.pausedBatches.clear();
      this.finishResponse(session);
      this.stopPlayback(session);
    }
    const message = typeof error?.message === 'string' ? error.message.split(' Supported values are:')[0].trim() : '';
    const detail = message.length > 240 ? message.slice(0, 240).replace(/\s+\S*$/, '') + '…' : message;
    this.callbacks.onNotice(detail ? `GPT Live: ${detail} Try again or start a new session.`
      : 'GPT Live could not finish the request. Try again or start a new session.');
  }

  private expectResponse(session: VoiceSession): void {
    window.clearTimeout(session.responseTimer);
    session.responding = true;
    session.responseTimer = window.setTimeout(() => {
      if (this.session === session) this.handleError(session, { message: 'The response timed out.' });
    }, 60_000);
    this.refreshState(session);
  }

  private finishResponse(session: VoiceSession): void {
    window.clearTimeout(session.responseTimer);
    session.responding = false;
    session.textTurn = false;
    session.pendingEvents.clear();
  }

  private refreshState(session: VoiceSession): void {
    if (!session.ready) return;
    this.setState(session.playing ? 'speaking' : session.responding || session.batches.size ? 'thinking' : 'listening');
  }

  private transcript(session: VoiceSession, speaker: Speaker, event: LiveEvent, completed: boolean): void {
    const value = completed ? event.transcript ?? event.text : event.delta;
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
    if (draft.text.trim()) this.callbacks.onTranscript({ id: draft.id, kind: speaker === 'backend' ? 'assistant' : speaker, text: draft.text });
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
    const responseId = event.response_id ?? event.response?.id;
    if (existing?.completed || typeof callId !== 'string' || !callId || session.handled.has(callId) ||
      session.rejectedResponses.has(responseId ?? delegationId ?? '')) return;
    const batch = existing ?? this.findBatch(session, event, delegationId) ?? { completed: false, calls: [] };
    if (batch.completed) return;
    batch.responseId ??= responseId;
    batch.delegationId ??= delegationId;
    session.batches.add(batch);
    if (session.paused && !session.textTurn) {
      session.pausedBatches.add(batch);
      this.schedulePauseExpiry(session);
    }
    session.handled.set(callId, batch);
    batch.calls.push(call);
    this.refreshState(session);
    return batch;
  }

  private async runTools(session: VoiceSession, batch: ToolBatch): Promise<void> {
    const current = () => this.session === session && session.batches.has(batch);
    try {
      for (const call of batch.calls) {
        if (!current()) return;
        const tool = realtimeTools.find(({ name }) => name === call.name);
        let result: Record<string, unknown>;
        let label: string | undefined;
        try {
          if (!tool) throw new Error('Unknown tool');
          const completed = await this.callbacks.onTool(tool.name, parseArguments(call.arguments), current);
          result = completed.result;
          label = completed.actionLabel;
        } catch {
          result = { ok: false, error: 'Vantage could not perform that action. Check the tool and its arguments.' };
        }
        if (!current()) return;
        if (label) this.callbacks.onTranscript({ kind: 'action', text: label });
        const output = JSON.stringify({ ...result, currentView: this.callbacks.getContext() });
        if (!this.send(session, { type: 'response.item.create', item: { type: 'function_call_output', call_id: call.call_id, output } })) return;
      }
      if (!current()) return;
      session.batches.delete(batch);
      session.pausedBatches.delete(batch);
      if (!session.batches.size) this.requestResponse(session);
    } catch {
      if (current()) this.fail(session, 'GPT Live could not return the app action.');
    }
  }

  private rejectBatch(session: VoiceSession, id?: string): void {
    if (!id) return;
    session.rejectedResponses.add(id);
    if (session.rejectedResponses.size > 128) session.rejectedResponses.delete(session.rejectedResponses.values().next().value!);
  }

  private completeResponse(session: VoiceSession, event: LiveEvent, delegationId?: string): void {
    const status = event.response?.status ?? event.type.split('.')[1];
    const responseId = event.response_id ?? event.response?.id;
    if (session.rejectedResponses.has(responseId ?? delegationId ?? '')) return;
    const output = Array.isArray(event.response?.output) ? event.response.output.filter((item) => item?.type === 'function_call') : [];
    let batch = this.findBatch(session, event, delegationId);
    if (!batch) {
      batch = output.map(({ call_id }) => session.handled.get(call_id ?? '')).find((match) => match && session.batches.has(match));
    }
    if (status === 'cancelled' || status === 'incomplete' || status === 'failed') {
      this.rejectBatch(session, responseId ?? delegationId);
      if (batch) {
        session.batches.delete(batch);
        session.pausedBatches.delete(batch);
      }
      if (status === 'failed' || status === 'incomplete') {
        this.handleError(session, event.response?.error ?? event.response?.status_details?.error);
      } else if (!session.batches.size) {
        this.finishResponse(session);
        this.refreshState(session);
      }
      return;
    }
    for (const call of output) {
      batch = this.queueTool(session, call, event, delegationId, batch) ?? batch;
    }
    if (batch && !batch.completed) {
      batch.completed = true;
      this.expectResponse(session);
      void this.runTools(session, batch);
    } else if (!session.batches.size) {
      this.finishResponse(session);
      this.refreshState(session);
    }
  }

  private requestResponse(session: VoiceSession): boolean {
    if (!this.send(session, { type: 'response.create' })) return false;
    session.audioArmed = true;
    this.expectResponse(session);
    return true;
  }

  sendText(text: string): boolean {
    const session = this.session;
    const message = text.trim();
    if (!message) return false;
    if (!session) {
      void this.connect(false, message);
      return this.current !== 'error';
    }
    if (!session.ready || session.responding || session.playing || session.batches.size) return false;
    this.enableAudio();
    return this.submitText(session, message);
  }

  private submitText(session: VoiceSession, message: string): boolean {
    this.callbacks.onNotice();
    delete session.drafts.backend;
    session.textTurn = true;
    if (!this.send(session, {
      type: 'response.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: message }] },
    }) || !this.requestResponse(session)) return false;
    this.callbacks.onTranscript({ kind: 'user', text: message });
    return true;
  }

  private send(session: VoiceSession, event: { type: string; item?: object }): boolean {
    if (this.session !== session) return false;
    if (session.channel?.readyState === 'open') {
      const eventId = crypto.randomUUID();
      try {
        session.channel.send(JSON.stringify({ ...event, event_id: eventId }));
        session.pendingEvents.add(eventId);
        return true;
      } catch { /* The channel can close during a send. */ }
    }
    this.fail(session, 'GPT Live could not exchange session events.');
    return false;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.updateMicrophone();
  }

  private updateMicrophone(): void {
    const session = this.session;
    session?.stream?.getAudioTracks().forEach((track) => { track.enabled = !this.muted && session.ready; });
    this.callbacks.onMicrophone(Boolean(session?.stream), this.muted, Boolean(session?.requestingMic));
  }

  stop(): void {
    const session = this.session;
    if (session?.channel?.readyState === 'open') {
      try { session.channel.send(JSON.stringify({ type: 'session.close' })); } catch { /* The channel may already be closing. */ }
    }
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
    this.muted = false;
    this.updateMicrophone();
    this.callbacks.onAudioBlocked(false);
    this.callbacks.onPaused(false);
    if (session.queuedText) this.callbacks.onUnsentText(session.queuedText);
    window.clearTimeout(session.timer);
    window.clearTimeout(session.responseTimer);
    window.clearTimeout(session.reconnectTimer);
    window.clearTimeout(session.audioMeterTimer);
    window.clearTimeout(session.pauseTimer);
    window.clearTimeout(session.playbackTimer);
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
