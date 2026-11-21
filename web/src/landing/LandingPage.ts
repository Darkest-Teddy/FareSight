import { element } from '../ui/dom';
import { costOf, dishes, money, stopOf, type Dish } from './menu';
import { ScrollDirector, type DirectorState } from './ScrollDirector';

/**
 * The flat half of the landing page: the scroll track, the copy over it, and
 * the dish panel.
 *
 * The 3D scene draws to a canvas fixed behind all of this. Nothing here is
 * positioned by the scene and nothing in the scene is positioned by this, so
 * the two can be read and changed separately. The only thing they share is
 * the progress value the director hands out.
 */

/**
 * Each section is this many viewport heights tall. The visible content is
 * pinned and the extra height is the distance the scroll animation runs over.
 * Three is enough to let the room come apart without hurrying and short
 * enough that nobody feels trapped scrolling past it.
 */
const sectionHeights = 3;

interface DishView {
  readonly root: HTMLElement;
  readonly dish: Dish;
}

export class LandingPage {
  readonly sections: HTMLElement[] = [];
  readonly director: ScrollDirector;
  private readonly dishViews: DishView[] = [];
  private readonly progressLabel = element('p', 'cue');
  private activeDish = -1;

  constructor(private readonly root: HTMLElement) {
    this.sections.push(this.buildHome(), this.buildTable());
    this.root.append(...this.sections);
    this.director = new ScrollDirector(this.sections);
  }

  /** Section one. The room, and the claim the room is there to make. */
  private buildHome(): HTMLElement {
    const section = element('section', 'act act-home');
    section.style.height = `${sectionHeights * 100}vh`;

    const pin = element('div', 'pin');
    const copy = element('div', 'copy copy-centre');

    const eyebrow = element('p', 'eyebrow', 'FareSight · Boston by train');
    const heading = element('h1', 'display');
    heading.append(
      element('span', 'display-line', 'Try it'),
      element('span', 'display-line display-accent', 'before you ride.'),
    );
    const standfirst = element('p', 'standfirst',
      'See exactly what $16 and a Green Line trip gets you, before you leave your dorm.');

    this.progressLabel.textContent = 'Scroll';
    copy.append(eyebrow, heading, standfirst, this.progressLabel);
    pin.append(copy);
    section.append(pin);
    return section;
  }

  /** Section two. The table, and what the headset is actually for. */
  private buildTable(): HTMLElement {
    const section = element('section', 'act act-table');
    section.style.height = `${sectionHeights * 100}vh`;

    const pin = element('div', 'pin');
    const rail = element('div', 'copy copy-rail');
    rail.append(
      element('p', 'eyebrow', 'At the table'),
      element('h2', 'headline', 'Portion size is the thing nobody shows you.'),
      element('p', 'standfirst',
        'Stars and a few photos will not tell you how big it is, what the room feels like, or what the trip costs on top. Sit down and look.'),
    );

    const stack = element('div', 'dish-stack');
    for (const dish of dishes) {
      const view = this.buildDish(dish);
      this.dishViews.push({ root: view, dish });
      stack.append(view);
    }

    pin.append(rail, stack);
    section.append(pin);
    return section;
  }

  /** One dish card, set in the manner of the reference meal screen. */
  private buildDish(dish: Dish): HTMLElement {
    const card = element('article', 'dish');
    const cost = costOf(dish);
    const stop = stopOf(dish);

    card.append(
      element('h3', 'dish-name', dish.name),
      element('p', 'dish-description', dish.description),
    );

    const figures = element('dl', 'dish-figures');
    const figure = (term: string, value: string, className = '') => {
      figures.append(element('dt', '', term), element('dd', className, value));
    };
    figure('Dish', money(cost.price), 'figure-price');
    figure('Fare', money(cost.fare), 'figure-fare');
    figure('Total', money(cost.total), 'figure-total');
    card.append(figures);

    card.append(element('p', 'dish-portion', dish.portion));

    const line = element('p', 'dish-stop');
    const dot = element('span', 'line-dot');
    dot.style.background = stop.color;
    line.append(dot, element('span', '', `${stop.name} · ${stop.line}`));
    card.append(line);

    // Master plan 3 requires every asset to say what it is. Nothing here has
    // been measured yet, so nothing here claims to have been.
    const provenance = element('p', 'dish-provenance',
      dish.scale === 'measured' ? 'Captured · actual size' : 'Sample data · size not verified');
    provenance.dataset.state = dish.scale;
    card.append(provenance);

    return card;
  }

  /**
   * Shows one dish at a time as the second section scrolls.
   *
   * The cards are stacked on top of each other and cross-faded rather than
   * laid out in a column, so the plate on the table and the words about it
   * change together.
   */
  private setDish(progress: number): void {
    const count = this.dishViews.length;
    if (count === 0) return;
    // Hold the first card until the section has properly started and the last
    // one until it has properly ended.
    const eased = Math.min(1, Math.max(0, (progress - 0.12) / 0.76));
    const index = Math.min(count - 1, Math.floor(eased * count));
    if (index === this.activeDish) return;
    this.activeDish = index;
    this.dishViews.forEach((view, i) => view.root.classList.toggle('is-active', i === index));
  }

  /** Called once per frame with the sampled scroll state. */
  update(state: DirectorState): void {
    const home = state.home.raw;
    this.sections[0]?.classList.toggle('is-leaving', home > 0.72);
    this.progressLabel.style.opacity = String(Math.max(0, 1 - home * 5));
    this.setDish(state.table.raw);
  }

  /** The index of the dish currently on the plate, for the scene to match. */
  get currentDish(): number {
    return Math.max(0, this.activeDish);
  }
}
