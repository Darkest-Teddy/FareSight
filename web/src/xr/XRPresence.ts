import * as pc from 'playcanvas';
import type { GrabbableDish } from './DishTableScene';
import type { VRReviewCard } from './VRReviewCard';
import type { PhysicalMenuBook } from './PhysicalMenuBook';
import type { SurfaceMatch } from './PhysicalSurfaces';
import { brass, calloutAmber, child, clamp, coastTurntable, damp, handReleaseDelay, material, shape, TurnVelocity, wrapAngle,
  type HitTarget, type PickBounds, type ScenePicker } from './sceneSupport';

const pointerRange = 4.5;
const pokeDebounce = 400;
const pinchRange = 0.035;
const tickAngle = Math.PI / 12;
const controllerCarryReach = 0.16;
const handCarryReach = 0.12;
const handheldReach = 0.08;
const handHeldReach = 0.095;
const pinchSpinDistance = 0.035;
const trackingGraceMs = 120;
const inspectionDistance = 0.18;
const inspectionOffset = new pc.Vec3(0, 0.035, -0.135);
const reachSeconds = 0.22;
const controllerForearmOffset = new pc.Vec3(0, 0.042, 0.12);
const controllerDeckRotation = new pc.Quat().setFromMat4(new pc.Mat4().setLookAt(pc.Vec3.UP, pc.Vec3.ZERO, pc.Vec3.LEFT))
  .mul(new pc.Quat().setFromAxisAngle(pc.Vec3.RIGHT, 22));

export interface ForearmPose {
  position: pc.Vec3;
  rotation: pc.Quat;
  kind: 'hand' | 'controller';
}

interface HandModel {
  root: pc.Entity;
  joints: Map<pc.XrJoint, pc.Entity>;
  bones: { from: pc.XrJoint; to: pc.XrJoint; entity: pc.Entity }[];
  tips: pc.StandardMaterial;
}

interface Pointer {
  root: pc.Entity;
  hand?: HandModel;
  controller?: pc.Entity;
  beam?: pc.Entity;
  dot?: pc.Entity;
  hover: HitTarget | null;
  contact: HitTarget | null;
  lastPoke: number;
  lastPokeTarget: HitTarget | null;
  flashUntil: number;
  selectConsumed: boolean;
  selectTarget: HitTarget | null;
  scenePinch?: { turntable: pc.Entity; start: pc.Vec3; lostSince?: number };
  snapHeld: boolean;
  recenterHeld: boolean;
  voiceHeld: boolean;
}

interface PresenceActions {
  targets: () => readonly HitTarget[];
  buttons: readonly HitTarget[];
  selectEmpty: () => void;
  recenter: () => void;
  toggleVoice: () => void;
  deck: PickBounds;
  menu: () => PhysicalMenuBook | undefined;
  menuTabletop: (menu: PhysicalMenuBook, at: pc.Vec3) => number | undefined;
  reviews: () => readonly VRReviewCard[];
  dishes: () => readonly GrabbableDish[];
  turntable: () => PickBounds | null;
  canSnapTurn: () => boolean;
  turntableMoved: (surface?: SurfaceMatch | null) => void;
  snapSurface: (entity: pc.Entity, position: pc.Vec3, lock?: object) => { y: number; surface: SurfaceMatch } | undefined;
  previewSurface: (surface: SurfaceMatch | null) => void;
  reducedMotion: () => boolean;
  spin: (radians: number) => void;
}

interface GrabInput {
  source: pc.XrInputSource;
  kind: 'grip' | 'select';
  mode: Exclude<Grab['mode'], 'steer'>;
  position: pc.Vec3;
  sample: pc.Vec3;
  lostSince?: number;
}

interface HandheldTarget {
  entity: pc.Entity;
  menu?: PhysicalMenuBook;
  dish?: GrabbableDish;
  direct?: boolean;
}

interface HandheldGrab extends HandheldTarget {
  kind: GrabInput['kind'];
  offset: pc.Vec3;
  rotation: pc.Quat;
  menuVenue?: string;
  reach?: { from: pc.Vec3; elapsed: number };
  position: pc.Vec3;
  orientation: pc.Quat;
  lostSince?: number;
}

interface Grab {
  inputs: GrabInput[];
  mode: 'carry' | 'spin' | 'steer' | 'tap';
  entity: pc.Entity | null;
  began: number;
  start: pc.Vec3;
  previous: pc.Vec3;
  offset: pc.Vec3;
  yaw: number | null;
  movement: number;
  joined?: boolean;
  tick: number;
  surface?: SurfaceMatch;
  surfaceOffset: number;
  snapY?: number;
}

type HapticGamepad = Gamepad & {
  hapticActuators?: readonly { pulse: (intensity: number, duration: number) => Promise<boolean> }[];
};

function signalMaterial(hex: string, intensity: number): pc.StandardMaterial {
  const surface = material(hex, 1);
  surface.diffuse.set(0, 0, 0);
  surface.useLighting = false;
  surface.emissiveIntensity = intensity;
  surface.update();
  return surface;
}

export class XRPresence {
  private pointers = new Map<pc.XrInputSource, Pointer>();
  private trackedHands = new Set<pc.XrInputSource['handedness']>();
  private events: pc.EventHandle[];
  private meshes: { sphere: pc.Mesh; cylinder: pc.Mesh } | undefined;
  private glove = material('#bab2a5', 0.10, 0.84);
  private grip = material('#292b30', 0.12);
  private ring = material('#514b43', 0.19);
  private trim = material(brass, 0.22);
  private idle = signalMaterial('#e8dfd0', 0.80);
  private hovered = signalMaterial(calloutAmber, 1);
  private flash = signalMaterial(calloutAmber, 1.65);
  private ray = new pc.Ray();
  private end = new pc.Vec3();
  private delta = new pc.Vec3();
  private middle = new pc.Vec3();
  private rotation = new pc.Quat();
  private heading = new pc.Vec3();
  private right = new pc.Vec3();
  private head = new pc.Vec3();
  private displacement = new pc.Vec3();
  private forearmPose: ForearmPose = { position: new pc.Vec3(), rotation: new pc.Quat(), kind: 'hand' };
  private forearmDirection = new pc.Vec3();
  private forearmNormal = new pc.Vec3();
  private forearmUp = new pc.Vec3();
  private forearmBasis = new pc.Mat4();
  private grab: Grab | null = null;
  private handhelds = new Map<pc.XrInputSource, HandheldGrab>();
  private handOrientation = new pc.Quat();
  private anchor = new pc.Vec3();
  private secondHand = new pc.Vec3();
  private anchoredPosition = new pc.Vec3();
  private grabYaw: number | null = null;
  private spinAxis = new pc.Vec3();
  private velocity = new TurnVelocity();
  private coast = 0;
  private coastRoot: pc.Entity | null = null;
  private coastCarry = false;

