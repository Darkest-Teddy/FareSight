import '../styles/menu.css';
import { button, element, icon, navItem } from './dom';

export interface CornerMenuParts {
  /** Start stop and budget, at the top of the menu. */
  filters: HTMLElement;
  /** The stop list, shown as the menu's second level. */
  stops: HTMLElement;
  /** The visitor's rows after Stops: voice, VR. */
  primary: HTMLElement[];
  /** Setup and utility entries, a quiet strip under the rows. */
  tools: HTMLElement[];
  status: HTMLElement;
  /** Asks the shell to open or close the menu, on the main level. */
  setOpen(open: boolean): void;
  /** Asks the shell to show the stop list level, or go back to the main level. */
  showStops(open: boolean): void;
}

/**
 * The one menu: a small button in the bottom-right corner that opens a card upward. The card
 * holds the filters, the visitor's rows, a quiet strip of utilities and the MBTA status; the
 * stop list is its second level. It lies over the canvas and never resizes it. It closes on an
 * outside press, on Escape and after any action that leaves the menu.
 */
export class CornerMenu {
  readonly root = element('div', 'corner-menu');
  readonly trigger: HTMLButtonElement;
  private readonly panel = element('div', 'menu-panel');
  private readonly main = element('div', 'menu-main');
  private readonly stopsLevel = element('div', 'menu-stops');
  private readonly stopsItem: HTMLButtonElement;
  private readonly stopsBack: HTMLButtonElement;
  private readonly badge = element('span', 'menu-badge');
  private open = false;
  private stops = false;

  constructor(private readonly parts: CornerMenuParts) {
    this.panel.id = 'app-menu';
    this.panel.setAttribute('role', 'region');
    this.panel.setAttribute('aria-label', 'Menu');
    this.trigger = button('', () => parts.setOpen(!this.open), 'menu-trigger');
    this.trigger.append(icon('menu'), icon('close'), this.badge);
    this.trigger.setAttribute('aria-controls', this.panel.id);
    this.badge.setAttribute('aria-hidden', 'true');

    this.stopsItem = navItem('list', 'Stops', () => parts.showStops(true), 'menu-next');
    this.stopsItem.append(icon('chevron'));
    this.stopsItem.setAttribute('aria-controls', parts.stops.id);
    this.stopsItem.dataset.stay = 'true';
    const rows = element('div', 'menu-rows');
    rows.append(this.stopsItem, ...parts.primary);
    const tools = element('div', 'menu-tools');
    tools.append(...parts.tools);
    this.main.append(parts.filters, rows, tools, parts.status);

    this.stopsBack = navItem('back', 'Stops', () => parts.showStops(false), 'menu-up');
    this.stopsBack.setAttribute('aria-label', 'Stops, back to the menu');
    this.stopsBack.dataset.stay = 'true';
    this.stopsLevel.append(this.stopsBack, parts.stops);
    this.panel.append(this.main, this.stopsLevel);
    // The trigger comes first, so Tab goes from it straight into the card it opened.
    this.root.append(this.trigger, this.panel);

    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.open) return;
      event.stopPropagation();
      event.preventDefault();
      if (this.stops) parts.showStops(false);
      else parts.setOpen(false);
    });
    // Choosing anything that acts outside the menu puts it away. Entries marked stay act in place.
    this.panel.addEventListener('click', (event) => {
      const pressed = (event.target as Element).closest<HTMLElement>('button');
      if (this.open && pressed && !pressed.dataset.stay) parts.setOpen(false);
    });
    document.addEventListener('pointerdown', (event) => {
      if (this.open && !this.root.contains(event.target as Node)) parts.setOpen(false);
    });
    this.render(false, false);
  }

  get isOpen() { return this.open; }

  /** Reflects the shell's state: whether the menu is open, and on which level. */
  render(open: boolean, stops: boolean) {
    const focus = document.activeElement;
    const leftLevel = this.stops && !stops && this.stopsLevel.contains(focus);
    const enteredLevel = !this.stops && stops && this.main.contains(focus);
    const stranded = this.open && !open && this.panel.contains(focus);
    this.open = open;
    this.stops = open && stops;
    this.root.dataset.open = String(open);
    this.panel.hidden = !open;
    this.main.hidden = this.stops;
    this.stopsLevel.hidden = !this.stops;
    this.parts.stops.hidden = !this.stops;
    this.trigger.setAttribute('aria-expanded', String(open));
    this.trigger.setAttribute('aria-label', open ? 'Close menu' : 'Menu');
    this.trigger.title = open ? 'Close menu' : 'Menu';
    this.stopsItem.setAttribute('aria-expanded', String(this.stops));
    // Focus never stays behind on something that just disappeared.
    if (stranded) this.trigger.focus({ preventScroll: true });
    else if (leftLevel) this.stopsItem.focus({ preventScroll: true });
    else if (enteredLevel) this.stopsBack.focus({ preventScroll: true });
  }

  /** A dot on the closed menu button: red for an MBTA problem, sunflower while something is on. */
  setBadge(state: 'alert' | 'active' | 'none') {
    this.badge.dataset.state = state;
  }

  focusTrigger() { this.trigger.focus({ preventScroll: true }); }
}
