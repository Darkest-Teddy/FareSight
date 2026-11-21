import * as pc from 'playcanvas';
import type { XRPlaceData, XRStopData, XRVehicleData } from './bridgeTypes';
import { CanvasPanel3D } from './CanvasPanel3D';
import { MapLabels } from './MapLabels';
import { assetBase, brass, child, clamp, damp, fetchAssetJson, material, project, shape, target,
  type DebugLog, type HitTarget, type ModelLibrary, type XYZ } from './sceneSupport';

interface StationAnchor {
  topPos: XYZ;
  segmentFile: string;
}

interface PathFile {
  lines: { id: string; routeId: string; name: string; color: string; points: XYZ[] }[];
}

interface Track {
  points: pc.Vec3[];
  distances: number[];
}

interface Beacon {
  stop: XRStopData;
  root: pc.Entity;
  ring: pc.Entity;
  ringSurface: pc.StandardMaterial;
  burst: pc.Entity;
  burstSurface: pc.StandardMaterial;
  burstClock: number;
  glow: number;
  callout: pc.Entity;
  stem: pc.Entity;
  panel: CanvasPanel3D;
  actions: HitTarget[];
}

interface Train {
  root: pc.Entity;
  surface: pc.StandardMaterial;
  track?: Track;
  from: number;
  to: number;
  elapsed: number;
}

interface LineSurface {
  material: pc.StandardMaterial;
  diffuse: pc.Color;
  emissive: pc.Color;
  level: number;
}

const pollInterval = 10;
// Trains ride on top of the tube rather than inside it.
const trainLift = 0.0102;
const maxSnapError = 0.03 ** 2;
const burstTime = 0.7;

function makeTrack(points: XYZ[]): Track {
  const positions = points.map((point) => new pc.Vec3(...point));
  const distances = positions.map(() => 0);
  for (let i = 1; i < points.length; i++) {
    distances[i] = distances[i - 1] + positions[i - 1].distance(positions[i]);
  }
  return { points: positions, distances };
}

function snapToTrack(track: Track, x: number, z: number): { distance: number; error: number } {
  let error = Infinity;
  let distance = 0;
  for (let i = 1; i < track.points.length; i++) {
    const start = track.points[i - 1];
    const end = track.points[i];
    const dx = end.x - start.x;
    const dz = end.z - start.z;
    const lengthSquared = dx * dx + dz * dz;
    if (!lengthSquared) continue;
    const t = clamp(((x - start.x) * dx + (z - start.z) * dz) / lengthSquared, 0, 1);
    const candidate = (x - start.x - dx * t) ** 2 + (z - start.z - dz * t) ** 2;
    if (candidate >= error) continue;
    error = candidate;
    distance = pc.math.lerp(track.distances[i - 1], track.distances[i], t);
  }
  return { distance, error };
}

function sampleTrack(track: Track, distance: number, position: pc.Vec3): void {
  let low = 1;
  let high = track.distances.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (track.distances[mid] < distance) low = mid + 1;
    else high = mid;
  }
  const start = track.distances[low - 1];
  const length = track.distances[low] - start;
  position.lerp(track.points[low - 1], track.points[low], length ? clamp((distance - start) / length, 0, 1) : 0);
}

