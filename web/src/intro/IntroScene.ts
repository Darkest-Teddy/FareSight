import * as pc from 'playcanvas';
import { STOPS } from '@faresight/shared';
import { offlineCatalog, offlineManifest } from '../data/fallbackData';
import { JarvisReveal, jarvisPoints } from '../xr/JarvisReveal';
import { MapSculptureScene } from '../xr/MapSculptureScene';
import { SplatLoader } from '../xr/SplatLoader';
import { StationDioramaScene } from '../xr/StationDioramaScene';
import { Backdrop } from '../xr/Backdrop';
import { assetBase, child, clamp, damp, ModelLibrary, smooth } from '../xr/sceneSupport';

/**
 * The landing page's 3D stage. It floats the app's map sculpture and station diorama in the
 * dusk sky dome. Scroll progress drives the camera, mesh reveals, and the room splat.
 */

export const STOP_ID = 'place-bucen';
export const PLACE_ID = 'bu-ramen-01';

const mapHeight = 1.0;
// Same constants as the in-app dive, so the landing page shows the real transition.
const seedScale = 0.006;
const standbyScale = 0.0004;
const deckLift = 0.04;

type Anchor = 'map' | 'stop' | 'stage' | 'pin' | 'door';

interface Shot {
  at: number;
  look: Anchor;
  yaw: number;
  pitch: number;
  distance: number;
  /** Where the subject sits on screen, as a fraction of the half-width / half-height. */
  shiftX: number;
  shiftY: number;
}

/** Scroll progress at which the dive starts and ends. */
export const DIVE: [number, number] = [0.345, 0.585];
/** Past this point the station plaques dissolve, clearing the view of the marker below. */
export const CLEAR_AT = 0.305;
/** Over this stretch every flag but the ramen counter's folds back into its roof. */
export const FOCUS: [number, number] = [0.775, 0.835];
export const ROOM_START = 0.92;
const PIN_REVEAL = [0.557, 0.635] as const;
const CITY_EXIT = [0.91, 0.96] as const;
const featured = offlineCatalog.places.find((place) => place.id === PLACE_ID);

const shots: Shot[] = [
  // The visitor sees the full network above the gallery floor.
  { at: 0.00, look: 'map', yaw: -0.44, pitch: 0.44, distance: 2.02, shiftX: 0.31, shiftY: 0.12 },
  { at: 0.10, look: 'map', yaw: -0.30, pitch: 0.47, distance: 1.88, shiftX: 0.31, shiftY: 0.12 },
  // Lean in over the table until BU Central's marker fills the view.
  { at: 0.27, look: 'stop', yaw: 0.10, pitch: 0.62, distance: 0.74, shiftX: 0, shiftY: 0.26 },
  { at: 0.36, look: 'stop', yaw: 0.22, pitch: 1.12, distance: 0.36, shiftX: 0, shiftY: 0 },
  // The neighbourhood grows out of the marker; settle beside it and walk a quarter turn.
  { at: 0.585, look: 'stage', yaw: -0.52, pitch: 0.50, distance: 1.86, shiftX: 0.27, shiftY: 0 },
  { at: 0.74, look: 'stage', yaw: -0.02, pitch: 0.44, distance: 1.70, shiftX: 0.27, shiftY: 0 },
  // One flag left standing: the ramen counter, seen from across the avenue.
  { at: 0.88, look: 'pin', yaw: 0.72, pitch: 0.60, distance: 0.72, shiftX: -0.26, shiftY: -0.09 },
  { at: 0.925, look: 'pin', yaw: 0.80, pitch: 0.54, distance: 0.62, shiftX: -0.26, shiftY: -0.09 },
  // Slide down the stem to the front door.
  { at: 0.972, look: 'door', yaw: 0.96, pitch: 0.13, distance: 0.085, shiftX: 0, shiftY: 0 },
];

function progressAt(value: number, start: number, end: number): number {
  return clamp((value - start) / (end - start), 0, 1);
}

function reducedScene(p: number): number {
  if (p >= ROOM_START) return 1;
  if (p >= FOCUS[1]) return 0.89;
  if (p >= (DIVE[0] + DIVE[1]) / 2) return 0.67;
  return p >= 0.20 ? 0.22 : 0;
}

