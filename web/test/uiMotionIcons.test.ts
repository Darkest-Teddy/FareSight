import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  Alert02Icon, ArrowLeft02Icon, DollarCircleIcon, Gps01Icon, LeftToRightListBulletIcon, Location01Icon,
  Logout01Icon, Mic01Icon, ReloadIcon, Store01Icon, VirtualRealityVr01Icon, VolumeHighIcon, VolumeMute02Icon,
} from '@hugeicons/core-free-icons';
import { dockButton, icon, setDockButton, type IconName } from '../src/ui/dom.ts';
import { animateIcon } from '../src/ui/icons.ts';
import { springHide, springShow, springSwap, stepSpring } from '../src/ui/motion.ts';

class NodeStub extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly classList = { add: (_name: string) => {} };
  readonly children: NodeStub[] = [];
  textContent = '';
  className = '';
  hidden = false;
  inert = false;
  parent?: NodeStub;

  readonly tagName: string;

  constructor(tagName: string) {
    super();
    this.tagName = tagName;
  }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); }
  getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  append(...nodes: NodeStub[]) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  querySelector(selector: string) {
    return this.children.find((node) => selector === '.icon'
      ? node.tagName === 'svg' : '.' + node.className === selector) ?? null;
  }
  replaceWith(node: NodeStub) {
    const parent = this.parent!;
    parent.children[parent.children.indexOf(this)] = node;
    node.parent = parent;
  }
}

function stubGlobal(t: TestContext, name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  });
}

const expected = {
  back: ArrowLeft02Icon, list: LeftToRightListBulletIcon, mic: Mic01Icon, alert: Alert02Icon,
  venue: Store01Icon, pin: Location01Icon, locate: Gps01Icon, budget: DollarCircleIcon,
  vr: VirtualRealityVr01Icon, reset: ReloadIcon, exit: Logout01Icon, sound: VolumeHighIcon, mute: VolumeMute02Icon,
};

test('dock icons use the actual Hugeicons SVG primitives and can swap without WAAPI', (t) => {
  stubGlobal(t, 'document', {
    createElement: (name: string) => new NodeStub(name),
    createElementNS: (ns: string, name: string) => {
      assert.equal(ns, 'http://www.w3.org/2000/svg');
      return new NodeStub(name);
    },
  });

  for (const [name, definition] of Object.entries(expected)) {
    const svg = icon(name as IconName) as unknown as NodeStub;
    assert.equal(svg.getAttribute('data-icon'), name);
    assert.equal(svg.getAttribute('aria-hidden'), 'true');
    assert.equal(svg.getAttribute('viewBox'), '0 0 24 24');
    assert.equal(svg.getAttribute('stroke'), 'currentColor');
    assert.ok(svg.children.length > 0);
    assert.equal(svg.children.length, definition.length);
    for (const [index, [tag, attributes]] of definition.entries()) {
      const child = svg.children[index];
      assert.equal(child.tagName, tag);
      assert.match(child.tagName, /^(path|circle|rect|line|polyline|polygon|ellipse)$/);
      assert.equal(child.getAttribute('key'), null);
      assert.equal(child.getAttribute('d'), attributes.d);
      assert.ok(child.getAttribute('d')?.startsWith('M'));
      assert.equal(child.getAttribute('stroke'), 'currentColor');
    }
    for (const trigger of ['hover', 'press', 'state'] as const) animateIcon(svg as unknown as SVGSVGElement, trigger);
  }

  const button = dockButton('mute', 'Sound off', () => {});
  setDockButton(button, 'Sound on', 'sound');
  const glyph = button.querySelector('.icon');
  assert.equal(glyph?.getAttribute('data-icon'), 'sound');
  assert.equal(button.querySelector('.dock-label')?.textContent, 'Sound on');
  assert.equal(button.getAttribute('aria-label'), 'Sound on');
  setDockButton(button, 'Sound on', 'sound');
  assert.equal(button.querySelector('.icon'), glyph);
});

test('icon gestures animate the relevant SVG parts with staggered spring easing', (t) => {
  const played: { tag: NodeStub; start: Keyframe; config: KeyframeAnimationOptions }[] = [];
  stubGlobal(t, 'document', {
    createElementNS: (_ns: string, name: string) => {
      const tag = new NodeStub(name);
      return Object.assign(tag, {
        style: {},
        animate: ([start]: Keyframe[], config: KeyframeAnimationOptions) => {
          played.push({ tag, start, config });
          return { finished: Promise.resolve(), cancel() {} };
        },
      });
    },
  });
  const list = icon('list');
  animateIcon(list, 'hover');
  assert.deepEqual(played.map(({ config }) => config.delay), [0, 27, 54, 0, 27, 54]);
  assert.ok(played.every(({ config }) => config.easing?.startsWith('linear(')));
  played.length = 0;

  const sound = icon('sound');
  animateIcon(sound, 'state');
  assert.deepEqual(played.map(({ tag }) => tag), Array.from(sound.children).slice(1));
  assert.ok(played.every(({ start }) => String(start.transform).includes('scale')));
});

test('visibility and text updates are synchronous without WAAPI or under reduced motion', (t) => {
  const node = new NodeStub('div') as unknown as HTMLElement;
  node.hidden = true;
  springShow(node);
  assert.equal(node.hidden, false);
  springSwap(node, () => { node.textContent = 'Ready'; });
  assert.equal(node.textContent, 'Ready');
  springHide(node);
  assert.equal(node.hidden, true);
  assert.equal(node.inert, false);

  const viewport = new EventTarget();
  const preference = Object.assign(viewport, { matches: true });
  stubGlobal(t, 'window', { matchMedia: () => preference });
  const animate = t.mock.fn();
  Object.assign(node, { style: {}, animate });
  springShow(node);
  assert.equal(node.hidden, false);
  springHide(node);
  assert.equal(node.hidden, true);
  assert.equal(animate.mock.callCount(), 0);

  preference.matches = false;
  const past: { resolve: () => void; cancel: () => void }[] = [];
  node.animate = ((keyframes: Keyframe[], options: KeyframeAnimationOptions) => {
    assert.equal(keyframes.length, 2);
    assert.match(options.easing!, /^linear\(/);
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    const cancel = t.mock.fn();
    past.push({ resolve, cancel });
    return { finished, cancel };
  }) as typeof node.animate;

  springShow(node);
  springHide(node);
  assert.equal(node.hidden, false);
  assert.equal(node.inert, true);
  springShow(node);
  assert.equal(node.inert, false);
  past[1].resolve();
  return Promise.resolve().then(() => {
    assert.equal(node.hidden, false, 'a stale exit cannot hide a reopened panel');
    springHide(node);
    preference.matches = true;
    preference.dispatchEvent(Object.assign(new Event('change'), { matches: true }));
    assert.equal(node.hidden, true, 'turning on reduced motion settles in-flight transitions');
    assert.equal(node.inert, false);
  });
});

test('numeric spring carries velocity across time steps and settles deterministically', () => {
  const whole = { value: 0, velocity: 0 };
  const halves = { ...whole };
  stepSpring(whole, 15, 0.1);
  stepSpring(halves, 15, 0.05);
  stepSpring(halves, 15, 0.05);
  assert.ok(whole.value > 0 && whole.value < 15);
  assert.ok(Math.abs(whole.value - halves.value) < 1e-10);
  assert.ok(Math.abs(whole.velocity - halves.velocity) < 1e-10);
  stepSpring(whole, 15, 4);
  assert.deepEqual(whole, { value: 15, velocity: 0 });
});
