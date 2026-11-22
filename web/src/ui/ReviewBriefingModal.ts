import type { BriefingAction, BriefingCard, BriefingFact, BriefingReview, BriefingSection } from '../data/reviewBriefing';
import { button, element, link, replacePreservingFocus } from './dom.ts';

interface BriefingActions {
  dismiss(cardId?: string): void;
  openVenue(id: string): void;
  openDish(placeId: string, dishId: string): void;
  compareDishes(placeId: string, dishId: string, comparePlaceId: string, compareDishId: string): void;
  viewOnMap(stopId: string): void;
}

function factList(facts: BriefingFact[], className: string): HTMLDListElement {
  const list = element('dl', className);
  for (const { label, value } of facts) {
    const fact = element('div');
    fact.append(element('dt', '', label), element('dd', '', value));
    list.append(fact);
  }
  return list;
}

export function renderBriefingReview(review: BriefingReview): HTMLElement {
  const article = element('article', 'briefing-review');
  const author = element('header');
  author.append(element('strong', '', review.author));
  if (review.placeName) author.append(element('span', 'muted', review.placeName));
  if (review.source) {
    const label = element('span', 'briefing-sample', review.source);
    if (review.url) {
      label.replaceChildren(link(review.source, review.url));
    }
    author.append(label);
  }
  if (review.rating !== undefined) author.append(element('span', 'muted', `${review.rating} / 5`));
  if (review.date_label) author.append(element('span', 'muted', review.date_label));
  const provenance = review.sample ? 'Sample diner note' : review.unverified ? 'Unverified excerpt' : '';
  if (provenance) author.append(element('span', 'briefing-sample', provenance));
  const quote = element('blockquote');
  quote.textContent = review.text;
  article.append(author, quote);
  return article;
}

function renderSection(section: BriefingSection): HTMLElement {
  const node = element('section', 'briefing-section');
  node.dataset.kind = section.kind;
  if (section.heading) node.append(element('h3', '', section.heading));
  switch (section.kind) {
    case 'text':
      node.append(element('p', 'briefing-copy', section.body));
      break;
    case 'reviews':
      node.append(...section.items.map(renderBriefingReview));
      break;
    case 'list': {
      const list = element('ul', 'briefing-list');
      for (const item of section.items) {
        const row = element('li');
        row.append(item.url ? link(item.label, item.url) : element('strong', '', item.label));
        if (item.badge) row.append(element('span', 'briefing-badge', item.badge));
        if (item.detail) row.append(element('p', 'muted', item.detail));
        list.append(row);
      }
      node.append(list);
      break;
    }
    case 'comparison': {
      const grid = element('div', 'briefing-comparison');
      for (const item of section.items) {
        const column = element('article', 'briefing-compare-place');
        column.append(element('h4', '', item.name));
        if (item.subtitle) column.append(element('p', 'muted', item.subtitle));
        if (item.metrics.length) column.append(factList(item.metrics, 'briefing-metrics'));
        if (item.note) column.append(element('p', '', item.note));
        grid.append(column);
      }
      node.append(grid);
      break;
    }
  }
  return node;
}

export class ReviewBriefingModal {
  readonly root = element('section', 'modal briefing-panel');
  private readonly body = element('div', 'modal-body');
  private readonly title = element('h2');
  private readonly kicker = element('p', 'briefing-kicker');
  private readonly close = button('Dismiss', () => this.actions.dismiss(), 'quiet');
  private readonly tabs = element('div', 'briefing-tabs');
  private cardId?: string;

  private opener?: HTMLElement;

  private readonly actions: BriefingActions;

  constructor(actions: BriefingActions) {
    this.actions = actions;
    this.root.hidden = true;
    this.title.id = 'fare-briefing-title';
    this.root.setAttribute('aria-labelledby', this.title.id);
    const header = element('header', 'modal-header');
    const identity = element('div', 'briefing-identity');
    identity.append(this.kicker, this.title);
    header.append(identity, this.close);
    this.tabs.setAttribute('role', 'group');
    this.tabs.setAttribute('aria-label', 'Open briefings');
    this.root.append(this.tabs, header, this.body);
  }

  dismissOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented || this.root.hidden) return;
    event.preventDefault();
    this.actions.dismiss();
  }

  show(cards: readonly BriefingCard[], activeId = this.cardId): void {
    const card = cards.find(({ id }) => id === activeId) ?? cards.at(-1);
    if (!card) { this.hide(); return; }
    const changed = this.cardId !== card.id;
    this.cardId = card.id;
    this.close.textContent = cards.length > 1 ? 'Dismiss all' : 'Dismiss';
    this.tabs.hidden = cards.length < 2;
    const tabs: HTMLElement[] = [];
    let activeTab: HTMLButtonElement | undefined;
    if (!this.tabs.hidden) {
      for (const entry of cards) {
        const tab = element('div', 'briefing-tab');
        const select = button(entry.title, () => this.show(cards, entry.id));
        select.title = entry.title;
        select.dataset.focusKey = `select:${entry.id}`;
        select.setAttribute('aria-pressed', String(entry.id === card.id));
        const dismiss = button('×', () => this.actions.dismiss(entry.id), 'briefing-tab-close');
        dismiss.dataset.focusKey = `dismiss:${entry.id}`;
        dismiss.setAttribute('aria-label', `Close ${entry.title}`);
        tab.append(select, dismiss);
        tabs.push(tab);
        if (entry.id === card.id) activeTab = select;
      }
    }
    replacePreservingFocus(this.tabs, activeTab ?? this.close, ...tabs);
    this.title.textContent = card.title;
    this.kicker.textContent = card.kicker ?? '';
    this.kicker.hidden = !card.kicker;
    const body: HTMLElement[] = [];
    if (card.subtitle) body.push(element('p', 'briefing-subtitle muted', card.subtitle));
    if (card.facts?.length) body.push(factList(card.facts, 'briefing-facts'));
    body.push(...card.sections.map(renderSection));
    if (card.actions?.length) {
      const footer = element('footer', 'briefing-actions');
      for (const [index, action] of card.actions.entries()) {
        footer.append(button(action.label, () => this.activate(action), index === 0 ? 'accent' : ''));
      }
      if (card.actions.some(({ kind }) => kind === 'compare-dishes')) body.splice(card.subtitle ? 1 : 0, 0, footer);
      else body.push(footer);
    }
    replacePreservingFocus(this.body, this.close, ...body);
    if (this.root.hidden && document.activeElement instanceof HTMLElement) this.opener = document.activeElement;
    this.root.hidden = false;
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (changed) this.body.scrollTop = 0;
  }

  private activate(action: BriefingAction): void {
    switch (action.kind) {
      case 'venue': this.actions.openVenue(action.placeId); break;
      case 'dish': this.actions.openDish(action.placeId, action.dishId); break;
      case 'compare-dishes': this.actions.compareDishes(action.placeId, action.dishId, action.comparePlaceId, action.compareDishId); break;
      case 'map': this.actions.viewOnMap(action.stopId); break;
    }
  }

  hide(): void {
    this.cardId = undefined;
    const restore = this.root.contains(document.activeElement);
    this.root.hidden = true;
    if (restore && this.opener?.isConnected) this.opener.focus({ preventScroll: true });
    this.opener = undefined;
  }
}
