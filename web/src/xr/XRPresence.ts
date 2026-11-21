import * as pc from 'playcanvas';
import type { PhysicalMenuBook } from './PhysicalMenuBook';
import { brass, calloutAmber, child, clamp, coastTurntable, material, shape, smooth, TurnVelocity, wrapAngle,
  type HitTarget, type PickBounds, type ScenePicker } from './sceneSupport';

const pointerRange = 4.5;
const pokeDebounce = 400;
const pinchRange = 0.035;
const tickAngle = Math.PI / 12;
const physicalReach = 0.30;

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
  flashUntil: number;
  selectConsumed: boolean;
  selectTarget: HitTarget | null;
  snapHeld: boolean;
  recenterHeld: boolean;
}

interface PresenceActions {
  targets: () => readonly HitTarget[];
  buttons: readonly HitTarget[];
  selectEmpty: () => void;
  recenter: () => void;
  deck: PickBounds;
  holdDeck: (held: boolean) => void;
  menu: () => PhysicalMenuBook | undefined;
  turntable: () => PickBounds | null;
  turntableMoved: () => void;
  spin: (radians: number) => void;
}

interface GrabInput {
  source: pc.XrInputSource;
  kind: 'grip' | 'pinch';
}

interface Grab {
  inputs: GrabInput[];
  mode: 'deck' | 'book' | 'carry' | 'spin' | 'tap';
  entity: pc.Entity | null;
  began: number;
  start: pc.Vec3;
  previous: pc.Vec3;
  offset: pc.Vec3;
  yaw: number | null;
  movement: number;
  tick: number;
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
  private palmNormal = new pc.Vec3();
  private wristToIndex = new pc.Vec3();
  private wristToPinky = new pc.Vec3();
  private toHead = new pc.Vec3();
  private grab: Grab | null = null;
  private anchor = new pc.Vec3();
  private secondHand = new pc.Vec3();
  private anchoredPosition = new pc.Vec3();
  private grabYaw: number | null = null;
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
      root, hover: null, contact: null, lastPoke: -Infinity, flashUntil: -Infinity,
      selectConsumed: false, selectTarget: null, snapHeld: false, recenterHeld: false,
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

  private selectStart(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (!this.interactive || !pointer) return;
    pointer.selectConsumed = this.isHolding(source);
    pointer.selectTarget = null;
    if (pointer.selectConsumed) return;
    if (source.hand?.tracking && this.handPosition(source, this.anchor)) {
      this.aim(source);
      const hit = this.picker.raycast(this.ray, this.actions.targets(), pointerRange);
      const key = this.picker.nearPanel(this.anchor, this.actions.buttons, 0.016, true);
      const menu = this.actions.menu();
      const row = menu && this.picker.nearPanel(this.anchor, menu.targets, 0.016);
      const aimedKey = this.picker.raycast(this.ray, this.actions.buttons, pointerRange, true);
      const deck = this.picker.raycast(this.ray, [this.actions.deck], pointerRange);
      const touchesDeck = this.picker.nearPanel(this.anchor, [this.actions.deck], 0.025);
      const aimsAtDeck = deck && (!hit || deck.distance <= hit.distance + 0.003);
      if (!key && !row && (touchesDeck || (aimsAtDeck && !aimedKey))) {
        pointer.selectConsumed = true;
        this.beginGrab(source, 'pinch', 'deck', this.actions.deck.entity);
        return;
      }
      if (menu && !key && !row) {
        const book = this.picker.raycast(this.ray, menu.gripBounds, pointerRange);
        const aimedAtRow = hit && menu.targets.includes(hit.target);
        if (this.picker.nearPanel(this.anchor, menu.gripBounds, 0.025) ||
          (book && !aimedAtRow && (!hit || book.distance < hit.distance))) {
          pointer.selectConsumed = true;
          this.beginGrab(source, 'pinch', 'book', menu.entity);
          return;
        }
      }
      pointer.selectTarget = key ?? row ?? (aimedKey && aimsAtDeck ? aimedKey.target : hit?.target) ?? null;
      if (!pointer.selectTarget) {
        const turntable = this.actions.turntable();
        const near = turntable && this.picker.nearPanel(this.anchor, [turntable], physicalReach);
        pointer.selectConsumed = true;
        this.beginGrab(source, 'pinch', near ? 'carry' : turntable ? 'spin' : 'tap', turntable?.entity ?? null);
        return;
      }
    }
    pointer.flashUntil = performance.now() + 140;
    this.pulse(source, 0.65, 35);
  }

