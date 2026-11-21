import * as pc from 'playcanvas';
import { STOPS } from '@faresight/shared';
import { offlineCatalog } from '../data/fallbackData';
import { JarvisReveal } from '../xr/JarvisReveal';
import { MapSculptureScene } from '../xr/MapSculptureScene';
import { StationDioramaScene } from '../xr/StationDioramaScene';
import { assetBase, child, clamp, damp, material, ModelLibrary, shape, smooth } from '../xr/sceneSupport';

/**
 * The landing page's 3D stage. It builds the same gallery, map sculpture and station diorama a
 * headset shows (physical plaques, plinth, floor rings, no flat-screen panels) and lets one
 * number, the scroll progress, pose the camera and scrub the app's own map-to-station dive.
 */

export const STOP_ID = 'place-bucen';
export const PLACE_ID = 'bu-ramen-01';

const backdrop = '#07080b';
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

const shots: Shot[] = [
  // The whole network on its plinth, as a visitor standing in the gallery sees it.
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
  { at: 0.935, look: 'pin', yaw: 0.80, pitch: 0.57, distance: 0.66, shiftX: -0.26, shiftY: -0.09 },
  // Slide down the stem to the front door.
  { at: 1.00, look: 'door', yaw: 0.96, pitch: 0.40, distance: 0.085, shiftX: 0, shiftY: 0 },
];

export class IntroScene {
  private app?: pc.Application;
  private camera!: pc.Entity;
  private lens!: pc.CameraComponent;
  private models!: ModelLibrary;
  private reveal!: JarvisReveal;
  private map!: MapSculptureScene;
  private station!: StationDioramaScene;
  private plinth!: pc.Entity;
  private pedestal!: pc.Entity;
  private materials: pc.StandardMaterial[] = [];
  private resizeObserver?: ResizeObserver;
  private events = new AbortController();
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  private allPlaces = new Set(offlineCatalog.places.map((place) => place.id));
  private pin?: pc.Entity;
  private otherPins: pc.Entity[] = [];
  private lastDive = 0;
  private focus = 0;
  private clock = 0;
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

  /** Resolves once the map sculpture and the BU Central neighbourhood are on the GPU. */
  async init(): Promise<void> {
    const app = new pc.Application(this.canvas, {
      graphicsDeviceOptions: { antialias: true, alpha: false, preserveDrawingBuffer: false },
    });
    this.app = app;
    app.setCanvasFillMode(pc.FILLMODE_NONE);
    app.scene.ambientLight = new pc.Color(0.38, 0.39, 0.42);
    // The gallery floor has no horizon: it falls off into the backdrop.
    const fog = app.scene.fog;
    fog.type = pc.FOG_LINEAR;
    fog.color.fromString(backdrop);
    fog.start = 2.3;
    fog.end = 7.2;

    this.camera = child(app.root, 'Viewer');
    this.lens = this.camera.addComponent('camera', {
      clearColor: new pc.Color().fromString(backdrop), nearClip: 0.02, farClip: 40, fov: 44,
    }) as pc.CameraComponent;
    this.addLights(app.root);
    this.buildGallery(app.root, app.graphicsDevice);

    const log = (text: string, level?: string) => { if (level === 'error') console.error(text); };
    this.models = new ModelLibrary(app, log);
    this.reveal = new JarvisReveal(app.graphicsDevice, this.reducedMotion);
    const noop = () => undefined;
    this.map = new MapSculptureScene(app.root, app.graphicsDevice, this.models, this.reveal, log, noop, this.canvas, noop);
    this.station = new StationDioramaScene(app.root, app.graphicsDevice, this.models, this.reveal, log, noop);
    this.map.root.setLocalPosition(0, mapHeight, 0);
    this.map.setImmersive(true);
    this.map.setStops(STOPS);
    this.map.setPlaces(offlineCatalog.places, this.allPlaces);
    this.station.setPlaces(offlineCatalog.places, this.allPlaces);
    this.station.setPinsShown(false, true);
    this.station.seekReveal(0);
    this.parkStation();

    window.addEventListener('pointermove', (event) => {
      this.pointer.x = event.clientX / Math.max(1, window.innerWidth) * 2 - 1;
      this.pointer.y = event.clientY / Math.max(1, window.innerHeight) * 2 - 1;
    }, { signal: this.events.signal, passive: true });
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.canvas);
    this.resize();
    app.on('update', (dt: number) => this.update(dt));
    app.start();

    const stop = STOPS.find((item) => item.stop_id === STOP_ID);
    const [sculpture] = await Promise.all([
      this.models.load(`${assetBase}boston-map-sculpture.glb`),
      stop ? this.station.show(stop) : Promise.resolve(),
    ]);
    if (!sculpture) throw new Error('The map sculpture could not be loaded');
    if (this.lastDive === 0) this.map.setVisible(true);
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

