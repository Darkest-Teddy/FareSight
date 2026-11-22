import { spring } from 'motion';

const springSettings = {
  tactile: { stiffness: 540, damping: 30 },
  snappy: { stiffness: 490, damping: 34 },
  panel: { stiffness: 340, damping: 31 },
  gentle: { stiffness: 260, damping: 31 },
  pop: { stiffness: 475, damping: 23 },
  icon: { stiffness: 440, damping: 26 },
};

type Preset = keyof typeof springSettings;
type MotionElement = HTMLElement | SVGElement;
type Presence = { from?: string; preset?: Preset };
type Effect = { finish: () => void; cancel: () => void };

const effects = new WeakMap<MotionElement, Map<string, Effect>>();
const active = new Set<Effect>();
const curves = new Map<Preset, KeyframeAnimationOptions>();
let preference: MediaQueryList | undefined;

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  if (!preference) {
    preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    preference.addEventListener?.('change', (event) => {
      if (event.matches) for (const effect of active) effect.finish();
    });
  }
  return preference.matches;
}

export function canAnimate(node: MotionElement): boolean {
  return !!node.style && typeof node.animate === 'function' && !prefersReducedMotion();
}

function curve(preset: Preset) {
  let options = curves.get(preset);
  if (!options) {
    const [duration, easing] = spring({
      ...springSettings[preset], keyframes: [0, 1], restDelta: 0.004, restSpeed: 0.08,
    }).toString().split('ms ');
    options = { duration: Number(duration), easing, fill: 'both' };
    curves.set(preset, options);
  }
  return options;
}

export function labelSpring(node: HTMLElement) {
  if (!canAnimate(node)) return;
  const { duration, easing } = curve('snappy');
  node.style.setProperty('--label-spring', `${duration}ms ${easing}`);
}

export function playSpring(
  node: MotionElement, channel: string, keyframes: Keyframe[], preset: Preset = 'snappy',
  done?: () => void, options?: KeyframeAnimationOptions,
): boolean {
  let running = effects.get(node);
  running?.get(channel)?.cancel();
  if (!canAnimate(node) || node.isConnected === false) {
    done?.();
    return false;
  }
  let animation: Animation;
  try {
    animation = node.animate(keyframes, { ...curve(preset), ...options });
  } catch (error) {
    // Older WAAPI engines can reject the spring timing function or pseudo-element.
    if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
    done?.();
    return false;
  }
  if (!running) effects.set(node, running = new Map());
  const detach = () => {
    running.delete(channel);
    active.delete(effect);
    animation.cancel();
  };
  const effect: Effect = {
    cancel: detach,
    finish: () => {
      detach();
      done?.();
    },
  };
  running.set(channel, effect);
  active.add(effect);
  void animation.finished.then(() => {
    if (running.get(channel) === effect) effect.finish();
  }, () => {
    if (running.get(channel) === effect) effect.finish();
  });
  return true;
}

const shown = { opacity: 1, transform: 'none' };
const recessed = 'translateY(8px) scale(.975)';

export function springSurface(
  node: HTMLElement, open: boolean, options: Presence = {}, done?: () => void, firstShow = false,
) {
  const rest = { opacity: 0, transform: options.from ?? recessed };
  let start = firstShow ? rest : shown;
  if (canAnimate(node) && !firstShow && typeof getComputedStyle === 'function') {
    const computed = getComputedStyle(node);
    start = { opacity: Number(computed.opacity), transform: computed.transform };
  }
  return playSpring(node, 'presence', [start, open ? shown : rest], options.preset ?? 'panel', done);
}

export function springShow(node: HTMLElement, options?: Presence): boolean {
  const wasHidden = node.hidden;
  const wasExiting = node.inert;
  node.hidden = false;
  node.inert = false;
  if (!wasHidden && !wasExiting) return false;
  springSurface(node, true, options, undefined, wasHidden);
  return true;
}

export function springHide(node: HTMLElement, options?: Presence): boolean {
  if (node.hidden || node.inert) return false;
  node.inert = true;
  springSurface(node, false, options, () => { node.hidden = true; node.inert = false; });
  return true;
}

export function springVisible(node: HTMLElement, visible: boolean, options?: Presence): boolean {
  return visible ? springShow(node, options) : springHide(node, options);
}

export function springSwap(node: MotionElement, update: () => void) {
  update();
  playSpring(node, 'swap', [{ translate: '0 3px' }, { translate: '0 0' }]);
}

export function springText(node: MotionElement, text: string): boolean {
  const label = text.replaceAll('—', '–');
  if (node.textContent === label) return false;
  springSwap(node, () => { node.textContent = label; });
  return true;
}

export function springStagger(items: Iterable<HTMLElement>) {
  let index = 0;
  for (const item of items) {
    playSpring(item, 'reveal', [{ opacity: 0, translate: '-5px 0' }, { opacity: 1, translate: '0 0' }],
      'snappy', undefined, { delay: Math.min(index++, 8) * 22 });
  }
}

export function springShake(node: MotionElement) {
  playSpring(node, 'feedback', [{ translate: '-3px 0' }, { translate: '0 0' }], 'pop');
}

export function springBump(node: MotionElement) {
  playSpring(node, 'feedback', [{ scale: '.91' }, { scale: '1' }], 'pop');
}

export function springPress(node: HTMLElement, pressed: boolean) {
  const previous = canAnimate(node) && typeof getComputedStyle === 'function' ? getComputedStyle(node).scale : '1';
  node.dataset.tactilePressed = String(pressed);
  playSpring(node, 'press', [{ scale: previous }, { scale: pressed ? '.96' : '1' }], 'tactile');
}

export function attachTactileSpring(node: HTMLElement) {
  const press = () => {
    if (!node.matches?.(':disabled') && node.dataset.tactilePressed !== 'true') springPress(node, true);
  };
  const release = () => {
    if (node.dataset.tactilePressed === 'true') springPress(node, false);
  };
  node.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse' && !node.matches?.(':disabled')) {
      playSpring(node, 'press', [{ scale: '1.022' }, { scale: '1' }], 'tactile');
    }
  });
  node.addEventListener('pointerdown', (event) => { if (event.isPrimary && event.button === 0) press(); });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel', 'blur']) node.addEventListener(type, release);
  node.addEventListener('keydown', (event) => { if (event.key === ' ' || event.key === 'Enter') press(); });
  node.addEventListener('keyup', (event) => { if (event.key === ' ' || event.key === 'Enter') release(); });
}

export type SpringValue = { value: number; velocity: number };

/** Steps a critically damped spring analytically so drops in frame rate stay stable. */
export function stepSpring(state: SpringValue, target: number, dt: number, frequency = 19): number {
  if (dt <= 0 || (state.value === target && state.velocity === 0)) return state.value;
  const displacement = state.value - target;
  const impulse = state.velocity + frequency * displacement;
  const decay = Math.exp(-frequency * dt);
  state.value = target + (displacement + impulse * dt) * decay;
  state.velocity = (state.velocity - frequency * impulse * dt) * decay;
  if (Math.abs(state.value - target) < 0.0001 && Math.abs(state.velocity) < 0.001) {
    state.value = target;
    state.velocity = 0;
  }
  return state.value;
}
