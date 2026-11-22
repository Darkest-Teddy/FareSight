import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { sampleReviews, type Asset, type GenerationJob, type Place } from '@faresight/shared';
import { demoAssets, places } from './seed.ts';
import type { AtlasPosedFrame, AtlasSplat } from '../services/atlasClient.ts';

export interface Upload {
  id: string;
  filename: string;
  mime_type: string;
  sha256: string;
  byte_length: number;
  width: number;
  height: number;
  place_id: string;
  dish_id: string | null;
  source_url: string | null;
  file: string;
  url: string;
  created_at: string;
}

export interface JobRecord extends GenerationJob {
  submission_pending?: boolean;
  world_id?: string;
  atlas_input_asset_ids?: string[];
  posed_frames?: AtlasPosedFrame[];
  atlas_splat?: AtlasSplat;
  preview_download_pending?: boolean;
}

export interface PendingReview {
  id: string;
  place_id: string;
  author_label: string;
  text: string;
  status: 'pending_review' | 'approved' | 'rejected';
  sample?: boolean;
  created_at: string;
}

export interface DebugLogEntry {
  id: string;
  logs: string[];
  created_at: string;
}

type Table = 'places' | 'assets' | 'uploads' | 'jobs' | 'reviews' | 'debug_logs';
type RecordByTable = {
  places: Place;
  assets: Asset;
  uploads: Upload;
  jobs: JobRecord;
  reviews: PendingReview;
  debug_logs: DebugLogEntry;
};

