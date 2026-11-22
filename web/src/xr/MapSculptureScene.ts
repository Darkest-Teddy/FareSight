import * as pc from 'playcanvas';
import { countPreviewsByStop } from '../data/preview3D';
import type { XRPlaceData, XRStopData, XRVehicleData } from './bridgeTypes';
import { PhysicalPlaque } from './CanvasPanel3D';
import { jarvisPoints, type JarvisReveal } from './JarvisReveal';
import { MapLabels, type Box, type KeepClear } from './MapLabels';
import { assetBase, brass, child, clamp, damp, fetchAssetJson, highlightInk, ink, material, project, shape, target,
  type DebugLog, type HitTarget, type ModelLibrary, type XYZ } from './sceneSupport';

interface StationAnchor {
  topPos: XYZ;
  segmentFile: string;
}

/** One landmark of the sculpture and the box it fills, in map space (modeling/landmarks.mjs). */
interface LandmarkAnchor {
  id: string;
  min: XYZ;
  max: XYZ;
}

function isStationAnchor(value: unknown): value is StationAnchor {
  if (!value || typeof value !== 'object') return false;
  const { topPos, segmentFile } = value as Record<string, unknown>;
  return Array.isArray(topPos) && topPos.length === 3 && topPos.every(Number.isFinite)
    && typeof segmentFile === 'string' && segmentFile.trim().length > 0;
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
  panel: PhysicalPlaque;
  actions: HitTarget[];
}

/** Green-B, Green-C ... all share the Green Line LRV; everything else is its own line. */
const familyOf = (routeId: string): string => {
  const family = String(routeId).split('-')[0].toLowerCase();
  return family === 'green' || family === 'red' || family === 'orange' || family === 'blue'
    ? family
    : 'green';
};

interface Train {
  root: pc.Entity;
  family: string;
  track?: Track;
  /**
   * Which way along the track the train faces: +1 with increasing distance, -1 against.
   *
   * Kept on the train because a stopped vehicle gives nothing to infer it from -- its reported
   * position has not changed -- and without it a halted train keeps whatever rotation it last had,
   * or none at all if it arrived stopped, and sits skewed across the line.
   */
  heading: number;
  from: number;
  to: number;
  elapsed: number;
  /** Seconds the current move from `from` to `to` should take: the gap between the last two fixes. */
  duration: number;
  /** `clock` at the last position fix, to time the next move. */
  seenAt: number;
  /** A hair of extra height, different per train, so two parked on one spot never z-fight. */
  lift: number;
}

interface LineSurface {
  material: pc.StandardMaterial;
  diffuse: pc.Color;
  emissive: pc.Color;
  level: number;
}

/**
 * How long a train takes to glide to a new fix, in seconds. It is measured per train as the gap
 * between its last two fixes, so the motion keeps pace with whatever rate the app polls at; these
 * only bound it. The first is also the pace used before a second fix has arrived.
 */
const defaultGlide = 8;
const minGlide = 2;
const maxGlide = 30;
// Trains ride on top of the plate rather than inside it. Half the plate thickness clears it; the
// old 0.0102 was sized for the swept tube the lines used to be and now floats them well above it.
const trainLift = 0.0014;

/**
 * Flowcast's train is 45 m long and 2.7 m wide: a 17:1 sliver, correct for the real-scale map it
 * was built for. This map is a diagram, and everything on it is already exaggerated -- the line
 * plates stand for roughly 55 m of ground, about twenty times a real track.
 *
 * Length is the binding constraint. At this scale a consist already covers nine tenths of the
 * average Green Line B stop gap (0.072 units), so it cannot grow without spanning whole stations.
 * The cross-section is lifted instead.
 *
 * The width is set by the line plate, which is 0.0084 across. A train narrower than that -- the
 * old 0.0065 -- sits inside its own line and, being the line's colour, disappears into it. At
 * 0.0036 the body is 0.0097 wide, a little proud of the plate on both sides, so its edge is drawn
 * against the paper. Height is scaled less than width: at the same factor the cars came out as
 * tall as a mid-rise and visibly stubby, and it is the roof, not the side, that the map's usual
 * angle shows.
 */
const trainScaleLength = 0.0014;
const trainScaleWidth = 0.0036;
const trainScaleHeight = 0.0027;
/**
 * The pale sled under every train: a flat pill a little larger than the consist. A train is its
 * line's colour and so is the plate it runs on; this is the edge that separates the two, the same
 * job the white ring does for a station dot.
 */
