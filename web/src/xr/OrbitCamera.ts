import * as pc from 'playcanvas';
import { clamp, coastTurntable, damp, TurnVelocity, wrapAngle } from './sceneSupport';

const MOVE_KEYS: Record<string, [number, number]> = {
  // [forward, strafe] in the camera's own ground plane.
  KeyW: [1, 0], ArrowUp: [1, 0],
  KeyS: [-1, 0], ArrowDown: [-1, 0],
  KeyA: [0, -1], ArrowLeft: [0, -1],
  KeyD: [0, 1], ArrowRight: [0, 1],
};

interface Pose {
  pivot: pc.Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  min?: number;
  max?: number;
  /** How far the pivot may be driven from its starting point, in world units. Keeps keyboard
   *  movement on the map instead of letting the viewer wander into the void. */
  roam?: number;
  /** Lowest the camera may drop. Scenes with a ground plane set this so the viewer can
   *  never orbit down to the horizon and see the plane edge-on, or past it into empty space. */
  minPitch?: number;
  maxPitch?: number;
}

interface Pointer {
  x: number;
  y: number;
  pan: boolean;
}

export class OrbitCamera {
  private goal: Pose;
  private pose: Pose;
  private pointers = new Map<number, Pointer>();
  private moved = false;
  private downX = 0;
  private downY = 0;
  private events = new AbortController();
  private previousTouchAction: string;
  private position = new pc.Vec3();
  private active = true;
  private motion = new TurnVelocity();
  private spinKind: 'yaw' | 'dish' | null = null;
  /** Keys currently held. WASD and the arrows drive the pivot across the ground. */
  private readonly held = new Set<string>();
  private home = new pc.Vec3();
  private yawVelocity = 0;
  private dishVelocity = 0;

