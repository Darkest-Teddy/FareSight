import {
  Alert02Icon, ArrowLeft02Icon, ArrowRight02Icon, Cancel01Icon, DollarCircleIcon, Gps01Icon,
  LeftToRightListBulletIcon, Loading03Icon, Location01Icon, Logout01Icon, Mic01Icon,
  MoreHorizontalIcon, ReloadIcon, Store01Icon, VirtualRealityVr01Icon, VolumeHighIcon, VolumeMute02Icon,
} from '@hugeicons/core-free-icons';
import { canAnimate, playSpring, springShake } from './motion.ts';

const glyphs = {
  back: ArrowLeft02Icon, list: LeftToRightListBulletIcon, mic: Mic01Icon, alert: Alert02Icon,
  venue: Store01Icon, pin: Location01Icon, locate: Gps01Icon, budget: DollarCircleIcon,
  vr: VirtualRealityVr01Icon, reset: ReloadIcon, exit: Logout01Icon, sound: VolumeHighIcon,
  mute: VolumeMute02Icon, close: Cancel01Icon, forward: ArrowRight02Icon,
  loading: Loading03Icon, thinking: MoreHorizontalIcon,
};

const namespace = 'http://www.w3.org/2000/svg';
export type IconName = keyof typeof glyphs;
type Trigger = 'hover' | 'press' | 'state';

export function icon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('data-icon', name);
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('icon');
  for (const [tag, attributes] of glyphs[name]) {
    const child = document.createElementNS(namespace, tag);
    for (const [attribute, value] of Object.entries(attributes)) {
      if (attribute === 'key') continue;
      const dashed = attribute.replace(/[A-Z]/g, (letter) => '-' + letter.toLowerCase());
      child.setAttribute(dashed, String(value));
    }
    svg.append(child);
  }
  return svg;
}

const gestures: Record<IconName, string> = {
  back: 'translateX(-3px)', list: 'translateX(2px)', mic: 'translateY(-2px)',
  alert: 'rotate(-9deg)', venue: 'translateY(-2px)', pin: 'translateY(-3px) scale(.94)',
  locate: 'rotate(19deg)', budget: 'rotate(-13deg)', vr: 'rotate(-8deg) translateY(-1px)',
  reset: 'rotate(-32deg)', exit: 'translateX(3px)', sound: 'translateX(-2px) scale(.7)',
  mute: 'rotate(-30deg) scale(.55)', close: 'rotate(-14deg)', forward: 'translateX(3px)',
  loading: 'rotate(-20deg)', thinking: 'scale(.8)',
};

export function animateIcon(svg: SVGSVGElement | null, trigger: Trigger) {
  if (!svg || !canAnimate(svg)) return;
  const name = svg.getAttribute('data-icon') as IconName;
  if (!(name in gestures)) return;
  if (name === 'alert' && trigger !== 'hover') {
    springShake(svg);
    return;
  }
  const move = (node: SVGElement, transform: string, delay = 0) => {
    playSpring(node, 'icon', [{ transform }, { transform: 'none' }], 'icon', undefined, { delay });
  };
  const parts = Array.from(svg.children) as SVGElement[];
  if (name === 'list') {
    parts.forEach((part, index) => move(part, gestures.list, (index % 3) * 27));
  } else if (name === 'sound' || name === 'mute' || name === 'exit' || name === 'mic') {
    const moving = name === 'mic' ? parts.slice(0, 1) : parts.slice(1);
    moving.forEach((part, index) => move(part, trigger === 'state' && name === 'mic' ? 'translateY(1px) scale(.76)' : gestures[name], index * 24));
  } else {
    const transform = name === 'reset' && trigger === 'press' ? 'rotate(270deg)'
      : name === 'vr' && trigger === 'state' ? 'translateY(2px) scale(.78)' : gestures[name];
    move(svg, transform);
  }
}

export function attachIconMotion(node: HTMLElement) {
  const glyph = () => node.querySelector?.<SVGSVGElement>('.icon:not([hidden])') ?? null;
  node.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse' && !node.matches?.(':disabled')) animateIcon(glyph(), 'hover');
  });
  node.addEventListener('focus', () => {
    if (node.matches?.(':focus-visible')) animateIcon(glyph(), 'hover');
  });
  node.addEventListener('click', () => animateIcon(glyph(), 'press'), true);
}
