import * as pc from 'playcanvas';
import { clamp } from './sceneSupport';

type Outline = readonly (readonly [number, number])[];
type Bounds = [number, number, number, number];
type Geometry = {
  label: string;
  topY: number;
  bounds: Bounds;
  patches: readonly Outline[];
};

export interface SurfaceMatch {
  id: object;
  label: string;
  topY: number;
  position: pc.Vec3;
  contains(point: pc.Vec3): boolean;
}

interface TrackedSurface {
  position: pc.Vec3;
  rotation: pc.Quat;
  revision: number;
  geometry?: Geometry;
}

const ignored = new Set(['floor', 'ceiling', 'wall', 'door', 'window', 'room', 'global mesh']);
const tableLabels = new Set(['table', 'desk', 'counter', 'countertop']);
const furnitureLabels = new Set(['other', 'couch', 'sofa', 'storage', 'cabinet', 'shelf']);
const isSupportHeight = (y: number) => y >= 0.30 && y <= 1.45;

function outlineBounds(points: Outline): Bounds {
  const bounds: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, z] of points) {
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], z);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], z);
  }
  return bounds;
}

function outlineArea(points: Outline): number {
  let twiceArea = 0;
  let [lastX, lastZ] = points[points.length - 1];
  for (const [x, z] of points) {
    twiceArea += lastX * z - x * lastZ;
    lastX = x;
    lastZ = z;
  }
  return Math.abs(twiceArea) * 0.5;
}

function nearestOnOutline(outline: Outline, x: number, z: number): [number, number] {
  let inside = false;
  let best = Infinity;
  let nearest: [number, number] = [x, z];
  let [ax, az] = outline[outline.length - 1];
  for (const [bx, bz] of outline) {
    if ((az > z) !== (bz > z) && x < ax + (bx - ax) * (z - az) / (bz - az)) inside = !inside;
    const dx = bx - ax;
    const dz = bz - az;
    const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    const px = ax + dx * t;
    const pz = az + dz * t;
    const distance = (x - px) ** 2 + (z - pz) ** 2;
    if (distance < best) {
      best = distance;
      nearest = [px, pz];
    }
    ax = bx;
    az = bz;
  }
  return inside ? [x, z] : nearest;
}

function nearestPoint(surface: Geometry, x: number, z: number): [number, number] {
  let best = Infinity;
  let nearest: [number, number] = [x, z];
  for (const patch of surface.patches) {
    const point = nearestOnOutline(patch, x, z);
    const distance = (point[0] - x) ** 2 + (point[1] - z) ** 2;
    if (distance === 0) return point;
    if (distance < best) {
      best = distance;
      nearest = point;
    }
  }
  return nearest;
}

function planeGeometry(label: string, orientation: string | null, points: readonly DOMPointReadOnly[],
  position: pc.Vec3, rotation: pc.Quat): Geometry | undefined {
  if (points.length < 3 || orientation === 'vertical' ||
    (orientation !== 'horizontal' && Math.abs(rotation.transformVector(pc.Vec3.UP).y) < 0.88)) return;
  const point = new pc.Vec3();
  let y = 0;
  const outline = points.map(({ x, y: localY, z }) => {
    rotation.transformVector(point.set(x, localY, z), point).add(position);
    y += point.y;
    return [point.x, point.z] as const;
  });
  const area = outlineArea(outline);
  const topY = y / points.length;
  if (area >= 0.025 && isSupportHeight(topY)) return { label, topY, patches: [outline], bounds: outlineBounds(outline) };
}

