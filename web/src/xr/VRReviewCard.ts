import * as pc from 'playcanvas';
import type { BriefingCard } from '../data/reviewBriefing';
import { bindFace, CanvasSurface, chamferedHousing, facePlane, modelNode } from './CanvasPanel3D';
import { JarvisReveal, jarvisPoints } from './JarvisReveal';
import { assetBase, brass, child, material, pickBounds, target, type HitTarget, type ModelLibrary } from './sceneSupport';

const ink = '#261d17';
const muted = '#645648';
const rule = '#ab8b60';
const width = 768;
const height = 968;
const margin = 43;
const textWidth = width - 2 * margin;

interface PrintLine { text: string; font: string; color: string }
interface PrintRow { height: number; groupHeight?: number; draw(y: number): void }

function wrap(ctx: CanvasRenderingContext2D, text: string, max = textWidth): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) { lines.push(line); line = word; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export class VRReviewCard {
  readonly entity: pc.Entity;
  readonly gripBounds: ReturnType<typeof pickBounds>[];
  readonly targets: HitTarget[];
  private readonly paper: CanvasSurface;
  private readonly clasp: CanvasSurface;
  private fallback?: pc.Entity;
  private readonly fallbackMaterials: pc.StandardMaterial[];
  private dismissMotion: { node: pc.Entity; rest: pc.Vec3 }[] = [];
  private briefing?: BriefingCard;
  private printed = '';
  private page = 0;
  private pages = 1;
  private loading = false;
  private disposed = false;

  constructor(device: pc.GraphicsDevice, parent: pc.Entity, private readonly models: ModelLibrary,
    private readonly reveal: JarvisReveal, readonly id: string, private readonly onDismiss: (id: string) => void) {
    this.entity = child(parent, `Review clipboard · ${id}`);
    this.entity.enabled = false;
    this.gripBounds = [pickBounds(this.entity, [0.316, 0.40, 0.055])];
    this.paper = new CanvasSurface(device, width, height);
    this.clasp = new CanvasSurface(device, 240, 112);

    const fallback = this.fallback = child(this.entity, 'Walnut review clipboard');
    const walnut = material('#38271e');
    const trim = material(brass);
    this.fallbackMaterials = [walnut, trim];
    chamferedHousing(device, fallback, 'Walnut backing', walnut, [0, 0, -0.008], [0.296, 0.38, 0.022], 0.008);
    chamferedHousing(device, fallback, 'Brushed brass clip', trim, [0, 0.166, 0.005], [0.15, 0.027, 0.009], 0.003);
    facePlane(fallback, 'Review_Card_Face', this.paper, [0, -0.008, 0.0046], 0.262, 0.330);
    const close = chamferedHousing(device, fallback, 'Review_Dismiss_Btn', trim, [0.112, 0.165, 0.005], [0.048, 0.026, 0.009], 0.002);
    const closeFace = facePlane(fallback, 'Review_Dismiss_Face', this.clasp, [0.112, 0.165, 0.0102], 0.040, 0.019);
    this.setClasp(close, closeFace);
    const previous = child(this.entity, 'Previous review page', [-0.085, -0.160, 0.007]);
    const next = child(this.entity, 'Next review page', [0.085, -0.160, 0.007]);
    this.targets = [target(close, [0.048, 0.026, 0.016], () => this.pressDismiss(), 'review-close'),
      target(previous, [0.074, 0.026, 0.020], () => this.changePage(-1), 'review-prev'),
      target(next, [0.074, 0.026, 0.020], () => this.changePage(1), 'review-next')];
    this.setTargets(false);
    this.clasp.draw('close', (ctx, w, h) => {
      ctx.fillStyle = '#d2b483';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ink;
      ctx.font = '700 44px Switzer, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('CLOSE ×', w / 2, h / 2, w - 18);
    });
  }

  get active(): boolean { return !!this.briefing && this.entity.enabled; }

  show(briefing: BriefingCard): void {
    if (briefing === this.briefing) return;
    const content = JSON.stringify(briefing);
    const opening = !this.active;
    if (opening || this.briefing?.id !== briefing.id) this.page = 0;
    this.briefing = briefing;
    if (content !== this.printed || opening) {
      this.printed = content;
      this.paint();
    }
    if (!opening) return;
    this.moveClasp(false);
    this.reveal.show(this.entity, 0.83, jarvisPoints.prop);
    this.loadModel();
  }

  place(position: pc.Vec3, eye: pc.Vec3): void {
    this.entity.setPosition(position);
    this.entity.lookAt(eye);
    this.entity.rotateLocal(0, 180, 0);
  }

  dismiss(onFinish: () => void): void {
    this.briefing = undefined;
    this.setTargets(false);
    this.reveal.hide(this.entity, 0.55, jarvisPoints.prop, onFinish);
  }

  private pressDismiss(): void {
    if (!this.active) return;
    this.moveClasp(true);
    this.onDismiss(this.id);
  }

  private setClasp(node: pc.Entity, face: pc.Entity): void {
    this.dismissMotion = (face.isDescendantOf(node) ? [node] : [node, face])
      .map((part) => ({ node: part, rest: part.getLocalPosition().clone() }));
  }

  private moveClasp(pressed: boolean): void {
    for (const { node, rest } of this.dismissMotion) node.setLocalPosition(rest.x, rest.y, rest.z - (pressed ? 0.0035 : 0));
  }

  private setTargets(shown: boolean): void {
    this.targets[0].enabled = shown;
    this.targets[1].enabled = shown && this.page > 0;
    this.targets[2].enabled = shown && this.page + 1 < this.pages;
  }

  private changePage(delta: number): void {
    const page = this.page + delta;
    if (!this.active || page < 0 || page >= this.pages) return;
    this.page = page;
    this.paint();
  }

  private paint(): void {
    const card = this.briefing;
    if (!card) return;
    this.paper.draw(`${this.page}:${this.printed}`, (ctx) => {
      ctx.fillStyle = '#f7efe1';
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = 'rgba(101, 73, 40, 0.09)';
      for (let i = 0; i < 710; i++) ctx.fillRect((i * 173 + i * i) % width, (i * 263 + 3 * i * i) % height, 2, 1);
      ctx.strokeStyle = rule;
      ctx.strokeRect(19.5, 19.5, width - 39, height - 39);
      ctx.textBaseline = 'top';
      const text = (value: string, x: number, y: number, font: string, color = ink, max = textWidth) => {
        ctx.font = font;
        ctx.fillStyle = color;
        ctx.fillText(value, x, y, max);
      };
      const horizontal = (y: number) => {
        ctx.fillStyle = rule;
        ctx.fillRect(margin, y, textWidth, 1.5);
      };
      let y = 43;
      if (card.kicker) {
        text(card.kicker, margin, y, '700 22px Switzer, sans-serif', muted, textWidth - 130);
        y += 36;
      }
      const titleFont = '700 48px Georgia, serif';
      ctx.font = titleFont;
      // Keep the first lines clear of the clasp even when the title wraps.
      for (const line of wrap(ctx, card.title, textWidth - 130)) {
        text(line, margin, y, titleFont, ink, textWidth - 130);
        y += 52;
      }
      if (card.subtitle) {
        const subtitleFont = '25px Switzer, sans-serif';
        ctx.font = subtitleFont;
        for (const line of wrap(ctx, card.subtitle)) {
          text(line, margin, y, subtitleFont, muted);
          y += 31;
        }
      }
      horizontal(y + 9);
      y += 29;
      if (card.facts?.length) {
        const cell = textWidth / card.facts.length;
        card.facts.forEach(({ label, value }, i) => {
          const x = margin + i * cell;
          text(label, x, y, '700 20px Switzer, sans-serif', muted, cell - 12);
          text(value, x, y + 27, '700 32px Georgia, serif', ink, cell - 12);
        });
        y += 72;
      }
      const bodyTop = y;
      const rows: PrintRow[] = [];
      const space = (height = 13) => { rows.push({ height, draw: () => {} }); };
      const add = (value: string, font: string, color: string, leading: number, quote = false) => {
        ctx.font = font;
        const indent = quote ? 17 : 0;
        for (const part of value.split('\n')) {
          for (const line of wrap(ctx, part, textWidth - indent)) {
            rows.push({ height: leading, draw: (top) => {
              if (quote) {
                ctx.fillStyle = rule;
                ctx.fillRect(margin, top, 2.5, leading);
              }
              text(line, margin + indent, top, font, color, textWidth - indent);
            } });
          }
        }
      };
      const paragraph = (value: string, quote = false) => add(value, '28px Georgia, serif', ink, 35, quote);
      for (const section of card.sections) {
        if (section.heading) add(section.heading, '700 25px Switzer, sans-serif', ink, 39);
        switch (section.kind) {
          case 'text': paragraph(section.body); break;
          case 'reviews':
            for (const review of section.items) {
              paragraph(`“${review.text}”`, true);
              const attribution = [review.author, review.placeName, review.source, review.rating === undefined ? undefined : `${review.rating} / 5`,
                review.date_label, review.sample ? 'Sample diner note' : review.unverified ? 'Unverified excerpt' : ''].filter(Boolean).join(' · ');
              add(attribution, '700 22px Switzer, sans-serif', muted, 31, true);
              space(12);
            }
            break;
          case 'list':
            for (const item of section.items) {
              add(`•  ${item.label}${item.badge ? `  [${item.badge}]` : ''}`, '700 25px Switzer, sans-serif', ink, 33);
              if (item.detail) add(item.detail, '24px Georgia, serif', muted, 31);
              space(8);
            }
            break;
          case 'comparison': {
            const gap = 11;
            const columnWidth = (textWidth - gap * (section.items.length - 1)) / section.items.length;
            const innerWidth = columnWidth - 24;
            const columns = section.items.map((): (PrintLine | undefined)[] => []);
            const align = (values: (string | undefined)[], font: string, color = ink) => {
              ctx.font = font;
              const lines = values.map((value) => value ? wrap(ctx, value, innerWidth) : []);
              const count = Math.max(...lines.map((entry) => entry.length));
              columns.forEach((column, i) => {
                for (let j = 0; j < count; j++) {
                  const line = lines[i][j];
                  column.push(line ? { text: line, font, color } : undefined);
                }
              });
            };
            align(section.items.map(({ name }) => name), '700 26px Georgia, serif');
            align(section.items.map(({ subtitle }) => subtitle), '20px Switzer, sans-serif', muted);
            const metrics = Math.max(...section.items.map((item) => item.metrics.length));
            const metricHeights = new Map<number, number>();
            for (let i = 0; i < metrics; i++) {
              const start = columns[0].length;
              align(section.items.map((item) => item.metrics[i]?.label), '700 19px Switzer, sans-serif', muted);
              align(section.items.map((item) => item.metrics[i]?.value), '700 24px Georgia, serif');
              metricHeights.set(start, (columns[0].length - start) * 32);
            }
            align(section.items.map(({ note }) => note), '22px Georgia, serif');
            const count = columns[0].length;
            for (let i = 0; i < count; i++) {
              rows.push({ height: 32, groupHeight: metricHeights.get(i), draw: (top) => {
                columns.forEach((column, index) => {
                  const x = margin + index * (columnWidth + gap);
                  ctx.fillStyle = '#efe4d2';
                  ctx.fillRect(x, top, columnWidth, 32);
                  ctx.fillStyle = rule;
                  ctx.fillRect(x, top, 1, 32);
                  ctx.fillRect(x + columnWidth - 1, top, 1, 32);
                  if (i === 0) ctx.fillRect(x, top, columnWidth, 1);
                  if (i === count - 1) ctx.fillRect(x, top + 31, columnWidth, 1);
                  const line = column[i];
                  if (line) text(line.text, x + 12, top + 3, line.font, line.color, innerWidth);
                });
              }});
            }
            break;
          }
        }
        space(15);
      }
      const pages: PrintRow[][] = [[]];
      const pageHeight = 876 - bodyTop;
      let used = 0;
      for (const row of rows) {
        const required = row.groupHeight && row.groupHeight <= pageHeight ? row.groupHeight : row.height;
        if (used + required > pageHeight && used > 0) { pages.push([]); used = 0; }
        pages.at(-1)!.push(row);
        used += row.height;
      }
      this.pages = pages.length;
      this.page = Math.min(this.page, this.pages - 1);
      y = bodyTop;
      for (const row of pages[this.page]) {
        row.draw(y);
        y += row.height;
      }
      horizontal(891);
      if (this.page) text('‹  PREV', margin, 913, '700 25px Switzer, sans-serif');
      if (this.page + 1 < this.pages) text('NEXT  ›', width - margin - 99, 913, '700 25px Switzer, sans-serif');
      ctx.textAlign = 'center';
      text(`${this.page + 1} / ${this.pages}`, width / 2, 916, '700 21px Switzer, sans-serif', muted);
      ctx.textAlign = 'left';
    });
    this.setTargets(true);
  }

  private loadModel(): void {
    if (this.loading) return;
    this.loading = true;
    void this.models.load(`${assetBase}review-clipboard.glb`).then((resource) => {
      if (!resource || this.disposed || !this.active) return;
      const model = resource.instantiateRenderEntity();
      const close = modelNode(model, 'Review_Dismiss_Btn');
      const face = modelNode(model, 'Review_Dismiss_Face');
      if (!close || !bindFace(face, this.clasp) || !bindFace(modelNode(model, 'Review_Card_Face'), this.paper)) {
        model.destroy();
        return;
      }
      this.entity.addChild(model);
      this.setClasp(close, face);
      this.targets[0].entity = close;
      this.targets[0].center = close.render?.meshInstances[0]?.mesh?.aabb.center.clone();
      this.dropFallback();
      if (this.active) this.reveal.refresh(this.entity, 0.83, jarvisPoints.prop);
    });
  }

  private dropFallback(): void {
    this.fallback?.destroy();
    this.fallback = undefined;
    for (const surface of this.fallbackMaterials.splice(0)) surface.destroy();
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.briefing = undefined;
    this.setTargets(false);
    this.reveal.finish(this.entity, false);
    this.dropFallback();
    this.entity.destroy();
    this.paper.destroy();
    this.clasp.destroy();
  }
}

const clipboardSlots = [[0.18, 0.60], [-0.18, 0.60], [0.54, 0.56], [-0.54, 0.56]] as const;
const paperHalfSize = [0.148, 0.19, 0.017] as const;

interface ViewRect { left: number; right: number; bottom: number; top: number }

function projectClipboard(view: pc.Mat4, entity: pc.Entity): ViewRect | null {
  const transform = new pc.Mat4().mul2(view, entity.getWorldTransform());
  const bounds = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity };
  const point = new pc.Vec3();
  let visible = false;
  const [w, h, d] = paperHalfSize;
  for (const x of [-w, w]) for (const y of [-h, h]) for (const z of [-d, d]) {
    transform.transformPoint(point.set(x, y, z), point);
    visible ||= point.z < -0.03;
    const depth = Math.max(0.03, -point.z);
    const u = point.x / depth;
    const v = point.y / depth;
    bounds.left = Math.min(bounds.left, u);
    bounds.right = Math.max(bounds.right, u);
    bounds.bottom = Math.min(bounds.bottom, v);
    bounds.top = Math.max(bounds.top, v);
  }
  return visible ? bounds : null;
}

