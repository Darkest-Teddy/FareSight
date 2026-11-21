import * as pc from 'playcanvas';
import { clamp, damp } from './sceneSupport';

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
  enabled = true;

  constructor(
    private canvas: HTMLCanvasElement, private camera: pc.Entity,
    initial: Pose, pick: (x: number, y: number) => void,
    turnDish: (radians: number) => boolean,
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
      const dx = event.clientX - previous.x;
      const dy = event.clientY - previous.y;
      if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > 5) this.moved = true;
      const other = [...this.pointers].find(([id]) => id !== event.pointerId)?.[1];
      if (other) {
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (before > 8 && after > 8) this.zoom(before / after);
        this.pan(dx * 0.5, dy * 0.5);
      } else if (this.moved) {
        if (previous.pan) this.pan(dx, dy);
        else {
          if (!turnDish(dx * 0.009)) this.goal.yaw -= dx * 0.007;
          this.goal.pitch = clamp(this.goal.pitch + dy * 0.006, -0.65, 1.42);
        }
      }
      previous.x = event.clientX;
      previous.y = event.clientY;
    }, { signal });
    const endPointer = (event: PointerEvent): void => {
      if (!this.pointers.delete(event.pointerId)) return;
      if (this.enabled && event.type === 'pointerup' && !this.moved && this.pointers.size === 0) {
        pick(event.clientX, event.clientY);
      }
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

  frame(pose: Pose, immediate = false): void {
    const turn = Math.PI * 2;
    const yaw = this.pose.yaw + Math.atan2(Math.sin(pose.yaw - this.pose.yaw), Math.cos(pose.yaw - this.pose.yaw));
    this.goal = { ...pose, yaw, pivot: pose.pivot.clone() };
    if (immediate) {
      this.pose = { ...this.goal, yaw: yaw % turn, pivot: pose.pivot.clone() };
      this.goal.yaw = this.pose.yaw;
      this.update(1);
    }
  }

  update(dt: number): void {
    if (!this.enabled) return;
    const progress = damp(dt, 8);
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
