import * as pc from 'playcanvas';
import { clamp, damp } from './sceneSupport';

export const tableRadius = 0.45;
export const dishStep = 1 / 120;
const maxLinearSpeed = 6;
const maxAngularSpeed = 12;
const gravity = 9.81;
const releaseSupportMs = 250;

type ReleaseSurface = { topY: number; contains(point: pc.Vec3): boolean };

type DishState = 'seated' | 'held' | 'dynamic' | 'sleeping';
type Support = 'table' | 'surface' | 'floor' | 'lost';

function limit(vector: pc.Vec3, maximum: number): void {
  const speed = vector.length();
  if (!Number.isFinite(speed)) vector.set(0, 0, 0);
  else if (speed > maximum) vector.mulScalar(maximum / speed);
}

function intersectsTable(x: number, z: number, up: pc.Vec3, radius: number, halfHeight: number): boolean {
  const distance = Math.hypot(x, z);
  if (distance <= tableRadius) return true;
  const slope = Math.hypot(up.x, up.z);
  if (slope < 1e-6) return distance <= tableRadius + radius;

  // The projected cylinder is an ellipse swept along the horizontal component of its axis.
  const along = Math.max(0, Math.abs(x * up.x + z * up.z) / slope - halfHeight * slope);
  const across = Math.abs(z * up.x - x * up.z) / slope;
  const narrow = radius * Math.abs(up.y);
  if (narrow < 1e-6) return Math.hypot(along, Math.max(0, across - radius)) <= tableRadius;
  if (Math.hypot(along / narrow, across / radius) <= 1) return true;

  // Find the closest point on the ellipse after removing the axial segment.
  const narrowSq = narrow ** 2;
  const radiusSq = radius ** 2;
  let low = 0;
  let high = Math.hypot(narrow * along, radius * across);
  for (let i = 0; i < 18; i++) {
    const lambda = (low + high) / 2;
    if (Math.hypot(narrow * along / (lambda + narrowSq), radius * across / (lambda + radiusSq)) > 1) low = lambda;
    else high = lambda;
  }
  return Math.hypot(along * high / (high + narrowSq), across * high / (high + radiusSq)) <= tableRadius;
}

export class DishGrabMotion {
  readonly velocity = new pc.Vec3();
  readonly angularVelocity = new pc.Vec3();
  private position = new pc.Vec3();
  private rotation = new pc.Quat();
  private linear = new pc.Vec3();
  private angular = new pc.Vec3();
  private change = new pc.Quat();
  private centerOffset = new pc.Vec3();
  private centerVelocity = new pc.Vec3();
  private last = 0;

  constructor(private readonly centerHeight = 0) {}

  reset(position: pc.Vec3, rotation: pc.Quat, time = performance.now()): void {
    this.position.copy(position);
    this.rotation.copy(rotation);
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.last = time;
  }

  sample(position: pc.Vec3, rotation: pc.Quat, time = performance.now()): void {
    const dt = (time - this.last) * 0.001;
    if (dt < 0.001) return;
    if (dt > 0.14) {
      this.reset(position, rotation, time);
      return;
    }
    this.linear.sub2(position, this.position).mulScalar(1 / dt);

    this.change.copy(this.rotation).invert().mul2(rotation, this.change).normalize();
    const { x, y, z, w } = this.change;
    const sinHalf = Math.hypot(x, y, z);
    this.angular.set(x, y, z).mulScalar(sinHalf > 0.00001
      ? (w < 0 ? -1 : 1) * 2 * Math.atan2(sinHalf, Math.abs(w)) / (sinHalf * dt) : 0);
    limit(this.angular, maxAngularSpeed);
    if (this.centerHeight) {
      rotation.transformVector(pc.Vec3.UP, this.centerOffset).mulScalar(this.centerHeight);
      this.linear.add(this.centerVelocity.cross(this.angular, this.centerOffset));
    }
    limit(this.linear, maxLinearSpeed);
    this.velocity.lerp(this.velocity, this.linear, damp(dt, 24));
    this.angularVelocity.lerp(this.angularVelocity, this.angular, damp(dt, 22));
    this.position.copy(position);
    this.rotation.copy(rotation);
    this.last = time;
  }