export class Store {
  readonly sqlite: DatabaseSync;
  /** Called after every job change. Capture storage uses it to mirror job progress into Postgres. */
  onJobUpdate?: (job: JobRecord) => void;

  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.sqlite = new DatabaseSync(filename, { timeout: 5000 });
    this.sqlite.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS places (id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS uploads (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        sha256 TEXT GENERATED ALWAYS AS (json_extract(data, '$.sha256')) STORED UNIQUE
      ) STRICT;
      CREATE TABLE IF NOT EXISTS upload_places (
        upload_id TEXT NOT NULL REFERENCES uploads(id),
        place_id TEXT NOT NULL REFERENCES places(id),
        PRIMARY KEY (upload_id, place_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        status TEXT GENERATED ALWAYS AS (json_extract(data, '$.status')) STORED,
        updated_at TEXT GENERATED ALWAYS AS (json_extract(data, '$.updated_at')) STORED
      ) STRICT;
      CREATE INDEX IF NOT EXISTS job_queue ON jobs(status, updated_at);
      CREATE TABLE IF NOT EXISTS reviews (id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS debug_logs (id TEXT PRIMARY KEY, data TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS worker_lease (id INTEGER PRIMARY KEY CHECK (id = 1), owner TEXT NOT NULL, expires INTEGER NOT NULL) STRICT;
    `);
    this.transaction(() => {
      for (const asset of demoAssets) {
        const stored = this.get('assets', asset.id);
        if (!stored || stored.backend === 'prebuilt-demo') this.put('assets', asset);
      }
      const isSeedAsset = (id: string | null | undefined) => !id || this.get('assets', id)?.backend === 'prebuilt-demo';
      for (const place of places) {
        const stored = this.get('places', place.id);
        if (!stored) {
          this.put('places', place);
          continue;
        }
        const { name, vibe, hours, details, lat, lon, walk_from_stop_m } = place;
        const seedDishIds = new Set(place.dishes.map(({ id }) => id));
        const dishes = new Map(stored.dishes
          .filter(({ id, asset_id }) => seedDishIds.has(id) || !asset_id || !isSeedAsset(asset_id))
          .map((dish) => [dish.id, dish]));
        for (const dish of place.dishes) {
          if (isSeedAsset(dishes.get(dish.id)?.asset_id)) dishes.set(dish.id, dish);
        }
        const seedRoom = isSeedAsset(stored.room_asset_id);
        const hasUploadedPreview = !seedRoom || stored.dishes.some(({ asset_id }) => !isSeedAsset(asset_id));
        this.put('places', {
          ...stored, name, vibe, hours, details, lat, lon, walk_from_stop_m,
          room_asset_id: seedRoom ? place.room_asset_id : stored.room_asset_id,
          dishes: [...dishes.values()],
          seed_status: hasUploadedPreview ? stored.seed_status : place.seed_status,
          price_checked_on: hasUploadedPreview ? stored.price_checked_on : place.price_checked_on,
        });
      }
      // Venues dropped from the catalog because they sit outside their station's model.
      for (const id of ['allston-bostongoods-01', 'allston-coreanos-01', 'allston-brightonmusic-01']) {
        this.sqlite.prepare('DELETE FROM places WHERE id = ?').run(id);
      }
      const reviewed = new Set(this.all('reviews').map(({ place_id }) => place_id));
      for (const place of this.all('places')) {
        if (place.reviews.length || reviewed.has(place.id)) continue;
        for (const review of sampleReviews(place.id)) {
          this.put('reviews', {
            id: review.id, place_id: place.id, author_label: review.author, text: review.text,
            created_at: review.created_at, status: 'approved', sample: true,
          });
        }
      }
    });
  }

  get<T extends Table>(table: T, id: string): RecordByTable[T] | undefined {
    const row = this.sqlite.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id);
    return row && JSON.parse(String(row.data));
  }

  all<T extends Table>(table: T): RecordByTable[T][] {
    return this.sqlite.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all()
      .map((row) => JSON.parse(String(row.data)));
  }

  put<T extends Table>(table: T, record: RecordByTable[T]): void {
    this.sqlite.prepare(`
      INSERT INTO ${table} (id, data) VALUES (?, ?)
      ON CONFLICT (id) DO UPDATE SET data = excluded.data
    `).run(record.id, JSON.stringify(record));
  }

  uploadByHash(sha256: string): Upload | undefined {
    const row = this.sqlite.prepare('SELECT data FROM uploads WHERE sha256 = ?').get(sha256);
    return row && JSON.parse(String(row.data));
  }

  linkUpload(id: string, place: string): void {
    this.sqlite.prepare('INSERT OR IGNORE INTO upload_places VALUES (?, ?)').run(id, place);
  }

  uploadsForPlace(place: string, ids: string[]): Upload[] | undefined {
    const query = this.sqlite.prepare(`
      SELECT uploads.data FROM uploads JOIN upload_places ON uploads.id = upload_places.upload_id
      WHERE upload_places.place_id = ? AND uploads.id = ?
    `);
    const uploads: Upload[] = [];
    for (const id of ids) {
      const row = query.get(place, id);
      if (!row) return undefined;
      uploads.push(JSON.parse(String(row.data)));
    }
    return uploads;
  }

  nextJob(): JobRecord | undefined {
    const row = this.sqlite.prepare(`
      SELECT data FROM jobs
      WHERE status IN ('queued', 'generating', 'downloading', 'converting')
      ORDER BY updated_at, rowid LIMIT 1
    `).get();
    return row && JSON.parse(String(row.data));
  }

  updateJob(job: JobRecord, changes: Partial<JobRecord>): JobRecord {
    const updated = { ...job, ...changes, updated_at: new Date().toISOString() };
    this.put('jobs', updated);
    this.onJobUpdate?.(updated);
    return updated;
  }

  transaction<T>(action: () => T): T {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      const value = action();
      this.sqlite.exec('COMMIT');
      return value;
    } catch (error) {
      this.sqlite.exec('ROLLBACK');
      throw error;
    }
  }

  claimWorker(owner: string): boolean {
    const now = Date.now();
    return Number(this.sqlite.prepare(`
      INSERT INTO worker_lease VALUES (1, ?, ?)
      ON CONFLICT (id) DO UPDATE SET owner = excluded.owner, expires = excluded.expires
      WHERE owner = excluded.owner OR expires < ?
    `).run(owner, now + 30_000, now).changes) === 1;
  }

  releaseWorker(owner: string): void {
    this.sqlite.prepare('DELETE FROM worker_lease WHERE owner = ?').run(owner);
  }
}

export function publicJob(job: JobRecord): GenerationJob {
  const { submission_pending, world_id, preview_download_pending, atlas_input_asset_ids, posed_frames, atlas_splat, ...publicFields } = job;
  return publicFields;
}
