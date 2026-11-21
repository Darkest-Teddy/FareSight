import * as pc from 'playcanvas';
import type {
  FareSightSceneEngine, SceneMode, XRDishData, XRFilterSummary, XRManifestData,
  XRPlaceData, XRSceneCallbacks, XRStopData, XRVehicleData,
} from './bridgeTypes';
import { XRActionBar } from './CanvasPanel3D';
import { DishTableScene } from './DishTableScene';
import { MapSculptureScene } from './MapSculptureScene';
import { OrbitCamera } from './OrbitCamera';
import { SplatLoader } from './SplatLoader';
import { StationDioramaScene } from './StationDioramaScene';
import { VenueSplatScene } from './VenueSplatScene';
import { child, clamp, cyan, damp, material, ModelLibrary, ScenePicker, shape, type HitTarget, type XYZ } from './sceneSupport';

type ActiveXR = 'none' | 'vr' | 'ar';

export class PlayCanvasApp implements FareSightSceneEngine {
  private app?: pc.Application;
  private camera!: pc.Entity;
  private lens!: pc.CameraComponent;
  private rig!: pc.Entity;
  private orbit!: OrbitCamera;
  private models!: ModelLibrary;
  private splats!: SplatLoader;
  private map!: MapSculptureScene;
  private station!: StationDioramaScene;
  private venue!: VenueSplatScene;
  private dish!: DishTableScene;
  private actions!: XRActionBar;
  private reticle!: pc.Entity;
  private reticleMaterial!: pc.StandardMaterial;
  private resizeObserver?: ResizeObserver;
  private picker = new ScenePicker();
  private ray = new pc.Ray();
  private rayEnd = new pc.Vec3();
  private mode: SceneMode = 'map';
  private activeXR: ActiveXR = 'none';
  private sessionStarting = false;
  private sessionEnding = false;
  private exitAfterStart = false;
  private virtualTable = false;
  private xrFramePending = false;
  private hitTestSource?: pc.XrHitTestSource;
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
  private telemetry = new Map<string, [number | null, number]>();
  private activeStop?: string;
  private place?: XRPlaceData;
  private manifest: XRManifestData | null = null;
  private fit: [boolean, number, 'seated' | 'standing'] = [false, 1, 'seated'];
  private destroyed = false;

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
      app.scene.ambientLight = new pc.Color(0.29, 0.35, 0.45);
      app.scene.gsplat.splatBudget = 160_000;
      this.rig = child(app.root, 'Camera rig');
      this.camera = child(this.rig, 'Viewer');
      this.lens = this.camera.addComponent('camera', {
        clearColor: new pc.Color().fromString('#0B1020'), nearClip: 0.025, farClip: 65, fov: 48,
      }) as pc.CameraComponent;
      this.addLights(app.root);
      this.models = new ModelLibrary(app, this.callbacks.onDebugLog);
      this.splats = new SplatLoader(app, this.callbacks.onDebugLog);
      this.map = new MapSculptureScene(app.root, app.graphicsDevice, this.models, this.callbacks.onDebugLog,
        (id) => this.selectStop(id));
      this.station = new StationDioramaScene(app.root, app.graphicsDevice, this.models, this.callbacks.onDebugLog,
        this.callbacks.onSelectPlace);
      this.venue = new VenueSplatScene(app.root, app.graphicsDevice, this.splats,
        this.callbacks.onSelectDish);
      this.dish = new DishTableScene(app.root, app.graphicsDevice, this.models, this.splats);
      this.actions = new XRActionBar(app.graphicsDevice, app.root, {
        map: () => this.navigate('map'),
        station: () => this.navigate('station'),
        back: () => this.navigate(this.mode === 'dish' ? 'venue' : this.mode === 'venue' ? 'station' : 'map'),
        virtualTable: () => this.setPassthroughFallback(!this.virtualTable),
      });
      this.reticleMaterial = material(cyan, 0.85);
      this.reticle = shape(app.root, 'Table placement indicator', 'torus', this.reticleMaterial, [0, 0, 0], [0.12, 0.011, 0.12]);
      this.reticle.enabled = false;
      this.orbit = new OrbitCamera(this.canvas, this.camera, this.desktopPose(),
        (x, y) => this.pickCanvas(x, y),
        (radians) => {
          if (this.mode !== 'dish') return false;
          this.dish.drag(radians);
          return true;
        });
      this.map.setStops(this.stops);
      this.setPlaces(this.places, this.filtered);
      this.map.setVehicles(this.vehicles);
      if (this.filters) this.station.setFilters(this.filters);
      for (const [id, data] of this.telemetry) this.station.setTelemetry(id, ...data);
      this.venue.setWillWeFit(...this.fit);
      this.applyScene('map');
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
      { name: 'Studio key', tint: '#f3f6ff', intensity: 1.55, angles: [37, -31, 36] },
      { name: 'Cyan rim', tint: '#76eaff', intensity: 0.95, angles: [30, 146, -27] },
      { name: 'Warm fill', tint: '#ffb59d', intensity: 0.48, angles: [63, 44, 35] },
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
    this.lens.fov = clamp(48 + (1 - width / height) * 38, 48, 74);
  }

  setStops(stops: XRStopData[]): void {
    this.stops = stops;
    this.map?.setStops(stops);
    if (this.mode === 'station' && this.activeStop) {
      void this.showStation().catch((error) => this.callbacks.onDebugLog(String(error), 'warn'));
    }
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

  setStationTelemetry(stopId: string, nextArrivalMin: number | null, matchingCount: number): void {
    this.telemetry.set(stopId, [nextArrivalMin, matchingCount]);
    this.station?.setTelemetry(stopId, nextArrivalMin, matchingCount);
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
    this.applyScene(mode);
  }

  async focusStop(stopId: string): Promise<void> {
    if (!this.app) return;
    const stop = this.stops.find((item) => item.stop_id === stopId);
    if (!stop) {
      this.callbacks.onDebugLog(`Station is unavailable: ${stopId}`, 'warn');
      return;
    }
    this.activeStop = stopId;
    this.map.select(stopId);
    this.applyScene('station');
    await this.showStation();
  }

  private showStation(): Promise<void> {
    const stop = this.stops.find((item) => item.stop_id === this.activeStop);
    if (!stop) return Promise.resolve();
    return this.station.show(stop, this.map.segmentFile(stop.stop_id));
  }

  async openVenue(place: XRPlaceData, manifest: XRManifestData | null): Promise<void> {
    if (!this.app) return;
    const changed = this.place?.id !== place.id;
    this.rememberVenue(place, manifest);
    const loading = this.venue.open(place, manifest);
    this.applyScene('venue', changed);
    await loading;
  }

  async openDish(place: XRPlaceData, dish: XRDishData, compareDish?: XRDishData | null, manifest?: XRManifestData | null): Promise<void> {
    if (!this.app) return;
    const changed = this.place?.id !== place.id;
    if (changed) this.dish.clear();
    const venueManifest = manifest === undefined && !changed ? this.manifest : manifest ?? null;
    this.rememberVenue(place, venueManifest);
    const room = this.venue.open(place, venueManifest);
    const table = this.dish.open(dish, compareDish ?? null, venueManifest, room);
    this.applyScene('dish', changed);
    await Promise.all([room, table]);
  }

  private rememberVenue(place: XRPlaceData, manifest: XRManifestData | null): void {
    this.place = place;
    this.manifest = manifest;
    this.activeStop = place.stop_id;
  }

  setWillWeFit(enabled: boolean, groupSize: number, seating: 'seated' | 'standing'): void {
    this.fit = [enabled, groupSize, seating];
    this.venue?.setWillWeFit(...this.fit);
  }

  setDishRotation(angleRad: number): void { this.dish?.setRotation(angleRad); }

  setPassthroughFallback(useVirtualTable: boolean): void {
    if (this.virtualTable === useVirtualTable) return;
    this.virtualTable = useVirtualTable;
    if (!this.app) return;
    if (this.activeXR === 'ar' && this.mode === 'dish') this.xrFramePending = true;
    this.applyPresentation();
  }

  resetCamera(): void {
    if (!this.app) return;
    if (this.activeXR === 'none') this.orbit.frame(this.desktopPose());
    else {
      if (this.mode === 'dish') this.placement = null;
      this.xrFramePending = true;
    }
  }

  private applyScene(mode: SceneMode, reframe = false): void {
    const changed = mode !== this.mode;
    this.mode = mode;
    const atVenue = mode === 'venue' || mode === 'dish';
    if (!atVenue) {
      this.venue.clear();
      this.place = undefined;
      this.manifest = null;
    }
    if (mode !== 'dish') this.dish.clear();
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

  private selectStop(id: string): void {
    this.activeStop = id;
    this.map.select(id);
    const pivot = this.map.stopPosition(id);
    if (this.activeXR === 'none' && pivot) {
      this.orbit.frame({ pivot, yaw: 0.13, pitch: 0.48, distance: 1.15 });
    }
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
    if (this.mode === 'station') {
      return { pivot: new pc.Vec3(0, 0.10, 0), yaw: 0.12, pitch: 0.53, distance: 1.64 * portrait };
    }
    if (this.mode === 'dish') {
      return { pivot: new pc.Vec3(0, 0.035, 0), yaw: 0, pitch: 0.66, distance: 0.86 * portrait, min: 0.21 };
    }
    if (this.mode === 'venue') {
      const [x, y, z] = this.venue?.spawn ?? [0, 1.55, 2];
      return { pivot: new pc.Vec3(x, y - 0.09, z - 1), yaw: 0, pitch: Math.atan2(0.09, 1),
        distance: Math.hypot(1, 0.09), min: 0.16 };
    }
    return { pivot: new pc.Vec3(0, 0.24, 0), yaw: 0.17, pitch: 0.57, distance: 2.20 * portrait };
  }

  private placeDesktopScenes(): void {
    this.rig.setLocalPosition(0, 0, 0);
    this.rig.setLocalEulerAngles(0, 0, 0);
    for (const root of [this.map.root, this.station.root, this.venue.root]) {
      root.setLocalPosition(0, 0, 0);
      root.setLocalEulerAngles(0, 0, 0);
    }
    this.dish.setPose([0, 0, 0]);
    const [x, , z] = this.venue.spawn;
    this.venue.root.setLocalPosition(this.mode === 'dish' ? -x : 0, this.mode === 'dish' ? -0.78 : 0, this.mode === 'dish' ? 2 - z : 0);
  }

  private setupXR(xr: pc.XrManager): void {
    xr.on('available', () => this.emitXRState());
    xr.on('start', () => {
      if (this.destroyed) { this.endSession(xr); return; }
      this.activeXR = xr.type === pc.XRTYPE_AR ? 'ar' : 'vr';
      this.orbit.enabled = false;
      this.xrFramePending = true;
      this.actions.entity.enabled = true;
      this.applyPresentation();
      this.emitXRState();
      if (this.exitAfterStart) this.endSession(xr);
    });
    xr.on('end', () => {
      if (this.destroyed) return;
      this.activeXR = 'none';
      this.sessionEnding = false;
      this.exitAfterStart = false;
      this.hitTestSource = undefined;
      this.placement = null;
      this.lastHit = -Infinity;
      this.actions.entity.enabled = false;
      this.reticle.enabled = false;
      this.placeDesktopScenes();
      this.orbit.enabled = true;
      this.orbit.frame(this.desktopPose(), true);
      this.applyPresentation();
      this.resize();
      this.emitXRState();
    });
    xr.input.on('select', (source: pc.XrInputSource) => {
      if (this.destroyed) return;
      this.ray.origin.copy(source.getOrigin());
      this.ray.direction.copy(source.getDirection());
      if (this.picker.pick(this.ray, this.actions.targets) || this.picker.pick(this.ray, this.sceneTargets())) return;
      if (this.awaitingPlacement() && this.hasRecentHit()) this.placeOnTable();
    });
    xr.hitTest.on('available', () => this.startHitTest(xr));
    this.emitXRState();
  }

  private startHitTest(xr: pc.XrManager): void {
    if (this.destroyed || this.hitTestSource) return;
    xr.hitTest.start({
      spaceType: pc.XRSPACE_VIEWER,
      entityTypes: [pc.XRTRACKABLE_PLANE],
      callback: (error, source) => {
        if (this.destroyed || !xr.active) return;
        if (error || !source) {
          this.callbacks.onDebugLog(`XR tabletop hit test unavailable: ${String(error)}`, 'warn');
          return;
        }
        this.hitTestSource = source;
        source.on('result', (position: pc.Vec3, rotation: pc.Quat) => {
          rotation.transformVector(pc.Vec3.UP, this.normal);
          if (this.normal.y < 0.86 || position.y < 0.34 || position.y > 1.55) return;
          this.hitPosition.copy(position);
          this.lastHit = performance.now();
        });
      },
    });
  }

  enterVR(): Promise<void> { return this.enterXR(pc.XRTYPE_VR); }

  enterAR(): Promise<void> { return this.enterXR(pc.XRTYPE_AR); }

  private enterXR(type: string): Promise<void> {
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
        planeDetection: type === pc.XRTYPE_AR,
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
    return this.activeXR === 'ar' && !this.virtualTable;
  }

  private applyPresentation(): void {
    const passthrough = this.isPassthrough();
    const clear = new pc.Color().fromString('#0B1020');
    if (passthrough) clear.set(0, 0, 0, 0);
    this.lens.clearColor = clear;
    this.map.root.enabled = this.mode === 'map';
    this.station.root.enabled = this.mode === 'station';
    this.venue.root.enabled = this.mode === 'venue' || (this.mode === 'dish' && !passthrough);
    this.venue.setPresentation(this.mode === 'venue', this.mode === 'venue' || !passthrough);
    this.dish.root.enabled = this.mode === 'dish';
    this.dish.setPresentation(!passthrough, !passthrough || !!this.placement);
  }

  private frameXR(): void {
    this.xrFramePending = false;
    this.rig.setLocalPosition(0, 0, 0);
    this.rig.setLocalEulerAngles(0, 0, 0);
    if (this.mode === 'venue') {
      this.venue.root.setLocalPosition(0, 0, 0);
      const [x, y, z] = this.venue.spawn;
      this.rig.setLocalEulerAngles(0, -this.headYaw(), 0);
      this.rig.getRotation().transformVector(this.camera.getLocalPosition(), this.normal);
      this.rig.setLocalPosition(x - this.normal.x, y - this.normal.y, z - this.normal.z);
      this.actions.update(this.camera, 1);
      return;
    }

    const viewer = this.camera.getPosition();
    const yaw = this.headYaw();
    const distance = this.mode === 'map' ? 1.45 : this.mode === 'station' ? 1.18 : 0.88;
    const x = viewer.x + this.heading.x * distance;
    const y = clamp(viewer.y - (this.mode === 'dish' ? 0.68 : 0.53), 0.62, 1.03);
    const z = viewer.z + this.heading.z * distance;
    if (this.mode === 'dish') {
      if (this.isPassthrough() && this.placement) this.dish.setPose(this.placement, this.placementYaw);
      else this.dish.setPose([x, y, z], yaw);
      this.venue.root.setLocalPosition(x, y - 0.78, z);
    } else {
      const root = this.mode === 'map' ? this.map.root : this.station.root;
      root.setPosition(x, y, z);
      root.setEulerAngles(0, yaw, 0);
    }
    this.actions.update(this.camera, 1);
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

  private hasRecentHit(): boolean { return performance.now() - this.lastHit < 350; }

  private placeOnTable(): void {
    this.placement = [this.hitPosition.x, this.hitPosition.y + 0.003, this.hitPosition.z];
    this.placementYaw = this.headYaw();
    this.dish.setPose(this.placement, this.placementYaw);
    this.applyPresentation();
  }

  private sceneTargets(): HitTarget[] {
    switch (this.mode) {
      case 'map': return this.map.targets;
      case 'station': return this.station.targets;
      case 'venue': return this.venue.targets;
      case 'dish': return [];
    }
  }

  private pickCanvas(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    if (!rect.width || !rect.height || this.activeXR !== 'none') return;
    this.lens.screenToWorld(clientX - rect.left, clientY - rect.top, 1, this.rayEnd, rect.width, rect.height);
    this.ray.origin.copy(this.camera.getPosition());
    this.ray.direction.sub2(this.rayEnd, this.ray.origin).normalize();
    this.picker.pick(this.ray, this.sceneTargets());
  }

  private update(dt: number): void {
    if (this.destroyed) return;
    if (this.activeXR === 'none') this.orbit.update(dt);
    else {
      if (this.xrFramePending) this.frameXR();
      this.actions.update(this.camera, damp(dt, 6));
      const placing = this.awaitingPlacement();
      const found = placing && this.hasRecentHit();
      this.reticle.enabled = found;
      if (found) this.reticle.setPosition(this.hitPosition.x, this.hitPosition.y + 0.006, this.hitPosition.z);
      const placementText = placing ? (found ? 'Select to place dishes' : 'Look at a tabletop or use Virtual Table') : '';
      this.actions.setState(this.activeXR === 'ar', this.virtualTable, placementText);
    }
    this.map.update(dt, this.camera);
    if (this.mode === 'station') this.station.update(dt, this.camera);
    if (this.mode === 'dish') this.dish.update(dt, this.camera);
    if (dt <= 0) return;
    this.fps = this.fps ? pc.math.lerp(this.fps, 1 / dt, damp(dt, 2.8)) : 1 / dt;
    this.statsTime += dt;
    if (this.statsTime < 0.5) return;
    this.statsTime %= 0.5;
    const fps = Math.round(this.fps);
    this.actions.setFps(fps);
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
    this.resizeObserver?.disconnect();
    this.orbit?.destroy();
    this.actions?.destroy();
    this.reticle?.destroy();
    this.reticleMaterial?.destroy();
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
