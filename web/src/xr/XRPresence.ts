import * as pc from 'playcanvas';
import type { GrabbableDish } from './DishTableScene';
import { DishGrabMotion } from './DishPhysics';
import type { VRReviewCard } from './VRReviewCard';
import type { PhysicalMenuBook } from './PhysicalMenuBook';
import type { SurfaceMatch } from './PhysicalSurfaces';
import type { ForearmPose } from './forearmMount';
import { assetBase, brass, calloutAmber, child, clamp, coastTurntable, damp, handReleaseDelay, material, shape, TurnVelocity, wrapAngle,
  type HitTarget, type ModelLibrary, type PickBounds, type ScenePicker } from './sceneSupport';

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
interface HandModel {
  root: pc.Entity;
  visual: HandFallback | HandRig;
}

interface HandFallback {
  kind: 'fallback';
  root: pc.Entity;
  joints: Map<pc.XrJoint, pc.Entity>;
  bones: { from: pc.XrJoint; to: pc.XrJoint; entity: pc.Entity }[];
  surface: pc.StandardMaterial;
}

interface HandRig {
  kind: 'rig';
  root: pc.Entity;
  bones: pc.GraphNode[];
  wristBindPosition: pc.Vec3;
  inverseWristBindRotation: pc.Quat;
  surface: pc.StandardMaterial;
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
  selectConfirmed?: boolean;
  selectEndedAt?: number;
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
  motion?: DishGrabMotion;
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

function validJointPose(position: pc.Vec3, rotation: pc.Quat): boolean {
  const length = rotation.lengthSq();
  return Number.isFinite(position.lengthSq()) && Number.isFinite(length) && length > 0;
}

export class XRPresence {
  private pointers = new Map<pc.XrInputSource, Pointer>();
  private trackedHands = new Set<pc.XrInputSource['handedness']>();
  private events: pc.EventHandle[];
  private meshes: { sphere: pc.Mesh; cylinder: pc.Mesh } | undefined;
  private glove = material('#bab2a5', 0.10, 0.84);
  private grip = material('#292b30', 0.12);
  private trim = material('#15171a', 0.22);
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
  private forearmPose: ForearmPose = {
    kind: 'hand', wrist: new pc.Vec3(), direction: new pc.Vec3(), handCenter: new pc.Vec3(),
  };
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
    private camera: pc.Entity, private picker: ScenePicker, private models: ModelLibrary, private actions: PresenceActions,
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
    if (source.hand) pointer.hand = this.makeHand(root, source.hand, source);
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

  private makeHand(parent: pc.Entity, hand: pc.XrHand, source: pc.XrInputSource): HandModel {
    const root = child(parent, 'Tracked hand');
    root.enabled = false;
    const fallback = child(root, 'Tracked hand fallback');
    const tips = material(brass, 1);
    tips.emissiveIntensity = 0.18;
    const joints = new Map<pc.XrJoint, pc.Entity>();
    for (const joint of hand.joints) {
      const accented = joint.id === 'index-finger-tip' || joint.id === 'thumb-tip';
      joints.set(joint, this.primitive(fallback, joint.id, 'sphere', accented ? tips : this.glove));
    }
    const bones: HandFallback['bones'] = [];
    for (const finger of hand.fingers) {
      let previous = hand.wrist;
      for (const joint of finger.joints) {
        if (previous) {
          const entity = this.primitive(fallback, `${previous.id} to ${joint.id}`, 'cylinder', this.glove);
          bones.push({ from: previous, to: joint, entity });
        }
        previous = joint;
      }
    }
    const model: HandModel = { root, visual: { kind: 'fallback', root: fallback, joints, bones, surface: tips } };
    const { handedness } = source;
    if (handedness !== pc.XRHAND_LEFT && handedness !== pc.XRHAND_RIGHT) return model;
    void this.models.load(`${assetBase}vr-hand-${handedness}.glb`).then((resource) => {
      if (!resource || this.pointers.get(source)?.hand !== model) return;
      const rig = resource.instantiateRenderEntity();
      const instances = (rig.findComponents('render') as pc.RenderComponent[]).flatMap(({ meshInstances }) => meshInstances);
      const rigBones = [...new Set(instances.flatMap(({ skinInstance }) => skinInstance?.bones ?? []))];
      const wrist = rigBones.find(({ name }) => name === 'wrist');
      if (!wrist) {
        rig.destroy();
        return;
      }

      const surface = material('#c2b5a2');
      surface.useMetalness = true;
      surface.glossInvert = true;
      surface.gloss = 0.47;
      surface.clearCoat = 0.16;
      surface.clearCoatGloss = 0.53;
      surface.emissive.fromString('#cc874e');
      surface.emissiveIntensity = 0.06;
      surface.update();
      for (const instance of instances) {
        instance.material = surface;
        instance.cull = false;
      }
      model.visual = {
        kind: 'rig', root: rig, bones: rigBones.filter((bone) => bone !== wrist), surface,
        wristBindPosition: wrist.getPosition().clone(),
        inverseWristBindRotation: wrist.getRotation().clone().invert(),
      };
      rig.enabled = false;
      root.addChild(rig);
      fallback.destroy();
      tips.destroy();
    });
    return model;
  }