  constructor(
    private xr: pc.XrManager, private root: pc.Entity, private rig: pc.Entity,
    private camera: pc.Entity, private picker: ScenePicker, private actions: PresenceActions,
  ) {
    const input = xr.input;
    this.events = [
      input.on('add', this.add, this), input.on('remove', this.remove, this),
      input.on('selectstart', this.selectStart, this), input.on('select', this.select, this),
      input.on('selectend', this.selectEnd, this),
      input.on('squeezestart', this.squeezeStart, this),
      input.on('squeezeend', this.squeezeEnd, this),
      xr.on('start', () => input.inputSources.forEach((source) => this.add(source))),
      xr.on('end', this.clear, this),
    ];
  }

  private add(source: pc.XrInputSource): void {
    if (this.pointers.has(source)) return;
    const root = child(this.root, `XR ${source.handedness} input`);
    const pointer: Pointer = {
      root, hover: null, contact: null, lastPoke: -Infinity, lastPokeTarget: null, flashUntil: -Infinity,
      selectConsumed: false, selectTarget: null, snapHeld: false, recenterHeld: false, voiceHeld: false,
    };
    if (source.hand) pointer.hand = this.makeHand(root, source.hand);
    if (source.targetRayMode === pc.XRTARGETRAY_POINTER) {
      pointer.beam = this.primitive(root, 'Pointer ray', 'cylinder', this.idle);
      pointer.dot = this.primitive(root, 'Pointer hit dot', 'sphere', this.hovered);
      pointer.dot.setLocalScale(0.009, 0.009, 0.009);
      pointer.beam.enabled = false;
      pointer.dot.enabled = false;
    }
    this.pointers.set(source, pointer);
  }

  private primitive(parent: pc.Entity, name: string, type: 'sphere' | 'cylinder', surface: pc.Material): pc.Entity {
    if (!this.meshes) {
      const device = this.xr.app.graphicsDevice;
      this.meshes = {
        sphere: pc.Mesh.fromGeometry(device, new pc.SphereGeometry({ latitudeBands: 8, longitudeBands: 10 })),
        cylinder: pc.Mesh.fromGeometry(device, new pc.CylinderGeometry({ heightSegments: 1, capSegments: 8 })),
      };
      for (const mesh of Object.values(this.meshes)) mesh.incRefCount();
    }
    const entity = child(parent, name);
    entity.addComponent('render', { meshInstances: [new pc.MeshInstance(this.meshes[type], surface, entity)] });
    return entity;
  }

  private makeHand(parent: pc.Entity, hand: pc.XrHand): HandModel {
    const root = child(parent, 'Tracked hand');
    root.enabled = false;
    const tips = material(brass, 1);
    tips.emissiveIntensity = 0.18;
    const joints = new Map<pc.XrJoint, pc.Entity>();
    for (const joint of hand.joints) {
      const accented = joint.id === 'index-finger-tip' || joint.id === 'thumb-tip';
      joints.set(joint, this.primitive(root, joint.id, 'sphere', accented ? tips : this.glove));
    }
    const bones: HandModel['bones'] = [];
    for (const finger of hand.fingers) {
      let previous = hand.wrist;
      for (const joint of finger.joints) {
        if (previous) {
          const entity = this.primitive(root, `${previous.id} to ${joint.id}`, 'cylinder', this.glove);
          bones.push({ from: previous, to: joint, entity });
        }
        previous = joint;
      }
    }
    return { root, joints, bones, tips };
  }

  private makeController(source: pc.XrInputSource): pc.Entity {
    const root = child(this.rig, `XR ${source.handedness} controller`);
    const side = source.handedness === pc.XRHAND_LEFT ? -1 : 1;
    shape(root, 'Controller grip', 'sphere', this.grip, [0, -0.028, 0.024], [0.042, 0.049, 0.113])
      .setLocalEulerAngles(25, 0, side * 9);
    shape(root, 'Controller face', 'sphere', this.grip, [0, 0.002, -0.022], [0.055, 0.031, 0.058]);
    shape(root, 'Tracking ring', 'torus', this.ring, [0, 0.021, -0.035], [0.069, 0.029, 0.069])
      .setLocalEulerAngles(26, 0, 0);
    shape(root, 'Thumbstick cap', 'cylinder', this.trim, [side * 0.010, 0.020, -0.016], [0.012, 0.008, 0.012]);
    shape(root, 'Trigger', 'sphere', this.trim, [0, -0.022, -0.038], [0.016, 0.013, 0.023]);
    return root;
  }

  private segment(entity: pc.Entity, from: pc.Vec3, to: pc.Vec3, diameter: number): void {
    const length = this.delta.sub2(to, from).length();
    entity.enabled = length > 0.0001;
    if (!entity.enabled) return;
    entity.setPosition(this.middle.lerp(from, to, 0.5));
    entity.setRotation(this.rotation.setFromDirections(pc.Vec3.UP, this.delta.divScalar(length)));
    entity.setLocalScale(diameter, length, diameter);
  }

  private remove(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (!pointer) return;
    this.releaseGrab(source, false);
    this.releaseHandheld(source, false);
    pointer.root.destroy();
    pointer.hand?.tips.destroy();
    pointer.controller?.destroy();
    this.pointers.delete(source);
  }

