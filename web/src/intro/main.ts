import { IntroScene } from './IntroScene';

/**
 * Scroll is the only input. The page is a tall, empty track; the canvas and the copy are fixed
 * on top of it. Every frame reads how far the track has travelled, eases toward it, and hands
 * the eased value to the 3D stage and to the copy. No scroll listeners are involved.
 */

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const body = document.body;
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const veil = document.querySelector<HTMLElement>('.veil')!;
const meter = document.querySelector<HTMLElement>('.meter')!;
const status = document.querySelector<HTMLElement>('.status')!;
const chapterLinks = [...document.querySelectorAll<HTMLAnchorElement>('.chapters a')];

interface Beat {
  node: HTMLElement;
  copy: HTMLElement;
  enter: [number, number];
  exit: [number, number];
  shown: number;
}

const pair = (value: string | undefined): [number, number] => {
  const [a, b] = (value ?? '').split(',').map(Number);
  return [a, b];
};
const beats: Beat[] = [...document.querySelectorAll<HTMLElement>('.beat')].map((node) => ({
  node,
  copy: node.querySelector<HTMLElement>('.copy')!,
  enter: pair(node.dataset.in),
  exit: pair(node.dataset.out),
  shown: -1,
}));

const ramp = (value: number, from: number, to: number): number => {
  if (to <= from) return value >= to ? 1 : 0;
  const t = Math.max(0, Math.min((value - from) / (to - from), 1));
  return t * t * (3 - 2 * t);
};

let travel = 1;
const measure = () => { travel = Math.max(1, root.scrollHeight - window.innerHeight); };
new ResizeObserver(measure).observe(body);
measure();

const scrolled = () => Math.max(0, Math.min(window.scrollY / travel, 1));
let eased = scrolled();
let opening = 0;
let chapter = '';

function frame(dt: number): number {
  const goal = scrolled();
  eased += (goal - eased) * (reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 5.2));
  if (Math.abs(goal - eased) < 0.00005) eased = goal;
  if (body.dataset.state === 'ready') opening = Math.min(1, opening + dt / 1.1);

  for (const beat of beats) {
    const arrive = ramp(eased, ...beat.enter);
    const leave = ramp(eased, ...beat.exit);
    const shown = Math.round(arrive * (1 - leave) * opening * 1000) / 1000;
    if (shown === beat.shown) continue;
    beat.shown = shown;
    beat.node.style.visibility = shown > 0.004 ? 'visible' : 'hidden';
    beat.copy.style.opacity = String(shown);
    const drift = reducedMotion.matches ? 0 : (1 - arrive * opening) * 30 - leave * 30;
    beat.copy.style.transform = `translate3d(0, ${drift.toFixed(2)}px, 0)`;
  }

  veil.style.opacity = (ramp(eased, 0.945, 1) * 0.9).toFixed(3);
  meter.style.transform = `scaleX(${eased.toFixed(4)})`;
  const current = eased < 0.36 ? 'map' : eased < 0.82 ? 'station' : eased < 0.955 ? 'place' : 'inside';
  if (current !== chapter) {
    chapter = current;
    for (const link of chapterLinks) {
      if (link.dataset.chapter === current) link.setAttribute('aria-current', 'true');
      else link.removeAttribute('aria-current');
    }
  }
  return eased;
}

for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-to]')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    window.scrollTo({ top: Number(link.dataset.to) * travel, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  });
}

/** Without WebGL the copy still plays; it only loses the model behind it. */
function playWithoutStage(): void {
  let last = performance.now();
  const tick = (now: number) => {
    frame(Math.min(0.1, (now - last) / 1000));
    last = now;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const scene = new IntroScene(canvas, frame);
scene.init().then(() => {
  body.dataset.state = 'ready';
  status.hidden = true;
}).catch((error: unknown) => {
  console.error(error);
  scene.destroy();
  body.dataset.state = 'ready';
  body.dataset.stage = 'missing';
  status.textContent = 'The 3D model could not load on this device. The app still works.';
  playWithoutStage();
});
