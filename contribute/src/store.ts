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
}

export type ScanState =
  | { status: 'loading' }
  | { status: 'ok'; job: GenerationJob }
  | { status: 'missing' }
  | { status: 'offline'; job?: GenerationJob };

const CODE_KEY = 'faresight.contribute.code';
const SCANS_KEY = 'faresight.contribute.scans';
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

  private emit() { for (const listener of this.listeners) listener(); }

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
    const pending = this.records.filter(({ id }) => {
      const state = this.state(id);
      return state.status === 'loading' || state.status === 'offline'
        || (state.status === 'ok' && activeStages.has(state.job.status));
    });
    await Promise.all(pending.map(async ({ id }) => {
      const previous = this.state(id);
      try {
        this.states.set(id, { status: 'ok', job: await api.job(id) });
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
