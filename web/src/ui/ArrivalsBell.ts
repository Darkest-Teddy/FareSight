import type { DiscoverArrival, NotificationFeed } from '@faresight/shared';
import { discover } from '../api/discoverClient';
import { button, element, iconButton } from './dom';

const TOAST_MS = 7000;

/**
 * The live half of Discover: a toast when a place arrives, and a bell holding the backlog.
 *
 * The grid deliberately does not change under a reader (specification D11), so this is how a new
 * place announces itself. The toast is transient and the bell is the record, which means someone
 * who looked away still finds what they missed.
 */
export class ArrivalsBell {
  readonly button: HTMLButtonElement;
  readonly root = element('div', 'bell');

  private readonly badge = element('span', 'bell-badge');
  private readonly panel = element('div', 'bell-panel');
  private readonly newList = element('div', 'bell-list');
  private readonly popularList = element('div', 'bell-list');
  private readonly toasts = element('div', 'toast-stack');
  private unread = 0;
  private open = false;
  private stop?: () => void;
  private refreshTimer?: number;

  constructor(private readonly onOpenDiscover: () => void) {
    // A line icon from the shared set, not an emoji: emoji render in their own colour and font,
    // so they ignore the button's state and sit outside the design language.
    this.button = iconButton('bell', 'New places', () => this.toggle(), 'bell-button');
    this.button.setAttribute('aria-expanded', 'false');
    this.badge.hidden = true;
    this.button.append(this.badge);

    const header = element('div', 'bell-panel-header');
    header.append(element('strong', '', 'Activity'));
    const seeAll = button('Open Discover', () => { this.close(); this.onOpenDiscover(); }, 'bell-see-all');
    header.append(seeAll);

    this.panel.append(
      header,
      element('h4', 'bell-heading', 'New places'),
      this.newList,
      element('h4', 'bell-heading', 'Popular now'),
      this.popularList,
    );
    this.panel.hidden = true;
    this.root.append(this.button, this.panel);
    document.body.append(this.toasts);

    // Clicking anywhere else closes the panel, which is what a dropdown is expected to do.
    document.addEventListener('click', (event) => {
      if (this.open && !this.root.contains(event.target as Node)) this.close();
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.open) this.close();
    });
  }

  /** Starts watching for arrivals and loads the current backlog. */
  start(): void {
    void this.refresh();
    this.stop = discover.watchArrivals((arrival) => {
      this.unread++;
      this.renderBadge();
      this.toast(arrival);
      if (this.open) void this.refresh();
    });
    // The stream carries arrivals; this catches the popularity list drifting as people browse.
    this.refreshTimer = window.setInterval(() => { if (!this.open) void this.refresh(); }, 120_000);
  }

  dispose(): void {
    this.stop?.();
    window.clearInterval(this.refreshTimer);
    this.toasts.remove();
  }

  private async refresh() {
    try {
      const feed = await discover.notifications();
      this.unread = feed.unread;
      this.renderBadge();
      this.renderFeed(feed);
    } catch { /* The bell is ambient. A failed refresh should not interrupt anyone. */ }
  }

  private renderBadge() {
    this.badge.hidden = this.unread === 0;
    this.badge.textContent = this.unread > 9 ? '9+' : String(this.unread);
    this.button.classList.toggle('has-unread', this.unread > 0);
  }

  private renderFeed(feed: NotificationFeed) {
    const entries = feed.new_places.map((place) => {
      const row = button(
        '',
        () => { this.close(); this.onOpenDiscover(); },
        'bell-row',
      );
      row.append(
        element('span', 'bell-row-name', place.name),
        element('span', 'bell-row-meta', place.station_name
          ? `${place.station_name} · ${relative(place.created_at)}`
          : relative(place.created_at)),
      );
      return row;
    });
    this.newList.replaceChildren(...(entries.length
      ? entries : [element('p', 'bell-empty', 'Nothing new yet.')]));

    const popular = feed.popular_now.map((place) => {
      const row = button('', () => { this.close(); this.onOpenDiscover(); }, 'bell-row');
      row.append(
        element('span', 'bell-row-name', place.name),
        element('span', 'bell-row-meta', `▲ ${Math.round(place.score)}`),
      );
      return row;
    });
    this.popularList.replaceChildren(...(popular.length
      ? popular : [element('p', 'bell-empty', 'No movement yet today.')]));
  }

  private toggle() {
    if (this.open) this.close(); else void this.show();
  }

  private async show() {
    this.open = true;
    this.panel.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    await this.refresh();
    // Opening the panel is what marks the backlog as seen.
    this.unread = 0;
    this.renderBadge();
    void discover.markNotificationsRead();
  }

  private close() {
    this.open = false;
    this.panel.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
  }

  private toast(arrival: DiscoverArrival) {
    const node = element('div', 'toast');
    node.setAttribute('role', 'status');
    const where = arrival.station_name ? `New at ${arrival.station_name}` : 'New place';
    node.append(
      element('span', 'toast-label', where),
      element('span', 'toast-name', arrival.name),
    );
    const open = button('View', () => { node.remove(); this.onOpenDiscover(); }, 'toast-action');
    node.append(open);
    this.toasts.append(node);
    // Keeps the stack from growing without bound if several arrive at once.
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => {
      node.classList.add('is-leaving');
      window.setTimeout(() => node.remove(), 400);
    }, TOAST_MS);
  }
}

function relative(iso: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}
