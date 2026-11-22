import type { VoiceState, VoiceTranscript } from '../voice/RealtimeVoice';
import { button, element, icon } from './dom.ts';

export interface LiveVoiceDockActions {
  startVoice(): void;
  enableAudio(): void;
  stop(): void;
  toggleMute(): void;
  sendText(text: string): boolean;
  opened?(): void;
}

const stateLabels: Record<VoiceState, string> = {
  idle: 'GPT Live', connecting: 'Connecting…', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', error: 'GPT Live',
};

export class LiveVoiceDock {
  readonly trigger: HTMLButtonElement;
  readonly root = element('section', 'voice-dock panel');
  private readonly triggerLabel = element('span', 'voice-label', 'GPT Live');
  private readonly statusBadge = element('span', 'voice-state', 'Ready');
  private readonly modelMeta = element('span', 'voice-model', 'gpt-live-1.1');
  private readonly errorNote = element('p', 'message error');
  private readonly feed = element('div', 'voice-feed');
  private readonly connectBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly endBtn: HTMLButtonElement;
  private readonly audioBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly form = element('form', 'voice-input-row');
  private readonly input = element('input');
  private readonly sendBtn: HTMLButtonElement;
  private state: VoiceState = 'idle';
  private hasMic = false;
  private requestingMic = false;
  private muted = false;
  private paused = false;
  private hasTranscript = false;

  private readonly actions: LiveVoiceDockActions;