  /** The headset gallery: an unlit floor, two floor rings and the plinth the models stand on. */
  private buildGallery(root: pc.Entity, device: pc.GraphicsDevice): void {
    const gallery = child(root, 'VR gallery');
    const floor = material('#141821', 1);
    const rings = material('#2a3242', 1);
    for (const surface of [floor, rings]) {
      surface.diffuse.set(0, 0, 0);
      surface.useLighting = false;
      surface.update();
    }
    const finish = material('#292e39', 0.12);
    this.materials.push(floor, rings, finish);
    const deck = child(gallery, 'Gallery floor');
    const disk = pc.Mesh.fromGeometry(device, new pc.CircleGeometry({ radius: 8, sectors: 128, rings: 1 }));
    deck.addComponent('render', { meshInstances: [new pc.MeshInstance(disk, floor, deck)] });
    for (const radius of [1.5, 3.2]) {
      const ring = child(gallery, `Floor ring ${radius} m`, [0, 0.002, 0]);
      const mesh = pc.Mesh.fromGeometry(device, new pc.TorusGeometry({
        ringRadius: radius, tubeRadius: 0.003, segments: 160, sides: 6,
      }));
      ring.setLocalScale(1, 0.2, 1);
      ring.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, rings, ring)] });
    }
    this.plinth = child(gallery, 'Tabletop plinth');
    this.pedestal = shape(this.plinth, 'Plinth column', 'cylinder', finish, [0, 0.4, 0], [0.36, 0.8, 0.36]);
    shape(this.plinth, 'Plinth foot', 'cylinder', finish, [0, 0.016, 0], [0.53, 0.032, 0.53]);
  }

  private resize(): void {
    if (!this.app) return;
    const width = Math.max(1, this.canvas.clientWidth);
    const height = Math.max(1, this.canvas.clientHeight);
    const device = this.app.graphicsDevice;
    device.maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    device.resizeCanvas(width, height);
    this.lens.fov = clamp(44 + (1 - width / height) * 38, 44, 74);
  }

  private parkStation(): void {
    const at = this.map.root.getPosition();
    this.station.root.setPosition(at.x, at.y + 0.02, at.z);
    this.station.root.setLocalScale(standbyScale, standbyScale, standbyScale);
  }

  /** Pose the map and the neighbourhood for dive progress `u`, exactly as the app does. */
  private applyDive(u: number): void {
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
    const height = Math.max(0.10, pc.math.lerp(origin.y - 0.02, this.stage.y - 0.16, travel));
    this.pedestal.setLocalPosition(0, height / 2, 0);
    this.pedestal.setLocalScale(0.36, height, 0.36);

    if (u === this.lastDive) return;
    this.lastDive = u;
    this.map.seekReveal(1 - clamp((u - 0.11) / 0.65, 0, 1));
    this.station.seekReveal(clamp((u - 0.22) / 0.75, 0, 1));
    this.station.setPinsShown(u > 0.86);
  }

  /** The ramen counter's pin and its neighbours, once the neighbourhood has built them. */
  private findPins(): void {
    if (this.pin) return;
    const named = (name: string) => this.station.root.findByName(name) as pc.Entity | null;
    const featured = offlineCatalog.places.find((place) => place.id === PLACE_ID);
    this.pin = (featured && named(featured.name)) ?? undefined;
    if (!this.pin) return;
    this.otherPins = offlineCatalog.places
      .filter((place) => place.stop_id === STOP_ID && place.id !== PLACE_ID)
      .map((place) => named(place.name))
      .filter((entity): entity is pc.Entity => !!entity);
  }

  private applyFocus(focus: number): void {
    this.findPins();
    if (focus === this.focus) return;
    this.focus = focus;
    const size = Math.max(0.0001, 1 - focus);
    for (const pin of this.otherPins) pin.setLocalScale(size, size, size);
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
      yaw += 0.03 * Math.sin(this.clock * 0.23) - 0.045 * this.pointer.easedX;
      pitch += 0.010 * Math.sin(this.clock * 0.31) + 0.025 * this.pointer.easedY;
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
    const p = clamp(this.onFrame(dt), 0, 1);
    this.applyDive(clamp((p - DIVE[0]) / (DIVE[1] - DIVE[0]), 0, 1));
    this.map.setImmersive(p < CLEAR_AT);
    this.applyFocus(smooth((p - FOCUS[0]) / (FOCUS[1] - FOCUS[0])));
    this.poseCamera(p, dt);
    this.map.update(dt, this.camera, this.lens, 0);
    if (this.lastDive > 0) this.station.update(dt, this.camera);
    this.reveal.update(dt);
  }

  destroy(): void {
    this.events.abort();
    this.resizeObserver?.disconnect();
    this.map?.destroy();
    this.station?.destroy();
    this.reveal?.destroy();
    this.models?.destroy();
    for (const surface of this.materials) surface.destroy();
    this.app?.destroy();
    this.app = undefined;
  }
}
