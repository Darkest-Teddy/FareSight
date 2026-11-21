import * as pc from 'playcanvas';
import type { JarvisReveal } from './JarvisReveal';
import { assetBase, brass, calloutAmber, child, damp, ivory, material, pickBounds, shape, target, wrapAngle,
  type HitTarget, type ModelLibrary, type PickBounds, type XYZ } from './sceneSupport';

interface PanelLine {
  text: string;
  color?: string;
  size?: number;
  weight?: number;
  wrap?: boolean;
  badge?: boolean;
}

const paper = '#f4ecdc';
const ink = '#221b15';
const bronze = '#80603a';
const slate = '#1c222d';

export class CanvasSurface {
  readonly canvas = document.createElement('canvas');
  readonly texture: pc.Texture;
  readonly material: pc.StandardMaterial;
  private context: CanvasRenderingContext2D;
  private lastKey?: string;

  constructor(device: pc.GraphicsDevice, width: number, height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('3D panels require a 2D canvas context');
    this.context = context;
    this.texture = new pc.Texture(device, {
      name: 'FareSight canvas surface',
      width, height, format: pc.PIXELFORMAT_SRGBA8, flipY: false,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, mipmaps: true,
    });
    this.texture.setSource(this.canvas);
    this.material = new pc.StandardMaterial();
    this.material.useLighting = false;
    this.material.useSkybox = false;
    this.material.diffuse.set(0, 0, 0);
    this.material.emissive.set(1, 1, 1);
    this.material.emissiveMap = this.texture;
    this.material.update();
  }

  draw(key: string, paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): void {
    if (key === this.lastKey) return;
    this.lastKey = key;
    const { width, height } = this.canvas;
    this.context.clearRect(0, 0, width, height);
    paint(this.context, width, height);
    this.texture.upload();
  }

  destroy(): void {
    this.material.destroy();
    this.texture.destroy();
  }
}

export function modelNode(model: pc.Entity, name: string): pc.Entity | null {
  const node = model.findByName(name);
  return node instanceof pc.Entity ? node : null;
}

export function bindFace(node: pc.Entity | null, surface: CanvasSurface): node is pc.Entity {
  const instances = node?.findComponents('render').flatMap((render) => render.meshInstances);
  if (!instances?.length) return false;
  for (const mesh of instances) mesh.material = surface.material;
  return true;
}

export function facePlane(parent: pc.Entity, name: string, surface: CanvasSurface, position: XYZ, width: number, height: number): pc.Entity {
  const plane = shape(parent, name, 'plane', surface.material, position, [width, 1, height]);
  plane.setLocalEulerAngles(90, 0, 0);
  return plane;
}

export function chamferedHousing(device: pc.GraphicsDevice, parent: pc.Entity, name: string, surface: pc.Material,
  position: XYZ, [width, height, depth]: XYZ, bevel: number): pc.Entity {
  const outline = (inset: number, z: number): XYZ[] => {
    const x = width / 2 - inset;
    const y = height / 2 - inset;
    const corner = bevel - inset / 2;
    return [
      [-x + corner, -y, z], [x - corner, -y, z], [x, -y + corner, z], [x, y - corner, z],
      [x - corner, y, z], [-x + corner, y, z], [-x, y - corner, z], [-x, -y + corner, z],
    ];
  };
  const rings = [
    outline(bevel, -depth / 2), outline(0, -depth / 2 + bevel),
    outline(0, depth / 2 - bevel), outline(bevel, depth / 2),
  ];
  const positions: number[] = [];
  const indices: number[] = [];
  const polygon = (vertices: XYZ[]): void => {
    const first = positions.length / 3;
    for (const vertex of vertices) positions.push(...vertex);
    for (let i = 1; i < vertices.length - 1; i++) indices.push(first, first + i, first + i + 1);
  };
  polygon([...rings[0]].reverse());
  polygon(rings[3]);
  for (let ring = 0; ring < 3; ring++) {
    for (let i = 0; i < 8; i++) {
      const next = (i + 1) % 8;
      polygon([rings[ring][i], rings[ring][next], rings[ring + 1][next], rings[ring + 1][i]]);
    }
  }
  const geometry = new pc.Geometry();
  geometry.positions = positions;
  geometry.indices = indices;
  geometry.calculateNormals();
  const entity = child(parent, name, position);
  const mesh = pc.Mesh.fromGeometry(device, geometry);
  entity.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, surface, entity)] });
  return entity;
}

