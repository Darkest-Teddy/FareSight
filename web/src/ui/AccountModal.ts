import type { AuthStatus, AuthUser } from '@faresight/shared';
import { auth } from '../api/discoverClient';
import { button, element, iconButton } from './dom';

/**
 * Sign in and registration for contributors.
 *
 * Accounts exist only for people who add places; browsing needs none (specification D3). So this
 * is not a gate in front of the app, it is a dialog that opens when somebody tries to contribute.
 *
 * Two ways in, as asked: email with a password, and Google. The Google button only appears when
 * the server reports a client id, because a button that cannot work is worse than no button.
 */
export class AccountModal {
  readonly root = element('div', 'account-modal');

  private readonly dialog = element('div', 'account-dialog');
  private readonly form = element('form', 'account-form');
  private readonly emailInput = element('input', 'account-input');
  private readonly passwordInput = element('input', 'account-input');
  private readonly nameInput = element('input', 'account-input');
  private readonly nameField = element('label', 'account-field');
  private readonly submitButton: HTMLButtonElement;
  private readonly switchButton: HTMLButtonElement;
  private readonly errorLine = element('p', 'account-error');
  private readonly googleHost = element('div', 'account-google');
  private readonly divider = element('div', 'account-divider');
  private readonly title = element('h2', 'account-title');
  private readonly subtitle = element('p', 'account-subtitle');

  private registering = false;
  private busy = false;
  private status?: AuthStatus;
  private googleLoaded = false;

  constructor(private readonly onSignedIn: (user: AuthUser) => void) {
    this.root.hidden = true;
    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !this.root.hidden) this.close();
    });

    this.emailInput.type = 'email';
    this.emailInput.autocomplete = 'email';
    this.emailInput.required = true;
    this.emailInput.placeholder = 'you@example.com';
    this.passwordInput.type = 'password';
    this.passwordInput.required = true;
    this.passwordInput.placeholder = 'At least 12 characters';
    this.nameInput.type = 'text';
    this.nameInput.autocomplete = 'name';
    this.nameInput.placeholder = 'Shown on the places you add';

    this.nameField.append(element('span', '', 'Display name'), this.nameInput);
    const emailField = element('label', 'account-field');
    emailField.append(element('span', '', 'Email'), this.emailInput);
    const passwordField = element('label', 'account-field');
    passwordField.append(element('span', '', 'Password'), this.passwordInput);

    this.submitButton = button('Sign in', () => undefined, 'accent account-submit');
    this.submitButton.type = 'submit';
    this.errorLine.hidden = true;
    this.errorLine.setAttribute('role', 'alert');

    this.form.append(this.nameField, emailField, passwordField, this.errorLine, this.submitButton);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.submit();
    });

    this.switchButton = button('', () => this.setRegistering(!this.registering), 'account-switch');
    this.divider.append(element('span', '', 'or'));

    const close = iconButton('close', 'Close', () => this.close(), 'account-close');
    close.setAttribute('aria-label', 'Close');

    this.dialog.setAttribute('role', 'dialog');
    this.dialog.setAttribute('aria-modal', 'true');
    this.dialog.append(close, this.title, this.subtitle, this.googleHost, this.divider, this.form, this.switchButton);
    this.root.append(this.dialog);
    this.setRegistering(false);
  }

  async open(): Promise<void> {
    this.root.hidden = false;
    this.errorLine.hidden = true;
    this.emailInput.focus();
    try {
      this.status = await auth.status();
    } catch {
      this.status = undefined;
    }
    if (!this.status?.enabled) {
      this.showError('Accounts are not available: this server has no database configured.');
      this.submitButton.disabled = true;
      return;
    }
    this.submitButton.disabled = false;
    void this.mountGoogle();
  }

  close(): void {
    this.root.hidden = true;
  }

  private setRegistering(registering: boolean) {
    this.registering = registering;
    this.title.textContent = registering ? 'Create an account' : 'Sign in';
    this.subtitle.textContent = registering
      ? 'An account lets you add places and keeps your scans together.'
      : 'Sign in to add a place or check on a scan.';
    this.nameField.hidden = !registering;
    this.submitButton.textContent = registering ? 'Create account' : 'Sign in';
    this.passwordInput.autocomplete = registering ? 'new-password' : 'current-password';
    this.switchButton.textContent = registering
      ? 'Already have an account? Sign in'
      : 'New here? Create an account';
    this.errorLine.hidden = true;
  }

  private async submit() {
    if (this.busy) return;
    const email = this.emailInput.value.trim();
    const password = this.passwordInput.value;
    // Checked here as well as on the server so the message arrives without a round trip.
    if (this.registering && password.length < 12) {
      this.showError('Password must be at least 12 characters.');
      return;
    }
    this.setBusy(true);
    try {
      const user = this.registering
        ? await auth.register(email, password, this.nameInput.value.trim() || undefined)
        : await auth.login(email, password);
      this.close();
      this.onSignedIn(user);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'Could not sign in.');
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Loads Google Identity Services and renders its button.
   *
   * The script is only fetched once a sign-in is actually attempted, so a visitor who never
   * contributes is never asked to load a third-party script.
   */
  private async mountGoogle() {
    const clientId = this.status?.google_client_id;
    // Hidden rather than disabled: a Google button that cannot reach Google is only confusing.
    this.googleHost.hidden = !clientId;
    this.divider.hidden = !clientId;
    if (!clientId || this.googleLoaded) return;
    try {
      await loadScript('https://accounts.google.com/gsi/client');
      const google = (window as unknown as { google?: GoogleIdentity }).google;
      if (!google) throw new Error('Google Identity Services did not load');
      google.accounts.id.initialize({
        client_id: clientId,
        callback: ({ credential }) => void this.signInWithGoogle(credential),
      });
      google.accounts.id.renderButton(this.googleHost, {
        theme: 'filled_black', size: 'large', width: 320, text: 'continue_with',
      });
      this.googleLoaded = true;
    } catch {
      // Email and password still work, so this is a quiet degradation rather than an error.
      this.googleHost.hidden = true;
      this.divider.hidden = true;
    }
  }

  private async signInWithGoogle(credential: string) {
    this.setBusy(true);
    try {
      const user = await auth.google(credential);
      this.close();
      this.onSignedIn(user);
    } catch (error) {
      this.showError(error instanceof Error ? error.message : 'Google sign-in failed.');
    } finally {
      this.setBusy(false);
    }
  }

  private setBusy(busy: boolean) {
    this.busy = busy;
    this.submitButton.disabled = busy;
    this.submitButton.textContent = busy
      ? (this.registering ? 'Creating…' : 'Signing in…')
      : (this.registering ? 'Create account' : 'Sign in');
  }

  private showError(message: string) {
    this.errorLine.hidden = false;
    this.errorLine.textContent = message;
  }
}

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(options: { client_id: string; callback: (response: { credential: string }) => void }): void;
      renderButton(host: HTMLElement, options: Record<string, unknown>): void;
    };
  };
}

const scripts = new Map<string, Promise<void>>();

/** Loads a script once, reusing the same promise for every later caller. */
function loadScript(src: string): Promise<void> {
  const existing = scripts.get(src);
  if (existing) return existing;
  const pending = new Promise<void>((resolve, reject) => {
    const node = document.createElement('script');
    node.src = src;
    node.async = true;
    node.onload = () => resolve();
    node.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(node);
  });
  scripts.set(src, pending);
  return pending;
}
