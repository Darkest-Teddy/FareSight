import * as pc from 'playcanvas';
import { brass, calloutAmber, child, cyan, ivory, shape, target, type HitTarget, type XYZ } from './sceneSupport';

interface PanelLine {
  text: string;
  color?: string;
  size?: number;
  weight?: number;
  wrap?: boolean;
}

export class CanvasSurface {
  readonly canvas = document.createElement('canvas');
  readonly texture: pc.Texture;
  readonly material: pc.StandardMaterial;
  private context: CanvasRenderingContext2D;
  private lastKey?: string;

  constructor(device: pc.GraphicsDevice, width: number, height: number, transparent = true) {
    this.canvas.width = width;
    this.canvas.height = height;
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('3D panels require a 2D canvas context');
    this.context = context;
    this.texture = new pc.Texture(device, {
      name: 'FareSight canvas panel',
      width, height, format: pc.PIXELFORMAT_SRGBA8, flipY: false,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE, addressV: pc.ADDRESS_CLAMP_TO_EDGE,
      minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR, magFilter: pc.FILTER_LINEAR, mipmaps: true,
    });
    this.texture.setSource(this.canvas);
    this.material = new pc.StandardMaterial();
    this.material.useLighting = false;
    this.material.useSkybox = false;
    this.material.diffuse.set(0, 0, 0);
    this.material.emissive.set(1, 1, 1);
    this.material.emissiveMap = this.texture;
    this.material.cull = pc.CULLFACE_NONE;
    if (transparent) {
      this.material.opacityMap = this.texture;
      this.material.opacityMapChannel = 'a';
      this.material.blendType = pc.BLEND_NORMAL;
      this.material.depthWrite = false;
    }
    this.material.update();
  }

  draw(key: string, paint: (ctx: CanvasRenderingContext2D, width: number, height: number) => void): void {
    if (key === this.lastKey) return;
    this.lastKey = key;
    const { width, height } = this.canvas;
    this.context.clearRect(0, 0, width, height);
    paint(this.context, width, height);
    this.texture.upload();
  }

  destroy(): void {
    this.material.destroy();
    this.texture.destroy();
  }
}

export class CanvasPanel3D {
  readonly entity: pc.Entity;
  private surface: CanvasSurface;

  constructor(
    device: pc.GraphicsDevice, parent: pc.Entity, name: string,
    readonly width: number, readonly height: number, position?: XYZ,
  ) {
    this.surface = new CanvasSurface(device, 1024, Math.max(128, Math.round(1024 * height / width)));
    this.entity = child(parent, name, position);
    const plane = shape(this.entity, 'Panel surface', 'plane', this.surface.material, [0, 0, 0], [width, 1, height]);
    plane.setLocalEulerAngles(90, 0, 0);
  }

