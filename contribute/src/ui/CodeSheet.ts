import { ApiError } from '../api';
import { button, el, errorText, haptic, icon, replay } from '../dom';
import { inviteCode } from '../store';

/** Bottom sheet that asks for the upload code once and keeps it on the device. */
export class CodeSheet {
  private readonly dialog = el('dialog', 'sheet-dialog');
  private readonly input = el('input', 'code-input');
  private readonly note = el('p', 'sheet-note');
  private readonly feedback = el('p', 'form-error');
  private readonly save: HTMLButtonElement;
  private readonly forget: HTMLButtonElement;
  private resolve?: (saved: boolean) => void;
  private busy = false;

  constructor() {
    const form = el('form', 'sheet-form');
    const head = el('header', 'sheet-head');
    const badge = el('span', 'sheet-badge');
    badge.append(icon('key'));
    const title = el('h2', '', 'Contributor upload code');
    title.id = 'code-sheet-title';
    head.append(badge, title);
    this.dialog.setAttribute('aria-labelledby', title.id);

    this.input.type = 'text';
    this.input.name = 'upload-code';
    this.input.autocomplete = 'off';
    this.input.autocapitalize = 'none';
    this.input.spellcheck = false;
    this.input.enterKeyHint = 'done';
    this.input.placeholder = 'Code from your FareSight host';
    this.input.setAttribute('aria-label', 'Upload code');
    this.input.addEventListener('input', () => { this.feedback.textContent = ''; });
    this.feedback.setAttribute('role', 'alert');

    this.save = el('button', 'primary', 'Save code');
    this.save.type = 'submit';
    this.forget = button('Forget saved code', () => {
      inviteCode.forget();
      this.close(false);
    }, 'ghost');
    const cancel = button('Not now', () => this.close(false), 'ghost');
    const actions = el('div', 'sheet-actions');
    actions.append(this.save, cancel, this.forget);
    form.append(head, this.note, this.input, this.feedback, actions);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });
    this.dialog.append(form);
    this.dialog.addEventListener('close', () => {
      this.resolve?.(false);
      this.resolve = undefined;
    });
    this.dialog.addEventListener('click', (event) => { if (event.target === this.dialog) this.close(false); });
    document.body.append(this.dialog);
  }

  /** Opens the sheet. Resolves true once a working code is saved. */
  ask(reason = ''): Promise<boolean> {
    if (this.dialog.open) this.close(false);
    this.note.textContent = inviteCode.status === 'open'
      ? 'This FareSight server accepts photos without a code.'
      : 'Enter the upload code from your FareSight host. This phone remembers it for future scans.';
    this.feedback.textContent = reason;
    this.input.value = inviteCode.current;
    this.forget.hidden = !inviteCode.current;
    this.input.disabled = this.save.disabled = inviteCode.status === 'open';
    this.dialog.showModal();
    if (!this.input.disabled) this.input.focus();
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  private close(saved: boolean) {
    const resolve = this.resolve;
    this.resolve = undefined;
    this.dialog.close();
    resolve?.(saved);
  }

  private async submit() {
    const value = this.input.value.trim();
    if (this.busy) return;
    if (!value) {
      this.fail('Enter the code first.');
      return;
    }
    this.busy = true;
    this.save.disabled = true;
    this.save.textContent = 'Checking…';
    try {
      if (await inviteCode.save(value)) {
        haptic([8, 40, 12]);
        this.close(true);
      } else this.fail('That code was not accepted. Check it and try again.');
    } catch (error) {
      this.fail(errorText(error));
    } finally {
      this.busy = false;
      this.save.disabled = false;
      this.save.textContent = 'Save code';
    }
  }

  private fail(text: string) {
    this.feedback.textContent = text;
    replay(this.input, 'is-shaking');
    this.input.focus();
  }
}

export const codeSheet = new CodeSheet();
const CODE_REQUIRED = 'An upload code is needed to send photos.';

/**
 * Runs a request that needs the upload code. Asks for the code when none is saved,
 * and asks again if the server rejects the one on file.
 */
export async function withCode<T>(run: (code: string) => Promise<T>): Promise<T> {
  if (inviteCode.status === 'needed' && !(await codeSheet.ask())) throw new Error(CODE_REQUIRED);
  for (let attempt = 0; ; attempt++) {
    try {
      return await run(inviteCode.current);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401 || attempt >= 2) throw error;
      inviteCode.forget();
      if (!(await codeSheet.ask('That code was not accepted. Enter a current one.'))) throw new Error(CODE_REQUIRED);
    }
  }
}
