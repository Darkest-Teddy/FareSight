import type { Asset } from '@faresight/shared';
import type { Store } from '../db/database.ts';
import type { CaptureJobRow, Captures, SplatAssetRow } from './captures.ts';

const POLL_MS = 60_000;

type PublishedRow = Pick<CaptureJobRow, 'id' | 'params'> & { place_id: string; captured_at: Date };

/**
 * Every server that shares the capture database takes jobs from one queue, but each keeps its own catalog.
 * A room built by another machine is published there only, so this copies it into the local catalog:
 * the newest published capture of each place becomes that place's room, served from the splat bucket.
 * Returns how many rooms were added.
 */
export async function importPublishedCaptures(store: Store, captures: Captures) {
  const { rows } = await captures.pool.query<PublishedRow>(`
    select distinct on (c.place_id) j.id, j.params, c.place_id, c.created_at as captured_at
    from jobs j join captures c on c.id = j.capture_id
    where j.status = 'ready' and c.mode = 'room'
    order by c.place_id, j.created_at desc
  `);
  let imported = 0;
  for (const job of rows) {
    // An asset has its job's id. One that is already here was built here or imported before; a rejected one stays rejected.
    if (store.get('assets', job.id) || !store.get('places', job.place_id)) continue;
    const { rows: files } = await captures.pool.query<SplatAssetRow>(
      "select format, object_key, splat_count from splat_assets where job_id = $1 and quality = 'full' order by created_at", [job.id]);
    // The viewer loads the converted file. The untouched SPZ is only kept next to it when the two differ.
    const original = files.find(({ format }) => format === 'spz');
    const main = files.find(({ format }) => format !== 'spz') ?? original;
    if (!main) continue;
    const asset: Asset = {
      id: job.id, kind: 'room', backend: job.params.model_tier ?? 'atlas-draft',
      provenance: 'ai_spatial_preview', provenance_label: 'AI spatial preview from restaurant photos',
      scale_factor: 1, scale_status: 'approximate', scale_label: 'Approximate size', plate_diameter_m: null,
      gaussian_count: main.splat_count ?? 0, format: main.format, url: captures.assetUrl(main.object_key),
      ...(original ? { original_spz_url: captures.assetUrl(original.object_key) } : {}),
      // The preview image and the prepared photos stayed on the machine that built the room.
      preview_url: null, thumbnail_url: null, source_photos: [],
      spawn_point: [0, 1.55, 2], transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: 1 },
      captured_on: job.captured_at.toISOString().slice(0, 10), status: 'ready',
    };
    store.transaction(() => {
      const place = store.get('places', job.place_id);
      if (!place || store.get('assets', job.id)) return;
      for (const room of place.rooms) {
        if (room.asset_id === place.room_asset_id) room.asset_id = asset.id;
      }
      place.room_asset_id = asset.id;
      store.put('places', place);
      store.put('assets', asset);
      imported++;
    });
  }
  return imported;
}

/** Keeps the local catalog in step: at startup, whenever a capture changes, and on a slow poll for missed events. */
export function startCaptureSync(store: Store, captures: Captures, onError: (error: unknown) => void) {
  let running: Promise<void> | undefined;
  let again = false;
  let stopped = false;
  function sync() {
    if (stopped) return;
    if (running) return void (again = true);
    again = false;
    running = importPublishedCaptures(store, captures)
      .then((count) => { if (count) console.log(`Added ${count} room${count === 1 ? '' : 's'} built on another machine to the catalog.`); })
      .catch(onError)
      .finally(() => {
        running = undefined;
        if (again) sync();
      });
  }
  const timer = setInterval(sync, POLL_MS);
  sync();
  return {
    sync,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
