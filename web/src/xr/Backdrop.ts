import * as pc from 'playcanvas';
import { child } from './sceneSupport';

/** The horizon tone. The page background in tokens.css (--canvas) uses the same value. */
export const paperHorizon = '#F5F0E6';

/**
 * Sky gradient from zenith (0) through the horizon (0.5) to straight down (1). A warm paper
 * cove: nearly flat above, deepening a little towards the nadir. The darker floor grounds the
 * models and keeps the brightest part of the view out of the lower field. The whole range is
 * narrow on purpose, since a stronger step reads as a grey floor.
 */
const sky: [number, string][] = [
  [0, '#FAF7F0'], [0.38, '#F8F3EA'], [0.5, paperHorizon], [0.64, '#F0E9DD'], [0.82, '#EAE2D3'], [1, '#E6DDCC'],
];
const skyRadius = 32;

/**
 * The backdrop of the flat-screen view: a paper-toned skybox. It is one unlit dome that stays centred
 * on the viewer, so it never intersects a model and shows no parallax.
 */
export class Backdrop {
  readonly root: pc.Entity;
  readonly clearColor = new pc.Color().fromString(paperHorizon);
  private texture: pc.Texture;
  private material = new pc.StandardMaterial();

  constructor(parent: pc.Entity, device: pc.GraphicsDevice) {
    const width = 64;
    const height = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const fill = ctx.createLinearGradient(0, 0, 0, height);
    for (const [at, color] of sky) fill.addColorStop(at, color);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);

    this.texture = new pc.Texture(device, {
      name: 'FareSight sky', width, height, format: pc.PIXELFORMAT_SRGBA8, flipY: false,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      minFilter: pc.FILTER_LINEAR, magFilter: pc.FILTER_LINEAR, mipmaps: false,
    });
    this.texture.setSource(canvas);
    const surface = this.material;
    surface.useLighting = false;
    surface.useSkybox = false;
    surface.useFog = false;
    surface.diffuse.set(0, 0, 0);
    surface.emissive.set(1, 1, 1);
    surface.emissiveMap = this.texture;
    surface.cull = pc.CULLFACE_FRONT;
    surface.depthWrite = false;
    surface.update();

    this.root = child(parent, 'Sky dome');
    const mesh = pc.Mesh.fromGeometry(device, new pc.SphereGeometry({ radius: skyRadius, latitudeBands: 48, longitudeBands: 32 }));
    const instance = new pc.MeshInstance(mesh, surface, this.root);
    instance.drawOrder = -100;
    this.root.addComponent('render', { meshInstances: [instance], castShadows: false });
  }

  /** Keep the dome centred on the viewer, like a skybox. */
  update(camera: pc.Entity): void {
    this.root.setPosition(camera.getPosition());
  }

  destroy(): void {
    this.root.destroy();
    this.material.destroy();
    this.texture.destroy();
  }
}