function meshGeometry(label: string, vertices: Float32Array, indices: Uint32Array,
  position: pc.Vec3, rotation: pc.Quat): Geometry | undefined {
  const a = new pc.Vec3();
  const b = new pc.Vec3();
  const c = new pc.Vec3();
  const cross = new pc.Vec3();
  const read = (index: number, point: pc.Vec3) => {
    const i = index * 3;
    return rotation.transformVector(point.set(vertices[i], vertices[i + 1], vertices[i + 2]), point).add(position);
  };
  const tops: { y: number; area: number; points: Outline }[] = [];
  for (let i = 0; i + 2 < indices.length; i += 3) {
    read(indices[i], a);
    read(indices[i + 1], b);
    read(indices[i + 2], c);
    const points = [[a.x, a.z], [b.x, b.z], [c.x, c.z]] as const;
    const y = (a.y + b.y + c.y) / 3;
    if (!isSupportHeight(y)) continue;
    cross.cross(b.sub(a), c.sub(a));
    const area = Math.abs(cross.y) * 0.5;
    if (area > 0.00001 && Math.abs(cross.y) >= cross.length() * 0.88) tops.push({ y, area, points });
  }
  // Small ridges above a broad horizontal patch should not set the resting height.
  tops.sort((a, b) => b.y - a.y);
  for (let i = 0; i < tops.length;) {
    const height = tops[i].y;
    let area = 0;
    let weightedY = 0;
    const patches: Outline[] = [];
    do {
      const top = tops[i++];
      area += top.area;
      weightedY += top.y * top.area;
      patches.push(top.points);
    } while (i < tops.length && height - tops[i].y <= 0.02);
    if (area >= 0.025) return { label, topY: weightedY / area, patches, bounds: outlineBounds(patches.flat()) };
  }
}

type Wrapper = pc.XrPlane | NonNullable<pc.XrManager['meshDetection']['meshes']>[number];
type NativeFrame = Parameters<pc.XrManager['update']>[0];
type ReferenceSpace = NonNullable<pc.XrManager['_referenceSpace']>;
type SurfaceIn<T> = T extends ReadonlySet<infer Surface> ? Surface : never;
type NativeSurface = SurfaceIn<NativeFrame['detectedPlanes'] | NativeFrame['detectedMeshes']>;
type NativeTransform = NonNullable<ReturnType<NativeFrame['getPose']>>['transform'];
type MeasureSurface = (label: string, position: pc.Vec3, rotation: pc.Quat) => Geometry | undefined;

export class PhysicalSurfaces {
  private tracked = new Map<object, TrackedSurface>();
  private wrappers = new Map<Wrapper, { change: pc.EventHandle; revision: number }>();
  private raw = new Set<object>();
  private events: pc.EventHandle[] = [];
  private inverse = new pc.Mat4();
  private local = new pc.Vec3();
  private direction = new pc.Vec3();
  private rawPosition = new pc.Vec3();
  private rawRotation = new pc.Quat();
  private hit?: { position: pc.Vec3; time: number };
  private hitId = {};

  constructor(xr: pc.XrManager, private rig: pc.Entity) {
    const planeDetection = xr.planeDetection;
    const meshDetection = xr.meshDetection;
    if (planeDetection) {
      this.events.push(planeDetection.on('add', this.add, this), planeDetection.on('remove', this.remove, this),
        planeDetection.on('available', () => planeDetection.planes.forEach((plane) => this.add(plane))));
    }
    if (meshDetection) {
      this.events.push(meshDetection.on('add', this.add, this), meshDetection.on('remove', this.remove, this),
        meshDetection.on('available', () => meshDetection.meshes.forEach((mesh) => this.add(mesh))));
    }
    this.events.push(xr.on('update', (frame?: NativeFrame) => {
      if (frame && xr.type === pc.XRTYPE_VR && xr._referenceSpace) {
        this.updateNative(frame, xr._referenceSpace, xr.session?.enabledFeatures);
      }
      this.updateWrappers();
    }), xr.on('end', this.clear, this));
  }

  private add(wrapper: Wrapper): void {
    if (this.wrappers.has(wrapper)) return;
    const item = { revision: 0, change: wrapper.on('change', () => { item.revision++; }) };
    this.wrappers.set(wrapper, item);
  }

