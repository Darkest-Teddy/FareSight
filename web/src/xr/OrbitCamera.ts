import * as pc from 'playcanvas';
import { clamp, coastTurntable, damp, TurnVelocity, wrapAngle } from './sceneSupport';

interface Pose {
  pivot: pc.Vec3;
  yaw: number;
  pitch: number;
  distance: number;
  min?: number;
  max?: number;
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
  private yawVelocity = 0;
  private dishVelocity = 0;

  constructor(
    private canvas: HTMLCanvasElement, private camera: pc.Entity,
    initial: Pose, pick: (x: number, y: number) => void,
    private turnDish: (radians: number) => boolean,
    hover: (x: number, y: number) => void = () => {},
  ) {
    this.goal = { ...initial, pivot: initial.pivot.clone() };
    this.pose = { ...initial, pivot: initial.pivot.clone() };
    this.previousTouchAction = canvas.style.touchAction;
    canvas.style.touchAction = 'none';
    const { signal } = this.events;
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
          this.goal.pitch = clamp(this.goal.pitch + dy * 0.006, -0.65, 1.42);
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
    if (Number.isFinite(pitchDeltaRad)) this.goal.pitch = clamp(this.goal.pitch + pitchDeltaRad, -0.65, 1.42);
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
