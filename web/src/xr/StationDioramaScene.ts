import * as pc from 'playcanvas';
import { has3D } from '../data/preview3D';
import type { XRFilterSummary, XRPlaceData, XRStopData } from './bridgeTypes';
import { PhysicalPlaque } from './CanvasPanel3D';
import { jarvisPoints, type JarvisReveal } from './JarvisReveal';
import { assetBase, brass, child, clamp, damp, fetchAssetJson, ivory, material, pickBounds, shape,
  type DebugLog, type HitTarget, type ModelLibrary, type PickBounds, type XYZ } from './sceneSupport';

interface SegmentProjection {
  centerLat: number;
  centerLon: number;
  spanMeters: number;
  deckSize: number;
}

interface SegmentAnchor {
  deckY: number;
  projection?: SegmentProjection;
  placeAnchors?: Record<string, XYZ>;
  /** Venues beyond the modelled crop, pinned to the island rim on their bearing from the deck. */
  offDeck?: Record<string, OffDeckAnchor>;
  stationAnchor?: { base: XYZ; top: number };
  pinAnchors: XYZ[];
}

interface OffDeckAnchor {
  position: XYZ;
  distanceM: number;
  compass: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPosition(value: unknown): value is XYZ {
  return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
}

function isSegmentAnchor(value: unknown): value is SegmentAnchor {
  if (!isRecord(value)) return false;
  const { deckY, projection, placeAnchors, offDeck, stationAnchor, pinAnchors } = value;
  if (!Number.isFinite(deckY) || !Array.isArray(pinAnchors) || !pinAnchors.every(isPosition)) return false;
  if (projection !== undefined && (!isRecord(projection)
    || !Number.isFinite(projection.centerLat) || !Number.isFinite(projection.centerLon)
    || typeof projection.spanMeters !== 'number' || !Number.isFinite(projection.spanMeters) || projection.spanMeters <= 0
    || typeof projection.deckSize !== 'number' || !Number.isFinite(projection.deckSize) || projection.deckSize <= 0)) return false;
  if (placeAnchors !== undefined && (!isRecord(placeAnchors) || !Object.values(placeAnchors).every(isPosition))) return false;
  if (offDeck !== undefined && (!isRecord(offDeck) || !Object.values(offDeck).every((anchor) =>
    isRecord(anchor) && isPosition(anchor.position) && Number.isFinite(anchor.distanceM) && typeof anchor.compass === 'string'))) return false;
  return stationAnchor === undefined || (isRecord(stationAnchor) && isPosition(stationAnchor.base) && Number.isFinite(stationAnchor.top));
}

interface Pin {
  place: XRPlaceData;
  root: pc.Entity;
  panel: PhysicalPlaque;
  stem: pc.Entity;
  stemSurface: pc.StandardMaterial;
  locator?: VenueBeacon;
  targets: HitTarget[];
  index: number;
  matched: boolean;
  offDeck?: OffDeckAnchor;
  height: number;
  visibility: number;
}

interface VenueBeacon {
  entity: pc.Entity;
  surface: pc.StandardMaterial;
  pulse: pc.Entity;
  pulseSurface: pc.StandardMaterial;
  sleeve: pc.Entity;
  sleeveSurface: pc.StandardMaterial;
  phase: number;
}
const oneWayFare = 2.4;
const nearbyPinDistance = 0.15;
const labelClearance = 0.22;
const labelTierSpacing = 0.16;
// Segment anchors include this clearance above the sampled roof or ground.
const anchorClearance = 0.018;
const stemWidth = 0.006;
const pinStagger = 0.07;
const pinRevealTime = 0.45;
const stationRevealTime = 1.48;
const stemColor = new pc.Color().fromString(brass);
const mutedColor = new pc.Color().fromString('#93979c');
const beaconColor = '#38d6ff';
const highlightBeaconColor = '#ffb547';
const cyanColor = new pc.Color().fromString(beaconColor);
const highlightColor = new pc.Color().fromString(highlightBeaconColor);
const fallbackGrabSize: XYZ = [0.914, 0.54, 0.98];
const fallbackGrabCenter: XYZ = [0, 0.09, 0.02];
const defaultFilters: XRFilterSummary = { craving: '', maxBudget: 20, startStopId: '', groupSize: 1, familyVisit: false };

function projectToDeck(proj: SegmentProjection, lat?: number, lon?: number): [number, number] | undefined {
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const scale = proj.deckSize / proj.spanMeters;
  const dxMeters = (lon - proj.centerLon) * 111320 * Math.cos((proj.centerLat * Math.PI) / 180);
  const dzMeters = -(lat - proj.centerLat) * 110540;
  const limit = proj.deckSize * 0.48;
  return [clamp(dxMeters * scale, -limit, limit), clamp(dzMeters * scale, -limit, limit)];
}

function categoryTag(place: XRPlaceData & { cravings?: readonly string[] }): string {
  const category = place.category === 'restaurant' ? place.cravings?.[0] ?? place.category
    : place.cravings?.includes('karaoke') ? 'karaoke' : place.category;
  return category.replaceAll('_', ' ').toUpperCase();
}

function beaconMaterial(opacity = 1): pc.StandardMaterial {
  const surface = material(beaconColor, 0.94, opacity);
  surface.useLighting = false;
  surface.diffuse.set(0, 0, 0);
  surface.update();
  return surface;
}

export class StationDioramaScene {
  readonly root: pc.Entity;
  readonly grabBounds: PickBounds;
  private base: pc.Entity;
  private hero: pc.Entity;
  private deckContent: pc.Entity;
  private stationMarker: pc.Entity;
  private markerReveal?: number;
  private stationPost: pc.Entity;
  private stationColor: pc.StandardMaterial;
  private fallback: pc.Entity;
  private pinModel: Promise<pc.ContainerResource | null>;
  private locatorMesh: pc.Mesh;
  private model?: pc.Entity;
  private materials: pc.StandardMaterial[] = [];
  private anchors = new Map<string, SegmentAnchor>();
  private stop?: XRStopData;
  private places: XRPlaceData[] = [];
  private filtered = new Set<string>();
  private highlighted = new Set<string>();
  private filters = defaultFilters;
  private pins: Pin[] = [];
  private revision = 0;
  private pinsShown = false;
  private visible = false;
  private alive = true;
  private abort = new AbortController();

