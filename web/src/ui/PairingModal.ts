import type { PairingMessage } from '@faresight/shared';
import { api, connectPair, type PairMessage } from '../api/client';
import { springBump, springShake, springText, springVisible } from './motion';
import { button, element, errorText, field, modal } from './dom';

export class PairingModal {
  private readonly surface = modal('Pair Quest');
  private readonly codeReadout = element('output', 'pair-code');
  private readonly status = element('p', 'message');
  private readonly feedback = element('p', 'message');
  private readonly create: HTMLButtonElement;
  private readonly disconnect: HTMLButtonElement;
  private socket?: WebSocket;
  private peers = 0;
  private code = '';
  private creating = false;
  private pending?: PairingMessage;
  private lastPeer = 0;
  private heartbeat?: number;

  constructor(private readonly receive: (message: PairMessage) => void, private readonly onChange: (paired: boolean) => void) {
    const { body } = this.surface;
    this.status.setAttribute('role', 'status');
    this.feedback.setAttribute('role', 'status');
    const intro = element('p', '', 'Open Vantage on both devices. Create a code on one and enter it on the other.');
    this.create = button('Create pairing code', () => void this.createCode(), 'accent');
    this.disconnect = button('Disconnect', () => this.closeConnection(), 'quiet');
    const codeForm = element('form', 'form-stack');
    const code = element('input');
    code.autocapitalize = 'characters';
    code.spellcheck = false;
    code.autocomplete = 'off';
    code.pattern = '[A-HJ-NP-Za-hj-np-z2-9]{6}';
    code.maxLength = 6;
    code.required = true;
    code.placeholder = 'ABCD23';
    code.addEventListener('input', () => { code.value = code.value.toUpperCase(); });
    const join = element('button', '', 'Join with code');
    codeForm.append(field('Six-character code', code), join);
    codeForm.addEventListener('submit', (event) => {
      event.preventDefault();
      const normalized = code.value.toUpperCase();
      if (/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) this.connect(normalized);
    });
    const actions = element('div', 'button-row');
    actions.append(this.create, this.disconnect);
    body.append(intro, this.codeReadout, this.status, actions, codeForm, this.feedback);
    this.render('Disconnected');
  }

  open() { this.surface.open(); }

  close() { this.surface.close(); }

  send(message: PairingMessage) {
    if (this.socket?.readyState === WebSocket.OPEN && this.peers > 1) {
      this.socket.send(JSON.stringify(message));
      springText(this.feedback, message.type === 'send_trip' ? 'Trip sent.' : 'Venue sent.');
      return true;
    }
    this.pending = message;
    springText(this.feedback, 'Pair a device to send this view.');
    this.open();
    return false;
  }

  private async createCode() {
    this.creating = true;
    this.render('Creating code…');
    try { this.connect((await api.createPair()).code); }
    catch (error) { this.render('Could not create a code. ' + errorText(error), true); }
    finally {
      this.creating = false;
      this.create.disabled = false;
    }
  }

  private connect(code: string) {
    this.closeConnection(false);
    this.code = code;
    this.feedback.textContent = '';
    this.render('Connecting…');
    const socket = connectPair(code, (message) => {
      if (socket !== this.socket) return;
      if (message.type === 'peer_joined') {
        this.peers = message.peers;
        if (this.peers > 1) this.lastPeer = Date.now();
        this.showPeerStatus();
      } else if (message.type === 'sync_filters' && 'faresight_heartbeat' in message) {
        this.lastPeer = Date.now();
        if (this.peers < 2) { this.peers = 2; this.showPeerStatus(); }
      } else this.receive(message);
    });
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (socket !== this.socket) return;
      this.showPeerStatus();
      this.heartbeat = window.setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ type: 'sync_filters', filters: {}, faresight_heartbeat: true }));
        if (this.peers > 1 && Date.now() - this.lastPeer > 45_000) {
          this.peers = 1;
          this.showPeerStatus();
        }
      }, 12_000);
    });
    socket.addEventListener('close', (event) => {
      if (socket !== this.socket) return;
      this.closeConnection(false);
      this.render(event.reason || 'Connection closed. Rejoin with a code or create a new one.', true);
    });
  }

  private showPeerStatus() {
    this.render(this.peers > 1 ? 'Paired' : 'Waiting for peer');
    if (this.peers > 1 && this.pending) {
      const message = this.pending;
      this.pending = undefined;
      this.send(message);
    }
  }

  private closeConnection(clearPending = true) {
    const socket = this.socket;
    this.socket = undefined;
    window.clearInterval(this.heartbeat);
    socket?.close();
    this.peers = 0;
    this.code = '';
    if (clearPending) {
      this.pending = undefined;
      this.feedback.textContent = '';
    }
    this.render('Disconnected');
  }

  private render(label: string, isError = false) {
    if (springText(this.status, label) && isError) springShake(this.status);
    this.status.classList.toggle('error', isError);
    this.create.disabled = this.creating;
    if (!this.code && document.activeElement === this.disconnect) this.create.focus({ preventScroll: true });
    if (this.code && this.codeReadout.value !== this.code) {
      this.codeReadout.value = this.code;
      springBump(this.codeReadout);
    }
    springVisible(this.disconnect, !!this.code);
    springVisible(this.codeReadout, !!this.code, { from: 'translateY(4px) scale(.96)', preset: 'pop' });
    this.onChange(this.peers > 1);
  }
}