  private clear(): void {
    this.resetGrip();
    for (const source of this.pointers.keys()) this.remove(source);
  }

  private get interactive(): boolean {
    return this.xr.active && this.xr.visibilityState !== 'hidden' && this.xr.visibilityState !== 'visible-blurred';
  }

  private pulse(source: pc.XrInputSource, intensity: number, duration: number): void {
    const gamepad: HapticGamepad | null = source.gamepad;
    void gamepad?.hapticActuators?.[0]?.pulse(intensity, duration).catch(() => {});
  }

  private aim(source: pc.XrInputSource): void {
    this.ray.origin.copy(source.getOrigin());
    this.ray.direction.copy(source.getDirection()).normalize();
  }

  private rayTargets(source: pc.XrInputSource, targets: readonly HitTarget[], grip = false) {
    const reviews = this.actions.reviews();
    const menu = this.actions.menu();
    const dishes = this.actions.dishes();
    const prop = this.picker.raycast(this.ray, [...reviews.flatMap(({ gripBounds }) => gripBounds), ...(menu?.gripBounds ?? []),
      ...dishes.map(({ bounds }) => bounds)], pointerRange);
    const usesDeck = source.handedness === pc.XRHAND_RIGHT;
    const deck = usesDeck ? this.picker.raycast(this.ray, [this.actions.deck], pointerRange) : null;
    const eligible = grip && menu ? targets.filter((target) => !menu.targets.includes(target)) : targets;
    const hit = this.picker.raycast(this.ray, usesDeck ? [...this.actions.buttons, ...eligible] : eligible, pointerRange);
    const review = hit && reviews.find(({ targets }) => targets.includes(hit.target));
    const control = hit && (this.actions.buttons.includes(hit.target) || review
      ? !prop || prop.target.entity === review?.entity || hit.distance <= prop.distance
      : this.isHardwareControl(hit.target) || ((!deck || hit.distance < deck.distance) && (!prop || hit.distance < prop.distance))) ? hit : null;
    const handheld = prop && this.handheldTarget(prop.target, menu, dishes);
    return { control, deck, prop, handheld };
  }

  private isHardwareControl(target: HitTarget): boolean {
    return this.actions.buttons.includes(target) || this.isReviewControl(target) ||
      !!this.actions.menu()?.targets.includes(target);
  }

  private isReviewControl(target: HitTarget): boolean {
    return this.actions.reviews().some(({ targets }) => targets.includes(target));
  }

  private nearDeckKey(source: pc.XrInputSource, position: pc.Vec3): HitTarget | null {
    if (source.handedness !== pc.XRHAND_RIGHT) return null;
    return this.picker.nearPanel(position, this.actions.buttons, 0.010) ??
      (!source.hand ? this.picker.nearPanel(source.getOrigin(), this.actions.buttons, 0.010) : null);
  }

  private nearControl(source: pc.XrInputSource, position: pc.Vec3, grip = false): HitTarget | null {
    return this.nearDeckKey(source, position) ??
      this.picker.nearPanel(position, this.actions.reviews().flatMap(({ targets }) => targets), 0.016) ??
      (grip ? null : this.picker.nearPanel(position, this.actions.menu()?.targets ?? [], 0.016));
  }

  private handheldTarget(bounds: PickBounds, menu: PhysicalMenuBook | undefined, dishes: readonly GrabbableDish[], direct = false): HandheldTarget {
    if (menu?.gripBounds.includes(bounds)) return { entity: menu.entity, menu, direct };
    return { entity: bounds.entity, dish: dishes.find((dish) => dish.bounds === bounds), direct };
  }

  private nearHandheld(source: pc.XrInputSource, position: pc.Vec3): HandheldTarget | null {
    const reach = source.hand ? handHeldReach : handheldReach;
    const clip = this.picker.nearPanel(position, this.actions.reviews().flatMap(({ gripBounds }) => gripBounds), reach);
    if (clip) return { entity: clip.entity, direct: true };
    const menu = this.actions.menu();
    const dishes = this.actions.dishes();
    const nearest = this.picker.nearPanel(position, [...(menu?.gripBounds ?? []), ...dishes.map(({ bounds }) => bounds)], reach);
    return nearest && this.handheldTarget(nearest, menu, dishes, true);
  }

  private selectStart(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (!this.interactive || !pointer) return;
    pointer.selectConsumed = this.isHolding(source);
    pointer.selectTarget = null;
    pointer.scenePinch = undefined;
    if (pointer.selectConsumed || (source.hand && !source.hand.tracking)) return;

    const hasPosition = this.handPosition(source, this.anchor);
    this.aim(source);
    const { control, deck, handheld } = this.rayTargets(source, this.actions.targets());
    const direct = hasPosition ? this.nearControl(source, this.anchor) : null;
    pointer.selectTarget = direct ?? control?.target ?? null;
    if (!pointer.selectTarget) {
      const prop = (hasPosition ? this.nearHandheld(source, this.anchor) : null) ?? handheld;
      if (prop && this.beginHandheld(source, 'select', prop)) return;
      if (deck || (hasPosition && source.handedness === pc.XRHAND_RIGHT && this.picker.nearPanel(this.anchor, [this.actions.deck], 0.025))) {
        pointer.selectConsumed = true;
        return;
      }
    }
    const turntable = this.actions.turntable();
    if (source.hand && turntable && (!pointer.selectTarget || !this.isHardwareControl(pointer.selectTarget)) &&
      this.handDragPosition(source, this.anchor)) {
      const start = this.anchor.clone();
      const near = this.picker.nearPanel(start, [turntable], handCarryReach);
      this.joinPendingPinch(source, turntable.entity);
      if (pointer.selectTarget && this.grab?.entity !== turntable.entity) {
        pointer.scenePinch = { turntable: turntable.entity, start };
      } else {
        pointer.selectConsumed = true;
        pointer.selectTarget = null;
        this.beginGrab(source, 'select', near ? 'carry' : 'spin', turntable.entity);
      }
      return;
    }
    if (!pointer.selectTarget && hasPosition && (!turntable || this.picker.raycast(this.ray, [turntable], pointerRange))) {
      pointer.selectConsumed = true;
      this.beginGrab(source, 'select', turntable ? 'spin' : 'tap', turntable?.entity ?? null);
      return;
    }
    pointer.flashUntil = performance.now() + 140;
    this.pulse(source, 0.65, 35);
  }

