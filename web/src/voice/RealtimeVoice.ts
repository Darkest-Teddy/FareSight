import { api } from '../api/client';
import { realtimeTools, voiceInstructions, type RealtimeToolName } from './tools';

export type VoiceState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'error';
export type VoiceTranscript = { kind: 'user' | 'assistant' | 'action'; text: string };

interface VoiceCallbacks {
  onState: (state: VoiceState, detail?: string) => void;
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
  responding: boolean;
  playing: boolean;
  queued: number;
  needsResponse: boolean;
  tools: Promise<void>;
  handled: Set<string>;
  context?: string;
}

interface RealtimeEvent {
  type: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  transcript?: string;
  response?: { status?: string };
}

function parseArguments(raw: string | undefined): Record<string, unknown> {
  const value: unknown = JSON.parse(raw ?? '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid tool arguments');
  return value as Record<string, unknown>;
}

const realtimeOrigin = 'https://api.openai.com/v1/realtime';

export class RealtimeVoice {
  private session?: VoiceSession;
  private current: VoiceState = 'idle';
  private muted = false;

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
      cancel: new AbortController(), responding: false, playing: false, queued: 0, needsResponse: false,
      tools: Promise.resolve(), handled: new Set(),
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
      session.timer = window.setTimeout(() => this.fail(session, 'GPT Live connection timed out.'), 25_000);
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
        session.context = this.callbacks.getContext();
        if (!this.send(session, {
          type: 'session.update', session: { type: 'realtime', instructions: this.instructions(session.context), tools: realtimeTools, tool_choice: 'auto' },
        })) return;
        this.applyMute();
        this.setState('listening');
      });
      channel.addEventListener('close', () => this.fail(session, 'GPT Live session ended.'));
      channel.addEventListener('error', () => this.fail(session, 'GPT Live could not exchange session events.'));
      channel.addEventListener('message', ({ data }) => {
        if (this.session !== session || typeof data !== 'string') return;
        let event: RealtimeEvent;
        try { event = JSON.parse(data); } catch { return; }
        if (event && typeof event.type === 'string') this.handleEvent(session, event);
      });

      const offer = await peer.createOffer();
      if (!offer.sdp) throw new Error('Could not create the GPT Live WebRTC offer.');
      await peer.setLocalDescription(offer);
      if (this.session !== session) return;
      const { client_secret, model } = await api.realtimeSession(session.cancel.signal);
      if (!client_secret || !model) throw new Error('GPT Live returned an invalid session.');
      const request: RequestInit = {
        method: 'POST', signal: session.cancel.signal, redirect: 'error',
        headers: { Authorization: `Bearer ${client_secret}`, 'Content-Type': 'application/sdp' },
        body: offer.sdp,
      };
      let answer = await fetch(`${realtimeOrigin}/calls`, request);
      if (answer.status === 404) answer = await fetch(`${realtimeOrigin}?model=${encodeURIComponent(model)}`, request);
      if (!answer.ok) throw new Error(`Could not connect to GPT Live (HTTP ${answer.status}).`);
      const sdp = await answer.text();
      if (this.session === session) await peer.setRemoteDescription({ type: 'answer', sdp });
    } catch (error) {
      const detail = error instanceof DOMException && error.name === 'NotAllowedError' ? 'Microphone access was denied.'
        : error instanceof DOMException && error.name === 'NotFoundError' ? 'No microphone is available.'
          : error instanceof Error ? error.message : 'Could not start GPT Live.';
      this.fail(session, detail);
    }
  }

  private handleEvent(session: VoiceSession, event: RealtimeEvent): void {
    switch (event.type) {
      case 'input_audio_buffer.speech_started':
        session.playing = false;
        this.setState('listening');
        break;
      case 'input_audio_buffer.speech_stopped':
        this.setState('thinking');
        break;
      case 'response.created':
        session.responding = true;
        if (!session.playing) this.setState('thinking');
        break;
      case 'output_audio_buffer.started':
        session.playing = true;
        this.setState('speaking');
        break;
      case 'output_audio_buffer.stopped':
      case 'output_audio_buffer.cleared':
        session.playing = false;
        this.setState(session.responding || session.queued ? 'thinking' : 'listening');
        break;
      case 'response.done':
        session.responding = false;
        if (event.response?.status === 'failed') { this.fail(session, 'GPT Live could not finish the response.'); break; }
        if (!this.resumeAfterTools(session) && !session.playing && !session.queued) this.setState('listening');
        break;
      case 'response.function_call_arguments.done':
        this.queueTool(session, event);
        break;
      case 'response.output_audio_transcript.done':
      case 'conversation.item.input_audio_transcription.completed':
        if (typeof event.transcript === 'string' && event.transcript.trim()) {
          this.callbacks.onTranscript({ kind: event.type.startsWith('response.') ? 'assistant' : 'user', text: event.transcript });
        }
        break;
      case 'error':
        this.fail(session, 'GPT Live could not complete the request.');
        break;
    }
  }

  private queueTool(session: VoiceSession, event: RealtimeEvent): void {
    const callId = event.call_id;
    if (typeof callId !== 'string' || !callId || session.handled.has(callId)) return;
    session.handled.add(callId);
    session.queued++;
    this.setState('thinking');
    session.tools = session.tools.then(async () => {
      if (this.session !== session) return;
      const tool = realtimeTools.find(({ name }) => name === event.name);
      let output: string;
      let label: string | undefined;
      try {
        if (!tool) throw new Error('Unknown tool');
        const { result, actionLabel } = await this.callbacks.onTool(tool.name, parseArguments(event.arguments));
        output = JSON.stringify(result);
        label = actionLabel;
      } catch {
        output = JSON.stringify({ ok: false, error: 'FareSight could not perform that action. Check the tool and its arguments.' });
      }
      if (this.session !== session) return;
      if (label) this.callbacks.onTranscript({ kind: 'action', text: label });
      this.send(session, { type: 'conversation.item.create', item: { type: 'function_call_output', call_id: callId, output } });
      session.queued--;
      session.needsResponse = true;
      this.resumeAfterTools(session);
    }).catch(() => this.fail(session, 'GPT Live could not return the app action.'));
  }

  private resumeAfterTools(session: VoiceSession): boolean {
    if (session.responding || session.queued || !session.needsResponse) return false;
    session.needsResponse = false;
    this.setState('thinking');
    return this.send(session, { type: 'response.create' });
  }

  sendText(text: string): boolean {
    const session = this.session;
    const message = text.trim();
    if (!session || !message || session.responding || session.queued) return false;
    if (!this.send(session, {
      type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: message }] },
    })) return false;
    this.callbacks.onTranscript({ kind: 'user', text: message });
    return this.send(session, { type: 'response.create' });
  }

  updateContext(): void {
    const session = this.session;
    if (!session || session.channel?.readyState !== 'open') return;
    const context = this.callbacks.getContext();
    if (session.context === context) return;
    session.context = context;
    this.send(session, { type: 'session.update', session: { type: 'realtime', instructions: this.instructions(context) } });
  }

  private instructions(context: string): string {
    return `${voiceInstructions}\nCurrent FareSight view: ${context}`;
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
