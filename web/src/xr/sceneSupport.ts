import * as pc from 'playcanvas';
import type { XRSceneCallbacks } from './bridgeTypes';

export const assetBase = '/assets-demo/';
export const cyan = '#62edff';
export const amber = '#ffbb78';
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
}

export function target(entity: pc.Entity, size: XYZ, action: () => void): HitTarget {
  return { entity, halfExtents: new pc.Vec3(...size).mulScalar(0.5), action };
}

export class ScenePicker {
  private inverse = new pc.Mat4();
  private bounds = new pc.BoundingBox();
  private localRay = new pc.Ray();
  private point = new pc.Vec3();

  pick(ray: pc.Ray, targets: readonly HitTarget[]): boolean {
    let best: HitTarget | undefined;
    let closest = Infinity;
    for (const target of targets) {
      if (!target.entity.enabled) continue;
      this.inverse.copy(target.entity.getWorldTransform()).invert();
      this.inverse.transformPoint(ray.origin, this.localRay.origin);
      this.inverse.transformVector(ray.direction, this.localRay.direction);
      this.bounds.halfExtents.copy(target.halfExtents);
      if (!this.bounds.intersectsRay(this.localRay, this.point)) continue;
      target.entity.getWorldTransform().transformPoint(this.point, this.point);
      const distance = this.point.distance(ray.origin);
      if (distance >= closest) continue;
      closest = distance;
      best = target;
    }
    best?.action();
    return best !== undefined;
  }
}