  private select(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (this.interactive && pointer?.scenePinch) {
      this.updateScenePinch(source, pointer, performance.now());
      const picked = pointer.scenePinch && pointer.selectTarget;
      this.clearScenePinch(pointer);
      if (picked && picked.enabled !== false && picked.entity.enabled && this.actions.targets().includes(picked)) picked.action();
      return;
    }
    if (!this.interactive || pointer?.selectConsumed || this.isHolding(source) ||
      (source.hand && !source.hand.tracking)) return;
    if (pointer) pointer.flashUntil = performance.now() + 140;
    this.aim(source);
    const { control } = this.rayTargets(source, this.actions.targets());
    const picked = pointer?.selectTarget ?? (source.hand ? null : control?.target);
    const directlyTouched = picked && this.isHardwareControl(picked) && this.handPosition(source, this.anchor) &&
      this.nearControl(source, this.anchor) === picked;
    if (picked && picked.enabled !== false && picked.entity.enabled && (directlyTouched || control?.target === picked)) {
      if (pointer?.contact !== picked && (pointer?.lastPokeTarget !== picked || performance.now() - pointer.lastPoke >= pokeDebounce)) {
        if (this.isReviewControl(picked)) this.pulse(source, 0.28, 20);
        picked.action();
      }
    }
  }

  private selectEnd(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (pointer?.scenePinch) this.clearScenePinch(pointer);
    if (this.handhelds.get(source)?.kind === 'select') this.releaseHandheld(source, true);
    if (this.grab?.inputs.some((input) => input.source === source && input.kind === 'select')) this.releaseGrab(source, true);
  }

  private clearScenePinch(pointer: Pointer): void {
    pointer.scenePinch = undefined;
    pointer.selectTarget = null;
    pointer.selectConsumed = true;
  }

  private joinPendingPinch(source: pc.XrInputSource, turntable: pc.Entity): void {
    if (this.grab) return;
    for (const [other, pointer] of this.pointers) {
      if (other.handedness === source.handedness || pointer.scenePinch?.turntable !== turntable ||
        !other.hand?.tracking) continue;
      this.clearScenePinch(pointer);
      this.beginGrab(other, 'select', 'spin', turntable);
      return;
    }
  }

  private updateScenePinch(source: pc.XrInputSource, pointer: Pointer, now: number): void {
    const pinch = pointer.scenePinch;
    if (!pinch) return;
    if (this.actions.turntable()?.entity !== pinch.turntable) {
      this.clearScenePinch(pointer);
      return;
    }
    if (!this.handDragPosition(source, this.anchor)) {
      if (now - (pinch.lostSince ??= now) >= trackingGraceMs) this.clearScenePinch(pointer);
      return;
    }
    pinch.lostSince = undefined;
    const distance = this.anchor.distance(pinch.start);
    if (distance > pinchSpinDistance) {
      this.clearScenePinch(pointer);
      this.beginGrab(source, 'select', 'spin', pinch.turntable, pinch.start);
    }
  }

  private squeezeStart(source: pc.XrInputSource): void {
    if (!this.interactive || source.hand || this.isHolding(source) || source.targetRayMode !== pc.XRTARGETRAY_POINTER ||
      !this.handPosition(source, this.anchor)) return;
    this.aim(source);
    const { control, deck, handheld } = this.rayTargets(source, this.actions.targets(), true);
    if (this.nearControl(source, this.anchor, true) || control) return;
    const near = this.nearHandheld(source, this.anchor);
    const prop = handheld?.menu && near?.entity !== handheld.entity ? handheld : near ?? handheld;
    if (prop && this.beginHandheld(source, 'grip', prop)) return;
    if (deck || (source.handedness === pc.XRHAND_RIGHT && this.picker.nearPanel(this.anchor, [this.actions.deck], 0.025))) return;
    const turntable = this.actions.turntable();
    if (turntable) {
      const carry = this.picker.nearPanel(this.anchor, [turntable], controllerCarryReach);
      this.beginGrab(source, 'grip', carry ? 'carry' : 'spin', turntable.entity);
    }
  }

  private squeezeEnd(source: pc.XrInputSource): void {
    if (this.handhelds.get(source)?.kind === 'grip') this.releaseHandheld(source, true);
    if (this.grab?.inputs.some((input) => input.source === source && input.kind === 'grip')) this.releaseGrab(source, true);
  }

  private handRotation(source: pc.XrInputSource, out: pc.Quat): boolean {
    const hand = source.hand;
    const rotation = hand ? hand.wrist?.getRotation() : source.getRotation();
    if (rotation) {
      out.copy(rotation);
      return true;
    }
    if (hand || source.getDirection().lengthSq() < 0.0001) return false;
    out.setFromDirections(pc.Vec3.FORWARD, this.heading.copy(source.getDirection()).normalize());
    return true;
  }

  private beginHandheld(source: pc.XrInputSource, kind: GrabInput['kind'], target: HandheldTarget): boolean {
    const pointer = this.pointers.get(source);
    if (!pointer || this.isHolding(source) || !this.handPosition(source, this.anchor) ||
      !this.handRotation(source, this.handOrientation)) return false;

    const { entity } = target;
    const inverse = this.handOrientation.invert();
    const offset = entity.getPosition().clone().sub(this.anchor);
    const rotation = new pc.Quat().mul2(inverse, entity.getRotation());
    const reach = !target.direct && offset.length() > inspectionDistance ? { from: offset.clone(), elapsed: 0 } : undefined;
    if (reach) offset.copy(inspectionOffset);
    else inverse.transformVector(offset, offset);
    for (const [owner, held] of this.handhelds) {
      if (held.entity === entity) this.handhelds.delete(owner);
    }
    target.dish?.setHeld(true);
    target.menu?.markMoved();
    this.handhelds.set(source, { ...target, kind, offset, rotation, reach, menuVenue: target.menu?.venueId,
      position: entity.getPosition().clone(), orientation: entity.getRotation().clone() });
    pointer.selectConsumed = true;
    pointer.flashUntil = performance.now() + 140;
    this.pulse(source, 0.22, 18);
    return true;
  }