export class IntroScene {
  private app?: pc.Application;
  private camera!: pc.Entity;
  private lens!: pc.CameraComponent;
  private models!: ModelLibrary;
  private reveal!: JarvisReveal;
  private map!: MapSculptureScene;
  private station!: StationDioramaScene;
  private splats!: SplatLoader;
  private backdrop!: Backdrop;
  private roomRoot!: pc.Entity;
  private roomReady = false;
  private roomSpawn = new pc.Vec3();
  private roomOffset = new pc.Vec3();
  private roomEye = new pc.Vec3();
  private resizeObserver?: ResizeObserver;
  private events = new AbortController();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private allPlaces = new Set(offlineCatalog.places.map((place) => place.id));
  private pin?: pc.Entity;
  private otherPins: pc.Entity[] = [];
  private lastDive = -1;
  private calloutProgress = 1;
  private cityProgress = -1;
  private galleryProgress = 1;
  private pinsProgress = -1;
  private featuredProgress = -1;
  private focus = -1;
  private clock = 0;
  private awakeUntil = 0;
  private started = false;
  private loadRoom?: () => void;
  private pointer = { x: 0, y: 0, easedX: 0, easedY: 0 };
  private anchor = new pc.Vec3();
  private stage = new pc.Vec3();
  private center = new pc.Vec3();
  private from = new pc.Vec3();
  private to = new pc.Vec3();
  private target = new pc.Vec3();
  private eye = new pc.Vec3();

  /** `onFrame` runs once per rendered frame and returns the eased scroll progress, 0 to 1. */
  constructor(private canvas: HTMLCanvasElement, private onFrame: (dt: number) => number) {}

  async init(onRoom: (ready: boolean) => void): Promise<void> {
    const app = new pc.Application(this.canvas, {
      graphicsDeviceOptions: { antialias: false, alpha: false, preserveDrawingBuffer: false },
    });
    this.app = app;
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.scene.ambientLight = new pc.Color(0.38, 0.39, 0.42);

    this.camera = child(app.root, 'Viewer');
    // The same sky dome the app's flat-screen view uses.
    this.backdrop = new Backdrop(app.root, app.graphicsDevice);
    this.lens = this.camera.addComponent('camera', {
      clearColor: this.backdrop.clearColor, nearClip: 0.02, farClip: 40, fov: 44,
    }) as pc.CameraComponent;
    this.addLights(app.root);

    const log = (text: string, level?: string) => { if (level === 'error') console.error(text); };
    this.models = new ModelLibrary(app, log);
    this.reveal = new JarvisReveal(app.graphicsDevice, this.reducedMotion);
    this.splats = new SplatLoader(app, log, this.reducedMotion);
    this.roomRoot = child(app.root, 'Tsuru Ramen interior', undefined, app);
    this.roomRoot.enabled = false;
    const manifest = featured && offlineManifest(featured);
    this.roomSpawn.set(...(manifest?.spawn_point ?? [0, 1.55, 2]));

    const noop = () => undefined;
    this.map = new MapSculptureScene(app.root, app.graphicsDevice, this.models, this.reveal, log, noop, this.canvas, noop);

    this.map.root.setLocalPosition(0, mapHeight, 0);
    this.map.setImmersive(true);
    this.map.setStops(STOPS);
    this.map.setPlaces(offlineCatalog.places, this.allPlaces);
    const sculpture = await this.models.load(`${assetBase}boston-map-sculpture.glb`);
    if (this.app !== app) return;
    if (!sculpture) throw new Error('The map sculpture could not be loaded');

    this.station = new StationDioramaScene(app, this.models, this.reveal, log, noop);
    this.station.setPlaces(offlineCatalog.places, this.allPlaces);
    this.station.setPinsShown(false, true);
    this.station.seekReveal(0);
    this.parkStation();

    window.addEventListener('pointermove', (event) => {
      this.pointer.x = event.clientX / Math.max(1, window.innerWidth) * 2 - 1;
      this.pointer.y = event.clientY / Math.max(1, window.innerHeight) * 2 - 1;
      if (!this.reducedMotion.matches && event.pointerType === 'mouse') this.wake();
    }, { signal: this.events.signal, passive: true });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
    app.on('update', (dt: number) => this.update(dt));

    const stop = STOPS.find((item) => item.stop_id === STOP_ID);
    const station = stop ? this.station.show(stop) : Promise.resolve();
    void station.then(() => {
      if (this.app !== app) return;
      this.findPins();
      this.cityProgress = this.pinsProgress = -1;
      this.wake();
    }).catch(() => {});
    this.loadRoom = () => {
      this.loadRoom = undefined;
      void this.splats.show('room', manifest?.room_asset, this.roomRoot).then((roomReady) => {
        if (this.app !== app) return;
        this.roomReady = roomReady;
        onRoom(roomReady);
        this.wake();
      });
      this.splats.seekReveal('room', 0);
    };
  }

  start(): void {
    if (!this.app || this.started) return;
    this.started = true;
    this.app.start();
    this.wake();
  }

