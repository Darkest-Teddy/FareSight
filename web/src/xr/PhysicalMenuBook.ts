import * as pc from 'playcanvas';
import type { XRDishData, XRPlaceData } from './bridgeTypes';
import type { JarvisReveal } from './JarvisReveal';
import { bindFace, CanvasSurface, chamferedHousing, facePlane, modelNode } from './CanvasPanel3D';
import { assetBase, child, material, pickBounds, shape, target, type HitTarget, type ModelLibrary, type PickBounds, type XYZ } from './sceneSupport';

const pageWidth = 0.190;
const pageHeight = 0.265;
const canvasWidth = 768;
const canvasHeight = 1072;
const rowWidth = 0.174;
const rightRows = 4;
const spreadSize = 8;
const paper = '#f6efe0';
const ink = '#282019';
const brassInk = '#825f35';

type Side = 'Left' | 'Right';

interface Page {
  frame: pc.Entity;
  surface: CanvasSurface;
  rows: Row[];
}

interface Row {
  dish: XRDishData;
  top: number;
  height: number;
}

function wrappedText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, width: number,
  lineHeight: number, limit: number): void {
  const words = text.trim().split(/\s+/);
  let line = '';
  let drawn = 0;
  for (const [i, word] of words.entries()) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      drawn++;
      if (drawn === limit) {
        while (line && ctx.measureText(line + '…').width > width) line = line.slice(0, -1);
        ctx.fillText(line + '…', x, y, width);
        return;
      }
      ctx.fillText(line, x, y, width);
      y += lineHeight;
      line = word;
    } else line = next;
    if (i === words.length - 1 && line) ctx.fillText(line, x, y, width);
  }
}

function makePage(root: pc.Entity, side: Side, device: pc.GraphicsDevice): Page {
  const sign = side === 'Left' ? -1 : 1;
  const tilt = new pc.Quat().setFromEulerAngles(-24, 0, 0);
  const rotation = tilt.clone().mul(new pc.Quat().setFromEulerAngles(0, -sign * 10, 0));
  const center = new pc.Vec3(0, 0.022, 0.048)
    .addScaled(tilt.transformVector(pc.Vec3.UP), 0.1425)
    .addScaled(tilt.transformVector(new pc.Vec3(0, 0, 1)), 0.011)
    .addScaled(rotation.transformVector(pc.Vec3.RIGHT), sign * 0.103);
  const frame = child(root, `${side} printed page coordinates`);
  frame.setLocalPosition(center);
  frame.setLocalRotation(rotation);
  return { frame, surface: new CanvasSurface(device, canvasWidth, canvasHeight), rows: [] };
}

export class PhysicalMenuBook {
  readonly entity: pc.Entity;
  readonly targets: HitTarget[] = [];
  readonly gripBounds: readonly PickBounds[];
  private pages: Record<Side, Page>;
  private fallback?: pc.Entity;
  private fallbackMaterials: pc.StandardMaterial[] = [];
  private place?: XRPlaceData;
  private dishes: readonly XRDishData[] = [];
  private neighborhood = '';
  private active?: string;
  private compared?: string;
  private hovered?: string;
  private spread = 0;
  private moved = false;

