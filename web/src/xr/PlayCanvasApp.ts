import * as pc from 'playcanvas';
import { Backdrop } from './Backdrop';
import type { VoiceState } from '../voice/RealtimeVoice';
import type { BriefingCard } from '../data/reviewBriefing';
import type {
  FareSightSceneEngine, SceneMode, XRDishData, XRFilterSummary, XRManifestData,
  XRPlaceData, XRSceneCallbacks, XRStopData, XRVehicleData,
} from './bridgeTypes';
import { XRActionBar } from './CanvasPanel3D';
import { DishTableScene } from './DishTableScene';
import { JarvisReveal } from './JarvisReveal';
import { MapSculptureScene } from './MapSculptureScene';
import { OrbitCamera } from './OrbitCamera';
import type { PhysicalMenuBook } from './PhysicalMenuBook';
import { PhysicalSurfaces, type SurfaceMatch } from './PhysicalSurfaces';
import { SplatLoader } from './SplatLoader';
import { StationDioramaScene } from './StationDioramaScene';
import { VenueSplatScene } from './VenueSplatScene';
import { VRReviewDeck } from './VRReviewCard';
import { XRPresence } from './XRPresence';
import { assetBase, brass, child, clamp, cyan, damp, material, ModelLibrary, pickBounds, ScenePicker, shape, smooth,
  type HitTarget, type PickBounds, type XYZ } from './sceneSupport';

type ActiveXR = 'none' | 'vr' | 'ar';
type SurfaceScene = Exclude<SceneMode, 'venue'>;
const studioBackdrop = '#151922';

/**
 * The map-to-station transition. The viewer never moves (essential for headset comfort): the
 * neighbourhood grows out of its station marker and glides to the stage while the map dissolves.
 * `u` runs 0 (map) to 1 (station); `dir` is the way it is heading, so going back mid-flight
 * simply reverses it. `anchor` is the marker and `stage` the neighbourhood's resting place,
 * both in world space.
 */
interface Dive {
  u: number;
  dir: 1 | -1;
  stopId: string;
  anchor: pc.Vec3;
  stage: pc.Vec3;
  mapRotation: pc.Quat;
  stageRotation: pc.Quat;
  pins: boolean;
}

const diveInTime = 1.48;
const diveOutTime = 1.28;
const sceneExitTime = 0.75;
const seedScale = 0.006;
// In a headset the neighbourhood's deck lands level with the map surface it replaces.
const xrDeckLift = 0.04;
const xrMapDistance = 0.88;
const xrStationDistance = 0.72;
const xrDishDistance = 0.62;
const mapClearance = 0.006;
const cartridgeDepth = 0.430;
const dishClearance = 0.002;
// On a flat screen the neighbourhood rests to the right of centre, clear of the left sidebar.
const stationHome: XYZ = [0.3, 0, -0.2];
const standbyScale = 0.0004;

export class PlayCanvasApp implements FareSightSceneEngine {
  private app?: pc.Application;
  private camera!: pc.Entity;
  private lens!: pc.CameraComponent;
  private rig!: pc.Entity;
  private orbit!: OrbitCamera;
  private models!: ModelLibrary;
  private reveal!: JarvisReveal;
  private splats!: SplatLoader;
  private map!: MapSculptureScene;
  private station!: StationDioramaScene;
  private venue!: VenueSplatScene;
  private dish!: DishTableScene;
  private turntables!: Record<'map' | 'station' | 'dish', PickBounds>;
  private actions!: XRActionBar;
  private reviewDeck!: VRReviewDeck;
  private pendingReviews?: readonly BriefingCard[];
  private presence?: XRPresence;
  private backdrop!: Backdrop;
  private gallery?: pc.Entity;
  private galleryMaterials: pc.StandardMaterial[] = [];
  private reticle!: pc.Entity;
  private reticleMaterial!: pc.StandardMaterial;
  private levelRing!: pc.Entity;
  private levelMesh!: pc.Mesh;
  private levelMaterial!: pc.StandardMaterial;
  private surfaces?: PhysicalSurfaces;
  private surfacePreview: SurfaceMatch | null = null;
  private surfaceMatches = new Map<SurfaceScene, SurfaceMatch>();
  private manualPlacement = new Set<SurfaceScene>();
  private resizeObserver?: ResizeObserver;
  private insetLeft = 0;
  private picker = new ScenePicker();
  private ray = new pc.Ray();
  private rayEnd = new pc.Vec3();
  private mode: SceneMode = 'map';
  private leaving = new Map<SceneMode, number>();
  private activeXR: ActiveXR = 'none';
  private sessionStarting = false;
  private sessionEnding = false;
  private exitAfterStart = false;
  private roomBackdrop = false;
  private waitingForXRFrame = false;
  private xrFramePending = false;
  private neighborhoodFramed = false;
  private returningToNeighborhood = false;
  private preVenueRig?: { position: pc.Vec3; rotation: pc.Quat };
  private deckFramePending = false;
  private xrMapHome = new pc.Vec3();
  private xrStationHome = new pc.Vec3();
  private hitTestSource?: pc.XrHitTestSource;
  private hitTestPending = false;
  private hitPosition = new pc.Vec3();
  private normal = new pc.Vec3();
  private heading = new pc.Vec3();
  private lastHit = -Infinity;
  private placement: XYZ | null = null;
  private placementYaw = 0;
  private statsTime = 0;
  private fps = 0;
  private stops: XRStopData[] = [];
  private places: XRPlaceData[] = [];
  private filtered = new Set<string>();
  private filters?: XRFilterSummary;
  private vehicles: XRVehicleData[] = [];
  private activeStop?: string;
  private place?: XRPlaceData;
  private manifest: XRManifestData | null = null;
  private fit: [boolean, number, 'seated' | 'standing'] = [false, 1, 'seated'];
  private destroyed = false;
  private dive?: Dive;
  private hovered?: string;
  private events = new AbortController();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private diveCenter = new pc.Vec3();
  private diveRotation = new pc.Quat();

  constructor(private canvas: HTMLCanvasElement, private callbacks: XRSceneCallbacks) {}

