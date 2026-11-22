import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { api } from '../src/api/client.ts';
import type { BriefingCard } from '../src/data/reviewBriefing.ts';
import { LiveVoiceDock } from '../src/ui/LiveVoiceDock.ts';
import { ReviewBriefingModal } from '../src/ui/ReviewBriefingModal.ts';
import { RealtimeVoice, type VoiceTranscript } from '../src/voice/RealtimeVoice.ts';

class TestElement extends EventTarget {
  children: TestElement[] = [];
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  hidden = false;
  disabled = false;
  isConnected = true;
  paused = true;
  srcObject: object | null = null;
  textContent = '';
  value = '';
  plays = 0;
  rejectPlay = false;

  readonly tagName: string;
  private readonly doc: { activeElement: TestElement | null };

  constructor(tagName: string, doc: { activeElement: TestElement | null }) {
    super();
    this.tagName = tagName;
    this.doc = doc;
  }

  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  append(...children: TestElement[]) { this.children.push(...children); }
  replaceChildren(...children: TestElement[]) { this.children = children; }
  contains(child: TestElement | null): boolean { return child === this || this.children.some((node) => node.contains(child)); }
  focus() { this.doc.activeElement = this; }
  scrollIntoView() {}
  remove() { this.isConnected = false; }
  pause() { this.paused = true; }
  async play() {
    this.plays++;
    if (this.rejectPlay) throw new DOMException('Blocked audio', 'NotAllowedError');
    this.paused = false;
  }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

function installDom(t: TestContext) {
  const doc = {
    activeElement: null as TestElement | null,
    createElement: (tag: string) => new TestElement(tag, doc),
  };
  const body = doc.createElement('body');
  const values = { document: { ...doc, get activeElement() { return doc.activeElement; }, body }, HTMLElement: TestElement, window: globalThis };
  for (const [key, value] of Object.entries(values)) replaceGlobal(t, key, value);
  return { body, doc };
}

function replaceGlobal(t: TestContext, key: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key);
  Object.defineProperty(globalThis, key, { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, key, previous);
    else Reflect.deleteProperty(globalThis, key);
  });
}

function find(node: TestElement, match: (node: TestElement) => boolean): TestElement | undefined {
  if (match(node)) return node;
  for (const child of node.children) {
    const result = find(child, match);
    if (result) return result;
  }
}

function keyed(key: string) {
  return Object.assign(new Event('keydown', { cancelable: true }), { key }) as KeyboardEvent;
}

test('desktop dock opens in idle, sends a draft and hides without touching the live session', (t) => {
  installDom(t);
  const sent: string[] = [];
  const actions: string[] = [];
  const dock = new LiveVoiceDock({
    startVoice: () => actions.push('start'),
    stop: () => actions.push('stop'),
    toggleMute: () => actions.push('mute'),
    enableAudio: () => actions.push('audio'),
    sendText: (text) => { sent.push(text); return true; },
  });
  const root = dock.root as unknown as TestElement;
  const trigger = dock.trigger as unknown as TestElement;
  const control = (name: string) => find(root, ({ tagName, textContent }) => tagName === 'button' && textContent === name)!;
  const form = find(root, ({ tagName }) => tagName === 'form')!;
  const input = find(form, ({ tagName }) => tagName === 'input')!;
  const submit = () => form.dispatchEvent(new Event('submit', { cancelable: true }));
  trigger.click();
  assert.equal(root.hidden, false);
  assert.equal(trigger.attributes.get('aria-expanded'), 'true');
  assert.equal(form.hidden, false);
  input.value = '  Open Kenmore  ';
  submit();
  assert.deepEqual(sent, ['Open Kenmore']);
  assert.equal(input.value, '');
  dock.setState('connecting');
  assert.equal(control('Cancel').hidden, false);
  dock.setState('listening');
  assert.equal(control('Enable mic').hidden, false);
  dock.setMicrophone(true, false, false);
  control('Hide').click();
  trigger.click();
  assert.equal(root.hidden, false);
  assert.deepEqual(actions, []);
  dock.setState('speaking');
  assert.equal(control('Send').disabled, true);
  input.value = 'Follow-up';
  submit();
  assert.equal(input.value, 'Follow-up');
  dock.setState('listening');
  submit();
  assert.deepEqual(sent, ['Open Kenmore', 'Follow-up']);
  control('Mute mic').click();
  dock.setMicrophone(true, true, false);
  assert.equal(control('Unmute mic').attributes.get('aria-pressed'), 'true');
  dock.setAudioBlocked(true);
  control('Enable audio').click();
  control('End session').click();
  assert.deepEqual(actions, ['mute', 'audio', 'stop']);
});