  constructor(
    private app: pc.Application, private models: ModelLibrary, private reveal: JarvisReveal,
    log: DebugLog, private selectPlace: (id: string) => void,
  ) {
    const device = app.graphicsDevice;
    this.root = child(app.root, 'Station diorama', undefined, app);
    this.grabBounds = pickBounds(this.root, fallbackGrabSize, fallbackGrabCenter);
    this.base = child(this.root, 'Station deck');
    this.hero = child(this.base, 'Station architecture');
    this.hero.enabled = false;
    this.deckContent = child(this.base, 'Station segment and markers');
    this.fallback = child(this.hero, 'Station model fallback');
    this.pinModel = models.load(`${assetBase}venue-pin-flag.glb`);
    this.locatorMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({
      ringRadius: 0.024, tubeRadius: 0.0022, segments: 48, sides: 6,
    }));
    this.locatorMesh.incRefCount();

    const grass = material('#7fa35a');
    const earth = material('#7a5a3c');
    const rock = material('#5b4a3a');
    const street = material('#8d8f8c');
    const limestone = material('#d6c5a9');
    const brick = material('#9c6250');
    const enamel = material(ivory);
    this.stationColor = material('#00843d');
    this.materials.push(grass, earth, rock, street, limestone, brick, enamel, this.stationColor);
    this.stationMarker = child(this.deckContent, 'T-station medallion');
    this.stationMarker.enabled = false;
    shape(this.stationMarker, 'Ivory rim', 'cylinder', enamel, [0, 0.0015, 0], [0.036, 0.003, 0.036]);
    shape(this.stationMarker, 'Line enamel', 'cylinder', this.stationColor, [0, 0.003, 0], [0.032, 0.002, 0.032]);
    shape(this.stationMarker, 'T cap', 'box', enamel, [0, 0.004, -0.005], [0.016, 0.001, 0.0034]);
    shape(this.stationMarker, 'T stem', 'box', enamel, [0, 0.004, 0.0016], [0.0034, 0.001, 0.0098]);
    // The medallion is raised on a post so it clears the roofs around the station entrance.
    this.stationPost = shape(this.stationMarker, 'Medallion post', 'cylinder', enamel, [0, 0, 0], [0.004, 0.001, 0.004]);
    this.stationPost.enabled = false;