  async init(): Promise<void> {
    if (this.app || this.destroyed) return;
    try {
      const app = new pc.Application(this.canvas, {
        devtools: false,
        graphicsDeviceOptions: { antialias: true, alpha: true, preserveDrawingBuffer: false, xrCompatible: true },
      });
      this.app = app;
      const { width, height } = this.canvas.style;
      app.setCanvasFillMode(pc.FILLMODE_NONE);
      this.canvas.style.width = width;
      this.canvas.style.height = height;
      app.scene.ambientLight = new pc.Color(0.38, 0.39, 0.42);
      app.scene.gsplat.splatBudget = 160_000;
      this.rig = child(app.root, 'Camera rig');
      this.camera = child(this.rig, 'Viewer');
      this.lens = this.camera.addComponent('camera', {
        clearColor: new pc.Color().fromString(studioBackdrop), nearClip: 0.025, farClip: 65, fov: 48,
      }) as pc.CameraComponent;
      this.addLights(app.root);
      this.backdrop = new Backdrop(app.root, app.graphicsDevice);
      this.models = new ModelLibrary(app, this.callbacks.onDebugLog);
      this.reveal = new JarvisReveal(app.graphicsDevice, this.reducedMotion);
      this.splats = new SplatLoader(app, this.callbacks.onDebugLog, this.reducedMotion);
      this.map = new MapSculptureScene(app.root, app.graphicsDevice, this.models, this.reveal, this.callbacks.onDebugLog,
        (id) => this.selectStop(id), this.canvas, (id) => this.setHover(id));
      this.station = new StationDioramaScene(app, this.models, this.reveal, this.callbacks.onDebugLog,
        this.callbacks.onSelectPlace);
      this.venue = new VenueSplatScene(app.root, app.graphicsDevice, this.models, this.splats, this.reveal,
        this.callbacks.onSelectDish);
      this.dish = new DishTableScene(app.root, app.graphicsDevice, this.models, this.splats, this.reveal, this.callbacks.onSelectDish, this.callbacks.onCompareDish);
      this.turntables = {
        map: pickBounds(this.map.root, [1.50, 0.10, 1.05], [0, 0.04, 0]),
        station: this.station.grabBounds,
        dish: pickBounds(this.dish.root, [0.90, 0.24, 0.90], [0, 0.05, 0]),
      };
      this.actions = new XRActionBar(app.graphicsDevice, app.root, this.models, this.reveal, {
        map: () => this.navigate('map'),
        station: () => this.navigate('station'),
        back: () => this.navigate(this.mode === 'dish' ? 'venue' : this.mode === 'venue' ? 'station' : 'map'),
        toggleBackdrop: () => this.setPassthroughFallback(!this.roomBackdrop),
        recenter: () => this.resetCamera(),
        toggleVoice: () => this.callbacks.onToggleVoice(),
      });
      this.reviewDeck = new VRReviewDeck(app.graphicsDevice, app.root, this.models, this.reveal,
        (id) => this.callbacks.onDismissReviewCard(id));
      this.reticleMaterial = material(brass, 0.22);
      this.reticle = shape(app.root, 'Table placement indicator', 'torus', this.reticleMaterial, [0, 0, 0], [0.12, 0.011, 0.12]);
      this.reticle.enabled = false;
      this.levelMaterial = material(cyan, 0.85, 0.86);
      this.levelMaterial.useLighting = false;
      this.levelMaterial.depthTest = false;
      this.levelMaterial.update();
      this.levelRing = child(app.root, 'Physical surface level');
      this.levelMesh = pc.Mesh.fromGeometry(app.graphicsDevice, new pc.TorusGeometry({
        ringRadius: 0.095, tubeRadius: 0.0018, segments: 48, sides: 6,
      }));
      this.levelRing.addComponent('render', {
        meshInstances: [new pc.MeshInstance(this.levelMesh, this.levelMaterial, this.levelRing)],
      });
      this.levelRing.enabled = false;
      this.orbit = new OrbitCamera(this.canvas, this.camera, this.desktopPose(),
        (x, y) => this.pickCanvas(x, y),
        (radians) => {
          if (this.mode !== 'dish') return false;
          this.dish.drag(radians, true);
          return true;
        },
        (x, y) => this.hoverCanvas(x, y));
      this.canvas.addEventListener('pointerleave', () => {
        this.canvas.style.cursor = '';
        this.setHover(undefined);
        this.activeMenu()?.setHoveredDish(undefined);
      }, { signal: this.events.signal });
      this.map.setStops(this.stops);
      this.setPlaces(this.places, this.filtered);
      this.map.setVehicles(this.vehicles);
      if (this.filters) this.station.setFilters(this.filters);
      this.venue.setWillWeFit(...this.fit);
      this.applyScene('map');
      this.placeDesktopScenes();
      this.station.setPinsShown(false, true);
      if (app.xr) this.setupXR(app.xr);
      else this.callbacks.onXrStateChange({ vrSupported: false, arSupported: false, activeMode: 'none' });
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.canvas);
      this.resize();
      app.on('update', (dt: number) => this.update(dt));
      app.start();
      this.callbacks.onDebugLog('FareSight WebGL2 renderer ready', 'info');
    } catch (error) {
      this.callbacks.onDebugLog(`Renderer initialization failed: ${String(error)}`, 'error');
      this.destroy();
      throw error;
    }
  }

  private addLights(root: pc.Entity): void {
    const lights = [
      { name: 'Warm studio key', tint: '#fff6e8', intensity: 1.75, angles: [37, -31, 36] },
      { name: 'Sky fill', tint: '#c8d8ee', intensity: 0.68, angles: [63, 44, 35] },
      { name: 'Warm bounce', tint: '#e9d7bf', intensity: 0.45, angles: [30, 146, -27] },
    ];
    for (const { name, tint, intensity, angles } of lights) {
      const light = child(root, name);
      light.addComponent('light', { type: 'directional', color: new pc.Color().fromString(tint), intensity });
      light.setLocalEulerAngles(angles[0], angles[1], angles[2]);
    }
  }

  resize(): void {
    if (!this.app || this.activeXR !== 'none') return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const device = this.app.graphicsDevice;
    device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    device.resizeCanvas(width, height);
    // Widen the view a little when a sidebar covers the left edge so the whole network still fits beside it.
    const visible = Math.max(1, width - this.insetLeft);
    const base = clamp(48 + (1 - width / height) * 38, 48, 74) * Math.PI / 360;
    const widen = Math.min(1.45, (width / visible) * 1.06);
    this.lens.fov = clamp(Math.atan(Math.tan(base) * widen) * 360 / Math.PI, 48, 80);
    // A negative x offset moves the image centre right by half the inset; picking and labels use the same matrix.
    // 0.85 rather than 1: the network's east end (Chinatown) carries a label that hangs to the right of its stop.
    this.lens.projectionOffset = new pc.Vec2(-0.85 * this.insetLeft / width, 0);
  }

  setViewportInset(left: number): void {
    const inset = Math.max(0, Math.round(left));
    if (inset === this.insetLeft) return;
    this.insetLeft = inset;
    this.resize();
  }

  setStops(stops: XRStopData[]): void {
    this.stops = stops;
    this.map?.setStops(stops);
    if (!this.app) return;
    if (this.mode === 'station' && this.activeStop) {
      void this.showStation().catch((error) => this.callbacks.onDebugLog(String(error), 'warn'));
    }
    // Fetch every neighbourhood while the user is still reading the map, and keep one built
    // (hidden inside the base) so the first dive never waits on a download or a shader compile.
    window.setTimeout(() => {
      if (this.destroyed) return;
      for (const stop of this.stops) void this.models.load(`${assetBase}segment-${stop.stop_id}.glb`);
      if (this.mode === 'map' && !this.dive && !this.activeStop) {
        void this.showStation(this.filters?.startStopId ?? this.stops[0]?.stop_id);
      }
    }, 500);
  }

  setHoveredStop(stopId: string | undefined): void {
    if (!this.app) return;
    this.setHover(stopId, false);
  }

  setHighlightedStops(stopIds: string[], pulse = true): void {
    if (!this.app) return;
    this.map.setHighlighted(stopIds, pulse);
  }

  setHighlightedPlaces(placeIds: string[]): void {
    if (!this.app) return;
    this.station.setHighlightedPlaces(placeIds);
  }

  setHighlightedDish(dishId: string | undefined): void {
    if (!this.app) return;
    this.venue.menu.setHighlightedDish(dishId);
    this.dish.menu.setHighlightedDish(dishId);
  }

  orbitCamera(yawDeltaRad: number, pitchDeltaRad: number, zoomFactor = 1): void {
    if (!this.app || this.activeXR !== 'none') return;
    this.orbit.nudge(yawDeltaRad, pitchDeltaRad, zoomFactor);
  }

  focusMapStopCamera(stopId: string): void {
    if (!this.app || this.activeXR !== 'none' || this.mode !== 'map') return;
    const world = this.map.stopWorldPosition(stopId);
    if (!world) return;
    this.orbit.focusAt(world, 0.96);
  }

  private setHover(id: string | undefined, notify = true): void {
    if (this.dive || this.mode !== 'map') id = undefined;
    if (id === this.hovered) return;
    this.hovered = id;
    this.map.setHover(id);
    if (notify) this.callbacks.onHoverStop(id);
    // Build the neighbourhood the pointer is resting on, ready for the click.
    if (id) void this.showStation(id);
  }

  private hoverCanvas(clientX: number, clientY: number): void {
    if (this.dive || this.activeXR !== 'none' || !this.aimRay(clientX, clientY)) return;
    const hit = this.picker.find(this.ray, this.sceneTargets());
    this.canvas.style.cursor = hit ? 'pointer' : '';
    if (this.mode === 'map') this.setHover(hit?.key);
    else this.activeMenu()?.setHoveredDish(hit?.key);
  }

  setPlaces(places: XRPlaceData[], filteredIds: Set<string>): void {
    this.places = places;
    this.filtered = new Set(filteredIds);
    this.map?.setPlaces(places, this.filtered);
    this.station?.setPlaces(places, this.filtered);
  }

  setFilters(filters: XRFilterSummary): void {
    this.filters = filters;
    this.station?.setFilters(filters);
  }

  setLiveVehicles(vehicles: XRVehicleData[]): void {
    this.vehicles = vehicles;
    this.map?.setVehicles(vehicles);
  }

  async setScene(mode: SceneMode): Promise<void> {
    if (!this.app) return;
    if (mode === 'station') {
      const selected = this.activeStop || this.filters?.startStopId;
      await this.focusStop(this.stops.find((stop) => stop.stop_id === selected)?.stop_id ?? this.stops[0]?.stop_id ?? '');
      return;
    }
    if (mode === 'venue' && this.place) {
      await this.openVenue(this.place, this.manifest);
      return;
    }
    if (mode === 'map') {
      const dive = this.dive;
      if (dive && dive.dir === -1) return;
      if (dive) {
        dive.dir = -1;
        this.mode = 'map';
        this.station.setPinsShown(false);
        this.applyPresentation();
        return;
      }
      if (this.mode === 'station' && this.activeStop && this.canDive()) {
        this.startDive(this.activeStop, -1);
        return;
      }
    }
    this.applyScene(mode);
  }

  async focusStop(stopId: string): Promise<void> {
    if (!this.app) return;
    const stop = this.stops.find((item) => item.stop_id === stopId);
    if (!stop) {
      this.callbacks.onDebugLog(`Station is unavailable: ${stopId}`, 'warn');
      return;
    }
    const dive = this.dive;
    if (dive && dive.stopId === stopId) {
      // Already flying between the map and this station: just head towards the station.
      dive.dir = 1;
      this.mode = 'station';
      this.activeStop = stopId;
      this.map.select(stopId);
      this.applyPresentation();
      return;
    }
    this.settleDive();
    const fromMap = this.mode === 'map';
    this.activeStop = stopId;
    this.map.select(stopId);
    if (fromMap && this.canDive()) {
      this.map.pulse(stopId);
      // Normally instant (preloaded); if the network is slow, dive anyway and let the model catch up.
      await Promise.race([this.showStation(), new Promise((resolve) => window.setTimeout(resolve, 1200))]);
      if (this.destroyed) return;
      if (this.mode === 'map' && this.activeStop === stopId && !this.dive && this.canDive()) {
        this.startDive(stopId, 1);
        return;
      }
    }
    this.applyScene('station');
    this.station.setPinsShown(true);
    await this.showStation();
  }

  private showStation(stopId = this.activeStop): Promise<void> {
    const stop = this.stops.find((item) => item.stop_id === stopId);
    if (!stop) return Promise.resolve();
    return this.station.show(stop, this.map.segmentFile(stop.stop_id));
  }

  private canDive(): boolean {
    return !this.reducedMotion.matches && document.visibilityState === 'visible' &&
      (this.activeXR === 'none' || !this.xrFramePending);
  }

  private startDive(stopId: string, dir: 1 | -1): void {
    this.presence?.resetSceneGrab();
    const flat = this.activeXR === 'none';
    const mapRoot = this.map.root;
    mapRoot.setLocalScale(1, 1, 1);
    const origin = mapRoot.getPosition();
    const mapRotation = mapRoot.getRotation().clone();
    const anchor = mapRotation.transformVector(this.map.stopPosition(stopId) ?? new pc.Vec3(0, 0.07, 0)).add(origin);
    const stage = flat ? new pc.Vec3(...stationHome) : dir === -1 ? this.station.root.getPosition().clone()
      : this.stationStage();
    const stageRotation = !flat && dir === -1 ? this.station.root.getRotation().clone() : mapRotation;
    this.mode = dir === 1 ? 'station' : 'map';
    this.dive = { u: dir === 1 ? 0 : 1, dir, stopId, anchor, stage, mapRotation, stageRotation, pins: dir === -1 };
    this.station.setPinsShown(false, dir === 1);
    this.canvas.style.cursor = '';
    this.hovered = undefined;
    this.map.setHover(undefined);
    this.callbacks.onHoverStop(undefined);
    this.applyPresentation();
    this.applyDive();
  }

  private stepDive(dt: number): void {
    const dive = this.dive;
    if (!dive) return;
    dive.u = clamp(dive.u + dive.dir * dt / (dive.dir === 1 ? diveInTime : diveOutTime), 0, 1);
    this.applyDive();
    if (dive.dir === 1 ? dive.u >= 1 : dive.u <= 0) this.finishDive();
  }

  /** Pose the map and the neighbourhood for the current point of the transition. */
  private applyDive(): void {
    const dive = this.dive;
    if (!dive) return;
    const { u, anchor, stage, mapRotation, stageRotation } = dive;
    const grow = smooth((u - 0.05) / 0.76);
    const travel = smooth((u - 0.12) / 0.78);

    // Let the holographic points expand before the architecture solidifies.
    const center = this.diveCenter.lerp(anchor, stage, travel);
    center.y += 0.05 * Math.sin(Math.PI * travel);
    const settle = 1 + 0.045 * Math.sin(Math.PI * clamp((u - 0.8) / 0.2, 0, 1));
    const size = pc.math.lerp(seedScale, 1, grow ** 1.12) * settle;
    this.station.root.setRotation(this.diveRotation.slerp(mapRotation, stageRotation, travel));
    this.station.root.setLocalScale(size, size, size);
    this.station.root.setPosition(center);
    this.map.seekReveal(1 - clamp((u - 0.11) / 0.65, 0, 1));
    this.station.seekReveal(clamp((u - 0.22) / 0.75, 0, 1));

    const pins = dive.dir === 1 && u > 0.8;
    if (pins !== dive.pins) {
      dive.pins = pins;
      this.station.setPinsShown(pins);
    }
  }

  private finishDive(): void {
    if (!this.dive) return;
    this.dive = undefined;
    if (this.activeXR === 'none') this.placeDesktopScenes();
    else {
      if (this.mode === 'map') this.parkStation();
      else this.station.root.setLocalScale(1, 1, 1);
    }
    this.applyPresentation();
    if (this.mode === 'station') this.station.setPinsShown(true);
  }

  /** Keep the built neighbourhood, microscopic, inside the map base so it is ready to grow. */
  private parkStation(): void {
    const at = this.map.root.getPosition();
    this.station.root.setPosition(at.x, at.y + 0.02, at.z);
    this.station.root.setRotation(this.map.root.getRotation());
    this.station.root.setLocalScale(standbyScale, standbyScale, standbyScale);
    this.station.setPinsShown(false, true);
  }

  /** Jump an in-flight dive to its destination before something else takes over the stage. */
  private settleDive(): void {
    const dive = this.dive;
    if (!dive) return;
    dive.u = dive.dir === 1 ? 1 : 0;
    this.applyDive();
    this.finishDive();
  }

  async openVenue(place: XRPlaceData, manifest: XRManifestData | null): Promise<void> {
    if (!this.app) return;
    const changed = this.place?.id !== place.id;
    const previousMenu = changed ? undefined : this.activeMenu();
    this.rememberVenue(place, manifest);
    const loading = this.venue.open(place, manifest, this.neighborhood(place));
    this.applyScene('venue', changed);
    this.transferHeldMenu(previousMenu);
    await loading;
  }

  async openDish(place: XRPlaceData, dish: XRDishData, compareDish?: XRDishData | null, manifest?: XRManifestData | null, comparePlaceName?: string): Promise<void> {
    if (!this.app) return;
    const changed = this.place?.id !== place.id;
    const previousMenu = changed ? undefined : this.activeMenu();
    const comparisonChanged = this.dish.hasComparison !== !!compareDish;
    if (changed) this.dish.clear();
    const venueManifest = manifest === undefined && !changed ? this.manifest : manifest ?? null;
    this.rememberVenue(place, venueManifest);
    const neighborhood = this.neighborhood(place);
    const room = this.venue.open(place, venueManifest, neighborhood);
    const table = this.dish.open(place, neighborhood, dish, compareDish ?? null, venueManifest, room, comparePlaceName, this.places);
    this.applyScene('dish', changed || (this.activeXR === 'none' && comparisonChanged));
    this.transferHeldMenu(previousMenu);
    await Promise.all([room, table]);
  }

  private rememberVenue(place: XRPlaceData, manifest: XRManifestData | null): void {
    this.place = place;
    this.manifest = manifest;
    this.activeStop = place.stop_id;
  }

  private neighborhood(place: XRPlaceData): string {
    return this.stops.find((stop) => stop.stop_id === place.stop_id)?.name ?? '';
  }

  setWillWeFit(enabled: boolean, groupSize: number, seating: 'seated' | 'standing'): void {
    this.fit = [enabled, groupSize, seating];
    this.venue?.setWillWeFit(...this.fit);
  }

  setDishRotation(angleRad: number): void {
    this.orbit?.cancelSpin();
    this.dish?.setRotation(angleRad);
  }

  setPassthroughFallback(useRoomBackdrop: boolean): void {
    if (this.roomBackdrop === useRoomBackdrop) return;
    this.roomBackdrop = useRoomBackdrop;
    if (!this.app) return;
    if (this.activeXR === 'ar' && this.mode === 'dish') this.xrFramePending = true;
    this.applyPresentation();
  }

  setVoiceState(state: VoiceState): void {
    this.actions?.setVoiceState(state);
  }

  setReviewCards(cards: readonly BriefingCard[]): void {
    if (this.activeXR === 'none') return;
    this.pendingReviews = cards;
    if (!this.waitingForXRFrame && !this.xrFramePending) this.syncReviewCards();
  }

  private syncReviewCards(): void {
    if (!this.pendingReviews) return;
    this.reviewDeck.sync(this.pendingReviews, this.camera);
    this.pendingReviews = undefined;
  }

  resetCamera(): void {
    if (!this.app) return;
    this.settleDive();
    this.presence?.resetGrip();
    this.dish?.resetDishes();
    this.dish?.menu.resetPose();
    this.venue?.menu.resetPose();
    if (this.activeXR === 'none') this.orbit.frame(this.desktopPose());
    else {
      this.actions.recenter();
      this.neighborhoodFramed = false;
      this.surfaceMatches.clear();
      this.manualPlacement.clear();
      if (this.mode === 'dish') this.placement = null;
      this.xrFramePending = true;
    }
  }

  private applyScene(mode: SceneMode, reframe = false): void {
    this.settleDive();
    const changed = mode !== this.mode;
    const atVenue = mode === 'venue' || mode === 'dish';
    if (changed) {
      const wasAtVenue = this.mode === 'venue' || this.mode === 'dish';
      if (this.activeXR !== 'none' && atVenue !== wasAtVenue) this.deckFramePending = true;
      if (this.activeXR === 'vr' && atVenue !== wasAtVenue) {
        this.returningToNeighborhood = wasAtVenue;
        if (atVenue) {
          this.preVenueRig = {
            position: this.rig.getLocalPosition().clone(),
            rotation: this.rig.getLocalRotation().clone(),
          };
        } else {
          this.rig.setLocalPosition(this.preVenueRig?.position ?? pc.Vec3.ZERO);
          this.rig.setLocalRotation(this.preVenueRig?.rotation ?? pc.Quat.IDENTITY);
          this.preVenueRig = undefined;
        }
      }
      this.activeMenu()?.setHoveredDish(undefined);
      if (this.reveal.enabled) this.leaving.set(this.mode, sceneExitTime);
      this.leaving.delete(mode);
      if (this.mode === 'dish') {
        this.splats.clear('dish', 0.66);
        this.splats.clear('compare', 0.66);
      }
      if (!atVenue && (this.mode === 'venue' || this.mode === 'dish')) this.splats.clear('room', 0.68);
      if (mode === 'dish' && !this.manualPlacement.has('dish')) {
        this.surfaceMatches.delete('dish');
        this.placement = null;
      }
    }
    this.mode = mode;
    if (!atVenue) {
      if (!this.leaving.has('venue') && !this.leaving.has('dish')) this.venue.clear();
      this.place = undefined;
      this.manifest = null;
    }
    if (mode !== 'dish' && !this.leaving.has('dish')) this.dish.clear();
    if (!changed && !reframe) {
      this.applyPresentation();
      return;
    }
    this.applyPresentation();
    if (this.activeXR === 'none') {
      this.placeDesktopScenes();
      this.orbit.frame(this.desktopPose());
    } else {
      this.xrFramePending = true;
    }
  }

  private updateSceneExits(dt: number): void {
    if (!this.leaving.size) return;
    let changed = false;
    for (const [scene, time] of this.leaving) {
      if (this.reveal.enabled && time > dt) {
        this.leaving.set(scene, time - dt);
        continue;
      }
      this.leaving.delete(scene);
      if (scene === 'dish' && this.mode !== 'dish') this.dish.clear();
      changed = true;
    }
    if (!changed) return;
    if (this.mode !== 'venue' && this.mode !== 'dish' && !this.leaving.has('venue') && !this.leaving.has('dish')) this.venue.clear();
    this.applyPresentation();
  }

  private selectStop(id: string): void {
    if (this.dive) return;
    // Acknowledge the click at once; the dive itself starts in focusStop.
    this.map.pulse(id);
    this.callbacks.onSelectStop(id);
  }

  private navigate(scene: SceneMode): void {
    if (scene === 'station' && !this.activeStop) {
      const stopId = this.stops.find((stop) => stop.stop_id === this.filters?.startStopId)?.stop_id ?? this.stops[0]?.stop_id;
      if (stopId) this.selectStop(stopId);
      return;
    }
    this.callbacks.onNavigateScene(scene);
  }

  private desktopPose() {
    const aspect = this.canvas.clientWidth / Math.max(this.canvas.clientHeight, 1);
    const portrait = clamp(0.79 / Math.max(aspect, 0.4), 1, 1.60);
    if (this.mode === 'dish') {
      if (this.dish.hasComparison) {
        const pivot = new pc.Vec3(aspect > 1.2 ? 0.09 : 0, 0.05, 0.005);
        return { pivot, yaw: 0, pitch: 0.73, distance: 0.94 * portrait, min: 0.21 };
      }
      return { pivot: new pc.Vec3(-0.18, 0.075, 0.025), yaw: 0, pitch: 0.73, distance: 0.68 * portrait, min: 0.21 };
    }
    if (this.mode === 'venue') {
      const [x, y, z] = this.venue?.spawn ?? [0, 1.55, 2];
      const right = aspect < 0.9 ? 0.23 : 0.10;
      const down = 0.145;
      const distance = 1.16;
      return { pivot: new pc.Vec3(x + right, y - down, z - 1), yaw: -Math.atan2(right, distance),
        pitch: Math.atan2(down, Math.hypot(distance, right)), distance: Math.hypot(distance, right, down), min: 0.16 };
    }
    // Map and station share one framing, so moving between them never needs a camera move.
    // The pull-back is capped just past the default: far enough to hold the whole network on
    // screen, close enough that the sculpture never shrinks into a speck in an empty field.
    // The default framing already holds the whole network, so that is also the limit: pulling
    // back further only shrinks the sculpture into empty canvas.
    // Opens on the reference framing: at 48 degrees vertical the BU Central to Kenmore run
    // (0.1492 units) fills the same share of the frame as in the reference shot.
    const framing = 0.78 * portrait;
    // Pitch floor sits just above zero: the camera can come all the way down to a side-on view of
    // the skyline, but never to or below the ground plane, which would show the city's underside
    // and let the viewer end up beneath it.
    return { pivot: new pc.Vec3(-0.13, 0.04, 0.15), yaw: 0.1, pitch: 0.86,
      // Zoom range is back to the original: the same 0.15 to 6 the camera had before it was
      // pinned, so pulling back all the way out is possible again.
      distance: framing, min: 0.15, max: 6, minPitch: 0.035, maxPitch: 1.42,
      // Zoomed in this far, WASD is how the map gets explored. Kept well inside the ground's
      // faded rim: at 0.95 the camera could walk to the edge and see past it into the backdrop.
      roam: 0.58 };
  }

  private placeDesktopScenes(): void {
    this.rig.setLocalPosition(0, 0, 0);
    this.rig.setLocalEulerAngles(0, 0, 0);
    for (const root of [this.map.root, this.venue.root]) {
      root.setLocalPosition(0, 0, 0);
      root.setLocalEulerAngles(0, 0, 0);
    }
    this.map.root.setLocalScale(1, 1, 1);
    if (this.mode === 'map' && !this.leaving.has('station')) this.parkStation();
    else if (this.mode === 'station') {
      this.station.root.setLocalPosition(...stationHome);
      this.station.root.setLocalEulerAngles(0, 0, 0);
      this.station.root.setLocalScale(1, 1, 1);
    }
    if (!this.leaving.has('dish')) this.dish.setPose([0, 0, 0]);
    const [x, , z] = this.venue.spawn;
    if (this.mode === 'dish') this.venue.roomRoot.setLocalPosition(-x, -0.74, 2 - z);
    else if (this.mode === 'venue') this.venue.roomRoot.setLocalPosition(0, 0, 0);
  }

  private setupXR(xr: pc.XrManager): void {
    this.surfaces?.destroy();
    this.surfaces = new PhysicalSurfaces(xr, this.rig);
    this.presence = new XRPresence(xr, xr.app.root, this.rig, this.camera, this.picker, {
      buttons: this.actions.targets,
      targets: () => [...this.reviewDeck.active.flatMap(({ targets }) => targets), ...this.sceneTargets()],
      selectEmpty: () => {
        if (this.mode === 'dish' && this.isPassthrough() && this.hasRecentHit()) this.placeOnTable();
      },
      recenter: () => this.resetCamera(),
      toggleVoice: () => this.callbacks.onToggleVoice(),
      deck: this.actions.bounds,
      menu: () => this.activeMenu(),
      menuTabletop: (menu, at) => this.mode === 'dish' && menu === this.dish.menu && !this.awaitingPlacement()
        ? this.dish.tabletopY(at, menu.surfaceBaseOffset) : undefined,
      reviews: () => this.reviewDeck.active,
      dishes: () => this.mode === 'dish' && !this.awaitingPlacement() ? this.dish.grabbableDishes() : [],
      turntable: () => this.activeTurntable(),
      canSnapTurn: () => this.mode === 'venue',
      turntableMoved: (surface) => this.turntableMoved(surface),
      snapSurface: (entity, position, lock) => {
        const menu = this.activeMenu();
        const offset = entity === menu?.entity ? menu.surfaceBaseOffset
          : entity === this.station.root ? cartridgeDepth : dishClearance;
        return this.surfaces?.snapAt(position, offset, 0.10, lock);
      },
      previewSurface: (surface) => { this.surfacePreview = surface; },
      reducedMotion: () => this.reducedMotion.matches,
      spin: (radians) => {
        if (this.mode === 'dish') this.dish.drag(radians, true);
        else this.activeTurntable()?.entity.rotate(0, radians * pc.math.RAD_TO_DEG, 0);
      },
    });
    xr.on('available', () => this.emitXRState());
    xr.on('start', () => {
      if (this.destroyed) { this.endSession(xr); return; }
      this.settleDive();
      this.activeXR = xr.type === pc.XRTYPE_AR ? 'ar' : 'vr';
      this.neighborhoodFramed = false;
      this.returningToNeighborhood = false;
      this.preVenueRig = undefined;
      this.surfaceMatches.clear();
      this.manualPlacement.clear();
      this.actions.recenter();
      if (this.activeXR === 'vr' && !this.gallery) this.buildGallery(xr.app.root, xr.app.graphicsDevice);
      this.orbit.enabled = false;
      this.canvas.style.cursor = '';
      this.setHover(undefined);
      this.waitingForXRFrame = true;
      this.xrFramePending = true;
      this.applyPresentation();
      this.emitXRState();
      if (this.exitAfterStart) this.endSession(xr);
    });
    xr.on('end', () => {
      if (this.destroyed) return;
      this.activeXR = 'none';
      this.pendingReviews = undefined;
      this.reviewDeck.clear();
      this.dish.resetDishes();
      this.dish.menu.resetPose();
      this.venue.menu.resetPose();
      this.returningToNeighborhood = false;
      this.preVenueRig = undefined;
      this.deckFramePending = false;
      this.sessionEnding = false;
      this.exitAfterStart = false;
      this.hitTestSource = undefined;
      this.hitTestPending = false;
      this.placement = null;
      this.lastHit = -Infinity;
      this.surfaceMatches.clear();
      this.manualPlacement.clear();
      this.surfacePreview = null;
      this.actions.setVisible(false);
      this.reticle.enabled = false;
      this.levelRing.enabled = false;
      this.placeDesktopScenes();
      this.orbit.enabled = true;
      this.orbit.frame(this.desktopPose(), true);
      this.applyPresentation();
      this.resize();
      this.emitXRState();
    });
    xr.on('update', () => { this.waitingForXRFrame = false; });
    xr.hitTest.on('available', () => this.startHitTest(xr));
    this.emitXRState();
  }

  private startHitTest(xr: pc.XrManager): void {
    if (this.destroyed || !xr.active || this.hitTestSource || this.hitTestPending) return;
    const session = xr.session;
    this.hitTestPending = true;
    const request = (includeMeshes: boolean): void => {
      xr.hitTest.start({
        spaceType: pc.XRSPACE_VIEWER,
        entityTypes: includeMeshes ? [pc.XRTRACKABLE_PLANE, pc.XRTRACKABLE_MESH] : [pc.XRTRACKABLE_PLANE],
        callback: (error, source) => {
          if (this.destroyed || !xr.active || xr.session !== session) {
            source?.remove();
            return;
          }
          if ((error || !source) && includeMeshes) {
            request(false);
            return;
          }
          this.hitTestPending = false;
          if (!source) {
            this.callbacks.onDebugLog(`XR tabletop hit test unavailable: ${String(error)}`, 'warn');
            return;
          }
          this.hitTestSource = source;
          source.on('result', (position: pc.Vec3, rotation: pc.Quat) => {
            rotation.transformVector(pc.Vec3.UP, this.normal);
            if (this.normal.y < 0.88 || position.y < 0.30 || position.y > 1.45) return;
            this.hitPosition.copy(position);
            this.lastHit = performance.now();
            this.surfaces?.recordHit(position);
          });
          source.once('remove', () => { if (this.hitTestSource === source) this.hitTestSource = undefined; });
        },
      });
    };
    request(true);
  }

  enterVR(): Promise<void> { return this.enterXR(pc.XRTYPE_VR); }

  enterAR(): Promise<void> { return this.enterXR(pc.XRTYPE_AR); }

  private enterXR(type: typeof pc.XRTYPE_VR | typeof pc.XRTYPE_AR): Promise<void> {
    const xr = this.app?.xr;
    if (!xr?.isAvailable(type)) {
      const error = new Error(`${type} is unavailable on this device`);
      this.callbacks.onDebugLog(error.message, 'warn');
      return Promise.reject(error);
    }
    if (xr.active || this.sessionStarting) return Promise.resolve();
    this.sessionStarting = true;
    this.exitAfterStart = false;
    return new Promise((resolve, reject) => {
      xr.start(this.lens, type, pc.XRSPACE_LOCALFLOOR, {
        // PlayCanvas also requests hand tracking by default, and adds hit-test for immersive AR.
        optionalFeatures: ['hand-tracking', 'bounded-floor', 'plane-detection', 'mesh-detection'],
        planeDetection: true,
        meshDetection: true,
        callback: (error) => {
          this.sessionStarting = false;
          if (error) {
            if (this.destroyed) queueMicrotask(() => xr.app.destroy());
            else this.callbacks.onDebugLog(`Could not start ${type}: ${String(error)}`, 'warn');
            reject(error);
          } else resolve();
        },
      });
    });
  }

  exitXR(): void {
    if (this.sessionStarting) {
      this.exitAfterStart = true;
      return;
    }
    if (this.app?.xr) this.endSession(this.app.xr);
  }

  private endSession(xr: pc.XrManager): void {
    if (!xr.active || this.sessionEnding) return;
    this.sessionEnding = true;
    xr.end();
  }

  private emitXRState(): void {
    const xr = this.app?.xr;
    if (!xr || this.destroyed) return;
    this.callbacks.onXrStateChange({
      vrSupported: xr.isAvailable(pc.XRTYPE_VR),
      arSupported: xr.isAvailable(pc.XRTYPE_AR),
      activeMode: this.activeXR,
    });
  }

  private isPassthrough(): boolean {
    return this.activeXR === 'ar' && !this.roomBackdrop;
  }

  private buildGallery(root: pc.Entity, device: pc.GraphicsDevice): void {
    this.gallery = child(root, 'VR gallery');
    const floor = material('#141821', 1);
    const rings = material('#2a3242', 1);
    for (const surface of [floor, rings]) {
      surface.diffuse.set(0, 0, 0);
      surface.useLighting = false;
      surface.update();
    }
    this.galleryMaterials.push(floor, rings);
    const deck = child(this.gallery, 'Gallery floor');
    const disk = pc.Mesh.fromGeometry(device, new pc.CircleGeometry({ radius: 8, sectors: 128, rings: 1 }));
    deck.addComponent('render', { meshInstances: [new pc.MeshInstance(disk, floor, deck)] });
    for (const radius of [1.5, 3.2]) {
      const ring = child(this.gallery, `Floor ring ${radius} m`, [0, 0.002, 0]);
      const mesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({
        ringRadius: radius, tubeRadius: 0.003, segments: 160, sides: 6,
      }));
      ring.setLocalScale(1, 0.2, 1);
      ring.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, rings, ring)] });
    }
  }

  private applyPresentation(): void {
    const passthrough = this.isPassthrough();
    const vr = this.activeXR === 'vr';
    if (this.gallery) this.gallery.enabled = vr;
    const flat = this.activeXR === 'none';
    // The backdrop belongs to the flat-screen view only; headsets keep their own gallery and colour.
    this.lens.clearColor = passthrough ? new pc.Color(0, 0, 0, 0)
      : flat ? this.backdrop.clearColor : new pc.Color().fromString(studioBackdrop);
    this.backdrop.root.enabled = flat;
    this.map.setImmersive(!flat);
    this.map.root.enabled = this.mode === 'map' || !!this.dive || this.leaving.has('map');
    this.station.root.enabled = this.mode === 'station' || this.mode === 'map' || !!this.dive || this.leaving.has('station');
    if (!this.dive) {
      this.map.setVisible(this.mode === 'map');
      this.station.setVisible(this.mode === 'station');
      this.station.setPinsShown(this.mode === 'station');
    }
    const outgoingVenue = this.leaving.has('venue') || this.leaving.has('dish');
    const venueRoom = this.mode === 'venue' || (this.mode === 'dish' && !passthrough) || outgoingVenue;
    this.venue.root.enabled = venueRoom;
    this.venue.setPresentation(this.mode === 'venue', this.mode === 'venue' || (this.mode === 'dish' && !passthrough));
    const dish = this.mode === 'dish';
    this.dish.root.enabled = dish || this.leaving.has('dish');
    this.dish.setPresentation(dish && !passthrough, dish && (!passthrough || !!this.placement));
    this.dish.setGrounded(!flat && !passthrough);
  }

  private frameXR(): void {
    this.xrFramePending = false;
    this.presence?.resetSceneGrab();
    if (this.activeXR === 'ar' || this.mode === 'venue') {
      this.rig.setLocalPosition(0, 0, 0);
      this.rig.setLocalEulerAngles(0, 0, 0);
    }
    if (this.mode === 'venue') {
      this.deckFramePending = true;
      this.venue.root.setLocalPosition(0, 0, 0);
      this.venue.roomRoot.setLocalPosition(0, 0, 0);
      const [x, y, z] = this.venue.spawn;
      this.rig.setLocalEulerAngles(0, -this.headYaw(), 0);
      this.rig.getRotation().transformVector(this.camera.getLocalPosition(), this.normal);
      this.rig.setLocalPosition(x - this.normal.x, this.activeXR === 'vr' ? 0 : y - this.normal.y, z - this.normal.z);
      return;
    }

    const viewer = this.camera.getPosition();
    const yaw = this.headYaw();
    if (this.mode === 'dish') {
      const x = viewer.x + this.heading.x * xrDishDistance;
      const y = clamp(viewer.y - 0.32, 0.65, 1.18);
      const z = viewer.z + this.heading.z * xrDishDistance;
      const match = this.surfaceMatches.get('dish');
      if (this.placement) {
        if (match && !this.manualPlacement.has('dish')) this.placement[1] = match.topY + (this.isPassthrough() ? dishClearance : 0);
        this.dish.setPose(this.placement, this.placementYaw);
      } else if (!this.surfaceMatches.has('dish') && !this.manualPlacement.has('dish')) {
        this.dish.setPose([x, y, z], yaw);
      }
      const at = this.dish.root.getPosition();
      this.venue.roomRoot.setLocalPosition(at.x, 0, at.z);
    } else {
      const map = this.map.root;
      const station = this.station.root;
      if (this.returningToNeighborhood) {
        this.returningToNeighborhood = false;
        const model = this.mode === 'map' ? map : station;
        const offset = this.normal.sub2(model.getPosition(), viewer);
        const distance = offset.length();
        offset.y = 0;
        if (model.getLocalScale().x <= standbyScale || distance < 0.35 || distance > 1.15 ||
          offset.normalize().dot(this.heading) < 0.4) {
          this.neighborhoodFramed = false;
          for (const scene of ['map', 'station'] as const) {
            this.surfaceMatches.delete(scene);
            this.manualPlacement.delete(scene);
          }
        }
      }
      map.setLocalScale(1, 1, 1);
      if (!this.neighborhoodFramed) {
        this.xrMapHome.copy(viewer).addScaled(this.heading, xrMapDistance);
        this.xrMapHome.y = clamp(viewer.y - 0.36, 0.65, 1.18);
        this.xrStationHome.copy(viewer).addScaled(this.heading, xrStationDistance);
        this.xrStationHome.y = clamp(viewer.y - 0.34, 0.65, 1.18);
        map.setPosition(this.xrMapHome);
        map.setEulerAngles(0, yaw, 0);
      }
      if (this.mode === 'map') this.parkStation();
      else {
        if (!this.neighborhoodFramed || station.getLocalScale().x <= standbyScale) {
          station.setPosition(this.stationStage());
          station.setRotation(map.getRotation());
        }
        station.setLocalScale(1, 1, 1);
        this.station.setPinsShown(true);
      }
      this.neighborhoodFramed = true;
    }
  }

  private stationStage(): pc.Vec3 {
    const map = this.map.root.getPosition();
    const moved = this.manualPlacement.has('map') || map.distanceSq(this.xrMapHome) >= 0.0001;
    const match = this.surfaceMatches.get('map') ?? (!moved ? this.findSurface('station') : undefined);
    if (match) {
      this.surfaceMatches.set('station', match);
      const at = this.surfaceMatches.has('map') ? map : match.position;
      return new pc.Vec3(at.x, match.topY + cartridgeDepth, at.z);
    }
    this.surfaceMatches.delete('station');
    if (!moved) return this.xrStationHome.clone();
    return new pc.Vec3(map.x, clamp(map.y + xrDeckLift, 0.35, 1.80), map.z);
  }

  private findSurface(mode: SurfaceScene): SurfaceMatch | undefined {
    this.headYaw();
    return this.surfaces?.bestTableInFront(this.camera.getPosition(), this.heading, mode === 'dish' ? 2.4 : 1.4);
  }

  private matchNearbySurface(): void {
    const mode = this.mode;
    if (mode === 'venue' || this.dive || this.presence?.isGrabbing ||
      this.manualPlacement.has(mode) || this.surfaceMatches.has(mode)) return;
    const surface = this.findSurface(mode);
    if (!surface) return;
    this.surfaceMatches.set(mode, surface);
    const { x, z } = surface.position;
    if (mode === 'dish') {
      const y = surface.topY + (this.isPassthrough() ? dishClearance : 0);
      this.placement = [x, y, z];
      this.placementYaw = this.headYaw();
      this.dish.setPose(this.placement, this.placementYaw);
      this.venue.roomRoot.setLocalPosition(x, 0, z);
      this.applyPresentation();
    } else if (mode === 'map') {
      this.map.root.setPosition(x, surface.topY + mapClearance, z);
      this.parkStation();
    } else {
      this.station.root.setPosition(x, surface.topY + cartridgeDepth, z);
    }
  }

  private headYaw(): number {
    this.heading.copy(this.camera.forward);
    this.heading.y = 0;
    if (this.heading.lengthSq() < 0.0001) this.heading.copy(pc.Vec3.FORWARD);
    this.heading.normalize();
    return Math.atan2(-this.heading.x, -this.heading.z) * pc.math.RAD_TO_DEG;
  }

  private awaitingPlacement(): boolean {
    return this.mode === 'dish' && this.isPassthrough() && !this.placement;
  }

  private activeTurntable(): PickBounds | null {
    if (this.dive || this.xrFramePending || this.awaitingPlacement() || this.mode === 'venue') return null;
    return this.turntables[this.mode];
  }

  private turntableMoved(surface?: SurfaceMatch | null): void {
    const mode = this.mode;
    if (mode === 'venue') return;
    if (surface !== undefined) {
      this.manualPlacement.add(mode);
      if (surface) this.surfaceMatches.set(mode, surface);
      else this.surfaceMatches.delete(mode);
    }
    if (mode !== 'dish') return;
    this.dish.syncTableHeight();
    const { x, y, z } = this.dish.root.getPosition();
    const forward = this.dish.root.forward;
    this.placement = [x, y, z];
    this.placementYaw = Math.atan2(-forward.x, -forward.z) * pc.math.RAD_TO_DEG;
  }

  private hasRecentHit(): boolean { return performance.now() - this.lastHit < 350; }

  private placeOnTable(): void {
    this.presence?.resetSceneGrab();
    const at = this.rig.getWorldTransform().transformPoint(this.hitPosition);
    at.y += dishClearance;
    const match = this.surfaces?.snapAt(at, dishClearance, 0.025);
    this.placement = [at.x, at.y, at.z];
    this.placementYaw = this.headYaw();
    this.dish.setPose(this.placement, this.placementYaw);
    this.turntableMoved(match?.surface ?? null);
    this.applyPresentation();
  }

  private sceneTargets(): HitTarget[] {
    switch (this.mode) {
      case 'map': return this.map.targets;
      case 'station': return this.station.targets;
      case 'venue': return this.venue.targets;
      case 'dish': return this.dish.targets;
    }
  }

  private activeMenu() {
    const menu = this.mode === 'venue' ? this.venue?.menu : this.mode === 'dish' && !this.awaitingPlacement() ? this.dish?.menu : undefined;
    return menu?.entity.enabled ? menu : undefined;
  }

  private transferHeldMenu(previous?: PhysicalMenuBook): void {
    const next = this.activeMenu();
    if (previous && next && previous !== next && this.presence?.transferMenuGrab(previous, next)) {
      this.reveal.finish(previous.entity, false);
    }
  }

  private aimRay(clientX: number, clientY: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    this.lens.screenToWorld(clientX - rect.left, clientY - rect.top, 1, this.rayEnd, rect.width, rect.height);
    this.ray.origin.copy(this.camera.getPosition());
    this.ray.direction.sub2(this.rayEnd, this.ray.origin).normalize();
    return true;
  }

  private pickCanvas(clientX: number, clientY: number): void {
    if (this.dive || this.activeXR !== 'none' || !this.aimRay(clientX, clientY)) return;
    this.picker.pick(this.ray, this.sceneTargets());
  }

  private update(dt: number): void {
    if (this.destroyed) return;
    // The transition only moves scene objects; the camera stays under the viewer's control.
    if (this.dive) {
      if (this.reducedMotion.matches) this.settleDive();
      else this.stepDive(Math.min(dt, 1 / 30));
    }
    if (this.activeXR === 'none') this.orbit.update(dt);
    else {
      if (this.waitingForXRFrame) return;
      const turned = this.presence?.updateControls(dt, this.activeXR === 'vr');
      if (this.xrFramePending) this.frameXR();
      this.syncReviewCards();
      this.matchNearbySurface();
      const placing = this.awaitingPlacement();
      const found = placing && this.hasRecentHit();
      this.reticle.enabled = found;
      if (found) {
        const at = this.rig.getWorldTransform().transformPoint(this.hitPosition);
        this.reticle.setPosition(at.x, at.y + 0.006, at.z);
      }
      const preview = this.surfacePreview;
      this.levelRing.enabled = !!preview;
      if (preview) this.levelRing.setPosition(preview.position.x, preview.topY + 0.003, preview.position.z);
      const matched = preview ?? (this.mode === 'venue' ? undefined : this.surfaceMatches.get(this.mode));
      const surfaceStatus = matched ? `${matched.label} ${preview ? 'lock' : 'matched'} · ${Math.round(
        (matched.topY - this.rig.getPosition().y) * 100)} cm` : '';
      const placementText = placing ? (found ? 'Select to place dishes' : 'Look at a tabletop or press ROOM') : '';
      this.actions.setVisible(true);
      this.actions.setState(this.activeXR === 'ar', this.roomBackdrop, placementText, this.mode, surfaceStatus);
      const clearance = this.mode === 'venue' || this.awaitingPlacement() ? undefined : this.turntables[this.mode];
      this.actions.update(this.camera, dt, this.presence?.leftForearmPose() ?? null, !!turned || this.deckFramePending,
        (target) => this.presence?.isTargetEngaged(target) ?? false, clearance);
      this.deckFramePending = false;
    }
    const labels = this.dive ? 1 - smooth(this.dive.u / 0.14) : this.mode === 'map' ? 1 : 0;
    this.map.update(dt, this.camera, this.lens, labels);
    if (this.mode === 'station' || this.dive) this.station.update(dt, this.camera);
    if (this.mode === 'dish') this.dish.update(dt, this.reducedMotion.matches);
    this.activeMenu()?.update(dt, this.reducedMotion.matches);
    if (this.activeXR !== 'none') this.presence?.updateHandhelds(dt);
    this.splats.update(dt);
    this.reveal.update(dt);
    if (this.activeXR === 'none') this.backdrop.update(this.camera);
    this.updateSceneExits(dt);
    if (this.activeXR !== 'none') {
      this.presence?.updatePointers();
      const menu = this.activeMenu();
      menu?.setHoveredDish(menu.targets.find((target) => this.presence?.isTargetEngaged(target))?.key);
    }
    if (dt <= 0) return;
    this.fps = this.fps ? pc.math.lerp(this.fps, 1 / dt, damp(dt, 2.8)) : 1 / dt;
    this.statsTime += dt;
    if (this.statsTime < 0.5) return;
    this.statsTime %= 0.5;
    const fps = Math.round(this.fps);
    this.callbacks.onStatsUpdate({
      fps,
      loadedSplats: this.splats.loadedSplats,
      activeAssetLabel: this.mode === 'dish' ? this.splats.label('dish') ?? 'Dish table'
        : this.mode === 'venue' ? this.splats.label('room') ?? 'Photo preview'
          : this.mode === 'station' ? 'Station diorama' : 'Boston subway sculpture',
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.events.abort();
    this.canvas.style.cursor = '';
    this.resizeObserver?.disconnect();
    this.orbit?.destroy();
    this.presence?.destroy();
    this.surfaces?.destroy();
    this.reviewDeck?.clear();
    this.reveal?.destroy();
    this.actions?.destroy();
    this.gallery?.destroy();
    this.backdrop?.destroy();
    for (const surface of this.galleryMaterials) surface.destroy();
    this.reticle?.destroy();
    this.reticleMaterial?.destroy();
    this.levelRing?.destroy();
    this.levelMesh?.destroy();
    this.levelMaterial?.destroy();
    this.dish?.destroy();
    this.venue?.destroy();
    this.station?.destroy();
    this.map?.destroy();
    this.splats?.destroy();
    this.models?.destroy();
    const app = this.app;
    this.app = undefined;
    if (!app) return;
    const xr = app.xr;
    if (xr && (xr.active || this.sessionStarting)) {
      app.autoRender = false;
      xr.once('end', () => queueMicrotask(() => app.destroy()));
      if (!this.sessionStarting) this.endSession(xr);
    } else {
      app.destroy();
    }
  }
}
