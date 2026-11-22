import { button, el, haptic, iconButton, motion, svg } from '../dom';
import { createDishTargets, dishPlans, elevationOf, type DishPlan } from '../scan/dish';
import {
  angleBetween, blend, createTargets, pitchOf, poseFromOrientation, poseFromYawPitch, project, rollOf, yawOf,
  type Pose, type Target, type Vec3,
} from '../scan/sphere';

/** How close the view axis must come to a dot, in degrees, before it can be captured. */
const AIM_DEGREES = 7;
/** Turning speed, in degrees per second, below which a frame is sharp enough to keep. */
const STEADY_SPEED = 16;
const FAST_SPEED = 80;
const HOLD_MS = 450;
// A photo is only taken while the phone's own motion sensors read below both limits: how fast it is
// turning, in degrees per second, and how hard it is being moved, in metres per second squared.
// A hand holding a phone still stays well under these; sliding or shaking it from side to side does not.
const STEADY_TURN = 10;
const STEADY_SHAKE = 0.5;
// The level. A photo is only taken while the phone is upright: tilted sideways by no more than this many degrees.
const LEVEL_DEGREES = 4;
// Leaving the spot. A web page cannot follow where the phone is in the room, but walking shows in the
// motion sensors as a run of up-and-down jolts, one per step. A few of them close together pause the scan.
// Turning on the spot swings the phone sideways, not up and down, so it does not count.
const STEP_JOLT = 1.4;
const STEP_GAP_MS = 250;
const WALK_WINDOW_MS = 2500;
const WALK_STEPS = 3;
// The aiming ring while the phone is moving or tilted. Far enough from the sunflower dots to tell apart.
const AMBER = '255 122 89';
const MOTION_TIMEOUT_MS = 400;
const POP_MS = 420;
// Long-side field of view the dots are drawn with. It is wider than the camera's own (about 64°) on purpose:
// at camera scale a phone in portrait shows one dot at a time, and the person could not see what comes next.
// A dot still reaches the aiming ring exactly when the camera points at it.
const OVERLAY_FOV = 105;
const RAD = Math.PI / 180;
// Sunflower, the main app's highlight (--sun in web/src/styles/tokens.css).
const ACCENT = '255 201 60';
// The dish scan. The phone is carried round the dish by hand, which is less exact than turning on one
// spot, so a stop takes a wider aim and a looser level than a spot in the room does.
const DISH_AIM_DEGREES = 10;
const DISH_LEVEL_DEGREES = 9;
/** How far off the ring's height the phone may be, in degrees, before the hint asks for a change. */
const DISH_TILT_SLACK = 7;
/** Screen pixels the aiming ring slides per degree the phone is too low or too high. */
const DISH_TILT_TRAVEL = 2.4;
// Each shape as a small side view, for the card that asks what is being scanned.
export const dishGlyphs: Record<DishPlan['shape'], string> = {
  plate: 'M4 15h24M7 15c1.5 3 5 4.5 9 4.5s7.5-1.5 9-4.5M9 12.5c2-1.7 4.5-2.5 7-2.5s5 .8 7 2.5',
  bowl: 'M5 11h22c0 6.5-4.5 11-11 11S5 17.5 5 11zM11 25h10M12 7.5c1-1.5 1-2.5 0-4M17 7.5c1-1.5 1-2.5 0-4',
  drink: 'M10 8h12l-1.5 18h-9L10 8zM9 8h14M16 8V3.5l4-1.5',
};

interface Card {
  title: string;
  lines: string[];
  steps?: boolean;
  /** Big buttons to pick one of, shown above the actions. */
  choices?: { glyph: string; title: string; note: string; action: () => void }[];
  primary?: [label: string, action: () => void];
  secondary?: [label: string, action: () => void];
}

/** iOS only hands out motion readings after the page asks from inside a tap. */
async function requestMotion() {
  type Gated = { requestPermission?: () => Promise<string> } | undefined;
  const ask = async (sensor: Gated) => {
    if (!sensor) return false;
    if (typeof sensor.requestPermission !== 'function') return true;
    try { return await sensor.requestPermission() === 'granted'; } catch { return false; }
  };
  // Both are asked in the same breath, while the tap still counts. Orientation aims the scan;
  // motion feeds the stabilizer, and the scan still works without it.
  const [orientation] = await Promise.all([
    ask(window.DeviceOrientationEvent as unknown as Gated),
    ask(window.DeviceMotionEvent as unknown as Gated),
  ]);
  return orientation;
}

/**
 * Full-screen guided scan, in two kinds that share the camera, the sensors and the steady-hand rules.
 *
 * A room: the person turns on the spot while dots mark the directions still to capture; aiming at a
 * dot and holding still takes that photo and pops the dot.
 *
 * A dish: the person carries the phone round the dish, keeping it inside an outline. The dots sit on a
 * ring drawn round the dish and travel along it as the phone moves, toward an aiming ring at the
 * near side. A dot arriving there, with the phone at the ring's height and still, takes the photo.
 */