const sledHalfWidth = 0.0068;
const sledHalfLength = 0.0335;
const sledHeight = 0.0011;
const sledTone = '#FFFDF8';

/**
 * No floor offset: the model's own geometry already starts at y=0, so its origin is its railhead.
 *
 * This previously dropped the train by 1.12 m of model space, taken from the first POSITION
 * accessor's minimum. That accessor is the bodyshell, which does start at 1.12; the wheels and
 * underframe reach all the way down to 0. Trusting it sank every train through the plate it was
 * meant to be riding on.
 */
const trainFloorOffset = 0;
const maxSnapError = 0.03 ** 2;
/** How much nearer another branch's track must be before a train is drawn on it, not its own. */
const ownTrackBias = 0.004;
/**
 * A fix this close to the last one (about 8 m of ground) is a standing train and GPS wobble, not
 * travel. It must not turn the train around.
 */
const steadyDistance = 0.0012;
const burstTime = 0.7;
/** Mesh name of the translucent ground in boston-map-sculpture.glb (modeling/ground.mjs). */
const groundPlate = 'Ground plate';
const mapRevealTime = 1.45;

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

/**
 * Which way along a track a vehicle is pointing, from the compass bearing MBTA reports.
 *
 * The sculpture projects +x east and +z south, so a direction (dx, dz) is at compass
 * atan2(dx, -dz). Comparing that with the reported bearing says whether the train runs with the
 * track's distance axis or against it. Without this a train that arrives already stopped has no
 * travel to infer from and would face an arbitrary way down the line.
 */
function headingFromBearing(track: Track, distance: number, bearing: number): number {
  const length = track.distances[track.distances.length - 1];
  const a = new pc.Vec3();
  const b = new pc.Vec3();
  sampleTrack(track, clamp(distance - 0.002, 0, length), a);
  sampleTrack(track, clamp(distance + 0.002, 0, length), b);
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  if (Math.abs(dx) < 1e-9 && Math.abs(dz) < 1e-9) return 1;
  const forward = (Math.atan2(dx, -dz) * 180) / Math.PI;
  // Shortest signed angle between the track's forward direction and the reported bearing.
  const delta = Math.abs(((forward - bearing + 540) % 360) - 180);
  return delta > 90 ? -1 : 1;
}

