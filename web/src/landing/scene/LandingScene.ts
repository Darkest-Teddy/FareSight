import * as pc from 'playcanvas';
import { child, clamp, ModelLibrary, type DebugLog } from '../../xr/sceneSupport';
import type { DirectorState } from '../ScrollDirector';
import { createProbe, loadEquirect, ProbeMixer } from './environment';
import { createSurface } from './materials';
import { homeSlabs, homeRoom } from './homeLayout';
import { Shell } from './Shell';

/**
 * The 3D half of the landing page.
 *
 * Both rooms exist at once, one inside the other. The living room is a shell
 * a few metres across; the restaurant is a larger room built around it. The
 * first section does not swap one scene for another, it takes the inner shell
 * apart, and the restaurant was always there behind it. That is why the
 * hand-off has no seam to hide: there is no moment where anything is
 * replaced.
 */

const modelBase = '/landing/models/';
const envBase = '/landing/env/';

/** Seated eye height, metres. */
const eyeHeight = 1.2;

interface Placement {
  readonly slug: string;
  readonly position: [number, number, number];
  readonly rotation?: number;
  readonly scale?: number;
}

/** Furniture in the living room, placed around a seated viewer facing -Z. */
const homeProps: readonly Placement[] = [
  { slug: 'Sofa_01', position: [-1.75, 0, -1.1], rotation: 72 },
  { slug: 'CoffeeTable_01', position: [0.05, 0, -1.5] },
  { slug: 'potted_plant_01', position: [2.5, 0, -2.5] },
  { slug: 'ClassicConsole_01', position: [-2.9, 0, -2.6], rotation: 90 },
];

/** The restaurant table the second section sits at. */
const tableProps: readonly Placement[] = [
  { slug: 'WoodenTable_01', position: [0, 0, -1.25] },
  { slug: 'dining_chair_02', position: [0, 0, -2.5], rotation: 180 },
  { slug: 'dining_chair_02', position: [-0.95, 0, -1.25], rotation: 90 },
  { slug: 'wine_bottles_01', position: [0.42, 0.75, -1.6] },
];

