import { Mat4, Quat, Vec3 } from 'playcanvas';

export const FOREARM_RADIUS = 0.050;
export const MIN_AIR_GAP = 0.012;
export const FOREARM_LENGTH = 0.30;

// Scaled bounds enclosing both deck models, including key travel.
const halfWidth = 0.095;
const halfHeight = 0.046;
export const DECK_BACK_DEPTH = 0.012;
const frontDepth = 0.015;
export const HAND_RADIUS = 0.078;

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
      for (const z of [-DECK_BACK_DEPTH, frontDepth]) {
        corners.push(rotation.transformVector(new Vec3(x, y, z)).add(position));
      }
    }
  }
  return corners;
}

export function forearmTarget(mount: ForearmPose, camera: Vec3, previousRotation?: Quat, blend = 1) {
  const { wrist, direction, kind, handCenter } = mount;
  const center = (kind === 'hand' ? wrist : handCenter).clone()
    .addScaled(direction, kind === 'hand' ? 0.095 : 0.155);
  const radial = new Vec3().sub2(camera, center);
  radial.addScaled(direction, -radial.dot(direction));
  if (radial.lengthSq() < 1e-8) radial.set(0, 0, 0);
  const upProjection = Vec3.UP.clone().addScaled(direction, -direction.y);
  radial.normalize().addScaled(upProjection, 0.35);
  if (radial.lengthSq() < 1e-8) {
    radial.cross(direction, Math.abs(direction.y) > 0.9 ? Vec3.RIGHT : Vec3.UP);
  }
  radial.normalize();

  if (previousRotation && blend < 1) {
    const previous = previousRotation.transformVector(Vec3.BACK);
    previous.addScaled(direction, -previous.dot(direction));
    if (previous.lengthSq() > 1e-8) {
      previous.normalize();
      const tangent = new Vec3().cross(direction, previous);
      const angle = Math.atan2(radial.dot(tangent), radial.dot(previous)) * blend;
      radial.copy(previous).mulScalar(Math.cos(angle)).addScaled(tangent, Math.sin(angle));
    }
  }

  const position = center.addScaled(radial, FOREARM_RADIUS + MIN_AIR_GAP + DECK_BACK_DEPTH);
  const right = direction.clone().mulScalar(-1);
  const up = new Vec3().cross(radial, right);
  const rotation = new Quat().setFromMat4(new Mat4().setLookAt(radial, Vec3.ZERO, up));
  return { position, rotation, radial };
}

export function clampForearmClearance(position: Vec3, rotation: Quat, mount: ForearmPose, radial: Vec3): Vec3 {
  const { wrist, handCenter, direction } = mount;
  const elbow = wrist.clone().addScaled(direction, FOREARM_LENGTH);
  const armSupport = Math.max(wrist.dot(radial), elbow.dot(radial)) + FOREARM_RADIUS + MIN_AIR_GAP;
  const corners = deckCorners(position, rotation);
  const boxNear = Math.min(...corners.map((corner) => corner.dot(radial)));

  // Axial separation shrinks the sphere cross-section that can reach the box.
  const axialOffsets = corners.map((corner) => corner.clone().sub(handCenter).dot(direction));
  const axialGap = Math.max(0, Math.min(...axialOffsets), -Math.max(...axialOffsets));
  const handSupport = axialGap >= HAND_RADIUS ? -Infinity
    : handCenter.dot(radial) + Math.sqrt(HAND_RADIUS ** 2 - axialGap ** 2);

  // A separating plane bounds the whole box, including its face interiors.
  return position.addScaled(radial, Math.max(0, Math.max(armSupport, handSupport) - boxNear));
}
