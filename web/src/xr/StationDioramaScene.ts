import * as pc from 'playcanvas';
import { has3D } from '../data/preview3D';
import type { XRFilterSummary, XRPlaceData, XRStopData } from './bridgeTypes';
import { PhysicalPlaque } from './CanvasPanel3D';
import { jarvisPoints, type JarvisReveal } from './JarvisReveal';
import { assetBase, child, clamp, damp, fetchAssetJson, ink, ivory, material, pickBounds, shape, sunflower, target,
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

/**
 * A venue marker, drawn the way a map marks a place: a dot on the spot, a hairline up from it, and
 * a paper label on top. Three parts, two colours.
 *
 * Its states are told apart by shape and fill, never by glow, which does not read on paper:
 * - every venue has a paper dot ringed in ink;
 * - a venue with a 3D room has a larger dot with an ink bullseye, and a "3D" chip on its label;
 * - the venue being pointed at fills its dot and its label with sunflower, stands taller on a
 *   heavier needle, and sends ink rings out across the ground;
 * - a venue the filters rule out sinks and fades to grey.
 */
interface Pin {
  place: XRPlaceData;
  root: pc.Entity;
  panel: PhysicalPlaque;
  needle: pc.Entity;
  /** The dot on the venue's spot: an ink disc, a smaller fill on it, and the bullseye. */
  foot: pc.Entity;
  bullseye: pc.Entity;
  /** Needle, ring and bullseye. One material per pin, so a filtered-out venue can fade alone. */
  inkSurface: pc.StandardMaterial;
  fillSurface: pc.StandardMaterial;
  pulse?: FootPulse;
  targets: HitTarget[];
  index: number;
  matched: boolean;
  offDeck?: OffDeckAnchor;
  height: number;
  visibility: number;
}

/** The ring that travels outward from the venue being pointed at. */
interface FootPulse {
  entity: pc.Entity;
  surface: pc.StandardMaterial;
  phase: number;
}
const oneWayFare = 2.4;
// Labels that would cover one another as seen from the table are stacked at different heights.
const labelClearance = 0.11;
/** How far a label climbs per try while it still covers one it has to clear. */
const labelClimb = 0.006;
const labelMaxRise = 0.2;
/** Clear space kept between two labels on screen, as a fraction of a label's own size there. */
const labelGap = 0.06;
/**
 * Where the viewer stands, in deck space, at the default framing. Overlap is judged from here: a
 * label further back looks higher and smaller, so two labels can cover each other without being
 * anywhere near each other on the deck. The viewer never moves for a transition, so this holds.
 */
const viewerAt = new pc.Vec3(0.086, 0.831, 0.856);
const viewForward = new pc.Vec3(-0.065, -0.758, -0.649).normalize();
const viewRight = new pc.Vec3().cross(viewForward, pc.Vec3.UP).normalize();
const viewUp = new pc.Vec3().cross(viewRight, viewForward).normalize();
// Segment anchors include this clearance above the sampled roof or ground.
const anchorClearance = 0.018;
// The label is venue-pin-flag.glb: a 204 x 64 mm face inside a 2.4 mm ink edge.
const labelWidth = 0.204;
const labelHeight = 0.064;
const labelEdge = 0.0024;
const needleWidth = 0.0032;
const footRadius = 0.0105;
const footRadius3D = 0.0145;
const footLift = 0.0025;
/** How much of the foot's radius is its ink ring; the rest is fill. */
const footRing = 0.26;
const pulseRadius = 0.024;
const pulsePeriod = 1.5;
const pinStagger = 0.07;
const pinRevealTime = 0.45;
const stationRevealTime = 1.48;
const inkColor = new pc.Color().fromString(ink);
const paperColor = new pc.Color().fromString('#FFFDF8');
const sunflowerColor = new pc.Color().fromString(sunflower);
// A filtered-out venue: still there, but as quiet as the paper allows.
const mutedInk = new pc.Color().fromString('#A9A59B');
const mutedPaper = new pc.Color().fromString('#ECE6DA');
const fallbackGrabSize: XYZ = [0.914, 0.54, 0.98];
const fallbackGrabCenter: XYZ = [0, 0.09, 0.02];
const defaultFilters: XRFilterSummary = { maxBudget: 20, startStopId: '' };

/** A label's extent as the viewer sees it: x and y are view-plane directions over distance. */
interface LabelRect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

const viewCorner = new pc.Vec3();

/**
 * The screen box around the label centred at height y over (x, z), seen from where the viewer
 * stands. The label stands upright and turns to face the viewer, so off to one side it looks
 * tilted; the box holds all four of its corners.
 */
function labelRect(x: number, y: number, z: number): LabelRect {
  const toViewerX = viewerAt.x - x;
  const toViewerZ = viewerAt.z - z;
  const flat = Math.hypot(toViewerX, toViewerZ) || 1;
  const halfWidth = labelWidth / 2 + labelEdge;
  const halfHeight = labelHeight / 2 + labelEdge;
  // The label's own left-to-right, level and square to the line towards the viewer.
  const alongX = (toViewerZ / flat) * halfWidth;
  const alongZ = (-toViewerX / flat) * halfWidth;
  const rect = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
  for (const side of [-1, 1]) {
    for (const end of [-1, 1]) {
      viewCorner.set(x + side * alongX, y + end * halfHeight, z + side * alongZ).sub(viewerAt);
      const depth = Math.max(0.05, viewCorner.dot(viewForward));
      const across = viewCorner.dot(viewRight) / depth;
      const up = viewCorner.dot(viewUp) / depth;
      rect.left = Math.min(rect.left, across);
      rect.right = Math.max(rect.right, across);
      rect.bottom = Math.min(rect.bottom, up);
      rect.top = Math.max(rect.top, up);
    }
  }
  return rect;
}

function overlaps(a: LabelRect, b: LabelRect): boolean {
  const padX = (a.right - a.left) * labelGap / 2;
  const padY = (a.top - a.bottom) * labelGap / 2;
  return a.left - padX < b.right && b.left < a.right + padX && a.bottom - padY < b.top && b.bottom < a.top + padY;
}

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

/** A flat, unlit colour: the marker is a drawing on the map, so it does not take the scene's shading. */
function flat(color: pc.Color, opacity = 1): pc.StandardMaterial {
  const surface = material('#000000', 0, opacity);
  surface.useLighting = false;
  surface.emissive.copy(color);
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
  private pulseMesh: pc.Mesh;
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
    this.pulseMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({
      ringRadius: pulseRadius, tubeRadius: 0.0016, segments: 48, sides: 6,
    }));
    this.pulseMesh.incRefCount();

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
    for (const pin of this.pins) this.applyPinPose(pin);
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
        const panel = new PhysicalPlaque(this.app.graphicsDevice, root, place.name, labelWidth, labelHeight, 'flag', this.pinModel, this.reveal);
        const inkSurface = flat(inkColor);
        const fillSurface = flat(paperColor);
        // The foot is three discs of unit radius, each a little smaller and a little taller than
        // the one under it, so from above they read as ring, fill and bullseye. It is scaled as
        // one to the size its venue calls for. It floats a hair above the sampled roof so a spot
        // on a roof edge or a sloped parapet is not half swallowed by it.
        const foot = child(root, 'Foot', [0, footLift, 0], this.app);
        shape(foot, 'Ink ring', 'cylinder', inkSurface, [0, 0.0008, 0], [2, 0.0016, 2], this.app);
        shape(foot, 'Fill', 'cylinder', fillSurface, [0, 0.0011, 0], [2 * (1 - footRing), 0.0022, 2 * (1 - footRing)], this.app);
        const bullseye = shape(foot, 'Bullseye', 'cylinder', inkSurface, [0, 0.0014, 0], [0.72, 0.0028, 0.72], this.app);
        const needle = shape(root, 'Needle', 'cylinder', inkSurface, [0, 0, 0], [needleWidth, 1, needleWidth], this.app);
        for (const render of root.findComponents('render') as pc.RenderComponent[]) render.castShadows = false;
        const select = () => this.selectPlace(place.id);
        pin = { place, root, panel, needle, foot, bullseye, inkSurface, fillSurface,
          // The label is the obvious thing to click; the dot on the venue's own spot works too.
          targets: [panel.hit(select), target(root, [0.05, 0.016, 0.05], select)],
          index, matched, height: labelClearance, visibility: matched ? 1 : 0 };
        if (this.pinsShown) this.reveal.show(root, pinRevealTime, jarvisPoints.detail, index * pinStagger);
        else root.enabled = false;
      }
      pin.place = place;
      pin.index = place.pin_index ?? index;
      pin.matched = matched;
      return pin;
    });
    for (const pin of previous.values()) this.destroyPin(pin);
    this.positionMarkers();
    this.updatePinLabels();
  }

  /** Give the venue being pointed at its travelling ring, or take it away again. */
  private setPulse(pin: Pin, shown: boolean): void {
    if (shown === !!pin.pulse) return;
    if (pin.pulse) {
      pin.pulse.entity.destroy();
      pin.pulse.surface.destroy();
      pin.pulse = undefined;
      return;
    }
    const entity = child(pin.root, 'Pointed-at ring', [0, footLift + 0.003, 0], this.app);
    const surface = flat(inkColor, 0.99);
    entity.addComponent('render', { castShadows: false, meshInstances: [new pc.MeshInstance(this.pulseMesh, surface, entity)] });
    pin.pulse = { entity, surface, phase: 0 };
    this.updatePulse(pin, 0);
  }

  /** The ring leaves the foot's rim at full ink and thins out as it travels. */
  private updatePulse(pin: Pin, dt: number): void {
    const pulse = pin.pulse;
    if (!pulse) return;
    // With motion turned down the ring holds still, part-way out.
    pulse.phase = this.reveal.enabled ? (pulse.phase + dt / pulsePeriod) % 1 : 0.4;
    const reach = pc.math.lerp(pin.foot.getLocalScale().x / pulseRadius, 2.3, 1 - (1 - pulse.phase) ** 2);
    pulse.entity.setLocalScale(reach, 1, reach);
    pulse.surface.opacity = (1 - pulse.phase) ** 1.5;
    pulse.surface.update();
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
    });

    // Nearest the viewer first: a label further back then climbs until it shows above the ones in
    // front of it, which is also where it looks most natural.
    placements.sort((a, b) => b.position[2] - a.position[2] || a.pin.index - b.pin.index);
    const labels: LabelRect[] = [];
    for (const { pin, position: [x, baseY, z] } of placements) {
      let labelY = baseY + labelClearance;
      let rect = labelRect(x, labelY, z);
      while (labelY < baseY + labelClearance + labelMaxRise && labels.some((other) => overlaps(rect, other))) {
        labelY += labelClimb;
        rect = labelRect(x, labelY, z);
      }
      labels.push(rect);

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
      const subtotal = hourlyRoom ? hourlyRoom.price : pin.place.typical_price;
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
      this.updatePulse(pin, dt);
      pin.panel.faceYaw(camera, dt);
    }
  }

  /** Size, place and colour one marker for its venue's state. */
  private applyPinPose(pin: Pin): void {
    const isHighlighted = this.highlighted.has(pin.place.id);
    const presence = isHighlighted ? 1 : pin.visibility;
    const labelY = pin.height - 0.065 * (1 - pin.visibility) + (isHighlighted ? 0.014 : 0);
    const panelY = Math.max(needleWidth, labelY - pin.panel.faceHeight);
    pin.panel.entity.setLocalPosition(0, panelY, 0);
    pin.panel.setMuted(1 - presence);

    // The needle runs from the venue's spot into the underside of the label.
    const width = needleWidth * (isHighlighted ? 1.6 : 1);
    const reach = panelY + pin.panel.faceHeight - labelHeight / 2 - labelEdge / 2;
    pin.needle.setLocalPosition(0, reach / 2, 0);
    pin.needle.setLocalScale(width, reach, width);

    const radius = (has3D(pin.place) ? footRadius3D : footRadius) * (isHighlighted ? 1.3 : 1);
    pin.foot.setLocalScale(radius, 1, radius);
    pin.bullseye.enabled = has3D(pin.place);

    pin.inkSurface.emissive.lerp(mutedInk, inkColor, presence);
    pin.inkSurface.update();
    pin.fillSurface.emissive.lerp(mutedPaper, isHighlighted ? sunflowerColor : paperColor, presence);
    pin.fillSurface.update();
    this.setPulse(pin, isHighlighted);
  }

  private destroyPin(pin: Pin): void {
    this.setPulse(pin, false);
    pin.panel.destroy();
    pin.root.destroy();
    pin.inkSurface.destroy();
    pin.fillSurface.destroy();
  }

  destroy(): void {
    this.alive = false;
    this.revision++;
    this.abort.abort();
    for (const pin of this.pins) this.destroyPin(pin);
    this.root.destroy();
    this.pulseMesh.decRefCount();
    this.pulseMesh.destroy();
    for (const surface of this.materials) surface.destroy();
  }
}