  private select(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (!this.interactive || pointer?.selectConsumed || this.isHolding(source) ||
      (source.hand && !source.hand.tracking)) return;
    if (pointer) pointer.flashUntil = performance.now() + 140;
    this.aim(source);
    const hit = this.picker.raycast(this.ray, this.actions.targets(), pointerRange);
    const deck = this.picker.raycast(this.ray, [this.actions.deck], pointerRange);
    const picked = source.hand ? pointer?.selectTarget : hit?.target;
    // Chassis occludes scene controls behind it, but the keys sit on its face.
    const onDeck = picked && this.actions.buttons.includes(picked);
    const directlyTouched = picked && source.hand && this.handPosition(source, this.anchor) &&
      (onDeck || this.actions.menu()?.targets.includes(picked)) &&
      this.picker.nearPanel(this.anchor, [picked], 0.018);
    if (picked && picked.enabled !== false && picked.entity.enabled &&
      (directlyTouched || (hit?.target === picked && (onDeck || !deck || deck.distance > hit.distance)))) {
      if (pointer?.contact !== picked && (!pointer || performance.now() - pointer.lastPoke >= pokeDebounce)) {
        picked.action();
      }
    } else if (!picked && !deck && !source.hand) {
      this.actions.selectEmpty();
    }
  }

  private selectEnd(source: pc.XrInputSource): void {
    if (this.grab?.inputs.some((input) => input.source === source && input.kind === 'pinch')) this.releaseGrab(source, true);
  }

  private squeezeStart(source: pc.XrInputSource): void {
    if (!this.interactive || source.hand || source.targetRayMode !== pc.XRTARGETRAY_POINTER ||
      !this.handPosition(source, this.anchor)) return;
    this.aim(source);
    const deck = this.picker.raycast(this.ray, [this.actions.deck], pointerRange);
    const menu = this.actions.menu();
    const book = menu && this.picker.raycast(this.ray, menu.gripBounds, pointerRange);
    const turntable = this.actions.turntable();
    const model = turntable && this.picker.raycast(this.ray, [turntable], pointerRange);
    const touchesDeck = this.picker.nearPanel(this.anchor, [this.actions.deck], 0.04);
    const touchesBook = menu && this.picker.nearPanel(this.anchor, menu.gripBounds, 0.035) &&
      !this.picker.nearPanel(this.anchor, menu.targets, 0.015);
    if (touchesDeck || (!touchesBook && deck && (!model || deck.distance <= model.distance) &&
      (!book || deck.distance <= book.distance))) {
      this.beginGrab(source, 'grip', 'deck', this.actions.deck.entity);
    } else if (menu && (touchesBook || (book && (!model || book.distance < model.distance)))) {
      if (touchesBook || !this.picker.raycast(this.ray, menu.targets, pointerRange)) {
        this.beginGrab(source, 'grip', 'book', menu.entity);
      }
    } else if (turntable) {
      this.beginGrab(source, 'grip', 'carry', turntable.entity);
    }
  }

  private squeezeEnd(source: pc.XrInputSource): void {
    if (this.grab?.inputs.some((input) => input.source === source && input.kind === 'grip')) this.releaseGrab(source, true);
  }

  resetGrip(): void {
    if (this.grab?.mode === 'deck') this.actions.holdDeck(false);
    this.grab = null;
    this.coast = 0;
    this.coastRoot = null;
  }

  private isHolding(source: pc.XrInputSource): boolean {
    return this.grab?.inputs.some((input) => input.source === source) ?? false;
  }

