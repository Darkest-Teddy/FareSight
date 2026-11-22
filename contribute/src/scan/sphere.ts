// Geometry of the guided 360° scan: where the capture targets sit around the person
// and where each one lands on the phone screen.
import { MAX_ROOM_PHOTOS } from '@faresight/shared';

/** World axes are east, north, up. */
export type Vec3 = [number, number, number];
/** The back camera's axes in the world. */
export interface Pose { right: Vec3; up: Vec3; forward: Vec3 }
export interface Target {
  /** Degrees clockwise from where the person faced when the scan started. */
  yaw: number;
  /** Degrees above the horizon. */
  pitch: number;
  ring: number;
  direction: Vec3;
  file?: File;
  capturedAt?: number;
}

const RAD = Math.PI / 180;
const clamp = (value: number) => Math.max(-1, Math.min(1, value));
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const angleBetween = (a: Vec3, b: Vec3) => Math.acos(clamp(dot(a, b))) / RAD;
export const yawOf = (v: Vec3) => Math.atan2(v[0], v[1]) / RAD;
export const pitchOf = (v: Vec3) => Math.asin(clamp(v[2])) / RAD;

export function direction(yaw: number, pitch: number): Vec3 {
  const y = yaw * RAD, p = pitch * RAD;
  return [Math.sin(y) * Math.cos(p), Math.cos(y) * Math.cos(p), Math.sin(p)];
}

/**
 * Camera axes for a W3C device orientation (degrees), with the phone held in portrait.
 * The columns of R = Rz(alpha) Rx(beta) Ry(gamma) are the device's right, top and screen-out axes;
 * the back camera looks along the negated third one.
 */
export function poseFromOrientation(alpha: number, beta: number, gamma: number): Pose {
  const [sa, ca, sb, cb, sg, cg] = [alpha, beta, gamma].flatMap((angle) => [Math.sin(angle * RAD), Math.cos(angle * RAD)]);
  return {
    right: [ca * cg - sa * sb * sg, cg * sa + ca * sb * sg, -cb * sg],
    up: [-cb * sa, ca * cb, sb],
    forward: [-(cg * sa * sb + ca * sg), -(sa * sg - ca * cg * sb), -cb * cg],
  };
}

/** Camera axes for a camera turned to a yaw and pitch, and tilted sideways by `roll` degrees. */
export function poseFromYawPitch(yaw: number, pitch: number, roll = 0): Pose {
  const forward = direction(yaw, pitch);
  const level: Vec3 = [Math.cos(yaw * RAD), -Math.sin(yaw * RAD), 0];
  const upright: Vec3 = [
    level[1] * forward[2] - level[2] * forward[1],
    level[2] * forward[0] - level[0] * forward[2],
    level[0] * forward[1] - level[1] * forward[0],
  ];
  const cos = Math.cos(roll * RAD), sin = Math.sin(roll * RAD);
  return {
    right: level.map((value, index) => value * cos + upright[index] * sin) as Vec3,
    up: upright.map((value, index) => value * cos - level[index] * sin) as Vec3,
    forward,
  };
}

/** How far a camera is tilted sideways, in degrees: 0 when the horizon runs straight across the picture. */
export const rollOf = (pose: Pose) => Math.atan2(pose.right[2], pose.up[2]) / RAD;

export function blend(from: Pose, to: Pose, amount: number): Pose {
  const mix = (a: Vec3, b: Vec3): Vec3 => {
    const v = a.map((value, index) => value + (b[index] - value) * amount);
    const length = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / length, v[1] / length, v[2] / length];
  };
  return { right: mix(from.right, to.right), up: mix(from.up, to.up), forward: mix(from.forward, to.forward) };
}

// Pitch, count and yaw offset of each ring. A phone in portrait sees about 40° across and 64° top to bottom,
// so 16 shots on the horizon overlap by roughly half and the two tilted rings cover the ceiling and the floor.
const rings: [pitch: number, count: number, offset: number][] = [[0, 16, 0], [40, 8, 22.5], [-35, 8, 22.5]];

/** The spots to capture, most important ring first, relative to the heading the scan started at. */
export function createTargets(startYaw: number): Target[] {
  const targets: Target[] = [];
  for (const [ring, [pitch, count, offset]] of rings.entries()) {
    for (let index = 0; index < count; index++) {
      const yaw = offset + index * 360 / count;
      targets.push({ yaw, pitch, ring, direction: direction(startYaw + yaw, pitch) });
    }
  }
  return targets.slice(0, MAX_ROOM_PHOTOS);
}

/** Screen position of a world direction. `side` is its offset from the view axis, for pointing at targets off screen. */
export function project(pose: Pose, target: Vec3, focal: number, width: number, height: number) {
  const depth = dot(target, pose.forward);
  const x = dot(target, pose.right), y = dot(target, pose.up);
  return {
    x: width / 2 + focal * x / depth,
    y: height / 2 - focal * y / depth,
    front: depth > 0.15,
    side: [x, y] as [number, number],
  };
}
