import type { Asset, Dish, Vector3 } from '@faresight/shared';
import type { JobRecord, Store, WorkerLease } from '../db/database.ts';
import { measureScale } from './splatProcessor.ts';

export interface PublishOptions { spawn_point?: Vector3; plate_diameter_m?: number; rotation_y?: number }

const defaultVector: Vector3 = [0, 0, 0];

/**
 * Makes a built asset live: a room becomes its place's room, a dish is attached to its dish
 * (or added as a new one). Call it inside a store transaction.
 */
export function publishAsset(store: Store, asset: Asset, job?: JobRecord, options: PublishOptions = {}, lease?: WorkerLease): Asset {
  if (asset.status === 'ready') return asset;
  const place = job && store.get('places', job.place_id);
  if (job && place) {
    if (job.kind === 'dish' && options.plate_diameter_m !== undefined) {
      Object.assign(asset, measureScale(options.plate_diameter_m, asset.metadata?.measured_width));
    }
    asset.spawn_point = options.spawn_point ?? asset.spawn_point;
    const rotation = asset.transform?.rotation ?? defaultVector;
    asset.transform = {
      position: asset.transform?.position ?? defaultVector,
      rotation: [rotation[0], options.rotation_y ?? rotation[1], rotation[2]], scale: asset.scale_factor,
    };
    if (job.kind === 'room') {
      for (const room of place.rooms) {
        if (room.asset_id === place.room_asset_id) room.asset_id = asset.id;
      }
      place.room_asset_id = asset.id;
    } else {
      const name = job.dish_name ?? 'Untitled dish';
      let dish = place.dishes.find((entry) => entry.id === job.dish_id || entry.name.toLowerCase() === name.toLowerCase());
      if (!dish) {
        dish = { id: `${place.id}-dish-${job.id}`, place_id: place.id, name, price: null, portion_note: '' } satisfies Dish;
        place.dishes.push(dish);
      }
      dish.asset_id = asset.id;
      dish.plate_diameter_m = asset.plate_diameter_m ?? dish.plate_diameter_m;
      job.dish_id = dish.id;
      job.plate_diameter_m = asset.plate_diameter_m;
    }
    store.put('places', place);
    store.updateJob(job, {
      status: 'ready', status_message: 'Published', terminal_failure: false, error: null, progress: 100,
    }, lease);
  }
  asset.status = 'ready';
  store.put('assets', asset);
  return asset;
}
