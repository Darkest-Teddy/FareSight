import '../styles/dock.css';
import { dockButton, element, type IconName } from './dom';

export type DockPanel = 'stops' | 'origin' | 'budget';

export interface DockParts {
  /** The stop list, opened from the first button. */
  stops: HTMLElement;
  /** The start stop, opened from the pin. */
  origin: HTMLElement;
  /** The budget slider, opened from its own button in the bottom-right corner. */
  budget: HTMLElement;
  /** The GPT Live button, which opens the transcript above the row. */
  voice: HTMLButtonElement;
  /** Buttons that act at once: VR, upload, sound. */
  actions: HTMLElement[];
  /** The MBTA state, the last line under the stop list. */
  status: HTMLElement;
  /** Asks the shell to open this card, or close it if it is the one showing. */
  toggle(panel: DockPanel): void;
  close(): void;
}

/**
 * The chrome in the bottom corners: a column of icon buttons on the left, the voice assistant last,
 * and the budget on its own on the right. Three of the buttons open a small card beside themselves,
 * one at a time; the rest act at once. Each button's name slides out of it on hover or focus. Everything lies over the canvas and never resizes it.
 */
export class Dock {
  readonly root = element('nav', 'dock');
  readonly budget = element('div', 'dock dock-budget');
  private readonly slots = new Map<DockPanel, { trigger: HTMLButtonElement; card: HTMLElement }>();
  private readonly budgetValue = element('span', 'dock-value');
  private open?: DockPanel;

  constructor(private readonly parts: DockParts) {
    this.root.setAttribute('aria-label', 'Explore');
    const stopsCard = element('div');
    stopsCard.append(parts.stops, parts.status);
    this.root.append(
      this.slot('stops', 'list', 'Stops', stopsCard),
      this.slot('origin', 'pin', 'Start from', parts.origin),
      ...parts.actions, parts.voice,
    );
    this.budget.append(this.slot('budget', 'budget', 'Budget', parts.budget));
    this.slots.get('budget')!.trigger.append(this.budgetValue);

    for (const corner of [this.root, this.budget]) {
      corner.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !this.open) return;
        // The key puts the card away and goes no further, so it does not also step the scene back.
        event.stopPropagation();
        event.preventDefault();
        parts.close();
      });
    }
    document.addEventListener('pointerdown', (event) => {
      const target = event.target as Node;
      if (this.open && !this.root.contains(target) && !this.budget.contains(target)) parts.close();
    });
  }

  private slot(panel: DockPanel, name: IconName, label: string, content: HTMLElement) {
    const trigger = dockButton(name, label, () => this.parts.toggle(panel));
    const card = element('div', 'dock-card');
    card.id = `dock-${panel}`;
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', label);
    card.hidden = true;
    card.append(content);
    trigger.setAttribute('aria-controls', card.id);
    trigger.setAttribute('aria-expanded', 'false');
    this.slots.set(panel, { trigger, card });
    const slot = element('div', 'dock-slot');
    slot.append(trigger, card);
    return slot;
  }

  /** Reflects the shell's state: which card is open, if any. */
  render(open?: DockPanel) {
    const previous = this.open && this.slots.get(this.open);
    // Focus never stays behind on something that just disappeared.
    const stranded = previous && open !== this.open && previous.card.contains(document.activeElement);
    this.open = open;
    for (const [panel, { trigger, card }] of this.slots) {
      card.hidden = panel !== open;
      trigger.setAttribute('aria-expanded', String(panel === open));
    }
    if (stranded) previous.trigger.focus({ preventScroll: true });
  }

  /** The budget button reads its value back, and turns sunflower while any filter narrows the map. */
  setBudget(value: number, narrowed: boolean) {
    this.budgetValue.textContent = '$' + value;
    const { trigger } = this.slots.get('budget')!;
    trigger.dataset.narrowed = String(narrowed);
    trigger.setAttribute('aria-label', `Budget, $${value} per person`);
  }

  /** A red dot on the Stops button while the MBTA feed has a problem. */
  setAlert(alert: boolean) {
    const { trigger } = this.slots.get('stops')!;
    if (alert && !trigger.querySelector('.dock-alert')) trigger.append(element('span', 'dock-alert'));
    else if (!alert) trigger.querySelector('.dock-alert')?.remove();
  }
}