  setText(lines: PanelLine[], accent = cyan, image?: HTMLImageElement): void {
    const key = JSON.stringify([lines, accent, image?.src]);
    this.surface.draw(key, (ctx, width, height) => {
      const padding = Math.min(55, height * 0.16);
      const radius = Math.min(36, height * 0.15);
      ctx.beginPath();
      ctx.roundRect(4, 4, width - 8, height - 8, radius);
      ctx.fillStyle = '#081627';
      ctx.fill();
      ctx.save();
      ctx.clip();
      if (image) {
        const imageHeight = height * 0.67;
        const scale = Math.max(width / image.naturalWidth, imageHeight / image.naturalHeight);
        const w = image.naturalWidth * scale;
        const h = image.naturalHeight * scale;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, width, imageHeight);
        ctx.clip();
        ctx.drawImage(image, (width - w) / 2, (imageHeight - h) / 2, w, h);
        ctx.restore();
      }
      ctx.fillStyle = accent;
      ctx.fillRect(4, image ? height * 0.67 : 4, 8, height);
      const availableWidth = width - padding * 2;
      let y = image ? height * 0.72 : padding;
      for (const line of lines) {
        const size = line.size ?? Math.min(86, height * 0.30);
        ctx.font = `${line.weight ?? 600} ${size}px system-ui, sans-serif`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = line.color ?? '#eef8ff';
        if (line.wrap) {
          let row = '';
          for (const word of line.text.split(/\s+/)) {
            const next = row ? `${row} ${word}` : word;
            if (row && ctx.measureText(next).width > availableWidth) {
              ctx.fillText(row, padding, y, availableWidth);
              y += size * 1.16;
              row = word;
            } else {
              row = next;
            }
          }
          ctx.fillText(row, padding, y, availableWidth);
        } else {
          ctx.fillText(line.text, padding, y, availableWidth);
        }
        y += size * 1.28;
      }
      ctx.restore();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 4;
      ctx.stroke();
    });
  }

  setOpacity(value: number): void {
    const material = this.surface.material;
    if (material.opacity === value) return;
    material.opacity = value;
    material.update();
  }

  setCallout(
    name: string, detail: string,
    { category, muted = false, selected = false }: { category?: string; muted?: boolean; selected?: boolean } = {},
  ): void {
    this.surface.draw(JSON.stringify(['callout', name, detail, category, muted, selected]), (ctx, width, height) => {
      const padding = 43;
      const contentWidth = width - padding * 2;
      ctx.beginPath();
      ctx.roundRect(9, 9, width - 18, height - 18, 20);
      ctx.fillStyle = muted ? '#292d33' : '#1b212e';
      ctx.fill();
      ctx.strokeStyle = muted ? '#888b90' : selected ? ivory : brass;
      ctx.lineWidth = selected ? 15 : 11;
      ctx.stroke();

      ctx.textBaseline = 'middle';
      ctx.fillStyle = muted ? '#d2d3d5' : '#ffffff';
      ctx.font = '700 100px system-ui, sans-serif';
      ctx.fillText(name, padding, height * 0.32, contentWidth);

      const baseline = height * 0.72;
      ctx.font = '600 65px system-ui, sans-serif';
      if (category) {
        const badgeWidth = Math.min(contentWidth * 0.62, ctx.measureText(detail).width + 36);
        ctx.fillStyle = muted ? '#34383d' : '#382c21';
        ctx.fillRect(padding, baseline - 44, badgeWidth, 88);
        ctx.fillStyle = muted ? '#c6c8cb' : calloutAmber;
        ctx.fillText(detail, padding + 18, baseline, badgeWidth - 36);

        ctx.fillStyle = muted ? '#bfc2c6' : ivory;
        ctx.font = '700 64px system-ui, sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(category, width - padding, baseline, contentWidth - badgeWidth - 28);
        ctx.textAlign = 'left';
      } else {
        ctx.fillStyle = selected ? ivory : brass;
        ctx.fillText(detail, padding, baseline, contentWidth);
      }
    });
  }

  hit(action: () => void): HitTarget {
    return target(this.entity, [this.width, this.height, 0.028], action);
  }

  face(camera: pc.Entity): void {
    this.entity.lookAt(camera.getPosition());
    this.entity.rotateLocal(0, 180, 0);
  }

  destroy(): void {
    this.entity.destroy();
    this.surface.destroy();
  }
}

export class XRActionBar {
  readonly entity: pc.Entity;
  readonly targets: HitTarget[];
  private virtualButton: CanvasPanel3D;
  private debugButton: CanvasPanel3D;
  private status: CanvasPanel3D;
  private panels: CanvasPanel3D[];
  private showDebug = false;
  private position = new pc.Vec3();
  private destination = new pc.Vec3();
  private offset = new pc.Vec3(0, -0.31, -0.70);

  constructor(
    device: pc.GraphicsDevice, parent: pc.Entity,
    actions: { map: () => void; station: () => void; back: () => void; virtualTable: () => void },
  ) {
    this.entity = child(parent, 'XR actions');
    this.entity.enabled = false;
    const buttons = [
      ['Map', actions.map], ['Station', actions.station], ['Back', actions.back],
      ['Virtual Table', actions.virtualTable], ['Debug FPS', () => { this.showDebug = !this.showDebug; }],
    ] as const;
    this.panels = buttons.map(([label], index) => {
      const panel = new CanvasPanel3D(device, this.entity, label, 0.125, 0.044, [(index - 2) * 0.134, 0, 0]);
      panel.setText([{ text: label, size: 139 }]);
      return panel;
    });
    this.targets = buttons.map(([, action], index) => this.panels[index].hit(action));
    this.virtualButton = this.panels[3];
    this.debugButton = this.panels[4];
    this.status = new CanvasPanel3D(device, this.entity, 'Placement status', 0.37, 0.044, [0, 0.055, 0]);
    this.status.entity.enabled = false;
  }

  setState(ar: boolean, virtual: boolean, placement: string): void {
    this.virtualButton.entity.enabled = ar;
    this.virtualButton.setText([{ text: virtual ? 'Passthrough' : 'Virtual Table', size: 126 }]);
    this.status.entity.enabled = !!placement;
    if (placement) this.status.setText([{ text: placement, size: 51 }]);
  }

  setFps(fps: number): void {
    this.debugButton.setText([{ text: this.showDebug ? `${fps} FPS` : 'Debug FPS', size: 140 }]);
  }

  update(camera: pc.Entity, blend: number): void {
    camera.getRotation().transformVector(this.offset, this.destination).add(camera.getPosition());
    this.position.lerp(this.entity.getPosition(), this.destination, blend);
    this.entity.setPosition(this.position);
    this.entity.lookAt(camera.getPosition());
    this.entity.rotateLocal(0, 180, 0);
  }

  destroy(): void {
    for (const panel of [...this.panels, this.status]) panel.destroy();
    this.entity.destroy();
  }
}
