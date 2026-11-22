import * as pc from 'playcanvas';
import type { XRAssetData, XRDishData, XRManifestData, XRPlaceData } from './bridgeTypes';
import { hasDishPreview, menuDishes } from '../data/preview3D';
import { CanvasSurface, facePlane } from './CanvasPanel3D';
import { jarvisPoints, type JarvisReveal } from './JarvisReveal';
import { PhysicalMenuBook } from './PhysicalMenuBook';
import type { SplatLoader } from './SplatLoader';
import { assetBase, child, cyan, damp, levelYaw, material, pickBounds, shape, type HitTarget, type ModelLibrary, type PickBounds, type XYZ } from './sceneSupport';

export interface GrabbableDish {
  id: 'primary' | 'secondary';
  entity: pc.Entity;
  bounds: PickBounds;
  setHeld(held: boolean): void;
  onRelease(surfaceY?: number): boolean;
}

interface DishPose {
  position: pc.Vec3;
  rotation: pc.Quat;
  world: boolean;
}

interface DishSetting {
  root: pc.Entity;
  pivot: pc.Entity;
  plate: pc.Entity;
  ring: pc.Entity;
  placard: pc.Entity;
  caption: CanvasSurface;
  center: number;
  grab?: GrabbableDish;
  pose?: DishPose;
  held: boolean;
  settling: boolean;
}