  private isHandheldActive(grab: HandheldGrab): boolean {
    if (grab.dish) return this.actions.dishes().includes(grab.dish);
    if (grab.menu) return this.actions.menu() === grab.menu && grab.menu.venueId === grab.menuVenue;
    return this.actions.reviews().some(({ entity }) => entity === grab.entity);
  }

  transferMenuGrab(from: PhysicalMenuBook, to: PhysicalMenuBook): boolean {
    for (const grab of this.handhelds.values()) {
      if (grab.menu !== from || grab.menuVenue !== to.venueId) continue;
      to.entity.setPosition(grab.position);
      to.entity.setRotation(grab.orientation);
      from.resetPose();
      to.markMoved();
      grab.menu = to;
      grab.entity = to.entity;
      return true;
    }
    return false;
  }

  private moveHandheld(source: pc.XrInputSource, grab: HandheldGrab, dt = 0): boolean {
    if (!this.handPosition(source, this.anchor) || !this.handRotation(source, this.handOrientation)) return false;
    const { entity, reach } = grab;
    this.handOrientation.transformVector(grab.offset, this.anchoredPosition);
    if (reach) {
      reach.elapsed = Math.min(reachSeconds, reach.elapsed + dt);
      const amount = 1 - (1 - reach.elapsed / reachSeconds) ** 3;
      // Hold the initial offset in world space so fast wrist turns cannot swing the distant object.
      this.anchoredPosition.lerp(reach.from, this.anchoredPosition, amount);
      if (reach.elapsed === reachSeconds) grab.reach = undefined;
    }
    const position = this.anchoredPosition.add(this.anchor);
    const orientation = this.rotation.mul2(this.handOrientation, grab.rotation);
    if (source.hand && !this.actions.reducedMotion()) {
      grab.position.lerp(grab.position, position, damp(dt, 24));
      grab.orientation.slerp(grab.orientation, orientation, damp(dt, 22));
    } else {
      grab.position.copy(position);
      grab.orientation.copy(orientation);
    }
    entity.setPosition(grab.position);
    entity.setRotation(grab.orientation);
    grab.menu?.markMoved();
    return true;
  }

  private releaseHandheld(source: pc.XrInputSource, deliberate: boolean): void {
    const grab = this.handhelds.get(source);
    if (!grab) return;
    this.handhelds.delete(source);
    const active = this.isHandheldActive(grab);
    const release = deliberate && active && this.interactive;
    if (active && source.hand) {
      grab.entity.setPosition(grab.position);
      grab.entity.setRotation(grab.orientation);
    } else if (release) this.moveHandheld(source, grab);
    grab.dish?.setHeld(false);
    if (!release) {
      if (grab.menu && grab.menu.venueId === grab.menuVenue) grab.menu.release();
      return;
    }

    const { entity, dish, menu } = grab;
    const at = entity.getPosition();
    const surface = (dish || menu) && this.actions.snapSurface(entity, at);
    const settling = menu ? menu.release(this.actions.menuTabletop(menu, at), surface?.y) : dish?.onRelease(surface?.y);
    this.pulse(source, settling ? 0.28 : 0.18, 18);
  }

  updateHandhelds(dt: number): void {
    const now = performance.now();
    for (const [source, grab] of this.handhelds) {
      if (!this.isHandheldActive(grab)) this.releaseHandheld(source, false);
      else if (this.moveHandheld(source, grab, dt)) grab.lostSince = undefined;
      else if (!source.hand || now - (grab.lostSince ??= now) >= trackingGraceMs) this.releaseHandheld(source, false);
      else {
        grab.entity.setPosition(grab.position);
        grab.entity.setRotation(grab.orientation);
      }
    }
  }

  resetGrip(): void {
    this.resetSceneGrab();
    for (const source of this.handhelds.keys()) this.releaseHandheld(source, false);
  }

  resetSceneGrab(): void {
    if (this.grab?.surface) this.actions.previewSurface(null);
    this.grab = null;
    this.coast = 0;
    this.coastRoot = null;
    for (const pointer of this.pointers.values()) if (pointer.scenePinch) this.clearScenePinch(pointer);
  }

  get isGrabbing(): boolean { return this.grab !== null || this.handhelds.size !== 0; }

  private isHolding(source: pc.XrInputSource): boolean {
    return this.handhelds.has(source) || !!this.grab?.inputs.some((input) => input.source === source);
  }

  private handPosition(source: pc.XrInputSource, out: pc.Vec3): boolean {
    const hand = source.hand;
    if (!hand) {
      const position = source.getPosition() ?? source.getOrigin();
      if (!position) return false;
      out.copy(position);
      return true;
    }
    if (!hand.tracking) return false;
    const thumb = hand.getJointById('thumb-tip');
    const index = hand.getJointById('index-finger-tip');
    if (thumb && index) out.lerp(thumb.getPosition(), index.getPosition(), 0.5);
    else if (hand.wrist) out.copy(hand.wrist.getPosition());
    else return false;
    return true;
  }

  private handDragPosition(source: pc.XrInputSource, out: pc.Vec3): boolean {
    const hand = source.hand;
    if (!hand) return this.handPosition(source, out);
    if (!hand.tracking || !hand.wrist) return false;
    const middle = hand.getJointById('middle-finger-metacarpal');
    const wrist = hand.wrist.getPosition();
    if (middle) out.lerp(wrist, middle.getPosition(), 0.5);
    else out.copy(wrist);
    return true;
  }