export class LandingScene {
  private readonly app: pc.Application;
  private readonly camera: pc.Entity;
  private readonly models: ModelLibrary;
  private readonly homeRoot: pc.Entity;
  private readonly restaurantRoot: pc.Entity;
  private readonly propsRoot: pc.Entity;
  private shell?: Shell;
  private propShell?: Shell;
  private mixer?: ProbeMixer;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, private readonly log: DebugLog = () => {}) {
    this.app = new pc.Application(canvas, {
      graphicsDeviceOptions: { antialias: true, alpha: false, powerPreference: 'high-performance' },
    });
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);

    // Tone mapping and gamma live on the camera in PlayCanvas 2, not here.
    const scene = this.app.scene;
    scene.skyboxMip = 1;
    // The rooms enclose the camera, so there is nothing to see past them.
    // Leaving the sky off means the gaps the walls open show the restaurant.
    scene.sky.type = pc.SKYTYPE_INFINITE;
    scene.exposure = 1;

    this.camera = new pc.Entity('camera');
    this.camera.addComponent('camera', {
      fov: 58,
      nearClip: 0.05,
      farClip: 120,
      clearColor: new pc.Color(0.043, 0.063, 0.125),
      toneMapping: pc.TONEMAP_ACES,
    });
    this.camera.setLocalPosition(0, eyeHeight, 1.75);
    this.app.root.addChild(this.camera);

    // One directional light stands in for the window. The probes carry the
    // ambient; this is only here to give the scans a shadow to sit on.
    const sun = new pc.Entity('sun');
    sun.addComponent('light', {
      type: 'directional',
      color: new pc.Color(1, 0.97, 0.92),
      intensity: 1.35,
      castShadows: true,
      shadowBias: 0.2,
      normalOffsetBias: 0.05,
      shadowDistance: 24,
      shadowResolution: 2048,
      shadowType: pc.SHADOW_PCF3,
    });
    sun.setLocalEulerAngles(52, 28, 0);
    this.app.root.addChild(sun);

    this.restaurantRoot = child(this.app.root as pc.Entity, 'restaurant');
    this.homeRoot = child(this.app.root as pc.Entity, 'home');
    this.propsRoot = child(this.app.root as pc.Entity, 'props');
    this.models = new ModelLibrary(this.app, log);
  }

  /** Loads everything the first frame needs. Resolves once the scene can be shown. */
  async load(): Promise<void> {
    const [homeEquirect, restaurantEquirect] = await Promise.all([
      loadEquirect(this.app, `${envBase}home-env.jpg`),
      loadEquirect(this.app, `${envBase}restaurant-env.jpg`),
    ]);
    if (this.disposed) return;

    this.mixer = new ProbeMixer(
      this.app,
      createProbe(homeEquirect),
      createProbe(restaurantEquirect),
      new pc.Color(0.34, 0.36, 0.40),
      new pc.Color(0.26, 0.22, 0.19),
    );

    const [floorSurface, wallSurface, tileSurface, brickSurface] = await Promise.all([
      createSurface(this.app, 'laminate_floor', 'diff', { tiling: [5, 5] }),
      createSurface(this.app, 'painted_plaster_wall', 'diff', { tiling: [2, 1.4], bumpiness: 0.5 }),
      createSurface(this.app, 'floor_tiles_06', 'diff', { tiling: [10, 10] }),
      createSurface(this.app, 'brick_wall_003', 'diffuse', { tiling: [6, 2.4] }),
    ]);
    if (this.disposed) return;

    // The picture rail is painted the same as the walls but smoother, so it
    // catches a highlight along its edge as it turns over.
    const railSurface = wallSurface.clone();
    railSurface.gloss = 0.62;
    railSurface.update();

    this.buildRestaurant(tileSurface, brickSurface);
    this.shell = new Shell(this.app, this.homeRoot, homeSlabs, {
      wall: wallSurface, rail: railSurface, floor: floorSurface,
    }, 'home');

    await this.placeProps();
    this.app.start();
  }

  /** The room the first section opens into. Built once and never taken apart. */
  private buildRestaurant(tile: pc.Material, brick: pc.Material): void {
    const half = 9;
    const height = 4.2;

    const floor = child(this.restaurantRoot, 'restaurant-floor', [0, -0.14, 0]);
    floor.addComponent('render', { type: 'box', material: tile, receiveShadows: true });
    floor.setLocalScale(half * 2, 0.12, half * 2);

    const walls: [number, number, number][] = [
      [0, height / 2, -half], [0, height / 2, half],
      [-half, height / 2, 0], [half, height / 2, 0],
    ];
    walls.forEach((position, index) => {
      const entity = child(this.restaurantRoot, `restaurant-wall-${index}`, position);
      entity.addComponent('render', { type: 'box', material: brick, receiveShadows: true });
      const alongX = index < 2;
      entity.setLocalScale(alongX ? half * 2 : 0.2, height, alongX ? 0.2 : half * 2);
    });
  }

  /**
   * Loads the photogrammetry scans and parents them.
   *
   * The living room furniture goes into its own shell so it leaves with the
   * walls rather than standing there after the room around it has gone.
   */
  private async placeProps(): Promise<void> {
    const place = async (group: readonly Placement[], parent: pc.Entity) => {
      for (const item of group) {
        const url = `${modelBase}${item.slug}/${item.slug}_1k.gltf`;
        const container = await this.models.load(url);
        if (this.disposed) return;
        if (!container) { this.log(`landing: missing ${item.slug}`, 'warn'); continue; }
        const entity = container.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
        entity.setLocalPosition(...item.position);
        if (item.rotation) entity.setLocalEulerAngles(0, item.rotation, 0);
        if (item.scale) entity.setLocalScale(item.scale, item.scale, item.scale);
        parent.addChild(entity);
      }
    };

    await place(tableProps, this.restaurantRoot);
    await place(homeProps, this.propsRoot);
  }

  /** Called once per frame with the current scroll state. */
  update(state: DirectorState): void {
    if (this.disposed) return;
    const home = state.home.value;

    this.shell?.setProgress(home);
    // Furniture holds a little longer than the walls, so the room empties
    // from the outside in rather than everything leaving at once.
    this.propsRoot.children.forEach((node, index) => {
      const entity = node as pc.Entity;
      const start = 0.42 + index * 0.06;
      const lift = clamp((home - start) / 0.3, 0, 1);
      entity.enabled = lift < 1;
      entity.setLocalPosition(
        homeProps[index]?.position[0] ?? 0,
        (homeProps[index]?.position[1] ?? 0) + lift * lift * 9,
        homeProps[index]?.position[2] ?? 0,
      );
    });

    // Lighting changes while the walls are still in the air, so the room is
    // already somewhere else by the time you can see all of it.
    this.mixer?.set(clamp((home - 0.3) / 0.5, 0, 1));

    // A slow dolly forward across the first section, then across the table
    // in the second. The camera never cuts.
    const table = state.table.value;
    const z = 1.75 - home * 0.55 - table * 0.75;
    const y = eyeHeight + table * 0.14;
    this.camera.setLocalPosition(0, y, z);
    this.camera.setLocalEulerAngles(-4 - table * 13, 0, 0);
  }

  /**
   * Runs `handler` once per rendered frame, with seconds since the last one.
   *
   * Driving the page from PlayCanvas's loop rather than a second
   * requestAnimationFrame keeps the scroll sample, the flat layer and the
   * draw on the same frame. Two loops would let the words and the scene
   * disagree by a frame, which on a page whose whole premise is that they
   * move together is exactly the wrong thing to get wrong.
   */
  onFrame(handler: (dt: number) => void): void {
    this.app.on('update', (dt: number) => {
      if (!this.disposed) handler(Math.min(0.1, dt));
    });
  }

  resize(): void {
    this.app.resizeCanvas();
  }

  destroy(): void {
    this.disposed = true;
    this.shell?.destroy();
    this.propShell?.destroy();
    this.mixer?.destroy();
    this.models.destroy();
    this.app.destroy();
  }
}

export { homeRoom };
