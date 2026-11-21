import * as pc from 'playcanvas';
import type { XRAssetData, XRDishData, XRManifestData, XRPlaceData } from './bridgeTypes';
import { PhysicalPlaque } from './CanvasPanel3D';
import type { JarvisReveal } from './JarvisReveal';
import { PhysicalMenuBook } from './PhysicalMenuBook';
import type { SplatLoader } from './SplatLoader';
import { assetBase, child, cyan, damp, material, shape, type HitTarget, type ModelLibrary, type XYZ } from './sceneSupport';

interface DishSetting {
  root: pc.Entity;
  pivot: pc.Entity;
  plate: pc.Entity;
  ring: pc.Entity;
  panel: PhysicalPlaque;
  center: number;
}

export class DishTableScene {
  readonly root: pc.Entity;
  readonly menu: PhysicalMenuBook;
  private table: pc.Entity;
  private tableSupport: pc.Entity;
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
  private hasTableModel = false;
  private grounded = false;
  private tableVisible = false;
  private contentsVisible = false;
  private comparing = false;

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, models: ModelLibrary, private splats: SplatLoader,
    private reveal: JarvisReveal, selectDish: (id: string) => void,
  ) {
    this.root = child(parent, 'Dish table');
    this.table = child(this.root, 'Virtual table');
    this.top = child(this.root, 'Table surface contents');
    this.table.enabled = false;
    this.top.enabled = false;
    this.menu = new PhysicalMenuBook(device, this.top, models, reveal, selectDish);
    this.menu.entity.setLocalScale(0.85, 0.85, 0.85);
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
    this.tableSupport = child(this.table, 'Table support');
    shape(fallback, 'Tabletop', 'cylinder', finish, [0, -0.024, 0], [0.9, 0.048, 0.9]);
    shape(fallback, 'Cyan rim', 'cylinder', trim, [0, -0.045, 0], [0.903, 0.006, 0.903]);
    shape(this.tableSupport, 'Pedestal', 'cylinder', footing, [0, -0.36, 0], [0.18, 0.66, 0.18]);
    shape(this.tableSupport, 'Foot', 'cylinder', footing, [0, -0.69, 0], [0.55, 0.034, 0.55]);
    const menuModel = models.load(`${assetBase}table-menu-stand.glb`);
    this.primary = this.makeSetting('Primary dish', porcelain, ruler, menuModel);
    this.secondary = this.makeSetting('Comparison dish', porcelain, ruler, menuModel);

    void models.load(`${assetBase}table-pedestal.glb`).then((resource) => {
      if (!resource || !this.alive) return;
      this.table.addChild(resource.instantiateRenderEntity());
      fallback.enabled = false;
      this.hasTableModel = true;
      this.setGrounded(this.grounded);
      this.reveal.refresh(this.table, 0.86, 1200);
    });
  }

  get targets(): HitTarget[] { return this.menu.targets; }

  private makeSetting(name: string, porcelain: pc.Material, ruler: pc.Material,
    menuModel: Promise<pc.ContainerResource | null>): DishSetting {
    const root = child(this.top, name);
    const pivot = child(root, 'Dish turntable');
    const plate = shape(root, 'Plate outline', 'cylinder', porcelain, [0, 0.005, 0], [0.24, 0.01, 0.24]);
    const ring = child(root, 'Scale ruler ring', [0, 0.003, 0]);
    ring.addComponent('render', { meshInstances: [new pc.MeshInstance(this.ringMesh, ruler, ring)] });
    const panel = new PhysicalPlaque(this.device, root, 'Dish menu stand', 0.29, 0.115, 'menu', menuModel,
      this.reveal, [0, 0, -0.21]);
    root.enabled = false;
    return { root, pivot, plate, ring, panel, center: 0 };
  }

  async open(
    place: XRPlaceData, neighborhood: string, dish: XRDishData, compare: XRDishData | null,
    manifest: XRManifestData | null, backgroundReady: Promise<void>,
  ): Promise<void> {
    const revision = ++this.revision;
    const dishes = manifest?.menu_items.map(({ dish: item }) => item) ?? place.dishes;
    this.menu.setMenu(place, dishes.length ? dishes : [dish], neighborhood, dish.id, compare?.id);
    this.menu.placeAt(compare ? [-0.02, 0, 0.275] : [-0.265, 0, 0.125], compare ? 8 : 28);
    this.menu.entity.enabled = true;
    const assetFor = (item: XRDishData): XRAssetData | null =>
      manifest?.menu_items.find(({ dish }) => dish.id === item.id)?.dish_asset ?? item.asset ?? null;
    const asset = assetFor(dish);
    if (this.primaryUrl !== asset?.url) this.splats.clear('compare', 0.55);
    this.primaryUrl = asset?.url;
    this.primary.root.enabled = true;
    this.primary.center = compare ? -0.19 : 0;
    this.primary.panel.entity.setLocalEulerAngles(0, compare ? 12 : 0, 0);
    this.configure(this.primary, dish, asset);
    const primaryReady = this.splats.show('dish', asset, this.primary.pivot).then((ready) => {
      if (revision === this.revision) this.drawDish(this.primary, dish, asset, ready);
    });
    if (compare) {
      const comparison = assetFor(compare);
      const wasComparing = this.comparing;
      this.comparing = true;
      this.secondary.root.enabled = true;
      this.secondary.center = 0.19;
      this.secondary.panel.entity.setLocalEulerAngles(0, -12, 0);
      if (!wasComparing) {
        this.secondary.root.setLocalPosition(0, 0, 0);
        this.reveal.refresh(this.secondary.root, 0.64, 400);
      }
      this.configure(this.secondary, compare, comparison);
      await Promise.all([primaryReady, backgroundReady]);
      if (revision !== this.revision) return;
      const ready = await this.splats.show('compare', comparison, this.secondary.pivot);
      if (revision === this.revision) this.drawDish(this.secondary, compare, comparison, ready);
    } else {
      if (this.comparing) {
        if (this.reveal.isAnimating(this.top)) {
          this.reveal.finish(this.secondary.root, false);
          this.reveal.refresh(this.top);
        } else this.reveal.hide(this.secondary.root, 0.56, 400);
      }
      this.comparing = false;
      this.splats.clear('compare', 0.55);
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
    const diameter = asset?.plate_diameter_m ?? dish.plate_diameter_m;
    const size = actual
      ? `Actual size${diameter ? ` · ${Math.round(diameter * 100)} cm` : ''}`
      : ready === false ? '3D preview unavailable' : ready === undefined ? 'Loading 3D preview' : 'Approximate size';
    setting.panel.setText([
      { text: `${dish.name} · $${dish.price.toFixed(2)}`, size: 86, weight: 700 },
      { text: dish.portion_note, size: 62, wrap: true },
      { text: size, color: actual ? '#39513c' : '#795b37', size: 52, badge: true },
    ]);
  }

  setPresentation(virtualTable: boolean, showContents: boolean): void {
    if (virtualTable !== this.tableVisible) {
      this.tableVisible = virtualTable;
      if (virtualTable) this.reveal.show(this.table, 0.86, 1200);
      else this.reveal.hide(this.table, 0.66, 1200);
    }
    if (showContents !== this.contentsVisible) {
      this.contentsVisible = showContents;
      this.reveal.finish(this.secondary.root, this.comparing);
      this.splats.setVisible('dish', showContents);
      this.splats.setVisible('compare', showContents);
      if (showContents) this.reveal.show(this.top, 0.78);
      else this.reveal.hide(this.top, 0.62);
    }
  }

  setPose(position: XYZ, yaw = 0): void {
    this.root.setPosition(...position);
    this.root.setEulerAngles(0, yaw, 0);
    this.setGrounded(this.grounded);
  }

  setGrounded(grounded: boolean): void {
    this.grounded = grounded;
    this.tableSupport.enabled = grounded || !this.hasTableModel;
    this.tableSupport.setLocalScale(1, grounded ? Math.max(0.1, this.root.getPosition().y) / 0.707 : 1, 1);
  }

  setRotation(radians: number): void {
    if (Number.isFinite(radians)) this.angle = radians;
  }

  drag(radians: number, immediate = false): void {
    if (immediate) {
      this.currentAngle += radians;
      this.angle = this.currentAngle;
    } else this.angle += radians;
  }

  update(dt: number): void {
    this.currentAngle = pc.math.lerp(this.currentAngle, this.angle, damp(dt, 24));
    const degrees = this.currentAngle * pc.math.RAD_TO_DEG;
    const blend = damp(dt, 8);
    for (const setting of [this.primary, this.secondary]) {
      if (!setting.root.enabled) continue;
      const x = pc.math.lerp(setting.root.getLocalPosition().x, setting.center, blend);
      setting.root.setLocalPosition(x, 0, 0);
      setting.pivot.setLocalEulerAngles(0, degrees, 0);
    }
  }

  clear(): void {
    this.revision++;
    this.menu.clear();
    this.tableVisible = false;
    this.contentsVisible = false;
    this.comparing = false;
    this.reveal.finish(this.table, false);
    this.reveal.finish(this.top, false);
    this.splats.clear('dish');
    this.splats.clear('compare');
    this.angle = 0;
    this.currentAngle = 0;
    this.primaryUrl = undefined;
    for (const setting of [this.primary, this.secondary]) {
      this.reveal.finish(setting.root, false);
      setting.root.setLocalPosition(0, 0, 0);
    }
  }

  destroy(): void {
    this.alive = false;
    this.clear();
    this.primary.panel.destroy();
    this.secondary.panel.destroy();
    this.menu.destroy();
    this.root.destroy();
    this.ringMesh.destroy();
    for (const surface of this.surfaceMaterials) surface.destroy();
  }
}
