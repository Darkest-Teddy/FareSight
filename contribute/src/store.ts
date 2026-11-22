import type { RoomModelTier } from '@faresight/shared';
import { api, ApiError, jobStatus, type ContributorJob, type JobRequest } from './api';
import type { CaptureUpload } from './captureUpload';

export interface DraftPhoto {
  file: Blob;
  name: string;
  lastModified: number;
  uploadId?: string;
}

export interface PendingSubmission {
  idempotencyKey: string;
  job: JobRequest;
}

export interface ScanDraft {
  id: string;
  photos: DraftPhoto[];
  tier?: RoomModelTier;
  dishId?: string;
  dishName?: string;
  diameter?: string;
  pending?: PendingSubmission;
  capture?: CaptureUpload;
}

const DRAFTS = 'venue-drafts';
const draftKey = (placeId: string, kind: ScanRecord['kind']) => [placeId, kind];
let draftDatabase: Promise<IDBDatabase> | undefined;

function openDraftDatabase() {
  return draftDatabase ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('faresight-contribute', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DRAFTS);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error) => {
    draftDatabase = undefined;
    throw error;
  });
}

async function readDraft(placeId: string, kind: ScanRecord['kind']): Promise<ScanDraft | undefined> {
  const db = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction(DRAFTS).objectStore(DRAFTS).get(draftKey(placeId, kind));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateDraft(
  placeId: string, kind: ScanRecord['kind'], update: (current?: ScanDraft) => ScanDraft | undefined,
) {
  const db = await openDraftDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DRAFTS, 'readwrite');
    const store = transaction.objectStore(DRAFTS);
    const key = draftKey(placeId, kind);
    const request = store.get(key);
    let conflict: unknown;
    request.onsuccess = () => {
      try {
        const next = update(request.result);
        if (next) store.put(next, key);
        else store.delete(key);
      } catch (error) {
        conflict = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(conflict ?? transaction.error);
  });
}

export const drafts = {
  load: readDraft,
  save(placeId: string, kind: ScanRecord['kind'], draft: ScanDraft, existing: boolean) {
    return updateDraft(placeId, kind, (current) => {
      if ((current ? current.id !== draft.id : existing) || current?.pending) {
        throw new Error('This draft changed in another view. Reopen the venue to see the latest draft.');
      }
      return draft;
    });
  },
  finish(placeId: string, kind: ScanRecord['kind'], idempotencyKey: string, keepPhotos = false) {
    return updateDraft(placeId, kind, (current) => current?.pending?.idempotencyKey === idempotencyKey
      ? (keepPhotos ? { ...current, pending: undefined } : undefined)
      : current);
  },
  finishCapture(placeId: string, captureId: string) {
    return updateDraft(placeId, 'room', (current) => current?.capture?.id === captureId ? undefined : current);
  },
};

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
  | { status: 'ok'; job: ContributorJob }
  | { status: 'missing' }
  | { status: 'offline'; job?: ContributorJob };

const CODE_KEY = 'faresight.contribute.code';
const SCANS_KEY = 'faresight.contribute.scans';
const REVIEWS_KEY = 'faresight.contribute.reviews';
const NAME_KEY = 'faresight.contribute.name';
const activeStages = new Set(['queued', 'generating', 'downloading', 'converting']);
const REVIEW_POLL_MS = 25_000;

function pollType(state: ScanState) {
  const job = 'job' in state ? state.job : undefined;
  if (job && jobStatus(job) === 'needs_review') return 'review';
  if (state.status === 'loading' || state.status === 'offline' || (job && activeStages.has(job.status))) return 'active';
}

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

/** The contributor upload code, saved on this device. */
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
  private lastReviewPoll = 0;
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

  /**
   * Keeps a server-sent event stream open for each capture that is still building, so a change
   * shows up at once. An event only triggers a re-read, so a missed one costs nothing but a poll interval.
   */
  private watch() {
    if (typeof EventSource === 'undefined') return;
    for (const [id, stream] of this.streams) {
      if (this.records.some((record) => record.id === id) && pollType(this.state(id))) continue;
      stream.close();
      this.streams.delete(id);
    }
    for (const { id, captureId } of this.records) {
      if (!captureId || this.streams.has(id) || !pollType(this.state(id))) continue;
      const stream = new EventSource(api.captureEventsUrl(captureId));
      for (const type of ['status', 'asset', 'failed']) stream.addEventListener(type, () => {
        this.lastReviewPoll = 0;
        this.schedule(0);
      });
      this.streams.set(id, stream);
    }
  }

  add(record: ScanRecord, job: ContributorJob) {
    this.records = [record, ...this.records.filter((entry) => entry.id !== record.id)];
    write(SCANS_KEY, this.records);
    this.states.set(record.id, { status: 'ok', job });
    this.emit();
    this.schedule(600);
  }

  update(job: ContributorJob) {
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
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      this.lastReviewPoll = 0;
      this.schedule(0);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    refresh();
  }

  schedule(delay = this.fast ? 1400 : 5000) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => void this.poll(), delay);
  }

  private async poll() {
    if (this.polling || document.visibilityState !== 'visible') return;
    this.polling = true;
    const now = Date.now();
    const reviewDue = now - this.lastReviewPoll >= REVIEW_POLL_MS;
    let checkingReview = false;
    const pending = this.records.filter(({ id }) => {
      const type = pollType(this.state(id));
      if (type === 'review' && reviewDue) checkingReview = true;
      return type === 'active' || (type === 'review' && reviewDue);
    });
    if (checkingReview) this.lastReviewPoll = now;
    await Promise.all(pending.map(async ({ id, captureId }) => {
      const previous = this.states.get(id);
      let state: ScanState;
      try {
        state = { status: 'ok', job: captureId ? await api.captureJob(captureId) : await api.job(id) };
      } catch (error) {
        state = error instanceof ApiError && error.status === 404
          ? { status: 'missing' }
          : { status: 'offline', job: previous && 'job' in previous ? previous.job : undefined };
      }
      if (this.states.get(id) === previous && this.records.some((record) => record.id === id)) {
        this.states.set(id, state);
      }
    }));
    this.polling = false;
    if (pending.length) this.emit();
    const remaining = this.records.map(({ id }) => pollType(this.state(id)));
    const activeDelay = remaining.includes('active') ? (this.fast ? 1400 : 5000) : Infinity;
    const reviewDelay = remaining.includes('review') ? Math.max(0, this.lastReviewPoll + REVIEW_POLL_MS - Date.now()) : Infinity;
    const delay = Math.min(activeDelay, reviewDelay);
    if (Number.isFinite(delay)) this.schedule(delay);
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
