import * as pc from 'playcanvas';
import type { XRAssetData, XRManifestData, XRPlaceData, XRRoomData } from './bridgeTypes';
import { isSplat, measuredRoomForAsset, menuDishes } from '../data/preview3D';
import { CanvasSurface, facePlane, PhysicalPlaque } from './CanvasPanel3D';
import { jarvisPoints, type JarvisReveal } from './JarvisReveal';
import { PhysicalMenuBook } from './PhysicalMenuBook';
import type { SplatLoader } from './SplatLoader';
import { assetBase, child, cyan, material, shape, type HitTarget, type ModelLibrary, type XYZ } from './sceneSupport';

type Seating = XRRoomData['seating'];
const defaultSpawn: XYZ = [0, 1.55, 2];

export class VenueSplatScene {
  readonly root: pc.Entity;
  readonly roomRoot: pc.Entity;
  readonly menu: PhysicalMenuBook;
  private cardsRoot: pc.Entity;
  private galleryRoot: pc.Entity;
  private soonRoot: pc.Entity;
  private soonText: CanvasSurface;
  private peopleRoot: pc.Entity;
  private fitPanel: PhysicalPlaque;
  private plaqueModel: Promise<pc.ContainerResource | null>;
  private gallery: PhysicalPlaque[] = [];
  private galleryImages = new Set<HTMLImageElement>();
  private figureMaterials = [material(cyan, 0.34), material('#ff9467', 0.36)];
  private standMaterial = material('#4b433b');
  private place?: XRPlaceData;
  private manifest: XRManifestData | null = null;
  private asset: XRAssetData | null = null;
  private currentRoomReady = false;
  private cardsVisible = false;
  private menuVisible = false;
  // Nothing has been captured for this place yet: no room scan and no dishes.
  private comingSoon = false;
  private galleryVisible = false;
  private fitVisible = false;
  private revision = 0;
  private fit = { enabled: false, groupSize: 1, seating: 'seated' as Seating };
  private fitKey = '';
  private figures: pc.Entity[] = [];

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, models: ModelLibrary, private splats: SplatLoader, private reveal: JarvisReveal,
    selectDish: (id: string) => void,
  ) {
    this.root = child(parent, 'Venue');
    this.roomRoot = child(this.root, 'Venue room capture');
    this.cardsRoot = child(this.root, 'Venue information');
    this.galleryRoot = child(this.cardsRoot, 'Photo gallery arc');
    this.peopleRoot = child(this.cardsRoot, 'Group size preview');
    this.plaqueModel = models.load(`${assetBase}room-plaque-stand.glb`);
    this.fitPanel = this.makePlaque(this.peopleRoot, 'Floor-space estimate', 0.85, 0.205);
    this.menu = new PhysicalMenuBook(device, this.cardsRoot, models, reveal, selectDish);
    // A place with nothing captured yet gets a few words hanging in the empty room: no sign, no stand.
    this.soonRoot = child(this.cardsRoot, 'Coming soon');
    this.soonText = new CanvasSurface(device, 1024, 512);
    const words = this.soonText.material;
    words.opacityMap = this.soonText.texture;
    words.opacityMapChannel = 'a';
    words.blendType = pc.BLEND_NORMAL;
    words.depthWrite = false;
    words.update();
    facePlane(this.soonRoot, 'Coming soon text', this.soonText, [0, 0, 0], 1, 0.5);
    this.soonRoot.enabled = false;
    this.peopleRoot.enabled = false;
    this.galleryRoot.enabled = false;
  }

  get spawn(): XYZ { return this.manifest?.spawn_point ?? this.asset?.spawn_point ?? defaultSpawn; }

  get hasRoom(): boolean { return this.currentRoomReady; }

  get targets(): HitTarget[] { return this.comingSoon ? [] : this.menu.targets; }

  private makePlaque(parent: pc.Entity, name: string, width: number, height: number, position?: XYZ): PhysicalPlaque {
    return new PhysicalPlaque(this.device, parent, name, width, height, 'room', this.plaqueModel, this.reveal, position);
  }

  private mountPlaque(panel: PhysicalPlaque): pc.Entity {
    // The modeled rear cleat attaches to a floor-mounted exhibit stand.
    const stand = child(panel.entity, 'Exhibit stand', [panel.width > 0.7 ? panel.width * 0.15 : 0, panel.height * 0.25, -0.024]);
    shape(stand, 'Upright', 'box', this.standMaterial, [0, -0.5, 0], [0.018, 1, 0.036]);
    shape(stand, 'Stand foot', 'box', this.standMaterial, [0, -0.995, -0.02], [0.16, 0.010, 0.13]);
    this.groundStand(stand);
    return stand;
  }

  private groundStand(stand: pc.Entity): void {
    const height = stand.getPosition().y - this.root.getPosition().y;
    stand.setLocalScale(1, Math.max(0.05, height), 1);
  }

  async open(place: XRPlaceData, manifest: XRManifestData | null, neighborhood = ''): Promise<void> {
    const revision = ++this.revision;
    const asset = manifest?.room_asset ?? place.rooms.find((room) => isSplat(room.asset))?.asset ?? null;
    const dishes = menuDishes(place, manifest);
    const comingSoon = !asset && !dishes.length;
    const contentChanged = this.place !== place || this.manifest !== manifest || this.comingSoon !== comingSoon;
    const sameRoom = this.place?.id === place.id && this.asset?.url === asset?.url &&
      this.asset?.scale_factor === asset?.scale_factor && this.asset?.scale_status === asset?.scale_status;
    this.place = place;
    this.manifest = manifest;
    this.asset = asset;
    if (!sameRoom) this.currentRoomReady = false;
    this.comingSoon = comingSoon;
    this.menu.setMenu(place, dishes, neighborhood);
    this.positionCards();
    if (contentChanged) this.buildGallery();
    this.updateMenu();
    this.updateSoon();
    this.updateGallery();
    this.updateFit();

    const ready = await this.splats.show('room', asset, this.roomRoot);
    if (revision !== this.revision) return;
    this.currentRoomReady = ready;
    this.updateGallery();
    this.updateFit();
  }

  setPresentation(showCards: boolean, showRoom: boolean): void {
    this.splats.setVisible('room', showRoom);
    if (this.cardsVisible === showCards) return;
    this.cardsVisible = showCards;
    this.updateMenu();
    this.updateSoon();
    this.updateGallery();
    this.updateFit();
  }

  private updateSoon(): void {
    this.soonRoot.enabled = this.cardsVisible && this.comingSoon;
  }

  private drawSoon(name: string): void {
    this.soonText.draw(name, (ctx, width) => {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#725b43';
      ctx.font = '600 30px Switzer, system-ui, sans-serif';
      ctx.letterSpacing = '9px';
      ctx.fillText('COMING SOON', width / 2, 150);
      ctx.letterSpacing = '0px';
      ctx.fillStyle = '#221b15';
      ctx.font = '700 84px Georgia, serif';
      // A long name is set smaller so it stays on one line.
      const size = Math.min(84, 84 * (width - 80) / ctx.measureText(name).width);
      ctx.font = `700 ${size}px Georgia, serif`;
      ctx.fillText(name, width / 2, 206);
      ctx.fillStyle = '#725b43';
      ctx.font = 'italic 34px Georgia, serif';
      ctx.fillText('Add photos in Vantage Contribute', width / 2, 326);
    });
  }

  /** An empty menu says nothing, so a place that is still coming soon is left with its few words. */
  private updateMenu(): void {
    const visible = this.cardsVisible && !this.comingSoon;
    if (this.menuVisible === visible) return;
    this.menuVisible = visible;
    if (visible) this.reveal.show(this.menu.entity, 0.74);
    else this.reveal.hide(this.menu.entity, 0.54);
  }

  private updateGallery(): void {
    const visible = this.cardsVisible && !this.currentRoomReady && this.gallery.length > 0;
    if (this.galleryVisible === visible) return;
    this.galleryVisible = visible;
    if (visible) this.reveal.show(this.galleryRoot, 0.75);
    else this.reveal.hide(this.galleryRoot, 0.56);
  }

  private setFitVisible(visible: boolean): void {
    if (this.fitVisible === visible) return;
    this.fitVisible = visible;
    if (visible) this.reveal.show(this.peopleRoot, 0.78);
    else this.reveal.hide(this.peopleRoot, 0.48, jarvisPoints.prop, () => {
      if (this.fit.enabled) return;
      for (const figure of this.figures) figure.destroy();
      this.figures = [];
      this.fitKey = '';
    });
  }

  clear(): void {
    this.revision++;
    this.splats.clear('room');
    this.currentRoomReady = false;
    this.place = undefined;
    this.manifest = null;
    this.asset = null;
    this.comingSoon = false;
    this.fitKey = '';
    this.setPresentation(false, false);
    this.updateSoon();
    for (const entity of [this.menu.entity, this.galleryRoot, this.peopleRoot]) {
      this.reveal.finish(entity, false);
    }
    this.clearGallery();
    for (const figure of this.figures) figure.destroy();
    this.figures = [];
    this.menu.clear();
  }

  private positionCards(): void {
    const [x, y, z] = this.spawn;
    this.fitPanel.entity.setLocalPosition(x - 0.33, y - 0.25, z - 1.12);
    this.galleryRoot.setLocalPosition(x, y - 0.09, z);
    // In line with where the desktop camera looks, and just below eye level in a headset.
    this.soonRoot.setLocalPosition(x + 0.16, y - 0.23, z - 1.65);
    for (const panel of this.gallery) {
      const stand = panel.entity.findByName('Exhibit stand');
      if (stand instanceof pc.Entity) this.groundStand(stand);
    }
    this.menu.placeAt([x + 0.24, y - 0.42, z - 0.74], -16);
  }

  private buildGallery(): void {
    this.clearGallery();
    const place = this.place;
    if (!place) return;
    if (this.comingSoon) {
      this.drawSoon(place.name);
      return;
    }
    const photos = place.photos.slice(0, 5);
    const radius = 1.65;
    const count = Math.max(photos.length, 1);
    this.gallery = Array.from({ length: count }, (_, index) => {
      const angle = (index - (count - 1) / 2) * (count > 3 ? 0.38 : 0.43);
      const panel = this.makePlaque(this.galleryRoot, place.name, 0.59, 0.36,
        [Math.sin(angle) * radius, 0, -Math.cos(angle) * radius]);
      panel.entity.setLocalEulerAngles(0, -angle * pc.math.RAD_TO_DEG, 0);
      this.mountPlaque(panel);
      if (!photos[index]) {
        panel.setText([
          { text: place.name, size: 85, weight: 700, wrap: true },
          { text: place.category.replaceAll('_', ' ').toUpperCase(), color: '#725b43', size: 46 },
          { text: place.vibe, size: 52, wrap: true },
        ]);
      } else {
        const lines = [{ text: place.name, size: 66, weight: 700 }];
        panel.setText(lines);
        const image = new Image();
        this.galleryImages.add(image);
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          this.releaseGalleryImage(image);
          if (this.gallery.includes(panel)) panel.setText(lines, image);
        };
        image.onerror = () => {
          this.releaseGalleryImage(image);
          if (this.gallery.includes(panel)) panel.setText([...lines, { text: 'Photo unavailable', size: 52 }]);
        };
        image.src = photos[index];
      }
      return panel;
    });
    if (this.galleryVisible) this.reveal.refresh(this.galleryRoot, 0.75);
  }

  private releaseGalleryImage(image: HTMLImageElement): void {
    image.onload = image.onerror = null;
    this.galleryImages.delete(image);
  }

  private clearGallery(): void {
    for (const image of this.galleryImages) {
      this.releaseGalleryImage(image);
      image.removeAttribute('src');
    }
    for (const panel of this.gallery) panel.destroy();
    this.gallery = [];
  }

  setWillWeFit(enabled: boolean, groupSize: number, seating: Seating): void {
    this.fit = { enabled, groupSize: Number.isFinite(groupSize) ? Math.max(1, Math.floor(groupSize)) : 1, seating };
    this.updateFit();
  }

  private updateFit(): void {
    const { enabled, seating, groupSize } = this.fit;
    if (!enabled || !this.place) {
      this.setFitVisible(false);
      return;
    }
    this.setFitVisible(this.cardsVisible);
    const rooms = this.manifest?.rooms ?? this.place?.rooms ?? [];
    const room = measuredRoomForAsset(rooms, this.asset, seating);
    const key = JSON.stringify([enabled, seating, groupSize, this.place?.id, this.currentRoomReady, room]);
    if (this.fitKey === key) return;
    this.fitKey = key;
    for (const figure of this.figures) figure.destroy();
    this.figures = [];

    if (!this.currentRoomReady || !room) {
      this.fitPanel.setText([{ text: 'Size not verified', color: '#854318', size: 80 }]);
      if (this.fitVisible) this.reveal.refresh(this.peopleRoot, 0.78);
      return;
    }

    const spacing = seating === 'seated' ? 0.75 : 0.6;
    const columns = Math.floor(room.floor_width_m / spacing);
    const rows = Math.floor(room.floor_depth_m / spacing);
    const capacity = columns * rows;
    const venueCapacity = room.stated_capacity;
    const originX = -(columns - 1) * spacing / 2;
    const originZ = -(rows - 1) * spacing / 2;
    const inRoom = Math.min(groupSize, capacity, 120);
    const shown = Math.min(groupSize, 120);
    const seated = seating === 'seated';
    for (let i = 0; i < shown; i++) {
      const cols = Math.max(1, columns);
      const outside = i >= inRoom;
      const x = originX + (i % cols) * spacing;
      const z = outside
        ? originZ - (Math.floor((i - inRoom) / cols) + 1) * spacing
        : originZ + Math.floor(i / cols) * spacing;
      const appearance = this.figureMaterials[Number(outside || i >= venueCapacity)];
      const person = child(this.peopleRoot, `Guest ${i + 1}`, [x, 0, z]);
      this.figures.push(person);
      shape(person, 'Body', 'cylinder', appearance, [0, seated ? 0.46 : 0.70, 0],
        [0.29, seated ? 0.72 : 1.12, 0.22]);
      shape(person, 'Head', 'sphere', appearance, [0, seated ? 0.94 : 1.38, 0], [0.22, 0.25, 0.22]);
    }

    this.fitPanel.setText([
      { text: `Fits about ${capacity} by floor space · Venue says ${venueCapacity}`, size: 63, weight: 750 },
      { text: `${groupSize} guests · ${seating}${shown < groupSize ? ` · ${shown} shown` : ''}`,
        color: groupSize > Math.min(capacity, venueCapacity) ? '#854318' : '#39513c', size: 52 },
    ]);
    if (this.fitVisible) this.reveal.refresh(this.peopleRoot, 0.78);
  }

  destroy(): void {
    this.clear();
    this.fitPanel.destroy();
    this.soonText.destroy();
    this.menu.destroy();
    this.root.destroy();
    this.standMaterial.destroy();
    for (const surface of this.figureMaterials) surface.destroy();
  }
}
