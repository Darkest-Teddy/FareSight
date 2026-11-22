import * as pc from 'playcanvas';
import { clamp, damp } from './sceneSupport';

export const tableRadius = 0.45;
export const dishStep = 1 / 120;
const maxLinearSpeed = 6;
const maxAngularSpeed = 12;
const gravity = 9.81;

type DishState = 'seated' | 'held' | 'dynamic' | 'sleeping';
type Support = 'table' | 'surface' | 'floor' | 'lost';

function limit(vector: pc.Vec3, maximum: number): void {
  const speed = vector.length();
  if (!Number.isFinite(speed)) vector.set(0, 0, 0);
  else if (speed > maximum) vector.mulScalar(maximum / speed);
}

export class DishGrabMotion {
  readonly velocity = new pc.Vec3();
  readonly angularVelocity = new pc.Vec3();
  private position = new pc.Vec3();
  private rotation = new pc.Quat();
  private linear = new pc.Vec3();
  private angular = new pc.Vec3();
  private change = new pc.Quat();
  private last = 0;

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
    limit(this.linear, maxLinearSpeed);
    this.velocity.lerp(this.velocity, this.linear, damp(dt, 24));

    this.change.copy(this.rotation).invert().mul2(rotation, this.change).normalize();
    const { x, y, z, w } = this.change;
    const sinHalf = Math.hypot(x, y, z);
    this.angular.set(x, y, z).mulScalar(sinHalf > 0.00001
      ? (w < 0 ? -1 : 1) * 2 * Math.atan2(sinHalf, Math.abs(w)) / (sinHalf * dt) : 0);
    limit(this.angular, maxAngularSpeed);
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
  private releasedOn?: { x: number; z: number; y: number };

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

  toss(linear?: pc.Vec3, angular?: pc.Vec3, surfaceY?: number): void {
    this.reset('dynamic');
    if (linear) this.velocity.copy(linear);
    if (angular) this.angularVelocity.copy(angular);
    if (surfaceY !== undefined) this.releasedOn = { x: this.position.x, z: this.position.z, y: surfaceY };
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

  step(dt: number, table: pc.Vec3, floorY: number, surfaceAt?: (point: pc.Vec3) => number | undefined): void {
    const previousBottom = this.position.y - this.verticalExtent;
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
    const bottom = this.position.y - this.verticalExtent;
    const edge = clamp((distance - tableRadius + this.radius * 0.42) / (this.radius * 0.42), 0, 1);
    if (edge && distance > 0 && bottom > table.y - 0.11 && bottom < table.y + 0.025) {
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
    if (distance <= tableRadius && previousBottom >= table.y - 0.012) {
      height = table.y;
      support = 'table';
    }
    let surface = surfaceAt?.(this.contact.set(this.position.x, Math.max(bottom, previousBottom - 0.06), this.position.z));
    const released = this.releasedOn;
    if (surface === undefined && released && Math.hypot(this.position.x - released.x, this.position.z - released.z) <= 0.20) surface = released.y;
    if (surface !== undefined && surface > height + 0.005 && previousBottom >= surface - 0.012) {
      height = surface;
      support = 'surface';
    }
    if (bottom > height || this.velocity.y > 0.05) {
      this.support = undefined;
      this.quiet = 0;
      this.angularVelocity.mulScalar(Math.exp(-0.65 * dt));
      return;
    }

    this.position.y += height - bottom;
    this.support = support;
    const impact = -this.velocity.y;
    this.velocity.y = impact > 0.24 ? impact * (support === 'floor' ? 0.20 : 0.24) : 0;
    const friction = Math.exp(-(support === 'floor' ? 6.4 : 3.8) * dt);
    this.velocity.x *= friction;
    this.velocity.z *= friction;
    if (impact > 0.5) {
      this.velocity.x *= 0.87;
      this.velocity.z *= 0.87;
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
  if (approach >= 0 && a.state !== 'dynamic' && b.state !== 'dynamic') return;
  if (invA && a.state !== 'dynamic') a.wake();
  if (invB && b.state !== 'dynamic') b.wake();
  const push = Math.max(0, overlap - 0.001) * 0.78 / inverseMass;
  a.position.x -= x * push * invA;
  a.position.z -= z * push * invA;
  b.position.x += x * push * invB;
  b.position.z += z * push * invB;
  if (approach >= 0) return;

  const impulse = -1.18 * approach / inverseMass;
  const tangent = clamp((vx * z - vz * x) / inverseMass, -0.22 * impulse, 0.22 * impulse);
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