const plaqueFaces = { flag: 'Pin_Plate', station: 'Station_Plate', menu: 'Menu_Card', room: 'Plaque_Face' } as const;
const faceHeights = { flag: 0.058, station: 0.064, menu: 0.070, room: 0 };
type PlaqueKind = keyof typeof plaqueFaces;
type PlaqueMaterial = { surface: pc.StandardMaterial; color: pc.Color };

export class PhysicalPlaque {
  readonly entity: pc.Entity;
  readonly faceHeight: number;
  private surface: CanvasSurface;
  private fallback?: pc.Entity;
  private fallbackMaterials: pc.StandardMaterial[];
  private housingMaterials: PlaqueMaterial[] = [];
  private pickFace: pc.Entity;
  private muted = 0;
  private yawReady = false;
  private yaw = 0;

  constructor(
    device: pc.GraphicsDevice, parent: pc.Entity, name: string,
    readonly width: number, readonly height: number, private kind: PlaqueKind,
    model: Promise<pc.ContainerResource | null>, reveal: JarvisReveal, position?: XYZ,
  ) {
    this.entity = child(parent, name, position);
    this.faceHeight = faceHeights[kind];
    this.pickFace = child(this.entity, 'Plaque hit area');
    this.surface = new CanvasSurface(device, 1024, Math.max(128, Math.round(1024 * height / width)));

    const fallback = this.fallback = child(this.entity, 'Procedural plaque');
    const frame = material(kind === 'menu' || kind === 'room' ? '#61432e' : brass);
    const trim = material(kind === 'flag' ? '#544537' : '#a58a5f');
    this.fallbackMaterials = [frame, trim];
    if (kind === 'flag') this.housingMaterials = this.fallbackMaterials.map((surface) => ({ surface, color: surface.diffuse.clone() }));
    const centerY = this.faceHeight;
    const body = child(fallback, 'Framed face', [0, centerY, 0]);
    if (kind === 'menu') {
      body.setLocalEulerAngles(-12, 0, 0);
      chamferedHousing(device, fallback, 'Walnut foot', frame, [0, 0.008, -0.014], [width, 0.016, 0.073], 0.004);
    }
    if (kind === 'flag' || kind === 'station') {
      const collarHeight = centerY - height / 2 + 0.003;
      shape(fallback, 'Swivel collar', 'cylinder', trim, [0, collarHeight / 2, 0], [0.016, collarHeight, 0.016]);
    }
    chamferedHousing(device, body, 'Chamfered housing', frame, [0, 0, 0], [width, height, 0.021], 0.005);
    chamferedHousing(device, body, 'Face surround', trim, [0, 0, 0.009], [width * 0.96, height * 0.92, 0.010], 0.002);
    facePlane(body, plaqueFaces[kind], this.surface, [0, 0, 0.0142], width * 0.91, height * 0.84);
    this.pickFace.setLocalPosition(0, centerY, 0.009);

    void model.then((resource) => {
      if (!resource || !this.fallback) return;
      const loaded = resource.instantiateRenderEntity();
      const face = modelNode(loaded, plaqueFaces[kind]);
      if (!bindFace(face, this.surface)) {
        loaded.destroy();
        return;
      }
      if (kind === 'room') loaded.setLocalScale(width / 0.60, height / 0.36, 1);
      this.entity.addChild(loaded);
      this.placeHitArea(face);
      this.dropFallback();
      if (kind === 'flag') this.bindHousing(loaded);
      reveal.refresh(this.entity);
    });
  }

  private placeHitArea(face: pc.Entity): void {
    const instances = face.findComponents('render').flatMap((render) => render.meshInstances);
    const bounds = instances[0].aabb.clone();
    for (const mesh of instances.slice(1)) bounds.add(mesh.aabb);
    // A disabled scene still receives its model. Use mesh transforms rather than pick state.
    const local = new pc.Mat4().invert(this.entity.getWorldTransform()).transformPoint(bounds.center);
    this.pickFace.setLocalPosition(local);
  }

  private dropFallback(): void {
    if (!this.fallback) return;
    this.fallback.destroy();
    this.fallback = undefined;
    for (const surface of this.fallbackMaterials) surface.destroy();
    this.fallbackMaterials = [];
    this.housingMaterials = [];
  }