test('desktop briefing preserves outside focus, supports four tabs, actions and Escape', (t) => {
  const { doc } = installDom(t);
  const input = doc.createElement('input');
  input.focus();
  const opened: string[] = [];
  const dismissed: Array<string | undefined> = [];
  const panel = new ReviewBriefingModal({
    dismiss: (id) => { dismissed.push(id); if (!id) panel.hide(); },
    openVenue: (id) => opened.push(id),
    openDish: () => {},
    compareDishes: () => {},
    viewOnMap: () => {},
  });
  const root = panel.root as unknown as TestElement;
  const cards: BriefingCard[] = Array.from({ length: 4 }, (_, index) => ({
    id: String(index), title: 'Briefing ' + index,
    sections: [{ kind: 'text', body: 'Travel by train.' }],
    actions: [{ kind: 'venue', label: 'Open venue', placeId: 'venue-' + index }],
  }));
  panel.show(cards);
  assert.equal(root.tagName, 'section');
  assert.equal(root.hidden, false);
  assert.equal(root.attributes.get('aria-labelledby'), 'fare-briefing-title');
  assert.equal(doc.activeElement, input);
  const selected = find(root, ({ textContent }) => textContent === 'Briefing 1')!;
  selected.click();
  const open = find(root, ({ textContent }) => textContent === 'Open venue')!;
  open.focus();
  open.click();
  assert.deepEqual(opened, ['venue-1']);
  const claimedEscape = keyed('Escape');
  claimedEscape.preventDefault();
  panel.dismissOnEscape(claimedEscape);
  assert.equal(root.hidden, false);
  panel.dismissOnEscape(keyed('Escape'));
  assert.deepEqual(dismissed, [undefined]);
  assert.equal(root.hidden, true);
  assert.equal(doc.activeElement, input);
});

class TestChannel extends EventTarget {
  readyState = 'open';
  sent: Array<{ type: string; item?: Record<string, unknown> }> = [];
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  receive(event: object) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(event) })); }
  close() { this.readyState = 'closed'; this.dispatchEvent(new Event('close')); }
}

function setupVoice(t: TestContext) {
  let voice: RealtimeVoice;
  t.after(() => voice?.destroy());
  const { body } = installDom(t);
  const peers: TestPeer[] = [];
  class TestPeer {
    iceGatheringState = 'complete';
    localDescription = { sdp: 'test offer' };
    readonly channel = new TestChannel();
    ontrack?: (event: object) => void;
    sender = { replaceTrack: async (track: TestTrack) => { this.track = track; } };
    track?: TestTrack;
    closed = false;
    constructor() { peers.push(this); }
    addTransceiver(kind: string, options: { direction: string }) {
      assert.equal(kind, 'audio');
      assert.equal(options.direction, 'sendrecv');
      return { sender: this.sender };
    }
    async createOffer() { return this.localDescription; }
    async setLocalDescription() {}
    async setRemoteDescription() {}
    createDataChannel() { return this.channel; }
    close() { this.closed = true; }
  }
  class TestTrack extends EventTarget {
    enabled = true;
    stopped = false;
    stop() { this.stopped = true; }
  }
  const mic = new TestTrack();
  const getUserMedia = t.mock.fn(async () => ({ getAudioTracks: () => [mic], getTracks: () => [mic] }));
  replaceGlobal(t, 'RTCPeerConnection', TestPeer);
  replaceGlobal(t, 'navigator', { mediaDevices: { getUserMedia } });
  const connect = t.mock.method(api, 'createLiveSession', async () => ({ sdp: 'test answer', model: 'gpt-live-1.1' }));
  const entries: VoiceTranscript[] = [];
  const onTool = t.mock.fn(async () => ({ result: { ok: true }, actionLabel: 'Read current view' }));
  const onNotice = t.mock.fn();
  const onMicrophone = t.mock.fn();
  const onAudioBlocked = t.mock.fn();
  const onUnsentText = t.mock.fn();
  const onPaused = t.mock.fn();
  voice = new RealtimeVoice({
    onState: () => {}, onNotice, onMicrophone, onAudioBlocked, onPaused, onUnsentText, onModel: () => {},
    onTool, onTranscript: (entry) => entries.push(entry), getContext: () => 'Scene: map',
  });
  return { voice, peers, body, mic, getUserMedia, connect, entries, onTool, onNotice, onMicrophone, onAudioBlocked, onUnsentText, onPaused };
}

