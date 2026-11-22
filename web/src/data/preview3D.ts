import type { XRDishData, XRManifestData, XRPlaceData } from '../xr/bridgeTypes';

type PreviewPlace = Pick<XRPlaceData, 'room_asset_id' | 'rooms' | 'dishes'>;
type AssetReference = Pick<XRDishData, 'asset_id' | 'asset'>;

export function isSplat<T extends { format: string; url: string }>(asset: T | null | undefined): asset is T {
  return !!asset?.url && (asset.format === 'ply' || asset.format === 'sog' || asset.format === 'spz');
}

export function hasDishPreview(dish: AssetReference): boolean {
  return Boolean(dish.asset_id) || isSplat(dish.asset);
}

export function has3DRoom(place: PreviewPlace): boolean {
  return Boolean(place.room_asset_id) || place.rooms.some((room) => Boolean(room.asset_id) || isSplat(room.asset));
}

export function has3DDish(place: PreviewPlace): boolean {
  return place.dishes.some(hasDishPreview);
}

export function has3D(place: PreviewPlace): boolean {
  return has3DRoom(place) || has3DDish(place);
}

export interface StopPreviewCounts {
  matching: number;
  matching3D: number;
  published3D: number;
}

export function describe3DCount(counts: StopPreviewCounts | undefined): string {
  if (!counts?.published3D) return '';
  const { matching3D, published3D } = counts;
  const published = `${published3D} ${published3D === 1 ? 'place has' : 'places have'} 3D previews`;
  return matching3D === published3D ? `, ${published}` : `, ${published}, ${matching3D} match current filters`;
}

export function countPreviewsByStop(places: readonly XRPlaceData[], matched: ReadonlySet<string>): Map<string, StopPreviewCounts> {
  const byStop = new Map<string, StopPreviewCounts>();
  for (const place of places) {
    let counts = byStop.get(place.stop_id);
    if (!counts) {
      counts = { matching: 0, matching3D: 0, published3D: 0 };
      byStop.set(place.stop_id, counts);
    }
    const matches = matched.has(place.id);
    if (matches) counts.matching++;
    if (has3D(place)) {
      counts.published3D++;
      if (matches) counts.matching3D++;
    }
  }
  return byStop;
}

export function menuDishes(place: XRPlaceData, manifest: XRManifestData | null): XRDishData[] {
  return manifest?.menu_items.map(({ dish, dish_asset }) => dish_asset ? { ...dish, asset: dish_asset } : dish) ?? place.dishes;
}
