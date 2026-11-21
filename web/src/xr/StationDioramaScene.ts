import * as pc from 'playcanvas';
import type { XRFilterSummary, XRPlaceData, XRStopData } from './bridgeTypes';
import { CanvasPanel3D, CanvasSurface } from './CanvasPanel3D';
import { amber, assetBase, child, clamp, cyan, damp, fetchAssetJson, material, shape, target,
  type DebugLog, type HitTarget, type ModelLibrary, type XYZ } from './sceneSupport';

interface SegmentProjection {
  centerLat: number;
  centerLon: number;
  spanMeters: number;
  deckSize: number;
}

interface SegmentAnchor {
  lcdNode: string;
  dialNode: string;
  deckY: number;
  projection?: SegmentProjection;
  placeAnchors?: Record<string, XYZ>;
  pinAnchors: XYZ[];
}

interface Pin {
  place: XRPlaceData;
  root: pc.Entity;
  panel: CanvasPanel3D;
  stem: pc.Entity;
  surface: pc.StandardMaterial;
  targets: HitTarget[];
  index: number;
  matched: boolean;
  opacity: number;
}

interface Telemetry {
  nextArrivalMin: number | null;
  matchingCount: number;
}

const oneWayFare = 2.4;
const startAngle = 125;
const nearbyPinDistance = 0.15;
const labelClearance = 0.105;
const labelTierSpacing = 0.20;
const defaultFilters: XRFilterSummary = { craving: '', maxBudget: 20, startStopId: '', groupSize: 1, familyVisit: false };

