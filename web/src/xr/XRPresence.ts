import * as pc from 'playcanvas';
import { brass, calloutAmber, child, clamp, material, shape, type HitResult, type HitTarget, type ScenePicker } from './sceneSupport';

const pointerRange = 4.5;
const pokeRadius = 0.025;
const pokeDebounce = 400;
const pinchRange = 0.035;

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
  selectStarted: boolean;
  snapHeld: boolean;
  recenterHeld: boolean;
}

interface PresenceActions {
  targets: () => readonly HitTarget[];
  buttons: readonly HitTarget[];
  selectEmpty: () => void;
  recenter: () => void;
  spin: (radians: number) => void;
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
  private held: pc.XrInputSource | null = null;
  private hasGripSample = false;
  private localFromWorld = new pc.Mat4();
  private inverseRigRotation = new pc.Quat();
  private gripPosition = new pc.Vec3();
  private gripRotation = new pc.Quat();
  private lastGripPosition = new pc.Vec3();
  private lastGripRotation = new pc.Quat();

  constructor(
    private xr: pc.XrManager, private root: pc.Entity, private rig: pc.Entity,
    private camera: pc.Entity, private picker: ScenePicker, private actions: PresenceActions,
  ) {
    const input = xr.input;
    this.events = [
      input.on('add', this.add, this), input.on('remove', this.remove, this),
      input.on('selectstart', this.selectStart, this), input.on('select', this.select, this),
      input.on('selectend', this.selectEnd, this),
      input.on('squeezestart', this.squeezeStart, this), input.on('squeeze', this.squeeze, this),
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
      selectStarted: false, snapHeld: false, recenterHeld: false,
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
    this.squeezeEnd(source);
    pointer.root.destroy();
    pointer.hand?.tips.destroy();
    pointer.controller?.destroy();
    this.pointers.delete(source);
  }

  private clear(): void {
    for (const source of this.pointers.keys()) this.remove(source);
  }

  private get interactive(): boolean {
    return this.xr.active && this.xr.visibilityState !== 'hidden' && this.xr.visibilityState !== 'visible-blurred';
  }

  private pulse(source: pc.XrInputSource, intensity: number, duration: number): void {
    const gamepad: HapticGamepad | null = source.gamepad;
    void gamepad?.hapticActuators?.[0]?.pulse(intensity, duration).catch(() => {});
  }

  private selectStart(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (!this.interactive || !pointer) return;
    pointer.selectStarted = true;
    pointer.flashUntil = performance.now() + 140;
    this.pulse(source, 0.65, 35);
  }

  private select(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (!this.interactive || (source.hand && !source.hand.tracking)) return;
    if (!pointer?.selectStarted) this.selectStart(source);
    if (pointer) pointer.flashUntil = performance.now() + 140;
    const hit = this.hit(source, this.actions.targets());
    if (hit) {
      // A pinch near a button can follow a physical poke on the same gesture.
      if (pointer?.contact !== hit.target && (!pointer || performance.now() - pointer.lastPoke >= pokeDebounce)) {
        hit.target.action();
      }
    } else if (!pointer || performance.now() - pointer.lastPoke >= pokeDebounce) {
      this.actions.selectEmpty();
    }
    this.selectEnd(source);
  }

  private selectEnd(source: pc.XrInputSource): void {
    const pointer = this.pointers.get(source);
    if (pointer) pointer.selectStarted = false;
  }

  private hit(source: pc.XrInputSource, targets: readonly HitTarget[]): HitResult | null {
    this.ray.origin.copy(source.getOrigin());
    this.ray.direction.copy(source.getDirection()).normalize();
    return this.picker.raycast(this.ray, targets, pointerRange);
  }

  private squeezeStart(source: pc.XrInputSource): void {
    if (!this.interactive || this.held || source.targetRayMode !== pc.XRTARGETRAY_POINTER) return;
    this.held = source;
    this.hasGripSample = false;
    this.updateGrip();
  }

  private squeeze(source: pc.XrInputSource): void {
    if (this.interactive && this.held === source) this.updateGrip();
  }

  private squeezeEnd(source: pc.XrInputSource): void {
    if (this.held === source) {
      this.held = null;
      this.hasGripSample = false;
    }
  }

  resetGrip(): void { this.hasGripSample = false; }

  private updateGrip(): void {
    const source = this.held;
    if (!source) return;
    const wrist = source.hand?.tracking ? source.hand.wrist : null;
    const position = source.getLocalPosition();
    const rotation = source.getLocalRotation();
    if (wrist) {
      this.localFromWorld.invert(this.rig.getWorldTransform()).transformPoint(wrist.getPosition(), this.gripPosition);
      this.inverseRigRotation.invert(this.rig.getRotation());
      this.gripRotation.mul2(this.inverseRigRotation, wrist.getRotation());
    } else if (source.grip && position && rotation && source.getLinearVelocity()) {
      this.gripPosition.copy(position);
      this.gripRotation.copy(rotation);
    } else {
      this.hasGripSample = false;
      return;
    }
    if (this.hasGripSample) {
      this.rotation.invert(this.lastGripRotation);
      this.rotation.mul2(this.gripRotation, this.rotation);
      const yaw = 2 * Math.atan2(this.rotation.y, this.rotation.w);
      const twist = Math.atan2(Math.sin(yaw), Math.cos(yaw));
      this.displacement.sub2(this.gripPosition, this.lastGripPosition);
      this.camera.getLocalRotation().transformVector(pc.Vec3.FORWARD, this.heading);
      this.right.set(-this.heading.z, 0, this.heading.x).normalize();
      const drag = this.displacement.dot(this.right) * 4;
      if (this.displacement.lengthSq() < 0.04) this.actions.spin(clamp(twist + drag, -0.3, 0.3));
    }
    this.lastGripPosition.copy(this.gripPosition);
    this.lastGripRotation.copy(this.gripRotation);
    this.hasGripSample = true;
  }

  updateControls(dt: number, vr: boolean): boolean {
    if (!this.interactive) {
      this.resetGrip();
      return false;
    }
    this.updateGrip();
    let turned = false;
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
      }
    }
    return turned;
  }

  leftPalmWrist(): pc.Vec3 | null {
    if (!this.interactive) return null;
    for (const source of this.pointers.keys()) {
      const hand = source.hand;
      if (source.handedness !== pc.XRHAND_LEFT || !hand?.tracking || !hand.wrist) continue;
      const index = hand.getJointById('index-finger-phalanx-proximal');
      const pinky = hand.getJointById('pinky-finger-phalanx-proximal');
      if (!index || !pinky) continue;
      const wrist = hand.wrist.getPosition();
      this.wristToIndex.sub2(index.getPosition(), wrist);
      this.wristToPinky.sub2(pinky.getPosition(), wrist);
      this.palmNormal.cross(this.wristToIndex, this.wristToPinky).normalize();
      this.toHead.sub2(this.camera.getPosition(), wrist).normalize();
      if (this.palmNormal.dot(this.toHead) > 0.55) return wrist;
    }
    return null;
  }

  updatePointers(): void {
    const targets = this.actions.targets();
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
      const contact = tip ? this.picker.nearPanel(tip.getPosition(), this.actions.buttons, pokeRadius) : null;
      if (contact && !pointer.contact && now - pointer.lastPoke >= pokeDebounce) {
        pointer.lastPoke = now;
        pointer.flashUntil = now + 140;
        contact.action();
      }
      pointer.contact = contact;
      if (!visible || (source.hand && !hand) || (source.grip && !hasGrip)) {
        pointer.hover = null;
        pointer.selectStarted = false;
        if (pointer.beam) pointer.beam.enabled = false;
        if (pointer.dot) pointer.dot.enabled = false;
        continue;
      }
      if (!pointer.beam || !pointer.dot) continue;
      const hit = this.hit(source, targets);
      if (hit && hit.target !== pointer.hover) this.pulse(source, 0.25, 18);
      pointer.hover = hit?.target ?? null;
      const flashing = now < pointer.flashUntil;
      pointer.beam.render!.meshInstances[0].material = flashing ? this.flash : hit ? this.hovered : this.idle;
      this.end.copy(this.ray.direction).mulScalar(pointerRange).add(this.ray.origin);
      this.segment(pointer.beam, this.ray.origin, hit?.point ?? this.end, flashing ? 0.003 : 0.0018);
      pointer.dot.enabled = !!hit;
      if (hit) pointer.dot.setPosition(hit.point);
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
