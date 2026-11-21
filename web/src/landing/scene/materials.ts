import * as pc from 'playcanvas';

/**
 * Builds PBR materials from the measured texture sets in web/public/landing.
 *
 * Poly Haven packs ambient occlusion, roughness and metalness into the three
 * channels of one `arm` image, which is why each of those maps below points
 * at the same texture and differs only in which channel it reads. Sharing one
 * image costs one upload instead of three and keeps the three in register.
 *
 * The roughness channel needs `glossInvert`, because PlayCanvas shades from
 * gloss and the map stores the opposite. Without it every surface in both
 * rooms comes out mirror-smooth, which is the single most obvious way for a
 * scene like this to stop looking real.
 */

export interface SurfaceOptions {
  /** Texture repeats across the slab. Floors need more than walls. */
  readonly tiling?: [number, number];
  /** Scales the normal map. Below 1 flattens it. */
  readonly bumpiness?: number;
  /** Multiplies the whole surface, for tinting a room warmer or cooler. */
  readonly tint?: string;
}

const base = '/landing/textures/';

function loadTexture(app: pc.Application, url: string, srgb: boolean): Promise<pc.Texture> {
  return new Promise((resolve, reject) => {
    app.assets.loadFromUrl(url, 'texture', (error, asset) => {
      const texture = asset?.resource as pc.Texture | undefined;
      if (error || !texture) { reject(new Error(`${url}: ${String(error ?? 'no texture')}`)); return; }
      texture.addressU = pc.ADDRESS_REPEAT;
      texture.addressV = pc.ADDRESS_REPEAT;
      texture.anisotropy = 8;
      // Colour needs decoding to linear before lighting; the normal and ARM
      // maps are data and must be read exactly as stored.
      if (!srgb) texture.type = pc.TEXTURETYPE_DEFAULT;
      resolve(texture);
    });
  });
}

/**
 * `slug` is the Poly Haven asset name; `diffuseName` covers the handful of
 * sets that spell the colour map `diffuse` rather than `diff`.
 */
export async function createSurface(
  app: pc.Application,
  slug: string,
  diffuseName: 'diff' | 'diffuse',
  options: SurfaceOptions = {},
): Promise<pc.StandardMaterial> {
  const dir = `${base}${slug}/`;
  const [diffuse, normal, arm] = await Promise.all([
    loadTexture(app, `${dir}${slug}_${diffuseName}_1k.jpg`, true),
    loadTexture(app, `${dir}${slug}_nor_gl_1k.jpg`, false),
    loadTexture(app, `${dir}${slug}_arm_1k.jpg`, false),
  ]);

  const material = new pc.StandardMaterial();
  material.diffuseMap = diffuse;
  material.normalMap = normal;
  material.bumpiness = options.bumpiness ?? 1;

  material.useMetalness = true;
  material.aoMap = arm;
  material.aoMapChannel = 'r';
  material.glossMap = arm;
  material.glossMapChannel = 'g';
  material.glossInvert = true;
  material.metalnessMap = arm;
  material.metalnessMapChannel = 'b';

  if (options.tint) material.diffuse.fromString(options.tint);

  const [u, v] = options.tiling ?? [1, 1];
  for (const map of ['diffuseMapTiling', 'normalMapTiling', 'aoMapTiling', 'glossMapTiling', 'metalnessMapTiling'] as const) {
    (material[map] as pc.Vec2).set(u, v);
  }

  material.update();
  return material;
}