  release(time = performance.now()): void {
    const decay = Math.exp(-Math.max(0, time - this.last - 24) / 60);
    this.velocity.mulScalar(decay);
    this.angularVelocity.mulScalar(decay);
  }
}

export class DishBody {
  readonly position = new pc.Vec3();
  readonly rotation = new pc.Quat();
  readonly velocity = new pc.Vec3();
  readonly angularVelocity = new pc.Vec3();
  state: DishState = 'seated';
  support?: Support;
  radius = 0.12;
  height = 0.08;
  idle = 0;
  private quiet = 0;
  private up = new pc.Vec3();
  private offset = new pc.Vec3();
  private turn = new pc.Quat();
  private contact = new pc.Vec3();
  private releasedOn?: { surface: ReleaseSurface; until: number };
  private previousPosition = new pc.Vec3();
  private previousRotation = new pc.Quat();
  private sweptRotation = new pc.Quat();
  private normalOffset = new pc.Vec3();
  private contactVelocity = new pc.Vec3();
  private tangent = new pc.Vec3();
  private torqueAxis = new pc.Vec3();
  private inertiaAxis = new pc.Vec3();

  get halfHeight(): number { return this.height * 0.5; }
  get inverseMass(): number { return this.state === 'held' ? 0 : 0.0144 / (this.radius ** 2); }

  setFromPivot(position: pc.Vec3, rotation: pc.Quat): void {
    this.rotation.copy(rotation);
    rotation.transformVector(pc.Vec3.UP, this.up);
    this.position.copy(position).addScaled(this.up, this.halfHeight);
  }

  pivot(out: pc.Vec3): pc.Vec3 {
    return out.copy(this.position).addScaled(this.rotation.transformVector(pc.Vec3.UP, this.offset), -this.halfHeight);
  }

  get inverseYawInertia(): number { return 2 * this.inverseMass / (this.radius ** 2); }

  private inverseInertia(axis: pc.Vec3): pc.Vec3 {
    const yaw = this.inverseYawInertia;
    const tilt = 12 * this.inverseMass / (3 * this.radius ** 2 + this.height ** 2);
    const axial = axis.dot(this.up);
    return axis.mulScalar(tilt).addScaled(this.up, (yaw - tilt) * axial);
  }

  private effectiveInverseMass(direction: pc.Vec3): number {
    const axis = this.torqueAxis.cross(this.normalOffset, direction);
    const before = this.inertiaAxis.copy(axis);
    return this.inverseMass + before.dot(this.inverseInertia(axis));
  }

  private applyImpulse(direction: pc.Vec3, magnitude: number): void {
    this.velocity.addScaled(direction, this.inverseMass * magnitude);
    const axis = this.torqueAxis.cross(this.normalOffset, direction);
    this.angularVelocity.addScaled(this.inverseInertia(axis), magnitude);
  }

  private lowestOffset(rotation: pc.Quat): pc.Vec3 {
    const up = rotation.transformVector(pc.Vec3.UP, this.up);
    const radial = this.normalOffset.set(0, -1, 0).addScaled(up, up.y);
    if (radial.lengthSq() > 1e-10) radial.normalize().mulScalar(this.radius);
    else radial.set(0, 0, 0);
    return radial.addScaled(up, up.y >= 0 ? -this.halfHeight : this.halfHeight);
  }

  get verticalExtent(): number {
    const y = this.rotation.transformVector(pc.Vec3.UP, this.up).y;
    return this.halfHeight * Math.abs(y) + this.radius * Math.sqrt(Math.max(0, 1 - y * y));
  }

  reset(state: DishState): void {
    this.state = state;
    this.support = undefined;
    this.releasedOn = undefined;
    this.idle = this.quiet = 0;
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
  }

  wake(): void {
    this.state = 'dynamic';
    this.idle = this.quiet = 0;
  }

  toss(linear?: pc.Vec3, angular?: pc.Vec3, surface?: ReleaseSurface): void {
    this.reset('dynamic');
    if (linear) this.velocity.copy(linear);
    if (angular) this.angularVelocity.copy(angular);
    if (surface) this.releasedOn = { surface, until: performance.now() + releaseSupportMs };
    this.clampMotion();
  }

  clampMotion(): void {
    limit(this.velocity, maxLinearSpeed);
    limit(this.angularVelocity, maxAngularSpeed);
  }