  private handPosition(source: pc.XrInputSource, out: pc.Vec3): boolean {
    const hand = source.hand;
    if (!hand) {
      const position = source.getLinearVelocity() && source.getPosition();
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

  private sampleGrab(grab: Grab): boolean {
    const [first, second] = grab.inputs;
    if (!this.handPosition(first.source, this.anchor)) return false;
    this.grabYaw = null;
    if (second) {
      if (!this.handPosition(second.source, this.secondHand)) return false;
      const x = this.secondHand.x - this.anchor.x;
      const z = this.secondHand.z - this.anchor.z;
      if (Math.hypot(x, z) >= 0.08) this.grabYaw = Math.atan2(x, z);
      this.anchor.lerp(this.anchor, this.secondHand, 0.5);
    } else if (grab.mode === 'carry') {
      const source = first.source;
      const wrist = source.hand?.wrist;
      const knuckle = source.hand?.getJointById('middle-finger-phalanx-proximal');
      this.heading.set(0, 0, 0);
      if (wrist && knuckle) {
        this.heading.sub2(knuckle.getPosition(), wrist.getPosition()).normalize();
      } else {
        const rotation = wrist ? wrist.getRotation() : source.getRotation();
        rotation?.transformVector(pc.Vec3.FORWARD, this.heading);
      }
      if (Math.hypot(this.heading.x, this.heading.z) >= 0.20) this.grabYaw = Math.atan2(-this.heading.x, -this.heading.z);
    }
    return true;
  }

  private rebaseGrab(grab: Grab, preserveMovement = false): boolean {
    if (!this.sampleGrab(grab)) return false;
    if (preserveMovement) grab.start.add(this.displacement.sub2(this.anchor, grab.previous));
    grab.previous.copy(this.anchor);
    grab.yaw = this.grabYaw;
    if (grab.entity && (grab.mode === 'carry' || grab.mode === 'deck' || grab.mode === 'book')) {
      grab.offset.sub2(grab.entity.getPosition(), this.anchor);
    }
    return true;
  }

  private beginGrab(source: pc.XrInputSource, kind: GrabInput['kind'], mode: Grab['mode'], entity: pc.Entity | null): void {
    if (this.isHolding(source)) return;
    const now = performance.now();
    if (this.grab) {
      const current = this.grab;
      if (current.mode !== 'carry' || mode !== 'carry' || current.entity !== entity || current.inputs.length !== 1) return;
      this.updateGrab(now);
      if (this.grab !== current) return;
      current.inputs.push({ source, kind });
      if (!this.rebaseGrab(current)) {
        current.inputs.pop();
        return;
      }
      const pointer = this.pointers.get(source);
      if (pointer) pointer.selectConsumed = true;
      this.velocity.reset(now);
      return;
    }
    const grab: Grab = {
      inputs: [{ source, kind }], mode, entity, began: now,
      start: new pc.Vec3(), previous: new pc.Vec3(), offset: new pc.Vec3(),
      yaw: null, movement: 0, tick: 0,
    };
    if (!this.rebaseGrab(grab)) return;
    grab.start.copy(grab.previous);
    this.grab = grab;
    const pointer = this.pointers.get(source);
    if (pointer) pointer.selectConsumed = true;
    this.coast = 0;
    this.velocity.reset(now);
    if (mode === 'deck') {
      this.actions.holdDeck(true);
    }
    if (mode === 'deck' || mode === 'book') this.pulse(source, 0.22, 18);
  }

  private spinDelta(position: pc.Vec3, previous: pc.Vec3, center: pc.Vec3): number {
    const x = position.x - center.x;
    const z = position.z - center.z;
    const prevX = previous.x - center.x;
    const prevZ = previous.z - center.z;
    const radius = Math.hypot(x, z);
    const prevRadius = Math.hypot(prevX, prevZ);
    const polar = wrapAngle(Math.atan2(x, z) - Math.atan2(prevX, prevZ));
    this.right.copy(this.camera.right);
    this.right.y = 0;
    this.right.normalize();
    const projected = this.displacement.sub2(position, previous).dot(this.right) / Math.max(0.32, position.distance(center));
    const nearPivot = smooth((Math.min(radius, prevRadius) - 0.04) / 0.04);
    const elevation = Math.max(Math.abs(position.y - center.y), Math.abs(previous.y - center.y));
    const remote = smooth((Math.max(radius, prevRadius, elevation * 2.5) - 0.95) / 0.4);
    return pc.math.lerp(projected, polar, nearPivot * (1 - remote));
  }

  private updateGrab(now: number): void {
    const grab = this.grab;
    if (!grab) return;
    if ((grab.mode === 'carry' || grab.mode === 'spin') && this.actions.turntable()?.entity !== grab.entity) {
      this.resetGrip();
      return;
    }
    if (grab.mode === 'book' && this.actions.menu()?.entity !== grab.entity) {
      this.resetGrip();
      return;
    }
    if (!this.sampleGrab(grab)) {
      const lost = grab.inputs.find(({ source }) => !this.handPosition(source, this.secondHand));
      if (lost) this.releaseGrab(lost.source, false);
      return;
    }
    const { mode, entity } = grab;
    let delta = 0;
    if (entity && (mode === 'carry' || mode === 'deck' || mode === 'book')) {
      if (mode === 'carry' && this.grabYaw !== null && grab.yaw !== null) {
        delta = wrapAngle(this.grabYaw - grab.yaw);
        const degrees = delta * pc.math.RAD_TO_DEG;
        this.rotation.setFromAxisAngle(pc.Vec3.UP, degrees).transformVector(grab.offset, grab.offset);
        if (delta) entity.rotate(0, degrees, 0);
      }
      this.anchoredPosition.add2(this.anchor, grab.offset);
      if (mode === 'carry') {
        const height = clamp(this.anchoredPosition.y, 0.35, 1.80);
        if (height !== this.anchoredPosition.y) grab.offset.y = height - this.anchor.y;
        this.anchoredPosition.y = height;
      }
      if (delta || !entity.getPosition().equals(this.anchoredPosition)) {
        entity.setPosition(this.anchoredPosition);
        if (mode === 'carry') this.actions.turntableMoved();
        if (mode === 'book') this.actions.menu()?.markMoved();
      }
    } else if (entity && mode === 'spin') {
      delta = this.spinDelta(this.anchor, grab.previous, entity.getPosition());
      if (delta) this.actions.spin(delta);
    }
    if (mode === 'spin' || mode === 'carry') {
      this.velocity.add(delta, now);
      grab.tick += delta;
      if (Math.abs(grab.tick) >= tickAngle) {
        grab.tick %= tickAngle;
        for (const input of grab.inputs) if (input.kind === 'grip') this.pulse(input.source, 0.14, 10);
      }
    }
    grab.movement = Math.max(grab.movement, this.anchor.distance(grab.start));
    grab.previous.copy(this.anchor);
    grab.yaw = this.grabYaw;
  }

  private releaseGrab(source: pc.XrInputSource, deliberate: boolean): void {
    if (!this.isHolding(source)) return;
    const now = performance.now();
    const allowRelease = deliberate && this.interactive;
    if (allowRelease) this.updateGrab(now);
    const grab = this.grab;
    if (!grab || !this.isHolding(source)) return;
    grab.inputs = grab.inputs.filter((input) => input.source !== source);
    if (grab.inputs.length && this.rebaseGrab(grab)) {
      if (!allowRelease) this.velocity.reset(now);
      return;
    }
    this.grab = null;
    if (grab.mode === 'deck' || grab.mode === 'book') {
      if (grab.mode === 'deck') this.actions.holdDeck(false);
      if (allowRelease) this.pulse(source, 0.22, 18);
    } else if (allowRelease) {
      if (grab.mode === 'tap' && now - grab.began < 250 && grab.movement < 0.025) {
        this.actions.selectEmpty();
      } else if (grab.entity) {
        this.coast = this.velocity.release(now);
        this.coastRoot = grab.entity;
        this.coastCarry = grab.mode === 'carry';
      }
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
    if (this.grab) this.updateGrab(now);
    else if (this.coast && this.coastRoot) {
      const entity = this.coastRoot;
      this.coast = this.actions.turntable()?.entity === entity ? coastTurntable(this.coast, dt, 3.6, (radians) => {
        if (this.coastCarry) {
          entity.rotate(0, radians * pc.math.RAD_TO_DEG, 0);
          this.actions.turntableMoved();
        } else this.actions.spin(radians);
      }) : 0;
    }
    let turned = false;
    let movedRig = false;
    for (const [source, pointer] of this.pointers) {
      if (source.targetRayMode !== pc.XRTARGETRAY_POINTER || source.hand || !source.gamepad) continue;
      const { axes, buttons } = source.gamepad;
      const recenter = !!buttons[pc.XRPAD_B]?.pressed;
      if (recenter && !pointer.recenterHeld) this.actions.recenter();
      pointer.recenterHeld = recenter;
      if (!vr) continue;
      const stick = axes.length >= 4 ? pc.XRPAD_STICK_X : 0;
      const x = axes[stick] ?? 0;
      const y = axes[stick + 1] ?? 0;
      if (source.handedness === pc.XRHAND_RIGHT) {
        if (Math.abs(x) <= 0.25) pointer.snapHeld = false;
        if (Math.abs(x) < 0.65 || pointer.snapHeld) continue;
        pointer.snapHeld = true;
        this.head.copy(this.camera.getPosition());
        this.rig.rotate(0, -Math.sign(x) * 30, 0);
        this.displacement.sub2(this.head, this.camera.getPosition());
        this.displacement.y = 0;
        this.rig.translate(this.displacement);
        turned = true;
        movedRig = true;
      } else if (source.handedness === pc.XRHAND_LEFT) {
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
    if (movedRig && this.grab) this.rebaseGrab(this.grab, true);
    return turned;
  }

  leftPalmWrist(): pc.Vec3 | null {
    if (!this.interactive) return null;
    for (const source of this.pointers.keys()) {
      const hand = source.hand;
      if (source.handedness !== pc.XRHAND_LEFT || !hand?.tracking || !hand.wrist) continue;
      if (this.grab?.mode === 'carry' && this.isHolding(source)) continue;
      const index = hand.getJointById('index-finger-phalanx-proximal');
      const pinky = hand.getJointById('pinky-finger-phalanx-proximal');
      if (!index || !pinky) continue;
      const wrist = hand.wrist.getPosition();
      this.wristToIndex.sub2(index.getPosition(), wrist);
      this.wristToPinky.sub2(pinky.getPosition(), wrist);
      this.palmNormal.cross(this.wristToIndex, this.wristToPinky).normalize();
      this.toHead.sub2(this.camera.getPosition(), wrist).normalize();
      if (this.palmNormal.dot(this.toHead) > 0.78 && this.camera.forward.dot(this.toHead) < -0.30) return wrist;
    }
    return null;
  }

  updatePointers(): void {
    const targets = this.actions.targets();
    const menu = this.actions.menu();
    const pokeTargets = menu ? [...this.actions.buttons, ...menu.targets] : this.actions.buttons;
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
      const hasGrip = source.grip && !!position && !!rotation && !!source.getLinearVelocity();
      const showController = visible && hasGrip && !this.trackedHands.has(source.handedness);
      if (showController) {
        pointer.controller ??= this.makeController(source);
        pointer.controller.setLocalPosition(position);
        pointer.controller.setLocalRotation(rotation);
      }
      if (pointer.controller) pointer.controller.enabled = showController;

      const tip = hand?.getJointById('index-finger-tip');
      const contact = tip ? this.picker.nearPanel(tip.getPosition(), pokeTargets, clamp(tip.radius + 0.003, 0.004, 0.012)) : null;
      const holding = this.isHolding(source);
      if (contact && !pointer.contact && !holding && now - pointer.lastPoke >= pokeDebounce) {
        pointer.lastPoke = now;
        pointer.flashUntil = now + 140;
        contact.action();
      }
      pointer.contact = contact;
      if (!visible || (source.hand && !hand) || (source.grip && !hasGrip)) {
        pointer.hover = null;
        if (pointer.beam) pointer.beam.enabled = false;
        if (pointer.dot) pointer.dot.enabled = false;
        continue;
      }
      if (!pointer.beam || !pointer.dot) continue;
      this.aim(source);
      const hit = holding ? null : this.picker.raycast(this.ray, targets, pointerRange);
      const deck = this.picker.raycast(this.ray, [this.actions.deck], pointerRange);
      const ui = hit && (!deck || this.actions.buttons.includes(hit.target) || hit.distance < deck.distance) ? hit : null;
      if (ui && ui.target !== pointer.hover) this.pulse(source, 0.25, 18);
      pointer.hover = ui?.target ?? null;
      const point = ui?.point ?? deck?.point;
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
