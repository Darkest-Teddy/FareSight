import assert from 'node:assert/strict';
import test from 'node:test';
import { Quat, Vec3 } from 'playcanvas';
import {
  clampForearmClearance, deckCorners, DECK_BACK_DEPTH, forearmTarget, FOREARM_LENGTH,
  FOREARM_RADIUS, HAND_RADIUS, MIN_AIR_GAP, type ForearmPose,
} from '../src/xr/forearmMount.ts';

const capsuleRadius = FOREARM_RADIUS + MIN_AIR_GAP;
const tolerance = 1e-7;

function verifyBox({ position, rotation, radial }: ReturnType<typeof forearmTarget>, mount: ForearmPose) {
  const { wrist, direction, handCenter } = mount;
  const corners = deckCorners(position, rotation);
  const right = rotation.transformVector(Vec3.RIGHT);
  assert.ok(right.dot(direction) <= -0.98);
  const centerDistance = position.clone().sub(wrist).dot(radial);
  const backDistance = Math.min(...corners.map((corner) => corner.clone().sub(wrist).dot(radial)));
  assert.ok(Math.abs(centerDistance - (capsuleRadius + DECK_BACK_DEPTH)) < tolerance);
  assert.ok(backDistance >= capsuleRadius - tolerance && backDistance <= 0.090);

  // The plane establishes clearance through the face interiors as well.
  const axialGap = Math.min(...corners.map((corner) => corner.clone().sub(handCenter).dot(direction)));
  const radialGap = Math.min(...corners.map((corner) => corner.clone().sub(handCenter).dot(radial)));
  assert.ok(Math.hypot(Math.max(0, axialGap), Math.max(0, radialGap)) >= HAND_RADIUS);

  for (const corner of corners) {
    const offset = corner.clone().sub(wrist);
    const along = Math.max(0, Math.min(FOREARM_LENGTH, offset.dot(direction)));
    assert.ok(offset.addScaled(direction, -along).length() >= capsuleRadius);
    assert.ok(corner.distance(handCenter) >= HAND_RADIUS);
  }
}

for (const kind of ['hand', 'controller'] as const) {
  test(`${kind} deck stays snug and clear before and after roll damping`, () => {
    for (let pitch = 0; pitch < 360; pitch += 30) {
      for (let yaw = 0; yaw < 360; yaw += 30) {
        for (let roll = 0; roll < 360; roll += 30) {
          const tracking = new Quat().setFromEulerAngles(pitch, yaw, roll);
          const direction = tracking.transformVector(Vec3.BACK).normalize();
          const origin = new Vec3(-0.3, 1.2, -0.5);
          const wrist = origin.clone().addScaled(direction, kind === 'controller' ? 0.045 : 0);
          const mount: ForearmPose = {
            kind, direction, wrist,
            handCenter: kind === 'controller' ? origin : wrist.clone().addScaled(direction, -0.060),
          };
          const cameras = [
            new Vec3(0, 1.7, 0), new Vec3(0, 0.75, 0), new Vec3(-0.8, 1.2, -1),
            wrist.clone(), wrist.clone().add(direction),
          ];
          for (const camera of cameras) {
            const target = forearmTarget(mount, camera);
            verifyBox(target, mount);

            const previousMount = { ...mount, direction: tracking.transformVector(Vec3.RIGHT).normalize() };
            const previous = forearmTarget(previousMount, new Vec3(0, 1.7, -1));
            const damped = forearmTarget(mount, camera, previous.rotation, 1 - Math.exp(-28 / 90));
            clampForearmClearance(damped.position, damped.rotation, mount, damped.radial);
            verifyBox(damped, mount);
          }
        }
      }
    }
  });
}

test('left arm across the chest has its wrist at the right and keys upright', () => {
  const wrist = new Vec3(0.15, 1.2, -0.45);
  const direction = new Vec3(-1, 0, 0);
  const handCenter = wrist.clone().addScaled(direction, -0.060);
  const mount: ForearmPose = { kind: 'hand', wrist, direction, handCenter };
  const previous = forearmTarget(mount, new Vec3(0, 1.2, 0));
  for (const height of [1.2, 1.5, 1.8]) {
    const camera = new Vec3(0, height, 0);
    for (const blend of [1, 1 - Math.exp(-28 / 90)]) {
      const pose = forearmTarget(mount, camera, previous.rotation, blend);
      assert.ok(pose.rotation.transformVector(Vec3.UP).y >= -0.1);
      assert.ok(pose.rotation.transformVector(Vec3.RIGHT).x > 0.98);
    }
  }
});

test('clearance clamp pushes a stale box outside both volumes', () => {
  const wrist = new Vec3(0, 0, 0);
  const direction = new Vec3(-1, 0, 0);
  const handCenter = new Vec3(0.060, 0, 0);
  const mount: ForearmPose = { kind: 'hand', wrist, direction, handCenter };
  const pose = forearmTarget(mount, new Vec3(0, 0, 1));
  pose.position.addScaled(pose.radial, -0.15);
  clampForearmClearance(pose.position, pose.rotation, mount, pose.radial);
  verifyBox(pose, mount);
});
