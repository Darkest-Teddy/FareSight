/**
 * Turns the page's scroll position into per-act progress values.
 *
 * The landing page is two acts that have to run into each other without a
 * seam, so the scene is never told "we are in act 1" or "act 2". It is told
 * how far through each act we are, and both can be part-way at once. That
 * overlap is what makes the hand-off continuous rather than a cut.
 *
 * Scroll is read once per frame rather than in a scroll listener. Scroll
 * events fire at input rate, not frame rate, so reading them directly gives
 * you more updates than you can draw and they arrive out of step with the
 * renderer. Sampling in the render loop keeps one read per drawn frame.
 */

export interface ActProgress {
  /** 0 before the act starts, 1 once it has finished. Linear. */
  readonly raw: number;
  /** `raw` eased and smoothed. This is what the scene should animate on. */
  readonly value: number;
}

export interface DirectorState {
  readonly home: ActProgress;
  readonly table: ActProgress;
  /** Total progress across both acts, for anything that spans the whole page. */
  readonly overall: number;
}

interface Act {
  readonly element: HTMLElement;
  smoothed: number;
}

/** Smoothing rate. Higher follows the scrollbar more tightly. */
const followSpeed = 7.5;

/**
 * Frame-rate independent damping. Lerping by a fixed fraction each frame
 * means the motion speeds up on a 144 Hz display and crawls on a 30 Hz one;
 * this gives the same curve in wall-clock time whatever the refresh rate.
 */
function damp(dt: number, speed: number): number {
  return 1 - Math.exp(-dt * speed);
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Smootherstep. Zero first and second derivative at both ends, so pieces
 * leaving the room ease out of stillness instead of snapping into motion.
 */
function ease(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class ScrollDirector {
  private readonly acts: Act[] = [];
  private reduced = false;

  constructor(sections: readonly HTMLElement[]) {
    this.acts = sections.map((element) => ({ element, smoothed: 0 }));
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = query.matches;
    query.addEventListener('change', (event) => { this.reduced = event.matches; });
  }

  /**
   * How far the viewport has travelled through one section, where 0 is the
   * moment its top reaches the top of the viewport and 1 is the moment its
   * bottom does. Sections are taller than the viewport, so this is the span
   * over which the section is pinned and animating.
   */
  private rawFor(act: Act): number {
    const { top, height } = act.element.getBoundingClientRect();
    const travel = height - window.innerHeight;
    if (travel <= 0) return top <= 0 ? 1 : 0;
    return clamp01(-top / travel);
  }

  /** Call once per rendered frame. `dt` is seconds since the last frame. */
  sample(dt: number): DirectorState {
    const sampled = this.acts.map((act) => {
      const raw = this.rawFor(act);
      // Someone who has asked for reduced motion still needs the page to
      // make sense, so they get the same states, reached without easing.
      act.smoothed = this.reduced ? raw : act.smoothed + (raw - act.smoothed) * damp(dt, followSpeed);
      return { act, raw };
    });

    const read = (index: number): ActProgress => {
      const entry = sampled[index];
      if (!entry) return { raw: 0, value: 0 };
      return { raw: entry.raw, value: this.reduced ? entry.raw : ease(clamp01(entry.act.smoothed)) };
    };

    const home = read(0);
    const table = read(1);
    return { home, table, overall: clamp01((home.raw + table.raw) / 2) };
  }

  get prefersReducedMotion(): boolean {
    return this.reduced;
  }
}