function overlap(a: ViewRect, b: ViewRect): number {
  const width = Math.min(a.right, b.right + 0.01) - Math.max(a.left, b.left - 0.01);
  const height = Math.min(a.top, b.top + 0.01) - Math.max(a.bottom, b.bottom - 0.01);
  return Math.max(0, width) * Math.max(0, height);
}

export class VRReviewDeck {
  private readonly cards = new Map<string, VRReviewCard>();
  private readonly retiring = new Set<VRReviewCard>();
  private visible: readonly VRReviewCard[] = [];

  constructor(private readonly device: pc.GraphicsDevice, private readonly parent: pc.Entity,
    private readonly models: ModelLibrary, private readonly reveal: JarvisReveal, private readonly onDismiss: (id: string) => void) {}

  get active(): readonly VRReviewCard[] { return this.visible; }

  sync(briefings: readonly BriefingCard[], camera: pc.Entity): void {
    const ids = new Set(briefings.map(({ id }) => id));
    const adding = briefings.some(({ id }) => !this.cards.has(id));
    if (adding) this.finishRetiring();
    for (const [id, card] of this.cards) {
      if (ids.has(id)) continue;
      this.cards.delete(id);
      if (adding) card.destroy();
      else {
        this.retiring.add(card);
        card.dismiss(() => {
          this.retiring.delete(card);
          card.destroy();
        });
      }
    }
    for (const briefing of briefings) {
      let card = this.cards.get(briefing.id);
      if (!card) {
        card = new VRReviewCard(this.device, this.parent, this.models, this.reveal, briefing.id, this.onDismiss);
        this.place(card, camera);
        this.cards.set(briefing.id, card);
      }
      card.show(briefing);
    }
    this.visible = [...this.cards.values()];
  }

