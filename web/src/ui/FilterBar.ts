import type { Stop } from '@faresight/shared';
import { button, element, field, icon, iconButton, option } from './dom';
import { cravings, type Filters } from './state';

const defaults = { craving: 'all', maxBudget: 50, groupSize: 1, familyVisit: false } as const;

/**
 * Filters live behind one summary pill that reads the current state back in words.
 * Activating the pill opens the full controls above it.
 */
export class FilterBar {
  readonly root = element('section', 'filter');
  /** The expandable controls. Exposed so the shell can keep floating panels from overlapping. */
  readonly panel = element('div', 'filter-panel');
  private readonly summary: HTMLButtonElement;
  private readonly words = element('span', 'filter-words');
  private readonly tally = element('span', 'filter-count');
  private readonly start = element('select');
  private readonly budget = element('input');
  private readonly budgetValue = element('output', 'price');
  private readonly group = element('output');
  private readonly family = element('input');
  private readonly count = element('p', 'filter-status');
  private readonly reset: HTMLButtonElement;
  private readonly pillReset: HTMLButtonElement;
  private readonly chips = new Map<Filters['craving'], HTMLButtonElement>();
  private readonly minus: HTMLButtonElement;
  private readonly plus: HTMLButtonElement;
  private filters: Filters;
  private open = false;

  constructor(filters: Filters, update: (patch: Partial<Filters>) => void, locate: () => void, toggle: (open: boolean) => void) {
    this.filters = filters;
    this.root.setAttribute('aria-label', 'Explore filters');
    const clear = () => update({ ...defaults });

    this.panel.id = 'filter-panel';
    this.summary = button('', () => toggle(!this.open), 'filter-summary');
    this.summary.setAttribute('aria-controls', this.panel.id);
    this.summary.setAttribute('aria-expanded', 'false');
    this.summary.append(icon('sliders'), this.words, this.tally);
    this.pillReset = button('Reset', clear, 'filter-clear');
    this.pillReset.setAttribute('aria-label', 'Reset filters');
    const bar = element('div', 'filter-bar');
    bar.append(this.summary, this.pillReset);

    const heading = element('div', 'filter-head');
    this.count.setAttribute('role', 'status');
    this.reset = button('Reset filters', clear, 'quiet');
    heading.append(this.count, this.reset, iconButton('close', 'Close filters', () => toggle(false), 'quiet'));

    const chips = element('div', 'chips');
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', 'Craving');
    for (const [id, title] of cravings) {
      const chip = button(title, () => update({ craving: id }), 'chip');
      this.chips.set(id, chip);
      chips.append(chip);
    }

    this.start.addEventListener('change', () => update({ startStopId: this.start.value }));
    const origin = element('div', 'origin-controls');
    origin.append(field('Start from', this.start), button('Use GPS', locate, 'gps'));

    this.budget.type = 'range';
    this.budget.min = '8';
    this.budget.max = '50';
    this.budget.step = '1';
    this.budget.addEventListener('input', () => update({ maxBudget: Number(this.budget.value) }));
    const budgetField = field('Total budget, with $2.40 T fare', this.budget);
    budgetField.classList.add('budget-field');
    budgetField.firstElementChild?.append(this.budgetValue);

    this.minus = button('−', () => update({ groupSize: this.filters.groupSize - 1 }), 'step');
    this.minus.setAttribute('aria-label', 'Decrease group size');
    this.plus = button('+', () => update({ groupSize: this.filters.groupSize + 1 }), 'step');
    this.plus.setAttribute('aria-label', 'Increase group size');
    const stepper = element('div', 'stepper');
    stepper.setAttribute('role', 'group');
    stepper.setAttribute('aria-label', 'Group size');
    stepper.append(this.minus, this.group, this.plus);

    this.family.type = 'checkbox';
    this.family.addEventListener('change', () => update({ familyVisit: this.family.checked }));
    const family = element('label', 'check');
    family.append(this.family, 'Family visit');
    const controls = element('div', 'filter-controls');
    const group = element('div', 'group-controls');
    group.append(element('span', 'field-caption', 'Group size'), stepper);
    controls.append(origin, budgetField, group, family);
    this.panel.append(heading, chips, controls);
    this.panel.hidden = true;

    this.root.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.open) return;
      event.stopPropagation();
      toggle(false);
    });
    this.root.append(bar, this.panel);
  }

  setStops(stops: Stop[]) {
    this.start.replaceChildren(...stops.map((stop) => option(stop.stop_id, stop.name)));
  }

  setOpen(open: boolean) {
    this.open = open;
    this.panel.hidden = !open;
    this.root.dataset.open = String(open);
    this.summary.setAttribute('aria-expanded', String(open));
  }

  /** True while keyboard focus is inside the expanded controls. */
  holdsFocus() { return this.panel.contains(document.activeElement); }

  focusSummary() { this.summary.focus({ preventScroll: true }); }

  render(filters: Filters, count: number) {
    this.filters = filters;
    this.start.value = filters.startStopId;
    this.budget.value = String(filters.maxBudget);
    this.budgetValue.value = '$' + filters.maxBudget;
    this.group.value = String(filters.groupSize);
    this.minus.disabled = filters.groupSize === 1;
    this.plus.disabled = filters.groupSize === 20;
    this.family.checked = filters.familyVisit;
    for (const [id, chip] of this.chips) chip.setAttribute('aria-pressed', String(id === filters.craving));
    const roomHint = filters.craving === 'groups' && filters.groupSize === 1 ? ' Set your group size to split room hire.' : '';
    const places = `${count} ${count === 1 ? 'place' : 'places'}`;
    this.count.textContent = count
      ? `${count} matching ${count === 1 ? 'place' : 'places'}`
      : `No places match under $${filters.maxBudget}. Raise budget or clear craving.${roomHint}`;
    const changed = filters.craving !== defaults.craving || filters.maxBudget !== defaults.maxBudget
      || filters.groupSize !== defaults.groupSize || filters.familyVisit !== defaults.familyVisit;
    this.reset.hidden = this.pillReset.hidden = count > 0 && !changed;

    const craving = filters.craving === 'all' ? 'Anything' : cravings.find(([id]) => id === filters.craving)?.[1] ?? 'Anything';
    const origin = this.start.selectedOptions[0]?.textContent;
    const words = [
      craving, `up to $${filters.maxBudget}`, filters.groupSize === 1 ? '1 person' : `${filters.groupSize} people`,
      ...(filters.familyVisit ? ['family visit'] : []), ...(origin ? [`from ${origin}`] : []),
    ].join(' · ');
    this.words.textContent = words;
    this.tally.textContent = count ? places : 'No matches';
    this.root.dataset.empty = String(count === 0);
    this.summary.setAttribute('aria-label', `Filters: ${words}. ${count ? places : 'No places match'}.`);
  }
}