    // Placeholder floating island: a grass slab over earth and rock that taper to a tip. The
    // lower layers sit towards the front so the taper still reads from the steep desktop view.
    shape(this.fallback, 'Grass', 'box', grass, [0, -0.012, 0], [0.90, 0.024, 0.90]);
    shape(this.fallback, 'Earth', 'box', earth, [0, -0.064, 0.02], [0.84, 0.08, 0.84]);
    shape(this.fallback, 'Rock', 'box', rock, [0.03, -0.149, 0.10], [0.60, 0.09, 0.62]);
    shape(this.fallback, 'Rock tip', 'box', rock, [0.06, -0.239, 0.19], [0.30, 0.09, 0.36]);
    shape(this.fallback, 'Rock fragment', 'box', rock, [-0.36, -0.20, 0.36], [0.07, 0.05, 0.06]);
    shape(this.fallback, 'Rock fragment', 'box', earth, [0.40, -0.17, 0.33], [0.05, 0.04, 0.05]);
    const blocks: XYZ[] = [[-0.31, 0.12, -0.25], [-0.13, 0.09, -0.34], [0.11, 0.15, -0.28],
      [0.30, 0.18, -0.30], [0.33, 0.075, -0.05], [-0.32, 0.08, 0.15]];
    blocks.forEach(([x, y, z], index) => {
      shape(this.fallback, 'Buildings', 'box', index % 2 ? limestone : brick, [x, y, z], [0.105, y * 2, 0.13]);
    });
    shape(this.fallback, 'Street', 'box', street, [0, 0.002, 0.11], [0.85, 0.004, 0.095]);

    void fetchAssetJson<unknown>(`${assetBase}segment-anchors.json`, this.abort.signal, log).then((data) => {
      if (data === null || !this.alive) return;
      if (!isRecord(data)) {
        log('segment-anchors.json: expected a map of segment anchors', 'warn');
        return;
      }
      for (const [id, record] of Object.entries(data)) {
        if (isSegmentAnchor(record)) this.anchors.set(id, record);
        else log(`segment-anchors.json: invalid anchor for ${id}`, 'warn');
      }
      this.positionMarkers();
    });
  }

  async show(stop: XRStopData, segmentFile = `${assetBase}segment-${stop.stop_id}.glb`): Promise<void> {
    if (this.stop?.stop_id === stop.stop_id && this.stop.segment_asset === stop.segment_asset && this.model) return;
    const revision = ++this.revision;
    this.stop = stop;
    this.stationColor.diffuse.fromString(stop.primary_color);
    this.stationColor.update();
    const old = this.model;
    if (old) {
      if (this.visible && this.hero.enabled) {
        this.reveal.cancel(this.hero);
        old.reparent(this.base);
        this.reveal.hide(old, 0.62, jarvisPoints.hero, () => old.destroy());
      } else old.destroy();
    }
    this.model = undefined;
    this.deckContent.setLocalPosition(0, 0, 0);
    this.fallback.enabled = true;
    if (this.visible && old) this.reveal.show(this.hero, stationRevealTime, jarvisPoints.hero);
    this.grabBounds.center!.set(...fallbackGrabCenter);
    this.grabBounds.halfExtents.set(...fallbackGrabSize).mulScalar(0.5);
    this.reconcilePins();

    const assetUrl = (file: string): string => /^(?:\/|https?:)/.test(file) ? file : `${assetBase}${file}`;
    const url = assetUrl(segmentFile);
    let resource = await this.models.load(url);
    if (revision !== this.revision) return;
    if (!resource && stop.segment_asset && assetUrl(stop.segment_asset) !== url) {
      resource = await this.models.load(assetUrl(stop.segment_asset));
    }
    if (!resource || revision !== this.revision) return;
    this.model = resource.instantiateRenderEntity();
    // The model is still unparented, so its mesh bounds are in the station's local space.
    const meshes = this.model.findComponents('render').flatMap((render) => render.meshInstances);
    if (meshes.length) {
      const bounds = meshes[0].aabb.clone();
      for (const mesh of meshes.slice(1)) bounds.add(mesh.aabb);
      this.grabBounds.center!.copy(bounds.center);
      this.grabBounds.halfExtents.copy(bounds.halfExtents);
    }
    this.hero.addChild(this.model);
    this.fallback.enabled = false;
    this.reveal.refresh(this.hero, stationRevealTime, jarvisPoints.hero);
  }