  constructor(
    private canvas: HTMLCanvasElement, private camera: pc.Entity,
    initial: Pose, pick: (x: number, y: number) => void,
    private turnDish: (radians: number) => boolean,
    hover: (x: number, y: number) => void = () => {},
  ) {
    this.goal = { ...initial, pivot: initial.pivot.clone() };
    this.home = initial.pivot.clone();
    this.pose = { ...initial, pivot: initial.pivot.clone() };
    this.previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    const { signal } = this.events;
    // Keyboard drives the pivot; the mouse keeps rotation. Listening on the window rather than
    // the canvas means the keys work without clicking the scene first, but anything typed into
    // a field still belongs to that field.
    window.addEventListener('keydown', (event) => {
      if (!this.enabled || !(event.code in MOVE_KEYS)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const fresh = !this.held.has(event.code);
      this.held.add(event.code);
      // Nudge on press as well as moving while held. Holding is the normal case, but a quick
      // tap can be released inside a single frame, and without this it would do nothing.
      if (fresh) this.walk(0.09);
      // Arrows would otherwise scroll the page under the canvas.
      event.preventDefault();
    }, { signal });
    window.addEventListener('keyup', (event) => { this.held.delete(event.code); }, { signal });
    // A lost focus must not leave a key stuck down.
    window.addEventListener('blur', () => this.held.clear(), { signal });
    canvas.addEventListener('pointerdown', (event) => {
      if (!this.enabled) return;
      if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
      this.cancelSpin();
      if (!this.pointers.size) {
        this.downX = event.clientX;
        this.downY = event.clientY;
        this.moved = event.button !== 0 || event.shiftKey;
      }
      this.pointers.set(event.pointerId, {
        x: event.clientX, y: event.clientY, pan: event.button !== 0 || event.shiftKey,
      });
      if (this.pointers.size > 1) this.moved = true;
      canvas.setPointerCapture(event.pointerId);
    }, { signal });
    canvas.addEventListener('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (this.enabled && !this.pointers.size && event.pointerType === 'mouse') hover(event.clientX, event.clientY);
      if (!this.enabled || !previous) return;
      const wasMoved = this.moved;
      if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > 5) this.moved = true;
      const dx = event.clientX - (wasMoved ? previous.x : this.downX);
      const dy = event.clientY - (wasMoved ? previous.y : this.downY);
      const other = [...this.pointers].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (before > 8 && after > 8) this.zoom(before / after);
        this.pan(dx * 0.5, dy * 0.5);
      } else if (this.moved) {
        if (previous.pan) this.pan(dx, dy);
        else {
          const dish = dx * 0.009;
          const yaw = -dx * 0.007;
          this.spinKind = this.turnDish(dish) ? 'dish' : 'yaw';
          if (this.spinKind === 'yaw') this.goal.yaw += yaw;
          this.motion.add(this.spinKind === 'dish' ? dish : yaw, performance.now());
          this.goal.pitch = clamp(this.goal.pitch + dy * 0.006,
            this.goal.minPitch ?? -0.65, this.goal.maxPitch ?? 1.42);
        }
      }
      previous.x = event.clientX;
      previous.y = event.clientY;
    }, { signal });
    const endPointer = (event: PointerEvent): void => {
      if (!this.pointers.delete(event.pointerId)) return;
      if (!this.enabled || event.type !== 'pointerup' || this.pointers.size) {
        this.cancelSpin();
        return;
      }
      if (!this.moved && Math.hypot(event.clientX - this.downX, event.clientY - this.downY) <= 5) {
        pick(event.clientX, event.clientY);
      } else if (this.spinKind) {
        const velocity = this.motion.release(performance.now());
        if (this.spinKind === 'dish') this.dishVelocity = velocity;
        else this.yawVelocity = velocity;
      }
      this.spinKind = null;
    };
    canvas.addEventListener('pointerup', endPointer, { signal });
    canvas.addEventListener('pointercancel', endPointer, { signal });
    canvas.addEventListener('lostpointercapture', endPointer, { signal });
    canvas.addEventListener('wheel', (event) => {
      if (!this.enabled) return;
      event.preventDefault();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      this.zoom(Math.exp(clamp(event.deltaY * units * 0.0011, -0.5, 0.5)));
    }, { passive: false, signal });
    canvas.addEventListener('contextmenu', (event) => event.preventDefault(), { signal });
    this.update(1);
  }

  get enabled(): boolean { return this.active; }

  set enabled(value: boolean) {
    this.active = value;
    if (!value) {
      this.pointers.clear();
      this.cancelSpin();
    }
  }

  cancelSpin(): void {
    if (this.yawVelocity !== 0) this.goal.yaw = this.pose.yaw;
    this.yawVelocity = 0;
    this.dishVelocity = 0;
    this.spinKind = null;
    this.motion.reset(performance.now());
  }

  frame(pose: Pose, immediate = false): void {
    this.cancelSpin();
    const turn = Math.PI * 2;
    const yaw = this.pose.yaw + wrapAngle(pose.yaw - this.pose.yaw);
    this.goal = { ...pose, yaw, pivot: pose.pivot.clone() };
    if (immediate) {
      this.pose = { ...this.goal, yaw: yaw % turn, pivot: pose.pivot.clone() };
      this.goal.yaw = this.pose.yaw;
      this.update(1);
    }
  }

  nudge(yawDeltaRad: number, pitchDeltaRad: number, zoomFactor = 1): void {
    this.cancelSpin();
    if (Number.isFinite(yawDeltaRad)) this.goal.yaw += yawDeltaRad;
    if (Number.isFinite(pitchDeltaRad)) this.goal.pitch = clamp(this.goal.pitch + pitchDeltaRad,
      this.goal.minPitch ?? -0.65, this.goal.maxPitch ?? 1.42);
    if (Number.isFinite(zoomFactor) && zoomFactor > 0 && zoomFactor !== 1) this.zoom(zoomFactor);
  }

  focusAt(target: pc.Vec3, distance?: number): void {
    this.cancelSpin();
    this.goal.pivot.copy(target);
    if (distance !== undefined && Number.isFinite(distance)) {
      this.goal.distance = clamp(distance, this.goal.min ?? 0.15, this.goal.max ?? 6);
    }
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const dragging = this.pointers.size > 0 && this.moved;
    const progress = damp(dt, dragging || this.yawVelocity !== 0 ? 24 : 8);
    this.yawVelocity = coastTurntable(this.yawVelocity, dt, 5.5, (delta) => { this.goal.yaw += delta; });
    this.dishVelocity = coastTurntable(this.dishVelocity, dt, 5.5, this.turnDish);
    this.walk(dt);
    const pose = this.pose;
    const goal = this.goal;
    pose.pivot.lerp(pose.pivot, goal.pivot, progress);
    pose.yaw = pc.math.lerp(pose.yaw, goal.yaw, progress);
    pose.pitch = pc.math.lerp(pose.pitch, goal.pitch, progress);
    pose.distance = pc.math.lerp(pose.distance, goal.distance, progress);
    this.apply();
  }

  private apply(): void {
    const pose = this.pose;
    const horizontal = Math.cos(pose.pitch) * pose.distance;
    this.position.set(Math.sin(pose.yaw) * horizontal, Math.sin(pose.pitch) * pose.distance, Math.cos(pose.yaw) * horizontal);
    this.camera.setPosition(this.position.add(pose.pivot));
    this.camera.lookAt(pose.pivot);
  }

  private zoom(factor: number): void {
    this.goal.distance = clamp(this.goal.distance * factor, this.goal.min ?? 0.15, this.goal.max ?? 6);
  }

  /**
   * Move the pivot across the ground from held keys.
   *
   * Forward is the camera's own forward flattened onto the ground, so W always goes where the
   * viewer is looking regardless of pitch -- using camera.forward directly would drive the
   * pivot into the floor as the camera tilts down. Speed scales with distance so a step feels
   * the same whether zoomed in or out, and the result is clamped to a radius around the
   * starting pivot so the map can't be left behind.
   */
  private walk(dt: number): void {
    if (!this.held.size) return;
    let forward = 0;
    let strafe = 0;
    for (const code of this.held) {
      const move = MOVE_KEYS[code];
      if (!move) continue;
      forward += move[0];
      strafe += move[1];
    }
    if (!forward && !strafe) return;
    const step = this.goal.distance * 0.9 * Math.min(dt, 0.05);
    const ahead = this.camera.forward.clone();
    ahead.y = 0;
    if (ahead.length() < 1e-4) return;
    ahead.normalize();
    const side = this.camera.right.clone();
    side.y = 0;
    side.normalize();
    const scale = 1 / Math.hypot(forward, strafe);
    this.goal.pivot.addScaled(ahead, forward * scale * step);
    this.goal.pivot.addScaled(side, strafe * scale * step);

    const roam = this.goal.roam;
    if (roam === undefined) return;
    const dx = this.goal.pivot.x - this.home.x;
    const dz = this.goal.pivot.z - this.home.z;
    const drift = Math.hypot(dx, dz);
    if (drift <= roam) return;
    const k = roam / drift;
    this.goal.pivot.x = this.home.x + dx * k;
    this.goal.pivot.z = this.home.z + dz * k;
  }

  private pan(dx: number, dy: number): void {
    const factor = this.goal.distance * 1.2 / Math.max(100, this.canvas.clientHeight);
    this.goal.pivot.addScaled(this.camera.right, -dx * factor);
    this.goal.pivot.addScaled(this.camera.up, dy * factor);
  }

  destroy(): void {
    this.events.abort();
    this.canvas.style.touchAction = this.previousTouchAction;
    this.pointers.clear();
  }
}
