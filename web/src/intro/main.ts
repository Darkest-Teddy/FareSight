import '../styles/motion.css';
import { attachIconMotion, icon } from '../ui/icons';
import { attachTactileSpring, springHide, springText, stepSpring } from '../ui/motion';
import { IntroScene, ROOM_START } from './IntroScene';

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const root = document.documentElement;
const body = document.body;
const canvas = document.querySelector<HTMLCanvasElement>('#stage')!;
const veil = document.querySelector<HTMLElement>('.veil')!;
const meter = document.querySelector<HTMLElement>('.meter')!;
const status = document.querySelector<HTMLElement>('.status')!;
const phone = document.querySelector<HTMLElement>('.phone')!;
const scan = document.querySelector<HTMLVideoElement>('.phone-scan')!;

/**
 * The story is longer than the 3D journey. Once the camera has closed in on the hot pot's flag
 * the stage waits there while a phone shows how a room gets scanned, then carries on inside.
 * Beats and the phone are timed in story units: the stage's own progress up to
 * the hold, then the hold, then the rest of the stage's progress moved along by its length.
 */
const HOLD = { at: 0.915, length: 0.46 };
const STORY = 1 + HOLD.length;
const stageAt = (story: number) => story <= HOLD.at ? story : Math.max(HOLD.at, story - HOLD.length);
/**
 * When the phone comes in, when its screen cuts from the home page to the scan, the stretch of
 * scroll that plays the scan recording from start to end, and when the phone leaves.
 */
const PHONE = { enter: [0.93, 0.975], cut: [1.085, 1.11], scrub: [1.115, 1.31], exit: [1.325, 1.372] } as const;
for (const link of document.querySelectorAll<HTMLAnchorElement>('.brand, .action')) {
  attachTactileSpring(link);
  if (!link.classList.contains('action')) continue;
  link.append(icon('forward'));
  attachIconMotion(link);
}

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
/**
 * The lines of the opening copy, with the top row, as boxes on screen. While that copy is up,
 * the map's station labels keep off them, so a label never lands on the headline.
 */
const heroCopy = document.querySelector<HTMLElement>('.beat-hero .copy')!;
const heroBeat = beats.find((beat) => beat.copy === heroCopy)!;
let heroLines: { left: number; top: number; right: number; bottom: number }[] = [];
/** The brand and the button in the top row. Labels keep off those for as long as they show. */
let barBoxes: typeof heroLines = [];
const measure = () => {
  travel = Math.max(1, root.scrollHeight - window.innerHeight);
  const range = document.createRange();
  barBoxes = [...document.querySelectorAll('.bar > a')].map((node) => {
    const { left, top, right, bottom } = node.getBoundingClientRect();
    return { left, top, right, bottom };
  });
  heroLines = [...barBoxes, ...[...heroCopy.children].flatMap((node) => {
    range.selectNodeContents(node);
    return [...range.getClientRects()].map(({ left, top, right, bottom }) => ({ left, top, right, bottom }));
  })];
};
measure();

const scrolled = () => Math.max(0, Math.min(window.scrollY / travel, 1));
let eased = scrolled();
const meterSpring = { value: eased, velocity: 0 };
let phoneShown = -1;
let scanShown = -1;
/** How far through the scan recording the scroll is, 0 to 1, and the last moment it was moved to. */
let scanAt = 0;
let scanSought = -1;

/** Shows the phone for the Contribute chapter and scrubs the scan recording with the scroll. */
function showPhone(story: number): void {
  const arrive = ramp(story, ...PHONE.enter);
  const leave = ramp(story, ...PHONE.exit);
  const shown = Math.round(arrive * (1 - leave) * 1000) / 1000;
  if (shown !== phoneShown) {
    phoneShown = shown;
    phone.style.visibility = shown > 0.004 ? 'visible' : 'hidden';
    phone.style.opacity = String(shown);
    // It rises into place, and leaves by sinking back into the scene it was held in front of.
    const rise = reducedMotion.matches ? 0 : (1 - arrive) * 9 - leave * 3;
    const size = reducedMotion.matches ? 1 : 0.94 + 0.06 * arrive - 0.1 * leave;
    phone.style.transform = `translate(-50%, calc(-50% + ${rise.toFixed(2)}vh)) scale(${size.toFixed(4)})`;
    root.style.setProperty('--phone', String(shown));
  }
  // The recording is only fetched once the visitor is close to it.
  if (story > 0.6 && scan.dataset.src) {
    scan.src = scan.dataset.src;
    delete scan.dataset.src;
    scan.preload = 'auto';
  }
  const cut = ramp(story, ...PHONE.cut);
  if (cut !== scanShown) {
    scanShown = cut;
    scan.style.opacity = String(cut);
    // The status bar and the strip under the screen follow whichever app screen is showing.
    phone.classList.toggle('is-scan', cut > 0.5);
  }
  // The recording never plays by itself: the scroll is its playhead, forwards and backwards.
  const [from, to] = PHONE.scrub;
  scanAt = Math.max(0, Math.min((story - from) / (to - from), 1));
  seekScan();
}

