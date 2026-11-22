import { button, el, haptic, iconButton, motion } from '../dom';
import {
  angleBetween, blend, createTargets, pitchOf, poseFromOrientation, poseFromYawPitch, project, yawOf,
  type Pose, type Target, type Vec3,
} from '../scan/sphere';

/** How close the view axis must come to a dot, in degrees, before it can be captured. */
const AIM_DEGREES = 7;
/** Turning speed, in degrees per second, below which a frame is sharp enough to keep. */
const STEADY_SPEED = 16;
const FAST_SPEED = 80;
const HOLD_MS = 450;
// The stabilizer. A photo is only taken while the phone's own motion sensors read below both limits:
// how fast it is turning, in degrees per second, and how hard it is being moved, in metres per second squared.
// A hand holding a phone still stays well under these; sliding or shaking it from side to side does not.
const STEADY_TURN = 10;
const STEADY_SHAKE = 0.5;
const AMBER = '255 181 71';
const POP_MS = 420;
// Long-side field of view the dots are drawn with. It is wider than the camera's own (about 64°) on purpose:
// at camera scale a phone in portrait shows one dot at a time, and the person could not see what comes next.
// A dot still reaches the aiming ring exactly when the camera points at it.
const OVERLAY_FOV = 105;
const RAD = Math.PI / 180;
const ACCENT = '79 227 255';

interface Card {
  title: string;
  lines: string[];
  steps?: boolean;
  primary: [label: string, action: () => void];
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
 * Full-screen 360° scan. The person turns on the spot while dots mark the directions still to capture;
 * aiming at a dot and holding still takes that photo and pops the dot.
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
  private stream?: MediaStream;
  private audio?: AudioContext;
  /** Development stand-in for the sensors and camera, steered by dragging. */
  private simulated?: { yaw: number; pitch: number; frame: HTMLCanvasElement };
  private aimed?: Target;
  private guide?: Target;
  private scanning = false;
  private capturing = false;
  private settled = false;
  private held = 0;
  private speed = 0;
  /** Smoothed readings of the phone's gyroscope and accelerometer, once they start arriving. */
  private motion?: { turn: number; shake: number };
  /** Where the stabilizer's bubble sits in the aiming ring: it drifts with the phone and settles when it is still. */
  private drift: [number, number] = [0, 0];
  private last = 0;
  private raf = 0;

  constructor(private readonly minimum: number, private readonly resolve: (files: File[]) => void) {
    this.dialog.setAttribute('aria-label', '360° scan');
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.setAttribute('aria-hidden', 'true');
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
    this.show({
      title: 'Scan the space in 360°',
      lines: [
        'Stand in the middle of the room.',
        'Hold the phone upright and turn slowly on the spot.',
        'Aim at each dot and hold still until it pops.',
      ],
      steps: true,
      primary: ['Start scan', () => void this.start()],
      secondary: ['Not now', () => this.settle([])],
    });
  }

  private get captured() { return this.targets.flatMap((target) => target.file ? [target.file] : []); }

  private show(card?: Card) {
    this.card.hidden = !card;
    this.dialog.dataset.card = String(Boolean(card));
    if (!card) return;
    const body = el(card.steps ? 'ol' : 'div', card.steps ? 'tips' : 'sweep-lines');
    body.append(...card.lines.map((line) => el(card.steps ? 'li' : 'p', '', line)));
    const primary = button(card.primary[0], card.primary[1], 'primary');
    const actions = el('div', 'sheet-actions');
    actions.append(primary);
    if (card.secondary) actions.append(button(card.secondary[0], card.secondary[1], 'ghost'));
    this.card.replaceChildren(el('h2', '', card.title), body, actions);
    primary.focus();
  }