  private bindHousing(model: pc.Entity): void {
    const cloned = new Map<pc.StandardMaterial, pc.StandardMaterial>();
    for (const render of model.findComponents('render')) {
      for (const mesh of render.meshInstances) {
        const original = mesh.material;
        if (!(original instanceof pc.StandardMaterial) || original === this.surface.material) continue;
        let surface = cloned.get(original);
        if (!surface) {
          surface = original.clone();
          cloned.set(original, surface);
          this.housingMaterials.push({ surface, color: original.diffuse.clone() });
        }
        mesh.material = surface;
      }
    }
    this.applyTint();
  }

  setMuted(amount: number): void {
    if (this.muted === amount) return;
    this.muted = amount;
    this.applyTint();
  }

  private applyTint(): void {
    const pewter = new pc.Color().fromString('#787d83');
    for (const { surface, color } of this.housingMaterials) {
      surface.diffuse.lerp(color, pewter, this.muted);
      surface.update();
    }
    this.surface.material.emissiveIntensity = pc.math.lerp(1, 0.62, this.muted);
    this.surface.material.update();
  }

  setText(lines: PanelLine[], image?: HTMLImageElement): void {
    const key = JSON.stringify([lines, image?.src]);
    this.surface.draw(key, (ctx, width, height) => {
      const padding = Math.min(50, height * 0.11);
      const imageHeight = image ? Math.round(height * 0.76) : 0;
      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, width, height);
      if (image) {
        const scale = Math.max((width - 2 * padding) / image.naturalWidth, imageHeight / image.naturalHeight);
        const w = image.naturalWidth * scale;
        const h = image.naturalHeight * scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(padding, padding / 2, width - 2 * padding, imageHeight - padding / 2);
        ctx.clip();
        ctx.drawImage(image, (width - w) / 2, (imageHeight - h) / 2, w, h);
        ctx.restore();
      }
      ctx.strokeStyle = bronze;
      ctx.lineWidth = 3;
      const inset = padding / 2;
      ctx.strokeRect(inset, inset, width - padding, height - padding);
      const availableWidth = width - padding * 2;
      let y = image ? imageHeight + padding / 2 : padding;
      const availableHeight = height - y - padding;
      const nominalHeight = lines.reduce((sum, line) => sum + (line.size ?? 60) * (line.wrap ? 2.22 : 1.24), 0);
      const scale = Math.min(1, availableHeight / nominalHeight);
      for (const [index, line] of lines.entries()) {
        const size = (line.size ?? 60) * scale;
        const family = index === 0 ? 'Georgia, serif' : 'system-ui, sans-serif';
        ctx.font = `${line.weight ?? 600} ${size}px ${family}`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = line.color ?? ink;
        const words = line.wrap ? line.text.split(/\s+/) : [];
        let row = line.text;
        if (words.length) {
          row = '';
          for (const [wordIndex, word] of words.entries()) {
            const next = row ? `${row} ${word}` : word;
            if (row && ctx.measureText(next).width > availableWidth) {
              ctx.fillText(row, padding, y, availableWidth);
              y += size * 1.04;
              row = words.slice(wordIndex).join(' ');
              break;
            }
            row = next;
          }
        }
        if (line.badge) {
          const badgeWidth = Math.min(availableWidth, ctx.measureText(row).width + 20);
          ctx.strokeStyle = brass;
          ctx.lineWidth = 2;
          ctx.strokeRect(padding, y, badgeWidth, size * 1.12);
          ctx.fillText(row, padding + 10, y + size * 0.06, badgeWidth - 20);
        } else ctx.fillText(row, padding, y, availableWidth);
        y += size * 1.24;
      }
    });
  }

  setCallout(name: string, detail: string, options: { category?: string; lineColor?: string; selected?: boolean } = {}): void {
    const { category, lineColor, selected } = options;
    this.surface.draw(JSON.stringify([name, detail, category, lineColor, selected]), (ctx, width, height) => {
      const padding = width * 0.046;
      const contentWidth = width - padding * 2;
      ctx.fillStyle = slate;
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = selected ? ivory : brass;
      ctx.lineWidth = 4;
      ctx.strokeRect(12, 12, width - 24, height - 24);
      if (lineColor) {
        ctx.fillStyle = lineColor;
        ctx.fillRect(16, 16, 18, height - 32);
      }

      ctx.textBaseline = 'middle';
      ctx.fillStyle = ivory;
      ctx.font = `700 ${height * 0.31}px system-ui, sans-serif`;
      ctx.fillText(name, padding, height * 0.34, contentWidth);

      const baseline = height * 0.73;
      ctx.font = `600 ${height * 0.21}px system-ui, sans-serif`;
      if (category) {
        const badgeWidth = Math.min(contentWidth * 0.62, ctx.measureText(detail).width + 32);
        ctx.fillStyle = '#3c3024';
        ctx.fillRect(padding, baseline - height * 0.13, badgeWidth, height * 0.26);
        ctx.fillStyle = calloutAmber;
        ctx.fillText(detail, padding + 16, baseline, badgeWidth - 32);

        ctx.fillStyle = ivory;
        ctx.textAlign = 'right';
        ctx.fillText(category, width - padding, baseline, contentWidth - badgeWidth - 24);
        ctx.textAlign = 'left';
      } else {
        ctx.fillStyle = selected ? ivory : brass;
        ctx.fillText(detail, padding, baseline, contentWidth);
      }
    });
  }

  hit(action: () => void): HitTarget {
    return target(this.pickFace, [this.width, this.height, 0.028], action);
  }

  faceYaw(camera: pc.Entity, dt: number): void {
    const from = this.entity.getPosition();
    const to = camera.getPosition();
    if (Math.hypot(to.x - from.x, to.z - from.z) < 0.001) return;
    const yaw = Math.atan2(to.x - from.x, to.z - from.z);
    this.yaw = this.yawReady ? this.yaw + wrapAngle(yaw - this.yaw) * damp(dt, 16) : yaw;
    this.yawReady = true;
    this.entity.setEulerAngles(0, this.yaw * pc.math.RAD_TO_DEG, 0);
  }

  destroy(): void {
    this.dropFallback();
    this.entity.destroy();
    for (const { surface } of this.housingMaterials) surface.destroy();
    this.housingMaterials = [];
    this.surface.destroy();
  }
}

