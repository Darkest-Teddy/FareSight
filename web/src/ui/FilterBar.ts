import { MBTA_SUBWAY_FARE, type Stop } from '@faresight/shared';
import { button, element, field, icon, option } from './dom';
import { cravings, initialFilters, type Craving, type Filters } from './state';

export class FilterBar {
  readonly root = element('section', 'filter panel');
  private readonly start = element('select');
  private readonly budget = element('input');
  private readonly budgetValue = element('output', 'price');
  private readonly group = element('output');
  private readonly family = element('input');
  private readonly reset: HTMLButtonElement;
  private readonly craving = element('select');
  private readonly summary: HTMLButtonElement;
  private readonly summaryText = element('span');
  private readonly minus: HTMLButtonElement;
  private readonly plus: HTMLButtonElement;
  private filters: Filters;

  constructor(filters: Filters, update: (patch: Partial<Filters>) => void, locate: () => void, close: () => void) {
    this.filters = filters;
    this.root.setAttribute('aria-label', 'Explore filters');
    this.reset = button('Reset', () => update(initialFilters), 'quiet filter-reset');
    this.reset.setAttribute('aria-label', 'Reset filters');
    this.reset.hidden = true;

    this.craving.append(...cravings.map(([id, title]) => option(id, id === 'all' ? 'Anything' : title)));
    this.craving.addEventListener('change', () => update({ craving: this.craving.value as Craving }));
    const lookingFor = field('Looking for', this.craving);
    lookingFor.classList.add('craving-field');
    this.start.addEventListener('change', () => update({ startStopId: this.start.value }));
    const origin = element('div', 'origin-controls');
    const gps = button('', locate, 'quiet gps');
    gps.setAttribute('aria-label', 'Use GPS');
    gps.title = 'Use GPS';
    gps.append(icon('locate'), element('span', '', 'Use GPS'));
    origin.append(field('Start from', this.start), gps);

    this.budget.type = 'range';
    this.budget.min = '8';
    this.budget.max = '50';
    this.budget.step = '1';
    this.budget.addEventListener('input', () => update({ maxBudget: Number(this.budget.value) }));
    const budgetField = field('Budget', this.budget);
    budgetField.classList.add('budget-field');
    this.budget.id = 'explore-budget';
    budgetField.htmlFor = this.budget.id;
    const budgetAmount = element('span');
    budgetAmount.append(this.budgetValue, element('small', '', ` · incl. $${MBTA_SUBWAY_FARE.toFixed(2)} fare`));
    budgetField.firstElementChild?.append(budgetAmount);

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
    controls.id = 'explore-filter-controls';
    this.summary = button('', () => {
      this.summary.setAttribute('aria-expanded', String(this.summary.getAttribute('aria-expanded') !== 'true'));
    }, 'filter-summary');
    this.summary.setAttribute('aria-controls', controls.id);
    this.summary.setAttribute('aria-expanded', 'false');
    this.summary.append(this.summaryText, icon('chevron-right'));
    const group = element('div', 'group-controls');
    group.append(element('span', 'field-caption', 'Group size'), stepper);
    controls.append(lookingFor, origin, budgetField, group, family, this.reset);
    this.root.append(button('Close', close, 'quiet mobile-only filter-close'), this.summary, controls);
  }

  /** Desktop only: collapse the controls to a one-line trip summary outside the map overview. */
  setCompact(compact: boolean) {
    const value = String(compact);
    if (this.root.dataset.compact === value) return;
    this.root.dataset.compact = value;
    this.summary.setAttribute('aria-expanded', 'false');
  }

  setStops(stops: Stop[]) {
    this.start.replaceChildren(...stops.map((stop) => option(stop.stop_id, stop.name)));
    this.start.value = this.filters.startStopId;
    this.updateSummary();
  }

  render(filters: Filters) {
    this.filters = filters;
    this.start.value = filters.startStopId;
    this.budget.value = String(filters.maxBudget);
    this.budget.style.setProperty('--fill', `${(this.budget.valueAsNumber - Number(this.budget.min)) / (Number(this.budget.max) - Number(this.budget.min)) * 100}%`);
    this.budgetValue.value = '$' + filters.maxBudget;
    this.group.value = String(filters.groupSize);
    this.minus.disabled = filters.groupSize === 1;
    this.plus.disabled = filters.groupSize === 20;
    this.family.checked = filters.familyVisit;
    this.craving.value = filters.craving;
    const resetFocused = document.activeElement === this.reset;
    this.reset.hidden = (Object.keys(initialFilters) as (keyof Filters)[]).every((key) => filters[key] === initialFilters[key]);
    if (this.reset.hidden && resetFocused) this.craving.focus({ preventScroll: true });
    this.updateSummary();
  }

  private updateSummary() {
    const stop = this.start.selectedOptions[0]?.textContent;
    const { craving, maxBudget, groupSize, familyVisit } = this.filters;
    const looking = craving === 'all' ? '' : `${cravings.find(([id]) => id === craving)?.[1]} · `;
    this.summaryText.textContent = `${looking}${stop ? `From ${stop} · ` : ''}Under $${maxBudget} · ${groupSize} ${groupSize === 1 ? 'person' : 'people'}${familyVisit ? ' · Family' : ''}`;
  }
}
