import * as pc from 'playcanvas';
import type { XRFilterSummary, XRPlaceData, XRStopData } from './bridgeTypes';
import { CanvasPanel3D } from './CanvasPanel3D';
import { assetBase, brass, child, clamp, damp, easeOutBack, fetchAssetJson, ivory, material, shape, target,
  type DebugLog, type HitTarget, type ModelLibrary, type XYZ } from './sceneSupport';

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
  pinAnchors: XYZ[];
}

interface OffDeckAnchor {
  position: XYZ;
  distanceM: number;
  compass: string;
}

interface Pin {
  place: XRPlaceData;
  root: pc.Entity;
  panel: CanvasPanel3D;
  stem: pc.Entity;
  head: pc.Entity;
  stemSurface: pc.StandardMaterial;
  headSurface: pc.StandardMaterial;
  targets: HitTarget[];
  index: number;
  matched: boolean;
  offDeck?: OffDeckAnchor;
  height: number;
  visibility: number;
}

const oneWayFare = 2.4;
const nearbyPinDistance = 0.15;
const labelClearance = 0.22;
const labelTierSpacing = 0.16;
// Segment anchors include this clearance above the sampled roof or ground.
const anchorClearance = 0.018;
const stemWidth = 0.006;
const pinStagger = 0.07;
const pinGrow = 0.42;
const stemColor = new pc.Color().fromString(brass);
const headColor = new pc.Color().fromString('#e8a849');
const offDeckColor = new pc.Color().fromString('#8fd3e6');
const mutedColor = new pc.Color().fromString('#93979c');
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