  wake(): void {
    this.awakeUntil = performance.now() + (this.reducedMotion.matches ? 200 : 2_000);
    if (this.started && this.app && !this.app.frameRequestId) this.app.requestAnimationFrame();
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

  private resize(): void {
    if (!this.app) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const device = this.app.graphicsDevice;
    device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    device.resizeCanvas(width, height);
    this.lens.fov = clamp(44 + (1 - width / height) * 38, 44, 74);
    this.wake();
  }

  private parkStation(): void {
    const at = this.map.root.getPosition();
    this.station.root.setPosition(at.x, at.y + 0.02, at.z);
    this.station.root.setLocalScale(standbyScale, standbyScale, standbyScale);
  }

  /** Pose the map and the neighbourhood for dive progress `u`, exactly as the app does. */
  private applyDive(u: number): boolean {
    const origin = this.map.root.getPosition();
    const marker = this.map.stopPosition(STOP_ID);
    if (marker) this.anchor.copy(marker).add(origin);
    else this.anchor.set(origin.x - 0.15, origin.y + 0.07, origin.z + 0.067);
    this.stage.set(origin.x, origin.y + deckLift, origin.z);

    const travel = smooth((u - 0.12) / 0.78);
    if (u <= 0) this.parkStation();
    else {
      const grow = smooth((u - 0.05) / 0.76);
      const center = this.center.lerp(this.anchor, this.stage, travel);
      center.y += 0.05 * Math.sin(Math.PI * travel);
      const settle = 1 + 0.045 * Math.sin(Math.PI * clamp((u - 0.8) / 0.2, 0, 1));
      const size = pc.math.lerp(seedScale, 1, grow ** 1.12) * settle;
      this.station.root.setLocalScale(size, size, size);
      this.station.root.setPosition(center);
    }
    if (u === this.lastDive) return false;
    if (u === 0 && this.lastDive < 0) this.map.setVisible(true);
    else this.map.seekReveal(1 - clamp((u - 0.11) / 0.65, 0, 1));
    this.lastDive = u;
    return true;
  }

  /** The ramen counter's pin and its neighbours, once the neighbourhood has built them. */
  private findPins(): void {
    if (this.pin) return;
    const named = (name: string) => this.station.root.findByName(name) as pc.Entity | null;
    this.pin = (featured && named(featured.name)) ?? undefined;
    if (!this.pin) return;
    this.otherPins = offlineCatalog.places
      .filter((place) => place.stop_id === STOP_ID && place.id !== PLACE_ID)
      .map((place) => named(place.name))
      .filter((entity): entity is pc.Entity => !!entity);
  }

  private applyPins(p: number, leaving: number): void {
    const pins = progressAt(p, ...PIN_REVEAL);
    if (pins !== this.pinsProgress) {
      this.pinsProgress = pins;
      this.station.seekPins(pins);
      this.focus = this.featuredProgress = -1;
    }
    if (pins < 1) return;
    const focus = smooth(progressAt(p, ...FOCUS));
    if (focus !== this.focus) {
      this.focus = focus;
      for (const pin of this.otherPins) this.reveal.seek(pin, 1 - focus, jarvisPoints.detail);
    }
    const featuredProgress = 1 - leaving;
    if (this.pin && featuredProgress !== this.featuredProgress) {
      this.featuredProgress = featuredProgress;
      this.reveal.seek(this.pin, featuredProgress, jarvisPoints.detail);
    }
  }

  private alignRoom(): void {
    const shot = shots[shots.length - 1];
    const eye = this.resolve('door', this.roomEye);
    const horizontal = Math.cos(shot.pitch) * shot.distance;
    eye.x += Math.sin(shot.yaw) * horizontal;
    eye.y += Math.sin(shot.pitch) * shot.distance;
    eye.z += Math.cos(shot.yaw) * horizontal;
    this.roomRoot.setLocalEulerAngles(0, shot.yaw * pc.math.RAD_TO_DEG, 0);
    this.roomRoot.getRotation().transformVector(this.roomSpawn, this.roomOffset);
    this.roomRoot.setPosition(eye.sub(this.roomOffset));
  }

  private resolve(anchor: Anchor, out: pc.Vec3): pc.Vec3 {
    if (anchor === 'map') {
      const at = this.map.root.getPosition();
      return out.set(at.x, at.y + 0.05, at.z);
    }
    if (anchor === 'stop') return out.copy(this.anchor);
    if (anchor === 'stage') return out.set(this.stage.x, this.stage.y + 0.12, this.stage.z);
    // Pins live in the neighbourhood's own space, which rests on the stage at full size.
    const local = this.pin?.getLocalPosition();
    out.set(this.stage.x + (local?.x ?? -0.006), this.stage.y + (local?.y ?? 0.002), this.stage.z + (local?.z ?? 0.042));
    // The flag stands on a brass stem; frame the pair, or drop to the roof they stand on.
    const flag = this.pin?.children.find((node) => node.name === this.pin?.name) as pc.Entity | undefined;
    const stem = flag?.getLocalPosition().y ?? 0.2;
    out.y += anchor === 'pin' ? stem * 0.6 : 0.004;
    return out;
  }

  private poseCamera(p: number, dt: number): void {
    let index = 1;
    while (index < shots.length - 1 && shots[index].at < p) index++;
    const a = shots[index - 1];
    const b = shots[index];
    const t = smooth((p - a.at) / (b.at - a.at));
    const aspect = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    // Wide screens set the subject beside the copy; tall screens lift it above the copy.
    const wide = clamp((aspect - 0.85) / 0.55, 0, 1);
    const reach = clamp(0.75 / Math.max(aspect, 0.4), 1, 1.5);
    const mix = (from: number, to: number) => pc.math.lerp(from, to, t);

    const target = this.target.lerp(this.resolve(a.look, this.from), this.resolve(b.look, this.to), t);
    // Distance is blended in log space so the push-in keeps an even pace.
    const distance = Math.exp(mix(Math.log(a.distance), Math.log(b.distance))) * reach;
    let yaw = mix(a.yaw, b.yaw);
    let pitch = mix(a.pitch, b.pitch);
    if (!this.reducedMotion.matches) {
      const ease = damp(dt, 3);
      this.pointer.easedX += (this.pointer.x - this.pointer.easedX) * ease;
      this.pointer.easedY += (this.pointer.y - this.pointer.easedY) * ease;
      const sway = 1 - smooth(progressAt(p, ...CITY_EXIT));
      yaw += (0.03 * Math.sin(this.clock * 0.23) - 0.045 * this.pointer.easedX) * sway;
      pitch += (0.010 * Math.sin(this.clock * 0.31) + 0.025 * this.pointer.easedY) * sway;
    }
    const horizontal = Math.cos(pitch) * distance;
    this.eye.set(target.x + Math.sin(yaw) * horizontal, target.y + Math.sin(pitch) * distance, target.z + Math.cos(yaw) * horizontal);
    this.camera.setPosition(this.eye);
    this.camera.lookAt(target);
    const tanV = Math.tan(this.lens.fov * pc.math.DEG_TO_RAD / 2);
    const shiftX = mix(a.shiftX, b.shiftX) * wide;
    const shiftY = pc.math.lerp(0.26, mix(a.shiftY, b.shiftY), wide);
    this.camera.translateLocal(-shiftX * distance * tanV * aspect, -shiftY * distance * tanV, 0);
  }

  private update(dt: number): void {
    this.clock += dt;
    const scroll = clamp(this.onFrame(dt), 0, 1);
    if (scroll > 0.67) this.loadRoom?.();
    const p = this.reducedMotion.matches ? reducedScene(scroll) : scroll;
    const dive = progressAt(p, ...DIVE);
    const initial = this.lastDive < 0;
    const diveChanged = this.applyDive(dive);
    const callouts = 1 - smooth(progressAt(p, CLEAR_AT, DIVE[0]));
    if (callouts !== this.calloutProgress || (diveChanged && !initial)) {
      this.calloutProgress = callouts;
      this.map.seekCallouts(callouts);
    }
    const leaving = this.roomReady ? smooth(progressAt(p, ...CITY_EXIT)) : 0;
    const city = clamp((dive - 0.22) / 0.75, 0, 1) * (1 - leaving);
    this.station.root.enabled = dive > 0 && leaving < 1;
    if (city !== this.cityProgress) {
      this.cityProgress = city;
      this.station.seekReveal(city);
      this.station.seekMarker(city);
    }
    this.applyPins(p, leaving);
    const inside = this.roomReady ? progressAt(p, ROOM_START, 1) : 0;
    if (inside > 0 && !this.roomRoot.enabled) {
      this.alignRoom();
      this.roomRoot.enabled = true;
    } else if (inside <= 0) {
      this.roomRoot.enabled = false;
    }
    this.splats.seekReveal('room', inside);
    this.poseCamera(this.roomReady ? p : Math.min(p, 0.925), dt);
    this.backdrop.update(this.camera);
    this.map.update(dt, this.camera, this.lens, 0);
    if (this.station.root.enabled) this.station.update(this.reducedMotion.matches ? 1 : dt, this.camera);
    this.reveal.update(dt);
    const app = this.app;
    if (app?.frameRequestId && performance.now() >= this.awakeUntil) {
      cancelAnimationFrame(app.frameRequestId);
      app.frameRequestId = null;
    }
  }

  destroy(): void {
    if (!this.app) return;
    this.events.abort();
    this.started = false;
    this.loadRoom = undefined;
    this.resizeObserver?.disconnect();
    this.map?.destroy();
    this.station?.destroy();
    this.splats?.destroy();
    this.reveal?.destroy();
    this.models?.destroy();
    this.backdrop?.destroy();
    this.app?.destroy();
    this.app = undefined;
  }
}
