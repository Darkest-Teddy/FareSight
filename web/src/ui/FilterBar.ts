import type { Stop } from '@faresight/shared';
import { button, element, field, option } from './dom';
import { cravings, type Filters } from './state';

export class FilterBar {
  readonly root = element('section', 'filter panel');
  private readonly start = element('select');
  private readonly budget = element('input');
  private readonly budgetValue = element('output', 'price');
  private readonly group = element('output');
  private readonly family = element('input');
  private readonly count = element('span');
  private readonly reset: HTMLButtonElement;
  private readonly chips = new Map<Filters['craving'], HTMLButtonElement>();
  private readonly minus: HTMLButtonElement;
  private readonly plus: HTMLButtonElement;
  private filters: Filters;

  constructor(filters: Filters, update: (patch: Partial<Filters>) => void, locate: () => void, close: () => void) {
    this.filters = filters;
    this.root.setAttribute('aria-label', 'Explore filters');
    const heading = element('div', 'filter-head');
    this.count.setAttribute('role', 'status');
    this.reset = button('Reset filters', () => update({ craving: 'all', maxBudget: 50, groupSize: 1, familyVisit: false }), 'quiet');
    heading.append(this.count, this.reset, button('Close', close, 'quiet mobile-only'));

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
    origin.append(field('Start from', this.start), button('Use GPS', locate, 'quiet gps'));

    this.budget.type = 'range';
    this.budget.min = '8';
    this.budget.max = '50';
    this.budget.step = '1';
    this.budget.addEventListener('input', () => update({ maxBudget: Number(this.budget.value) }));
    const budgetField = field('Total budget (includes $2.40 T fare)', this.budget);
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
    this.root.append(heading, chips, controls);
  }

  /** Desktop only: collapse the controls to a one-line trip summary outside the map overview. */
  setCompact(compact: boolean) { this.root.dataset.compact = String(compact); }

  setStops(stops: Stop[]) {
    this.start.replaceChildren(...stops.map((stop) => option(stop.stop_id, stop.name)));
  }

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
    this.count.textContent = count
      ? `${count} matching ${count === 1 ? 'place' : 'places'}`
      : `No places match under $${filters.maxBudget}. Raise budget or clear craving.${roomHint}`;
    this.reset.hidden = count > 0 && filters.craving === 'all' && filters.maxBudget === 50 && filters.groupSize === 1 && !filters.familyVisit;
  }
}
