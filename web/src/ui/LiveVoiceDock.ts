import type { VoiceState, VoiceTranscript } from '../voice/RealtimeVoice';
import { button, element, icon } from './dom';

export interface LiveVoiceDockActions {
  toggle(): void;
  stop(): void;
  toggleMute(): void;
  sendText(text: string): boolean;
  onOpen(): void;
}

const stateLabels: Record<VoiceState, string> = {
  idle: 'Ask FareSight', connecting: 'Connecting…', listening: 'Listening', thinking: 'Thinking', speaking: 'Speaking', error: 'Ask FareSight',
};

export class LiveVoiceDock {
  readonly trigger: HTMLButtonElement;
  readonly root = element('section', 'voice-dock panel');
  private readonly triggerDot = element('span', 'voice-dot');
  private readonly triggerLabel = element('span', 'voice-trigger-label', stateLabels.idle);
  private readonly statusBadge = element('span', 'voice-state', 'Ready');
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

  constructor(private readonly actions: LiveVoiceDockActions, private readonly mobile: MediaQueryList) {
    this.trigger = button('', () => this.handleTriggerClick(), 'voice-trigger');
    this.trigger.setAttribute('aria-label', stateLabels.idle);
    this.trigger.setAttribute('aria-expanded', 'false');
    this.trigger.setAttribute('aria-controls', 'faresight-voice-dock');
    this.triggerDot.setAttribute('aria-hidden', 'true');
    this.trigger.append(icon('mic'), this.triggerDot, this.triggerLabel);

    this.root.id = 'faresight-voice-dock';
    this.root.setAttribute('aria-label', 'Ask FareSight');
    this.root.hidden = true;

    const head = element('header', 'voice-head');
    this.closeBtn = button('', () => this.dismiss(), 'quiet icon-button');
    this.closeBtn.setAttribute('aria-label', 'Hide voice controls');
    this.closeBtn.append(icon('close'));
    head.append(element('h2', '', 'Ask FareSight'), this.closeBtn);
    this.statusBadge.setAttribute('role', 'status');
    this.errorNote.setAttribute('role', 'alert');
    this.errorNote.hidden = true;

    this.connectBtn = button('Start voice', () => this.actions.toggle(), 'accent');
    this.muteBtn = button('Mute mic', () => this.actions.toggleMute());
    this.muteBtn.setAttribute('aria-pressed', 'false');
    this.endBtn = button('End session', () => this.actions.stop(), 'quiet');
    this.muteBtn.hidden = true;
    this.endBtn.hidden = true;

    const controls = element('div', 'voice-controls');
    controls.append(this.statusBadge, this.connectBtn, this.muteBtn, this.endBtn);

    this.feed.setAttribute('role', 'log');
    this.feed.setAttribute('aria-live', 'polite');

    this.input.type = 'text';
    this.input.placeholder = 'Or type a command while live…';
    this.input.setAttribute('aria-label', 'Send a message to FareSight');
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

    this.root.append(head, this.errorNote, controls, this.feed, this.form);
    this.renderEmptyFeed();
  }

  private handleTriggerClick(): void {
    if (this.mobile.matches) {
      this.setOpen(this.state === 'idle' || this.state === 'error');
      this.actions.toggle();
    } else if (this.root.hidden) {
      this.setOpen(true);
      (this.connectBtn.hidden ? this.closeBtn : this.connectBtn).focus();
    } else {
      this.dismiss();
    }
  }

  dismiss(): void {
    this.setOpen(false);
    this.trigger.focus();
  }

  setOpen(open: boolean): void {
    if (open) this.actions.onOpen();
    this.root.hidden = !open;
    this.trigger.setAttribute('aria-expanded', String(open));
  }

  setState(state: VoiceState, detail?: string): void {
    const focus = document.activeElement;
    this.state = state;
    this.root.dataset.state = state;
    this.trigger.dataset.state = state;
    const live = state === 'listening' || state === 'thinking' || state === 'speaking';
    const started = live || state === 'connecting';
    this.connectBtn.hidden = started;
    this.connectBtn.textContent = state === 'error' ? 'Retry voice' : 'Start voice';
    this.muteBtn.hidden = !live;
    this.endBtn.hidden = !started;
    this.endBtn.textContent = state === 'connecting' ? 'Cancel' : 'End session';
    this.form.hidden = !live;
    this.triggerLabel.textContent = stateLabels[state];
    this.trigger.setAttribute('aria-label', stateLabels[state]);
    this.statusBadge.textContent = state === 'error' ? 'Connection error' : state === 'idle' ? 'Ready' : stateLabels[state];
    this.errorNote.textContent = detail ?? '';
    this.errorNote.hidden = !detail;
    if (state === 'error') {
      this.setOpen(true);
      if (focus === this.endBtn || focus === this.muteBtn) this.connectBtn.focus();
    } else if (state === 'connecting') {
      this.renderEmptyFeed();
      if (focus === this.connectBtn) this.endBtn.focus();
    } else if (state === 'idle') {
      if (this.root.contains(focus)) this.dismiss();
      else this.setOpen(false);
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
