import * as pc from 'playcanvas';
import { formatDishPrice } from '@faresight/shared';
import { hasDishPreview } from '../data/preview3D';
import type { XRDishData, XRPlaceData } from './bridgeTypes';
import type { JarvisReveal } from './JarvisReveal';
import { bindFace, CanvasSurface, chamferedHousing, facePlane, modelNode } from './CanvasPanel3D';
import { assetBase, child, damp, levelYaw, material, pickBounds, shape, target, type HitTarget, type ModelLibrary, type PickBounds, type XYZ } from './sceneSupport';

const pageWidth = 0.190;
const pageHeight = 0.265;
const canvasWidth = 768;
const canvasHeight = 1072;
const rowWidth = 0.174;
const rightRows = 4;
const spreadSize = 8;
const ivoryPaper = '#faf6ee';
const ink = '#27231f';
const mutedInk = '#61584f';
const accentInk = '#8a5743';

let cottonTile: HTMLCanvasElement | undefined;

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
  placeName?: string;
}

export interface MenuComparisonDish { dish: XRDishData; placeName: string }

function paperGrain(): HTMLCanvasElement {
  if (cottonTile) return cottonTile;
  const tile = document.createElement('canvas');
  tile.width = 139;
  tile.height = 127;
  const ctx = tile.getContext('2d');
  if (!ctx) return tile;
  let seed = 924112;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };
  for (let i = 0; i < 560; i++) {
    const x = random() * tile.width;
    const y = random() * tile.height;
    ctx.fillStyle = i % 5 === 0 ? 'rgba(255,255,255,0.32)' : 'rgba(98,77,52,0.095)';
    ctx.fillRect(x, y, 0.55 + random() * 1.35, 0.35 + random() * 0.55);
  }
  cottonTile = tile;
  return tile;
}

function menuSection(place: XRPlaceData): string {
  if (place.category.includes('karaoke') || place.rooms.some(({ room_type }) => room_type.includes('karaoke'))) {
    return 'Suites & Sessions';
  }
  if (/caf[eé]|coffee|bakery/i.test(place.category)) return 'Coffee & Pastries';
  return 'Menu';
}

