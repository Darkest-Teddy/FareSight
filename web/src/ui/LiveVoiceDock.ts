import type { VoiceState, VoiceTranscript } from '../voice/RealtimeVoice';
import { button, element } from './dom';

export interface LiveVoiceDockActions {
  toggle(): void;
  stop(): void;
  toggleMute(): void;
  sendText(text: string): boolean;
}

const stateLabels: Record<VoiceState, string> = {
  idle: 'GPT Live', connecting: 'Connecting…', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', error: 'GPT Live',
};

export class LiveVoiceDock {
  readonly trigger: HTMLButtonElement;
  readonly root = element('section', 'voice-dock panel');
  private readonly triggerDot = element('span', 'voice-dot');
  private readonly triggerLabel = element('span', '', 'GPT Live');
  private readonly statusBadge = element('span', 'voice-state', 'Ready');
  private readonly modelMeta = element('span', 'voice-model', 'gpt-live-1.1');
  private readonly errorNote = element('p', 'message error');
  private readonly feed = element('div', 'voice-feed');
  private readonly connectBtn: HTMLButtonElement;
  private readonly muteBtn: HTMLButtonElement;
  private readonly endBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly form = element('form', 'voice-input-row');
  private readonly input = element('input');
  private readonly sendBtn: HTMLButtonElement;
  private state: VoiceState = 'idle';
  private hasTranscript = false;

  constructor(private readonly actions: LiveVoiceDockActions) {
    this.trigger = button('', () => this.handleTriggerClick(), 'voice-trigger');
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', 'faresight-voice-dock');
    this.trigger.setAttribute('aria-pressed', 'false');
    this.triggerDot.setAttribute('aria-hidden', 'true');
    this.trigger.append(this.triggerDot, this.triggerLabel);

    this.root.id = 'faresight-voice-dock';
    this.root.setAttribute('aria-label', 'FareSight Live Voice Assistant');
    this.root.hidden = true;

    const head = element('header', 'voice-head');
    const titleWrap = element('div', 'voice-title-wrap');
    titleWrap.append(this.statusBadge, this.modelMeta);
    this.closeBtn = button('Hide', () => this.setOpen(false), 'quiet');
    head.append(titleWrap, this.closeBtn);
    this.statusBadge.setAttribute('role', 'status');
    this.errorNote.setAttribute('role', 'alert');
    this.errorNote.hidden = true;

    this.connectBtn = button('Start GPT Live', () => this.actions.toggle(), 'accent');
    this.muteBtn = button('Mute mic', () => this.actions.toggleMute());
    this.muteBtn.setAttribute('aria-pressed', 'false');
    this.endBtn = button('End session', () => this.actions.stop(), 'quiet');
    this.muteBtn.hidden = true;
    this.endBtn.hidden = true;

    const controls = element('div', 'voice-controls');
    controls.append(this.connectBtn, this.muteBtn, this.endBtn);

    this.feed.setAttribute('role', 'log');
    this.feed.setAttribute('aria-live', 'polite');

    this.input.type = 'text';
    this.input.placeholder = 'Or type a command while live…';
    this.input.setAttribute('aria-label', 'Send text command to Live AI');
    this.sendBtn = element('button', '', 'Send');
    this.sendBtn.type = 'submit';
    this.form.append(this.input, this.sendBtn);
    this.form.hidden = true;
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      if (!text) return;
      if (this.actions.sendText(text)) this.input.value = '';
    });

    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        this.setOpen(false);
        this.trigger.focus();
      }
    });

    this.root.append(head, this.errorNote, controls, this.feed, this.form);
    this.renderEmptyFeed();
  }

  private handleTriggerClick(): void {
    this.setOpen(this.state === 'idle' || this.state === 'error');
    this.actions.toggle();
  }

  setOpen(open: boolean): void {
    this.root.hidden = !open;
    this.trigger.setAttribute('aria-expanded', String(open));
  }

  setModel(model: string): void {
    this.modelMeta.textContent = model;
  }

  setState(state: VoiceState, detail?: string): void {
    this.state = state;
    this.root.dataset.state = state;
    this.trigger.dataset.state = state;
    const live = state === 'listening' || state === 'thinking' || state === 'speaking';
    const started = live || state === 'connecting';
    this.connectBtn.hidden = started;
    this.connectBtn.textContent = state === 'error' ? 'Retry GPT Live' : 'Start GPT Live';
    this.muteBtn.hidden = !live;
    this.endBtn.hidden = !started;
    this.endBtn.textContent = state === 'connecting' ? 'Cancel' : 'End session';
    this.form.hidden = !live;
    this.trigger.setAttribute('aria-pressed', String(started));
    this.triggerLabel.textContent = stateLabels[state];
    this.statusBadge.textContent = state === 'error' ? 'Connection error' : stateLabels[state];
    this.errorNote.textContent = detail ?? '';
    this.errorNote.hidden = !detail;
    if (state === 'error') {
      this.setOpen(true);
    } else if (state === 'connecting') {
      this.renderEmptyFeed();
    } else if (state === 'idle') {
      this.setOpen(false);
    }
  }

  setMuted(muted: boolean): void {
    this.muteBtn.textContent = muted ? 'Unmute mic' : 'Mute mic';
    this.muteBtn.setAttribute('aria-pressed', String(muted));
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
    const who = entry.kind === 'user' ? 'You' : entry.kind === 'assistant' ? 'FareSight' : 'Action';
    row.append(element('span', 'voice-who', who), element('p', '', entry.text));
    this.feed.append(row);
    if (this.feed.childElementCount > 40) this.feed.firstElementChild?.remove();
    this.feed.scrollTop = this.feed.scrollHeight;
  }

  private renderEmptyFeed(): void {
    this.hasTranscript = false;
    this.feed.replaceChildren(
      element('p', 'message', 'Try “Open Tsuru Tonkotsu Ramen” or “Show me two 3D dishes to compare.”'),
    );
  }
}
