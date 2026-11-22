import { IntroScene, ROOM_START } from './IntroScene';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const body = document.body;
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const veil = document.querySelector<HTMLElement>('.veil')!;
const meter = document.querySelector<HTMLElement>('.meter')!;
const status = document.querySelector<HTMLElement>('.status')!;
const roomTag = document.querySelector<HTMLElement>('.room-tag')!;
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
  if (reducedMotion.matches) return Number(value >= (from + to) / 2);
  const t = Math.max(0, Math.min((value - from) / (to - from), 1));
  return t * t * (3 - 2 * t);
};

let travel = 1;
const measure = () => { travel = Math.max(1, root.scrollHeight - window.innerHeight); };
measure();

const scrolled = () => Math.max(0, Math.min(window.scrollY / travel, 1));
let eased = scrolled();
let chapter = '';

function frame(dt: number): number {
  const goal = scrolled();
  eased += (goal - eased) * (reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 5.2));
  if (Math.abs(goal - eased) < 0.00005) eased = goal;

  for (const beat of beats) {
    const arrive = ramp(eased, ...beat.enter);
    const leave = ramp(eased, ...beat.exit);
    const shown = Math.round(arrive * (1 - leave) * 1000) / 1000;
    if (shown === beat.shown) continue;
    beat.shown = shown;
    beat.node.style.visibility = shown > 0.004 ? 'visible' : 'hidden';
    beat.copy.style.opacity = String(shown);
    const drift = reducedMotion.matches ? 0 : (1 - arrive) * 30 - leave * 30;
    beat.copy.style.transform = `translate3d(0, ${drift.toFixed(2)}px, 0)`;
  }

  const interior = body.dataset.room === 'ready' ? ramp(eased, ROOM_START, 0.98) : 0;
  veil.style.opacity = (interior * 0.38).toFixed(3);
  root.style.setProperty('--interior', interior.toFixed(3));
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

const scene = new IntroScene(canvas, frame);
const events = new AbortController();
let stageReady = false;
let fallbackFrame = 0;
let last = 0;

function wake() {
  if (stageReady) { scene.wake(); return; }
  if (!fallbackFrame) {
    last = performance.now();
    fallbackFrame = requestAnimationFrame(tick);
  }
}

function tick(now: number) {
  fallbackFrame = 0;
  frame(Math.min(0.1, (now - last) / 1000));
  last = now;
  if (eased !== scrolled()) fallbackFrame = requestAnimationFrame(tick);
}

const observer = new ResizeObserver(() => { measure(); wake(); });
observer.observe(body);
window.addEventListener('scroll', wake, { passive: true, signal: events.signal });
window.addEventListener('resize', () => { measure(); wake(); }, { signal: events.signal });
reducedMotion.addEventListener('change', wake, { signal: events.signal });
frame(0);

scene.init((roomReady) => {
  body.dataset.room = roomReady ? 'ready' : 'missing';
  if (!roomReady) roomTag.textContent = '3D interior unavailable';
}).then(() => {
  if (events.signal.aborted) return;
  cancelAnimationFrame(fallbackFrame);
  fallbackFrame = 0;
  stageReady = true;
  body.dataset.state = 'ready';
  status.hidden = true;
  scene.start();
}).catch((error: unknown) => {
  if (events.signal.aborted) return;
  console.error(error);
  stageReady = false;
  scene.destroy();
  body.dataset.state = 'ready';
  body.dataset.stage = 'missing';
  roomTag.textContent = '3D interior unavailable';
  status.textContent = 'The 3D model could not load on this device. The app still works.';
  wake();
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  events.abort();
  observer.disconnect();
  cancelAnimationFrame(fallbackFrame);
  scene.destroy();
}, { signal: events.signal });
