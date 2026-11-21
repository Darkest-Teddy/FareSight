import * as pc from 'playcanvas';
import type { XRAssetData, XRManifestData, XRPlaceData, XRRoomData } from './bridgeTypes';
import { CanvasPanel3D } from './CanvasPanel3D';
import { isSplat, type SplatLoader } from './SplatLoader';
import { amber, child, cyan, material, shape, type HitTarget, type XYZ } from './sceneSupport';

type Seating = XRRoomData['seating'];
const defaultSpawn: XYZ = [0, 1.55, 2];

export class VenueSplatScene {
  readonly root: pc.Entity;
  readonly roomRoot: pc.Entity;
  private cardsRoot: pc.Entity;
  private galleryRoot: pc.Entity;
  private peopleRoot: pc.Entity;
  private header: CanvasPanel3D;
  private fitPanel: CanvasPanel3D;
  private gallery: CanvasPanel3D[] = [];
  private dishes: CanvasPanel3D[] = [];
  private dishTargets: HitTarget[] = [];
  private figureMaterials = [material(cyan, 0.34), material('#ff9467', 0.36)];
  private place?: XRPlaceData;
  private manifest: XRManifestData | null = null;
  private asset: XRAssetData | null = null;
  private currentRoomReady = false;
  private revision = 0;
  private fit = { enabled: false, groupSize: 1, seating: 'seated' as Seating };
  private fitKey = '';
  private figures: pc.Entity[] = [];

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, private splats: SplatLoader,
    private selectDish: (id: string) => void,
  ) {
    this.root = child(parent, 'Venue');
    this.roomRoot = child(this.root, 'Venue room capture');
    this.cardsRoot = child(this.root, 'Venue information');
    this.galleryRoot = child(this.cardsRoot, 'Photo gallery arc');
    this.peopleRoot = child(this.cardsRoot, 'Group size preview');
    this.header = new CanvasPanel3D(device, this.cardsRoot, 'Preview provenance', 0.84, 0.245);
    this.fitPanel = new CanvasPanel3D(device, this.peopleRoot, 'Floor-space estimate', 0.85, 0.205);
    this.peopleRoot.enabled = false;
  }

  get spawn(): XYZ { return this.manifest?.spawn_point ?? this.asset?.spawn_point ?? defaultSpawn; }

  get targets(): HitTarget[] { return this.dishTargets; }

  async open(place: XRPlaceData, manifest: XRManifestData | null): Promise<void> {
    const revision = ++this.revision;
    const asset = manifest?.room_asset ?? place.rooms.find((room) => isSplat(room.asset))?.asset ?? null;
    const contentChanged = this.place !== place || this.manifest !== manifest;
    const sameRoom = this.place?.id === place.id && this.asset?.url === asset?.url &&
      this.asset?.scale_factor === asset?.scale_factor && this.asset?.scale_status === asset?.scale_status;
    this.place = place;
    this.manifest = manifest;
    this.asset = asset;
    if (!sameRoom) this.currentRoomReady = false;
    this.positionCards();
    this.drawHeader();
    if (contentChanged) {
      this.buildGallery();
      this.buildDishCards();
    }
    this.updateFit();

    const ready = await this.splats.show('room', asset, this.roomRoot);
    if (revision !== this.revision) return;
    this.currentRoomReady = ready;
    this.drawHeader();
    this.galleryRoot.enabled = !ready;
    this.updateFit();
  }

  setPresentation(showCards: boolean, showRoom: boolean): void {
    this.cardsRoot.enabled = showCards;
    this.roomRoot.enabled = showRoom;
  }

  clear(): void {
    this.revision++;
    this.splats.clear('room');
    this.currentRoomReady = false;
    this.place = undefined;
    this.manifest = null;
    this.asset = null;
    this.fitKey = '';
    for (const panel of [...this.gallery, ...this.dishes]) panel.destroy();
    for (const figure of this.figures) figure.destroy();
    this.gallery = [];
    this.dishes = [];
    this.figures = [];
    this.dishTargets = [];
  }

  private positionCards(): void {
    const [x, y, z] = this.spawn;
    this.header.entity.setLocalPosition(x, y + 0.31, z - 1.40);
    this.fitPanel.entity.setLocalPosition(x, y - 0.28, z - 1.10);
    this.galleryRoot.setLocalPosition(x, y - 0.09, z);
  }

  private drawHeader(): void {
    const place = this.place;
    if (!place) return;
    const preview = this.currentRoomReady ? this.asset?.provenance_label || 'AI spatial preview from restaurant photos'
      : isSplat(this.asset) ? 'Photo preview · 3D capture unavailable' : 'Photo preview (no 3D capture yet)';
    const date = this.currentRoomReady ? this.asset?.captured_on.slice(0, 10) : undefined;
    this.header.setText([
      { text: place.name, size: 76, weight: 750 },
      { text: preview, color: cyan, size: 43 },
      ...(date ? [{ text: `Captured on ${date}`, color: '#bfd2e4', size: 36 }] : []),
    ]);
  }

  private buildGallery(): void {
    for (const panel of this.gallery) panel.destroy();
    const place = this.place;
    if (!place) return;
    const photos = place.photos.slice(0, 5);
    const radius = 1.65;
    const count = Math.max(photos.length, 1);
    this.galleryRoot.enabled = !this.currentRoomReady;
    this.gallery = Array.from({ length: count }, (_, index) => {
      const angle = (index - (count - 1) / 2) * (count > 3 ? 0.38 : 0.43);
      const panel = new CanvasPanel3D(this.device, this.galleryRoot, place.name, 0.59, 0.36,
        [Math.sin(angle) * radius, 0, -Math.cos(angle) * radius]);
      panel.entity.setLocalEulerAngles(0, -angle * pc.math.RAD_TO_DEG, 0);
      if (!photos[index]) {
        panel.setText([
          { text: place.category.replaceAll('_', ' ').toUpperCase(), color: cyan, size: 46 },
          { text: place.name, size: 79, weight: 750, wrap: true },
          { text: place.vibe, size: 45, color: '#c7d9e8', wrap: true },
        ]);
      } else {
        const lines = [{ text: place.name, size: 66, weight: 700 }];
        panel.setText(lines);
        const image = new Image();
        image.crossOrigin = 'anonymous';
        image.onload = () => {
          if (this.gallery.includes(panel)) panel.setText(lines, cyan, image);
        };
        image.onerror = () => {
          if (this.gallery.includes(panel)) panel.setText([...lines, { text: 'Photo unavailable', size: 52 }]);
        };
        image.src = photos[index];
      }
      return panel;
    });
  }

  private buildDishCards(): void {
    for (const panel of this.dishes) panel.destroy();
    const dishes = this.manifest?.menu_items.map(({ dish }) => dish) ?? this.place?.dishes ?? [];
    const [x, y, z] = this.spawn;
    this.dishes = dishes.map((dish, i) => {
      const row = Math.floor(i / 3);
      const columns = Math.min(3, dishes.length - row * 3);
      const panel = new CanvasPanel3D(this.device, this.cardsRoot, dish.name, 0.31, 0.106,
        [x + (i % 3 - (columns - 1) / 2) * 0.33, y - 0.48 - row * 0.12, z - 1.28]);
      panel.setText([
        { text: dish.name, size: 77, weight: 700 },
        { text: `$${dish.price.toFixed(2)}`, color: cyan, size: 65 },
      ]);
      return panel;
    });
    this.dishTargets = this.dishes.map((panel, index) => panel.hit(() => this.selectDish(dishes[index].id)));
  }

  setWillWeFit(enabled: boolean, groupSize: number, seating: Seating): void {
    this.fit = { enabled, groupSize: Number.isFinite(groupSize) ? Math.max(1, Math.floor(groupSize)) : 1, seating };
    this.updateFit();
  }

  private updateFit(): void {
    const { enabled, seating, groupSize } = this.fit;
    this.peopleRoot.enabled = enabled && !!this.place;
    const rooms = this.manifest?.rooms ?? this.place?.rooms ?? [];
    const room = rooms.find((candidate) => candidate.seating === seating) ?? rooms[0];
    const key = JSON.stringify([enabled, seating, groupSize, this.place?.id, this.currentRoomReady, room]);
    if (this.fitKey === key) return;
    this.fitKey = key;
    for (const figure of this.figures) figure.destroy();
    this.figures = [];
    if (!enabled || !this.place) return;

    if (!this.currentRoomReady || this.asset?.scale_status !== 'measured' || !room ||
      !Number.isFinite(room.floor_width_m) || !Number.isFinite(room.floor_depth_m) ||
      room.floor_width_m <= 0 || room.floor_depth_m <= 0) {
      this.fitPanel.setText([{ text: 'Size not verified', color: amber, size: 80 }], amber);
      return;
    }

    const spacing = seating === 'seated' ? 0.75 : 0.6;
    const columns = Math.floor(room.floor_width_m / spacing);
    const rows = Math.floor(room.floor_depth_m / spacing);
    const capacity = columns * rows;
    const venueCapacity = room.stated_capacity;
    const [spawnX, , spawnZ] = this.spawn;
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

    this.fitPanel.entity.setLocalPosition(spawnX, this.spawn[1] - 0.28, spawnZ - 1.1);
    this.fitPanel.setText([
      { text: `Fits about ${capacity} by floor space · Venue says ${venueCapacity}`, size: 63, weight: 750 },
      { text: `${groupSize} guests · ${seating}${shown < groupSize ? ` · ${shown} shown` : ''}`,
        color: groupSize > Math.min(capacity, venueCapacity) ? amber : cyan, size: 52 },
    ]);
  }

  destroy(): void {
    this.clear();
    this.header.destroy();
    this.fitPanel.destroy();
    this.root.destroy();
    for (const surface of this.figureMaterials) surface.destroy();
  }
}