class GuidedScan {
  private readonly dialog = el('dialog', 'sweep-dialog');
  private readonly video = el('video', 'sweep-video');
  private readonly canvas = el('canvas', 'sweep-canvas');
  private readonly dome = el('canvas', 'sweep-dome');
  private readonly count = el('p', 'sweep-count');
  private readonly hint = el('p', 'sweep-hint');
  private readonly progress = el('i');
  private readonly card = el('section', 'sweep-card');
  private readonly finishButton: HTMLButtonElement;
  private readonly landscape = matchMedia('(orientation: landscape)');
  private targets: Target[] = [];
  private pose?: Pose;
  private sensorPose?: Pose;
  private sensorAt = -Infinity;
  private stream?: MediaStream;
  private connecting = false;
  private videoInterrupted = true;
  private audio?: AudioContext;
  /** Development stand-in for the sensors and camera, steered by dragging. Shift-drag tilts it sideways. */
  private simulated?: { yaw: number; pitch: number; roll: number; frame: HTMLCanvasElement };
  private aimed?: Target;
  private guide?: Target;
  private scanning = false;
  private capturing = false;
  private settled = false;
  private held = 0;
  private speed = 0;
  /** Smoothed readings of the phone's gyroscope and accelerometer, once they start arriving. */
  private motion?: { turn: number; shake: number };
  /** When the last few step-like jolts were felt, and whether one is still under way. */
  private steps: number[] = [];
  private stepping = false;
  private captureEpoch = 0;
  private last = 0;
  private raf = 0;
  /** The shape picked for a dish scan. A room scan has none. */
  private dish?: DishPlan;
  /** How round the ring round the dish is drawn, eased so it does not jitter with the hand. */
  private squash = 0.5;

