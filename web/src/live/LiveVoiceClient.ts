import type { LiveToolName } from '@faresight/shared';
import { api } from '../api/client';

export type LiveConnectionState = 'idle' | 'connecting' | 'connected' | 'standby' | 'error';

export interface LiveTranscriptEntry {
  id: string;
  kind: 'user' | 'assistant' | 'action' | 'system';
  text: string;
  streaming?: boolean;
}

export interface LiveClientCallbacks {
  onStateChange: (state: LiveConnectionState, detail?: string) => void;
  onTranscriptUpdate: (entries: readonly LiveTranscriptEntry[]) => void;
  onLevelUpdate: (levels: { input: number; output: number; speaking: boolean; toolRunning: boolean }) => void;
  onToolCall: (name: LiveToolName, args: Record<string, unknown>) => Promise<{ result: Record<string, unknown>; actionLabel?: string }>;
  getContextSummary: () => string;
  onLog: (message: string) => void;
}

interface PendingFunctionCall {
  callId: string;
  name: string;
  rawArgs: string;
}

interface ResponseBatch {
  calls: Map<string, PendingFunctionCall>;
  promises: Promise<void>[];
  completed: boolean;
  resumed: boolean;
}

function makeEventId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 1500): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') finish();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

function readRms(analyser: AnalyserNode | undefined, buffer: Uint8Array<ArrayBuffer>): number {
  if (!analyser) return 0;
  analyser.getByteTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    const centered = (buffer[i] - 128) / 128;
    sum += centered * centered;
  }
  return Math.min(1, Math.sqrt(sum / buffer.length) * 3.4);
}

export class LiveVoiceClient {
  private pc?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private localStream?: MediaStream;
  private remoteAudio?: HTMLAudioElement;
  private audioContext?: AudioContext;
  private inputAnalyser?: AnalyserNode;
  private outputAnalyser?: AnalyserNode;
  private meterTimer?: number;
  private readonly meterBuffer = new Uint8Array(new ArrayBuffer(256));
  private state: LiveConnectionState = 'idle';
  private micMuted = false;
  private entries: LiveTranscriptEntry[] = [];
  private activeUserEntryId?: string;
  private activeAssistantEntryId?: string;
  private batches = new Map<string, ResponseBatch>();
  private handledCallIds = new Set<string>();
  private toolQueue: Promise<void> = Promise.resolve();
  private activeTools = 0;
  private lastContextSent = '';
  private lastContextAt = 0;
  private sessionId?: string;
  private activeModel = 'gpt-live-1.1';

  constructor(private readonly callbacks: LiveClientCallbacks) {}

  get connectionState(): LiveConnectionState { return this.state; }
  get isMicMuted(): boolean { return this.micMuted; }
  get isConnected(): boolean { return this.state === 'connected' || this.state === 'standby'; }
  get currentModel(): string { return this.activeModel; }

  async connect(voice?: string): Promise<void> {
    if (this.state === 'connecting' || this.isConnected) return;
    this.cleanup(false);
    this.setState('connecting', 'Requesting microphone access…');
    this.entries = [];
    this.activeUserEntryId = undefined;
    this.activeAssistantEntryId = undefined;
    this.handledCallIds.clear();
    this.batches.clear();
    this.callbacks.onTranscriptUpdate(this.entries);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Microphone access requires a secure browser context (HTTPS or localhost).');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      this.localStream = stream;
      this.applyMicMute();

      this.setState('connecting', 'Connecting to gpt-live-1.1…');
      const pc = new RTCPeerConnection();
      this.pc = pc;

      const audio = document.createElement('audio');
      audio.autoplay = true;
      audio.setAttribute('playsinline', 'true');
      audio.hidden = true;
      document.body.append(audio);
      this.remoteAudio = audio;

      this.setupAudioMeters(stream);

      pc.ontrack = (event) => {
        const remoteStream = event.streams[0] ?? new MediaStream([event.track]);
        audio.srcObject = remoteStream;
        void audio.play().catch(() => { /* Browser autoplay already allowed by click gesture. */ });
        this.attachRemoteMeter(remoteStream);
      };

      pc.onconnectionstatechange = () => {
        if (this.pc !== pc) return;
        const conn = pc.connectionState;
        if (conn === 'failed' || conn === 'closed') {
          this.callbacks.onLog(`Live WebRTC connection ${conn}`);
          if (this.state !== 'idle') {
            this.cleanup(false);
            this.setState('error', 'Live voice connection closed. Try reconnecting.');
          }
        }
      };

      for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);