export class StationDioramaScene {
  readonly root: pc.Entity;
  private base: pc.Entity;
  private deckContent: pc.Entity;
  private stationMarker: pc.Entity;
  private stationColor: pc.StandardMaterial;
  private fallback: pc.Entity;
  private model?: pc.Entity;
  private materials: pc.StandardMaterial[] = [];
  private anchors: Record<string, SegmentAnchor> = {};
  private stop?: XRStopData;
  private places: XRPlaceData[] = [];
  private filtered = new Set<string>();
  private filters = defaultFilters;
  private pins: Pin[] = [];
  private revision = 0;
  private pinsShown = true;
  private pinClock = 10;
  private alive = true;
  private abort = new AbortController();

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, private models: ModelLibrary,
    log: DebugLog, private selectPlace: (id: string) => void,
  ) {
    this.root = child(parent, 'Station diorama');
    this.base = child(this.root, 'Station deck');
    this.deckContent = child(this.base, 'Station segment and markers');
    this.fallback = child(this.base, 'Station model fallback');

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
    shape(this.stationMarker, 'Ivory rim', 'cylinder', enamel, [0, 0.0015, 0], [0.045, 0.003, 0.045]);
    shape(this.stationMarker, 'Line enamel', 'cylinder', this.stationColor, [0, 0.003, 0], [0.040, 0.002, 0.040]);
    shape(this.stationMarker, 'T cap', 'box', enamel, [0, 0.004, -0.006], [0.020, 0.001, 0.004]);
    shape(this.stationMarker, 'T stem', 'box', enamel, [0, 0.004, 0.002], [0.004, 0.001, 0.012]);

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

    void fetchAssetJson<Record<string, SegmentAnchor>>(`${assetBase}segment-anchors.json`, this.abort.signal, log).then((data) => {
      if (!data || !this.alive) return;
      this.anchors = data;
      this.positionMarkers();
    });
  }

  async show(stop: XRStopData, segmentFile = `${assetBase}segment-${stop.stop_id}.glb`): Promise<void> {
    if (this.stop?.stop_id === stop.stop_id && this.stop.segment_asset === stop.segment_asset && this.model) return;
    const revision = ++this.revision;
    this.stop = stop;
    this.stationColor.diffuse.fromString(stop.primary_color);
    this.stationColor.update();
    this.model?.destroy();
    this.model = undefined;
    this.deckContent.setLocalPosition(0, 0, 0);
    this.fallback.enabled = true;
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
    this.deckContent.addChild(this.model);
    this.fallback.enabled = false;
  }

  setPlaces(places: XRPlaceData[], filtered: Set<string>): void {
    this.places = places;
    this.filtered = filtered;
    this.reconcilePins();
  }

  setFilters(filters: XRFilterSummary): void {
    this.filters = filters;
    this.updatePinLabels();
  }

  get targets(): HitTarget[] { return this.pinsShown ? this.pins.flatMap((pin) => pin.targets) : []; }

  /** Pins drop in one by one when shown and retract quickly when hidden. */
  setPinsShown(shown: boolean, immediate = false): void {
    if (shown && !this.pinsShown) this.pinClock = Math.min(this.pinClock, 0);
    this.pinsShown = shown;
    if (immediate) this.pinClock = shown ? 10 : 0;
    this.applyPinReveal();
  }

  private applyPinReveal(): void {
    this.pins.forEach((pin, rank) => {
      const grown = easeOutBack((this.pinClock - rank * pinStagger) / pinGrow, 1.9);
      const scale = Math.max(grown, 0.0001);
      pin.root.setLocalScale(scale, scale, scale);
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
        const root = child(this.deckContent, place.name);
        const panel = new CanvasPanel3D(this.device, root, place.name, 0.225, 0.075);
        const stemSurface = material(brass);
        const headSurface = material('#e8a849');
        shape(root, 'Roof collar', 'cylinder', stemSurface, [0, 0.002, 0], [0.023, 0.004, 0.023]);
        const stem = shape(root, 'Brass stem', 'cylinder', stemSurface, [0, 0, 0], [stemWidth, 1, stemWidth]);
        const head = child(root, 'Pin head');
        shape(head, 'Amber finial', 'sphere', headSurface, [0, 0, 0], [0.025, 0.023, 0.025]);
        const select = () => this.selectPlace(place.id);
        pin = { place, root, panel, stem, head, stemSurface, headSurface,
          targets: [panel.hit(select), target(head, [0.054, 0.044, 0.054], select)],
          index, matched, height: labelClearance, visibility: matched ? 1 : 0 };
      }
      pin.place = place;
      pin.index = place.pin_index ?? index;
      pin.matched = matched;
      return pin;
    });
    for (const pin of previous.values()) this.destroyPin(pin);
    this.positionMarkers();
    this.updatePinLabels();
    this.applyPinReveal();
  }

  private positionMarkers(): void {
    const stop = this.stop;
    const anchor = stop && this.anchors[stop.stop_id];
    const projection = anchor?.projection;
    const deckY = anchor?.deckY ?? 0;
    const station = projection && projectToDeck(projection, stop?.lat, stop?.lon);
    this.stationMarker.enabled = !!station;
    if (station) this.stationMarker.setLocalPosition(station[0], deckY + 0.0024, station[1]);

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
        muted: !pin.matched,
      });
    }
  }

  update(dt: number, camera: pc.Entity): void {
    const settled = this.pins.length * pinStagger + pinGrow;
    if (this.pinsShown ? this.pinClock < settled : this.pinClock > 0) {
      this.pinClock = this.pinsShown ? this.pinClock + dt : Math.max(0, Math.min(this.pinClock, settled) - dt * 4);
      this.applyPinReveal();
    }
    const fade = damp(dt, 10);
    for (const pin of this.pins) {
      const goal = pin.matched ? 1 : 0;
      if (pin.visibility !== goal) {
        pin.visibility = Math.abs(pin.visibility - goal) < 0.01 ? goal : pc.math.lerp(pin.visibility, goal, fade);
        this.applyPinPose(pin);
      }
      pin.panel.face(camera);
    }
  }

  private applyPinPose(pin: Pin): void {
    const opacity = pc.math.lerp(0.26, 1, pin.visibility);
    const labelY = pin.height - 0.065 * (1 - pin.visibility);
    const stemHeight = labelY - pin.panel.height * 0.47;
    pin.stem.setLocalPosition(0, stemHeight / 2, 0);
    pin.stem.setLocalScale(stemWidth, stemHeight, stemWidth);
    pin.head.setLocalPosition(0, stemHeight, 0);
    pin.stemSurface.diffuse.lerp(mutedColor, stemColor, pin.visibility);
    pin.headSurface.diffuse.lerp(mutedColor, pin.offDeck ? offDeckColor : headColor, pin.visibility);
    const blend = opacity < 1 ? pc.BLEND_NORMAL : pc.BLEND_NONE;
    for (const surface of [pin.stemSurface, pin.headSurface]) {
      surface.opacity = opacity;
      if (surface.blendType !== blend) {
        surface.blendType = blend;
        surface.depthWrite = opacity === 1;
      }
      surface.update();
    }
    pin.panel.entity.setLocalPosition(0, labelY, 0);
    pin.panel.setOpacity(opacity);
  }

  private destroyPin(pin: Pin): void {
    pin.panel.destroy();
    pin.root.destroy();
    pin.stemSurface.destroy();
    pin.headSurface.destroy();
  }

  destroy(): void {
    this.alive = false;
    this.revision++;
    this.abort.abort();
    for (const pin of this.pins) this.destroyPin(pin);
    this.root.destroy();
    for (const surface of this.materials) surface.destroy();
  }
}