  private makeController(source: pc.XrInputSource): pc.Entity {
    const root = child(this.rig, `XR ${source.handedness} controller`);
    const handedness = source.handedness === pc.XRHAND_LEFT ? 'left' : 'right';
    const fallback = child(root, 'Touch Plus fallback');
    shape(fallback, 'Angled grip', 'cylinder', this.grip, [0, -0.023, 0.022], [0.036, 0.079, 0.037])
      .setLocalEulerAngles(-54, 0, handedness === 'left' ? -8 : 8);
    shape(fallback, 'Oval face', 'cylinder', this.grip, [0, 0.004, -0.025], [0.055, 0.016, 0.048]);
    shape(fallback, 'Thumbstick', 'cylinder', this.trim, [0, 0.016, -0.025], [0.013, 0.009, 0.013]);
    void this.models.load(`${assetBase}vr-controller-${handedness}.glb`).then((resource) => {
      if (!resource || this.pointers.get(source)?.controller !== root) return;
      root.addChild(resource.instantiateRenderEntity());
      fallback.destroy();
    });
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
    pointer.hand?.visual.surface.destroy();
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
    const clipboardAndDishBounds = [...reviews.flatMap(({ gripBounds }) => gripBounds), ...dishes.map(({ bounds }) => bounds)];
    const prop = this.picker.raycast(this.ray, [...clipboardAndDishBounds, ...(menu?.gripBounds ?? [])], pointerRange);
    const usesDeck = source.handedness === pc.XRHAND_RIGHT;
    const deck = usesDeck ? this.picker.raycast(this.ray, [this.actions.deck], pointerRange) : null;
    const eligible = grip && menu ? targets.filter((target) => !menu.targets.includes(target)) : targets;
    const hit = this.picker.raycast(this.ray, usesDeck ? [...this.actions.buttons, ...eligible] : eligible, pointerRange);
    const review = hit && reviews.find(({ targets }) => targets.includes(hit.target));
    const menuRow = hit && menu?.targets.includes(hit.target);
    const blocker = menuRow ? this.picker.raycast(this.ray, clipboardAndDishBounds, pointerRange) : prop;
    const control = hit && (this.actions.buttons.includes(hit.target) || !deck || hit.distance < deck.distance) &&
      (!blocker || hit.distance <= blocker.distance || (review && blocker.target.entity === review.entity)) ? hit : null;
    const handheld = prop && (!deck || prop.distance < deck.distance) ? this.handheldTarget(prop.target, menu, dishes) : null;
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
    if (pointer.selectEndedAt !== undefined) this.finishSelect(source, pointer, false);
    pointer.selectConfirmed = false;
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
      if (prop) {
        pointer.selectConsumed = true;
        this.beginHandheld(source, 'select', prop);
        return;
      }
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
    if (pointer) pointer.selectConfirmed = true;
    if (this.interactive && pointer?.scenePinch && (!source.hand || source.hand.tracking)) {
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
    if (!pointer) return;
    if (source.hand && !source.hand.tracking) {
      pointer.selectEndedAt ??= performance.now();
      return;
    }
    this.finishSelect(source, pointer, !!pointer.selectConfirmed);
  }

  private finishSelect(source: pc.XrInputSource, pointer: Pointer, deliberate: boolean): void {
    pointer.selectEndedAt = undefined;
    pointer.selectConfirmed = false;
    this.clearScenePinch(pointer);
    if (this.handhelds.get(source)?.kind === 'select') this.releaseHandheld(source, deliberate);
    if (this.grab?.inputs.some((input) => input.source === source && input.kind === 'select')) this.releaseGrab(source, deliberate);
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
    if (prop) { this.beginHandheld(source, 'grip', prop); return; }
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
    for (const held of this.handhelds.values()) if (held.entity === entity) return false;
    const inverse = this.handOrientation.invert();
    const offset = entity.getPosition().clone().sub(this.anchor);
    const rotation = new pc.Quat().mul2(inverse, entity.getRotation());
    const reach = !target.direct && offset.length() > inspectionDistance ? { from: offset.clone(), elapsed: 0 } : undefined;
    if (reach) offset.copy(inspectionOffset);
    else inverse.transformVector(offset, offset);
    target.dish?.setHeld(true);
    target.menu?.markMoved();
    const motion = target.dish ? new DishGrabMotion(target.dish.centerOffset) : undefined;
    motion?.reset(entity.getPosition(), entity.getRotation());
    this.handhelds.set(source, { ...target, kind, offset, rotation, reach, menuVenue: target.menu?.venueId,
      position: entity.getPosition().clone(), orientation: entity.getRotation().clone(), motion });
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
    if (reach) grab.motion?.reset(grab.position, grab.orientation);
    else if (dt > 0) grab.motion?.sample(grab.position, grab.orientation);
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

    const { entity, dish, menu, motion } = grab;
    const at = entity.getPosition();
    const surface = (dish || menu) && this.actions.snapSurface(entity, at);
    motion?.release();
    const settling = menu ? menu.release(this.actions.menuTabletop(menu, at), surface?.y)
      : dish?.onRelease(surface ? surface.surface : undefined, motion?.velocity, motion?.angularVelocity);
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
    for (const [source, pointer] of this.pointers) {
      if (pointer.selectEndedAt !== undefined) {
        const expired = now - pointer.selectEndedAt >= trackingGraceMs;
        if (expired || source.hand?.tracking) this.finishSelect(source, pointer, !expired && !!pointer.selectConfirmed);
      }
      this.updateScenePinch(source, pointer, now);
    }
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

      const pose = this.forearmPose;
      pose.kind = 'hand';
      pose.wrist.copy(wrist.getPosition());
      const middle = hand?.getJointById('middle-finger-phalanx-proximal') ??
        hand?.getJointById('middle-finger-metacarpal');
      if (middle) pose.direction.sub2(pose.wrist, middle.getPosition());
      if (!middle || pose.direction.lengthSq() < 1e-8) {
        wrist.getRotation().transformVector(pc.Vec3.BACK, pose.direction);
      }
      pose.direction.normalize();
      pose.handCenter.copy(pose.wrist).addScaled(pose.direction, -0.060);
      return pose;
    }
    const position = controller?.getPosition();
    const rotation = controller?.getRotation();
    if (!position || !rotation) return null;
    const pose = this.forearmPose;
    pose.kind = 'controller';
    rotation.transformVector(pc.Vec3.BACK, pose.direction).normalize();
    // The grip drives placement while the estimated wrist starts the forearm capsule.
    pose.wrist.copy(position).addScaled(pose.direction, 0.045);
    pose.handCenter.copy(position);
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
    const { visual } = model;
    const thumb = hand.getJointById('thumb-tip');
    const index = hand.getJointById('index-finger-tip');
    const pinch = thumb && index ? thumb.getPosition().distance(index.getPosition()) : pinchRange;
    const closure = Number.isFinite(pinch) ? clamp(1 - pinch / pinchRange, 0, 1) : 0;
    if (visual.kind === 'rig') {
      const wrist = hand.wrist;
      if (!wrist) { visual.root.enabled = false; return; }
      const wristPosition = wrist.getPosition();
      const wristRotation = wrist.getRotation();
      visual.root.enabled = validJointPose(wristPosition, wristRotation);
      if (!visual.root.enabled) return;

      // The GLB joints are siblings. Anchor the last valid local pose of any missing joint to the wrist.
      this.rotation.mul2(wristRotation, visual.inverseWristBindRotation);
      this.rotation.transformVector(visual.wristBindPosition, this.middle);
      visual.root.setPositionAndRotation(this.middle.mulScalar(-1).add(wristPosition), this.rotation);
      for (const bone of visual.bones) {
        const joint = hand.getJointById(bone.name);
        if (!joint) continue;
        const position = joint.getPosition();
        const rotation = joint.getRotation();
        if (validJointPose(position, rotation)) bone.setPositionAndRotation(position, rotation);
      }
      visual.surface.emissiveIntensity = 0.06 + 0.30 * closure;
      return;
    }

    visual.surface.emissiveIntensity = 0.18 + 1.25 * closure;
    for (const [joint, entity] of visual.joints) {
      entity.setPosition(joint.getPosition());
      const diameter = 2 * joint.radius;
      entity.setLocalScale(diameter, diameter, diameter);
    }
    for (const { from, to, entity } of visual.bones) {
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
    for (const surface of [this.glove, this.grip, this.trim, this.idle, this.hovered, this.flash]) surface.destroy();
  }
}