  private sampleGrab(grab: Grab): void {
    const [first, second] = grab.inputs;
    this.anchor.copy(first.position);
    this.grabYaw = null;
    if (second) {
      const x = second.position.x - this.anchor.x;
      const z = second.position.z - this.anchor.z;
      if (Math.hypot(x, z) >= 0.08) this.grabYaw = Math.atan2(x, z);
      this.anchor.lerp(this.anchor, second.position, 0.5);
    }
  }

  private rebaseGrab(grab: Grab, preserveMovement = false): void {
    this.sampleGrab(grab);
    if (preserveMovement) grab.start.add(this.displacement.sub2(this.anchor, grab.previous));
    grab.previous.copy(this.anchor);
    grab.yaw = this.grabYaw;
    if (grab.entity && grab.mode === 'carry') {
      grab.offset.sub2(grab.entity.getPosition(), this.anchor);
      grab.offset.y -= grab.surfaceOffset;
    }
  }

  private setGrabMode(grab: Grab, mode: Grab['mode']): void {
    grab.mode = mode;
    if (mode !== 'carry') {
      if (grab.surface) this.actions.previewSurface(null);
      grab.surface = undefined;
      grab.snapY = undefined;
      grab.surfaceOffset = 0;
    }
    this.rebaseGrab(grab);
  }

  private beginGrab(source: pc.XrInputSource, kind: GrabInput['kind'], mode: GrabInput['mode'], entity: pc.Entity | null, start?: pc.Vec3): void {
    if (this.isHolding(source)) return;
    const sample = new pc.Vec3();
    if (!this.handDragPosition(source, sample)) return;
    const input: GrabInput = { source, kind, mode, position: (start ?? sample).clone(), sample };
    const now = performance.now();
    const current = this.grab;
    if (current) {
      if (!entity || current.entity !== entity || current.inputs.length !== 1 ||
        current.inputs[0].source.handedness === source.handedness) return;
      const turntable = this.actions.turntable();
      if (turntable?.entity !== entity) return;
      current.inputs.push(input);
      current.joined = true;
      const close = current.inputs.some((hand) => this.picker.nearPanel(hand.position, [turntable],
        hand.source.hand ? handCarryReach : controllerCarryReach));
      this.setGrabMode(current, close ? 'carry' : 'steer');
    } else {
      const grab: Grab = {
        inputs: [input], mode, entity, began: now,
        start: input.position.clone(), previous: new pc.Vec3(), offset: new pc.Vec3(),
        yaw: null, movement: start?.distance(sample) ?? 0, tick: 0, surfaceOffset: 0,
      };
      this.rebaseGrab(grab);
      this.grab = grab;
      this.spinAxis.copy(this.camera.right);
      this.spinAxis.y = 0;
      if (this.spinAxis.lengthSq() < 0.000001) this.spinAxis.copy(pc.Vec3.RIGHT);
      else this.spinAxis.normalize();
    }
    const pointer = this.pointers.get(source);
    if (pointer) pointer.selectConsumed = true;
    this.coast = 0;
    this.velocity.reset(now);
  }

  private updateGrab(now: number, dt = 0): void {
    const grab = this.grab;
    if (!grab) return;
    if (grab.entity && this.actions.turntable()?.entity !== grab.entity) {
      this.resetSceneGrab();
      return;
    }

    const missing = grab.inputs.filter((input) => !this.handDragPosition(input.source, input.sample));
    if (missing.length) {
      for (const input of missing) {
        if (!input.source.hand || now - (input.lostSince ??= now) >= trackingGraceMs) this.releaseGrab(input.source, false);
      }
      this.velocity.reset(now);
      return;
    }
    const reducedMotion = this.actions.reducedMotion();
    for (const input of grab.inputs) {
      input.lostSince = undefined;
      input.position.lerp(input.position, input.sample, input.source.hand && !reducedMotion ? damp(dt, 28) : 1);
    }
    this.sampleGrab(grab);
    const { mode, entity } = grab;
    let delta = 0;
    if (entity && mode === 'carry') {
      if (this.grabYaw !== null && grab.yaw !== null) {
        delta = wrapAngle(this.grabYaw - grab.yaw);
        const degrees = delta * pc.math.RAD_TO_DEG;
        this.rotation.setFromAxisAngle(pc.Vec3.UP, degrees).transformVector(grab.offset, grab.offset);
        if (delta) entity.rotate(0, degrees, 0);
      }
      this.anchoredPosition.add2(this.anchor, grab.offset);
      const height = clamp(this.anchoredPosition.y, 0.35, 1.80);
      if (height !== this.anchoredPosition.y) grab.offset.y = height - this.anchor.y;
      this.anchoredPosition.y = height;
      const snap = this.actions.snapSurface(entity, this.anchoredPosition, grab.surface?.id);
      if (snap && snap.surface.id !== grab.surface?.id) {
        for (const input of grab.inputs) this.pulse(input.source, 0.28, 20);
      }
      if (snap || grab.surface) this.actions.previewSurface(snap?.surface ?? null);
      grab.surface = snap?.surface;
      grab.snapY = snap?.y;
      const offset = snap ? snap.y - this.anchoredPosition.y : 0;
      grab.surfaceOffset = this.actions.reducedMotion() ? offset
        : pc.math.lerp(grab.surfaceOffset, offset, 1 - Math.exp(-24 * dt));
      this.anchoredPosition.y += grab.surfaceOffset;
      if (delta || !entity.getPosition().equals(this.anchoredPosition)) {
        entity.setPosition(this.anchoredPosition);
        this.actions.turntableMoved(grab.surface ?? null);
      }
    } else if (entity && mode !== 'tap') {
      if (mode === 'steer') {
        if (this.grabYaw !== null && grab.yaw !== null) delta = wrapAngle(this.grabYaw - grab.yaw);
      } else {
        const gain = grab.inputs[0].source.hand ? 4.6 : 3.8;
        delta = this.displacement.sub2(this.anchor, grab.previous).dot(this.spinAxis) * gain;
      }
      if (delta) this.actions.spin(delta);
    }
    if (mode !== 'tap') {
      this.velocity.add(delta, now);
      grab.tick += delta;
      if (Math.abs(grab.tick) >= tickAngle) {
        grab.tick %= tickAngle;
        for (const input of grab.inputs) this.pulse(input.source, 0.14, 10);
      }
    }
    grab.movement = Math.max(grab.movement, this.anchor.distance(grab.start));
    grab.previous.copy(this.anchor);
    grab.yaw = this.grabYaw;
  }

