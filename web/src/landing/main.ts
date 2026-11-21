import { element } from '../ui/dom';
import { LandingPage } from './LandingPage';
import { LandingScene } from './scene/LandingScene';
import './landing.css';

/**
 * Entry point for the landing page.
 *
 * The flat page is built and shown first, and the scene is attached to it
 * afterwards. That order matters: the words are the part that has to work
 * everywhere, so they are never waiting on WebGL, a 29 MB asset folder, or a
 * driver that has decided today is the day. If the scene never arrives the
 * page is still a page.
 */

const root = document.querySelector<HTMLElement>('#landing');
const canvas = document.querySelector<HTMLCanvasElement>('#stage');
if (!root || !canvas) throw new Error('FareSight landing page is missing its root elements.');

const page = new LandingPage(root);

function fallback(reason: unknown): void {
  canvas?.remove();
  const notice = element('div', 'stage-fallback');
  notice.append(element('p', '', 'The 3D preview could not start on this device. Everything below still reads.'));
  document.body.append(notice);
  console.warn('FareSight landing scene did not start.', reason);
  // Without a scene there is no render loop, so the flat layer needs its own.
  const tick = () => { page.update(page.director.sample(1 / 60)); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}

async function start(): Promise<void> {
  const scene = new LandingScene(canvas!, (message, level) => {
    if (level === 'warn') console.warn('[landing]', message);
  });

  await scene.load();

  scene.onFrame((dt) => {
    const state = page.director.sample(dt);
    page.update(state);
    scene.update(state);
  });

  addEventListener('resize', () => scene.resize(), { passive: true });
}

start().catch(fallback);