function projectToDeck(proj: SegmentProjection, lat?: number, lon?: number): [number, number] | undefined {
  if (lat === undefined || lon === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const scale = proj.deckSize / proj.spanMeters;
  const dxMeters = (lon - proj.centerLon) * 111320 * Math.cos((proj.centerLat * Math.PI) / 180);
  const dzMeters = -(lat - proj.centerLat) * 110540;
  const limit = proj.deckSize * 0.48;
  return [clamp(dxMeters * scale, -limit, limit), clamp(dzMeters * scale, -limit, limit)];
}

export class StationDioramaScene {
  readonly root: pc.Entity;
  private base: pc.Entity;
  private deckContent: pc.Entity;
  private stationRing: pc.Entity;
  private fallback: pc.Entity;
  private fallbackDial: pc.Entity;
  private dial?: pc.Entity;
  private dialRest = new pc.Quat();
  private dialTurn = new pc.Quat();
  private dialAngle = startAngle;
  private lcd: CanvasSurface;
  private model?: pc.Entity;
  private materials: pc.StandardMaterial[] = [];
  private anchors: Record<string, SegmentAnchor> = {};
  private stop?: XRStopData;
  private places: XRPlaceData[] = [];
  private filtered = new Set<string>();
  private filters = defaultFilters;
  private telemetry = new Map<string, Telemetry>();
  private pins: Pin[] = [];
  private revision = 0;
  private rise = -0.14;
  private modelRise = 0;
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
    this.lcd = new CanvasSurface(device, 512, 256, false);

    const plinth = material('#2c244d', 0.19);
    const deck = material('#21405c', 0.22);
    const trim = material('#da6fc7', 0.38);
    const glass = material('#3f7d98', 0.20);
    const ring = material(cyan, 0.46, 0.68);
    this.materials.push(plinth, deck, trim, glass, ring);
    this.stationRing = shape(this.deckContent, 'T-station marker ring', 'torus', ring, [0, 0, 0], [0.068, 0.011, 0.068]);
    this.stationRing.enabled = false;
    shape(this.fallback, 'Pedestal', 'box', plinth, [0, -0.09, 0], [0.90, 0.18, 0.9]);
    shape(this.fallback, 'Deck', 'box', deck, [0, -0.008, 0], [0.91, 0.016, 0.91]);
    shape(this.fallback, 'Pedestal trim', 'box', trim, [0, -0.146, 0], [0.912, 0.006, 0.913]);
    const display = shape(this.fallback, 'LCD', 'plane', this.lcd.material, [-0.219, -0.086, 0.455], [0.326, 1, 0.155]);
    display.setLocalEulerAngles(90, 0, 0);
    this.fallbackDial = child(this.fallback, 'Dial', [0.063, -0.086, 0.471]);
    const knob = shape(this.fallbackDial, 'Budget dial', 'cylinder', glass, [0, 0, 0], [0.086, 0.023, 0.086]);
    knob.setLocalEulerAngles(90, 0, 0);
    shape(this.fallbackDial, 'Dial indicator', 'box', trim, [0, 0.024, 0.015], [0.009, 0.027, 0.004]);

    const blocks: XYZ[] = [[-0.31, 0.12, -0.25], [-0.13, 0.09, -0.34], [0.11, 0.15, -0.28],
      [0.30, 0.18, -0.30], [0.33, 0.075, -0.05], [-0.32, 0.08, 0.15]];
    blocks.forEach(([x, y, z], index) => {
      shape(this.fallback, 'Buildings', 'box', index % 2 ? glass : plinth, [x, y, z], [0.105, y * 2, 0.13]);
      for (let floor = 0.047; floor < y * 2 - 0.01; floor += 0.043) {
        shape(this.fallback, 'Window band', 'box', trim, [x, floor, z + 0.064], [0.093, 0.009, 0.003]);
      }
    });
    shape(this.fallback, 'Street', 'box', plinth, [0, 0.004, 0.11], [0.85, 0.008, 0.095]);

    void fetchAssetJson<Record<string, SegmentAnchor>>(`${assetBase}segment-anchors.json`, this.abort.signal, log).then((data) => {
      if (!data || !this.alive) return;
      this.anchors = data;
      if (this.model) this.bindModel(this.model);
      this.positionMarkers();
    });
  }

  async show(stop: XRStopData, segmentFile = `${assetBase}segment-${stop.stop_id}.glb`): Promise<void> {
    if (this.stop?.stop_id === stop.stop_id && this.stop.segment_asset === stop.segment_asset && this.model) return;
    const revision = ++this.revision;
    this.stop = stop;
    this.model?.destroy();
    this.model = undefined;
    this.dial = undefined;
    this.deckContent.setLocalPosition(0, 0, 0);
    this.fallback.enabled = true;
    this.rise = -0.20;
    this.base.setLocalPosition(0, this.rise, 0);
    this.reconcilePins();
    this.drawLcd();

    const assetUrl = (file: string): string => /^(?:\/|https?:)/.test(file) ? file : `${assetBase}${file}`;
    const url = assetUrl(segmentFile);
    let resource = await this.models.load(url);
    if (revision !== this.revision) return;
    if (!resource && stop.segment_asset && assetUrl(stop.segment_asset) !== url) {
      resource = await this.models.load(assetUrl(stop.segment_asset));
    }
    if (!resource || revision !== this.revision) return;
    this.model = resource.instantiateRenderEntity();
    this.modelRise = -0.065;
    this.deckContent.setLocalPosition(0, this.modelRise, 0);
    this.deckContent.addChild(this.model);
    this.bindModel(this.model);
    this.fallback.enabled = false;
  }

  private bindModel(model: pc.Entity): void {
    const segment = this.stop && this.anchors[this.stop.stop_id];
    const screen = model.findByName(segment?.lcdNode ?? 'LCD_Screen');
    if (screen instanceof pc.Entity) {
      for (const render of screen.findComponents('render')) {
        for (const mesh of render.meshInstances) mesh.material = this.lcd.material;
      }
    }
    const dial = model.findByName(segment?.dialNode ?? 'Rotary_Dial');
    if (dial instanceof pc.Entity && dial !== this.dial) {
      this.dial = dial;
      this.dialRest.copy(dial.getLocalRotation());
    }
  }

  setPlaces(places: XRPlaceData[], filtered: Set<string>): void {
    this.places = places;
    this.filtered = filtered;
    this.reconcilePins();
    this.drawLcd();
  }

  setFilters(filters: XRFilterSummary): void {
    this.filters = filters;
    this.updatePinLabels();
    this.drawLcd();
  }

  setTelemetry(stopId: string, nextArrivalMin: number | null, matchingCount: number): void {
    this.telemetry.set(stopId, { nextArrivalMin, matchingCount });
    if (this.stop?.stop_id === stopId) this.drawLcd();
  }

  get targets(): HitTarget[] { return this.pins.flatMap((pin) => pin.targets); }

  private drawLcd(): void {
    const stop = this.stop;
    if (!stop) return;
    const data = this.telemetry.get(stop.stop_id);
    const count = data?.matchingCount ?? this.pins.filter((pin) => pin.matched).length;
    const eta = data?.nextArrivalMin == null ? 'ETA UNAVAILABLE'
      : data.nextArrivalMin < 1 ? 'TRAIN DUE' : `NEXT TRAIN  ${Math.ceil(data.nextArrivalMin)} MIN`;
    const budget = `$${this.filters.maxBudget.toFixed(0)} CAP`;
    const name = stop.name.toUpperCase();
    const area = stop.area_code.toUpperCase();
    this.lcd.draw(JSON.stringify([area, name, eta, budget, count]), (ctx, width, height) => {
      ctx.fillStyle = '#04171b';
      ctx.fillRect(0, 0, width, height);
      ctx.strokeStyle = '#1c848e';
      ctx.lineWidth = 4;
      ctx.strokeRect(9, 9, width - 18, height - 18);
      ctx.fillStyle = '#61dce5';
      ctx.textBaseline = 'top';
      ctx.font = 'bold 32px monospace';
      ctx.fillText(area, 26, 26, width - 52);
      ctx.fillStyle = '#bcfbff';
      ctx.font = 'bold 40px monospace';
      ctx.fillText(name, 26, 69, width - 52);
      ctx.fillStyle = '#1c848e';
      ctx.fillRect(26, 121, width - 52, 2);
      ctx.fillStyle = '#87eff5';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(eta, 26, 139, width - 52);
      ctx.fillText(budget, 26, 190);
      ctx.textAlign = 'right';
      ctx.fillText(`${count} ${count === 1 ? 'SPOT FITS' : 'SPOTS FIT'}`, width - 26, 190);
      ctx.textAlign = 'left';
    });
  }

  private reconcilePins(): void {
    const stopId = this.stop?.stop_id;
    const places = this.places.filter((place) => place.stop_id === stopId);
    const previous = new Map(this.pins.map((pin) => [pin.place.id, pin]));
    this.pins = places.map((place, index) => {
      let pin = previous.get(place.id);
      if (pin) previous.delete(place.id);
      else {
        const root = child(this.deckContent, place.name);
        const panel = new CanvasPanel3D(this.device, root, place.name, 0.225, 0.075);
        const surface = material(cyan, 0.52, 0.99);
        const stem = shape(root, 'Pin stem', 'cylinder', surface, [0, 0, 0], [0.006, 1, 0.006]);
        shape(root, 'Pin tip', 'sphere', surface, [0, 0, 0], [0.022, 0.022, 0.022]);
        const select = () => this.selectPlace(place.id);
        pin = { place, root, panel, stem, surface, targets: [panel.hit(select), target(root, [0.054, 0.054, 0.054], select)],
          index, matched: false, opacity: 0.28 };
      }
      pin.place = place;
      pin.index = place.pin_index ?? index;
      pin.matched = this.filtered.has(place.id);
      return pin;
    });
    for (const pin of previous.values()) this.destroyPin(pin);
    this.positionMarkers();
    this.updatePinLabels();
  }

  private positionMarkers(): void {
    const stop = this.stop;
    const anchor = stop && this.anchors[stop.stop_id];
    const projection = anchor?.projection;
    const deckY = anchor?.deckY ?? 0;
    const station = projection && projectToDeck(projection, stop?.lat, stop?.lon);
    this.stationRing.enabled = !!station;
    if (station) this.stationRing.setLocalPosition(station[0], deckY + 0.006, station[1]);

    const placements = this.pins.map((pin) => {
      const exact = anchor?.placeAnchors?.[pin.place.id];
      const projected = !exact && projection && projectToDeck(projection, pin.place.lat, pin.place.lon);
      const position: XYZ = exact ?? (projected ? [projected[0], deckY + 0.08, projected[1]]
        : anchor?.pinAnchors?.[pin.index] ?? [(pin.index % 3 - 1) * 0.25, 0.11, Math.floor(pin.index / 3) * 0.23 - 0.08]);
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

      const stemHeight = labelY - baseY;
      pin.root.setLocalPosition(x, baseY, z);
      pin.panel.entity.setLocalPosition(0, stemHeight, 0);
      pin.stem.setLocalPosition(0, stemHeight / 2, 0);
      pin.stem.setLocalScale(0.006, stemHeight, 0.006);
    }
  }

  private updatePinLabels(): void {
    for (const pin of this.pins) {
      const fare = this.filters.startStopId === pin.place.stop_id ? 0 : oneWayFare;
      const hourlyRoom = pin.place.rooms.find((room) => /hour/i.test(room.price_unit));
      const subtotal = hourlyRoom ? hourlyRoom.price / Math.max(1, this.filters.groupSize) : pin.place.typical_price;
      const total = subtotal + fare;
      const accent = total <= this.filters.maxBudget ? cyan : amber;
      pin.panel.setText([
        { text: pin.place.name, size: 110, weight: 700 },
        { text: `$${total.toFixed(2)} incl. fare`, color: accent, size: 78 },
      ], accent);
      const color = new pc.Color().fromString(accent);
      pin.surface.diffuse = color;
      pin.surface.emissive = color.mulScalar(0.52);
    }
  }

  update(dt: number, camera: pc.Entity): void {
    this.rise = pc.math.lerp(this.rise, 0, damp(dt, 6));
    this.base.setLocalPosition(0, this.rise, 0);
    if (this.model && this.modelRise !== 0) {
      this.modelRise = Math.min(0, this.modelRise * (1 - damp(dt, 8)) + 0.0002);
      this.deckContent.setLocalPosition(0, this.modelRise, 0);
    }
    const targetAngle = startAngle - clamp((this.filters.maxBudget - 8) / 52, 0, 1) * 250;
    this.dialAngle = pc.math.lerp(this.dialAngle, targetAngle, damp(dt, 9));
    this.fallbackDial.setLocalEulerAngles(0, 0, this.dialAngle);
    if (this.dial) {
      this.dialTurn.setFromEulerAngles(0, 0, this.dialAngle).mul2(this.dialRest, this.dialTurn);
      this.dial.setLocalRotation(this.dialTurn);
    }

    for (const pin of this.pins) {
      pin.opacity = pc.math.lerp(pin.opacity, pin.matched ? 1 : 0.29, damp(dt, 10));
      pin.surface.opacity = pin.opacity * 0.99;
      pin.panel.setOpacity(pin.opacity);
      pin.panel.face(camera);
    }
  }

  private destroyPin(pin: Pin): void {
    pin.panel.destroy();
    pin.root.destroy();
    pin.surface.destroy();
  }

  destroy(): void {
    this.alive = false;
    this.revision++;
    this.abort.abort();
    for (const pin of this.pins) this.destroyPin(pin);
    this.root.destroy();
    this.lcd.destroy();
    for (const surface of this.materials) surface.destroy();
  }
}