  setPlaces(places: XRPlaceData[], filtered: Set<string>): void {
    this.places = places;
    this.filtered = filtered;
    this.reconcilePins();
  }

  setHighlightedPlaces(placeIds: string[]): void {
    this.highlighted = new Set(placeIds);
    for (const pin of this.pins) {
      this.setLocator(pin, has3D(pin.place) || this.highlighted.has(pin.place.id));
      this.applyPinPose(pin);
    }
    this.updatePinLabels();
  }

  setFilters(filters: XRFilterSummary): void {
    this.filters = filters;
    this.updatePinLabels();
  }

  get targets(): HitTarget[] { return this.pinsShown ? this.pins.flatMap((pin) => pin.targets) : []; }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) this.reveal.show(this.hero, stationRevealTime, jarvisPoints.hero);
    else this.reveal.hide(this.hero, 0.72, jarvisPoints.hero);
  }

  seekReveal(progress: number): void {
    this.reveal.seek(this.hero, progress);
    this.visible = progress > 0;
  }

  seekMarker(progress: number): void {
    this.markerReveal = progress;
    if (this.stop && this.anchors.get(this.stop.stop_id)?.projection) {
      this.reveal.seek(this.stationMarker, progress, jarvisPoints.detail);
    }
  }

  setPinsShown(shown: boolean, immediate = false): void {
    if (shown === this.pinsShown && !immediate) return;
    this.pinsShown = shown;
    this.pins.forEach((pin, rank) => {
      if (immediate) this.reveal.finish(pin.root, shown);
      else if (shown) this.reveal.show(pin.root, pinRevealTime, jarvisPoints.detail, rank * pinStagger);
      else this.reveal.hide(pin.root, 0.45, jarvisPoints.detail);
    });
  }

  seekPins(progress: number): void {
    this.pinsShown = progress > 0;
    const span = pinRevealTime + Math.max(0, this.pins.length - 1) * pinStagger;
    this.pins.forEach(({ root }, rank) => {
      this.reveal.seek(root, clamp((progress * span - rank * pinStagger) / pinRevealTime, 0, 1), jarvisPoints.detail);
    });
  }

  private reconcilePins(): void {
    const stopId = this.stop?.stop_id;
    const places = this.places.filter((place) => place.stop_id === stopId);
    const previous = new Map(this.pins.map((pin) => [pin.place.id, pin]));
    this.pins = places.map((place, index) => {
      const matched = this.filtered.has(place.id);
      let pin = previous.get(place.id);
      if (pin) previous.delete(place.id);
      else {
        const root = child(this.deckContent, place.name, undefined, this.app);
        const panel = new PhysicalPlaque(this.app.graphicsDevice, root, place.name, 0.225, 0.075, 'flag', this.pinModel, this.reveal);
        const stemSurface = material(brass);
        shape(root, 'Roof collar', 'cylinder', stemSurface, [0, 0.002, 0], [0.023, 0.004, 0.023], this.app);
        const stem = shape(root, 'Brass stem', 'cylinder', stemSurface, [0, 0, 0], [stemWidth, 1, stemWidth], this.app);
        const select = () => this.selectPlace(place.id);
        pin = { place, root, panel, stem, stemSurface,
          targets: [panel.hit(select)],
          index, matched, height: labelClearance, visibility: matched ? 1 : 0 };
        if (this.pinsShown) this.reveal.show(root, pinRevealTime, jarvisPoints.detail, index * pinStagger);
        else root.enabled = false;
      }
      pin.place = place;
      pin.index = place.pin_index ?? index;
      pin.matched = matched;
      this.setLocator(pin, has3D(place) || this.highlighted.has(place.id));
      return pin;
    });
    for (const pin of previous.values()) this.destroyPin(pin);
    this.positionMarkers();
    this.updatePinLabels();
  }

  private setLocator(pin: Pin, shown: boolean): void {
    if (shown === !!pin.locator) return;
    if (!shown) {
      this.removeLocator(pin);
      return;
    }
    const entity = child(pin.root, '3D venue inner halo', [0, 0.007, 0], this.app);
    const surface = beaconMaterial();
    entity.addComponent('render', { castShadows: false, meshInstances: [new pc.MeshInstance(this.locatorMesh, surface, entity)] });
    const pulse = child(pin.root, '3D venue pulse halo', [0, 0.007, 0], this.app);
    const pulseSurface = beaconMaterial(0.53);
    // The translucent locator stays readable from street level, where surrounding blocks can cover the collar.
    pulseSurface.depthTest = false;
    pulse.addComponent('render', { castShadows: false, meshInstances: [new pc.MeshInstance(this.locatorMesh, pulseSurface, pulse)] });
    const sleeveSurface = beaconMaterial(0.48);
    sleeveSurface.depthTest = false;
    const sleeve = shape(pin.root, '3D venue beacon sleeve', 'cylinder', sleeveSurface,
      [0, 0.069, 0], [0.020, 0.126, 0.020], this.app);
    sleeve.render!.castShadows = false;
    pin.locator = { entity, surface, pulse, pulseSurface, sleeve, sleeveSurface, phase: 0.28 };
    this.updateLocator(pin, 0);
  }

  private updateLocator(pin: Pin, dt: number): void {
    const locator = pin.locator;
    if (!locator) return;
    const isHighlighted = this.highlighted.has(pin.place.id);
    const brightness = isHighlighted ? 1 : pc.math.lerp(0.15, 1, pin.visibility);
    const tint = isHighlighted ? highlightColor : cyanColor;
    locator.surface.emissive.copy(tint);
    locator.pulseSurface.emissive.copy(tint);
    locator.sleeveSurface.emissive.copy(tint);
    locator.surface.emissiveIntensity = isHighlighted ? 1.35 : brightness;
    locator.surface.update();
    locator.sleeveSurface.opacity = (isHighlighted ? 0.68 : 0.48) * brightness;
    locator.sleeveSurface.update();
    const speed = isHighlighted ? 1.05 : 1.85;
    locator.phase = this.reveal.enabled ? (locator.phase + dt / speed) % 1 : 0.34;
    const scale = (isHighlighted ? 1.45 : 1.28) + (isHighlighted ? 1.6 : 1.2) * locator.phase;
    locator.pulse.setLocalScale(scale, 0.7, scale);
    locator.pulseSurface.opacity = (1 - locator.phase) * (isHighlighted ? 0.85 : 0.61) * brightness;
    locator.pulseSurface.update();
  }

  private removeLocator(pin: Pin): void {
    const locator = pin.locator;
    if (!locator) return;
    locator.entity.destroy();
    locator.pulse.destroy();
    locator.sleeve.destroy();
    locator.surface.destroy();
    locator.pulseSurface.destroy();
    locator.sleeveSurface.destroy();
    pin.locator = undefined;
  }

  private positionMarkers(): void {
    const stop = this.stop;
    const anchor = stop && this.anchors.get(stop.stop_id);
    const projection = anchor?.projection;
    const deckY = anchor?.deckY ?? 0;
    const station = projection && projectToDeck(projection, stop?.lat, stop?.lon);
    const raised = anchor?.stationAnchor;
    this.stationMarker.enabled = !!(raised ?? station);
    this.stationPost.enabled = !!raised;
    if (raised) {
      const [x, baseY, z] = raised.base;
      const rise = Math.max(0.001, raised.top - baseY);
      this.stationMarker.setLocalPosition(x, raised.top, z);
      this.stationPost.setLocalPosition(0, -rise / 2, 0);
      this.stationPost.setLocalScale(0.004, rise, 0.004);
      if (this.markerReveal !== undefined) this.seekMarker(this.markerReveal);
    } else if (station) {
      this.stationMarker.setLocalPosition(station[0], deckY + 0.0024, station[1]);
      if (this.markerReveal !== undefined) this.seekMarker(this.markerReveal);
    }

    let relabel = false;
    const placements = this.pins.map((pin) => {
      const offDeck = anchor?.offDeck?.[pin.place.id];
      if (pin.offDeck !== offDeck) {
        pin.offDeck = offDeck;
        relabel = true;
      }
      const exact = offDeck?.position ?? anchor?.placeAnchors?.[pin.place.id];
      const projected = projection && projectToDeck(projection, pin.place.lat, pin.place.lon);
      const sampled = exact ?? (projected ? undefined : anchor?.pinAnchors?.[pin.index]);
      const position: XYZ = sampled ? [sampled[0], sampled[1] - anchorClearance, sampled[2]]
        : projected ? [projected[0], deckY + 0.08, projected[1]]
          : [(pin.index % 3 - 1) * 0.25, 0.11, Math.floor(pin.index / 3) * 0.23 - 0.08];
      return { pin, position };
    }).sort((a, b) => a.position[1] - b.position[1] || a.pin.index - b.pin.index);

    const labels: { x: number; y: number; z: number }[] = [];
    for (const { pin, position: [x, baseY, z] } of placements) {
      const nearbyHeights = labels.filter((label) => Math.hypot(x - label.x, z - label.z) <= nearbyPinDistance)
        .map((label) => label.y).sort((a, b) => a - b);
      let labelY = baseY + labelClearance;
      for (const height of nearbyHeights) {
        if (Math.abs(labelY - height) < labelTierSpacing) labelY = height + labelTierSpacing;
      }
      labels.push({ x, y: labelY, z });

      pin.root.setLocalPosition(x, baseY, z);
      pin.height = labelY - baseY;
      this.applyPinPose(pin);
    }
    if (relabel) this.updatePinLabels();
  }

  private updatePinLabels(): void {
    for (const pin of this.pins) {
      const fare = this.filters.startStopId === pin.place.stop_id ? 0 : oneWayFare;
      const hourlyRoom = pin.place.rooms.find((room) => /hour/i.test(room.price_unit));
      const subtotal = hourlyRoom ? hourlyRoom.price / Math.max(1, this.filters.groupSize) : pin.place.typical_price;
      const total = subtotal + fare;
      pin.panel.setCallout(pin.place.name, `$${total.toFixed(2)} incl. fare`, {
        category: pin.offDeck ? `${pin.offDeck.distanceM} M ${pin.offDeck.compass}` : categoryTag(pin.place),
        has3D: has3D(pin.place),
        selected: this.highlighted.has(pin.place.id),
      });
    }
  }

  update(dt: number, camera: pc.Entity): void {
    const fade = damp(dt, 10);
    for (const pin of this.pins) {
      const goal = pin.matched ? 1 : 0;
      if (pin.visibility !== goal) {
        pin.visibility = Math.abs(pin.visibility - goal) < 0.01 ? goal : pc.math.lerp(pin.visibility, goal, fade);
        this.applyPinPose(pin);
      }
      this.updateLocator(pin, dt);
      pin.panel.faceYaw(camera, dt);
    }
  }

  private applyPinPose(pin: Pin): void {
    const isHighlighted = this.highlighted.has(pin.place.id);
    const labelY = pin.height - 0.065 * (1 - pin.visibility) + (isHighlighted ? 0.032 : 0);
    const stemHeight = Math.max(stemWidth, labelY - pin.panel.faceHeight);
    pin.stem.setLocalPosition(0, stemHeight / 2, 0);
    pin.stem.setLocalScale(stemWidth, stemHeight, stemWidth);
    pin.stemSurface.diffuse.lerp(mutedColor, isHighlighted ? highlightColor : stemColor, isHighlighted ? 1 : pin.visibility);
    pin.stemSurface.update();
    pin.panel.entity.setLocalPosition(0, stemHeight, 0);
    pin.panel.setMuted(isHighlighted ? 0 : 1 - pin.visibility);
  }

  private destroyPin(pin: Pin): void {
    this.removeLocator(pin);
    pin.panel.destroy();
    pin.root.destroy();
    pin.stemSurface.destroy();
  }

  destroy(): void {
    this.alive = false;
    this.revision++;
    this.abort.abort();
    for (const pin of this.pins) this.destroyPin(pin);
    this.root.destroy();
    this.locatorMesh.decRefCount();
    this.locatorMesh.destroy();
    for (const surface of this.materials) surface.destroy();
  }
}
