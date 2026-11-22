import { MBTA_SUBWAY_FARE, type Stop } from '@faresight/shared';
import { element, icon, iconButton, option } from './dom';
import { budgetRange, type Filters } from './state';

/**
 * The two filters, start stop and budget, at the top of the corner menu. Each is an icon and a
 * value; the wording lives in tooltips and accessible names. A line under them counts the places
 * that still match.
 */
export class FilterControls {
  readonly root = element('section', 'menu-filters');
  private readonly start = element('select');
  private readonly budget = element('input');
  private readonly budgetValue = element('output', 'price');
  private readonly count = element('p', 'filter-count');
  private readonly tally = element('span');

  constructor(filters: Filters, update: (patch: Partial<Filters>) => void, locate: () => void) {
    this.root.setAttribute('aria-label', 'Filters');

    this.start.setAttribute('aria-label', 'Start from');
    this.start.addEventListener('change', () => update({ startStopId: this.start.value }));
    const origin = element('label', 'filter-field');
    origin.title = 'Start from';
    origin.append(icon('pin'), this.start);
    const locateButton = iconButton('locate', 'Use my location', locate, 'quiet');
    // Finding the nearest stop updates the menu in place, so the menu stays open for it.
    locateButton.dataset.stay = 'true';
    const from = element('div', 'filter-row');
    from.append(origin, locateButton);

    const budgetLabel = `Budget per person, with $${MBTA_SUBWAY_FARE.toFixed(2)} T fare`;
    this.budget.type = 'range';
    this.budget.min = String(budgetRange.min);
    this.budget.max = String(budgetRange.max);
    this.budget.step = '1';
    this.budget.setAttribute('aria-label', budgetLabel);
    this.budget.addEventListener('input', () => update({ maxBudget: Number(this.budget.value) }));
    const budget = element('label', 'filter-field filter-row');
    budget.title = budgetLabel;
    budget.append(icon('budget'), this.budget, this.budgetValue);

    this.count.setAttribute('role', 'status');
    this.count.append(icon('venue'), this.tally);

    this.root.append(from, budget, this.count);
    this.render(filters, 0);
  }

  setStops(stops: Stop[]) {
    this.start.replaceChildren(...stops.map((stop) => option(stop.stop_id, stop.name)));
  }

  focusFirst() { this.start.focus({ preventScroll: true }); }

  render(filters: Filters, count: number) {
    this.start.value = filters.startStopId;
    this.budget.value = String(filters.maxBudget);
    this.budgetValue.value = '$' + filters.maxBudget;
    this.tally.textContent = count === 0 ? 'No places match' : `${count} ${count === 1 ? 'place matches' : 'places match'}`;
    this.root.dataset.empty = String(count === 0);
  }
}
