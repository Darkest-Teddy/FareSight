import assert from 'node:assert/strict';
import test from 'node:test';
import { Quat, Vec3 } from 'playcanvas';
import {
  clampForearmClearance, deckCorners, forearmTarget, FOREARM_LENGTH, FOREARM_RADIUS, MIN_AIR_GAP,
  type ForearmPose,
} from '../src/xr/forearmMount.ts';

const capsuleRadius = FOREARM_RADIUS + MIN_AIR_GAP;

function verifyBox(position: Vec3, rotation: Quat, mount: ForearmPose, radial: Vec3, axes: Vec3[]) {
  const corners = deckCorners(position, rotation);
  const backCenter = rotation.transformVector(new Vec3(0, 0, -0.022)).add(position);
  const nearestProjection = Math.min(...corners.map((point) => point.dot(radial)));
  assert.ok(nearestProjection - mount.handCenter.dot(radial) > 0.090);
  for (const axis of axes) {
    const elbow = mount.wrist.clone().addScaled(axis, FOREARM_LENGTH);
    // A separating plane also certifies the closest point on the solid box.
    assert.ok(nearestProjection - Math.max(elbow.dot(radial), mount.wrist.dot(radial)) > capsuleRadius);
    for (const point of [...corners, position, backCenter]) {
      const offset = point.clone().sub(mount.wrist);
      const along = Math.max(0, Math.min(FOREARM_LENGTH, offset.dot(axis)));
      assert.ok(offset.addScaled(axis, -along).length() > capsuleRadius);
      assert.ok(point.distance(mount.handCenter) > 0.090);
    }
  }
}

for (const kind of ['hand', 'controller'] as const) {
  test(`${kind} deck stays outside every exclusion volume after aiming and damping`, () => {
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
          const axes = [direction];
          if (kind === 'controller') {
            for (let angle = 0; angle < 2 * Math.PI; angle += Math.PI / 4) {
              axes.push(tracking.transformVector(new Vec3(
                0.25 * Math.sin(angle), -0.25 * Math.cos(angle), Math.sqrt(1 - 0.25 ** 2),
              )).normalize());
            }
          }
          const cameras = [
            new Vec3(0, 1.7, 0), new Vec3(0, 0.75, 0), new Vec3(-0.8, 1.2, -1),
            wrist.clone(), wrist.clone().add(direction),
          ];
          for (const camera of cameras) {
            const target = forearmTarget(mount, camera);
            clampForearmClearance(target.position, target.rotation, mount, target.radial);
            verifyBox(target.position, target.rotation, mount, target.radial, axes);
            // Lag behind a fast swing, starting on the opposite side of the arm.
            const previous = wrist.clone().addScaled(target.radial, -0.14);
            const position = previous.lerp(previous, target.position, 0.16);
            const rotation = new Quat().slerp(tracking, target.rotation, 0.16);
            clampForearmClearance(position, rotation, mount, target.radial);
            verifyBox(position, rotation, mount, target.radial, axes);
          }
        }
      }
    }
  });
}
