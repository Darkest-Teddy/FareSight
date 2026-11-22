import type { JobStage } from '@faresight/shared';
import { api, jobStatus } from '../api';
import { button, el, errorText, haptic, icon, timeAgo } from '../dom';
import { scans, type ScanRecord, type ScanState } from '../store';
import { withCode } from '../ui/CodeSheet';

const stages: [JobStage, string][] = [
  ['queued', 'Queued'], ['generating', 'Building'], ['downloading', 'Fetching'],
  ['converting', 'Optimizing'], ['needs_review', 'Review'], ['ready', 'Live'],
];
const pills: Record<string, string> = {
  loading: 'Checking…', queued: 'Queued', generating: 'Building', downloading: 'Fetching', converting: 'Optimizing',
  needs_review: 'In review', ready: 'Live', rejected: 'Rejected', failed: 'Failed', missing: 'Gone',
};

interface Card {
  root: HTMLElement;
  meta: HTMLElement;
  pill: HTMLElement;
  steps: HTMLElement[];
  fill: HTMLElement;
  note: HTMLElement;
  actions: HTMLElement;
  actionsFor?: string;
}

/** Progress of every scan started on this device, from upload to live in FareSight. */
export class ScansView {
  readonly root = el('section', 'view scans-view');
  private readonly list = el('div', 'scans-list');
  private readonly empty = el('div', 'empty-state');
  private readonly cards = new Map<string, Card>();
  private readonly unsubscribe: () => void;
  private readonly clock: number;

  constructor(private readonly actions: { browse(): void }, private readonly fresh?: string) {
    const head = el('header', 'view-head');
    const title = el('div', 'head-title');
    title.append(el('h1', '', 'My scans'), el('p', 'view-sub', 'Photos you sent from this phone, on their way to 3D.'));
    head.append(title);
    this.empty.append(icon('scans'), el('h2', '', 'No scans yet'),
      el('p', '', 'Pick a stop, choose a place and add a few photos. Your scans show up here while they build.'),
      button('Find a place to scan', actions.browse, 'primary'));
    const body = el('div', 'scans-body');
    body.append(this.list, this.empty);
    this.root.append(head, body);

    scans.fast = true;
    scans.schedule(0);
    this.unsubscribe = scans.subscribe(() => this.render());
    // Keeps the "2 min ago" labels moving between status updates.
    this.clock = window.setInterval(() => this.render(), 30_000);
    this.render();
  }

  destroy() {
    scans.fast = false;
    this.unsubscribe();
    window.clearInterval(this.clock);
  }

  private render() {
    const records = scans.list;
    this.empty.hidden = records.length > 0;
    for (const [id, card] of this.cards) {
      if (records.some((record) => record.id === id)) continue;
      card.root.remove();
      this.cards.delete(id);
    }
    records.forEach((record, index) => {
      let card = this.cards.get(record.id);
      if (!card) {
        card = this.card(record);
        this.cards.set(record.id, card);
      }
      if (this.list.children[index] !== card.root) this.list.insertBefore(card.root, this.list.children[index] ?? null);
      this.update(card, record, scans.state(record.id));
    });
  }

  private card(record: ScanRecord): Card {
    const root = el('article', 'scan-card');
    if (record.id === this.fresh) root.classList.add('is-fresh');
    const head = el('header', 'scan-head');
    const badge = el('span', 'scan-kind');
    badge.append(icon(record.kind === 'room' ? 'room' : 'dish'));
    const title = el('div', 'scan-title');
    const meta = el('p');
    title.append(el('h2', '', record.placeName), meta);
    const pill = el('span', 'scan-pill');
    head.append(badge, title, pill);

    const track = el('ol', 'steps');
    const steps = stages.map(([, label]) => {
      const step = el('li', 'step');
      step.append(el('i'), el('span', '', label));
      track.append(step);
      return step;
    });
    const bar = el('div', 'scan-bar');
    const fill = el('i');
    bar.append(fill);
    const note = el('p', 'scan-note');
    note.setAttribute('role', 'status');
    const actions = el('div', 'scan-actions');
    root.append(head, track, bar, note, actions);
    return { root, meta, pill, steps, fill, note, actions };
  }

  private update(card: Card, record: ScanRecord, state: ScanState) {
    const job = 'job' in state ? state.job : undefined;
    const status = state.status === 'missing' ? 'missing' : job ? jobStatus(job) : 'loading';
    const index = stages.findIndex(([stage]) => stage === status);
    const settled = status === 'needs_review' || status === 'ready' || status === 'rejected';
    card.root.dataset.status = status;
    card.pill.textContent = pills[status] ?? status;
    const photos = `${record.photoCount} ${record.photoCount === 1 ? 'photo' : 'photos'}`;
    card.meta.textContent = `${record.label} · ${photos} · ${timeAgo(record.createdAt)}`;
    card.steps.forEach((step, position) => {
      step.classList.toggle('is-done', position < index || (status === 'ready' && position === index));
      step.classList.toggle('is-current', position === index && status !== 'ready');
      if (position === index && status !== 'ready') step.setAttribute('aria-current', 'step');
      else step.removeAttribute('aria-current');
    });
    card.fill.style.width = `${settled ? 100 : Math.max(3, job?.progress ?? 0)}%`;

    const waiting = state.status === 'offline' ? ' The server is not answering. Trying again.' : '';
    card.note.textContent = (
      status === 'missing' ? 'This scan is no longer on the server.'
      : status === 'loading' ? 'Checking on this scan…'
      : status === 'ready' ? 'Live in FareSight. Riders can now preview it in 3D.'
      : status === 'needs_review' ? 'Built. A FareSight admin reviews it before it goes live.'
      : status === 'rejected' ? (job?.rejection_reason || job?.error || job?.status_message || 'This scan was rejected during review.')
      : status === 'failed' ? (job?.error || job?.status_message || 'The build stopped before it finished.')
      : `${job?.progress ?? 0}% · ${job?.status_message ?? ''}`
    ) + waiting;

    const actionsFor = ['failed', 'missing', 'ready', 'rejected'].includes(status) ? status : '';
    if (card.actionsFor === actionsFor) return;
    card.actionsFor = actionsFor;
    card.actions.replaceChildren();
    if (actionsFor === 'failed') {
      const retry = button('Try again', () => void this.retry(record.id, card, retry), 'primary small');
      retry.prepend(icon('retry'));
      card.actions.append(retry);
    }
    if (actionsFor) card.actions.append(button(status === 'ready' ? 'Clear' : 'Remove', () => scans.remove(record.id), 'ghost small'));
  }

  private async retry(id: string, card: Card, control: HTMLButtonElement) {
    control.disabled = true;
    try {
      scans.update(await withCode((code) => api.retry(id, code)));
      haptic(10);
    } catch (error) {
      card.note.textContent = errorText(error);
    } finally {
      control.disabled = false;
    }
  }
}