const keySize: XYZ = [0.094, 0.038, 0.024];
type KeyName = 'Map' | 'Station' | 'Back' | 'Recenter' | 'Table' | 'Debug';

interface KeyMotion {
  entity: pc.Entity;
  rest: pc.Vec3;
  inward: pc.Vec3;
}

interface DeckKey {
  name: KeyName;
  surface: CanvasSurface;
  hit: HitTarget;
  motion: KeyMotion[];
  travel: number;
  velocity: number;
  pressedUntil: number;
}

function keyMotion(body: pc.Entity, face: pc.Entity): KeyMotion[] {
  return (face.isDescendantOf(body) ? [body] : [body, face]).map((entity) => ({
    entity,
    rest: entity.getLocalPosition().clone(),
    inward: entity.getLocalRotation().transformVector(pc.Vec3.FORWARD),
  }));
}

export class XRActionBar {
  readonly entity: pc.Entity;
  readonly targets: HitTarget[];
  readonly gripBounds: PickBounds;
  private keys: DeckKey[];
  private status: CanvasSurface;
  private fallback?: pc.Entity;
  private fallbackMaterials: pc.StandardMaterial[];
  private showDebug = false;
  private ar = false;
  private virtual = false;
  private placement = '';
  private mode = 'map';
  private fps = 0;
  private position = new pc.Vec3();
  private destination = new pc.Vec3();
  private heading = new pc.Vec3();
  private keyPosition = new pc.Vec3();
  private dockBlend = 0;
  private held = false;
  private pinned = false;
  private palmTime = 0;
  private palmConsumed = false;
  private gripFlashUntil = 0;
  private docked = false;
  private facing = new pc.Quat();
  private facingTilt = new pc.Quat();
  private facingMatrix = new pc.Mat4();

