import { api, assetUrl, type ModerationKind, type ModerationItem } from '../api/client';
import { springShake, springStagger, springText } from './motion';
import { button, element, errorText, field, link, message, modal, section } from './dom';

export class AdminModal {
  private readonly surface = modal('Moderation');
  private readonly entries = element('div');
  private readonly passcode = element('input');
  private readonly submit = element('button', '', 'Load moderation queue');
  private busy = false;
  private generation = 0;

  constructor(private readonly onUpdate: () => void) {
    this.passcode.type = 'password';
    this.passcode.autocomplete = 'off';
    this.passcode.required = true;
    const form = element('form', 'form-stack');
    form.append(field('Admin passcode', this.passcode), this.submit);
    form.addEventListener('submit', (event) => { event.preventDefault(); void this.load(); });
    this.surface.body.append(form, this.entries);
    this.surface.dialog.addEventListener('close', () => {
      if (!this.surface.isOpen()) this.reset();
    });
  }

  open() {
    if (!this.surface.isOpen()) this.reset();
    this.surface.open();
  }

  private reset() {
    ++this.generation;
    this.busy = this.submit.disabled = false;
    this.passcode.value = '';
    this.entries.replaceChildren();
  }

  private current(generation: number) {
    return this.surface.isOpen() && this.generation === generation;
  }

  private async load() {
    if (this.busy || !this.surface.isOpen()) return;
    const generation = this.generation;
    this.busy = this.submit.disabled = true;
    this.entries.replaceChildren(message('Loading moderation queue…'));
    try {
      const { reviews, uploads } = await api.moderation(this.passcode.value);
      if (this.current(generation)) {
        this.entries.replaceChildren(this.list('Visit notes', 'review', reviews), this.list('Uploads', 'upload', uploads));
        springStagger(this.entries.querySelectorAll<HTMLElement>('.detail-section, .moderation-row'));
      }
    } catch (error) {
      if (this.current(generation)) {
        const failure = message('Could not load the queue. ' + errorText(error), true);
        this.entries.replaceChildren(failure);
        springShake(failure);
      }
    } finally { if (this.current(generation)) this.busy = this.submit.disabled = false; }
  }

  private list(title: string, type: ModerationKind, items: ModerationItem[]) {
    const generation = this.generation;
    const result = section(title);
    const pending = items.filter((item) => !item.status || item.status === 'pending_review' || item.status === 'needs_review');
    if (!pending.length) result.append(message('Nothing pending review.'));
    for (const item of pending) {
      const row = element('article', 'moderation-row');
      row.append(
        element('strong', '', item.author_label ?? item.filename ?? item.id),
        element('p', 'muted', item.place_id),
      );
      if (item.text) row.append(element('p', '', item.text));
      if (item.url) {
        try { row.append(link('Inspect upload', assetUrl(item.url))); }
        catch { row.append(message('Upload link is invalid.', true)); }
      }
      const feedback = element('p', 'message');
      feedback.setAttribute('role', 'status');
      const actions = element('div', 'button-row');
      for (const action of ['approve', 'reject'] as const) {
        actions.append(button(action === 'approve' ? 'Approve' : 'Reject', async () => {
          if (!this.current(generation)) return;
          const buttons = Array.from(actions.querySelectorAll('button'));
          buttons.forEach((control) => { control.disabled = true; });
          springText(feedback, 'Saving decision…');
          try {
            await api.moderate(type, item.id, action, this.passcode.value);
            this.onUpdate();
            if (this.current(generation)) await this.load();
          } catch (error) {
            if (!this.current(generation)) return;
            springText(feedback, errorText(error));
            springShake(feedback);
            feedback.classList.add('error');
            buttons.forEach((control) => { control.disabled = false; });
          }
        }));
      }
      row.append(actions, feedback);
      result.append(row);
    }
    return result;
  }
}
