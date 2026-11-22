import type { GenerationJob } from '@faresight/shared';
import { api, ApiError } from './api';

/** A generation job this device started. The server keeps the job itself; this is the local index. */
export interface ScanRecord {
  id: string;
  placeId: string;
  placeName: string;
  stopId: string;
  kind: 'room' | 'dish';
  label: string;
  photoCount: number;
  createdAt: string;
  /** Set when the photos went to object storage. Status then comes from the capture, with live updates. */
  captureId?: string;
}

export type ScanState =
  | { status: 'loading' }
  | { status: 'ok'; job: GenerationJob }
  | { status: 'missing' }
  | { status: 'offline'; job?: GenerationJob };

const CODE_KEY = 'faresight.contribute.code';
const SCANS_KEY = 'faresight.contribute.scans';
const REVIEWS_KEY = 'faresight.contribute.reviews';
const NAME_KEY = 'faresight.contribute.name';
const activeStages = new Set(['queued', 'generating', 'downloading', 'converting']);

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw) as T;
  } catch { return fallback; }
}

function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Private mode keeps state in memory only. */ }
}

export type CodeStatus = 'unknown' | 'open' | 'saved' | 'needed';

/** The invite code a contributor enters once. It is sent as the API passcode on uploads. */
class InviteCode {
  private value = read<string>(CODE_KEY, '');
  private listeners = new Set<() => void>();
  status: CodeStatus = 'unknown';

  get current() { return this.value; }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private set(value: string, status: CodeStatus) {
    this.value = value;
    this.status = status;
    write(CODE_KEY, value);
    for (const listener of this.listeners) listener();
  }

  /** Learns whether this server needs a code and whether the saved one still works. */
  async refresh() {
    try {
      // Try the saved code first: a returning contributor then never triggers a rejected request.
      if (this.value && await api.checkCode(this.value)) this.set(this.value, 'saved');
      else if (await api.checkCode('')) this.set('', 'open');
      else this.set('', 'needed');
    } catch { /* Leave the status unknown while offline. Uploads report their own errors. */ }
  }

  /** Verifies a typed code with the server and saves it when it is accepted. */
  async save(value: string) {
    const accepted = await api.checkCode(value);
    if (accepted) this.set(value, 'saved');
    return accepted;
  }

  forget() { this.set('', 'needed'); }
}

/** Tracks the jobs started on this device and keeps their status fresh. */
class ScanTracker {
  private records = read<ScanRecord[]>(SCANS_KEY, []);
  private states = new Map<string, ScanState>();
  private listeners = new Set<() => void>();
  private timer?: number;
  private polling = false;
  private streams = new Map<string, EventSource>();
  /** Poll quickly while the scans screen is open, slowly otherwise. */
  fast = false;

  get list(): readonly ScanRecord[] { return this.records; }

  state(id: string): ScanState { return this.states.get(id) ?? { status: 'loading' }; }

  get activeCount() {
    return this.records.filter(({ id }) => {
      const state = this.state(id);
      return state.status === 'loading' || ('job' in state && state.job && activeStages.has(state.job.status));
    }).length;
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit() {
    this.watch();
    for (const listener of this.listeners) listener();
  }

  private active(id: string) {
    const state = this.state(id);
    return state.status === 'loading' || state.status === 'offline' || (state.status === 'ok' && activeStages.has(state.job.status));
  }

  /**
   * Keeps a server-sent event stream open for each capture that is still building, so a change
   * shows up at once. An event only triggers a re-read, so a missed one costs nothing but a poll interval.
   */
  private watch() {
    if (typeof EventSource === 'undefined') return;
    for (const [id, stream] of this.streams) {
      if (this.records.some((record) => record.id === id) && this.active(id)) continue;
      stream.close();
      this.streams.delete(id);
    }
    for (const { id, captureId } of this.records) {
      if (!captureId || this.streams.has(id) || !this.active(id)) continue;
      const stream = new EventSource(api.captureEventsUrl(captureId));
      for (const type of ['status', 'asset', 'failed']) stream.addEventListener(type, () => this.schedule(0));
      this.streams.set(id, stream);
    }
  }

  add(record: ScanRecord, job: GenerationJob) {
    this.records = [record, ...this.records.filter((entry) => entry.id !== record.id)];
    write(SCANS_KEY, this.records);
    this.states.set(record.id, { status: 'ok', job });
    this.emit();
    this.schedule(600);
  }

  update(job: GenerationJob) {
    this.states.set(job.id, { status: 'ok', job });
    this.emit();
    this.schedule(600);
  }

  remove(id: string) {
    this.records = this.records.filter((entry) => entry.id !== id);
    this.states.delete(id);
    write(SCANS_KEY, this.records);
    this.emit();
  }

  start() {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') this.schedule(0);
    });
    this.schedule(0);
  }

  schedule(delay = this.fast ? 1400 : 5000) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.poll(), delay);
  }

  private async poll() {
    if (this.polling || document.visibilityState !== 'visible') return;
    this.polling = true;
    const pending = this.records.filter(({ id }) => this.active(id));
    await Promise.all(pending.map(async ({ id, captureId }) => {
      const previous = this.state(id);
      try {
        this.states.set(id, { status: 'ok', job: captureId ? await api.captureJob(captureId) : await api.job(id) });
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) this.states.set(id, { status: 'missing' });
        else this.states.set(id, { status: 'offline', job: 'job' in previous ? previous.job : undefined });
      }
    }));
    this.polling = false;
    if (pending.length) {
      this.emit();
      this.schedule();
    }
  }
}

export const inviteCode = new InviteCode();
export const scans = new ScanTracker();

/** A review sent from this phone that the server has not published yet. */
export interface SentReview {
  id: string;
  placeId: string;
  author: string;
  text: string;
  rating: number;
  createdAt: string;
}

/** Remembers the reviews sent from this phone, so their author still sees them while they wait for approval. */
class SentReviews {
  private list = read<SentReview[]>(REVIEWS_KEY, []);

  /** The name used last time, so it does not have to be typed again. */
  get author() { return read<string>(NAME_KEY, ''); }

  add(review: SentReview) {
    this.list = [review, ...this.list];
    write(REVIEWS_KEY, this.list);
    write(NAME_KEY, review.author);
  }

  /** The reviews still waiting at a place. Any the server now publishes are forgotten here. */
  waiting(placeId: string, published: readonly { id: string }[]) {
    const live = new Set(published.map((review) => review.id));
    const kept = this.list.filter((review) => review.placeId !== placeId || !live.has(review.id));
    if (kept.length !== this.list.length) {
      this.list = kept;
      write(REVIEWS_KEY, kept);
    }
    return kept.filter((review) => review.placeId === placeId);
  }
}

export const sentReviews = new SentReviews();
