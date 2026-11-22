import { Mat4, Quat, Vec3 } from 'playcanvas';

export const FOREARM_RADIUS = 0.060;
export const MIN_AIR_GAP = 0.025;
export const FOREARM_LENGTH = 0.30;

// Scaled bounds enclosing both deck models, including key travel.
const halfWidth = 0.095;
const halfHeight = 0.046;
const backDepth = 0.022;
const frontDepth = 0.015;
const controllerConeRadius = FOREARM_LENGTH * 0.25;

export interface ForearmPose {
  kind: 'hand' | 'controller';
  wrist: Vec3;
  direction: Vec3;
  handCenter: Vec3;
}

export function deckCorners(position: Vec3, rotation: Quat): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [-halfWidth, halfWidth]) {
    for (const y of [-halfHeight, halfHeight]) {
      for (const z of [-backDepth, frontDepth]) {
        corners.push(rotation.transformVector(new Vec3(x, y, z)).add(position));
      }
    }
  }
  return corners;
}

export function forearmTarget(mount: ForearmPose, camera: Vec3) {
  const { wrist, direction, kind } = mount;
  const center = wrist.clone().addScaled(direction, kind === 'hand' ? 0.095 : 0.090);
  const radial = new Vec3().sub2(camera, center);
  radial.addScaled(direction, -radial.dot(direction));
  if (radial.lengthSq() < 1e-8) radial.set(0, 0, 0);
  radial.normalize().addScaled(Vec3.UP, 0.45);
  radial.addScaled(direction, -radial.dot(direction));
  if (radial.lengthSq() < 1e-8) {
    radial.cross(direction, Math.abs(direction.y) > 0.9 ? Vec3.RIGHT : Vec3.UP);
  }
  radial.normalize();
  const position = center.addScaled(radial, 0.098);

  const normal = new Vec3().sub2(camera, position);
  if (normal.lengthSq() < 1e-8) normal.copy(radial);
  normal.normalize();
  const across = new Vec3().cross(direction, normal);
  if (across.y < 0) across.mulScalar(-1);
  const up = across.add(Vec3.UP).addScaled(normal, -normal.y);
  if (up.lengthSq() < 1e-8) up.cross(normal, Vec3.RIGHT);
  const rotation = new Quat().setFromMat4(new Mat4().setLookAt(normal, Vec3.ZERO, up));
  return { position, rotation, radial };
}

export function clampForearmClearance(position: Vec3, rotation: Quat, mount: ForearmPose, radial: Vec3): Vec3 {
  const { wrist, handCenter, direction, kind } = mount;
  const elbow = wrist.clone().addScaled(direction, FOREARM_LENGTH);
  // The controller envelope includes every elbow direction within asin(0.25)
  // of grip +Z. Their axes fit inside the cone from the wrist to this disk.
  const coneSupport = kind === 'controller' ? controllerConeRadius : 0;
  const armSupport = Math.max(wrist.dot(radial), elbow.dot(radial) + coneSupport) + FOREARM_RADIUS + MIN_AIR_GAP;
  const handSupport = handCenter.dot(radial) + (kind === 'hand' ? 0.065 + MIN_AIR_GAP : 0.090);
  const boxNear = Math.min(...deckCorners(position, rotation).map((corner) => corner.dot(radial)));

  // Projection on a unit axis lower-bounds Euclidean distance. The nearest
  // corner projection also bounds every point in the box, including its faces
  // and the point closest to an exclusion axis.
  return position.addScaled(radial, Math.max(0, Math.max(armSupport, handSupport) - boxNear + 0.0005));
}