export class DishTableScene {
  readonly root: pc.Entity;
  readonly menu: PhysicalMenuBook;
  private table: pc.Entity;
  private top: pc.Entity;
  private primary: DishSetting;
  private secondary: DishSetting;
  private surfaceMaterials: pc.StandardMaterial[];
  private fallbackMaterials: pc.StandardMaterial[];
  private ringMesh: pc.Mesh;
  private revision = 0;
  private angle = 0;
  private currentAngle = 0;
  private primaryUrl?: string;
  private alive = true;
  private tableDepth = 0.74;
  private grounded = false;
  private tableVisible = false;
  private contentsVisible = false;
  private comparing = false;
  private turntableRotation = new pc.Quat();
  private dishRotation = new pc.Quat();
  private dishPosition = new pc.Vec3();

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, models: ModelLibrary, private splats: SplatLoader,
    private reveal: JarvisReveal, selectDish: (id: string) => void, compareDish: (id: string, placeId: string) => void,
  ) {
    this.root = child(parent, 'Dish table');
    this.table = child(this.root, 'Virtual table');
    this.top = child(this.root, 'Table surface contents');
    this.table.enabled = false;
    this.top.enabled = false;
    this.menu = new PhysicalMenuBook(device, this.top, models, reveal, selectDish, true, compareDish);
    this.menu.entity.setLocalScale(0.82, 0.82, 0.82);
    const walnut = material('#514033', 0.05);
    const iron = material('#353337');
    const trim = material('#826747');
    const porcelain = material('#adbdc9', 0.07);
    const ruler = material(cyan, 0.30, 0.78);
    const brass = material('#a08050', 0.08);
    this.surfaceMaterials = [porcelain, ruler, brass];
    this.fallbackMaterials = [walnut, iron, trim];
    this.ringMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({
      ringRadius: 0.5, tubeRadius: 0.006, segments: 64, sides: 6,
    }));
    const fallback = child(this.table, 'Virtual table fallback');
    shape(fallback, 'Walnut tabletop', 'cylinder', walnut, [0, -0.021, 0], [0.9, 0.042, 0.9]);
    shape(fallback, 'Brass edge', 'cylinder', trim, [0, -0.034, 0], [0.901, 0.004, 0.901]);
    shape(fallback, 'Column', 'cylinder', iron, [0, -0.366, 0], [0.095, 0.65, 0.095]);
    shape(fallback, 'Weighted foot', 'cylinder', iron, [0, -0.716, 0], [0.48, 0.048, 0.48]);
    this.primary = this.makeSetting('Primary dish', porcelain, ruler, brass);
    this.secondary = this.makeSetting('Comparison dish', porcelain, ruler, brass);

    void models.load(`${assetBase}table-pedestal.glb?rev=bistro`).then((resource) => {
      if (!resource || !this.alive) return;
      const model = resource.instantiateRenderEntity();
      const meshes = model.findComponents('render').flatMap((render) => render.meshInstances);
      const depth = meshes.reduce((max, mesh) => Math.max(max, -mesh.aabb.getMin().y), 0);
      // Older cached assets contain just a tabletop. Keep the complete fallback until the new model is served.
      if (depth < 0.60) { model.destroy(); return; }
      this.tableDepth = depth;
      this.table.addChild(model);
      this.reveal.refresh(this.table, 0.86, jarvisPoints.prop);
      fallback.destroy();
      this.destroyFallbackMaterials();
      this.setGrounded(this.grounded);
    });
  }

  get targets(): HitTarget[] { return this.menu.targets; }
  get hasComparison(): boolean { return this.comparing; }

  grabbableDishes(): GrabbableDish[] {
    if (!this.contentsVisible) return [];
    return [this.primary.grab, this.comparing ? this.secondary.grab : undefined]
      .filter((entry): entry is GrabbableDish => !!entry?.entity.enabled);
  }

  private makeSetting(name: string, porcelain: pc.Material, ruler: pc.Material, brass: pc.Material): DishSetting {
    const root = child(this.top, name);
    const pivot = child(root, 'Dish turntable');
    const plate = shape(pivot, 'Plate outline', 'cylinder', porcelain, [0, 0.005, 0], [0.24, 0.01, 0.24]);
    const ring = child(root, 'Scale ruler ring', [0, 0.003, 0]);
    ring.addComponent('render', { meshInstances: [new pc.MeshInstance(this.ringMesh, ruler, ring)] });
    const placard = child(root, 'Dish provenance placard', [0, 0.039, 0.24]);
    placard.setLocalEulerAngles(-25, 0, 0);
    shape(placard, 'Brass frame', 'box', brass, [0, 0, 0], [0.26, 0.082, 0.008]);
    const caption = new CanvasSurface(this.device, 896, 272);
    facePlane(placard, 'Printed dish caption', caption, [0, 0, 0.0045], 0.254, 0.076);
    placard.enabled = false;
    root.enabled = false;
    return { root, pivot, plate, ring, placard, caption, center: 0, held: false, settling: false };
  }

  private labelDish(setting: DishSetting, dish: XRDishData, venue: string, asset: XRAssetData | null): void {
    const diameter = asset?.plate_diameter_m ?? dish.plate_diameter_m;
    const portion = diameter && diameter > 0
      ? `${asset?.scale_status === 'measured' ? '' : '≈'}${Math.round(diameter * 100)} cm`
      : 'Size unlisted';
    const scaleAndPrice = Number.isFinite(dish.price) ? `$${dish.price.toFixed(2)}  ·  ${portion}` : portion;
    setting.caption.draw(JSON.stringify([dish.name, venue, scaleAndPrice]), (ctx, w, h) => {
      ctx.fillStyle = '#f4ecdd';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#292018';
      ctx.font = 'bold 60px Georgia, serif';
      ctx.fillText(dish.name, 35, 86, w - 70);
      ctx.font = '46px Georgia, serif';
      ctx.fillText(venue, 35, 156, w - 70);
      ctx.fillStyle = '#5a4836';
      ctx.font = 'bold 41px system-ui, sans-serif';
      ctx.fillText(scaleAndPrice, 35, 224, w - 70);
    });
    setting.placard.enabled = true;
  }

  async open(
    place: XRPlaceData, neighborhood: string, dish: XRDishData, compare: XRDishData | null,
    manifest: XRManifestData | null, backgroundReady: Promise<void>, comparePlaceName: string | undefined,
    places: readonly XRPlaceData[],
  ): Promise<void> {
    const revision = ++this.revision;
    this.resetDishes();
    const dishes = menuDishes(place, manifest);
    this.menu.setMenu(place, dishes.length ? dishes : [dish], neighborhood, dish.id, compare?.id);
    this.menu.setComparisonOptions([
      ...dishes.filter((entry) => entry.id !== dish.id && hasDishPreview(entry)).map((entry) => ({ dish: entry, placeName: place.name })),
      ...places.filter((entry) => entry.id !== place.id).flatMap((venue) =>
        venue.dishes.filter(hasDishPreview).map((entry) => ({ dish: entry, placeName: venue.name }))),
    ]);
    this.menu.placeAt(compare ? [-0.02, 0.001, -0.18] : [-0.28, 0.001, 0.06], compare ? 0 : 22);
    this.menu.entity.enabled = true;
    const assetFor = (item: XRDishData): XRAssetData | null =>
      manifest?.menu_items.find(({ dish }) => dish.id === item.id)?.dish_asset ?? item.asset ?? null;
    const asset = assetFor(dish);
    if (this.primaryUrl !== asset?.url) this.splats.clear('compare', 0.55);
    this.primaryUrl = asset?.url;
    this.primary.root.enabled = true;
    this.primary.center = compare ? -0.19 : 0;
    this.configure(this.primary, 'primary', dish, asset);
    const primaryReady = this.splats.show('dish', asset, this.primary.pivot).then((ready) => {
      if (revision === this.revision) this.primary.plate.enabled = !ready;
    });
    if (compare) {
      const comparison = compare.place_id === place.id ? assetFor(compare) : compare.asset ?? null;
      this.labelDish(this.primary, dish, place.name, asset);
      this.labelDish(this.secondary, compare, comparePlaceName ?? place.name, comparison);
      const wasComparing = this.comparing;
      this.comparing = true;
      this.secondary.root.enabled = true;
      this.secondary.center = 0.19;
      if (!wasComparing) {
        this.secondary.root.setLocalPosition(0, 0, 0);
        this.reveal.refresh(this.secondary.root, 0.64, jarvisPoints.detail);
      }
      this.configure(this.secondary, 'secondary', compare, comparison);
      await Promise.all([primaryReady, backgroundReady]);
      if (revision !== this.revision) return;
      const ready = await this.splats.show('compare', comparison, this.secondary.pivot);
      if (revision === this.revision) this.secondary.plate.enabled = !ready;
    } else {
      this.primary.placard.enabled = false;
      this.secondary.grab = undefined;
      if (this.comparing) {
        if (this.reveal.isAnimating(this.top)) {
          this.reveal.finish(this.secondary.root, false);
          this.reveal.refresh(this.top);
        } else this.reveal.hide(this.secondary.root, 0.56, jarvisPoints.detail);
      }
      this.comparing = false;
      this.splats.clear('compare', 0.55);
      await primaryReady;
    }
  }

  private configure(setting: DishSetting, id: GrabbableDish['id'], dish: XRDishData, asset: XRAssetData | null): void {
    const diameter = asset?.plate_diameter_m ?? dish.plate_diameter_m ?? 0.24;
    const size = Number.isFinite(diameter) && diameter > 0 ? diameter : 0.24;
    setting.plate.setLocalScale(size, 0.01, size);
    setting.ring.setLocalScale(size + 0.024, size + 0.024, size + 0.024);
    setting.plate.enabled = true;
    const { pivot } = setting;
    const grab: GrabbableDish = {
      id, entity: pivot, bounds: pickBounds(pivot, [size + 0.06, 0.18, size + 0.06], [0, 0.075, 0]),
      setHeld: (held) => {
        if (setting.grab !== grab) return;
        setting.held = held;
        setting.settling = false;
        setting.pose = held ? undefined : { position: pivot.getPosition().clone(), rotation: pivot.getRotation().clone(), world: true };
      },
      onRelease: (surfaceY) => setting.grab === grab && this.settleDish(setting, surfaceY),
    };
    setting.grab = grab;
  }

  tabletopY(position: pc.Vec3, baseOffset = 0): number | undefined {
    const table = this.top.getPosition();
    if (Math.abs(position.y - table.y - baseOffset) <= 0.16 && Math.hypot(position.x - table.x, position.z - table.z) <= 0.45) {
      return table.y;
    }
  }

  private settleDish(setting: DishSetting, surfaceY?: number): boolean {
    const position = setting.pivot.getPosition().clone();
    const tabletop = this.tabletopY(position);
    const onTable = tabletop !== undefined && (surfaceY === undefined || Math.abs(position.y - tabletop) <= Math.abs(position.y - surfaceY) + 0.01);
    const height = onTable ? tabletop : surfaceY;
    if (height === undefined) return false;

    const rotation = new pc.Quat().setFromAxisAngle(pc.Vec3.UP, levelYaw(setting.pivot) * pc.math.RAD_TO_DEG);
    position.y = height;
    if (onTable) {
      const center = setting.root.getPosition();
      if (Math.hypot(position.x - center.x, position.z - center.z) < 0.14) position.set(0, 0, 0);
      else new pc.Mat4().invert(setting.root.getWorldTransform()).transformPoint(position, position);
      rotation.mul2(setting.root.getRotation().clone().invert(), rotation);
      rotation.mul(this.turntableRotation.clone().invert());
    }
    setting.pose = { position, rotation, world: !onTable };
    setting.settling = true;
    return true;
  }

  resetDishes(): void {
    for (const setting of [this.primary, this.secondary]) {
      setting.held = false;
      setting.pose = undefined;
      setting.settling = true;
    }
  }

  setPresentation(virtualTable: boolean, showContents: boolean): void {
    if (virtualTable !== this.tableVisible) {
      this.tableVisible = virtualTable;
      if (virtualTable) this.reveal.show(this.table, 0.86, jarvisPoints.prop);
      else this.reveal.hide(this.table, 0.66, jarvisPoints.prop);
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
    this.syncTableHeight();
  }

  setGrounded(grounded: boolean): void {
    this.grounded = grounded;
    this.syncTableHeight();
  }

  syncTableHeight(): void {
    this.table.setLocalScale(1, this.grounded ? Math.max(0.1, this.root.getPosition().y) / this.tableDepth : 1, 1);
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

  update(dt: number, reducedMotion = false): void {
    this.currentAngle = pc.math.lerp(this.currentAngle, this.angle, damp(dt, 24));
    this.turntableRotation.setFromAxisAngle(pc.Vec3.UP, this.currentAngle * pc.math.RAD_TO_DEG);
    const blend = damp(dt, 8);
    for (const setting of [this.primary, this.secondary]) {
      if (!setting.root.enabled) continue;
      const x = pc.math.lerp(setting.root.getLocalPosition().x, setting.center, blend);
      setting.root.setLocalPosition(x, 0, 0);
      if (setting.held) continue;
      const { pivot, pose } = setting;
      const position = pose?.position ?? pc.Vec3.ZERO;
      const rotation = pose ? (pose.world ? pose.rotation : this.dishRotation.mul2(this.turntableRotation, pose.rotation))
        : this.turntableRotation;
      const from = pose?.world ? pivot.getPosition() : pivot.getLocalPosition();
      const fromRotation = pose?.world ? pivot.getRotation() : pivot.getLocalRotation();
      if (setting.settling && (reducedMotion || (from.distanceSq(position) < 0.000001 && Math.abs(fromRotation.dot(rotation)) > 0.99999))) {
        setting.settling = false;
      }
      const amount = damp(dt, 16);
      const next = setting.settling ? this.dishPosition.lerp(from, position, amount) : position;
      const nextRotation = setting.settling ? this.dishRotation.slerp(fromRotation, rotation, amount) : rotation;
      if (pose?.world) {
        pivot.setPosition(next);
        pivot.setRotation(nextRotation);
      } else {
        pivot.setLocalPosition(next);
        pivot.setLocalRotation(nextRotation);
      }
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
      setting.pivot.setLocalPosition(pc.Vec3.ZERO);
      setting.pivot.setLocalRotation(pc.Quat.IDENTITY);
      setting.grab = undefined;
      setting.pose = undefined;
      setting.held = false;
      setting.settling = false;
    }
  }

  destroy(): void {
    this.alive = false;
    this.clear();
    this.menu.destroy();
    this.root.destroy();
    this.primary.caption.destroy();
    this.secondary.caption.destroy();
    this.ringMesh.destroy();
    this.destroyFallbackMaterials();
    for (const surface of this.surfaceMaterials) surface.destroy();
  }

  private destroyFallbackMaterials(): void {
    for (const material of this.fallbackMaterials) material.destroy();
    this.fallbackMaterials = [];
  }
}
