export const SCULPTURE_PROJECTION = { lat0: 42.3540, lon0: -71.0950, metersPerUnit: 6500 } as const;

const radians = Math.PI / 180;
const earthRadiusMeters = 6371000;

export function latLonToSculpture(lat: number, lon: number): [number, number] {
  const { lat0, lon0, metersPerUnit } = SCULPTURE_PROJECTION;
  return [
    (lon - lon0) * 111320 * Math.cos(lat0 * radians) / metersPerUnit,
    (lat0 - lat) * 110540 / metersPerUnit,
  ];
}

export function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const a = Math.sin((lat2 - lat1) * radians / 2) ** 2
    + Math.cos(lat1 * radians) * Math.cos(lat2 * radians)
    * Math.sin((lon2 - lon1) * radians / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(Math.min(1, a)));
}
