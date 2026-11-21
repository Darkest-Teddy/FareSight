import { el, motion, svg } from './dom';

export interface Box { x: number; y: number; w: number; h: number }
export interface MapView { cx: number; cy: number; scale: number }

interface MapOptions {
  /** Everything worth panning to. The centre of the view stays inside it. */
  bounds: Box;
  /** The region shown when the map opens or is reset. */
  home: Box;
  /** Screen pixels kept clear around the home region. */
  padding?: number;
  /** How far past the home view a pinch can zoom in. */
  maxZoom?: number;
  label: string;
}

interface Marker { node: HTMLElement; x: number; y: number }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const ease = (t: number) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const DRAG_THRESHOLD = 6;

/**
 * A flat, touch-driven map: an SVG whose viewBox is panned and zoomed, with HTML markers
 * pinned to map coordinates so labels and tap targets keep a constant size on screen.
 */
export class MapCanvas {
  readonly root = el('div', 'map-canvas');
  readonly svg = svg('svg', { class: 'map-svg', role: 'img' });
  readonly overlay = el('div', 'map-overlay');
  /** Resolves once the map has a size and shows its home view. */
  readonly ready: Promise<void>;
  /** Called when the person pans or zooms by hand. */
  onGesture?: () => void;
  /** Called after every view change with the zoom relative to the home view. */
  onView?: (zoom: number) => void;

