import * as pc from 'playcanvas';
import { formatDishPrice } from '@faresight/shared';
import type { XRAssetData, XRDishData, XRManifestData, XRPlaceData } from './bridgeTypes';
import { hasDishPreview, menuDishes } from '../data/preview3D';
import { CanvasSurface, facePlane } from './CanvasPanel3D';
import { collideDishes, DishBody, dishStep, tableRadius } from './DishPhysics';
import { jarvisPoints, type JarvisReveal } from './JarvisReveal';
import { PhysicalMenuBook } from './PhysicalMenuBook';
import type { SplatLoader } from './SplatLoader';
import { assetBase, child, cyan, damp, levelYaw, material, pickBounds, shape, type HitTarget, type ModelLibrary, type PickBounds, type XYZ } from './sceneSupport';

export interface GrabbableDish {
  id: 'primary' | 'secondary';
  entity: pc.Entity;
  bounds: PickBounds;
  setHeld(held: boolean): void;
  onRelease(surfaceY?: number, velocity?: pc.Vec3, angularVelocity?: pc.Vec3): boolean;
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
  body: DishBody;
  restPosition: pc.Vec3;
  restRotation: pc.Quat;
  preview?: string;
  dropPending: boolean;
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
  private previousPosition = new pc.Vec3();
  private inverse = new pc.Mat4();
  private accumulated = 0;

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
    return { root, pivot, plate, ring, placard, caption, center: 0, body: new DishBody(),
      restPosition: new pc.Vec3(), restRotation: new pc.Quat(), dropPending: false };
  }

  private labelDish(setting: DishSetting, dish: XRDishData, venue: string, asset: XRAssetData | null): void {
    const diameter = asset?.plate_diameter_m ?? dish.plate_diameter_m;
    const portion = diameter && diameter > 0
      ? `${asset?.scale_status === 'measured' ? '' : '≈'}${Number((diameter * 100).toFixed(1))} cm`
      : 'Size unlisted';
    const scaleAndPrice = `${formatDishPrice(dish.price)}  ·  ${portion}`;
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
    const primaryPending = this.primary.dropPending;
    const secondaryPending = this.secondary.dropPending;
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
    const newPrimary = this.configure(this.primary, 'primary', dish, asset) || primaryPending;
    const primaryReady = backgroundReady.then(async () => {
      if (revision !== this.revision) return;
      const ready = await this.splats.show('dish', asset, this.primary.pivot);
      if (revision === this.revision) this.finishPreview(this.primary, 'dish', ready, newPrimary);
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
        this.reveal.refresh(this.secondary.root, 0.64, jarvisPoints.detail);
      }
      const newSecondary = this.configure(this.secondary, 'secondary', compare, comparison) || secondaryPending;
      await primaryReady;
      if (revision !== this.revision) return;
      const ready = await this.splats.show('compare', comparison, this.secondary.pivot);
      if (revision === this.revision) this.finishPreview(this.secondary, 'compare', ready, newSecondary);
    } else {
      this.primary.placard.enabled = false;
      this.secondary.grab = undefined;
      this.secondary.preview = undefined;
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

  private configure(setting: DishSetting, id: GrabbableDish['id'], dish: XRDishData, asset: XRAssetData | null): boolean {
    const diameter = asset?.plate_diameter_m ?? dish.plate_diameter_m ?? 0.24;
    const size = Number.isFinite(diameter) && diameter > 0 ? pc.math.clamp(diameter, 0.05, 0.65) : 0.24;
    const preview = `${dish.id}:${asset?.url ?? ''}`;
    const changed = setting.preview !== preview;
    setting.preview = preview;
    setting.root.setLocalPosition(setting.center, 0, 0);
    setting.plate.setLocalScale(size, 0.01, size);
    setting.ring.setLocalScale(size + 0.024, size + 0.024, size + 0.024);
    setting.plate.enabled = true;
    const { pivot, body } = setting;
    body.radius = size * 0.5;
    body.height = pc.math.clamp(size * 0.42, 0.035, 0.14);
    const grab: GrabbableDish = {
      id, entity: pivot, bounds: pickBounds(pivot, [size + 0.06, Math.max(0.18, body.height + 0.04), size + 0.06], [0, 0.075, 0]),
      setHeld: (held) => {
        if (setting.grab !== grab || (!held && body.state !== 'held')) return;
        setting.dropPending = false;
        body.setFromPivot(pivot.getPosition(), pivot.getRotation());
        if (held) body.reset('held');
        else body.toss();
      },
      onRelease: (surfaceY, velocity, angularVelocity) => {
        if (setting.grab !== grab) return false;
        const position = pivot.getPosition();
        body.setFromPivot(position, pivot.getRotation());
        body.toss(velocity, angularVelocity, surfaceY);
        const support = surfaceY ?? this.tabletopY(position);
        if (support !== undefined) body.keepAbove(support);
        return support !== undefined;
      },
    };
    setting.grab = grab;
    return changed;
  }

  private finishPreview(setting: DishSetting, slot: 'dish' | 'compare', ready: boolean, drop: boolean): void {
    setting.plate.enabled = !ready;
    const height = ready ? this.splats.height(slot) : undefined;
    const body = setting.body;
    if (height !== undefined && Number.isFinite(height) && body.state === 'seated') {
      body.height = pc.math.clamp(height, 0.018, 0.5);
      const bounds = setting.grab!.bounds;
      bounds.halfExtents.y = Math.max(0.09, (body.height + 0.04) / 2);
      bounds.center!.y = body.height / 2;
    }
    setting.dropPending = drop && body.state === 'seated';
  }

  tabletopY(position: pc.Vec3, baseOffset = 0): number | undefined {
    const table = this.top.getPosition();
    if (Math.abs(position.y - table.y - baseOffset) <= 0.16 && Math.hypot(position.x - table.x, position.z - table.z) <= tableRadius) {
      return table.y;
    }
  }

  private seat(setting: DishSetting): void {
    setting.body.reset('seated');
    setting.dropPending = false;
    setting.restPosition.set(0, 0, 0);
    setting.restRotation.copy(pc.Quat.IDENTITY);
    setting.pivot.setLocalPosition(pc.Vec3.ZERO);
    setting.pivot.setLocalRotation(this.turntableRotation);
  }

  resetDishes(): void {
    this.accumulated = 0;
    for (const setting of [this.primary, this.secondary]) this.seat(setting);
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

  update(dt: number, reducedMotion = false, surfaceAt?: (point: pc.Vec3) => number | undefined): void {
    this.currentAngle = pc.math.lerp(this.currentAngle, this.angle, reducedMotion ? 1 : damp(dt, 24));
    this.turntableRotation.setFromAxisAngle(pc.Vec3.UP, this.currentAngle * pc.math.RAD_TO_DEG);
    if (!this.contentsVisible) return;
    const settings = this.comparing ? [this.primary, this.secondary] : [this.primary];
    const table = this.top.getPosition();
    const floor = this.grounded || !this.tableVisible ? 0 : table.y - this.tableDepth;
    for (const setting of settings) {
      const { body, pivot } = setting;
      if (body.state === 'seated') {
        pivot.setLocalPosition(setting.restPosition);
        pivot.setLocalRotation(this.dishRotation.mul2(this.turntableRotation, setting.restRotation));
        body.setFromPivot(pivot.getPosition(), pivot.getRotation());
        if (setting.dropPending) {
          setting.dropPending = false;
          if (!reducedMotion) {
            body.position.y += 0.05;
            body.toss();
          }
        }
      } else if (body.state === 'held') {
        this.previousPosition.copy(body.position);
        body.setFromPivot(pivot.getPosition(), pivot.getRotation());
        if (dt > 0) {
          body.velocity.sub2(body.position, this.previousPosition).mulScalar(1 / dt);
          body.clampMotion();
        }
      }
    }
    this.accumulated += Math.min(Math.max(0, dt), 0.05);
    while (this.accumulated >= dishStep) {
      this.accumulated -= dishStep;
      for (const { body } of settings) {
        if (body.state === 'dynamic') body.step(dishStep, table, floor, surfaceAt);
      }
      if (this.comparing) collideDishes(this.primary.body, this.secondary.body);
    }
    for (const setting of settings) {
      const { body, pivot } = setting;
      if (body.state === 'held' || body.state === 'seated') continue;
      if (body.position.distanceSq(table) > 3.5 ** 2 && body.support !== 'lost') body.sleep('lost');
      if (body.state === 'sleeping' && body.support !== 'surface' && body.support !== 'table') {
        body.idle += Math.min(dt, 0.05);
        if (body.idle >= 2.5) {
          this.seat(setting);
          setting.dropPending = !reducedMotion;
          continue;
        }
        if (body.support === 'lost') continue;
      }
      pivot.setPosition(body.pivot(this.dishPosition));
      pivot.setRotation(body.rotation);
      if (body.state === 'sleeping' && body.support === 'table') {
        this.dishPosition.y = table.y;
        this.inverse.copy(setting.root.getWorldTransform()).invert().transformPoint(this.dishPosition, setting.restPosition);
        setting.restPosition.y = 0;
        setting.restRotation.setFromAxisAngle(pc.Vec3.UP,
          (levelYaw(pivot) - levelYaw(setting.root) - this.currentAngle) * pc.math.RAD_TO_DEG);
        body.reset('seated');
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
    this.turntableRotation.copy(pc.Quat.IDENTITY);
    this.resetDishes();
    this.primaryUrl = undefined;
    for (const setting of [this.primary, this.secondary]) {
      this.reveal.finish(setting.root, false);
      setting.root.setLocalPosition(0, 0, 0);
      setting.pivot.setLocalPosition(pc.Vec3.ZERO);
      setting.pivot.setLocalRotation(pc.Quat.IDENTITY);
      setting.grab = undefined;
      setting.preview = undefined;
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