  constructor(device: pc.GraphicsDevice, parent: pc.Entity, models: ModelLibrary,
    reveal: JarvisReveal, private selectDish: (id: string) => void) {
    this.entity = child(parent, 'Restaurant menu book');
    this.pages = { Left: makePage(this.entity, 'Left', device), Right: makePage(this.entity, 'Right', device) };
    this.gripBounds = [
      ...Object.values(this.pages).map(({ frame }) => pickBounds(frame, [0.214, 0.290, 0.032], [0, 0, -0.008])),
      pickBounds(this.entity, [0.350, 0.044, 0.19], [0, 0.022, 0]),
    ];
    const fallback = this.fallback = child(this.entity, 'Procedural menu book');
    const leather = material('#483026');
    const walnut = material('#4a3124');
    const brass = material('#a88352');
    const pages = material('#d9ccaf');
    this.fallbackMaterials = [leather, walnut, brass, pages];
    chamferedHousing(device, fallback, 'Walnut cradle', walnut, [0, 0.010, 0], [0.345, 0.178, 0.020], 0.005)
      .setLocalEulerAngles(-90, 0, 0);
    const spine = shape(fallback, 'Leather spine', 'cylinder', leather, [0, 0.152, -0.010], [0.017, 0.286, 0.017]);
    spine.setLocalEulerAngles(-24, 0, 0);
    for (const side of ['Left', 'Right'] as const) {
      const { frame, surface } = this.pages[side];
      const board = child(fallback, `${side} cover`);
      board.setLocalPosition(frame.getLocalPosition());
      board.setLocalRotation(frame.getLocalRotation());
      chamferedHousing(device, board, 'Leather binding', leather, [0, 0, -0.012], [0.211, 0.286, 0.016], 0.004);
      chamferedHousing(device, board, 'Paper block', pages, [0, 0, -0.006], [0.197, 0.273, 0.010], 0.002);
      for (const x of [-0.098, 0.098]) {
        for (const y of [-0.136, 0.136]) {
          shape(board, 'Brass corner', 'box', brass, [x, y, -0.004], [0.014, 0.012, 0.009]);
        }
      }
      facePlane(board, `Menu_Page_${side}`, surface, [0, 0, 0], pageWidth, pageHeight);
    }
    this.entity.enabled = false;

    void models.load(`${assetBase}menu-book.glb`).then((resource) => {
      if (!resource || !this.fallback) return;
      const book = resource.instantiateRenderEntity();
      if (!bindFace(modelNode(book, 'Menu_Page_Left'), this.pages.Left.surface) ||
        !bindFace(modelNode(book, 'Menu_Page_Right'), this.pages.Right.surface)) {
        book.destroy();
        return;
      }
      this.entity.addChild(book);
      this.dropFallback();
      reveal.refresh(this.entity, 0.68);
    });
  }

  setMenu(place: XRPlaceData, dishes: readonly XRDishData[], neighborhood: string, active?: string, compared?: string): void {
    const changedVenue = place.id !== this.place?.id;
    const changedRows = changedVenue || this.dishes.length !== dishes.length ||
      this.dishes.some((dish, index) => dish.id !== dishes[index].id);
    const selection = dishes.findIndex(({ id }) => id === active);
    const previousSpread = this.spread;
    if (changedVenue) {
      this.moved = false;
      this.spread = 0;
      this.hovered = undefined;
    }
    if (selection !== -1 && active !== this.active) this.spread = Math.floor(selection / spreadSize);
    this.spread = Math.min(this.spread, Math.max(0, Math.ceil(dishes.length / spreadSize) - 1));
    this.place = place;
    this.dishes = dishes;
    this.neighborhood = neighborhood;
    this.active = active;
    this.compared = compared;
    if (changedRows || previousSpread !== this.spread) this.buildRows();
    else {
      for (const { rows } of Object.values(this.pages)) {
        for (const row of rows) row.dish = dishes.find(({ id }) => id === row.dish.id) ?? row.dish;
      }
      this.draw();
    }
  }

  placeAt(position: XYZ, yaw: number): void {
    if (this.moved) return;
    this.entity.setLocalPosition(...position);
    this.entity.setLocalEulerAngles(0, yaw, 0);
  }

  markMoved(): void { this.moved = true; }