      const channel = pc.createDataChannel('oai-events');
      this.channel = channel;
      channel.addEventListener('open', () => {
        if (this.channel !== channel) return;
        this.callbacks.onLog('Live data channel oai-events open');
        if (this.state === 'connecting') this.setState('connected');
      });
      channel.addEventListener('close', () => {
        if (this.channel !== channel) return;
        if (this.state === 'connected' || this.state === 'standby') {
          this.cleanup(false);
          this.setState('idle', 'Session ended.');
        }
      });
      channel.addEventListener('message', (event) => {
        if (this.channel !== channel || typeof event.data !== 'string') return;
        this.handleServerMessage(event.data);
      });

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      const localSdp = pc.localDescription?.sdp ?? offer.sdp;
      if (!localSdp) throw new Error('Could not create a WebRTC SDP offer.');

      const response = await api.createLiveSession({
        sdp: localSdp,
        voice,
        context: this.callbacks.getContextSummary(),
      });
      if (this.pc !== pc) return;

      this.sessionId = response.session_id;
      this.activeModel = response.model;
      await pc.setRemoteDescription({ type: 'answer', sdp: response.sdp });
      this.callbacks.onLog(`Live session ${this.sessionId} connected (${response.model} + ${response.backend_model})`);
      this.pushSystemNote(`Connected to ${response.model}. Ask to open places, show menu items, or highlight stops on the map.`);
      if (channel.readyState === 'open') this.setState('connected');
    } catch (error) {
      this.cleanup(false);
      const text = error instanceof Error ? error.message : String(error);
      this.callbacks.onLog(`Live connection failed: ${text}`);
      this.setState('error', text);
    }
  }

  disconnect(): void {
    this.cleanup(true);
  }

  setMicMuted(muted: boolean): void {
    this.micMuted = muted;
    this.applyMicMute();
  }

  sendContextUpdate(summary: string): void {
    if (!this.isConnected || this.channel?.readyState !== 'open') return;
    const trimmed = summary.trim().slice(0, 800);
    if (!trimmed) return;
    const now = Date.now();
    if (trimmed === this.lastContextSent && now - this.lastContextAt < 8000) return;
    this.lastContextSent = trimmed;
    this.lastContextAt = now;
    this.sendEvent({
      type: 'session.thinking.append',
      event_id: makeEventId('ctx'),
      content: trimmed,
    });
  }

  sendTextPrompt(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed || !this.isConnected || this.channel?.readyState !== 'open') return false;
    this.activeUserEntryId = undefined;
    this.activeAssistantEntryId = undefined;
    this.appendEntry({ id: makeEventId('u'), kind: 'user', text: trimmed });
    this.sendEvent({
      type: 'response.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: trimmed }],
      },
    });
    this.sendEvent({ type: 'response.create' });
    return true;
  }

  private applyMicMute(): void {
    if (!this.localStream) return;
    for (const track of this.localStream.getAudioTracks()) {
      track.enabled = !this.micMuted;
    }
  }

  private setupAudioMeters(localStream: MediaStream): void {
    try {
      const ctx = new AudioContext();
      this.audioContext = ctx;
      const source = ctx.createMediaStreamSource(localStream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.inputAnalyser = analyser;
      this.meterTimer = window.setInterval(() => {
        const input = this.micMuted ? 0 : readRms(this.inputAnalyser, this.meterBuffer);
        const output = readRms(this.outputAnalyser, this.meterBuffer);
        this.callbacks.onLevelUpdate({
          input,
          output,
          speaking: output > 0.04,
          toolRunning: this.activeTools > 0,
        });
      }, 90);
    } catch {
      /* AudioContext metering is optional enhancement. */
    }
  }

  private attachRemoteMeter(remoteStream: MediaStream): void {
    if (!this.audioContext) return;
    try {
      const source = this.audioContext.createMediaStreamSource(remoteStream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      this.outputAnalyser = analyser;
    } catch {
      /* Ignore metering errors on remote tracks. */
    }
  }

  private handleServerMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = typeof msg.type === 'string' ? msg.type : '';
    if (!type) return;

    if (type === 'session.started' || type === 'session.resumed') {
      this.setState('connected');
      return;
    }
    if (type === 'session.paused') {
      this.setState('standby');
      return;
    }
    if (type === 'session.input_transcript.delta' || type === 'conversation.item.input_audio_transcription.delta') {
      const delta = typeof msg.delta === 'string' ? msg.delta : '';
      if (delta) this.appendTranscriptDelta('user', delta);
      return;
    }
    if (type === 'session.output_transcript.delta' || type === 'response.output_audio_transcript.delta') {
      const delta = typeof msg.delta === 'string' ? msg.delta : '';
      if (delta) this.appendTranscriptDelta('assistant', delta);
      return;
    }
    if (type === 'conversation.item.input_audio_transcription.completed') {
      const transcript = typeof msg.transcript === 'string' ? msg.transcript.trim() : '';
      if (transcript) {
        this.activeUserEntryId = undefined;
        this.appendEntry({ id: makeEventId('u'), kind: 'user', text: transcript });
      }
      return;
    }
    if (type === 'response.event') {
      const inner = msg.event as Record<string, unknown> | undefined;
      const delegationId = typeof msg.delegation_id === 'string' ? msg.delegation_id : 'default';
      if (inner && typeof inner.type === 'string') {
        this.handleResponseEvent(delegationId, inner);
      }
      return;
    }
    if (type.startsWith('response.')) {
      this.handleResponseEvent('default', msg);
      return;
    }
    if (type === 'error') {
      const errObj = msg.error as { message?: string; code?: string } | undefined;
      const detail = errObj?.message || 'Live session reported an error.';
      this.callbacks.onLog(`Live API error (${errObj?.code ?? 'unknown'}): ${detail}`);
      this.pushSystemNote(detail);
    }
  }

  private handleResponseEvent(delegationKey: string, event: Record<string, unknown>): void {
    const type = String(event.type ?? '');
    const responseObj = event.response as { id?: string; output?: Record<string, unknown>[] } | undefined;
    const responseId = typeof event.response_id === 'string'
      ? event.response_id
      : typeof responseObj?.id === 'string'
        ? responseObj.id
        : undefined;
    const batchKey = responseId ? `${delegationKey}:${responseId}` : delegationKey;

    if (type === 'response.output_item.done') {
      const item = event.item as Record<string, unknown> | undefined;
      if (item && item.type === 'function_call') {
        this.enqueueFunctionCall(batchKey, item);
      }
      return;
    }

    if (type === 'response.completed' || type === 'response.done') {
      if (Array.isArray(responseObj?.output)) {
        for (const item of responseObj.output) {
          if (item && item.type === 'function_call') {
            this.enqueueFunctionCall(batchKey, item);
          }
        }
      }
      const batch = this.batches.get(batchKey) ?? this.batches.get(delegationKey);
      if (!batch || batch.calls.size === 0) return;
      batch.completed = true;
      void this.flushBatch(batchKey, batch);
    }
  }

  private getOrCreateBatch(key: string): ResponseBatch {
    let batch = this.batches.get(key);
    if (!batch) {
      batch = { calls: new Map(), promises: [], completed: false, resumed: false };
      this.batches.set(key, batch);
    }
    return batch;
  }

  private enqueueFunctionCall(batchKey: string, item: Record<string, unknown>): void {
    const callId = typeof item.call_id === 'string' ? item.call_id : '';
    const name = typeof item.name === 'string' ? item.name : '';
    const rawArgs = typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {});
    if (!callId || !name || this.handledCallIds.has(callId)) return;
    this.handledCallIds.add(callId);

    const batch = this.getOrCreateBatch(batchKey);
    const call: PendingFunctionCall = { callId, name, rawArgs };
    batch.calls.set(callId, call);

    const task = this.toolQueue.then(() => this.runToolCall(call));
    this.toolQueue = task.catch(() => { /* Errors are serialized into function_call_output. */ });
    batch.promises.push(task);
  }

  private async runToolCall(call: PendingFunctionCall): Promise<void> {
    let parsedArgs: Record<string, unknown> = {};
    try {
      const candidate = JSON.parse(call.rawArgs || '{}');
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsedArgs = candidate as Record<string, unknown>;
      }
    } catch {
      parsedArgs = {};
    }

    this.activeTools++;
    this.callbacks.onLog(`Live tool -> ${call.name}(${JSON.stringify(parsedArgs)})`);
    let outputPayload: Record<string, unknown>;
    try {
      const { result, actionLabel } = await this.callbacks.onToolCall(call.name as LiveToolName, parsedArgs);
      outputPayload = result;
      if (actionLabel) {
        this.activeUserEntryId = undefined;
        this.activeAssistantEntryId = undefined;
        this.appendEntry({ id: makeEventId('a'), kind: 'action', text: actionLabel });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      outputPayload = { ok: false, error: message };
      this.callbacks.onLog(`Live tool error (${call.name}): ${message}`);
    } finally {
      this.activeTools = Math.max(0, this.activeTools - 1);
    }

    this.sendEvent({
      type: 'response.item.create',
      item: {
        type: 'function_call_output',
        call_id: call.callId,
        output: JSON.stringify(outputPayload),
      },
    });
  }

  private async flushBatch(batchKey: string, batch: ResponseBatch): Promise<void> {
    if (batch.resumed || !batch.completed) return;
    await Promise.allSettled(batch.promises);
    if (batch.resumed || !this.isConnected) return;
    batch.resumed = true;
    this.batches.delete(batchKey);
    this.sendEvent({ type: 'response.create' });
  }

  private sendEvent(event: Record<string, unknown>): void {
    if (this.channel?.readyState !== 'open') return;
    try {
      this.channel.send(JSON.stringify(event));
    } catch (error) {
      this.callbacks.onLog(`Could not send live event: ${String(error)}`);
    }
  }

  private appendTranscriptDelta(role: 'user' | 'assistant', delta: string): void {
    if (role === 'user') this.activeAssistantEntryId = undefined;
    else this.activeUserEntryId = undefined;

    const activeId = role === 'user' ? this.activeUserEntryId : this.activeAssistantEntryId;
    const existing = activeId ? this.entries.find((entry) => entry.id === activeId) : undefined;
    if (existing) {
      existing.text += delta;
    } else {
      const id = makeEventId(role === 'user' ? 'u' : 's');
      if (role === 'user') this.activeUserEntryId = id;
      else this.activeAssistantEntryId = id;
      this.entries.push({ id, kind: role, text: delta, streaming: true });
      if (this.entries.length > 40) this.entries.shift();
    }
    this.callbacks.onTranscriptUpdate(this.entries);
  }

  private pushSystemNote(text: string): void {
    this.activeUserEntryId = undefined;
    this.activeAssistantEntryId = undefined;
    this.appendEntry({ id: makeEventId('sys'), kind: 'system', text });
  }

  private appendEntry(entry: LiveTranscriptEntry): void {
    this.entries.push(entry);
    if (this.entries.length > 40) this.entries.shift();
    this.callbacks.onTranscriptUpdate(this.entries);
  }

  private setState(state: LiveConnectionState, detail?: string): void {
    this.state = state;
    this.callbacks.onStateChange(state, detail);
  }

  private cleanup(emitIdle: boolean): void {
    if (this.meterTimer !== undefined) {
      window.clearInterval(this.meterTimer);
      this.meterTimer = undefined;
    }
    this.channel?.close();
    this.channel = undefined;
    this.pc?.close();
    this.pc = undefined;
    if (this.localStream) {
      for (const track of this.localStream.getTracks()) track.stop();
      this.localStream = undefined;
    }
    if (this.remoteAudio) {
      this.remoteAudio.srcObject = null;
      this.remoteAudio.remove();
      this.remoteAudio = undefined;
    }
    void this.audioContext?.close().catch(() => {});
    this.audioContext = undefined;
    this.inputAnalyser = undefined;
    this.outputAnalyser = undefined;
    this.activeTools = 0;
    this.sessionId = undefined;
    this.lastContextSent = '';
    this.callbacks.onLevelUpdate({ input: 0, output: 0, speaking: false, toolRunning: false });
    if (emitIdle) this.setState('idle');
  }
}