/** A flat pill lying along Z with its underside on y=0: the outline of a train's sled. */
function pillGeometry(halfWidth: number, halfLength: number, height: number): pc.Geometry {
  const arc = 8;
  const outline: [number, number][] = [];
  for (const end of [1, -1]) {
    for (let i = 0; i <= arc; i++) {
      const angle = (end > 0 ? 0 : Math.PI) + (Math.PI * i) / arc;
      outline.push([halfWidth * Math.cos(angle), end * (halfLength - halfWidth) + halfWidth * Math.sin(angle)]);
    }
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  // Top face, as a fan. The underside rests on the plate and is never seen.
  for (const [x, z] of outline) {
    positions.push(x, height, z);
    normals.push(0, 1, 0);
  }
  for (let i = 1; i < outline.length - 1; i++) indices.push(0, i + 1, i);
  // Wall, with its own vertices so the rim stays a crisp edge.
  outline.forEach(([x, z], i) => {
    const [nextX, nextZ] = outline[(i + 1) % outline.length];
    const first = positions.length / 3;
    const length = Math.hypot(nextX - x, nextZ - z) || 1;
    positions.push(x, 0, z, nextX, 0, nextZ, nextX, height, nextZ, x, height, z);
    for (let n = 0; n < 4; n++) normals.push((nextZ - z) / length, 0, -(nextX - x) / length);
    indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
  });
  const geometry = new pc.Geometry();
  geometry.positions = positions;
  geometry.normals = normals;
  geometry.indices = indices;
  return geometry;
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
  private sculpture: pc.Entity;
  private fallback: pc.Entity;
  private beaconRoot: pc.Entity;
  private trainRoot: pc.Entity;
  private beacons: Beacon[] = [];
  private materials: pc.StandardMaterial[] = [];
  private beaconStem: pc.StandardMaterial;
  private ringMesh: pc.Mesh;
  private labels: MapLabels;
  private lineSurfaces = new Map<string, LineSurface>();
  private tracks = new Map<string, Track[]>();
  /** Every track of a line family (all four Green branches, say), for trains off their own branch. */
  private familyTracks = new Map<string, Track[]>();
  private anchors = new Map<string, StationAnchor>();
  /** Landmark boxes in map space, and the same corners in world space for the labels to avoid. */
  private landmarks: pc.Vec3[][] = [];
  private landmarkCorners: KeepClear[] = [];
  private places: XRPlaceData[] = [];
  private filtered = new Set<string>();
  private vehicles: XRVehicleData[] = [];
  private trains = new Map<string, Train>();
  /**
   * One model per line. The rolling stock really does differ -- a Green Line LRV is not a Red Line
   * heavy rail car -- so each is its own glb, painted in its own livery.
   */
  private trainModels = new Map<string, pc.ContainerResource>();
  /** Every train's sled shares this mesh and material. */
  private sledMesh: pc.Mesh;
  private sledSurface: pc.StandardMaterial;
  private medallionModel: Promise<pc.ContainerResource | null>;
  private alive = true;
  private abort = new AbortController();
  private trainPosition = new pc.Vec3();
  private trainLookAt = new pc.Vec3();
  private selected?: string;
  private hovered?: string;
  private highlighted = new Set<string>();
  /** Focus rings are ink: on a pale plate a ring has to be darker than its surroundings to show. */
  private readonly ringTint = new pc.Color().fromString(ink);
  private readonly highlightTint = new pc.Color().fromString(highlightInk);
  /** Lines that are not in focus wash out toward this tone instead of going dark. */
  private readonly restTint = new pc.Color().fromString('#CFCDC7');
  private visible = false;
  private detailsVisible = false;
  private immersive = false;
  private clock = 0;

  constructor(
    parent: pc.Entity, private device: pc.GraphicsDevice, models: ModelLibrary, private reveal: JarvisReveal,
    log: DebugLog, private selectStop: (id: string) => void,
    canvas: HTMLCanvasElement, hoverStop: (id: string | undefined) => void,
  ) {
    this.root = child(parent, 'Boston subway sculpture');
    this.sculpture = child(this.root, 'Subway sculpture model');
    this.sculpture.enabled = false;
    this.medallionModel = models.load(`${assetBase}station-medallion.glb`);
    this.fallback = child(this.sculpture, 'Map sculpture fallback');
    this.beaconRoot = child(this.root, 'Station beacons');
    this.trainRoot = child(this.root, 'Live trains');
    this.beaconStem = material(brass);
    this.ringMesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({ tubeRadius: 0.035, ringRadius: 0.5, segments: 48, sides: 8 }));
    // Rings share this mesh; hold a reference so rebuilding the stops does not free it.
    this.ringMesh.incRefCount();
    this.sledMesh = pc.Mesh.fromGeometry(device, pillGeometry(sledHalfWidth, sledHalfLength, sledHeight));
    // Trains come and go with the feed; hold a reference so the last one leaving does not free it.
    this.sledMesh.incRefCount();
    // Unlit, so the sled stays the same crisp card white whichever way its train is pointing.
    this.sledSurface = material(sledTone, 1);
    this.sledSurface.useLighting = false;
    this.sledSurface.diffuse.set(0, 0, 0);
    this.sledSurface.update();
    this.materials.push(this.sledSurface);
    this.labels = new MapLabels(canvas, (id) => this.selectStop(id), hoverStop);

    const deck = material('#CFCDC7');
    this.materials.push(this.beaconStem, deck);
    shape(this.fallback, 'Map base', 'box', deck, [0, 0.02, 0], [1.5, 0.04, 1.05]);

    const signal = this.abort.signal;
    void fetchAssetJson<unknown>(`${assetBase}station-anchors.json`, signal, log).then((anchors) => {
      if (anchors === null || !this.alive) return;
      if (typeof anchors !== 'object' || Array.isArray(anchors)) {
        log('station-anchors.json: expected a map of station anchors', 'warn');
        return;
      }
      for (const [id, record] of Object.entries(anchors)) {
        if (isStationAnchor(record)) this.anchors.set(id, record);
        else log(`station-anchors.json: invalid anchor for ${id}`, 'warn');
      }
      this.positionBeacons();
    });
    void fetchAssetJson<LandmarkAnchor[]>(`${assetBase}landmark-anchors.json`, signal, log).then((landmarks) => {
      if (!Array.isArray(landmarks) || !this.alive) return;
      this.landmarks = landmarks.map(({ min, max }) =>
        [0, 1, 2, 3, 4, 5, 6, 7].map((n) => new pc.Vec3(n & 1 ? max[0] : min[0], n & 2 ? max[1] : min[1], n & 4 ? max[2] : min[2])));
      this.landmarkCorners = this.landmarks.map((corners) => corners.map(() => new pc.Vec3()));
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
        const family = familyOf(line.routeId);
        this.familyTracks.set(family, [...(this.familyTracks.get(family) ?? []), track]);
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
          if (mesh.node.name === groundPlate || surface.name === groundPlate) {
            // The plate's rim fade and its contact shadows are baked into vertex alpha. glTF has no
            // flag for that, so it is switched on here. The plate never writes depth and draws
            // before every other transparent surface, so rings and glass blend over it.
            surface.opacityVertexColor = true;
            surface.opacityVertexColorChannel = 'a';
            surface.blendType = pc.BLEND_NORMAL;
            surface.depthWrite = false;
            surface.update();
            mesh.drawBucket = 220;
            continue;
          }
          const line = /^Lacquer (#[0-9a-f]{6})$/i.exec(mesh.node.name);
          if (line) {
            this.lineSurfaces.set(line[1].toLowerCase(),
              { material: surface, diffuse: surface.diffuse.clone(), emissive: surface.emissive.clone(), level: 1 });
          }
        }
      }
      this.sculpture.addChild(model);
      this.fallback.enabled = false;
      this.reveal.refresh(this.sculpture, mapRevealTime, jarvisPoints.hero);
    });
    for (const family of ['green', 'red', 'orange', 'blue']) {
      void models.load(`${assetBase}mbta-train-${family}.glb`).then((resource) => {
        if (!resource || !this.alive) return;
        this.trainModels.set(family, resource);
        for (const train of this.trains.values()) {
          if (train.family === family) this.attachTrainModel(train);
        }
      });
    }
  }

  setStops(stops: XRStopData[]): void {
    for (const beacon of this.beacons) this.destroyBeacon(beacon);
    this.beacons = stops.map((stop) => {
      const root = child(this.beaconRoot, stop.name);
      const ringSurface = material(ink, 1, 0);
      const burstSurface = material(ink, 1, 0);
      for (const surface of [ringSurface, burstSurface]) {
        surface.useLighting = false;
        surface.update();
      }
      const ring = this.addRing(root, 'Focus ring', ringSurface);
      const burst = this.addRing(root, 'Selection burst', burstSurface);
      burst.enabled = false;
      const callout = child(root, 'Immersive callout');
      callout.enabled = false;
      const panel = new PhysicalPlaque(this.device, callout, stop.name, 0.23, 0.078, 'station', this.medallionModel, this.reveal);
      if (this.immersive && this.detailsVisible) this.reveal.show(callout, 0.62, jarvisPoints.detail);
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
    this.labels.setHighlighted(this.highlighted);
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

  /** Highlight one or more stops from voice/AI control and optionally pulse their rings. */
  setHighlighted(stopIds: string[], pulse = true): void {
    this.highlighted = new Set(stopIds);
    this.labels.setHighlighted(this.highlighted);
    if (pulse) {
      for (const id of this.highlighted) this.pulse(id);
    }
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

  /** Station marker top in world space. */
  stopWorldPosition(id: string): pc.Vec3 | undefined {
    return this.beacons.find((beacon) => beacon.stop.stop_id === id)?.root.getPosition();
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) this.reveal.show(this.sculpture, mapRevealTime, jarvisPoints.hero);
    else this.reveal.hide(this.sculpture, 0.73, jarvisPoints.hero);
    this.setDetails(visible);
  }

  seekReveal(progress: number): void {
    this.reveal.seek(this.sculpture, progress);
    this.visible = progress > 0;
    this.setDetails(progress > 0.70);
  }

  private setDetails(visible: boolean): void {
    if (this.detailsVisible === visible) return;
    this.detailsVisible = visible;
    this.updateCallouts();
    for (const { root } of this.trains.values()) {
      if (visible) this.reveal.show(root, 0.38, jarvisPoints.detail);
      else this.reveal.hide(root, 0.34, jarvisPoints.detail);
    }
  }

  private updateCallouts(): void {
    for (const { callout } of this.beacons) {
      if (this.immersive && this.detailsVisible) this.reveal.show(callout, 0.62, jarvisPoints.detail);
      else this.reveal.hide(callout, 0.43, jarvisPoints.detail);
    }
  }

  /** Headsets get 3D callouts; flat screens get the HTML labels. */
  setImmersive(active: boolean): void {
    if (this.immersive === active) return;
    this.immersive = active;
    this.updateCallouts();
  }

  segmentFile(id: string): string | undefined {
    const file = this.anchors.get(id)?.segmentFile;
    return file && (/^(?:\/|https?:)/.test(file) ? file : `${assetBase}${file}`);
  }

  get targets(): HitTarget[] { return this.beacons.flatMap((beacon) => beacon.actions); }

  private positionBeacons(): void {
    for (const { stop, root } of this.beacons) {
      const [x, z] = project(stop.lat, stop.lon);
      const position: XYZ = this.anchors.get(stop.stop_id)?.topPos ?? [x, 0.07, z];
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
      const lowStem = 0.1 - panel.faceHeight;
      const raised = nearby?.panel.entity.getLocalPosition().y === lowStem;
      const stemTop = lowStem + (raised ? 0.09 : 0);
      panel.entity.setLocalPosition(0, stemTop, 0);
      stem.setLocalPosition(0, stemTop / 2, 0);
      stem.setLocalScale(0.004, stemTop, 0.004);
    });
  }

  private updateLabels(): void {
    const counts = countPreviewsByStop(this.places, this.filtered);
    for (const { stop, panel } of this.beacons) {
      const previews = counts.get(stop.stop_id);
      const count = previews?.matching ?? 0;
      panel.setCallout(stop.name, `${count} matching ${count === 1 ? 'spot' : 'spots'}`,
        { lineColor: stop.primary_color, selected: this.selected === stop.stop_id });
    }
    this.labels.setCounts(counts);
  }

  /**
   * The modelled track a vehicle is on, and how far along it.
   *
   * A vehicle is matched to its own route's track first. But the branches are only modelled out to
   * where they join: the shared Green Line trunk through downtown exists once, on the B branch's
   * path. A C, D or E train there is nowhere near its own track, so it is matched against the rest
   * of its family instead -- without that, every Green Line train east of Kenmore that was not a B
   * was thrown away as off the map. Its own track keeps a small advantage so a train does not hop
   * to a neighbouring branch where two run side by side.
   */
  private locate(routeId: string, x: number, z: number): { track: Track; distance: number } | undefined {
    const own = this.tracks.get(routeId) ?? [];
    let best: { track: Track; distance: number; error: number; score: number } | undefined;
    for (const track of new Set([...own, ...(this.familyTracks.get(familyOf(routeId)) ?? [])])) {
      const { distance, error } = snapToTrack(track, x, z);
      const score = Math.sqrt(error) + (own.includes(track) ? 0 : ownTrackBias);
      if (!best || score < best.score) best = { track, distance, error, score };
    }
    // Only draw trains that sit on a modelled line; anything else would float off the map.
    return best && best.error <= maxSnapError ? best : undefined;
  }

  setVehicles(vehicles: XRVehicleData[]): void {
    this.vehicles = vehicles;
    const seen = new Set<string>();
    for (const vehicle of vehicles) {
      if (!Number.isFinite(vehicle.lat) || !Number.isFinite(vehicle.lon)) continue;
      const [x, z] = project(vehicle.lat, vehicle.lon);
      if (Math.abs(x) > 0.78 || Math.abs(z) > 0.55) continue;
      const fix = this.locate(vehicle.route_id, x, z);
      if (!fix) continue;
      const { track } = fix;
      seen.add(vehicle.id);
      const family = familyOf(vehicle.route_id);
      let train = this.trains.get(vehicle.id);
      const isNew = !train;
      if (!train) {
        const root = child(this.trainRoot, vehicle.label || vehicle.id);
        // The id decides the lift, so a train keeps its place in a stack from one fix to the next.
        let hash = 0;
        for (const letter of vehicle.id) hash = (hash * 31 + letter.charCodeAt(0)) >>> 0;
        train = { root, family, from: fix.distance, to: fix.distance, heading: 1,
          elapsed: defaultGlide, duration: defaultGlide, seenAt: this.clock, lift: (hash % 7) * 0.00006 };
        this.trains.set(vehicle.id, train);
        this.attachTrainModel(train);
      } else if (train.family !== family) {
        this.reveal.finish(train.root, false);
        for (const part of [...train.root.children]) part.destroy();
        train.family = family;
        this.attachTrainModel(train);
      }

      // Start the next move from wherever the train is drawn right now, not from where the last
      // fix said it would end up, so a fix that arrives mid-glide never makes it jump.
      let from = isNew ? fix.distance
        : pc.math.lerp(train.from, train.to, clamp(train.elapsed / train.duration, 0, 1));
      if (!isNew && train.track !== track) {
        // It has crossed onto another modelled track (a branch joining the trunk). Carry its drawn
        // position over; if the two tracks do not meet there, it simply appears at the new fix.
        const here = train.root.getLocalPosition();
        const carried = snapToTrack(track, here.x, here.z);
        from = carried.error <= maxSnapError ? carried.distance : fix.distance;
      }
      const moved = fix.distance - from;
      if (isNew || train.track !== track || Math.abs(fix.distance - train.to) > 1e-6) {
        train.duration = isNew ? defaultGlide : clamp(this.clock - train.seenAt, minGlide, maxGlide);
        train.from = from;
        train.to = fix.distance;
        train.elapsed = isNew ? train.duration : 0;
      }
      train.seenAt = this.clock;
      train.track = track;
      // A train faces the way it is travelling. One that has not moved -- most are standing at a
      // platform at any given moment -- has no travel to read, so it takes MBTA's compass bearing.
      if (Math.abs(moved) > steadyDistance) train.heading = Math.sign(moved);
      else if (Number.isFinite(vehicle.bearing)) {
        train.heading = headingFromBearing(track, fix.distance, vehicle.bearing as number);
      }
      if (isNew) this.updateTrain(train, 0);
    }
    for (const [id, train] of this.trains) {
      if (seen.has(id)) continue;
      this.trains.delete(id);
      this.reveal.hide(train.root, 0.31, jarvisPoints.detail, () => train.root.destroy());
    }
  }

  private attachTrainModel(train: Train): void {
    const source = this.trainModels.get(train.family);
    if (!source || train.root.children.length) return;
    const sled = child(train.root, 'Sled');
    sled.addComponent('render', { castShadows: false, meshInstances: [new pc.MeshInstance(this.sledMesh, this.sledSurface, sled)] });
    const model = source.instantiateRenderEntity();
    // Materials are left alone on purpose: each model already carries its line's livery, window
    // band and roof stripe. Overriding them would flatten all of that back to one colour.
    //
    // The nose is +Z -- measured on the vendored model, whose headlight sits at z=+22.5 and
    // taillight at z=-22.5 -- while lookAt points the root's -Z along the track. Without the flip
    // every train runs backwards.
    model.setLocalEulerAngles(0, 180, 0);
    model.setLocalScale(trainScaleWidth, trainScaleHeight, trainScaleLength);
    model.setLocalPosition(0, sledHeight + trainFloorOffset, 0);
    train.root.addChild(model);
    if (this.detailsVisible) this.reveal.show(train.root, 0.38, jarvisPoints.detail);
    else this.reveal.finish(train.root, false);
  }

  private updateTrain(train: Train, dt: number): void {
    if (!train.track) return;
    train.elapsed += dt;
    const progress = clamp(train.elapsed / train.duration, 0, 1);
    const distance = pc.math.lerp(train.from, train.to, progress);
    sampleTrack(train.track, distance, this.trainPosition);
    this.trainPosition.y += trainLift + train.lift;
    train.root.setLocalPosition(this.trainPosition);

    // Orient every frame, whether or not the train is moving. This used to be skipped when
    // `to === from`, which is exactly the case for anything STOPPED_AT a platform -- and most
    // trains are stopped most of the time -- so those kept their default rotation and lay across
    // the line at an angle instead of along it.
    const length = train.track.distances[train.track.distances.length - 1];
    // Sample a little along the track and face that way. Near an end the step would fall off the
    // track and collapse to zero, so it flips to look back from the other side instead.
    const step = train.heading * 0.002;
    let ahead = clamp(distance + step, 0, length);
    let flip = 1;
    if (Math.abs(ahead - distance) < 1e-9) {
      ahead = clamp(distance - step, 0, length);
      flip = -1;
    }
    sampleTrack(train.track, ahead, this.trainLookAt);
    this.trainLookAt.y = this.trainPosition.y;
    if (flip < 0) {
      // Mirror the sample through the train so it still faces along its heading.
      this.trainLookAt.set(
        2 * this.trainPosition.x - this.trainLookAt.x,
        this.trainPosition.y,
        2 * this.trainPosition.z - this.trainLookAt.z,
      );
    }
    if (this.trainLookAt.distanceSq(this.trainPosition) > 1e-12) {
      this.root.getWorldTransform().transformPoint(this.trainLookAt, this.trainLookAt);
      train.root.lookAt(this.trainLookAt);
    }
  }

  /**
   * `labelOpacity` fades the HTML labels; 0 hides them (station view, headset, mid-dive).
   * `labelKeepOut` is page content over the map that the labels should not sit on.
   */
  update(
    dt: number, camera: pc.Entity, lens: pc.CameraComponent, labelOpacity: number, labelKeepOut: readonly Box[] = [],
  ): void {
    this.clock += dt;
    const visible = this.root.enabled;
    const worldOf = (id: string) => this.beacons.find((beacon) => beacon.stop.stop_id === id)?.root.getPosition();
    const labelled = visible && !this.immersive && labelOpacity > 0.01;
    if (labelled) {
      // The map can be moved and scaled, so the landmark boxes are carried into world space here.
      const world = this.root.getWorldTransform();
      this.landmarks.forEach((corners, i) =>
        corners.forEach((corner, j) => world.transformPoint(corner, this.landmarkCorners[i][j])));
    }
    this.labels.update(lens, worldOf, labelled ? labelOpacity : 0, this.landmarkCorners, labelKeepOut);
    if (!visible) return;

    const focus = this.hovered ?? undefined;
    const focusColors = new Set<string>();
    if (focus) {
      const color = this.beacons.find((beacon) => beacon.stop.stop_id === focus)?.stop.primary_color.toLowerCase();
      if (color) focusColors.add(color);
    } else if (this.highlighted.size > 0) {
      for (const beacon of this.beacons) {
        if (this.highlighted.has(beacon.stop.stop_id)) focusColors.add(beacon.stop.primary_color.toLowerCase());
      }
    }
    const blend = damp(dt, 9);
    for (const [color, line] of this.lineSurfaces) {
      const goal = focusColors.size === 0 || focusColors.has(color) ? 1 : 0.22;
      if (Math.abs(line.level - goal) < 0.002) continue;
      line.level = pc.math.lerp(line.level, goal, blend);
      line.material.diffuse.lerp(this.restTint, line.diffuse, line.level);
      line.material.emissive.copy(line.emissive).mulScalar(line.level);
      line.material.update();
    }

    for (const beacon of this.beacons) {
      if (this.immersive) beacon.panel.faceYaw(camera, dt);
      const id = beacon.stop.stop_id;
      const isHighlighted = this.highlighted.has(id);
      const goal = id === this.hovered || isHighlighted ? 1 : id === this.selected ? 0.75 : 0;
      beacon.glow = pc.math.lerp(beacon.glow, goal, blend);
      // Idle rings breathe gently so the explorable stops read as clickable.
      const breath = 0.5 + 0.5 * Math.sin(this.clock * (isHighlighted ? 4.2 : 2.1) + beacon.root.getLocalPosition().x * 9);
      const size = isHighlighted
        ? 0.064 + 0.016 * breath
        : pc.math.lerp(0.046 + 0.01 * breath, 0.058, beacon.glow);
      beacon.ring.setLocalScale(size, 0.02, size);
      const tint = isHighlighted ? this.highlightTint : this.ringTint;
      beacon.ringSurface.emissive.copy(tint);
      beacon.ringSurface.diffuse.copy(tint);
      beacon.ringSurface.opacity = this.detailsVisible ? pc.math.lerp(0.28 + 0.2 * breath, 1, beacon.glow) : 0;
      beacon.ringSurface.update();

      const bursting = beacon.burstClock < burstTime;
      if (beacon.burst.enabled !== bursting) beacon.burst.enabled = bursting;
      if (bursting) {
        beacon.burstClock += dt;
        const t = clamp(beacon.burstClock / burstTime, 0, 1);
        const reach = 0.05 + 0.16 * (1 - (1 - t) ** 3);
        beacon.burst.setLocalScale(reach, 0.02, reach);
        beacon.burstSurface.emissive.copy(tint);
        beacon.burstSurface.diffuse.copy(tint);
        beacon.burstSurface.opacity = this.detailsVisible ? (1 - t) ** 2 : 0;
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
    this.sledMesh.decRefCount();
    this.sledMesh.destroy();
    for (const surface of this.materials) surface.destroy();
    this.trains.clear();
  }
}