  private width = 0;
  private height = 0;
  private view: MapView = { cx: 0, cy: 0, scale: 1 };
  private markers: Marker[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private travelled = 0;
  private dragging = false;
  private quietUntil = 0;
  private frame = 0;
  private settle?: () => void;
  private observer: ResizeObserver;

  constructor(private options: MapOptions) {
    this.svg.setAttribute('aria-label', options.label);
    this.root.append(this.svg, this.overlay);
    let markReady = () => {};
    this.ready = new Promise((resolve) => { markReady = resolve; });
    this.observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      const first = !this.width;
      const zoom = first ? 1 : this.view.scale / this.homeView().scale;
      this.width = width;
      this.height = height;
      this.apply(first ? this.homeView() : { ...this.view, scale: this.homeView().scale * zoom });
      if (first) markReady();
    });
    this.observer.observe(this.root);
    this.listen();
  }

  get size() { return { width: this.width, height: this.height }; }
  get current(): MapView { return { ...this.view }; }

  homeView(): MapView { return this.viewFor(this.options.home, this.options.padding ?? 0); }

  viewFor(box: Box, padding = 0): MapView {
    const scale = Math.min(
      Math.max(1, this.width - padding * 2) / box.w,
      Math.max(1, this.height - padding * 2) / box.h,
    );
    return { cx: box.x + box.w / 2, cy: box.y + box.h / 2, scale };
  }

  addMarker(node: HTMLElement, x: number, y: number) {
    node.classList.add('map-marker');
    this.markers.push({ node, x, y });
    this.overlay.append(node);
    if (this.width) this.place(this.markers.at(-1)!);
  }

  /** Jumps to a view without animating. */
  set(view: MapView) {
    this.stop();
    this.apply(view);
  }

  /** Eases to a view and resolves when it gets there or is interrupted. */
  fly(target: MapView, ms = 420): Promise<void> {
    this.stop();
    const to = this.constrain(target);
    const from = { ...this.view };
    const duration = motion(ms);
    if (!duration || !this.width) {
      this.apply(to);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const started = performance.now();
      // The timer finishes the move if animation frames stop arriving, as they do in a hidden tab.
      const fallback = window.setTimeout(() => {
        if (this.settle !== done) return;
        this.stop();
        this.apply(to);
      }, duration + 300);
      const done = () => {
        window.clearTimeout(fallback);
        resolve();
      };
      this.settle = done;
      const step = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        const k = ease(t);
        this.apply({
          cx: from.cx + (to.cx - from.cx) * k,
          cy: from.cy + (to.cy - from.cy) * k,
          scale: from.scale * Math.pow(to.scale / from.scale, k),
        });
        if (t < 1) this.frame = requestAnimationFrame(step);
        else this.stop();
      };
      this.frame = requestAnimationFrame(step);
    });
  }

  destroy() {
    this.stop();
    this.observer.disconnect();
  }

  private stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    const settle = this.settle;
    this.settle = undefined;
    settle?.();
  }

  private constrain(view: MapView): MapView {
    const { bounds, maxZoom = 4 } = this.options;
    const home = this.homeView().scale;
    const widest = Math.min(home, this.viewFor(bounds).scale);
    const scale = clamp(view.scale, widest, home * maxZoom);
    // Keep the view inside the bounds, or centred on them when it is larger than they are.
    const fit = (centre: number, start: number, length: number, visible: number) => visible >= length
      ? start + length / 2
      : clamp(centre, start + visible / 2, start + length - visible / 2);
    return {
      scale,
      cx: fit(view.cx, bounds.x, bounds.w, this.width / scale),
      cy: fit(view.cy, bounds.y, bounds.h, this.height / scale),
    };
  }

  private apply(view: MapView) {
    if (!this.width) return;
    this.view = this.constrain(view);
    const { cx, cy, scale } = this.view;
    const w = this.width / scale;
    const h = this.height / scale;
    this.svg.setAttribute('viewBox', `${(cx - w / 2).toFixed(2)} ${(cy - h / 2).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`);
    for (const marker of this.markers) this.place(marker);
    this.onView?.(scale / this.homeView().scale);
  }

  private place({ node, x, y }: Marker) {
    const { cx, cy, scale } = this.view;
    const left = (x - cx) * scale + this.width / 2;
    const top = (y - cy) * scale + this.height / 2;
    node.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  }

  /** Zooms by a factor while keeping the map point under a screen position fixed. */
  private zoomAt(x: number, y: number, factor: number) {
    const before = this.view;
    const scale = this.constrain({ ...before, scale: before.scale * factor }).scale;
    const worldX = before.cx + (x - this.width / 2) / before.scale;
    const worldY = before.cy + (y - this.height / 2) / before.scale;
    this.apply({ scale, cx: worldX - (x - this.width / 2) / scale, cy: worldY - (y - this.height / 2) / scale });
  }

  private local(event: { clientX: number; clientY: number }) {
    const rect = this.root.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private listen() {
    const { root } = this;
    root.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      this.pointers.set(event.pointerId, this.local(event));
      if (this.pointers.size === 1) {
        this.travelled = 0;
        this.dragging = false;
      }
    });
    root.addEventListener('pointermove', (event) => {
      const previous = this.pointers.get(event.pointerId);
      if (!previous) return;
      const point = this.local(event);
      const others = [...this.pointers].filter(([id]) => id !== event.pointerId).map(([, other]) => other);
      this.pointers.set(event.pointerId, point);
      if (!this.dragging) {
        this.travelled += Math.hypot(point.x - previous.x, point.y - previous.y);
        if (this.travelled < DRAG_THRESHOLD && !others.length) return;
        // Only a real drag takes the pointer, so a tap still reaches the marker under it.
        this.dragging = true;
        this.stop();
        for (const id of this.pointers.keys()) root.setPointerCapture(id);
        this.onGesture?.();
      }
      if (others.length) {
        const other = others[0];
        const before = Math.hypot(previous.x - other.x, previous.y - other.y);
        const after = Math.hypot(point.x - other.x, point.y - other.y);
        const middle = { x: (point.x + other.x) / 2, y: (point.y + other.y) / 2 };
        if (before > 0) this.zoomAt(middle.x, middle.y, after / before);
        // Half of this finger's travel moves the midpoint of the pinch.
        this.apply({ ...this.view, cx: this.view.cx - (point.x - previous.x) / 2 / this.view.scale, cy: this.view.cy - (point.y - previous.y) / 2 / this.view.scale });
      } else {
        this.apply({ ...this.view, cx: this.view.cx - (point.x - previous.x) / this.view.scale, cy: this.view.cy - (point.y - previous.y) / this.view.scale });
      }
    });
    const release = (event: PointerEvent) => {
      if (!this.pointers.delete(event.pointerId)) return;
      if (this.dragging && !this.pointers.size) {
        this.dragging = false;
        this.quietUntil = performance.now() + 320;
      }
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    // The click that ends a drag must not select whatever marker the finger lifted on.
    root.addEventListener('click', (event) => {
      if (performance.now() >= this.quietUntil) return;
      event.stopPropagation();
      event.preventDefault();
    }, true);
    root.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.stop();
      const { x, y } = this.local(event);
      this.zoomAt(x, y, Math.exp(-event.deltaY * 0.0016));
      this.onGesture?.();
    }, { passive: false });
  }
}