  private releaseGrab(source: pc.XrInputSource, deliberate: boolean): void {
    if (!this.grab?.inputs.some((input) => input.source === source)) return;
    const now = performance.now();
    const allowRelease = deliberate && this.interactive;
    if (allowRelease && !source.hand) this.updateGrab(now);
    const grab = this.grab;
    const released = grab?.inputs.find((input) => input.source === source);
    if (!grab || !released) return;
    grab.inputs = grab.inputs.filter((input) => input !== released);
    if (grab.inputs.length) {
      this.setGrabMode(grab, grab.inputs[0].mode);
      this.velocity.reset(now);
      return;
    }
    this.grab = null;
    if (grab.surface) this.actions.previewSurface(null);
    if (allowRelease && grab.entity && (grab.snapY !== undefined || grab.surfaceOffset !== 0)) {
      const { x, y, z } = grab.entity.getPosition();
      grab.entity.setPosition(x, grab.snapY ?? y - grab.surfaceOffset, z);
      if (grab.mode === 'carry') this.actions.turntableMoved(grab.surface ?? null);
    }
    if (!allowRelease) return;
    const tap = !grab.joined && released.kind === 'select' && (grab.mode === 'tap' || grab.mode === 'spin') &&
      now - grab.began < 250 && grab.movement < 0.025;
    if (tap) this.actions.selectEmpty();
    else if (grab.entity) {
      const velocity = this.velocity.release(now, source.hand ? handReleaseDelay : 0);
      this.coast = source.hand && Math.abs(velocity) < 0.55 ? 0 : velocity;
      this.coastRoot = grab.entity;
      this.coastCarry = grab.mode === 'carry';
    }
  }

  isTargetEngaged(target: HitTarget): boolean {
    for (const pointer of this.pointers.values()) {
      if (pointer.hover === target || pointer.contact === target) return true;
    }
    return false;
  }

  updateControls(dt: number, vr: boolean): boolean {
    if (!this.interactive) {
      this.resetGrip();
      return false;
    }
    const now = performance.now();
    for (const [source, pointer] of this.pointers) this.updateScenePinch(source, pointer, now);
    if (this.grab) this.updateGrab(now, dt);
    let turned = false;
    let movedRig = false;
    for (const [source, pointer] of this.pointers) {
      if (source.targetRayMode !== pc.XRTARGETRAY_POINTER || source.hand || !source.gamepad) continue;
      const { axes, buttons } = source.gamepad;
      const recenter = !!buttons[pc.XRPAD_B]?.pressed;
      if (recenter && !pointer.recenterHeld) this.actions.recenter();
      pointer.recenterHeld = recenter;
      const voice = !!buttons[pc.XRPAD_A]?.pressed;
      if (voice && !pointer.voiceHeld) this.actions.toggleVoice();
      pointer.voiceHeld = voice;
      const stick = axes.length >= 4 ? pc.XRPAD_STICK_X : 0;
      const x = axes[stick] ?? 0;
      const y = axes[stick + 1] ?? 0;
      if (source.handedness === pc.XRHAND_RIGHT) {
        if (Math.abs(x) <= 0.25) pointer.snapHeld = false;
        if (this.actions.turntable()) {
          const strength = clamp((Math.abs(x) - 0.16) / 0.84, 0, 1);
          if (strength && this.grab?.mode !== 'carry' && this.grab?.mode !== 'steer') {
            this.coast = 0;
            this.actions.spin(Math.sign(x) * 2 * strength ** 2 * dt);
          }
          continue;
        }
        if (!vr || !this.actions.canSnapTurn() || Math.abs(x) < 0.65 || pointer.snapHeld) continue;
        pointer.snapHeld = true;
        this.head.copy(this.camera.getPosition());
        this.rig.rotate(0, -Math.sign(x) * 30, 0);
        this.displacement.sub2(this.head, this.camera.getPosition());
        this.displacement.y = 0;
        this.rig.translate(this.displacement);
        turned = true;
        movedRig = true;
      } else if (vr && source.handedness === pc.XRHAND_LEFT) {
        const strength = Math.hypot(x, y);
        if (strength <= 0.18) continue;
        this.heading.copy(this.camera.forward);
        this.heading.y = 0;
        if (this.heading.lengthSq() < 0.0001) continue;
        this.heading.normalize();
        this.right.set(-this.heading.z, 0, this.heading.x);
        const speed = 1.2 * Math.min(dt, 0.05) * (Math.min(strength, 1) - 0.18) / (0.82 * strength);
        this.displacement.copy(this.right).mulScalar(x * speed).add(this.heading.mulScalar(-y * speed));
        this.rig.translate(this.displacement);
        movedRig = true;
      }
    }
    if (!this.grab && this.coast && this.coastRoot) {
      const entity = this.coastRoot;
      this.coast = this.actions.turntable()?.entity === entity ? coastTurntable(this.coast, dt, 3.6, (radians) => {
        if (this.coastCarry) {
          entity.rotate(0, radians * pc.math.RAD_TO_DEG, 0);
          this.actions.turntableMoved();
        } else this.actions.spin(radians);
      }) : 0;
    }
    if (movedRig && this.grab) {
      for (const input of this.grab.inputs) this.handDragPosition(input.source, input.position);
      this.rebaseGrab(this.grab, true);
    }
    return turned;
  }

