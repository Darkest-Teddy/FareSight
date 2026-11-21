import * as pc from 'playcanvas';
import type { XRPlaceData, XRStopData, XRVehicleData } from './bridgeTypes';
import { CanvasPanel3D } from './CanvasPanel3D';
import { assetBase, child, clamp, cyan, fetchAssetJson, material, project, shape, target,
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
  panel: CanvasPanel3D;
  actions: HitTarget[];
}

interface Train {
  root: pc.Entity;
  fallback: pc.Entity;
  surface: pc.StandardMaterial;
  track?: Track;
  from: number;
  to: number;
  elapsed: number;
}

const pollInterval = 10;

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
  private beaconSurface: pc.StandardMaterial;
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

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, models: ModelLibrary,
    log: DebugLog, private selectStop: (id: string) => void,
  ) {
    this.root = child(parent, 'Boston subway sculpture');
    this.fallback = child(this.root, 'Map sculpture fallback');
    this.beaconRoot = child(this.root, 'Station beacons');
    this.trainRoot = child(this.root, 'Live trains');
    this.beaconSurface = material(cyan, 0.55);

    const deck = material('#234660', 0.16);
    const edge = material('#197486', 0.28);
    const water = material('#183852', 0.10);
    this.materials.push(this.beaconSurface, deck, edge, water);
    shape(this.fallback, 'Acrylic base', 'box', deck, [0, 0.028, 0], [1.5, 0.055, 1.05]);
    shape(this.fallback, 'Lit edge', 'box', edge, [0, 0.008, 0], [1.515, 0.012, 1.065]);
    const river = shape(this.fallback, 'Charles River', 'box', water, [0, 0.056, -0.13], [1.49, 0.007, 0.14]);
    river.setLocalEulerAngles(0, -14, 0);

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
      this.root.addChild(resource.instantiateRenderEntity());
      this.fallback.enabled = false;
    });
    void models.load(`${assetBase}mbta-train-capsule.glb`).then((resource) => {
      if (!resource || !this.alive) return;
      this.trainModel = resource;
      for (const train of this.trains.values()) this.attachTrainModel(train);
    });
  }

  setStops(stops: XRStopData[]): void {
    for (const beacon of this.beacons) {
      beacon.panel.destroy();
      beacon.root.destroy();
    }
    this.beacons = stops.map((stop) => {
      const root = child(this.beaconRoot, stop.name);
      const panel = new CanvasPanel3D(this.device, root, stop.name, 0.23, 0.078, [0, 0.077, 0]);
      shape(root, 'Station light', 'sphere', this.beaconSurface, [0, 0.017, 0], [0.033, 0.033, 0.033]);
      shape(root, 'Beacon stem', 'cylinder', this.beaconSurface, [0, 0.036, 0], [0.007, 0.055, 0.007]);
      const select = () => this.selectStop(stop.stop_id);
      return { stop, root, panel, actions: [panel.hit(select), target(root, [0.075, 0.07, 0.075], select)] };
    });
    this.positionBeacons();
    this.updateLabels();
  }

  setPlaces(places: XRPlaceData[], filtered: Set<string>): void {
    this.places = places;
    this.filtered = filtered;
    this.updateLabels();
  }

  select(id: string | undefined): void {
    this.selected = id;
    this.updateLabels();
  }

  stopPosition(id: string): pc.Vec3 | undefined {
    return this.beacons.find((beacon) => beacon.stop.stop_id === id)?.root.getLocalPosition();
  }

  segmentFile(id: string): string | undefined {
    const file = this.anchors[id]?.segmentFile;
    return file && (/^(?:\/|https?:)/.test(file) ? file : `${assetBase}${file}`);
  }

  get targets(): HitTarget[] { return this.beacons.flatMap((beacon) => beacon.actions); }

  private positionBeacons(): void {
    for (const { stop, root } of this.beacons) {
      const [x, z] = project(stop.lat, stop.lon);
      const position: XYZ = this.anchors[stop.stop_id]?.topPos ?? [x, 0.08, z];
      root.setLocalPosition(...position);
    }
    const ordered = [...this.beacons].sort((a, b) => a.root.getLocalPosition().x - b.root.getLocalPosition().x);
    ordered.forEach(({ root, panel }, index) => {
      const position = root.getLocalPosition();
      const nearby = ordered.slice(0, index).reverse().find((other) => {
        const point = other.root.getLocalPosition();
        return position.x - point.x < panel.width * 0.9 && Math.abs(position.z - point.z) < 0.15;
      });
      const raised = nearby?.panel.entity.getLocalPosition().y === 0.087;
      panel.entity.setLocalPosition(0, raised ? 0.159 : 0.087, 0);
    });
  }

  private updateLabels(): void {
    const counts = new Map<string, number>();
    for (const place of this.places) {
      if (this.filtered.has(place.id)) counts.set(place.stop_id, (counts.get(place.stop_id) ?? 0) + 1);
    }
    for (const { stop, panel } of this.beacons) {
      const count = counts.get(stop.stop_id) ?? 0;
      panel.setText([
        { text: stop.name, size: 105, weight: 700 },
        { text: `${count} matching ${count === 1 ? 'spot' : 'spots'}`, color: cyan, size: 74, weight: 500 },
      ], this.selected === stop.stop_id ? cyan : stop.primary_color);
    }
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
      seen.add(vehicle.id);
      let train = this.trains.get(vehicle.id);
      const isNew = !train;
      if (!train) {
        const root = child(this.trainRoot, vehicle.label || vehicle.id);
        const surface = material(vehicle.line_color, 0.6);
        const fallback = shape(root, 'Train capsule', 'sphere', surface, [0, 0, 0], [0.012, 0.012, 0.032]);
        train = { root, fallback, surface, elapsed: pollInterval, from: 0, to: 0 };
        this.trains.set(vehicle.id, train);
        this.attachTrainModel(train);
      }
      if (track && snap) {
        if (train.track === track) {
          train.from = pc.math.lerp(train.from, train.to, clamp(train.elapsed / pollInterval, 0, 1));
        } else train.from = snap.distance;
        train.to = snap.distance;
        train.track = track;
        train.elapsed = 0;
        if (Math.abs(train.to - train.from) < 0.00001 && vehicle.bearing != null) {
          train.root.setLocalEulerAngles(0, -vehicle.bearing, 0);
        }
      } else {
        train.track = undefined;
        train.root.setLocalPosition(x, 0.09, z);
        train.root.setLocalEulerAngles(0, -(vehicle.bearing ?? 0), 0);
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
    train.root.addChild(model);
    train.fallback.enabled = false;
  }

  private updateTrain(train: Train, dt: number): void {
    if (!train.track) return;
    train.elapsed += dt;
    const progress = clamp(train.elapsed / pollInterval, 0, 1);
    const distance = pc.math.lerp(train.from, train.to, progress);
    sampleTrack(train.track, distance, this.trainPosition);
    train.root.setLocalPosition(this.trainPosition);
    if (Math.abs(train.to - train.from) > 0.00001) {
      const step = Math.sign(train.to - train.from) * 0.002;
      const length = train.track.distances[train.track.distances.length - 1];
      sampleTrack(train.track, clamp(distance + step, 0, length), this.trainLookAt);
      if (this.trainLookAt.distanceSq(this.trainPosition) > 1e-12) {
        this.root.getWorldTransform().transformPoint(this.trainLookAt, this.trainLookAt);
        train.root.lookAt(this.trainLookAt);
      }
    }
  }

  update(dt: number, camera: pc.Entity): void {
    if (this.root.enabled) {
      for (const beacon of this.beacons) beacon.panel.face(camera);
    }
    for (const train of this.trains.values()) this.updateTrain(train, dt);
  }

  destroy(): void {
    this.abort.abort();
    this.alive = false;
    for (const { panel } of this.beacons) panel.destroy();
    this.root.destroy();
    for (const { surface } of this.trains.values()) surface.destroy();
    for (const surface of this.materials) surface.destroy();
    this.trains.clear();
  }
}