function menuNotes(place: XRPlaceData): [string, string] {
  const venueCapacity = place.stated_capacity;
  const roomCapacity = place.rooms[0]?.stated_capacity;
  const seating = venueCapacity && venueCapacity > 0 ? `${venueCapacity} seats`
    : roomCapacity && roomCapacity > 0 ? `Private room seats ${roomCapacity}` : '';
  const checks = Number.isFinite(place.typical_price) && place.typical_price > 0
    ? `Typical check $${place.typical_price.toFixed(2)}` : '';
  const hours = Object.values(place.hours ?? {});
  const daily = hours.length === 7 && hours.every(([open, close]) => open === hours[0][0] && close === hours[0][1]);
  return [[seating, checks].filter(Boolean).join('  ·  '), daily ? `Daily  ${hours[0][0]}–${hours[0][1]}` : ''];
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
  private highlighted?: string;
  private spread = 0;
  private compareSpread = false;
  private comparisonOptions: readonly MenuComparisonDish[] = [];
  private moved = false;
  private baseY = 0;
  private homePosition = new pc.Vec3();
  private homeRotation = new pc.Quat();
  private pose?: { position: pc.Vec3; rotation: pc.Quat; world: boolean; settling: boolean };
  private nextPosition = new pc.Vec3();
  private nextRotation = new pc.Quat();

  constructor(device: pc.GraphicsDevice, parent: pc.Entity, models: ModelLibrary,
    reveal: JarvisReveal, private selectDish: (id: string) => void, restOnSurface = false,
    private selectComparison?: (id: string, placeId: string) => void) {
    this.entity = child(parent, 'Restaurant menu folio');
    const binding = child(this.entity, 'Folio binding');
    this.pages = { Left: makePage(binding, 'Left', device), Right: makePage(binding, 'Right', device) };
    const spine = child(binding, 'Folio spine coordinates', [0, 0.152, -0.010]);
    spine.setLocalEulerAngles(-24, 0, 0);
    this.gripBounds = [
      ...Object.values(this.pages).map(({ frame }) => pickBounds(frame, [0.207, 0.284, 0.024], [0, 0, -0.005])),
      pickBounds(spine, [0.020, 0.278, 0.028]),
    ];
    const fallback = this.fallback = new pc.Entity('Procedural linen folio');
    const linen = material('#2c2b2c');
    const pages = material('#e8e1d5');
    this.fallbackMaterials = [linen, pages];
    shape(fallback, 'Linen spine', 'cylinder', linen, [0, 0.152, -0.010], [0.014, 0.278, 0.012])
      .setLocalEulerAngles(-24, 0, 0);
    for (const side of ['Left', 'Right'] as const) {
      const { frame, surface } = this.pages[side];
      const board = child(fallback, `${side} cover`);
      board.setLocalPosition(frame.getLocalPosition());
      board.setLocalRotation(frame.getLocalRotation());
      chamferedHousing(device, board, 'Charcoal linen cover', linen, [0, 0, -0.006], [0.202, 0.278, 0.006], 0.0018);
      chamferedHousing(device, board, 'Cotton paper edge', pages, [0, 0, -0.0022], [0.191, 0.266, 0.004], 0.0008);
      facePlane(board, `Menu_Page_${side}`, surface, [0, 0, 0], pageWidth, pageHeight);
    }
    const mount = (model: pc.Entity): void => {
      const minY = model.findComponents('render').reduce((bottom, render) =>
        render.meshInstances.reduce((min, mesh) => Math.min(min, mesh.aabb.getMin().y), bottom), Infinity);
      if (Number.isFinite(minY)) {
        this.baseY = restOnSurface ? 0 : minY;
        if (restOnSurface) binding.setLocalPosition(0, -minY, 0);
      }
      binding.addChild(model);
    };
    mount(fallback);
    this.entity.enabled = false;

    // Version the request because the offline service worker retains prior GLBs by URL.
    void models.load(`${assetBase}menu-book.glb?rev=linen`).then((resource) => {
      if (!resource || !this.fallback) return;
      const book = resource.instantiateRenderEntity();
      if (modelNode(book, 'MenuBook_Cradle') ||
        !bindFace(modelNode(book, 'Menu_Page_Left'), this.pages.Left.surface) ||
        !bindFace(modelNode(book, 'Menu_Page_Right'), this.pages.Right.surface)) {
        book.destroy();
        return;
      }
      mount(book);
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
      this.resetPose();
      this.spread = 0;
      this.compareSpread = false;
      this.hovered = undefined;
      this.highlighted = undefined;
    }
    if (!this.compareSpread) {
      if (selection !== -1 && active !== this.active) this.spread = Math.floor(selection / spreadSize);
      this.spread = Math.min(this.spread, Math.max(0, Math.ceil(dishes.length / spreadSize) - 1));
    }
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

  setComparisonOptions(options: readonly MenuComparisonDish[]): void {
    this.comparisonOptions = options;
    if (!options.length) this.compareSpread = false;
    this.spread = Math.min(this.spread, this.spreadCount - 1);
    this.buildRows();
  }

  private get spreadCount(): number {
    return Math.max(1, Math.ceil((this.compareSpread ? this.comparisonOptions.length : this.dishes.length) / spreadSize));
  }

  placeAt(position: XYZ, yaw: number): void {
    this.homePosition.set(...position);
    this.homeRotation.setFromEulerAngles(0, yaw, 0);
    if (this.moved || this.pose) return;
    this.entity.setLocalPosition(this.homePosition);
    this.entity.setLocalRotation(this.homeRotation);
  }

  markMoved(): void {
    this.moved = true;
    this.pose = undefined;
  }

  get venueId(): string | undefined { return this.place?.id; }

  get surfaceBaseOffset(): number { return -this.baseY * this.entity.getLocalScale().y; }

  release(tableY?: number, physicalY?: number): boolean {
    const position = this.entity.getPosition().clone();
    const rotation = this.entity.getRotation().clone();
    const tabletop = tableY === undefined ? undefined : tableY + this.surfaceBaseOffset;
    const onTable = tabletop !== undefined && (physicalY === undefined ||
      Math.abs(position.y - tabletop) <= Math.abs(position.y - physicalY) + 0.01);
    const height = onTable ? tabletop : physicalY;
    if (height !== undefined) {
      position.y = height;
      rotation.setFromAxisAngle(pc.Vec3.UP, levelYaw(this.entity) * pc.math.RAD_TO_DEG);
      const parent = this.entity.parent;
      if (onTable && parent) {
        new pc.Mat4().invert(parent.getWorldTransform()).transformPoint(position, position);
        rotation.mul2(parent.getRotation().clone().invert(), rotation);
      }
    }
    this.moved = true;
    this.pose = { position, rotation, world: !onTable, settling: height !== undefined };
    return height !== undefined;
  }

  resetPose(): void {
    if (!this.moved) return;
    this.moved = false;
    this.pose = { position: this.homePosition, rotation: this.homeRotation, world: false, settling: true };
  }

  update(dt: number, reducedMotion: boolean): void {
    const pose = this.pose;
    if (!pose) return;
    const from = pose.world ? this.entity.getPosition() : this.entity.getLocalPosition();
    const rotation = pose.world ? this.entity.getRotation() : this.entity.getLocalRotation();
    if (pose.settling && (reducedMotion || (from.distanceSq(pose.position) < 0.000001 && Math.abs(rotation.dot(pose.rotation)) > 0.99999))) {
      pose.settling = false;
    }
    const blend = damp(dt, 16);
    const position = pose.settling ? this.nextPosition.lerp(from, pose.position, blend) : pose.position;
    const nextRotation = pose.settling ? this.nextRotation.slerp(rotation, pose.rotation, blend) : pose.rotation;
    if (pose.world) {
      this.entity.setPosition(position);
      this.entity.setRotation(nextRotation);
    } else {
      this.entity.setLocalPosition(position);
      this.entity.setLocalRotation(nextRotation);
      if (!pose.settling) this.pose = undefined;
    }
  }

  setHoveredDish(id: string | undefined): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.draw();
  }

  setHighlightedDish(id: string | undefined): void {
    const changed = this.highlighted !== id;
    this.highlighted = id;
    if (id && !this.compareSpread) {
      const index = this.dishes.findIndex((dish) => dish.id === id);
      if (index !== -1) {
        const nextSpread = Math.floor(index / spreadSize);
        if (nextSpread !== this.spread) {
          this.spread = nextSpread;
          this.buildRows();
          return;
        }
      }
    }
    if (changed) this.draw();
  }

  private buildRows(): void {
    this.clearTargets();
    const offset = this.spread * spreadSize;
    if (this.compareSpread) {
      const rows = this.comparisonOptions.slice(offset, offset + spreadSize);
      this.pages.Right.rows = rows.slice(0, rightRows).map((entry, i) => ({ ...entry, top: 208 + 172 * i, height: 152 }));
      this.pages.Left.rows = rows.slice(rightRows).map((entry, i) => ({ ...entry, top: 208 + 172 * i, height: 152 }));
    } else {
      const visible = this.dishes.slice(offset, offset + spreadSize);
      this.pages.Right.rows = visible.slice(0, rightRows).map((dish, i) => ({ dish, top: 208 + 172 * i, height: 152 }));
      this.pages.Left.rows = visible.slice(rightRows).map((dish, i) => ({ dish, top: 500 + 121 * i, height: 108 }));
    }
    for (const { frame, rows } of Object.values(this.pages)) {
      for (const { dish, top, height } of rows) {
        const entity = child(frame, dish.name, [0, pageHeight * (0.5 - (top + height / 2) / canvasHeight), 0]);
        this.targets.push(target(entity, [rowWidth, height * pageHeight / canvasHeight, 0.026],
          () => { if (this.compareSpread) this.selectComparison?.(dish.id, dish.place_id); else this.selectDish(dish.id); }, dish.id));
      }
    }
    if (this.spreadCount > 1) {
      for (const direction of [-1, 1]) {
        const next = this.spread + direction;
        if (next < 0 || next >= this.spreadCount) continue;
        const entity = child(this.pages.Right.frame, direction < 0 ? 'Previous menu pages' : 'Next menu pages',
          [direction * 0.053, pageHeight * (0.5 - 945 / canvasHeight), 0]);
        this.targets.push(target(entity, [0.064, 0.019, 0.026], () => {
          this.spread = next;
          this.hovered = undefined;
          this.buildRows();
        }));
      }
    }
    if (this.comparisonOptions.length && this.selectComparison) {
      const entity = child(this.pages.Right.frame, 'Compare 3D dishes', [0, pageHeight * (0.5 - 1018 / canvasHeight), 0]);
      this.targets.push(target(entity, [0.164, 0.015, 0.026], () => {
        this.compareSpread = !this.compareSpread;
        this.spread = 0;
        this.hovered = undefined;
        this.buildRows();
      }, 'menu-compare'));
    }
    this.draw();
  }

  private draw(): void {
    const place = this.place;
    if (!place) return;
    const spreadCount = this.spreadCount;
    const section = this.compareSpread ? 'Compare 3D dishes' : menuSection(place);
    const canCompare = this.comparisonOptions.length > 0;
    const primary = this.compareSpread ? this.dishes.find(({ id }) => id === this.active) : undefined;
    const notes = menuNotes(place);
    for (const side of ['Left', 'Right'] as const) {
      const { rows, surface } = this.pages[side];
      const rowState = rows.map(({ dish, placeName }) => [dish.name, dish.price, placeName ?? dish.portion_note, hasDishPreview(dish), this.hovered === dish.id,
        this.highlighted === dish.id, this.active === dish.id, this.compared === dish.id]);
      surface.draw(JSON.stringify([side, place.name, place.vibe, section, notes,
        this.neighborhood, this.spread, spreadCount, this.compareSpread, primary?.name, canCompare, this.hovered === 'menu-compare', rowState]), (ctx, w, h) => {
        this.drawPaper(ctx, side, w, h);
        ctx.textBaseline = 'top';
        if (side === 'Left' && !this.compareSpread) this.drawIntroduction(ctx, place, section, notes, rows.length > 0);
        else if (side === 'Left' && !rows.length && primary) {
          this.drawSmallCaps(ctx, 'On the table', 215, 33);
          this.drawRule(ctx, 282, 102, w - 102);
          ctx.textAlign = 'center';
          ctx.fillStyle = ink;
          ctx.font = '600 56px Georgia, serif';
          ctx.fillText(primary.name, w / 2, 340, w - 104);
          ctx.fillStyle = mutedInk;
          ctx.font = 'italic 34px Georgia, serif';
          ctx.fillText(place.name, w / 2, 421, w - 104);
          ctx.font = '32px Georgia, serif';
          ctx.fillText('Pick a second dish from the facing page.', w / 2, 555, w - 104);
          ctx.textAlign = 'left';
        }
        else {
          this.drawSmallCaps(ctx, section, 104, 35);
          this.drawRule(ctx, 168, 52, w - 52);
          if (!rows.length && !this.compareSpread) {
            ctx.font = 'italic 31px Georgia, serif';
            ctx.fillStyle = mutedInk;
            ctx.textAlign = 'center';
            ctx.fillText('No dishes listed', w / 2, 236);
            ctx.textAlign = 'left';
          }
        }
        for (const row of rows) this.drawRow(ctx, row);
        if (side === 'Right' && spreadCount > 1) {
          this.drawRule(ctx, 908, 52, w - 52);
          ctx.font = 'italic 26px Georgia, serif';
          ctx.fillStyle = mutedInk;
          ctx.textAlign = 'center';
          ctx.fillText(`${this.spread + 1} / ${spreadCount}`, w / 2, 931);
          for (const direction of [-1, 1]) {
            if (this.spread + direction < 0 || this.spread + direction >= spreadCount) continue;
            const x = w / 2 + direction * 0.053 * w / pageWidth;
            ctx.fillText(direction < 0 ? '← Previous' : 'Next →', x, 931);
          }
          ctx.textAlign = 'left';
        }
        if (side === 'Right' && canCompare) {
          this.drawRule(ctx, 982, 52, w - 52);
          if (this.hovered === 'menu-compare') {
            ctx.fillStyle = 'rgba(155, 118, 66, 0.11)';
            ctx.fillRect(52, 990, w - 104, 55);
          }
          this.drawSmallCaps(ctx, this.compareSpread ? '← Restaurant menu' : 'Compare 3D dishes →', 1001, 24);
        }
      });
    }
  }

  private drawPaper(ctx: CanvasRenderingContext2D, side: Side, width: number, height: number): void {
    ctx.fillStyle = ivoryPaper;
    ctx.fillRect(0, 0, width, height);
    const gutter = side === 'Left' ? width : 0;
    const gradient = ctx.createLinearGradient(gutter, 0, gutter + (side === 'Left' ? -124 : 124), 0);
    gradient.addColorStop(0, '#e7dfd0');
    gradient.addColorStop(0.38, 'rgba(216, 205, 187, 0.37)');
    gradient.addColorStop(1, 'rgba(216, 205, 187, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    const grain = ctx.createPattern(paperGrain(), 'repeat');
    if (grain) {
      ctx.fillStyle = grain;
      ctx.fillRect(0, 0, width, height);
    }
  }

  private drawRule(ctx: CanvasRenderingContext2D, y: number, from: number, to: number): void {
    ctx.fillStyle = 'rgba(97, 88, 79, 0.48)';
    ctx.fillRect(from, y, to - from, 1.5);
  }

  private drawSmallCaps(ctx: CanvasRenderingContext2D, text: string, y: number, size = 25): void {
    ctx.save();
    ctx.fillStyle = ink;
    ctx.font = `600 ${size}px Georgia, serif`;
    ctx.letterSpacing = '5px';
    ctx.textAlign = 'center';
    ctx.fillText(text.toUpperCase(), canvasWidth / 2, y, canvasWidth - 104);
    ctx.restore();
  }

  private drawIntroduction(ctx: CanvasRenderingContext2D, place: XRPlaceData,
    section: string, notes: [string, string], overflow: boolean): void {
    const center = canvasWidth / 2;
    const city = place.stop_id === 'place-harsq' ? 'Cambridge' : 'Boston';
    const area = [city, this.neighborhood].filter(Boolean).join(' · ');
    this.drawSmallCaps(ctx, area, overflow ? 64 : 161);
    ctx.textAlign = 'center';
    ctx.fillStyle = ink;
    ctx.font = `600 ${overflow ? 60 : 74}px Georgia, serif`;
    wrappedText(ctx, place.name, center, overflow ? 108 : 218, 650, overflow ? 64 : 78, 2);
    this.drawRule(ctx, overflow ? 247 : 391, center - 58, center + 58);
    ctx.fillStyle = mutedInk;
    ctx.font = 'italic 33px Georgia, serif';
    wrappedText(ctx, place.vibe, center, overflow ? 278 : 428, 615, 39, 2);
    if (overflow) {
      this.drawSmallCaps(ctx, `${section} · continued`, 429);
      this.drawRule(ctx, 475, 51, canvasWidth - 51);
    }
    ctx.fillStyle = mutedInk;
    ctx.font = '400 25px Georgia, serif';
    for (const [i, note] of notes.filter(Boolean).entries()) {
      ctx.fillText(note, center, (overflow ? 990 : 894) + i * 33, 670);
    }
    ctx.textAlign = 'left';
  }

  private drawRow(ctx: CanvasRenderingContext2D, { dish, top, height, placeName }: Row): void {
    const rowPixels = canvasWidth * rowWidth / pageWidth;
    const rowLeft = (canvasWidth - rowPixels) / 2;
    const left = rowLeft + 20;
    const right = canvasWidth - left;
    const compact = height < 120;
    const state = dish.id === this.active ? 'Previewing' : dish.id === this.compared ? 'Comparing' : dish.id === this.highlighted ? 'Spotlight' : '';
    const hovered = dish.id === this.hovered || dish.id === this.highlighted;
    if (hovered) {
      ctx.fillStyle = dish.id === this.highlighted ? 'rgba(138, 87, 67, 0.17)' : 'rgba(155, 118, 66, 0.11)';
      ctx.fillRect(rowLeft + 4, top + 4, rowPixels - 8, height - 8);
      if (dish.id === this.highlighted) {
        ctx.strokeStyle = accentInk;
        ctx.lineWidth = 3;
        ctx.strokeRect(rowLeft + 5, top + 5, rowPixels - 10, height - 10);
      }
    }
    const price = formatDishPrice(dish.price, 'Not listed');
    ctx.font = dish.price == null ? 'italic 26px Georgia, serif' : '400 31px "Courier New", monospace';
    const priceWidth = ctx.measureText(price).width;
    ctx.fillStyle = ink;
    ctx.textAlign = 'right';
    ctx.fillText(price, right, top + 16);
    ctx.textAlign = 'left';

    const tagSpace = hasDishPreview(dish) ? 48 : 0;
    const titleWidth = right - left - priceWidth - tagSpace - 43;
    ctx.font = '600 39px Georgia, serif';
    const naturalWidth = ctx.measureText(dish.name).width;
    if (naturalWidth > titleWidth) ctx.font = `600 ${Math.max(29, 39 * titleWidth / naturalWidth)}px Georgia, serif`;
    ctx.fillText(dish.name, left, top + 10, titleWidth);
    const nameEnd = left + Math.min(titleWidth, ctx.measureText(dish.name).width);
    if (tagSpace) {
      ctx.fillStyle = accentInk;
      ctx.font = 'italic 600 25px Georgia, serif';
      ctx.fillText('3D', nameEnd + 10, top + 23, tagSpace - 12);
    }
    ctx.fillStyle = mutedInk;
    for (let x = nameEnd + tagSpace + 11; x < right - priceWidth - 10; x += 7) ctx.fillRect(x, top + 42, 1.5, 1.5);
    if (hovered) {
      ctx.fillStyle = accentInk;
      ctx.fillRect(left, top + 53, nameEnd - left, 1);
    }

    ctx.fillStyle = mutedInk;
    ctx.font = `italic ${compact ? 25 : 29}px Georgia, serif`;
    const descriptionWidth = right - left - (compact && state ? 143 : 0);
    wrappedText(ctx, placeName ?? dish.portion_note, left, top + 60, descriptionWidth, 32, compact ? 1 : 2);
    if (state) {
      ctx.font = 'italic 25px Georgia, serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = mutedInk;
      ctx.fillText(state, right, top + height - 35);
      ctx.textAlign = 'left';
      ctx.fillStyle = accentInk;
      ctx.beginPath();
      ctx.arc(right - ctx.measureText(state).width - 12, top + height - 21, 3.7, 0, Math.PI * 2);
      ctx.fill();
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
    this.comparisonOptions = [];
    this.compareSpread = false;
    for (const page of Object.values(this.pages)) page.rows = [];
    this.hovered = undefined;
    this.highlighted = undefined;
    this.active = undefined;
    this.compared = undefined;
    this.moved = false;
    this.pose = undefined;
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