test('typed turn waits for session.started, runs the delegated tool once and renders backend text from standby', async (t) => {
  const { voice, peers, getUserMedia, entries, onTool, onNotice, onPaused } = setupVoice(t);
  assert.equal(voice.sendText('Open the station'), true);
  await setImmediate();
  const { channel } = peers[0];
  assert.equal(voice.state, 'connecting');
  assert.equal(getUserMedia.mock.callCount(), 0);
  assert.deepEqual(channel.sent, []);
  channel.receive({ type: 'session.started' });
  assert.equal(voice.state, 'thinking');
  const delegate = (event: object) => channel.receive({ type: 'response.event', delegation_id: 'delegate', event });
  const item = { type: 'function_call', name: 'get_current_view', call_id: 'call', arguments: '{}' };
  delegate({ type: 'response.output_item.done', response_id: 'first', item });
  delegate({ type: 'response.output_item.done', response_id: 'first', item });
  delegate({ type: 'response.completed', response: { id: 'first', status: 'completed', output: [] } });
  await setImmediate();
  assert.equal(onTool.mock.callCount(), 1);
  assert.deepEqual(channel.sent.map(({ type, item }) => [type, item?.type]), [
    ['response.item.create', 'message'], ['response.create', undefined],
    ['response.item.create', 'function_call_output'], ['response.create', undefined],
  ]);
  delegate({ type: 'response.output_text.delta', item_id: 'text', delta: 'Station' });
  delegate({ type: 'response.output_text.done', item_id: 'text', text: 'Station details.' });
  assert.equal(entries.findLast(({ kind }) => kind === 'assistant')?.text, 'Station details.');
  assert.equal(entries.at(-1)?.id, entries.at(-2)?.id);
  delegate({ type: 'response.completed', response: { id: 'second', status: 'completed', output: [] } });
  assert.equal(voice.state, 'listening');
  channel.receive({ type: 'session.paused' });
  assert.deepEqual(onPaused.mock.calls.at(-1)?.arguments, [true]);
  assert.equal(voice.sendText('Follow-up during standby'), true);
  assert.equal(channel.sent.at(-1)?.type, 'response.create');
  channel.receive({ type: 'error', error: { code: 'invalid_value', message: 'The event was rejected. Supported values are: …' } });
  assert.equal(voice.state, 'listening');
  assert.equal(onNotice.mock.calls.at(-1)?.arguments[0], 'GPT Live: The event was rejected. Try again or start a new session.');
  assert.equal(voice.sendText('Retry'), true);
});

test('mic denial falls back to text, audio can recover and enabling the mic keeps the original peer', async (t) => {
  const { voice, peers, body, mic, getUserMedia, connect, onNotice, onMicrophone, onAudioBlocked } = setupVoice(t);
  getUserMedia.mock.mockImplementationOnce(async () => { throw new DOMException('Denied', 'NotAllowedError'); });
  await voice.start();
  const peer = peers[0];
  peer.channel.receive({ type: 'session.started' });
  assert.equal(voice.state, 'listening');
  assert.match(onNotice.mock.calls.at(-1)?.arguments[0], /denied.*still type/);
  assert.equal(peer.track, undefined);
  const audio = body.children.at(-1)!;
  audio.rejectPlay = true;
  peer.ontrack?.({ streams: [{}] });
  await setImmediate();
  assert.deepEqual(onAudioBlocked.mock.calls.at(-1)?.arguments, [true]);
  assert.equal(voice.state, 'listening');
  audio.rejectPlay = false;
  voice.enableAudio();
  await setImmediate();
  assert.deepEqual(onAudioBlocked.mock.calls.at(-1)?.arguments, [false]);
  await voice.start();
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(peer.track, mic);
  assert.equal(mic.enabled, true);
  voice.setMuted(true);
  assert.equal(mic.enabled, false);
  peer.channel.receive({ type: 'output_audio_buffer.started' });
  assert.equal(voice.state, 'speaking');
  assert.equal(voice.sendText('Keep this draft'), false);
  peer.channel.receive({ type: 'output_audio_buffer.stopped' });
  assert.equal(voice.sendText('Keep this draft'), true);
  voice.stop();
  assert.equal(peer.channel.sent.at(-1)?.type, 'session.close');
  assert.equal(mic.stopped, true);
  assert.equal(peer.closed, true);
  assert.deepEqual(onMicrophone.mock.calls.at(-1)?.arguments, [false, false, false]);
});

test('failed connection restores the submitted text for retry', async (t) => {
  const { voice, connect, onUnsentText } = setupVoice(t);
  connect.mock.mockImplementationOnce(async () => { throw new Error('Connection refused'); });
  assert.equal(voice.sendText('Retain this prompt'), true);
  await setImmediate();
  assert.equal(voice.state, 'error');
  assert.deepEqual(onUnsentText.mock.calls.at(-1)?.arguments, ['Retain this prompt']);
});
