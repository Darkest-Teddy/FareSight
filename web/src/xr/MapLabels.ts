import * as pc from 'playcanvas';
import { describe3DCount, type StopPreviewCounts } from '../data/preview3D';
import { previewBadge } from '../ui/dom';
import type { XRStopData } from './bridgeTypes';

interface Label {
  stop: XRStopData;
  node: HTMLButtonElement;
  stem: HTMLSpanElement;
  count: HTMLSpanElement;
  preview: HTMLSpanElement;
  width: number;
  height: number;
  slot: number;
  shown: boolean;
}

interface Box { left: number; top: number; right: number; bottom: number }

/**
 * Something on the map a label should not sit on top of, as the world-space corners of the box it
 * fills. Landmarks are these: the Citgo sign stands right behind Kenmore, exactly where that
 * station's label would otherwise go.
 */
export type KeepClear = readonly pc.Vec3[];

// Vertical offsets (px) from the station to the label centre, in order of preference.
const slots = [-44, 44, -84, 84, -124, 124, -164, 164];
const gap = 6;

/**
 * Crisp HTML station labels for the desktop map. Each label is a real button projected from
 * its station's 3D position, moved to the nearest free slot so labels never overlap.
 */
export class MapLabels {
  readonly root = document.createElement('div');
  private labels: Label[] = [];
  private screen = new pc.Vec3();
  private corner = new pc.Vec3();
  private hovered?: string;
  private selected?: string;
  private highlighted = new Set<string>();
  private opacity = -1;
  // Fonts and breakpoints change label sizes after first paint; re-measure whenever they do.
  private sizes = new ResizeObserver((entries) => {
    for (const entry of entries) {
      const label = this.labels.find((item) => item.node === entry.target);
      if (label) label.width = 0;
    }
  });

  constructor(
    canvas: HTMLCanvasElement,
    private select: (id: string) => void,
    private hover: (id: string | undefined) => void,
  ) {
    this.root.className = 'map-labels';
    canvas.after(this.root);
  }

  setStops(stops: XRStopData[]): void {
    this.root.replaceChildren();
    this.sizes.disconnect();
    this.labels = stops.map((stop) => {
      const node = document.createElement('button');
      node.type = 'button';
      node.className = 'map-label';
      node.style.setProperty('--line', stop.primary_color);
      const dot = document.createElement('span');
      dot.className = 'map-label-dot';
      const name = document.createElement('strong');
      name.textContent = stop.name;
      const preview = previewBadge();
      preview.hidden = true;
      const count = document.createElement('span');
      count.className = 'map-label-count';
      const stem = document.createElement('span');
      stem.className = 'map-label-stem';
      node.append(dot, name, preview, count, stem);
      node.addEventListener('click', () => this.select(stop.stop_id));
      node.addEventListener('pointerenter', () => this.hover(stop.stop_id));
      node.addEventListener('pointerleave', () => this.hover(undefined));
      node.addEventListener('focus', () => this.hover(stop.stop_id));
      node.addEventListener('blur', () => this.hover(undefined));
      this.root.append(node);
      this.sizes.observe(node);
      return { stop, node, stem, count, preview, width: 0, height: 0, slot: 0, shown: false };
    });
    this.mark();
  }

  setCounts(counts: ReadonlyMap<string, StopPreviewCounts>): void {
    for (const label of this.labels) {
      const previews = counts.get(label.stop.stop_id);
      const count = previews?.matching ?? 0;
      const text = `${count} ${count === 1 ? 'spot' : 'spots'}`;
      const hasPreview = Boolean(previews?.published3D);
      const name = `${label.stop.name}, ${count} matching ${count === 1 ? 'place' : 'places'}${describe3DCount(previews)}. Open station.`;
      if (label.count.textContent === text && label.preview.hidden === !hasPreview && label.node.ariaLabel === name) continue;
      label.count.textContent = text;
      label.preview.hidden = !hasPreview;
      label.node.ariaLabel = name;
      label.node.dataset.empty = String(count === 0);
      label.width = 0;
    }
  }

  setHover(id: string | undefined): void {
    if (this.hovered === id) return;
    this.hovered = id;
    this.mark();
  }

  setSelected(id: string | undefined): void {
    if (this.selected === id) return;
    this.selected = id;
    this.mark();
  }

  setHighlighted(ids: ReadonlySet<string>): void {
    this.highlighted = new Set(ids);
    this.mark();
  }

  private mark(): void {
    for (const { stop, node } of this.labels) {
      node.dataset.hover = String(stop.stop_id === this.hovered);
      node.dataset.selected = String(stop.stop_id === this.selected);
      node.dataset.highlighted = String(this.highlighted.has(stop.stop_id));
    }
  }

  /**
   * Project every label; `opacity` 0 removes the layer from hit testing and the tab order.
   * `keepClear` is what the labels step aside for, on top of each other.
   */
  update(
    camera: pc.CameraComponent, position: (id: string) => pc.Vec3 | undefined, opacity: number,
    keepClear: readonly KeepClear[] = [],
  ): void {
    if (opacity !== this.opacity) {
      this.opacity = opacity;
      this.root.style.opacity = String(opacity);
      this.root.style.visibility = opacity > 0.01 ? 'visible' : 'hidden';
      this.root.dataset.live = String(opacity > 0.6);
    }
    if (opacity <= 0.01) return;
    const placed: Box[] = [];
    for (const corners of keepClear) {
      const box: Box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
      let ahead = true;
      for (const point of corners) {
        camera.worldToScreen(point, this.corner);
        if (this.corner.z <= 0) ahead = false;
        box.left = Math.min(box.left, this.corner.x);
        box.right = Math.max(box.right, this.corner.x);
        box.top = Math.min(box.top, this.corner.y);
        box.bottom = Math.max(box.bottom, this.corner.y);
      }
      // A box partly behind the lens projects to nonsense; nothing there can be covered anyway.
      if (ahead) placed.push(box);
    }
    for (const label of this.labels) {
      const world = position(label.stop.stop_id);
      if (world) camera.worldToScreen(world, this.screen);
      const visible = !!world && this.screen.z > 0;
      if (visible !== label.shown) {
        label.shown = visible;
        label.node.style.display = visible ? '' : 'none';
      }
      if (!visible) continue;
      if (!label.width) {
        label.width = label.node.offsetWidth;
        label.height = label.node.offsetHeight;
      }
      const { x, y } = this.screen;
      const boxAt = (slot: number): Box => ({
        left: x - label.width / 2 - gap, right: x + label.width / 2 + gap,
        top: y + slots[slot] - label.height / 2 - gap, bottom: y + slots[slot] + label.height / 2 + gap,
      });
      const free = (box: Box) => placed.every((other) =>
        box.right < other.left || box.left > other.right || box.bottom < other.top || box.top > other.bottom);
      // Keep the current slot while it stays clear so labels do not flicker as the camera moves.
      let box = boxAt(label.slot);
      if (!free(box)) {
        const next = slots.findIndex((_, slot) => free(boxAt(slot)));
        if (next >= 0) {
          label.slot = next;
          box = boxAt(next);
        }
      }
      placed.push(box);
      const offset = slots[label.slot];
      label.node.style.transform = `translate(${(x - label.width / 2).toFixed(1)}px, ${(y + offset - label.height / 2).toFixed(1)}px)`;
      const reach = Math.abs(offset) - label.height / 2;
      label.stem.style.height = `${reach.toFixed(1)}px`;
      label.stem.dataset.side = offset < 0 ? 'below' : 'above';
    }
  }

  destroy(): void {
    this.sizes.disconnect();
    this.root.remove();
  }
}