/** Moves the recording to the scroll's moment. One seek at a time, so the newest position always wins. */
function seekScan(): void {
  if (scan.readyState < 1 || scan.seeking || !Number.isFinite(scan.duration)) return;
  // Stop a frame short of the end: some browsers show nothing when parked exactly on it.
  const time = scanAt * Math.max(0, scan.duration - 0.05);
  // Compared with the last request, not with where the video landed, which is on a frame boundary.
  if (Math.abs(scanSought - time) < 0.012) return;
  scanSought = time;
  scan.currentTime = time;
}
scan.addEventListener('seeked', seekScan);
scan.addEventListener('loadeddata', seekScan);
// iOS only decodes frames for a video that has started once; muted and inline, it is allowed to.
scan.addEventListener('loadedmetadata', () => {
  void scan.play().then(() => { scan.pause(); seekScan(); }, () => undefined);
}, { once: true });

function frame(dt: number): number {
  const goal = scrolled();
  eased += (goal - eased) * (reducedMotion.matches ? 1 : 1 - Math.exp(-dt * 5.2));
  if (Math.abs(goal - eased) < 0.00005) eased = goal;
  const story = eased * STORY;
  const stage = stageAt(story);

  for (const beat of beats) {
    const arrive = ramp(story, ...beat.enter);
    const leave = ramp(story, ...beat.exit);
    const shown = Math.round(arrive * (1 - leave) * 1000) / 1000;
    if (shown === beat.shown) continue;
    beat.shown = shown;
    beat.node.style.visibility = shown > 0.004 ? 'visible' : 'hidden';
    beat.copy.style.opacity = String(shown);
    const drift = reducedMotion.matches ? 0 : (1 - arrive) * 30 - leave * 30;
    beat.copy.style.transform = `translate3d(0, ${drift.toFixed(2)}px, 0)`;
  }
  scene.labelKeepOut = heroBeat.shown > 0.05 ? heroLines : barBoxes;

  showPhone(story);
  const interior = body.dataset.room === 'ready' ? ramp(stage, ROOM_START, 0.98) : 0;
  veil.style.opacity = (interior * 0.5).toFixed(3);
  root.style.setProperty('--interior', interior.toFixed(3));
  if (reducedMotion.matches) {
    meterSpring.value = goal;
    meterSpring.velocity = 0;
  } else stepSpring(meterSpring, goal, dt);
  meter.style.transform = `scaleX(${Math.max(0, Math.min(1, meterSpring.value)).toFixed(4)})`;
  return stage;
}

for (const link of document.querySelectorAll<HTMLAnchorElement>('[data-to]')) {
  link.addEventListener('click', (event) => {
    event.preventDefault();
    // `data-to` is in story units, like the beats.
    window.scrollTo({ top: Number(link.dataset.to) / STORY * travel, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
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
  if (eased !== scrolled() || meterSpring.value !== scrolled()) fallbackFrame = requestAnimationFrame(tick);
}

// The copy's lines move once its font arrives.
void document.fonts.ready.then(() => { measure(); wake(); });
const observer = new ResizeObserver(() => { measure(); wake(); });
observer.observe(body);
window.addEventListener('scroll', wake, { passive: true, signal: events.signal });
window.addEventListener('resize', () => { measure(); wake(); }, { signal: events.signal });
reducedMotion.addEventListener('change', wake, { signal: events.signal });
frame(0);

scene.init((roomReady) => {
  body.dataset.room = roomReady ? 'ready' : 'missing';
}).then(() => {
  if (events.signal.aborted) return;
  cancelAnimationFrame(fallbackFrame);
  fallbackFrame = 0;
  stageReady = true;
  body.dataset.state = 'ready';
  springHide(status, { from: 'translateY(-5px)', preset: 'gentle' });
  scene.start();
}).catch((error: unknown) => {
  if (events.signal.aborted) return;
  console.error(error);
  stageReady = false;
  scene.destroy();
  body.dataset.state = 'ready';
  body.dataset.stage = 'missing';
  springText(status, 'The 3D model could not load on this device. The app still works.');
  wake();
});
window.addEventListener('pagehide', (event) => {
  if (event.persisted) return;
  events.abort();
  observer.disconnect();
  cancelAnimationFrame(fallbackFrame);
  scene.destroy();
}, { signal: events.signal });
