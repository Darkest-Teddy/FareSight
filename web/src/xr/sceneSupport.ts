import * as pc from 'playcanvas';
import type { XRSceneCallbacks } from './bridgeTypes';

export const assetBase = '/assets-demo/';
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

export function easeOutBack(value: number, overshoot = 1.4): number {
  const t = Math.max(0, Math.min(value, 1)) - 1;
  return 1 + t * t * ((overshoot + 1) * t + overshoot);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max));
}

export function child(parent: pc.Entity, name: string, position?: XYZ): pc.Entity {
  const entity = new pc.Entity(name);
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
  surface: pc.Material, position: XYZ, scale: XYZ,
): pc.Entity {
  const entity = child(parent, name, position);
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
        if (this.disposed) { resolve(null); return; }
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

export interface HitTarget {
  entity: pc.Entity;
  halfExtents: pc.Vec3;
  action: () => void;
  key?: string;
}

export interface HitResult {
  target: HitTarget;
  point: pc.Vec3;
  distance: number;
}

export function target(entity: pc.Entity, size: XYZ, action: () => void, key?: string): HitTarget {
  return { entity, halfExtents: new pc.Vec3(...size).mulScalar(0.5), action, key };
}

export class ScenePicker {
  private inverse = new pc.Mat4();
  private bounds = new pc.BoundingBox();
  private localRay = new pc.Ray();
  private point = new pc.Vec3();

  raycast(ray: pc.Ray, targets: readonly HitTarget[], maxDistance = Infinity): HitResult | null {
    let best: HitResult | null = null;
    if (ray.direction.lengthSq() === 0) return null;
    for (const target of targets) {
      if (!target.entity.enabled) continue;
      const transform = target.entity.getWorldTransform();
      this.inverse.invert(transform);
      this.inverse.transformPoint(ray.origin, this.localRay.origin);
      this.inverse.transformVector(ray.direction, this.localRay.direction);
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

  nearPanel(point: pc.Vec3, targets: readonly HitTarget[], radius: number): HitTarget | null {
    let nearest: HitTarget | null = null;
    let distanceSq = radius * radius;
    for (const target of targets) {
      if (!target.entity.enabled) continue;
      const transform = target.entity.getWorldTransform();
      this.inverse.invert(transform).transformPoint(point, this.point);
      const { x, y } = target.halfExtents;
      this.point.set(clamp(this.point.x, -x, x), clamp(this.point.y, -y, y), 0);
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
