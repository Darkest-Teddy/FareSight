import { MBTA_SUBWAY_FARE, type Stop } from '@faresight/shared';
import { element, icon, iconButton, option } from './dom';
import { animateIcon } from './icons';
import { springBump, springText } from './motion';
import { budgetRange, type Filters } from './state';

/**
 * The two filters, each in its own small card: where the trip starts, and what it may cost. The
 * start stop opens from the dock; the budget opens from its own button in the opposite corner.
 */
export class FilterControls {
  readonly origin = element('section', 'filter-card');
  readonly budget = element('section', 'filter-card');
  private readonly start = element('select');
  private readonly originPin = icon('pin');
  private readonly matchIcon = icon('venue');
  private readonly locateButton: HTMLButtonElement;
  private readonly slider = element('input');
  private readonly budgetValue = element('output', 'price filter-value');
  private readonly count = element('p', 'filter-count');
  private readonly tally = element('span');

  constructor(filters: Filters, update: (patch: Partial<Filters>) => void, locate: () => void) {
    this.start.setAttribute('aria-label', 'Start from');
    this.start.addEventListener('change', () => {
      springBump(this.start);
      animateIcon(this.originPin, 'state');
      update({ startStopId: this.start.value });
    });
    const from = element('label', 'filter-field');
    from.append(this.originPin, this.start);
    const row = element('div', 'filter-row');
    this.locateButton = iconButton('locate', 'Use my location', locate, 'quiet');
    row.append(from, this.locateButton);
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
    this.count.append(this.matchIcon, this.tally);
    this.budget.setAttribute('aria-label', 'Budget');
    this.budget.append(budget, this.count);

    this.render(filters, 0);
  }

  setStops(stops: Stop[]) {
    this.start.replaceChildren(...stops.map((stop) => option(stop.stop_id, stop.name)));
  }

  setLocating(locating: boolean) {
    if ((this.locateButton.dataset.locating === 'true') === locating) return;
    this.locateButton.dataset.locating = String(locating);
    this.locateButton.setAttribute('aria-busy', String(locating));
    animateIcon(this.locateButton.querySelector('svg'), 'state');
  }

  focusOrigin() { this.start.focus({ preventScroll: true }); }
  focusBudget() { this.slider.focus({ preventScroll: true }); }

  render(filters: Filters, count: number) {
    if (this.start.value !== filters.startStopId) {
      this.start.value = filters.startStopId;
      springBump(this.start);
      animateIcon(this.originPin, 'state');
    }
    this.slider.value = String(filters.maxBudget);
    const nextBudget = '$' + filters.maxBudget;
    if (this.budgetValue.value !== nextBudget) {
      this.budgetValue.value = nextBudget;
      springBump(this.budgetValue);
    }
    this.budget.dataset.empty = String(count === 0);
    const summary = count === 0 ? 'No places match' : `${count} ${count === 1 ? 'place matches' : 'places match'}`;
    if (springText(this.tally, summary)) {
      springBump(this.count);
      animateIcon(this.matchIcon, 'state');
    }
  }
}