  private remove(wrapper: Wrapper): void {
    this.wrappers.get(wrapper)?.change.off();
    this.wrappers.delete(wrapper);
    this.tracked.delete(wrapper);
  }

  private updateWrappers(): void {
    for (const [wrapper, { revision }] of this.wrappers) {
      this.track(wrapper, revision, wrapper.label, wrapper.getPosition(), wrapper.getRotation(),
        (label, position, rotation) => 'points' in wrapper
          ? planeGeometry(label, wrapper.orientation, wrapper.points, position, rotation)
          : meshGeometry(label, wrapper.vertices, wrapper.indices, position, rotation));
    }
  }

  private updateNative(frame: NativeFrame, reference: ReferenceSpace, features?: readonly string[]): void {
    // PlayCanvas 2.24 only feeds the plane and mesh wrappers in immersive AR.
    const active = new Set<object>();
    const planes = !features || features.includes('plane-detection') ? frame.detectedPlanes : undefined;
    const meshes = !features || features.includes('mesh-detection') ? frame.detectedMeshes : undefined;
    for (const plane of planes ?? []) {
      active.add(plane);
      const pose = frame.getPose(plane.planeSpace, reference)?.transform;
      if (pose) this.trackNative(plane, pose, (label, position, rotation) =>
        planeGeometry(label, plane.orientation, plane.polygon, position, rotation));
      else this.tracked.delete(plane);
    }
    for (const mesh of meshes ?? []) {
      active.add(mesh);
      const pose = frame.getPose(mesh.meshSpace, reference)?.transform;
      if (pose) this.trackNative(mesh, pose, (label, position, rotation) =>
        meshGeometry(label, mesh.vertices, mesh.indices, position, rotation));
      else this.tracked.delete(mesh);
    }
    for (const object of this.raw) if (!active.has(object)) this.tracked.delete(object);
    this.raw = active;
  }

  private trackNative(item: NativeSurface, pose: NativeTransform, measure: MeasureSurface): void {
    const { position, orientation } = pose;
    this.track(item, item.lastChangedTime, item.semanticLabel ?? '',
      this.rawPosition.set(position.x, position.y, position.z),
      this.rawRotation.set(orientation.x, orientation.y, orientation.z, orientation.w), measure);
  }

  private track(id: object, revision: number, untrimmedLabel: string, position: pc.Vec3, rotation: pc.Quat,
    measure: MeasureSurface): void {
    const cached = this.tracked.get(id);
    if (cached?.revision === revision && cached.position.equalsApprox(position, 0.001) &&
      cached.rotation.equalsApprox(rotation, 0.001)) return;
    const label = untrimmedLabel.toLowerCase().trim().replace(/[_-]/g, ' ');
    const geometry = ignored.has(label) ? undefined : measure(label, position, rotation);
    const entry = cached ?? { position: new pc.Vec3(), rotation: new pc.Quat(), revision };
    entry.position.copy(position);
    entry.rotation.copy(rotation);
    entry.revision = revision;
    entry.geometry = geometry;
    this.tracked.set(id, entry);
  }

  recordHit(position: pc.Vec3): void {
    if (isSupportHeight(position.y)) this.hit = { position: (this.hit?.position ?? new pc.Vec3()).copy(position), time: performance.now() };
  }

