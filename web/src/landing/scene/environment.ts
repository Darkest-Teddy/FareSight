import * as pc from 'playcanvas';

/**
 * Image-based lighting for the two rooms.
 *
 * Both rooms are lit by a probe baked from a 360-degree photograph of a real
 * room of that kind (modeling/bake_landing_env.mjs). That is what stops the
 * photogrammetry scans reading as models dropped onto a background: they pick
 * up the direction and colour of light that was actually in the room, and the
 * glazed and polished surfaces reflect something true.
 *
 * The probes are never drawn. The rooms are built geometry and enclose the
 * camera, so a visible skybox would only show through the holes the walls
 * leave as they come apart, which is exactly where we want the next room to
 * be instead.
 */

export interface Probe {
  readonly atlas: pc.Texture;
  destroy(): void;
}

/**
 * Builds a lighting atlas from an equirectangular image.
 *
 * `generateLightingSource` resamples into the layout the next step expects,
 * and `generateAtlas` does the roughness chain that makes a rough surface
 * read as rough rather than as a mirror with a blurry image on it. The
 * intermediate is disposable once the atlas exists.
 */
export function createProbe(equirect: pc.Texture): Probe {
  const source = pc.EnvLighting.generateLightingSource(equirect);
  const atlas = pc.EnvLighting.generateAtlas(source);
  source.destroy();
  return {
    atlas,
    destroy() { atlas.destroy(); },
  };
}

/** Loads an equirect JPEG as a texture suitable for `createProbe`. */
export function loadEquirect(app: pc.Application, url: string): Promise<pc.Texture> {
  return new Promise((resolve, reject) => {
    app.assets.loadFromUrl(url, 'texture', (error, asset) => {
      const texture = asset?.resource as pc.Texture | undefined;
      if (error || !texture) { reject(new Error(`${url}: ${String(error ?? 'no texture')}`)); return; }
      texture.addressU = pc.ADDRESS_REPEAT;
      texture.addressV = pc.ADDRESS_CLAMP_TO_EDGE;
      texture.minFilter = pc.FILTER_LINEAR_MIPMAP_LINEAR;
      texture.magFilter = pc.FILTER_LINEAR;
      resolve(texture);
    });
  });
}

/**
 * Cross-fades the scene between two probes.
 *
 * PlayCanvas lights a scene from one atlas at a time, so this swaps at the
 * midpoint and rides `skyboxIntensity` either side of it. Ambient light is
 * carried across in parallel, which is what sells the change: the first
 * section ends in the flat even light of indoors and the second begins in the
 * warmer, lower light of the restaurant, and the move between them happens
 * while the walls are still in the air.
 */
export class ProbeMixer {
  constructor(
    private readonly app: pc.Application,
    private readonly from: Probe,
    private readonly to: Probe,
    private readonly fromAmbient: pc.Color,
    private readonly toAmbient: pc.Color,
  ) {
    this.app.scene.envAtlas = from.atlas;
    this.app.scene.ambientLight = fromAmbient.clone();
  }

  /** `t` runs 0 (first room) to 1 (second room). */
  set(t: number): void {
    const scene = this.app.scene;
    const target = t < 0.5 ? this.from : this.to;
    if (scene.envAtlas !== target.atlas) scene.envAtlas = target.atlas;

    // Dip the intensity through the swap so the change of atlas lands in the
    // darkest part of the fade rather than as a visible pop.
    const dip = 1 - 0.45 * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
    scene.skyboxIntensity = dip;

    scene.ambientLight.lerp(this.fromAmbient, this.toAmbient, Math.min(1, Math.max(0, t)));
  }

  destroy(): void {
    this.from.destroy();
    this.to.destroy();
  }
}
