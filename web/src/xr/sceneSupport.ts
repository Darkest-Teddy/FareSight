import * as pc from 'playcanvas';
import type { XRSceneCallbacks } from './bridgeTypes';

export const assetBase = '/assets-demo/';
/** Text, rings and outlines on the paper backdrop. */
export const ink = '#22252B';
/** The one warm highlight, used as a fill behind ink. Matches --highlight in tokens.css. */
export const sunflower = '#FFC93C';
/** Sunflower deepened until it holds its own as a line or ring on a pale surface. */
export const highlightInk = '#B46A00';
/**
 * The studio light rig, shared by the app and the landing page. Ambient is high because on a light
 * backdrop the shaded side of a pale model must not go muddy; the key stays warm and modest so
 * light surfaces keep their colour instead of clipping to white.
 */
export const studioAmbient: XYZ = [0.54, 0.54, 0.55];
export const studioLights: { name: string; tint: string; intensity: number; angles: XYZ }[] = [
  { name: 'Warm studio key', tint: '#fff6e8', intensity: 1.38, angles: [37, -31, 36] },
  { name: 'Sky fill', tint: '#d5deea', intensity: 0.56, angles: [63, 44, 35] },
  { name: 'Warm bounce', tint: '#efe2cf', intensity: 0.40, angles: [30, 146, -27] },
];
export const cyan = '#62edff';
export const amber = '#ffbb78';
export const brass = '#c9ab7d';
export const ivory = '#f0e4cd';
export const calloutAmber = '#ffb547';
export type XYZ = [number, number, number];
export type DebugLog = XRSceneCallbacks['onDebugLog'];

export function project(lat: number, lon: number): [number, number] {
  return [
    (lon + 71.095) * 111320 * Math.cos(42.354 * Math.PI / 180) / 6500,
    -(lat - 42.354) * 110540 / 6500,
  ];
}

export function damp(dt: number, speed = 10): number {
  return 1 - Math.exp(-dt * speed);
}