  bestTableInFront(viewer: pc.Vec3, forward: pc.Vec3, maxDist = 2.4): SurfaceMatch | undefined {
    const inverse = this.inverse.copy(this.rig.getWorldTransform()).invert();
    const eye = inverse.transformPoint(viewer, this.local);
    const heading = inverse.transformVector(forward, this.direction);
    heading.y = 0;
    if (heading.lengthSq() < 0.0001) return;
    heading.normalize();
    let best: SurfaceMatch | undefined;
    let score = Infinity;
    for (const [id, { geometry }] of this.tracked) {
      if (!geometry) continue;
      const [minX, minZ, maxX, maxZ] = geometry.bounds;
      const centerX = (minX + maxX) / 2;
      const centerZ = (minZ + maxZ) / 2;
      const along = (centerX - eye.x) * heading.x + (centerZ - eye.z) * heading.z;
      const reach = clamp(along, 0.45, 1.0);
      const [x, z] = nearestPoint(geometry, eye.x + heading.x * reach, eye.z + heading.z * reach);
      const dx = x - eye.x;
      const dz = z - eye.z;
      const distance = Math.hypot(dx, dz);
      const facing = (dx * heading.x + dz * heading.z) / (distance || 1);
      if (distance > maxDist || facing < 0.45) continue;
      const height = geometry.topY;
      const labelPenalty = tableLabels.has(geometry.label) ? 0 : furnitureLabels.has(geometry.label) ? 1.0 : 1.25;
      const candidate = distance + (1 - facing) * 0.45 + labelPenalty +
        (height < 0.50 || height > 1.20 ? 0.35 : 0) + Math.abs(height - 0.75) * 0.35;
      if (candidate >= score) continue;
      score = candidate;
      best = this.match(id, geometry.label, x, height, z);
    }
    return best;
  }

  snapAt(worldPos: pc.Vec3, baseOffset: number, verticalRange = 0.11, locked?: object, horizontalMargin = 0.10):
    { y: number; surface: SurfaceMatch } | undefined {
    const { x, y, z } = this.inverse.copy(this.rig.getWorldTransform()).invert().transformPoint(worldPos, this.local);
    let best: SurfaceMatch | undefined;
    let score = Infinity;
    for (const [id, { geometry }] of this.tracked) {
      if (!geometry) continue;
      const vertical = Math.abs(y - baseOffset - geometry.topY);
      if (vertical > (id === locked ? 0.12 : verticalRange)) continue;
      const [minX, minZ, maxX, maxZ] = geometry.bounds;
      if (x < minX - horizontalMargin || x > maxX + horizontalMargin ||
        z < minZ - horizontalMargin || z > maxZ + horizontalMargin) continue;
      const [px, pz] = nearestPoint(geometry, x, z);
      const horizontal = Math.hypot(x - px, z - pz);
      if (horizontal > horizontalMargin) continue;
      const candidate = vertical + horizontal + (id === locked ? -1 : 0);
      if (candidate >= score) continue;
      score = candidate;
      best = this.match(id, geometry.label, px, geometry.topY, pz);
    }
    if (!best && this.hit && performance.now() - this.hit.time < 350) {
      const point = this.hit.position;
      if (Math.abs(y - baseOffset - point.y) <= (locked === this.hitId ? 0.12 : verticalRange) &&
        Math.hypot(x - point.x, z - point.z) <= 0.10) best = this.match(this.hitId, '', point.x, point.y, point.z);
    }
    if (best) return { y: best.topY + baseOffset, surface: best };
  }

  private match(id: object, label: string, x: number, y: number, z: number): SurfaceMatch {
    const position = this.rig.getWorldTransform().transformPoint(new pc.Vec3(x, y, z));
    const geometry = this.tracked.get(id)?.geometry;
    return { id, label: label || 'surface', topY: position.y, position, contains: (point) => {
      if (!geometry) return false;
      const local = this.inverse.copy(this.rig.getWorldTransform()).invert().transformPoint(point, this.local);
      const [minX, minZ, maxX, maxZ] = geometry.bounds;
      if (local.x < minX - 0.012 || local.x > maxX + 0.012 || local.z < minZ - 0.012 || local.z > maxZ + 0.012) return false;
      const [px, pz] = nearestPoint(geometry, local.x, local.z);
      return Math.hypot(px - local.x, pz - local.z) <= 0.012;
    } };
  }

  private clear(): void {
    for (const { change } of this.wrappers.values()) change.off();
    this.wrappers.clear();
    this.tracked.clear();
    this.raw.clear();
    this.hit = undefined;
  }

  destroy(): void {
    for (const event of this.events) event.off();
    this.clear();
  }
}
