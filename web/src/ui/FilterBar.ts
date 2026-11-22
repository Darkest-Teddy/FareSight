import { MBTA_SUBWAY_FARE, type Stop } from '@faresight/shared';
import { button, element, field, icon, option } from './dom';
import { cravings, initialFilters, type Craving, type Filters } from './state';

// One or two words each, so the eight cravings sit in an even 4 × 2 grid; the full name stays the accessible label.
const shortCraving: Record<Craving, string> = {
  all: 'All', ramen: 'Ramen', cheap: 'Cheap eats', study: 'Study', groups: 'Karaoke', music: 'Music', shops: 'Shops', parks: 'Parks',
};

export class FilterBar {
  readonly root = element('section', 'filter panel');
  private readonly start = element('select');
  private readonly budget = element('input');
  private readonly budgetValue = element('output', 'price');
  private readonly group = element('output');
  private readonly family = element('input');
  private readonly reset: HTMLButtonElement;
  private readonly chipStrip = element('div', 'chips');
  private readonly indicator = element('span', 'chip-indicator');
  private readonly chips = new Map<Filters['craving'], HTMLButtonElement>();
  private readonly summary: HTMLButtonElement;
  private readonly summaryText = element('span');
  private readonly minus: HTMLButtonElement;
  private readonly plus: HTMLButtonElement;
  private readonly desktop = matchMedia('(min-width: 769px)');
  private filters: Filters;

  constructor(filters: Filters, update: (patch: Partial<Filters>) => void, locate: () => void, close: () => void) {
    this.filters = filters;
    this.root.setAttribute('aria-label', 'Explore filters');
    this.reset = button('Reset', () => update(initialFilters), 'quiet filter-reset');
    this.reset.setAttribute('aria-label', 'Reset filters');
    this.reset.hidden = true;
    const chipRow = element('div', 'filter-chip-row');
    chipRow.append(this.chipStrip, this.reset);

    this.chipStrip.setAttribute('role', 'group');
    this.chipStrip.setAttribute('aria-label', 'Craving');
    this.indicator.setAttribute('aria-hidden', 'true');
    this.chipStrip.append(this.indicator);
    const chipSizes = new ResizeObserver(() => this.alignIndicator());
    chipSizes.observe(this.chipStrip);
    for (const [id, title] of cravings) {
      const chip = button(shortCraving[id], () => update({ craving: id }), 'chip');
      chip.setAttribute('aria-label', title);
      chip.title = title;
      this.chips.set(id, chip);
      this.chipStrip.append(chip);
      chipSizes.observe(chip);
    }
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
    controls.append(origin, budgetField, group, family);
    this.root.append(button('Close', close, 'quiet mobile-only filter-close'), chipRow, this.summary, controls);
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
    for (const [id, chip] of this.chips) chip.setAttribute('aria-pressed', String(id === filters.craving));
    const resetFocused = document.activeElement === this.reset;
    this.reset.hidden = (Object.keys(initialFilters) as (keyof Filters)[]).every((key) => filters[key] === initialFilters[key]);
    if (this.reset.hidden && resetFocused) this.chips.get(filters.craving)?.focus({ preventScroll: true });
    this.updateSummary();
    this.alignIndicator();
  }

  private updateSummary() {
    const stop = this.start.selectedOptions[0]?.textContent;
    const { maxBudget, groupSize, familyVisit } = this.filters;
    this.summaryText.textContent = `${stop ? `From ${stop} · ` : ''}Under $${maxBudget} · ${groupSize} ${groupSize === 1 ? 'person' : 'people'}${familyVisit ? ' · Family' : ''}`;
  }

  private alignIndicator() {
    const chip = this.chips.get(this.filters.craving);
    if (!this.desktop.matches || !chip?.offsetWidth) return;
    this.indicator.style.width = `${chip.offsetWidth}px`;
    this.indicator.style.height = `${chip.offsetHeight}px`;
    this.indicator.style.transform = `translate(${chip.offsetLeft}px, ${chip.offsetTop}px)`;
    this.indicator.setAttribute('data-ready', '');
  }
}