  sleep(support: Support): void {
    this.reset('sleeping');
    this.support = support;
  }

  keepAbove(y: number): void {
    this.position.y = Math.max(this.position.y, y + this.verticalExtent);
  }

  checkSupport(surfaceAt?: (point: pc.Vec3) => number | undefined): void {
    if (this.state !== 'sleeping' || this.support !== 'surface') return;
    const bottom = this.position.y - this.verticalExtent;
    const height = surfaceAt?.(this.contact.set(this.position.x, bottom, this.position.z));
    if (height === undefined || Math.abs(height - bottom) > 0.025) this.wake();
  }

  step(dt: number, table: pc.Vec3, floorY: number, surfaceAt?: (point: pc.Vec3) => number | undefined): void {
    this.previousPosition.copy(this.position);
    this.previousRotation.copy(this.rotation);
    const previousBottom = this.position.y + this.lowestOffset(this.rotation).y;
    this.velocity.y -= gravity * dt;
    this.position.addScaled(this.velocity, dt);

    const spin = this.angularVelocity.length();
    if (spin > 0.0001) {
      this.offset.copy(this.angularVelocity).mulScalar(1 / spin);
      this.turn.setFromAxisAngle(this.offset, spin * dt * pc.math.RAD_TO_DEG);
      this.rotation.mul2(this.turn, this.rotation).normalize();
    }

    const x = this.position.x - table.x;
    const z = this.position.z - table.z;
    const distance = Math.hypot(x, z);
    const bottom = this.position.y + this.lowestOffset(this.rotation).y;
    const edge = clamp((distance - tableRadius + this.radius * 0.42) / (this.radius * 0.42), 0, 1);
    if (edge && bottom > table.y - 0.11 && bottom < table.y + 0.025 &&
      intersectsTable(x, z, this.up, this.radius, this.halfHeight)) {
      const torque = edge * 15 * dt / distance;
      this.angularVelocity.x += z * torque;
      this.angularVelocity.z -= x * torque;
      if (this.up.y < 0.96) {
        const slip = edge * (1 - this.up.y) * 7 * dt / distance;
        this.velocity.x += x * slip;
        this.velocity.z += z * slip;
      }
      this.clampMotion();
    }

    let support: Support = 'floor';
    let height = floorY;
    let contactBottom = bottom;
    if (previousBottom >= table.y - 0.012) {
      // Check the rotating lower rim along the step, including when both endpoints clear the top.
      for (let sample = 1; sample <= 4; sample++) {
        const t = sample / 4;
        this.contact.lerp(this.previousPosition, this.position, t);
        this.sweptRotation.slerp(this.previousRotation, this.rotation, t);
        const offset = this.lowestOffset(this.sweptRotation);
        const sweptBottom = this.contact.y + offset.y;
        if (sweptBottom > table.y ||
          Math.hypot(this.contact.x + offset.x - table.x, this.contact.z + offset.z - table.z) > tableRadius) continue;
        height = table.y;
        support = 'table';
        this.position.copy(this.contact);
        this.rotation.copy(this.sweptRotation);
        contactBottom = sweptBottom;
        break;
      }
    }
    let surface = surfaceAt?.(this.contact.set(this.position.x, Math.max(bottom, previousBottom - 0.06), this.position.z));
    const released = this.releasedOn;
    if (released && performance.now() >= released.until) this.releasedOn = undefined;
    if (surface === undefined && this.releasedOn?.surface.contains(this.position)) surface = this.releasedOn.surface.topY;
    if (surface !== undefined && surface > height + 0.005 && previousBottom >= surface - 0.012) {
      height = surface;
      support = 'surface';
      contactBottom = this.position.y + this.lowestOffset(this.rotation).y;
    }
    if (contactBottom > height) {
      this.support = undefined;
      this.quiet = 0;
      this.angularVelocity.mulScalar(Math.exp(-0.65 * dt));
      return;
    }

    this.lowestOffset(this.rotation);
    // A nearly level base spreads low-speed contact across its face instead of rocking on one rim point.
    if (this.up.y > 0.998 && Math.abs(this.velocity.y) < 0.20 &&
      Math.hypot(this.angularVelocity.x, this.angularVelocity.z) * this.radius < 0.24) {
      const rimWeight = clamp(Math.hypot(this.up.x, this.up.z) / 0.06, 0, 1);
      this.normalOffset.x *= rimWeight;
      this.normalOffset.z *= rimWeight;
    }
    this.position.y += height - contactBottom;
    this.support = support;
    const normalVelocity = this.contactVelocity.cross(this.angularVelocity, this.normalOffset).add(this.velocity).y;
    const impact = Math.max(0, -normalVelocity);
    const restitution = impact > 0.24 ? (support === 'floor' ? 0.20 : 0.24) : 0;
    const normalImpulse = (1 + restitution) * impact / this.effectiveInverseMass(pc.Vec3.UP);
    this.applyImpulse(pc.Vec3.UP, normalImpulse);

    this.tangent.cross(this.angularVelocity, this.normalOffset).add(this.velocity);
    this.tangent.y = 0;
    const slip = this.tangent.length();
    if (slip > 0.00001 && normalImpulse > 0) {
      this.tangent.mulScalar(1 / slip);
      const friction = support === 'floor' ? 0.65 : 0.4;
      this.applyImpulse(this.tangent, -Math.min(slip / this.effectiveInverseMass(this.tangent), friction * normalImpulse));
    }
    const upright = support === 'table' ? 1 - edge : 1;
    this.angularVelocity.x += -this.up.z * 28 * upright * dt;
    this.angularVelocity.z += this.up.x * 28 * upright * dt;
    if (this.up.y < -0.99) this.angularVelocity.x += 3 * dt;
    this.angularVelocity.mulScalar(Math.exp(-6 * dt));
    this.clampMotion();

    const steady = this.velocity.lengthSq() < 0.03 ** 2 && this.angularVelocity.lengthSq() < 0.14 ** 2 &&
      this.up.y > 0.998 && (support !== 'table' || edge === 0);
    this.quiet = steady ? this.quiet + dt : 0;
    if (this.quiet >= 0.16) this.sleep(support);
  }
}