  constructor(actions: LiveVoiceDockActions) {
    this.actions = actions;
    this.trigger = button('', () => this.setOpen(this.root.hidden), 'voice-trigger');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', 'faresight-voice-dock');
    this.trigger.setAttribute('aria-label', 'GPT Live');
    this.trigger.dataset.state = 'idle';
    const glyph = element('span', 'voice-glyph');
    const bars = element('span', 'voice-bars');
    bars.append(element('i'), element('i'), element('i'));
    glyph.setAttribute('aria-hidden', 'true');
    glyph.append(icon('mic'), element('span', 'voice-spinner'), bars, icon('alert'));
    this.trigger.append(glyph, this.triggerLabel);

    this.root.id = 'faresight-voice-dock';
    this.root.setAttribute('aria-label', 'Vantage Live Voice Assistant');
    this.root.hidden = true;

    const head = element('header', 'voice-head');
    const titleWrap = element('div', 'voice-title-wrap');
    titleWrap.append(this.statusBadge, this.modelMeta);
    this.closeBtn = button('Hide', () => this.setOpen(false), 'quiet');
    this.closeBtn.setAttribute('aria-label', 'Hide GPT Live');
    head.append(titleWrap, this.closeBtn);
    this.statusBadge.id = 'faresight-voice-state';
    this.statusBadge.setAttribute('role', 'status');
    this.errorNote.setAttribute('role', 'alert');
    this.errorNote.hidden = true;

    this.connectBtn = button('Start voice', () => this.actions.startVoice(), 'accent');
    this.muteBtn = button('Mute mic', () => this.actions.toggleMute());
    this.muteBtn.setAttribute('aria-pressed', 'false');
    this.endBtn = button('End session', () => this.actions.stop(), 'quiet');
    this.audioBtn = button('Enable audio', () => this.actions.enableAudio());
    this.audioBtn.hidden = true;
    this.muteBtn.hidden = true;
    this.endBtn.hidden = true;

    const controls = element('div', 'voice-controls');
    controls.append(this.connectBtn, this.muteBtn, this.audioBtn, this.endBtn);

    this.feed.setAttribute('role', 'log');
    this.feed.setAttribute('aria-live', 'polite');

    this.input.type = 'text';
    this.input.placeholder = 'Ask Vantage…';
    this.input.setAttribute('aria-label', 'Message Vantage');
    this.input.setAttribute('aria-describedby', this.statusBadge.id);
    this.sendBtn = element('button', '', 'Send');
    this.sendBtn.type = 'submit';
    this.form.append(this.input, this.sendBtn);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (!text || this.sendBtn.disabled) return;
      if (this.actions.sendText(text)) this.input.value = '';
      else if (this.state !== 'error') this.setNotice('Wait for GPT Live to finish, then send again.');
    });

    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // The key closes the dock and goes no further, so it does not also step the scene back.
      event.preventDefault();
      event.stopPropagation();
      this.setOpen(false);
    });

    this.root.append(head, this.errorNote, controls, this.feed, this.form);
    this.renderEmptyFeed();
    this.renderControls();
  }

  setOpen(open: boolean): void {
    if (open === !this.root.hidden) return;
    const restore = !open && this.root.contains(document.activeElement);
    this.root.hidden = !open;
    this.trigger.setAttribute('aria-expanded', String(open));
    if (restore) this.trigger.focus({ preventScroll: true });
    if (open) this.actions.opened?.();
  }

  setModel(model: string): void {
    this.modelMeta.textContent = model;
  }

  setState(state: VoiceState, detail?: string): void {
    if (state === 'connecting' && this.state !== state) this.renderEmptyFeed();
    this.state = state;
    this.root.dataset.state = state;
    this.trigger.dataset.state = state;
    if (detail || state === 'idle' || state === 'connecting') this.setNotice(detail);
    this.renderControls();
    if (state === 'error') this.setOpen(true);
  }

  setNotice(detail?: string): void {
    this.errorNote.textContent = detail ?? '';
    this.errorNote.hidden = !detail;
  }

  restoreDraft(text: string): void {
    if (!this.input.value) this.input.value = text;
  }

  setMicrophone(hasMic: boolean, muted: boolean, requesting: boolean): void {
    this.hasMic = hasMic;
    this.muted = muted;
    this.requestingMic = requesting;
    this.renderControls();
  }

  setAudioBlocked(blocked: boolean): void {
    this.audioBtn.hidden = !blocked;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
    this.renderControls();
  }

  private renderControls(): void {
    const { state } = this;
    const live = state === 'listening' || state === 'thinking' || state === 'speaking';
    const started = live || state === 'connecting';
    this.connectBtn.hidden = this.hasMic || state === 'connecting';
    this.connectBtn.disabled = this.requestingMic;
    this.connectBtn.textContent = this.requestingMic ? 'Waiting for mic…' : live ? 'Enable mic' : 'Start voice';
    this.muteBtn.hidden = !live || !this.hasMic;
    this.muteBtn.textContent = this.muted ? 'Unmute mic' : 'Mute mic';
    this.muteBtn.setAttribute('aria-pressed', String(this.muted));
    this.endBtn.hidden = !started;
    this.endBtn.textContent = state === 'connecting' ? 'Cancel' : 'End session';
    this.sendBtn.disabled = state === 'connecting' || state === 'thinking' || state === 'speaking';
    const micActive = this.hasMic && !this.muted && !this.paused;
    const label = state === 'listening' && !micActive ? 'GPT Live' : stateLabels[state];
    this.triggerLabel.textContent = label;
    this.trigger.setAttribute('aria-label', label === 'GPT Live' ? label : `${label}, GPT Live`);
    this.trigger.dataset.micActive = String(micActive);
    this.statusBadge.textContent = state === 'idle' ? 'Ready' : state === 'error' ? 'Connection error'
      : state === 'listening' && !this.hasMic ? 'Text chat' : state === 'listening' && this.muted ? 'Mic muted'
        : state === 'listening' && this.paused ? 'Standby' : stateLabels[state];
  }

  appendTranscript(entry: VoiceTranscript): void {
    if (entry.id) {
      const text = this.feed.querySelector<HTMLParagraphElement>(`[data-entry-id="${CSS.escape(entry.id)}"] p`);
      if (text) {
        text.textContent = entry.text;
        this.feed.scrollTop = this.feed.scrollHeight;
        return;
      }
    }
    if (!this.hasTranscript) this.feed.replaceChildren();
    this.hasTranscript = true;
    const row = element('div', `voice-entry voice-entry-${entry.kind}`);
    if (entry.id) row.dataset.entryId = entry.id;
    const who = entry.kind === 'user' ? 'You' : entry.kind === 'assistant' ? 'Vantage' : 'Action';
    row.append(element('span', 'voice-who', who), element('p', '', entry.text));
    this.feed.append(row);
    if (this.feed.childElementCount > 40) this.feed.firstElementChild?.remove();
    this.feed.scrollTop = this.feed.scrollHeight;
  }

  private renderEmptyFeed(): void {
    this.hasTranscript = false;
    this.feed.replaceChildren(
      element('p', 'message', 'Try “Open Shu Daxia Hot Pot” or “Show me two 3D dishes to compare.”'),
    );
  }
}
