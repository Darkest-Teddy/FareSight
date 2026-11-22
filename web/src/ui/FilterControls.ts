import { MBTA_SUBWAY_FARE, type Stop } from '@faresight/shared';
import { element, icon, iconButton, option } from './dom';
import { budgetRange, type Filters } from './state';

/**
 * The two filters, each in its own small card: where the trip starts, and what it may cost. The
 * start stop opens from the dock; the budget opens from its own button in the opposite corner.
 */
export class FilterControls {
  readonly origin = element('section', 'filter-card');
  readonly budget = element('section', 'filter-card');
  private readonly start = element('select');
  private readonly slider = element('input');
  private readonly budgetValue = element('output', 'price');
  private readonly count = element('p', 'filter-count');
  private readonly tally = element('span');

  constructor(filters: Filters, update: (patch: Partial<Filters>) => void, locate: () => void) {
    this.start.setAttribute('aria-label', 'Start from');
    this.start.addEventListener('change', () => update({ startStopId: this.start.value }));
    const from = element('label', 'filter-field');
    from.append(icon('pin'), this.start);
    const row = element('div', 'filter-row');
    row.append(from, iconButton('locate', 'Use my location', locate, 'quiet'));
    this.origin.setAttribute('aria-label', 'Start from');
    this.origin.append(row);

    const budgetLabel = `Budget per person, with $${MBTA_SUBWAY_FARE.toFixed(2)} T fare`;
    this.slider.type = 'range';
    this.slider.min = String(budgetRange.min);
    this.slider.max = String(budgetRange.max);
    this.slider.step = '1';
    this.slider.setAttribute('aria-label', budgetLabel);
    this.slider.addEventListener('input', () => update({ maxBudget: Number(this.slider.value) }));
    const budget = element('label', 'filter-field filter-row');
    budget.title = budgetLabel;
    budget.append(this.slider, this.budgetValue);
    this.count.setAttribute('role', 'status');
    this.count.append(icon('venue'), this.tally);
    this.budget.setAttribute('aria-label', 'Budget');
    this.budget.append(budget, this.count);

    this.render(filters, 0);
  }

  setStops(stops: Stop[]) {
    this.start.replaceChildren(...stops.map((stop) => option(stop.stop_id, stop.name)));
  }

  focusOrigin() { this.start.focus({ preventScroll: true }); }
  focusBudget() { this.slider.focus({ preventScroll: true }); }

  render(filters: Filters, count: number) {
    this.start.value = filters.startStopId;
    this.slider.value = String(filters.maxBudget);
    this.budgetValue.value = '$' + filters.maxBudget;
    this.tally.textContent = count === 0 ? 'No places match' : `${count} ${count === 1 ? 'place matches' : 'places match'}`;
    this.budget.dataset.empty = String(count === 0);
  }
}