  constructor(
    device: pc.GraphicsDevice, parent: pc.Entity, models: ModelLibrary, private reveal: JarvisReveal,
    actions: { map: () => void; station: () => void; back: () => void; virtualTable: () => void; recenter: () => void },
  ) {
    this.entity = child(parent, 'XR control deck');
    this.entity.enabled = false;
    this.gripBounds = pickBounds(this.entity, [0.362, 0.172, 0.064], [0, 0, -0.010]);
    const fallback = this.fallback = child(this.entity, 'Procedural control deck');
    const housing = material('#44413b');
    const bezel = material(brass);
    const keycap = material(ivory);
    this.fallbackMaterials = [housing, bezel, keycap];
    chamferedHousing(device, fallback, 'Cast alloy case', housing, [0, 0, -0.02], [0.348, 0.172, 0.041], 0.010);
    chamferedHousing(device, fallback, 'LCD bezel', bezel, [0, 0.052, 0.002], [0.312, 0.045, 0.010], 0.003);
    this.status = new CanvasSurface(device, 768, 80);
    facePlane(fallback, 'Deck_Status', this.status, [0, 0.052, 0.0072], 0.302, 0.034);

    const buttons: [KeyName, () => void][] = [
      ['Map', actions.map], ['Station', actions.station], ['Back', actions.back], ['Recenter', actions.recenter],
      ['Table', actions.virtualTable], ['Debug', () => { this.showDebug = !this.showDebug; }],
    ];
    this.keys = buttons.map(([name, action], i) => {
      const x = (i % 3 - 1) * 0.104;
      const y = 0.004 - Math.floor(i / 3) * 0.046;
      const surface = new CanvasSurface(device, 320, 110);
      const body = chamferedHousing(device, fallback, `KeyBody_${name}`, keycap, [x, y, 0.006], keySize, 0.004);
      const face = facePlane(fallback, `KeyFace_${name}`, surface, [x, y, 0.0182], 0.083, 0.028);
      const key: DeckKey = {
        name, surface, motion: keyMotion(body, face), travel: 0, velocity: 0, pressedUntil: 0,
        hit: target(body, keySize, () => {
          key.pressedUntil = performance.now() + 135;
          action();
        }),
      };
      return key;
    });
    this.targets = this.keys.map((key) => key.hit);
    this.setState(false, false, '', 'map');

    void models.load(`${assetBase}vr-control-deck.glb`).then((resource) => {
      if (!resource || !this.fallback) return;
      const model = resource.instantiateRenderEntity();
      if (!bindFace(modelNode(model, 'Deck_Status'), this.status)) {
        model.destroy();
        return;
      }
      const bindings = [];
      for (const key of this.keys) {
        const body = modelNode(model, `KeyBody_${key.name}`);
        const face = modelNode(model, `KeyFace_${key.name}`);
        if (!body || !bindFace(face, key.surface)) {
          model.destroy();
          return;
        }
        bindings.push({ key, body, face });
      }
      this.entity.addChild(model);
      for (const { key, body, face } of bindings) {
        key.motion = keyMotion(body, face);
        key.travel = 0;
        key.velocity = 0;
        key.hit.entity = body;
        const mesh = body.render?.meshInstances[0]?.mesh;
        if (mesh) key.hit.center = mesh.aabb.center.clone();
      }
      this.dropFallback();
      this.setState(this.ar, this.virtual, this.placement, this.mode);
      this.reveal.refresh(this.entity, 0.65);
    });
  }

  setState(ar: boolean, virtual: boolean, placement: string, mode: string): void {
    this.ar = ar;
    this.virtual = virtual;
    this.placement = placement;
    this.mode = mode;
    const table = this.keys[4];
    table.hit.enabled = ar;
    this.drawStatus();
  }

  setFps(fps: number): void {
    this.fps = fps;
    if (this.showDebug) this.drawStatus();
  }

  setHeld(held: boolean): void {
    this.held = held;
    this.pinned = true;
    this.palmTime = 0;
    this.gripFlashUntil = performance.now() + 135;
  }

  recenter(): void {
    this.held = false;
    this.pinned = false;
    this.palmConsumed = true;
    this.palmTime = 0;
    this.gripFlashUntil = 0;
    this.dockBlend = 0;
    this.docked = false;
  }

  setVisible(visible: boolean): void {
    if (visible && !this.entity.enabled) this.reveal.show(this.entity, 0.65);
    else if (!visible) this.reveal.finish(this.entity, false);
  }

  private drawStatus(): void {
    const text = (this.placement || this.mode).toUpperCase();
    const fps = this.showDebug ? `${this.fps} FPS` : '';
    const carried = this.held || performance.now() < this.gripFlashUntil;
    this.status.draw(JSON.stringify([text, fps, carried]), (ctx, w, h) => {
      ctx.fillStyle = '#4c6055';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#d6e6d5';
      ctx.font = '700 33px monospace';
      ctx.textBaseline = 'middle';
      const reserved = fps ? ctx.measureText(fps).width + 38 : 0;
      ctx.fillText(text, 20, h / 2, w - 40 - reserved);
      if (fps) ctx.fillText(fps, w - reserved, h / 2);
      if (carried) {
        ctx.fillStyle = '#e0b66f';
        ctx.fillRect(0, h - 4, w, 4);
      }
    });
  }