export function smooth(value: number): number {
  const t = Math.max(0, Math.min(value, 1));
  return t * t * (3 - 2 * t);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function wrapAngle(radians: number): number {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

export function levelYaw(entity: pc.Entity): number {
  const { forward, right } = entity;
  return Math.hypot(forward.x, forward.z) > 0.05 ? Math.atan2(-forward.x, -forward.z) : Math.atan2(-right.z, right.x);
}

const turnSampleWindow = 60;
export const handReleaseDelay = 35;

export class TurnVelocity {
  private samples: { time: number; angle: number }[] = [];

  reset(time: number): void {
    this.samples = [{ time, angle: 0 }];
  }

  add(delta: number, time: number): void {
    const samples = this.samples;
    const last = samples[samples.length - 1];
    if (!last) return;
    if (delta !== 0 && time - last.time > turnSampleWindow) {
      samples.push({ time: time - turnSampleWindow, angle: last.angle });
    }
    if (time === last.time) last.angle += delta;
    else samples.push({ time, angle: last.angle + delta });
    while (samples.length > 2 && samples[1].time <= time - turnSampleWindow - handReleaseDelay) samples.shift();
  }

  release(time: number, ignoreRecent = 0): number {
    if (!ignoreRecent) this.add(0, time);
    const end = time - ignoreRecent;
    const samples = this.samples;
    const last = samples.findLast((sample) => sample.time <= end);
    const first = samples[0];
    if (!last || !first) return 0;
    const start = Math.max(first.time, end - turnSampleWindow);
    if (last.time <= start) return 0;
    const afterStart = samples.findIndex((sample) => sample.time > start);
    const previous = samples[afterStart - 1];
    const next = samples[afterStart];
    const angle = pc.math.lerp(previous.angle, next.angle, (start - previous.time) / (next.time - previous.time));
    return clamp((last.angle - angle) * 1000 / Math.max(8, end - start), -6.5, 6.5);
  }
}

export function coastTurntable(velocity: number, dt: number, resistance: number, turn: (radians: number) => void): number {
  if (Math.abs(velocity) < 0.015) return 0;
  const remaining = velocity * Math.exp(-resistance * dt);
  turn((velocity - remaining) / resistance);
  return Math.abs(remaining) < 0.015 ? 0 : remaining;
}

export function child(parent: pc.Entity, name: string, position?: XYZ, app?: pc.AppBase): pc.Entity {
  const entity = new pc.Entity(name, app);
  if (position) entity.setLocalPosition(...position);
  parent.addChild(entity);
  return entity;
}

export function material(hex: string, glow = 0, opacity = 1): pc.StandardMaterial {
  const result = new pc.StandardMaterial();
  result.diffuse.fromString(hex);
  result.emissive.fromString(hex).mulScalar(glow);
  result.opacity = opacity;
  if (opacity < 1) {
    result.blendType = pc.BLEND_NORMAL;
    result.depthWrite = false;
  }
  result.update();
  return result;
}

export function shape(
  parent: pc.Entity, name: string, type: 'box' | 'cylinder' | 'sphere' | 'torus' | 'plane',
  surface: pc.Material, position: XYZ, scale: XYZ, app?: pc.AppBase,
): pc.Entity {
  const entity = child(parent, name, position, app);
  entity.addComponent('render', { type, material: surface });
  entity.setLocalScale(...scale);
  return entity;
}

export async function fetchAssetJson<T>(url: string, signal: AbortSignal, log: DebugLog): Promise<T | null> {
  try {
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as T;
  } catch (error) {
    if (!signal.aborted) log(`${url}: ${String(error)}`, 'warn');
    return null;
  }
}

export class ModelLibrary {
  private entries = new Map<string, Promise<pc.ContainerResource | null>>();
  private assets = new Set<pc.Asset>();
  private disposed = false;

  constructor(private app: pc.Application, private log: DebugLog) {}

  load(url: string): Promise<pc.ContainerResource | null> {
    const existing = this.entries.get(url);
    if (existing) return existing;
    if (this.disposed) return Promise.resolve(null);

    const entry = new Promise<pc.ContainerResource | null>((resolve) => {
      this.app.assets.loadFromUrl(url, 'container', (error, asset) => {
        if (this.disposed) {
          if (asset) {
            asset.unload();
            this.app.assets.remove(asset);
          }
          resolve(null);
          return;
        }
        if (asset) this.assets.add(asset);
        if (error || !asset?.resource) {
          this.log(`Could not load ${url}: ${String(error ?? 'missing resource')}`, 'warn');
          resolve(null);
          return;
        }
        resolve(asset.resource as pc.ContainerResource);
      });
    });
    this.entries.set(url, entry);
    return entry;
  }

  destroy(): void {
    this.disposed = true;
    for (const asset of this.assets) {
      asset.unload();
      this.app.assets.remove(asset);
    }
    this.assets.clear();
    this.entries.clear();
  }
}

export interface PickBounds {
  entity: pc.Entity;
  halfExtents: pc.Vec3;
  center?: pc.Vec3;
  enabled?: boolean;
}

export interface HitTarget extends PickBounds {
  action: () => void;
  key?: string;
}

export interface HitResult<T extends PickBounds = HitTarget> {
  target: T;
  point: pc.Vec3;
  distance: number;
}

export function pickBounds(entity: pc.Entity, size: XYZ, center?: XYZ): PickBounds {
  return { entity, halfExtents: new pc.Vec3(...size).mulScalar(0.5), center: center && new pc.Vec3(...center) };
}

export function target(entity: pc.Entity, size: XYZ, action: () => void, key?: string): HitTarget {
  return { ...pickBounds(entity, size), action, key };
}

export class ScenePicker {
  private inverse = new pc.Mat4();
  private bounds = new pc.BoundingBox();
  private localRay = new pc.Ray();
  private point = new pc.Vec3();

  raycast<T extends PickBounds>(ray: pc.Ray, targets: readonly T[], maxDistance = Infinity, includeInactive = false): HitResult<T> | null {
    let best: HitResult<T> | null = null;
    if (ray.direction.lengthSq() === 0) return null;
    for (const target of targets) {
      if (!target.entity.enabled || (!includeInactive && target.enabled === false)) continue;
      const transform = target.entity.getWorldTransform();
      this.inverse.invert(transform);
      this.inverse.transformPoint(ray.origin, this.localRay.origin);
      this.inverse.transformVector(ray.direction, this.localRay.direction);
      this.bounds.center.copy(target.center ?? pc.Vec3.ZERO);
      this.bounds.halfExtents.copy(target.halfExtents);
      if (!this.bounds.intersectsRay(this.localRay, this.point)) continue;
      transform.transformPoint(this.point, this.point);
      const distance = this.point.distance(ray.origin);
      if (distance <= maxDistance && (!best || distance < best.distance)) {
        if (best) {
          best.target = target;
          best.point.copy(this.point);
          best.distance = distance;
        } else {
          best = { target, point: this.point.clone(), distance };
        }
      }
    }
    return best;
  }

  find(ray: pc.Ray, targets: readonly HitTarget[]): HitTarget | undefined {
    return this.raycast(ray, targets)?.target;
  }

  nearPanel<T extends PickBounds>(point: pc.Vec3, targets: readonly T[], radius: number, includeInactive = false): T | null {
    let nearest: T | null = null;
    let distanceSq = radius * radius;
    for (const target of targets) {
      if (!target.entity.enabled || (!includeInactive && target.enabled === false)) continue;
      const transform = target.entity.getWorldTransform();
      this.inverse.invert(transform).transformPoint(point, this.point);
      const center = target.center ?? pc.Vec3.ZERO;
      this.point.sub(center);
      const { x, y } = target.halfExtents;
      this.point.set(clamp(this.point.x, -x, x), clamp(this.point.y, -y, y),
        clamp(this.point.z, -target.halfExtents.z, target.halfExtents.z)).add(center);
      transform.transformPoint(this.point, this.point);
      const candidate = this.point.distanceSq(point);
      if (candidate >= distanceSq) continue;
      distanceSq = candidate;
      nearest = target;
    }
    return nearest;
  }

  pick(ray: pc.Ray, targets: readonly HitTarget[]): boolean {
    const hit = this.raycast(ray, targets);
    hit?.target.action();
    return hit !== null;
  }
}