  private place(card: VRReviewCard, camera: pc.Entity): void {
    const eye = camera.getPosition();
    const forward = camera.forward.clone();
    forward.y = 0;
    if (forward.lengthSq() < 0.0001) forward.copy(pc.Vec3.FORWARD);
    forward.normalize();
    const right = new pc.Vec3(-forward.z, 0, forward.x);
    const view = new pc.Mat4().setLookAt(eye, eye.clone().add(forward), pc.Vec3.UP).invert();
    const occupied = [...this.cards.values()].map(({ entity }) => projectClipboard(view, entity))
      .filter((rect): rect is ViewRect => rect !== null);
    let best = Infinity;
    const position = new pc.Vec3();
    const fallback = new pc.Vec3();
    for (const height of [-0.08, 0.34, -0.50]) {
      for (const [side, depth] of clipboardSlots) {
        position.copy(eye).addScaled(forward, depth).addScaled(right, side);
        position.y += height;
        card.place(position, eye);
        const rect = projectClipboard(view, card.entity);
        if (!rect) continue;
        const score = occupied.reduce((total, other) => total + overlap(rect, other), 0);
        if (score === 0) return;
        if (score < best) {
          best = score;
          fallback.copy(position);
        }
      }
    }
    card.place(fallback, eye);
  }

  private finishRetiring(): void {
    for (const card of this.retiring) card.destroy();
    this.retiring.clear();
  }

  clear(): void {
    this.finishRetiring();
    for (const card of this.cards.values()) card.destroy();
    this.cards.clear();
    this.visible = [];
  }
}