  update(camera: pc.Entity, dt: number, wrist: pc.Vec3 | null, snap: boolean, engaged: (target: HitTarget) => boolean): void {
    if (!wrist) {
      this.palmTime = 0;
      this.palmConsumed = false;
    } else if (this.held) {
      this.palmConsumed = true;
    } else if (this.pinned && !this.palmConsumed) {
      this.palmTime += Math.min(dt, 0.05);
      if (this.palmTime >= 0.22) this.pinned = false;
    }
    const dock = this.palmConsumed ? null : wrist;
    const docked = !!dock && !this.pinned;
    if (docked && !this.docked && this.entity.enabled) this.reveal.show(this.entity, 0.65);
    this.docked = docked;
    if (!this.pinned) {
      const blend = snap ? 1 : damp(dt, dock ? 13 : 7);
      this.dockBlend = pc.math.lerp(this.dockBlend, dock ? 1 : 0, blend);
      this.heading.copy(camera.forward);
      this.heading.y = 0;
      if (this.heading.lengthSq() < 0.0001) this.heading.copy(pc.Vec3.FORWARD);
      this.destination.copy(this.heading.normalize()).mulScalar(0.72).add(camera.getPosition());
      this.destination.y -= 0.36;
      if (dock) {
        this.destination.set(
          dock.x - this.heading.z * 0.09 + this.heading.x * 0.06,
          dock.y + 0.10,
          dock.z + this.heading.x * 0.09 + this.heading.z * 0.06,
        );
      }
      this.position.lerp(this.entity.getPosition(), this.destination, blend);
      this.entity.setPosition(this.position);
    }
    if (!this.pinned || this.held) {
      const from = this.entity.getPosition();
      const to = camera.getPosition();
      if (from.distanceSq(to) > 0.0025) {
        const up = Math.hypot(from.x - to.x, from.z - to.z) > 0.01 ? pc.Vec3.UP : pc.Vec3.FORWARD;
        this.facing.setFromMat4(this.facingMatrix.setLookAt(from, to, up))
          .mul(this.facingTilt.setFromEulerAngles(pc.math.lerp(-9, -4, this.dockBlend), 180, 0));
        if (this.held) this.facing.slerp(this.entity.getRotation(), this.facing, damp(dt, 12));
        this.entity.setRotation(this.facing);
      }
    }

    const now = performance.now();
    for (const key of this.keys) {
      const disabled = key.name === 'Table' && !this.ar;
      const pressed = !disabled && (engaged(key.hit) || now < key.pressedUntil);
      const active = key.name.toLowerCase() === this.mode || (key.name === 'Debug' && this.showDebug);
      const label = key.name === 'Table' ? (this.virtual && this.ar ? 'PASS' : 'VIRTUAL') : key.name.toUpperCase();
      const finish = disabled ? '#a9a297' : pressed || active ? '#efb762' : '#efe4ce';
      key.surface.draw(`${label}:${finish}`, (ctx, w, h) => {
        ctx.fillStyle = finish;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = '#302a24';
        ctx.font = '700 46px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, w / 2, h / 2, w - 24);
      });
      const destination = pressed ? 0.0045 : 0;
      const offset = key.travel - destination;
      const omega = 36;
      const decay = Math.exp(-omega * dt);
      const spring = key.velocity + omega * offset;
      const travel = destination + (offset + spring * dt) * decay;
      key.velocity = (key.velocity - omega * spring * dt) * decay;
      if (travel === key.travel) continue;
      key.travel = travel;
      for (const { entity, rest: position, inward } of key.motion) {
        entity.setLocalPosition(this.keyPosition.copy(position).addScaled(inward, key.travel));
      }
    }
  }

  private dropFallback(): void {
    this.fallback?.destroy();
    this.fallback = undefined;
    for (const surface of this.fallbackMaterials) surface.destroy();
    this.fallbackMaterials = [];
  }

  destroy(): void {
    this.dropFallback();
    this.entity.destroy();
    this.status.destroy();
    for (const key of this.keys) key.surface.destroy();
  }
}
