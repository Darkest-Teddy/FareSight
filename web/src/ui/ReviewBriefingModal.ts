import type { BriefingAction, BriefingCard, BriefingFact, BriefingSection } from '../data/reviewBriefing';
import { button, element, modal } from './dom';

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

function renderSection(section: BriefingSection): HTMLElement {
  const node = element('section', 'briefing-section');
  node.dataset.kind = section.kind;
  if (section.heading) node.append(element('h3', '', section.heading));
  switch (section.kind) {
    case 'text':
      node.append(element('p', 'briefing-copy', section.body));
      break;
    case 'reviews':
      for (const review of section.items) {
        const article = element('article', 'briefing-review');
        const author = element('header');
        author.append(element('strong', '', review.author));
        if (review.placeName) author.append(element('span', 'muted', review.placeName));
        const provenance = review.sample ? 'Sample diner note' : review.unverified ? 'Unverified excerpt' : '';
        if (provenance) author.append(element('span', 'briefing-sample', provenance));
        const quote = element('blockquote');
        quote.textContent = review.text;
        article.append(author, quote);
        node.append(article);
      }
      break;
    case 'list': {
      const list = element('ul', 'briefing-list');
      for (const item of section.items) {
        const row = element('li');
        row.append(element('strong', '', item.label));
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
  private readonly panel = modal('Reviews & Briefing', 'briefing-modal');
  private readonly title = this.panel.dialog.querySelector('h2')!;
  private readonly kicker = element('p', 'briefing-kicker');
  private readonly close = this.panel.dialog.querySelector('button')!;
  private readonly tabs = element('div', 'briefing-tabs');
  private cardId?: string;

  constructor(private readonly actions: BriefingActions) {
    const identity = element('div', 'briefing-identity');
    this.title.before(identity);
    identity.append(this.kicker, this.title);
    this.tabs.setAttribute('role', 'group');
    this.tabs.setAttribute('aria-label', 'Open briefings');
    this.panel.dialog.prepend(this.tabs);
    this.panel.dialog.addEventListener('close', () => {
      if (!this.panel.dialog.open && this.cardId) this.actions.dismiss();
    });
  }

  show(cards: readonly BriefingCard[], activeId = this.cardId): void {
    const card = cards.find(({ id }) => id === activeId) ?? cards.at(-1);
    if (!card) { this.hide(); return; }
    const changed = this.cardId !== card.id;
    this.cardId = card.id;
    const focused = this.tabs.contains(document.activeElement);
    this.close.textContent = cards.length > 1 ? 'Dismiss all' : 'Dismiss';
    this.tabs.hidden = cards.length < 2;
    this.tabs.replaceChildren();
    let activeTab: HTMLButtonElement | undefined;
    if (!this.tabs.hidden) {
      for (const entry of cards) {
        const tab = element('div', 'briefing-tab');
        const select = button(entry.title, () => this.show(cards, entry.id));
        select.title = entry.title;
        select.setAttribute('aria-pressed', String(entry.id === card.id));
        const dismiss = button('×', () => this.actions.dismiss(entry.id), 'briefing-tab-close');
        dismiss.setAttribute('aria-label', `Close ${entry.title}`);
        tab.append(select, dismiss);
        this.tabs.append(tab);
        if (entry.id === card.id) activeTab = select;
      }
    }
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
    this.panel.body.replaceChildren(...body);
    this.panel.open();
    if (focused) (activeTab ?? this.close).focus();
    activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (changed) this.panel.body.scrollTop = 0;
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
    if (this.panel.dialog.open) this.panel.dialog.close();
  }
}