  leftForearmPose(): ForearmPose | null {
    if (!this.interactive) return null;
    let controller: pc.XrInputSource | undefined;
    for (const source of this.pointers.keys()) {
      if (source.handedness !== pc.XRHAND_LEFT) continue;
      const hand = source.hand;
      const wrist = hand?.tracking ? hand.wrist : null;
      if (!wrist) {
        if (!hand && source.grip) controller = source;
        continue;
      }

      const wristPosition = wrist.getPosition();
      const wristRotation = wrist.getRotation();
      const middle = hand?.getJointById('middle-finger-phalanx-proximal');
      const direction = this.forearmDirection;
      const normal = wristRotation.transformVector(pc.Vec3.UP, this.forearmNormal);
      if (middle) direction.sub2(wristPosition, middle.getPosition()).normalize();
      if (!middle || direction.lengthSq() < 0.5 || Math.abs(direction.dot(normal)) > 0.95) {
        wristRotation.transformVector(pc.Vec3.BACK, direction);
      }
      // Project the back-of-wrist normal perpendicular to the forearm so the keys stay level across it.
      normal.addScaled(direction, -normal.dot(direction)).normalize();
      const up = this.forearmUp.cross(direction, normal);
      const pose = this.forearmPose;
      pose.kind = 'hand';
      pose.position.copy(wristPosition).addScaled(direction, 0.105).addScaled(normal, 0.038);
      pose.rotation.setFromMat4(this.forearmBasis.setLookAt(normal, pc.Vec3.ZERO, up));
      return pose;
    }
    const position = controller?.getPosition();
    const rotation = controller?.getRotation();
    if (!position || !rotation) return null;
    const pose = this.forearmPose;
    pose.kind = 'controller';
    rotation.transformVector(controllerForearmOffset, pose.position).add(position);
    pose.rotation.mul2(rotation, controllerDeckRotation);
    return pose;
  }

  updatePointers(): void {
    const targets = this.actions.targets();
    const menu = this.actions.menu();
    const pokeTargets = [...this.actions.reviews().flatMap(({ targets }) => targets), ...(menu?.targets ?? [])];
    const rightPokeTargets = [...this.actions.buttons, ...pokeTargets];
    const now = performance.now();
    const visible = this.interactive;
    this.trackedHands.clear();
    if (visible) {
      for (const source of this.pointers.keys()) {
        if (source.hand?.tracking) this.trackedHands.add(source.handedness);
      }
    }
    for (const [source, pointer] of this.pointers) {
      const hand = source.hand?.tracking && visible ? source.hand : null;
      pointer.root.enabled = visible;
      if (pointer.hand) pointer.hand.root.enabled = !!hand;
      if (hand && pointer.hand) this.updateHand(pointer.hand, hand);

      const position = source.getLocalPosition();
      const rotation = source.getLocalRotation();
      const hasGrip = source.grip && !!position && !!rotation;
      const showController = visible && hasGrip && !this.trackedHands.has(source.handedness);
      if (showController) {
        pointer.controller ??= this.makeController(source);
        pointer.controller.setLocalPosition(position);
        pointer.controller.setLocalRotation(rotation);
      }
      if (pointer.controller) pointer.controller.enabled = showController;

      const tip = hand?.getJointById('index-finger-tip');
      const contact = tip ? this.picker.nearPanel(tip.getPosition(), source.handedness === pc.XRHAND_RIGHT ? rightPokeTargets : pokeTargets,
        clamp(tip.radius + 0.003, 0.004, 0.012)) : null;
      const holding = this.isHolding(source);
      if (contact && !pointer.contact && !holding && now - pointer.lastPoke >= pokeDebounce) {
        pointer.lastPoke = now;
        pointer.lastPokeTarget = contact;
        pointer.flashUntil = now + 140;
        contact.action();
      }
      pointer.contact = contact;
      if (!visible || (source.hand && !hand) || this.handhelds.has(source)) {
        pointer.hover = null;
        if (pointer.beam) pointer.beam.enabled = false;
        if (pointer.dot) pointer.dot.enabled = false;
        continue;
      }
      if (!pointer.beam || !pointer.dot) continue;
      this.aim(source);
      const { control, prop, deck } = this.rayTargets(source, holding ? [] : targets);
      const touchedKey = !holding && !hand && this.handPosition(source, this.anchor) ? this.nearDeckKey(source, this.anchor) : null;
      const hover = holding ? null : touchedKey ?? control?.target ?? null;
      if (hover && hover !== pointer.hover) this.pulse(source, 0.25, 18);
      pointer.hover = hover;
      const point = control?.point ?? prop?.point ?? deck?.point;
      const flashing = now < pointer.flashUntil;
      pointer.beam.render!.meshInstances[0].material = flashing ? this.flash : point ? this.hovered : this.idle;
      this.end.copy(this.ray.direction).mulScalar(pointerRange).add(this.ray.origin);
      this.segment(pointer.beam, this.ray.origin, point ?? this.end, flashing ? 0.003 : 0.0018);
      pointer.dot.enabled = !!point;
      if (point) pointer.dot.setPosition(point);
    }
  }

  private updateHand(model: HandModel, hand: pc.XrHand): void {
    const thumb = hand.getJointById('thumb-tip');
    const index = hand.getJointById('index-finger-tip');
    const pinch = thumb && index ? thumb.getPosition().distance(index.getPosition()) : pinchRange;
    model.tips.emissiveIntensity = 0.18 + 1.25 * clamp(1 - pinch / pinchRange, 0, 1);
    for (const [joint, entity] of model.joints) {
      entity.setPosition(joint.getPosition());
      const diameter = 2 * joint.radius;
      entity.setLocalScale(diameter, diameter, diameter);
    }
    for (const { from, to, entity } of model.bones) {
      this.segment(entity, from.getPosition(), to.getPosition(), Math.min(from.radius, to.radius) * 1.45);
    }
  }

  destroy(): void {
    for (const event of this.events) event.off();
    this.clear();
    if (this.meshes) {
      for (const mesh of Object.values(this.meshes)) {
        mesh.decRefCount();
        mesh.destroy();
      }
    }
    for (const surface of [this.glove, this.grip, this.ring, this.trim, this.idle, this.hovered, this.flash]) surface.destroy();
  }
}
