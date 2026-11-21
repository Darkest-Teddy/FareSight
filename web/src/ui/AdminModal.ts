import { api, assetUrl, type ModerationKind, type ModerationItem } from '../api/client';
import { button, element, errorText, field, link, message, modal, section } from './dom';

export class AdminModal {
  private readonly surface = modal('Moderation');
  private readonly entries = element('div');
  private readonly passcode = element('input');
  private readonly submit = element('button', '', 'Load moderation queue');
  private busy = false;

  constructor(private readonly onUpdate: () => void) {
    this.passcode.type = 'password';
    this.passcode.autocomplete = 'off';
    this.passcode.required = true;
    const form = element('form', 'form-stack');
    form.append(field('Admin passcode', this.passcode), this.submit);
    form.addEventListener('submit', (event) => { event.preventDefault(); void this.load(); });
    this.surface.body.append(form, this.entries);
    this.surface.dialog.addEventListener('close', () => {
      this.passcode.value = '';
      this.entries.replaceChildren();
    });
  }

  open() { this.surface.open(); }

  private async load() {
    if (this.busy) return;
    this.busy = this.submit.disabled = true;
    this.entries.replaceChildren(message('Loading moderation queue…'));
    try {
      const { reviews, uploads } = await api.moderation(this.passcode.value);
      if (this.surface.dialog.open) this.entries.replaceChildren(this.list('Visit notes', 'review', reviews), this.list('Uploads', 'upload', uploads));
    } catch (error) {
      if (this.surface.dialog.open) this.entries.replaceChildren(message('Could not load the queue. ' + errorText(error), true));
    } finally { this.busy = this.submit.disabled = false; }
  }

  private list(title: string, type: ModerationKind, items: ModerationItem[]) {
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
          const buttons = Array.from(actions.querySelectorAll('button'));
          buttons.forEach((control) => { control.disabled = true; });
          feedback.textContent = 'Saving decision…';
          try {
            await api.moderate(type, item.id, action, this.passcode.value);
            this.onUpdate();
            await this.load();
          } catch (error) {
            feedback.textContent = errorText(error);
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
