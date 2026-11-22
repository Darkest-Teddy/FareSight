import { STOPS } from '@faresight/shared';
import { catalog } from './catalog';
import { button, el, icon, iconButton, motion } from './dom';
import { inviteCode, scans } from './store';
import { codeSheet } from './ui/CodeSheet';
import { NetworkView } from './views/NetworkView';
import { ScansView } from './views/ScansView';
import { StationView } from './views/StationView';
import { VenueView } from './views/VenueView';

type Route =
  | { name: 'map' }
  | { name: 'stop'; stopId: string }
  | { name: 'place'; stopId: string; placeId: string }
  | { name: 'scans'; fresh?: string };
type Transition = 'fade' | 'forward' | 'back' | 'dive' | 'surface';
interface Screen { root: HTMLElement; destroy?(): void }

const depth: Record<Route['name'], number> = { map: 0, scans: 0, stop: 1, place: 2 };
const codeLabels = {
  unknown: 'Invite code', open: 'No invite code needed', saved: 'Invite code saved', needed: 'Enter your invite code',
};

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'scans') return { name: 'scans', fresh: new URLSearchParams(query).get('new') ?? undefined };
  if (parts[0] === 'stop' && parts[1]) {
    return parts[2] === 'place' && parts[3]
      ? { name: 'place', stopId: parts[1], placeId: parts[3] }
      : { name: 'stop', stopId: parts[1] };
  }
  return { name: 'map' };
}

function transition(from: Route | undefined, to: Route): Transition {
  if (!from || from.name === 'scans' || to.name === 'scans') return 'fade';
  if (from.name === 'map' && to.name === 'stop') return 'dive';
  if (from.name === 'stop' && to.name === 'map') return 'surface';
  return depth[to.name] >= depth[from.name] ? 'forward' : 'back';
}

/** The shell around every screen: top bar, tab bar and the hash router between them. */
export class App {
  private readonly stage = el('main', 'stage');
  private readonly tabs = new Map<'map' | 'scans', HTMLButtonElement>();
  private readonly badge = el('span', 'tab-badge');
  private readonly codeButton: HTMLButtonElement;
  private readonly trail: string[] = [];
  private screen?: Screen;
  private route?: Route;
  private awaitingCatalog = false;

  constructor(root: HTMLElement) {
    root.classList.add('shell');
    const bar = el('header', 'topbar');
    const brand = button('', () => this.go('#/'), 'wordmark');
    const mark = el('span', 'brand-mark');
    mark.setAttribute('aria-hidden', 'true');
    brand.append(mark, el('span', '', 'FareSight'), el('span', 'brand-tag', 'Contribute'));
    brand.setAttribute('aria-label', 'FareSight Contribute, back to the map');
    this.codeButton = iconButton('key', codeLabels.unknown, () => void codeSheet.ask(), 'code-button');
    bar.append(brand, this.codeButton);

    const nav = el('nav', 'tabbar');
    nav.setAttribute('aria-label', 'Sections');
    for (const [id, symbol, label, target] of [
      ['map', 'map', 'Map', '#/'], ['scans', 'scans', 'My scans', '#/scans'],
    ] as const) {
      const tab = button('', () => this.go(target), 'tab');
      const glyph = el('span', 'tab-icon');
      glyph.append(icon(symbol));
      if (id === 'scans') glyph.append(this.badge);
      tab.append(glyph, el('span', '', label));
      this.tabs.set(id, tab);
      nav.append(tab);
    }
    root.replaceChildren(bar, this.stage, nav);
  }

  start() {
    inviteCode.subscribe(() => this.renderCode());
    scans.subscribe(() => this.renderBadge());
    catalog.subscribe(() => {
      if (!this.awaitingCatalog || catalog.status === 'loading') return;
      this.awaitingCatalog = false;
      this.show();
    });
    this.renderCode();
    this.renderBadge();
    void catalog.load();
    void inviteCode.refresh();
    scans.start();
    window.addEventListener('online', () => {
      void catalog.load();
      void inviteCode.refresh();
    });
    window.addEventListener('hashchange', () => this.show());
    this.show();
  }

  private go(hash: string, replace = false) {
    if (hash === (window.location.hash || '#/')) return;
    if (replace) {
      this.trail.pop();
      window.location.replace(hash);
    } else window.location.hash = hash;
  }

  /** Steps back to a parent screen, reusing the history entry when the person came from it. */
  private back(parent: string) {
    if (this.trail.at(-2) === parent) window.history.back();
    else this.go(parent, true);
  }

  private show() {
    const hash = window.location.hash || '#/';
    if (this.trail.at(-2) === hash) this.trail.pop();
    else if (this.trail.at(-1) !== hash) this.trail.push(hash);

    const route = parse(hash);
    const previous = this.route;
    const screen = this.build(route, previous);
    if (!screen) return;
    const kind = transition(previous, route);
    this.route = route;
    const old = this.screen;
    this.screen = screen;
    screen.root.dataset.enter = kind;
    this.stage.append(screen.root);
    if (old) {
      old.root.dataset.leave = kind;
      old.root.inert = true;
      window.setTimeout(() => {
        old.root.remove();
        old.destroy?.();
      }, motion(260));
    }
    for (const [id, tab] of this.tabs) {
      if ((route.name === 'scans') === (id === 'scans')) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    }
    document.title = route.name === 'scans' ? 'My scans · FareSight Contribute' : 'FareSight Contribute';
  }

  private build(route: Route, previous: Route | undefined): Screen | undefined {
    if (route.name === 'map') {
      void catalog.load(30_000);
      return new NetworkView(
        { openStop: (stopId) => this.go(`#/stop/${encodeURIComponent(stopId)}`) },
        previous?.name === 'stop' ? previous.stopId : undefined,
      );
    }
    if (route.name === 'scans') return new ScansView({ browse: () => this.go('#/') }, route.fresh);

    const stop = STOPS.find((entry) => entry.stop_id === route.stopId);
    if (!stop) {
      this.go('#/', true);
      return;
    }
    const stopHash = `#/stop/${encodeURIComponent(stop.stop_id)}`;
    if (route.name === 'stop') {
      return new StationView(stop, {
        back: () => this.back('#/'),
        openPlace: (place) => this.go(`${stopHash}/place/${encodeURIComponent(place.id)}`),
      }, previous?.name === 'place' ? previous.placeId : undefined);
    }

    // A place can be opened straight from a link, before the list of places has arrived.
    if (catalog.status === 'loading') {
      this.awaitingCatalog = true;
      void catalog.load();
      const loading = el('section', 'view');
      loading.append(el('div', 'board-skeleton'));
      return { root: loading };
    }
    const place = catalog.find(route.placeId);
    if (!place || place.stop_id !== stop.stop_id) {
      this.go(stopHash, true);
      return;
    }
    return new VenueView(place, stop, {
      back: () => this.back(stopHash),
      done: (jobId) => this.go(`#/scans?new=${encodeURIComponent(jobId)}`, true),
    });
  }

  private renderCode() {
    this.codeButton.dataset.status = inviteCode.status;
    this.codeButton.setAttribute('aria-label', codeLabels[inviteCode.status]);
  }

  private renderBadge() {
    const active = scans.activeCount;
    this.badge.textContent = active ? String(active) : '';
    this.badge.hidden = !active;
  }
}
