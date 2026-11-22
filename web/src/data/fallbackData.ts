import { demoAssets, demoPlaces, sampleReviews, STOPS } from '@faresight/shared';
import type { Place, RestaurantManifest } from '@faresight/shared';

const assets = new Map(demoAssets.map((asset) => [asset.id, asset]));
const asset = (id: string | null | undefined) => id ? assets.get(id) ?? null : null;
const places: Place[] = demoPlaces.map((place) => ({
  ...place,
  dishes: place.dishes.map((dish) => ({ ...dish, asset: asset(dish.asset_id) })),
  rooms: place.rooms.map((room) => ({ ...room, asset: asset(room.asset_id) })),
  reviews: sampleReviews(place.id),
}));

export const offlineCatalog = { stops: STOPS, places };

export function offlineManifest(place: Place): RestaurantManifest | undefined {
  const seededPlace = places.find(({ id }) => id === place.id);
  if (!seededPlace) return undefined;
  const room = asset(seededPlace.room_asset_id);
  const preview = room ?? seededPlace.dishes.find(({ asset }) => asset)?.asset;
  const { id, name, stop_id, vibe, typical_price, price_checked_on } = seededPlace;
  return {
    restaurant: { id, name, stop_id, vibe, typical_price, price_checked_on },
    room_asset: room,
    spawn_point: room?.spawn_point ?? [0, 1.55, 2],
    menu_items: seededPlace.dishes.map((dish) => ({ dish, dish_asset: dish.asset ?? null })),
    rooms: seededPlace.rooms,
    source_photos: seededPlace.photos,
    generation_label: preview?.provenance_label ?? 'No bundled spatial preview',
    scale_label: preview?.scale_label ?? 'Size not verified',
    updated_at: preview?.captured_on ?? '',
  };
}