  constructor(
    private readonly minimum: number, private readonly resolve: (files: File[]) => void,
    subject: 'room' | 'dish' = 'room', plan?: DishPlan,
  ) {
    this.dialog.setAttribute('aria-label', subject === 'dish' ? 'Guided dish scan' : '360° scan');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.setAttribute('aria-hidden', 'true');
    for (const type of ['pause', 'waiting', 'emptied']) {
      this.video.addEventListener(type, () => {
        this.videoInterrupted = true;
        this.resetAim();
      });
    }
    this.video.addEventListener('playing', () => {
      this.videoInterrupted = false;
      this.resetAim();
    });
    this.dome.setAttribute('aria-hidden', 'true');
    this.count.setAttribute('aria-live', 'polite');
    const top = el('header', 'sweep-top');
    top.append(iconButton('close', 'Close the scan', () => this.requestClose(), 'sweep-close'), this.count);
    const track = el('div', 'sweep-progress');
    track.append(this.progress);
    this.finishButton = button('Finish', () => this.finish(), 'primary small');
    const bar = el('footer', 'sweep-bar');
    bar.append(track, this.finishButton);
    this.dialog.append(this.video, this.canvas, top, this.dome, this.hint, bar, this.card);
    this.dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.requestClose();
    });
    document.body.append(this.dialog);
    this.dialog.showModal();
    this.update();
    if (subject === 'dish' && plan) this.introduceDish(plan);
    else if (subject === 'dish') this.pickShape();
    else this.show({
      title: 'Scan the space in 360°',
      lines: [
        'Stand in the middle of the room and stay on that spot.',
        'Hold the phone upright and turn slowly on the spot.',
        'Aim at each dot and hold still until it pops.',
      ],
      steps: true,
      primary: ['Start scan', () => void this.start()],
      secondary: ['Not now', () => this.settle([])],
    });
  }

  private get captured() { return this.targets.flatMap((target) => target.file ? [target.file] : []); }

  /** A dish scan starts by asking what shape it is: that decides the heights the photos are taken from. */
  private pickShape() {
    this.show({
      title: 'What are you scanning?',
      lines: ['Pick the closest shape. It sets the angles the photos are taken from.'],
      choices: dishPlans.map((plan) => ({
        glyph: dishGlyphs[plan.shape], title: plan.name, note: plan.examples, action: () => this.introduceDish(plan),
      })),
      secondary: ['Not now', () => this.settle([])],
    });
  }

  private introduceDish(plan: DishPlan) {
    this.dish = plan;
    const overhead = plan.rings.some(([elevation]) => elevation >= 90);
    this.show({
      title: 'Scan it in two photos',
      lines: [
        'Put it on a clear part of the table, with nothing in front of it.',
        'Fit it inside the outline. A dot marks each photo: bring it to the circle and hold still until it pops.',
        overhead ? 'The first photo is from where you are. The second is from straight above, with the phone held flat.'
          : 'The first photo is from where you are. For the second, carry the phone round to the opposite side.',
      ],
      steps: true,
      primary: ['Start scan', () => void this.start()],
      secondary: ['Change shape', () => this.pickShape()],
    });
  }

  private show(card?: Card) {
    this.card.hidden = !card;
    this.dialog.dataset.card = String(Boolean(card));
    if (!card) return;
    const body = el(card.steps ? 'ol' : 'div', card.steps ? 'tips' : 'sweep-lines');
    body.append(...card.lines.map((line) => el(card.steps ? 'li' : 'p', '', line)));
    const parts: HTMLElement[] = [el('h2', '', card.title), body];
    if (card.choices) {
      const list = el('div', 'sweep-choices');
      for (const choice of card.choices) {
        const option = button('', choice.action, 'sweep-choice');
        const glyph = svg('svg', { viewBox: '0 0 32 32', 'aria-hidden': 'true' });
        glyph.append(svg('path', { d: choice.glyph }));
        const text = el('span');
        text.append(el('strong', '', choice.title), el('small', '', choice.note));
        option.append(glyph, text);
        list.append(option);
      }
      parts.push(list);
    }
    const primary = card.primary && button(card.primary[0], card.primary[1], 'primary');
    const actions = el('div', 'sheet-actions');
    if (primary) actions.append(primary);
    if (card.secondary) actions.append(button(card.secondary[0], card.secondary[1], 'ghost'));
    this.card.replaceChildren(...parts, actions);
    (primary ?? this.card.querySelector<HTMLButtonElement>('.sweep-choice'))?.focus();
  }

  private fail(reason: string) {
    this.release();
    this.hint.textContent = '';
    this.show({
      title: this.dish ? 'The guided scan is not available' : 'The 360° scan is not available',
      lines: [reason, 'You can still add photos with Camera or Library.'],
      primary: ['Back to photos', () => this.settle([])],
    });
  }

  private async start() {
    this.show();
    this.hint.textContent = 'Starting the camera…';
    // Created inside the tap, so the capture tick is allowed to play later.
    try { this.audio = new AudioContext(); } catch { /* Sound is optional feedback. */ }
    const camera = window.isSecureContext && Boolean(navigator.mediaDevices?.getUserMedia);
    // Motion access is asked first: iOS refuses it once the tap is no longer the direct cause.
    const allowed = await requestMotion();
    if (this.settled) return;
    document.addEventListener('visibilitychange', this.onVisibility);
    if (allowed) window.addEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('devicemotion', this.onMotion);
    const sensed = allowed && camera && await this.firstReading();
    if (this.settled) return;
    if (import.meta.env.DEV && (!camera || !sensed)) {
      // Says why the real camera was skipped, so a phone on http://<LAN-IP> is not left guessing.
      this.dialog.dataset.simulatedWhy = camera ? 'No motion sensors on this device.'
        : `This page is not secure (https), so the camera is blocked. Open https://${location.hostname}:5181 for the real one.`;
      this.simulate();
    }
    else if (!camera) return this.fail('This page cannot open the camera. The scan needs a secure (https) connection.');
    else if (!sensed) return this.fail('This device did not share its motion sensors, which the scan uses to know where the phone points. Allow motion access for this site and try again.');
    else {
      try {
        await this.connectCamera();
        if (this.settled) return;
      } catch {
        if (this.settled) return;
        return this.fail('The camera could not be opened. Allow camera access for this site and try again.');
      }
    }
    const pose = this.readPose();
    if (!pose) return this.fail('This device stopped sharing its motion sensors.');
    // A phone pointing at the floor or ceiling has no heading of its own, so its top edge stands in.
    const pitch = pitchOf(pose.forward);
    const ahead = Math.abs(pitch) < 60 ? pose.forward : pose.up.map((value) => pitch < 0 ? value : -value) as Vec3;
    this.targets = this.dish ? createDishTargets(yawOf(ahead), this.dish) : createTargets(yawOf(ahead));
    this.pose = pose;
    this.scanning = true;
    this.last = performance.now();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.update();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly onOrientation = (event: DeviceOrientationEvent) => {
    const { alpha, beta, gamma } = event;
    if (document.hidden || alpha === null || beta === null || gamma === null
      || ![alpha, beta, gamma].every(Number.isFinite)) return;
    const now = performance.now();
    if (now - this.sensorAt > MOTION_TIMEOUT_MS) this.resetAim();
    this.sensorAt = now;
    this.sensorPose = poseFromOrientation(alpha, beta, gamma);
  };

  private readonly onVisibility = () => {
    this.sensorAt = -Infinity;
    this.resetAim();
    if (!document.hidden && this.scanning && this.stream && this.video.paused) {
      void this.video.play().catch(() => {
        if (this.scanning && !this.settled && !document.hidden) this.showCameraRetry();
      });
    }
  };

  private readonly onMotion = (event: DeviceMotionEvent) => {
    const rate = event.rotationRate;
    const push = event.acceleration;
    if (rate?.alpha == null || push?.x == null) return;
    const turn = Math.hypot(rate.alpha, rate.beta ?? 0, rate.gamma ?? 0);
    const shake = Math.hypot(push.x, push.y ?? 0, push.z ?? 0);
    const motion = this.motion ??= { turn, shake };
    // A jolt registers at once; calm has to last a moment before it counts.
    motion.turn = Math.max(turn, motion.turn + (turn - motion.turn) * 0.25);
    motion.shake = Math.max(shake, motion.shake + (shake - motion.shake) * 0.25);

    // Round a dish the person is meant to move, so there is no spot to hold them to.
    if (this.dish) return;
    const pull = event.accelerationIncludingGravity;
    if (pull?.x == null || pull.y == null || pull.z == null) return;
    // The two readings differ by gravity, which tells which way is down for the phone however it is held.
    const down = [pull.x - push.x, pull.y - (push.y ?? 0), pull.z - (push.z ?? 0)];
    const weight = Math.hypot(down[0], down[1], down[2]) || 1;
    this.feelStep(Math.abs(push.x * down[0] + (push.y ?? 0) * down[1] + (push.z ?? 0) * down[2]) / weight);
  };

  /** Counts step-like jolts, given how hard the phone is moving up or down, and stops the scan when they add up to walking. */
  private feelStep(bounce: number) {
    const now = performance.now();
    if (bounce < STEP_JOLT / 2) this.stepping = false;
    if (bounce < STEP_JOLT || this.stepping || now - (this.steps.at(-1) ?? 0) < STEP_GAP_MS) return;
    this.stepping = true;
    this.steps = [...this.steps.filter((time) => now - time < WALK_WINDOW_MS), now];
    // Until the first photo is taken there is no spot to keep to yet.
    if (this.steps.length < WALK_STEPS || !this.scanning || !this.captured.length) return;
    this.steps = [];
    haptic([30, 60, 30]);
    this.pause({
      title: 'Stay on your spot',
      lines: [
        'It looks like you walked. Every photo has to be taken from the same place, or the 3D build comes out wrong.',
        'Go back to where you took the first photo, then carry on turning on the spot.',
      ],
      primary: ['I\'m on my spot', () => this.resume()],
    });
  }

  /** Whether the phone is upright, so the horizon runs straight across the photo. */
  private get level() {
    if (!this.pose) return false;
    const steep = Math.abs(pitchOf(this.pose.forward));
    // Looking well down at a dish the horizon is out of the photo, and the sideways tilt reads less and less surely.
    if (this.dish) return steep > 55 || Math.abs(rollOf(this.pose)) <= DISH_LEVEL_DEGREES;
    // Aimed at the ceiling or the floor there is no horizon in the photo, and no sideways tilt to measure.
    return steep > 80 || Math.abs(rollOf(this.pose)) <= LEVEL_DEGREES;
  }

  /** How steeply the phone looks down right now, in degrees above the table. */
  private get elevation() { return this.pose ? -pitchOf(this.pose.forward) : 0; }

  /** How far round the dish a stop is from where the phone is now, in degrees: negative is to the person's right. */
  private around(target: Target) {
    const turn = yawOf(target.direction) - yawOf(this.pose!.forward);
    return turn - Math.round(turn / 360) * 360;
  }

  /** Whether the phone is still enough for a sharp photo. */
  private get steady() {
    if (this.speed >= STEADY_SPEED) return false;
    return !this.motion || (this.motion.turn < STEADY_TURN && this.motion.shake < STEADY_SHAKE);
  }

  private async firstReading() {
    for (let waited = 0; waited < 1200 && !this.sensorPose; waited += 50) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
      if (this.settled) return false;
    }
    return Boolean(this.sensorPose);
  }

  private async connectCamera() {
    this.disconnectCamera();
    this.connecting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      });
      if (this.settled) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      this.stream = stream;
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('mute', this.resetAim);
        track.addEventListener('ended', this.resetAim);
      }
      this.video.srcObject = stream;
      await this.video.play();
      if (this.settled) return;
    } catch (error) {
      this.disconnectCamera();
      throw error;
    } finally {
      this.connecting = false;
    }
  }

  private disconnectCamera() {
    for (const track of this.stream?.getTracks() ?? []) {
      track.removeEventListener('mute', this.resetAim);
      track.removeEventListener('ended', this.resetAim);
      track.stop();
    }
    this.stream = undefined;
    this.videoInterrupted = true;
    this.video.srcObject = null;
  }

  private cameraStopped() {
    if (this.simulated || this.connecting) return false;
    return !this.stream?.getVideoTracks().some((track) => track.readyState === 'live');
  }

  private cameraPaused() {
    if (this.simulated) return false;
    return this.videoInterrupted || this.video.paused || this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      || !this.stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled && !track.muted);
  }

  private showCameraRetry() {
    const files = this.captured;
    this.pause({
      title: 'Camera disconnected',
      lines: [files.length ? 'The photos you took are still in this scan.' : 'Reconnect to keep scanning.'],
      primary: ['Reconnect camera', () => void this.reconnectCamera()],
      secondary: files.length >= this.minimum ? [`Use ${files.length} photos`, () => this.settle(files)] : undefined,
    });
  }

  private async reconnectCamera() {
    this.show();
    this.hint.textContent = 'Reconnecting the camera…';
    try {
      await this.connectCamera();
      if (!this.settled && this.card.hidden) this.resume();
    } catch {
      if (!this.settled && this.card.hidden) this.showCameraRetry();
    }
  }

  private simulate() {
    const frame = document.createElement('canvas');
    frame.width = 720;
    frame.height = 1280;
    const view = this.simulated = { yaw: 0, pitch: 0, roll: 0, frame };
    this.dialog.dataset.simulated = 'true';
    let from: { x: number; y: number } | undefined;
    this.canvas.addEventListener('pointerdown', (event) => { from = { x: event.clientX, y: event.clientY }; });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!from) return;
      if (event.shiftKey) view.roll = Math.max(-45, Math.min(45, view.roll + (event.clientX - from.x) * 0.25));
      else {
        view.yaw -= (event.clientX - from.x) * 0.25;
        view.pitch = Math.max(-90, Math.min(90, view.pitch + (event.clientY - from.y) * 0.25));
      }
      from = { x: event.clientX, y: event.clientY };
    });
    for (const type of ['pointerup', 'pointercancel']) this.canvas.addEventListener(type, () => { from = undefined; });
  }

  private simulatedFrame() {
    const { frame, yaw, pitch } = this.simulated!;
    const context = frame.getContext('2d')!;
    const hue = ((yaw % 360) + 360) % 360;
    const sky = context.createLinearGradient(0, 0, 0, frame.height);
    sky.addColorStop(0, `hsl(${hue} 60% ${55 + pitch / 4}%)`);
    sky.addColorStop(1, `hsl(${(hue + 40) % 360} 45% 22%)`);
    context.fillStyle = sky;
    context.fillRect(0, 0, frame.width, frame.height);
    context.fillStyle = '#fff';
    context.font = '600 44px sans-serif';
    context.fillText(`yaw ${Math.round(hue)}° · pitch ${Math.round(pitch)}°`, 40, frame.height / 2);
    return frame;
  }

  private readPose() {
    return this.simulated ? poseFromYawPitch(this.simulated.yaw, this.simulated.pitch, this.simulated.roll) : this.sensorPose;
  }

  private readonly resize = () => {
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    for (const canvas of [this.canvas, this.dome]) {
      canvas.width = Math.round(canvas.clientWidth * ratio);
      canvas.height = Math.round(canvas.clientHeight * ratio);
    }
  };

  private readonly frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const reading = this.readPose();
    if (!reading || !this.pose) return;
    const dt = Math.min(0.1, Math.max(0.001, (now - this.last) / 1000));
    this.last = now;
    if (this.scanning) {
      const paused = this.capturePaused(now);
      if (this.cameraStopped()) this.showCameraRetry();
      else if (paused) {
        this.resetAim();
        if (this.hint.textContent !== paused) this.hint.textContent = paused;
      } else {
        const next = this.simulated ? reading : blend(this.pose, reading, 0.5);
        this.speed += (angleBetween(next.forward, this.pose.forward) / dt - this.speed) * 0.2;
        this.pose = next;
        this.track(dt);
      }
    }
    this.draw(now);
    this.drawDome();
  };

  private capturePaused(now: number) {
    if (document.hidden) return 'Return to the scan to keep going';
    if (this.cameraPaused()) return 'Waiting for the camera…';
    if (!this.simulated && now - this.sensorAt > MOTION_TIMEOUT_MS) return 'Waiting for motion sensors…';
  }

  private readonly resetAim = () => {
    this.aimed = undefined;
    this.held = 0;
    this.speed = 0;
    this.last = performance.now();
    this.captureEpoch++;
  };

  private track(dt: number) {
    const pose = this.pose!;
    const open = this.targets.filter((target) => !target.file);
    const upright = Boolean(this.simulated) || !this.landscape.matches || Math.abs(pitchOf(pose.forward)) > 80;
    let aimed: Target | undefined;
    let nearest = this.dish ? DISH_AIM_DEGREES : AIM_DEGREES;
    if (upright) {
      for (const target of open) {
        const angle = angleBetween(pose.forward, target.direction);
        if (angle < nearest) [nearest, aimed] = [angle, target];
      }
    }
    if (aimed !== this.aimed) {
      this.aimed = aimed;
      this.held = 0;
    }
    if (aimed && this.steady && this.level) {
      this.held += dt * 1000;
      if (this.held >= HOLD_MS && !this.capturing) void this.capture(aimed);
    } else if (aimed) {
      // Any movement or tilt starts the wait again: the photo is only taken after a full, unbroken moment
      // of holding the phone still and upright.
      this.held = 0;
    } else this.held = Math.max(0, this.held - dt * 2000);

    // Lead the person round one ring at a time: the horizon first, then up, then down.
    const ring = Math.min(...open.map((target) => target.ring));
    let guide: Target | undefined;
    let best = Infinity;
    for (const target of open) {
      if (target.ring !== ring) continue;
      // A small bonus for the current guide stops it flickering between two equally near dots.
      const angle = angleBetween(pose.forward, target.direction) - (target === this.guide ? 4 : 0);
      if (angle < best) [best, guide] = [angle, target];
    }
    this.guide = guide;
    const advice = upright ? this.advice() : 'Hold the phone upright';
    if (this.hint.textContent !== advice) this.hint.textContent = advice;
  }

  private advice() {
    if (!this.guide) return '';
    if (this.aimed) return !this.level ? 'Straighten the phone' : this.steady ? 'Hold still' : 'Steady the phone';
    if (this.speed > FAST_SPEED) return 'Slow down';
    if (this.dish) return this.dishAdvice(this.guide);
    const spot = this.place(this.guide);
    if (spot.visible) return 'Aim at the glowing dot';
    if (Math.abs(this.guide.pitch) === 90) return this.guide.pitch > 0 ? 'Tilt up' : 'Tilt down';
    const [x, y] = spot.side;
    if (!spot.front || Math.abs(x) >= Math.abs(y)) return x >= 0 ? 'Turn right' : 'Turn left';
    return y > 0 ? 'Tilt up' : 'Tilt down';
  }

  /** What to do next round a dish: first get to the ring's height, then walk the dot in. */
  private dishAdvice(guide: Target) {
    const want = elevationOf(guide);
    const off = want - this.elevation;
    if (want >= 90) return off > DISH_TILT_SLACK ? 'Hold the phone flat, right above it' : 'Centre it in the outline';
    if (off > DISH_TILT_SLACK) return 'Raise the phone and tilt it down';
    if (off < -DISH_TILT_SLACK) return 'Lower the phone toward the table';
    const turn = this.around(guide);
    if (Math.abs(turn) < 8) return 'Almost there';
    // Circling to the right turns the phone to the left, so a stop with a smaller heading is to the right.
    return turn < 0 ? 'Move right around it' : 'Move left around it';
  }

  private place(target: Target) {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const focal = Math.max(width, height) / 2 / Math.tan(OVERLAY_FOV * RAD / 2);
    const spot = project(this.pose!, target.direction, focal, width, height);
    const visible = spot.front && spot.x > 30 && spot.x < width - 30 && spot.y > 90 && spot.y < height - 110;
    return { ...spot, visible };
  }

  private async capture(target: Target) {
    // Nothing is captured in a moment the phone is moving or tilted.
    if (!this.steady || !this.level || this.capturePaused(performance.now())) return;
    const epoch = this.captureEpoch;
    const source = this.simulated ? this.simulatedFrame() : this.video;
    const width = this.simulated ? source.width : this.video.videoWidth;
    const height = this.simulated ? source.height : this.video.videoHeight;
    if (!width || !height) return;
    const shot = document.createElement('canvas');
    shot.width = width;
    shot.height = height;
    const context = shot.getContext('2d');
    if (!context) return;
    this.capturing = true;
    let blob: Blob | null;
    try {
      context.drawImage(source, 0, 0, width, height);
      blob = await new Promise<Blob | null>((resolve) => shot.toBlob(resolve, 'image/jpeg', 0.9));
    } catch {
      return;
    } finally {
      this.capturing = false;
      this.held = 0;
    }
    if (!blob || !this.scanning || this.settled || epoch !== this.captureEpoch
      || this.capturePaused(performance.now()) || target.file) return;
    const number = String(this.targets.indexOf(target) + 1).padStart(2, '0');
    target.file = new File([blob], `${this.dish ? 'dish-scan' : 'scan-360'}-${number}.jpg`, { type: 'image/jpeg' });
    target.capturedAt = performance.now();
    haptic(12);
    this.update();
    const done = this.captured.length;
    this.tone(520 + 520 * done / this.targets.length);
    if (done === this.targets.length) this.complete();
  }

  /** A short rising blip. Its pitch climbs as the scan fills in. */
  private tone(frequency: number, delay = 0) {
    const audio = this.audio;
    if (!audio || audio.state !== 'running') return;
    const start = audio.currentTime + delay;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.5, start + 0.09);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.18);
  }

  private update() {
    const total = this.targets.length, done = this.captured.length;
    this.count.textContent = total ? `${done} / ${total}` : '';
    this.progress.style.width = `${total ? done / total * 100 : 0}%`;
    this.finishButton.disabled = done < this.minimum;
  }

  private pause(card: Card) {
    this.scanning = false;
    this.resetAim();
    this.hint.textContent = '';
    this.show(card);
  }

  private resume() {
    this.show();
    this.steps = [];
    this.scanning = true;
  }

  private finish() {
    const files = this.captured;
    const total = this.targets.length, left = total - files.length;
    if (!left) return this.complete();
    const share = files.length / total;
    const coverage = share >= 0.75 ? 'Good coverage' : share >= 0.5 ? 'Partial coverage' : 'Low coverage';
    this.pause({
      title: left === 1 ? '1 spot left' : `${left} spots left`,
      lines: [
        `${coverage}: ${files.length} of ${total} photos.`,
        this.dish ? 'The 3D build is truer with both photos. The round map shows which one is still missing.'
          : 'The 3D build works best when every dot is captured. The round map shows what is still missing.',
      ],
      primary: ['Keep scanning', () => this.resume()],
      secondary: [`Use ${files.length} photos`, () => this.settle(files)],
    });
  }

  private complete() {
    const files = this.captured;
    haptic([10, 60, 20]);
    for (const [index, frequency] of [660, 830, 990].entries()) this.tone(frequency, index * 0.11);
    this.pause({
      title: 'Full coverage',
      lines: [`All ${files.length} spots are captured. The ${this.dish ? 'dish' : 'space'} is ready to build.`],
      primary: [`Use ${files.length} photos`, () => this.settle(files)],
    });
  }

  private requestClose() {
    const count = this.captured.length;
    if (!count) return this.settle([]);
    this.pause({
      title: 'Discard this scan?',
      lines: [`The ${count} ${count === 1 ? 'photo' : 'photos'} captured so far will be lost.`],
      primary: ['Keep scanning', () => count === this.targets.length ? this.complete() : this.resume()],
      secondary: ['Discard', () => this.settle([])],
    });
  }

  private release() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('deviceorientation', this.onOrientation);
    window.removeEventListener('devicemotion', this.onMotion);
    window.removeEventListener('resize', this.resize);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.disconnectCamera();
    void this.audio?.close().catch(() => undefined);
    this.audio = undefined;
  }

  private settle(files: File[]) {
    if (this.settled) return;
    this.settled = true;
    this.release();
    this.dialog.close();
    this.dialog.remove();
    this.resolve(files);
  }

  private draw(now: number) {
    const context = this.canvas.getContext('2d');
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    if (!context || !width) return;
    const ratio = this.canvas.width / width;
    const lively = motion(1) > 0;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    if (this.simulated) {
      const sky = context.createLinearGradient(0, 0, 0, height);
      sky.addColorStop(0, '#1b2a4d');
      sky.addColorStop(1, '#0b1020');
      context.fillStyle = sky;
      context.fillRect(0, 0, width, height);
    }
    if (this.dish) return this.drawDish(context, width, height, now, lively);

    for (const target of this.targets) {
      const spot = this.place(target);
      if (!spot.front || spot.x < -50 || spot.x > width + 50 || spot.y < -50 || spot.y > height + 50) continue;
      context.beginPath();
      if (target.file) {
        const age = (now - (target.capturedAt ?? 0)) / POP_MS;
        if (age < 1 && lively) {
          context.arc(spot.x, spot.y, 14 + 34 * age, 0, Math.PI * 2);
          context.strokeStyle = `rgb(${ACCENT} / ${1 - age})`;
          context.lineWidth = 1 + 3 * (1 - age);
          context.stroke();
          context.beginPath();
        }
        context.arc(spot.x, spot.y, 4, 0, Math.PI * 2);
        context.fillStyle = 'rgb(255 255 255 / 38%)';
        context.fill();
        continue;
      }
      const leading = target === this.guide;
      const radius = (leading ? 15 : 11) * (leading && lively ? 1 + 0.12 * Math.sin(now / 180) : 1);
      context.arc(spot.x, spot.y, radius, 0, Math.PI * 2);
      context.shadowColor = `rgb(${ACCENT})`;
      context.shadowBlur = leading ? 20 : 0;
      context.fillStyle = `rgb(${ACCENT} / ${leading ? 95 : 55}%)`;
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = `rgb(255 255 255 / ${leading ? 95 : 60}%)`;
      context.lineWidth = 2;
      context.stroke();
    }

    // Aiming ring. It turns amber while a dot is in it but the phone is moving or tilted, and its arc
    // only fills once the phone is still and upright.
    const blocked = this.scanning && Boolean(this.aimed) && !(this.steady && this.level);
    context.beginPath();
    context.arc(width / 2, height / 2, 30, 0, Math.PI * 2);
    context.strokeStyle = blocked ? `rgb(${AMBER})` : 'rgb(255 255 255 / 75%)';
    context.lineWidth = blocked ? 3 : 2;
    context.stroke();
    // The level, like a camera's: two fixed marks either side of the ring, and a line through it that
    // stays with the horizon. Tilt the phone and the line leans; hold it upright and the three join up.
    if (this.scanning) {
      const upright = this.level;
      context.lineCap = 'round';
      context.lineWidth = 2.5;
      context.strokeStyle = upright ? `rgb(${ACCENT})` : 'rgb(255 255 255 / 70%)';
      context.beginPath();
      for (const side of [-1, 1]) {
        context.moveTo(width / 2 + side * 52, height / 2);
        context.lineTo(width / 2 + side * 78, height / 2);
      }
      context.stroke();
      context.save();
      context.translate(width / 2, height / 2);
      context.rotate(upright ? 0 : rollOf(this.pose!) * RAD);
      context.strokeStyle = upright ? `rgb(${ACCENT})` : '#fff';
      context.beginPath();
      context.moveTo(-46, 0);
      context.lineTo(46, 0);
      context.stroke();
      context.restore();
    }
    if (this.aimed && this.held > 0) {
      context.beginPath();
      context.arc(width / 2, height / 2, 30, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.held / HOLD_MS));
      context.strokeStyle = `rgb(${ACCENT})`;
      context.lineWidth = 5;
      context.lineCap = 'round';
      context.stroke();
    }

    // When the next dot is out of view, an arrow at the edge shows which way to turn.
    if (!this.scanning || this.capturePaused(now) || !this.guide) return;
    const spot = this.place(this.guide);
    if (spot.visible) return;
    let [x, y] = spot.side;
    if (!spot.front && Math.abs(this.guide.pitch) === 90) [x, y] = [0, Math.sign(this.guide.pitch)];
    else if (!spot.front && Math.hypot(x, y) < 0.2) [x, y] = [1, 0];
    if (!spot.front) y *= 0.35;
    const length = Math.hypot(x, y) || 1;
    const [dx, dy] = [x / length, -y / length];
    const bob = lively ? 4 * Math.sin(now / 160) : 0;
    context.save();
    context.translate(width / 2 + dx * (width / 2 - 44 + bob), height / 2 + dy * (height / 2 - 150 + bob));
    context.rotate(Math.atan2(dy, dx));
    context.beginPath();
    context.moveTo(-9, -14);
    context.lineTo(8, 0);
    context.lineTo(-9, 14);
    context.strokeStyle = `rgb(${ACCENT})`;
    context.lineWidth = 5;
    context.lineCap = context.lineJoin = 'round';
    context.stroke();
    context.restore();
  }

  /**
   * The dish scan's view: an outline to fit the dish in, a ring round it lying on the table, the
   * stops of the round being taken as dots on that ring, and an aiming ring at its near side.
   * Carrying the phone round the dish slides the dots along the ring; raising or lowering the phone
   * slides the aiming ring across it. A photo is taken where a dot and the aiming ring meet.
   */
  private drawDish(context: CanvasRenderingContext2D, width: number, height: number, now: number, lively: boolean) {
    const plan = this.dish!;
    const short = Math.min(width, height);
    const cx = width / 2, cy = height / 2;
    const [boxWidth, boxHeight] = [plan.outline[0] * short, plan.outline[1] * short];

    // The outline. A plate and a bowl are round from wherever they are seen; a drink stands up straight.
    context.beginPath();
    if (plan.shape === 'drink') context.roundRect(cx - boxWidth / 2, cy - boxHeight / 2, boxWidth, boxHeight, boxWidth * 0.3);
    else context.ellipse(cx, cy, boxWidth / 2, boxHeight / 2, 0, 0, Math.PI * 2);
    context.setLineDash([9, 9]);
    context.strokeStyle = 'rgb(255 255 255 / 72%)';
    context.lineWidth = 2;
    context.stroke();
    context.setLineDash([]);
    if (!this.targets.length) return;

    // The round being taken: the lowest one with a stop still open.
    const open = this.targets.filter((target) => !target.file);
    const ring = open.length ? Math.min(...open.map((target) => target.ring)) : this.targets.at(-1)!.ring;
    const stops = this.targets.filter((target) => target.ring === ring);
    const want = elevationOf(stops[0]);
    const above = want >= 90;

    // The ring lies on the table, so it is a flat ellipse from low down and a circle from overhead.
    const goal = Math.max(0.2, Math.sin(Math.max(0, Math.min(90, this.elevation)) * RAD));
    this.squash += (goal - this.squash) * (lively ? 0.18 : 1);
    const baseY = cy + boxHeight / 2 * plan.base;
    const reachX = boxWidth / 2 + 30;
    const reachY = reachX * this.squash;
    context.beginPath();
    context.ellipse(cx, baseY, reachX, reachY, 0, 0, Math.PI * 2);
    context.strokeStyle = 'rgb(255 255 255 / 34%)';
    context.lineWidth = 2;
    context.stroke();

    // Where a stop sits: on the ring, as far round it as the phone still has to travel. The near side is "here".
    const spotOf = (target: Target) => {
      if (above) return { x: cx, y: baseY, depth: 1 };
      const angle = (90 + this.around(target)) * RAD;
      return { x: cx + reachX * Math.cos(angle), y: baseY + reachY * Math.sin(angle), depth: (1 + Math.sin(angle)) / 2 };
    };
    for (const target of [...stops].sort((a, b) => spotOf(a).depth - spotOf(b).depth)) {
      const spot = spotOf(target);
      // Stops on the far side of the ring are drawn smaller and fainter.
      const near = 0.6 + 0.4 * spot.depth;
      context.beginPath();
      if (target.file) {
        const age = (now - (target.capturedAt ?? 0)) / POP_MS;
        if (age < 1 && lively) {
          context.arc(spot.x, spot.y, 14 + 34 * age, 0, Math.PI * 2);
          context.strokeStyle = `rgb(${ACCENT} / ${1 - age})`;
          context.lineWidth = 1 + 3 * (1 - age);
          context.stroke();
          context.beginPath();
        }
        context.arc(spot.x, spot.y, 4 * near, 0, Math.PI * 2);
        context.fillStyle = 'rgb(255 255 255 / 42%)';
        context.fill();
        continue;
      }
      const leading = target === this.guide;
      const radius = (leading ? 15 : 11) * near * (leading && lively ? 1 + 0.12 * Math.sin(now / 180) : 1);
      context.arc(spot.x, spot.y, radius, 0, Math.PI * 2);
      context.shadowColor = `rgb(${ACCENT})`;
      context.shadowBlur = leading ? 20 : 0;
      context.fillStyle = `rgb(${ACCENT} / ${leading ? 95 : 40 + 25 * spot.depth}%)`;
      context.fill();
      context.shadowBlur = 0;
      context.strokeStyle = `rgb(255 255 255 / ${leading ? 95 : 60}%)`;
      context.lineWidth = 2;
      context.stroke();
    }

    // The aiming ring: where this phone is. It rests on the near side of the ring when the phone is at
    // the round's height, drops below it when the phone is too low and rises inside it when too high.
    const tilt = Math.max(-70, Math.min(70, (want - this.elevation) * DISH_TILT_TRAVEL));
    const [aimX, aimY] = [cx, (above ? baseY : baseY + reachY) + tilt];
    const blocked = this.scanning && Boolean(this.aimed) && !(this.steady && this.level);
    if (this.scanning && Math.abs(tilt) > DISH_TILT_SLACK * DISH_TILT_TRAVEL) {
      // A short tail back to where it belongs shows which way to move the phone.
      context.beginPath();
      context.moveTo(aimX, aimY - Math.sign(tilt) * 26);
      context.lineTo(aimX, aimY - tilt + Math.sign(tilt) * 6);
      context.setLineDash([3, 6]);
      context.strokeStyle = 'rgb(255 255 255 / 70%)';
      context.lineWidth = 2;
      context.stroke();
      context.setLineDash([]);
    }
    context.beginPath();
    context.arc(aimX, aimY, 24, 0, Math.PI * 2);
    context.strokeStyle = blocked ? `rgb(${AMBER})` : '#fff';
    context.lineWidth = blocked ? 3.5 : 2.5;
    context.stroke();
    if (this.aimed && this.held > 0) {
      context.beginPath();
      context.arc(aimX, aimY, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, this.held / HOLD_MS));
      context.strokeStyle = `rgb(${ACCENT})`;
      context.lineWidth = 5;
      context.lineCap = 'round';
      context.stroke();
    }

    // Which way round the next dot is, when it is on the far side and easy to miss.
    if (!this.scanning || above || !this.guide || this.capturePaused(now)) return;
    const turn = this.around(this.guide);
    if (Math.abs(turn) < 50) return;
    const side = turn < 0 ? 1 : -1;
    const bob = lively ? 4 * Math.sin(now / 160) : 0;
    context.save();
    context.translate(cx + side * (reachX + 26 + bob), baseY);
    context.scale(side, 1);
    context.beginPath();
    context.moveTo(-8, -13);
    context.lineTo(7, 0);
    context.lineTo(-8, 13);
    context.strokeStyle = `rgb(${ACCENT})`;
    context.lineWidth = 5;
    context.lineCap = context.lineJoin = 'round';
    context.stroke();
    context.restore();
  }

  /** The dish seen from above, with every stop of every round: the phone is at the bottom, looking in. */
  private drawDishMap(context: CanvasRenderingContext2D, size: number) {
    const center = size / 2, reach = size / 2 - 7;
    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, reach, (90 - 22) * RAD, (90 + 22) * RAD);
    context.closePath();
    context.fillStyle = `rgb(${ACCENT} / 18%)`;
    context.fill();
    context.beginPath();
    context.arc(center, center, reach * 0.2, 0, Math.PI * 2);
    context.strokeStyle = 'rgb(255 255 255 / 55%)';
    context.lineWidth = 1.5;
    context.stroke();
    for (const target of this.targets) {
      const elevation = elevationOf(target);
      // Low rounds sit at the rim and high ones near the dish; the photo from above is the dish itself.
      const radius = elevation >= 90 ? 0 : reach * (1 - elevation / 110);
      const angle = (90 + this.around(target)) * RAD;
      context.beginPath();
      context.arc(center + radius * Math.cos(angle), center + radius * Math.sin(angle), target.file ? 1.6 : target === this.guide ? 4 : 2.8, 0, Math.PI * 2);
      context.fillStyle = target.file ? 'rgb(255 255 255 / 30%)' : `rgb(${ACCENT})`;
      context.fill();
    }
  }

  /** Top-down map of every spot around the person: the direction they face points up. */
  private drawDome() {
    const context = this.dome.getContext('2d');
    const size = this.dome.clientWidth;
    if (!context || !size || !this.pose) return;
    const ratio = this.dome.width / size;
    const center = size / 2, reach = size / 2 - 7;
    const heading = yawOf(this.pose.forward);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, size, size);
    if (this.dish) return this.drawDishMap(context, size);
    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, reach, (-90 - 22) * RAD, (-90 + 22) * RAD);
    context.closePath();
    context.fillStyle = `rgb(${ACCENT} / 18%)`;
    context.fill();
    for (const target of this.targets) {
      // The ceiling ring sits nearest the centre and the floor ring at the rim.
      const radius = reach * (90 - target.pitch) / 180;
      const angle = (yawOf(target.direction) - heading - 90) * RAD;
      context.beginPath();
      context.arc(center + radius * Math.cos(angle), center + radius * Math.sin(angle), target.file ? 1.6 : target === this.guide ? 4 : 2.8, 0, Math.PI * 2);
      context.fillStyle = target.file ? 'rgb(255 255 255 / 30%)' : `rgb(${ACCENT})`;
      context.fill();
    }
    context.beginPath();
    context.arc(center, center, 2.5, 0, Math.PI * 2);
    context.fillStyle = '#fff';
    context.fill();
  }
}

/** Opens the guided 360° scan. Resolves with the photos it took, or with none when it is dismissed. */
export function openGuidedScan(minimum: number): Promise<File[]> {
  return new Promise((resolve) => { new GuidedScan(minimum, resolve); });
}

/**
 * Opens the guided scan of one dish or drink. Resolves with the photos it took, or with none when it is dismissed.
 * With a shape already picked, it skips the card that asks for one.
 */
export function openDishScan(minimum = 1, plan?: DishPlan): Promise<File[]> {
  return new Promise((resolve) => { new GuidedScan(minimum, resolve, 'dish', plan); });
}