export class MapSculptureScene {
  readonly root: pc.Entity;
  private fallback: pc.Entity;
  private beaconRoot: pc.Entity;
  private trainRoot: pc.Entity;
  private beacons: Beacon[] = [];
  private materials: pc.StandardMaterial[] = [];
  private beaconStem: pc.StandardMaterial;
  private ringMesh: pc.Mesh;
  private labels: MapLabels;
  private faded: pc.StandardMaterial[] = [];
  private lineSurfaces = new Map<string, LineSurface>();
  private tracks = new Map<string, Track[]>();
  private anchors: Record<string, StationAnchor> = {};
  private places: XRPlaceData[] = [];
  private filtered = new Set<string>();
  private vehicles: XRVehicleData[] = [];
  private trains = new Map<string, Train>();
  private trainModel?: pc.ContainerResource;
  private alive = true;
  private abort = new AbortController();
  private trainPosition = new pc.Vec3();
  private trainLookAt = new pc.Vec3();
  private selected?: string;
  private hovered?: string;
  private opacity = 1;
  private immersive = false;
  private clock = 0;

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, models: ModelLibrary,
    log: DebugLog, private selectStop: (id: string) => void,
    canvas: HTMLCanvasElement, hoverStop: (id: string | undefined) => void,
  ) {
    this.root = child(parent, 'Boston subway sculpture');
    this.fallback = child(this.root, 'Map sculpture fallback');
    this.beaconRoot = child(this.root, 'Station beacons');
    this.trainRoot = child(this.root, 'Live trains');
    this.beaconStem = material(brass);
    this.ringMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({ tubeRadius: 0.035, ringRadius: 0.5, segments: 48, sides: 8 }));
    // Rings share this mesh; hold a reference so rebuilding the stops does not free it.
    this.ringMesh.incRefCount();
    this.labels = new MapLabels(canvas, (id) => this.selectStop(id), hoverStop);

    const deck = material('#1a2233');
    this.materials.push(this.beaconStem, deck);
    shape(this.fallback, 'Map base', 'box', deck, [0, 0.02, 0], [1.5, 0.04, 1.05]);

    const signal = this.abort.signal;
    void fetchAssetJson<Record<string, StationAnchor>>(`${assetBase}station-anchors.json`, signal, log).then((anchors) => {
      if (!anchors || !this.alive) return;
      this.anchors = anchors;
      this.positionBeacons();
    });
    void fetchAssetJson<PathFile>(`${assetBase}mbta-3d-paths.json`, signal, log).then((data) => {
      if (!Array.isArray(data?.lines) || !this.alive) return;
      for (const line of data.lines) {
        if (line.points.length < 2) continue;
        const track = makeTrack(line.points);
        for (const key of new Set([line.id, line.routeId])) {
          const routes = this.tracks.get(key) ?? [];
          routes.push(track);
          this.tracks.set(key, routes);
        }
      }
      this.setVehicles(this.vehicles);
    });
    void models.load(`${assetBase}boston-map-sculpture.glb`).then((resource) => {
      if (!resource || !this.alive) return;
      const model = resource.instantiateRenderEntity();
      for (const render of model.findComponents('render') as pc.RenderComponent[]) {
        for (const mesh of render.meshInstances) {
          const surface = mesh.material;
          if (!(surface instanceof pc.StandardMaterial)) continue;
          // Dithered opacity keeps the model in the opaque pass, so the dive can dissolve it
          // without re-sorting or compiling a new shader mid-flight.
          surface.opacityDither = pc.DITHER_BAYER8;
          surface.update();
          this.faded.push(surface);
          const line = /^Lacquer (#[0-9a-f]{6})$/i.exec(mesh.node.name);
          if (line) {
            this.lineSurfaces.set(line[1].toLowerCase(),
              { material: surface, diffuse: surface.diffuse.clone(), emissive: surface.emissive.clone(), level: 1 });
          }
        }
      }
      this.root.addChild(model);
      this.fallback.enabled = false;
      this.applyOpacity();
    });
    void models.load(`${assetBase}mbta-train-capsule.glb`).then((resource) => {
      if (!resource || !this.alive) return;
      this.trainModel = resource;
      for (const train of this.trains.values()) this.attachTrainModel(train);
    });
  }

  setStops(stops: XRStopData[]): void {
    for (const beacon of this.beacons) this.destroyBeacon(beacon);
    this.beacons = stops.map((stop) => {
      const root = child(this.beaconRoot, stop.name);
      const ringSurface = material('#ffffff', 1, 0);
      const burstSurface = material('#ffffff', 1, 0);
      for (const surface of [ringSurface, burstSurface]) {
        surface.useLighting = false;
        surface.update();
      }
      const ring = this.addRing(root, 'Focus ring', ringSurface);
      const burst = this.addRing(root, 'Selection burst', burstSurface);
      burst.enabled = false;
      const callout = child(root, 'Immersive callout');
      callout.enabled = this.immersive;
      const panel = new CanvasPanel3D(this.device, callout, stop.name, 0.23, 0.078, [0, 0.1, 0]);
      const stem = shape(callout, 'Callout stem', 'cylinder', this.beaconStem, [0, 0, 0], [0.004, 1, 0.004]);
      const select = () => this.selectStop(stop.stop_id);
      const hit = target(root, [0.07, 0.05, 0.07], select, stop.stop_id);
      const panelHit = panel.hit(select);
      panelHit.key = stop.stop_id;
      return { stop, root, ring, ringSurface, burst, burstSurface, burstClock: burstTime, glow: 0,
        callout, stem, panel, actions: [panelHit, hit] };
    });
    this.labels.setStops(stops);
    this.labels.setSelected(this.selected);
    this.positionBeacons();
    this.updateLabels();
  }

  private addRing(parent: pc.Entity, name: string, surface: pc.StandardMaterial): pc.Entity {
    const ring = child(parent, name, [0, 0.0015, 0]);
    ring.addComponent('render', { meshInstances: [new pc.MeshInstance(this.ringMesh, surface)] });
    ring.setLocalScale(0.05, 0.02, 0.05);
    return ring;
  }

  setPlaces(places: XRPlaceData[], filtered: Set<string>): void {
    this.places = places;
    this.filtered = filtered;
    this.updateLabels();
  }

  select(id: string | undefined): void {
    this.selected = id;
    this.labels.setSelected(id);
    this.updateLabels();
  }

  /** Highlight a stop from the 3D view, a label, or the stop list. */
  setHover(id: string | undefined): void {
    this.hovered = id;
    this.labels.setHover(id);
  }

  /** Fire the expanding ring that acknowledges a click before the camera moves. */
  pulse(id: string): void {
    const beacon = this.beacons.find((entry) => entry.stop.stop_id === id);
    if (beacon) beacon.burstClock = 0;
  }

  /** Station marker top in map-local space. */
  stopPosition(id: string): pc.Vec3 | undefined {
    return this.beacons.find((beacon) => beacon.stop.stop_id === id)?.root.getLocalPosition();
  }

  /** 1 is solid; lower values dissolve the whole sculpture during the station dive. */
  setOpacity(value: number): void {
    if (value === this.opacity) return;
    this.opacity = value;
    this.applyOpacity();
  }

  private applyOpacity(): void {
    for (const surface of this.faded) {
      surface.opacity = this.opacity;
      surface.update();
    }
    this.trainRoot.enabled = this.opacity > 0.6;
  }

  /** Headsets get 3D callouts; flat screens get the HTML labels. */
  setImmersive(active: boolean): void {
    this.immersive = active;
    for (const beacon of this.beacons) beacon.callout.enabled = active;
  }

  segmentFile(id: string): string | undefined {
    const file = this.anchors[id]?.segmentFile;
    return file && (/^(?:\/|https?:)/.test(file) ? file : `${assetBase}${file}`);
  }

  get targets(): HitTarget[] { return this.beacons.flatMap((beacon) => beacon.actions); }

  private positionBeacons(): void {
    for (const { stop, root } of this.beacons) {
      const [x, z] = project(stop.lat, stop.lon);
      const position: XYZ = this.anchors[stop.stop_id]?.topPos ?? [x, 0.07, z];
      root.setLocalPosition(...position);
    }
    // Stagger neighbouring headset callouts so they do not overlap.
    const ordered = [...this.beacons].sort((a, b) => a.root.getLocalPosition().x - b.root.getLocalPosition().x);
    ordered.forEach(({ root, panel, stem }, index) => {
      const position = root.getLocalPosition();
      const nearby = ordered.slice(0, index).reverse().find((other) => {
        const point = other.root.getLocalPosition();
        return position.x - point.x < panel.width * 0.9 && Math.abs(position.z - point.z) < 0.15;
      });
      const raised = nearby?.panel.entity.getLocalPosition().y === 0.1;
      const panelY = raised ? 0.19 : 0.1;
      const stemTop = panelY - panel.height / 2;
      panel.entity.setLocalPosition(0, panelY, 0);
      stem.setLocalPosition(0, stemTop / 2, 0);
      stem.setLocalScale(0.004, stemTop, 0.004);
    });
  }

  private updateLabels(): void {
    const counts = new Map<string, number>();
    for (const place of this.places) {
      if (this.filtered.has(place.id)) counts.set(place.stop_id, (counts.get(place.stop_id) ?? 0) + 1);
    }
    for (const { stop, panel } of this.beacons) {
      const count = counts.get(stop.stop_id) ?? 0;
      panel.setCallout(stop.name, `${count} matching ${count === 1 ? 'spot' : 'spots'}`,
        { selected: this.selected === stop.stop_id });
    }
    this.labels.setCounts(counts);
  }

  setVehicles(vehicles: XRVehicleData[]): void {
    this.vehicles = vehicles;
    const seen = new Set<string>();
    for (const vehicle of vehicles) {
      if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;
      const [x, z] = project(vehicle.lat, vehicle.lon);
      if (Math.abs(x) > 0.78 || Math.abs(z) > 0.55) continue;
      const candidates = this.tracks.get(vehicle.route_id) ?? [];
      let snap: ReturnType<typeof snapToTrack> | undefined;
      let track: Track | undefined;
      for (const candidate of candidates) {
        const hit = snapToTrack(candidate, x, z);
        if (!snap || hit.error < snap.error) {
          snap = hit;
          track = candidate;
        }
      }
      // Only draw trains that sit on a modelled line; anything else would float off the map.
      if (!track || !snap || snap.error > maxSnapError) continue;
      seen.add(vehicle.id);
      let train = this.trains.get(vehicle.id);
      const isNew = !train;
      if (!train) {
        const root = child(this.trainRoot, vehicle.label || vehicle.id);
        const surface = material(vehicle.line_color, 0.75);
        train = { root, surface, elapsed: pollInterval, from: 0, to: 0 };
        this.trains.set(vehicle.id, train);
        this.attachTrainModel(train);
      }
      if (train.track === track) {
        train.from = pc.math.lerp(train.from, train.to, clamp(train.elapsed / pollInterval, 0, 1));
      } else train.from = snap.distance;
      train.to = snap.distance;
      train.track = track;
      train.elapsed = 0;
      if (Math.abs(train.to - train.from) < 0.00001 && vehicle.bearing != null) {
        train.root.setLocalEulerAngles(0, -vehicle.bearing, 0);
      }
      if (isNew) this.updateTrain(train, 0);
    }
    for (const [id, train] of this.trains) {
      if (seen.has(id)) continue;
      train.root.destroy();
      train.surface.destroy();
      this.trains.delete(id);
    }
  }

  private attachTrainModel(train: Train): void {
    if (!this.trainModel) return;
    const model = this.trainModel.instantiateRenderEntity();
    for (const render of model.findComponents('render')) {
      for (const mesh of render.meshInstances) mesh.material = train.surface;
    }
    model.setLocalScale(1.25, 1.25, 1.25);
    train.root.addChild(model);
  }

  private updateTrain(train: Train, dt: number): void {
    if (!train.track) return;
    train.elapsed += dt;
    const progress = clamp(train.elapsed / pollInterval, 0, 1);
    const distance = pc.math.lerp(train.from, train.to, progress);
    sampleTrack(train.track, distance, this.trainPosition);
    this.trainPosition.y += trainLift;
    train.root.setLocalPosition(this.trainPosition);
    if (Math.abs(train.to - train.from) > 0.00001) {
      const step = Math.sign(train.to - train.from) * 0.002;
      const length = train.track.distances[train.track.distances.length - 1];
      sampleTrack(train.track, clamp(distance + step, 0, length), this.trainLookAt);
      this.trainLookAt.y += trainLift;
      if (this.trainLookAt.distanceSq(this.trainPosition) > 1e-12) {
        this.root.getWorldTransform().transformPoint(this.trainLookAt, this.trainLookAt);
        train.root.lookAt(this.trainLookAt);
      }
    }
  }

  /** `labelOpacity` fades the HTML labels; 0 hides them (station view, headset, mid-dive). */
  update(dt: number, camera: pc.Entity, lens: pc.CameraComponent, labelOpacity: number): void {
    this.clock += dt;
    const visible = this.root.enabled;
    const worldOf = (id: string) => this.beacons.find((beacon) => beacon.stop.stop_id === id)?.root.getPosition();
    this.labels.update(lens, worldOf, visible && !this.immersive ? labelOpacity : 0);
    if (!visible) return;

    const focus = this.hovered ?? undefined;
    const focusColor = this.beacons.find((beacon) => beacon.stop.stop_id === focus)?.stop.primary_color.toLowerCase();
    const blend = damp(dt, 9);
    for (const [color, line] of this.lineSurfaces) {
      const goal = !focusColor || focusColor === color ? 1 : 0.32;
      if (Math.abs(line.level - goal) < 0.002) continue;
      line.level = pc.math.lerp(line.level, goal, blend);
      line.material.diffuse.copy(line.diffuse).mulScalar(line.level);
      line.material.emissive.copy(line.emissive).mulScalar(line.level);
      line.material.update();
    }

    for (const beacon of this.beacons) {
      if (this.immersive) beacon.panel.face(camera);
      const id = beacon.stop.stop_id;
      const goal = id === this.hovered ? 1 : id === this.selected ? 0.75 : 0;
      beacon.glow = pc.math.lerp(beacon.glow, goal, blend);
      // Idle rings breathe gently so the five explorable stops read as clickable.
      const breath = 0.5 + 0.5 * Math.sin(this.clock * 2.1 + beacon.root.getLocalPosition().x * 9);
      const size = pc.math.lerp(0.046 + 0.01 * breath, 0.058, beacon.glow);
      beacon.ring.setLocalScale(size, 0.02, size);
      beacon.ringSurface.opacity = this.opacity * pc.math.lerp(0.28 + 0.2 * breath, 1, beacon.glow);
      beacon.ringSurface.update();

      const bursting = beacon.burstClock < burstTime;
      if (beacon.burst.enabled !== bursting) beacon.burst.enabled = bursting;
      if (bursting) {
        beacon.burstClock += dt;
        const t = clamp(beacon.burstClock / burstTime, 0, 1);
        const reach = 0.05 + 0.16 * (1 - (1 - t) ** 3);
        beacon.burst.setLocalScale(reach, 0.02, reach);
        beacon.burstSurface.opacity = this.opacity * (1 - t) ** 2;
        beacon.burstSurface.update();
      }
    }
    for (const train of this.trains.values()) this.updateTrain(train, dt);
  }

  private destroyBeacon(beacon: Beacon): void {
    beacon.panel.destroy();
    beacon.root.destroy();
    beacon.ringSurface.destroy();
    beacon.burstSurface.destroy();
  }

  destroy(): void {
    this.abort.abort();
    this.alive = false;
    for (const beacon of this.beacons) this.destroyBeacon(beacon);
    this.labels.destroy();
    this.root.destroy();
    this.ringMesh.decRefCount();
    this.ringMesh.destroy();
    for (const { surface } of this.trains.values()) surface.destroy();
    for (const surface of this.materials) surface.destroy();
    this.trains.clear();
  }
}