export function collideDishes(a: DishBody, b: DishBody): void {
  if (a.state !== 'dynamic' && b.state !== 'dynamic' && a.state !== 'held' && b.state !== 'held') return;
  if (Math.abs(a.position.y - b.position.y) >= a.verticalExtent + b.verticalExtent) return;
  const dx = b.position.x - a.position.x;
  const dz = b.position.z - a.position.z;
  const distance = Math.hypot(dx, dz);
  const overlap = a.radius + b.radius - distance;
  const invA = a.inverseMass;
  const invB = b.inverseMass;
  const inverseMass = invA + invB;
  if (overlap <= 0 || !inverseMass) return;
  const x = distance > 0.00001 ? dx / distance : 1;
  const z = distance > 0.00001 ? dz / distance : 0;
  const vx = b.velocity.x - a.velocity.x;
  const vz = b.velocity.z - a.velocity.z;
  const approach = vx * x + vz * z;
  if (invA && a.state !== 'dynamic') a.wake();
  if (invB && b.state !== 'dynamic') b.wake();
  const push = overlap / inverseMass;
  a.position.x -= x * push * invA;
  a.position.z -= z * push * invA;
  b.position.x += x * push * invB;
  b.position.z += z * push * invB;
  if (approach >= 0) return;

  const impulse = -1.18 * approach / inverseMass;
  const slip = vz * x - vx * z + a.angularVelocity.y * a.radius + b.angularVelocity.y * b.radius;
  const tangentialMass = inverseMass + a.inverseYawInertia * a.radius ** 2 + b.inverseYawInertia * b.radius ** 2;
  const tangent = clamp(-slip / tangentialMass, -0.22 * impulse, 0.22 * impulse);
  const impulseX = impulse * x - tangent * z;
  const impulseZ = impulse * z + tangent * x;
  a.velocity.x -= impulseX * invA;
  a.velocity.z -= impulseZ * invA;
  b.velocity.x += impulseX * invB;
  b.velocity.z += impulseZ * invB;
  a.angularVelocity.y += 2 * tangent * invA / a.radius;
  b.angularVelocity.y += 2 * tangent * invB / b.radius;
  a.clampMotion();
  b.clampMotion();
}
