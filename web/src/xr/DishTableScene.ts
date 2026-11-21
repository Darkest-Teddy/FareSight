import * as pc from 'playcanvas';
import type { XRAssetData, XRDishData, XRManifestData } from './bridgeTypes';
import { CanvasPanel3D } from './CanvasPanel3D';
import type { SplatLoader } from './SplatLoader';
import { amber, assetBase, child, clamp, cyan, damp, material, shape, type ModelLibrary, type XYZ } from './sceneSupport';

interface DishSetting {
  root: pc.Entity;
  pivot: pc.Entity;
  plate: pc.Entity;
  ring: pc.Entity;
  panel: CanvasPanel3D;
  center: number;
}

export class DishTableScene {
  readonly root: pc.Entity;
  private table: pc.Entity;
  private top: pc.Entity;
  private primary: DishSetting;
  private secondary: DishSetting;
  private surfaceMaterials: pc.StandardMaterial[];
  private ringMesh: pc.Mesh;
  private revision = 0;
  private angle = 0;
  private currentAngle = 0;
  private primaryUrl?: string;
  private alive = true;

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, models: ModelLibrary, private splats: SplatLoader,
  ) {
    this.root = child(parent, 'Dish table');
    this.table = child(this.root, 'Virtual table');
    this.top = child(this.root, 'Table surface contents');
    const finish = material('#253d55', 0.18);
    finish.metalness = 0.24;
    finish.gloss = 0.72;
    finish.useMetalness = true;
    finish.update();
    const footing = material('#314153', 0.12);
    const trim = material('#3c8ca6', 0.25);
    const porcelain = material('#adbdc9', 0.07);
    const ruler = material(cyan, 0.30, 0.78);
    this.surfaceMaterials = [finish, footing, trim, porcelain, ruler];
    this.ringMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({
      ringRadius: 0.5, tubeRadius: 0.006, segments: 64, sides: 6,
    }));
    const fallback = child(this.table, 'Virtual table fallback');
    shape(fallback, 'Tabletop', 'cylinder', finish, [0, -0.024, 0], [0.9, 0.048, 0.9]);
    shape(fallback, 'Cyan rim', 'cylinder', trim, [0, -0.045, 0], [0.903, 0.006, 0.903]);
    shape(fallback, 'Pedestal', 'cylinder', footing, [0, -0.36, 0], [0.18, 0.66, 0.18]);
    shape(fallback, 'Foot', 'cylinder', footing, [0, -0.69, 0], [0.55, 0.034, 0.55]);
    this.primary = this.makeSetting('Primary dish', porcelain, ruler);
    this.secondary = this.makeSetting('Comparison dish', porcelain, ruler);

    void models.load(`${assetBase}table-pedestal.glb`).then((resource) => {
      if (!resource || !this.alive) return;
      this.table.addChild(resource.instantiateRenderEntity());
      fallback.enabled = false;
    });
  }

  private makeSetting(name: string, porcelain: pc.Material, ruler: pc.Material): DishSetting {
    const root = child(this.top, name);
    const pivot = child(root, 'Dish turntable');
    const plate = shape(root, 'Plate outline', 'cylinder', porcelain, [0, 0.005, 0], [0.24, 0.01, 0.24]);
    const ring = child(root, 'Scale ruler ring', [0, 0.003, 0]);
    ring.addComponent('render', { meshInstances: [new pc.MeshInstance(this.ringMesh, ruler, ring)] });
    const panel = new CanvasPanel3D(this.device, root, 'Dish details', 0.29, 0.115, [0, 0.143, -0.16]);
    root.enabled = false;
    return { root, pivot, plate, ring, panel, center: 0 };
  }

  async open(
    dish: XRDishData, compare: XRDishData | null, manifest: XRManifestData | null, backgroundReady: Promise<void>,
  ): Promise<void> {
    const revision = ++this.revision;
    const assetFor = (item: XRDishData): XRAssetData | null =>
      manifest?.menu_items.find(({ dish }) => dish.id === item.id)?.dish_asset ?? item.asset ?? null;
    const asset = assetFor(dish);
    if (this.primaryUrl !== asset?.url) this.splats.clear('compare');
    this.primaryUrl = asset?.url;
    this.primary.root.enabled = true;
    this.primary.center = compare ? -0.19 : 0;
    this.configure(this.primary, dish, asset);
    const primaryReady = this.splats.show('dish', asset, this.primary.pivot).then((ready) => {
      if (revision === this.revision) this.drawDish(this.primary, dish, asset, ready);
    });
    if (compare) {
      const comparison = assetFor(compare);
      const wasEnabled = this.secondary.root.enabled;
      this.secondary.root.enabled = true;
      this.secondary.center = 0.19;
      if (!wasEnabled) this.secondary.root.setLocalPosition(0, 0, 0);
      this.configure(this.secondary, compare, comparison);
      await Promise.all([primaryReady, backgroundReady]);
      if (revision !== this.revision) return;
      const ready = await this.splats.show('compare', comparison, this.secondary.pivot);
      if (revision === this.revision) this.drawDish(this.secondary, compare, comparison, ready);
    } else {
      this.secondary.root.enabled = false;
      this.splats.clear('compare');
      await primaryReady;
    }
  }

  private configure(setting: DishSetting, dish: XRDishData, asset: XRAssetData | null): void {
    const diameter = asset?.plate_diameter_m ?? dish.plate_diameter_m ?? 0.24;
    const size = Number.isFinite(diameter) && diameter > 0 ? diameter : 0.24;
    setting.plate.setLocalScale(size, 0.01, size);
    setting.ring.setLocalScale(size + 0.024, size + 0.024, size + 0.024);
    this.drawDish(setting, dish, asset);
  }

  private drawDish(setting: DishSetting, dish: XRDishData, asset: XRAssetData | null, ready?: boolean): void {
    setting.plate.enabled = !ready;
    const actual = asset?.scale_status === 'measured' && ready;
    const tint = actual ? cyan : amber;
    const diameter = asset?.plate_diameter_m ?? dish.plate_diameter_m;
    const size = actual
      ? `Actual size${diameter ? ` · ${Math.round(diameter * 100)} cm` : ''}`
      : ready === false ? '3D preview unavailable' : ready === undefined ? 'Loading 3D preview' : 'Approximate size';
    setting.panel.setText([
      { text: `${dish.name} · $${dish.price.toFixed(2)}`, size: 77, weight: 750 },
      { text: dish.portion_note, size: 54, wrap: true, color: '#cfdfed' },
      { text: ready && !actual ? 'Approximate size' : size, color: tint, size: 53 },
    ], tint);
  }

  setPresentation(virtualTable: boolean, showContents: boolean): void {
    this.table.enabled = virtualTable;
    this.top.enabled = showContents;
  }

  setPose(position: XYZ, yaw = 0): void {
    this.root.setPosition(...position);
    this.root.setEulerAngles(0, yaw, 0);
  }

  setRotation(radians: number): void {
    if (Number.isFinite(radians)) this.angle = radians;
  }

  drag(radians: number): void {
    this.angle += radians;
  }

  update(dt: number, camera: pc.Entity): void {
    const delta = Math.atan2(Math.sin(this.angle - this.currentAngle), Math.cos(this.angle - this.currentAngle));
    this.currentAngle += delta * damp(dt, 12);
    const degrees = this.currentAngle * pc.math.RAD_TO_DEG;
    const blend = clamp(damp(dt, 8), 0, 1);
    for (const setting of [this.primary, this.secondary]) {
      if (!setting.root.enabled) continue;
      const x = pc.math.lerp(setting.root.getLocalPosition().x, setting.center, blend);
      setting.root.setLocalPosition(x, 0, 0);
      setting.pivot.setLocalEulerAngles(0, degrees, 0);
      setting.panel.face(camera);
    }
  }

  clear(): void {
    this.revision++;
    this.splats.clear('dish');
    this.splats.clear('compare');
    this.angle = 0;
    this.currentAngle = 0;
    this.primaryUrl = undefined;
    for (const setting of [this.primary, this.secondary]) {
      setting.root.enabled = false;
      setting.root.setLocalPosition(0, 0, 0);
    }
  }

  destroy(): void {
    this.alive = false;
    this.clear();
    this.primary.panel.destroy();
    this.secondary.panel.destroy();
    this.root.destroy();
    this.ringMesh.destroy();
    for (const surface of this.surfaceMaterials) surface.destroy();
  }
}