  private fail(reason: string) {
    this.release();
    this.hint.textContent = '';
    this.show({
      title: 'The 360° scan is not available',
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
    window.addEventListener('deviceorientation', this.onOrientation);
    window.addEventListener('devicemotion', this.onMotion);
    const sensed = allowed && await this.firstReading();
    if (import.meta.env.DEV && (!camera || !sensed)) this.simulate();
    else if (!camera) return this.fail('This page cannot open the camera. The scan needs a secure (https) connection.');
    else if (!sensed) return this.fail('This device did not share its motion sensors, which the scan uses to know where the phone points. Allow motion access for this site and try again.');
    else {
      try {
        // 1080p keeps 32 photos light to upload and is what every phone browser can deliver.
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        this.video.srcObject = this.stream;
        await this.video.play();
      } catch {
        return this.fail('The camera could not be opened. Allow camera access for this site and try again.');
      }
    }
    if (this.settled) return this.release();
    const pose = this.readPose();
    if (!pose) return this.fail('This device stopped sharing its motion sensors.');
    // A phone pointing at the floor or ceiling has no heading of its own, so its top edge stands in.
    const pitch = pitchOf(pose.forward);
    const ahead = Math.abs(pitch) < 60 ? pose.forward : pose.up.map((value) => pitch < 0 ? value : -value) as Vec3;
    this.targets = createTargets(yawOf(ahead));
    this.pose = pose;
    this.scanning = true;
    this.last = performance.now();
    this.resize();
    window.addEventListener('resize', this.resize);
    this.update();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly onOrientation = (event: DeviceOrientationEvent) => {
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    this.sensorPose = poseFromOrientation(event.alpha, event.beta, event.gamma);
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
    // Turning about the phone's long side and sliding it sideways both push the bubble sideways.
    this.nudge((rate.gamma ?? 0) * 0.9 + push.x * 16, (rate.beta ?? 0) * 0.9 - (push.y ?? 0) * 16);
  };

  private nudge(x: number, y: number) {
    const reach = 21;
    const length = Math.hypot(x, y);
    const scale = length > reach ? reach / length : 1;
    this.drift = [this.drift[0] + (x * scale - this.drift[0]) * 0.3, this.drift[1] + (y * scale - this.drift[1]) * 0.3];
  }

  /** Whether the phone is still enough for a sharp photo. */
  private get steady() {
    if (this.speed >= STEADY_SPEED) return false;
    return !this.motion || (this.motion.turn < STEADY_TURN && this.motion.shake < STEADY_SHAKE);
  }

  private async firstReading() {
    for (let waited = 0; waited < 1200 && !this.sensorPose; waited += 50) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    return Boolean(this.sensorPose);
  }

  private simulate() {
    const frame = document.createElement('canvas');
    frame.width = 720;
    frame.height = 1280;
    const view = this.simulated = { yaw: 0, pitch: 0, frame };
    this.dialog.dataset.simulated = 'true';
    let from: { x: number; y: number } | undefined;
    this.canvas.addEventListener('pointerdown', (event) => { from = { x: event.clientX, y: event.clientY }; });
    this.canvas.addEventListener('pointermove', (event) => {
      if (!from) return;
      view.yaw -= (event.clientX - from.x) * 0.25;
      view.pitch = Math.max(-80, Math.min(80, view.pitch + (event.clientY - from.y) * 0.25));
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
    return this.simulated ? poseFromYawPitch(this.simulated.yaw, this.simulated.pitch) : this.sensorPose;
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
    const next = this.simulated ? reading : blend(this.pose, reading, 0.5);
    this.speed += (angleBetween(next.forward, this.pose.forward) / dt - this.speed) * 0.2;
    // Without motion sensors the bubble follows the view itself: how fast it is sweeping sideways and up.
    if (!this.motion) {
      const sweep = next.forward.map((value, index) => (value - this.pose!.forward[index]) / dt / RAD);
      this.nudge(
        sweep[0] * next.right[0] + sweep[1] * next.right[1] + sweep[2] * next.right[2],
        -(sweep[0] * next.up[0] + sweep[1] * next.up[1] + sweep[2] * next.up[2]),
      );
    }
    this.pose = next;
    if (this.scanning) this.track(dt);
    this.draw(now);
    this.drawDome();
  };

  private track(dt: number) {
    const pose = this.pose!;
    const open = this.targets.filter((target) => !target.file);
    const upright = Boolean(this.simulated) || !this.landscape.matches;
    let aimed: Target | undefined;
    let nearest = AIM_DEGREES;
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
    if (aimed && this.steady) {
      this.held += dt * 1000;
      if (this.held >= HOLD_MS && !this.capturing) void this.capture(aimed);
    } else if (aimed) {
      // Any movement starts the wait again: the photo is only taken after a full, unbroken moment of stillness.
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
    if (this.aimed) return this.steady ? 'Hold still' : 'Steady the phone';
    if (this.speed > FAST_SPEED) return 'Slow down';
    const spot = this.place(this.guide);
    if (spot.visible) return 'Aim at the glowing dot';
    const [x, y] = spot.side;
    if (!spot.front || Math.abs(x) >= Math.abs(y)) return x >= 0 ? 'Turn right' : 'Turn left';
    return y > 0 ? 'Tilt up' : 'Tilt down';
  }

  private place(target: Target) {
    const width = this.canvas.clientWidth, height = this.canvas.clientHeight;
    const focal = Math.max(width, height) / 2 / Math.tan(OVERLAY_FOV * RAD / 2);
    const spot = project(this.pose!, target.direction, focal, width, height);
    const visible = spot.front && spot.x > 30 && spot.x < width - 30 && spot.y > 90 && spot.y < height - 110;
    return { ...spot, visible };
  }

  private async capture(target: Target) {
    // The stabilizer has the last word: nothing is captured in a moment the phone is moving.
    if (!this.steady) return;
    const source = this.simulated ? this.simulatedFrame() : this.video;
    const width = this.simulated ? source.width : this.video.videoWidth;
    const height = this.simulated ? source.height : this.video.videoHeight;
    if (!width || !height) return;
    this.capturing = true;
    const shot = document.createElement('canvas');
    shot.width = width;
    shot.height = height;
    shot.getContext('2d')?.drawImage(source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => shot.toBlob(resolve, 'image/jpeg', 0.9));
    this.capturing = false;
    this.held = 0;
    if (!blob || !this.scanning || target.file) return;
    const number = String(this.targets.indexOf(target) + 1).padStart(2, '0');
    target.file = new File([blob], `scan-360-${number}.jpg`, { type: 'image/jpeg' });
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
    this.aimed = undefined;
    this.held = 0;
    this.hint.textContent = '';
    this.show(card);
  }

  private resume() {
    this.show();
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
        'The 3D build works best when every dot is captured. The round map shows what is still missing.',
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
      lines: [`All ${files.length} spots are captured. The space is ready to build.`],
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
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = undefined;
    this.video.srcObject = null;
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

    // Aiming ring. It turns amber while a dot is in it but the phone is moving, and its arc only fills
    // once the phone is still.
    const shaky = this.scanning && Boolean(this.aimed) && !this.steady;
    context.beginPath();
    context.arc(width / 2, height / 2, 30, 0, Math.PI * 2);
    context.strokeStyle = shaky ? `rgb(${AMBER})` : 'rgb(255 255 255 / 75%)';
    context.lineWidth = shaky ? 3 : 2;
    context.stroke();
    // The stabilizer's bubble: it drifts off centre as the phone moves and settles back when it is still.
    if (this.scanning) {
      context.beginPath();
      context.arc(width / 2 + this.drift[0], height / 2 + this.drift[1], 5, 0, Math.PI * 2);
      context.fillStyle = this.steady ? `rgb(${ACCENT})` : `rgb(${AMBER})`;
      context.fill();
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
    if (!this.scanning || !this.guide) return;
    const spot = this.place(this.guide);
    if (spot.visible) return;
    let [x, y] = spot.side;
    if (!spot.front && Math.hypot(x, y) < 0.2) [x, y] = [1, 0];
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
    context.beginPath();
    context.moveTo(center, center);
    context.arc(center, center, reach, (-90 - 22) * RAD, (-90 + 22) * RAD);
    context.closePath();
    context.fillStyle = `rgb(${ACCENT} / 18%)`;
    context.fill();
    for (const target of this.targets) {
      // The ceiling ring sits nearest the centre and the floor ring at the rim.
      const radius = reach * (90 - target.pitch) / 125;
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