  setHoveredDish(id: string | undefined): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.draw();
  }

  private buildRows(): void {
    this.clearTargets();
    const visible = this.dishes.slice(this.spread * spreadSize, (this.spread + 1) * spreadSize);
    this.pages.Right.rows = visible.slice(0, rightRows).map((dish, i) => ({ dish, top: 208 + 172 * i, height: 152 }));
    this.pages.Left.rows = visible.slice(rightRows).map((dish, i) => ({ dish, top: 514 + 121 * i, height: 108 }));
    for (const { frame, rows } of Object.values(this.pages)) {
      for (const { dish, top, height } of rows) {
        const entity = child(frame, dish.name, [0, pageHeight * (0.5 - (top + height / 2) / canvasHeight), 0]);
        this.targets.push(target(entity, [rowWidth, height * pageHeight / canvasHeight, 0.026],
          () => this.selectDish(dish.id), dish.id));
      }
    }
    if (this.dishes.length > spreadSize) {
      const spreadCount = Math.ceil(this.dishes.length / spreadSize);
      for (const direction of [-1, 1]) {
        const next = this.spread + direction;
        if (next < 0 || next >= spreadCount) continue;
        const entity = child(this.pages.Right.frame, direction < 0 ? 'Previous menu pages' : 'Next menu pages',
          [direction * 0.053, pageHeight * (0.5 - 971 / canvasHeight), 0]);
        this.targets.push(target(entity, [0.064, 0.019, 0.026], () => {
          this.spread = next;
          this.hovered = undefined;
          this.buildRows();
        }));
      }
    }
    this.draw();
  }

  private draw(): void {
    const place = this.place;
    if (!place) return;
    const spreadCount = Math.ceil(this.dishes.length / spreadSize);
    for (const side of ['Left', 'Right'] as const) {
      const { rows, surface } = this.pages[side];
      const rowState = rows.map(({ dish }) => [dish.name, dish.price, dish.portion_note, this.hovered === dish.id,
        this.active === dish.id, this.compared === dish.id]);
      surface.draw(JSON.stringify([side, place.name, place.category, place.vibe, place.typical_price, place.rooms[0]?.stated_capacity,
        this.neighborhood, this.spread, spreadCount, rowState]), (ctx, w, h) => {
        ctx.fillStyle = paper;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = brassInk;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(18, 18, w - 36, h - 36);
        ctx.strokeStyle = '#b39974';
        ctx.strokeRect(24, 24, w - 48, h - 48);
        ctx.textBaseline = 'top';
        if (side === 'Left') this.drawIntroduction(ctx, place, rows.length > 0);
        else {
          ctx.fillStyle = brassInk;
          ctx.font = '600 25px system-ui, sans-serif';
          ctx.fillText(place.name.toUpperCase(), 54, 58, w - 108);
          ctx.fillStyle = ink;
          ctx.font = '700 69px Georgia, serif';
          ctx.fillText('Menu Items', 50, 94, w - 100);
          this.drawRule(ctx, 182);
          if (!rows.length) {
            ctx.fillStyle = brassInk;
            ctx.font = '500 32px system-ui, sans-serif';
            ctx.fillText('No dish previews available', 54, 232, w - 108);
          }
        }
        for (const row of rows) this.drawRow(ctx, row);
        if (side === 'Right' && spreadCount > 1) {
          ctx.font = '600 26px system-ui, sans-serif';
          ctx.fillStyle = brassInk;
          ctx.textAlign = 'center';
          ctx.fillText(`${this.spread + 1} / ${spreadCount}`, w / 2, 958);
          for (const direction of [-1, 1]) {
            if (this.spread + direction < 0 || this.spread + direction >= spreadCount) continue;
            const x = w / 2 + direction * 0.053 * w / pageWidth;
            ctx.strokeStyle = brassInk;
            ctx.strokeRect(x - 120, 937, 240, 68);
            ctx.fillText(direction < 0 ? '← Previous' : 'Next →', x, 956);
          }
          ctx.textAlign = 'left';
        }
      });
    }
  }

  private drawRule(ctx: CanvasRenderingContext2D, y: number): void {
    ctx.fillStyle = brassInk;
    ctx.fillRect(52, y, 317, 2);
    ctx.fillRect(399, y, 317, 2);
    ctx.save();
    ctx.translate(384, y + 1);
    ctx.rotate(Math.PI / 4);
    ctx.fillRect(-5, -5, 10, 10);
    ctx.restore();
  }

  private drawIntroduction(ctx: CanvasRenderingContext2D, place: XRPlaceData, overflow: boolean): void {
    ctx.fillStyle = brassInk;
    ctx.font = '600 25px system-ui, sans-serif';
    const category = place.category.replaceAll('_', ' ');
    ctx.fillText([category, this.neighborhood].filter(Boolean).join('  /  ').toUpperCase(), 54, 63, 660);
    ctx.font = '700 65px Georgia, serif';
    ctx.fillStyle = ink;
    wrappedText(ctx, place.name, 50, 109, 668, 71, 2);
    this.drawRule(ctx, 266);
    ctx.fillStyle = '#533f31';
    ctx.font = '400 33px Georgia, serif';
    wrappedText(ctx, place.vibe, 54, 292, 660, 37, 3);
    const capacity = place.rooms[0]?.stated_capacity;
    const notes = [capacity ? `Seats ${capacity} in ${place.rooms[0].name}` : '', `Typically $${place.typical_price.toFixed(2)}`].filter(Boolean);
    ctx.fillStyle = brassInk;
    ctx.font = '600 26px system-ui, sans-serif';
    ctx.fillText(notes.join('  ·  '), 54, 415, 660);
    ctx.font = '700 32px Georgia, serif';
    ctx.fillStyle = ink;
    ctx.fillText(overflow ? 'Featured Specials' : 'House Highlights', 52, 465, 664);
    if (!overflow) {
      ctx.fillStyle = '#533f31';
      ctx.font = '400 33px Georgia, serif';
      if (this.dishes.length) {
        ctx.fillText('Select any dish to view it in 3D.', 54, 523, 660);
        ctx.font = '600 26px system-ui, sans-serif';
        ctx.fillStyle = brassInk;
        ctx.fillText('Trip estimates include transit fare.', 54, 576, 660);
      }
      this.drawRule(ctx, 660);
    }
  }

  private drawRow(ctx: CanvasRenderingContext2D, { dish, top, height }: Row): void {
    const width = canvasWidth * rowWidth / pageWidth;
    const x = (canvasWidth - width) / 2;
    const label = dish.id === this.active ? 'ON TABLE' : dish.id === this.compared ? 'COMPARE' : '';
    const hovered = dish.id === this.hovered;
    if (hovered || label) {
      ctx.fillStyle = hovered ? '#f2e4c1' : '#eee3cc';
      ctx.fillRect(x, top, width, height);
      ctx.strokeStyle = hovered ? '#a37329' : '#b39464';
      ctx.lineWidth = hovered ? 4 : 2;
      ctx.strokeRect(x + 2, top + 2, width - 4, height - 4);
    } else {
      ctx.fillStyle = '#c9b697';
      ctx.fillRect(x + 11, top + height, width - 22, 1);
    }
    const inset = 24;
    const price = `$${dish.price.toFixed(2)}`;
    ctx.font = '650 30px system-ui, sans-serif';
    const priceWidth = ctx.measureText(price).width;
    const textRight = x + width - inset;
    ctx.fillStyle = ink;
    ctx.fillText(price, textRight - priceWidth, top + 17);
    ctx.font = '700 36px Georgia, serif';
    const nameWidth = width - inset * 2 - priceWidth - 46;
    ctx.fillText(dish.name, x + inset, top + 12, nameWidth);
    const nameEnd = x + inset + Math.min(nameWidth, ctx.measureText(dish.name).width);
    ctx.fillStyle = '#9e835d';
    for (let at = nameEnd + 13; at < textRight - priceWidth - 10; at += 8) ctx.fillRect(at, top + 40, 2, 2);
    const labelWidth = label ? 132 : 0;
    ctx.font = '400 28px Georgia, serif';
    ctx.fillStyle = '#5e4b3d';
    wrappedText(ctx, dish.portion_note, x + inset, top + 58, width - inset * 2 - labelWidth, 28, height > 120 ? 2 : 1);
    if (label) {
      ctx.fillStyle = '#72512d';
      ctx.fillRect(textRight - labelWidth + 8, top + height - 36, labelWidth - 8, 28);
      ctx.fillStyle = paper;
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, textRight - (labelWidth - 8) / 2, top + height - 31);
      ctx.textAlign = 'left';
    }
  }

  private clearTargets(): void {
    for (const { entity } of this.targets) entity.destroy();
    this.targets.length = 0;
  }

  clear(): void {
    this.clearTargets();
    this.place = undefined;
    this.dishes = [];
    for (const page of Object.values(this.pages)) page.rows = [];
    this.hovered = undefined;
    this.active = undefined;
    this.compared = undefined;
    this.moved = false;
    this.spread = 0;
    this.entity.enabled = false;
  }

  private dropFallback(): void {
    this.fallback?.destroy();
    this.fallback = undefined;
    for (const surface of this.fallbackMaterials) surface.destroy();
    this.fallbackMaterials = [];
  }

  destroy(): void {
    this.clear();
    this.dropFallback();
    this.entity.destroy();
    for (const { surface } of Object.values(this.pages)) surface.destroy();
  }
}
