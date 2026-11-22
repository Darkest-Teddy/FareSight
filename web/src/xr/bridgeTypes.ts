import type { VoiceState } from '../voice/RealtimeVoice';
import type { BriefingCard } from '../data/reviewBriefing';

export type SceneMode = 'map' | 'station' | 'venue' | 'dish';

export interface XRFilterSummary {
  maxBudget: number;
  startStopId: string;
}

export interface XRStopData {
  stop_id: string;
  name: string;
  area_code: string;
  lat: number;
  lon: number;
  lines: string[];
  primary_color: string;
  segment_asset: string;
}

export interface XRAssetData {
  id: string;
  kind: 'room' | 'dish' | 'seat_view' | 'photo_gallery';
  provenance_label: string;
  scale_status: 'measured' | 'estimated' | 'approximate' | 'unknown';
  scale_label: string;
  scale_factor: number;
  plate_diameter_m?: number | null;
  gaussian_count: number;
  format: 'sog' | 'ply' | 'spz' | 'gallery';
  url: string;
  spawn_point?: [number, number, number] | null;
  captured_on: string;
}

export interface XRDishData {
  id: string;
  place_id: string;
  name: string;
  price: number | null;
  portion_note: string;
  plate_diameter_m?: number | null;
  asset_id?: string | null;
  asset?: XRAssetData | null;
}

export interface XRRoomData {
  id: string;
  place_id: string;
  name: string;
  room_type: string;
  stated_capacity: number;
  floor_width_m: number;
  floor_depth_m: number;
  seating: 'seated' | 'standing';
  price: number;
  price_unit: string;
  asset_id?: string | null;
  asset?: XRAssetData | null;
}

export interface XRPlaceData {
  id: string;
  name: string;
  category: string;
  stop_id: string;
  lat?: number;
  lon?: number;
  pin_index?: number;
  typical_price: number;
  hours?: Record<string, [string, string]>;
  stated_capacity?: number;
  vibe: string;
  photos: string[];
  room_asset_id?: string | null;
  dishes: XRDishData[];
  rooms: XRRoomData[];
}

export interface XRManifestData {
  room_asset: XRAssetData | null;
  spawn_point: [number, number, number];
  menu_items: { dish: XRDishData; dish_asset: XRAssetData | null }[];
  rooms: XRRoomData[];
  generation_label: string;
  scale_label: string;
}

export interface XRVehicleData {
  id: string;
  route_id: string;
  line_color: string;
  lat: number;
  lon: number;
  bearing?: number;
  label?: string;
}

export interface XRSceneCallbacks {
  onSelectStop: (stopId: string) => void;
  /** The stop under the pointer in the 3D map, so the stop list can mirror it. */
  onHoverStop: (stopId: string | undefined) => void;
  onSelectPlace: (placeId: string) => void;
  onSelectDish: (dishId: string) => void;
  onCompareDish: (dishId: string, placeId: string) => void;
  onNavigateScene: (scene: SceneMode) => void;
  onToggleVoice: () => void;
  onDismissReviewCard: (cardId: string) => void;
  onXrStateChange: (state: { vrSupported: boolean; arSupported: boolean; activeMode: 'none' | 'vr' | 'ar' }) => void;
  onStatsUpdate: (stats: { fps: number; loadedSplats: number; activeAssetLabel: string }) => void;
  onDebugLog: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

export interface FareSightSceneEngine {
  init(): Promise<void>;
  destroy(): void;
  resize(): void;
  setScene(mode: SceneMode): Promise<void>;
  setPlaces(places: XRPlaceData[], filteredIds: Set<string>): void;
  setStops(stops: XRStopData[]): void;
  setFilters(filters: XRFilterSummary): void;
  setVoiceState(state: VoiceState): void;
  setReviewCards(cards: readonly BriefingCard[]): void;
  setLiveVehicles(vehicles: XRVehicleData[]): void;
  focusStop(stopId: string): Promise<void>;
  /** Highlight a stop on the map from outside the 3D view (for example the stop list). */
  setHoveredStop(stopId: string | undefined): void;
  /** Highlight and optionally pulse one or more stops on the 3D Boston map. */
  setHighlightedStops(stopIds: string[], pulse?: boolean): void;
  /** Highlight one or more venue pins inside the active station diorama. */
  setHighlightedPlaces(placeIds: string[]): void;
  /** Spotlight a dish row on the 3D physical menu book. */
  setHighlightedDish(dishId: string | undefined): void;
  openVenue(place: XRPlaceData, manifest: XRManifestData | null): Promise<void>;
  openDish(place: XRPlaceData, dish: XRDishData, compareDish?: XRDishData | null, manifest?: XRManifestData | null, comparePlaceName?: string): Promise<void>;
  setWillWeFit(enabled: boolean, groupSize: number, seating: 'seated' | 'standing'): void;
  setDishRotation(angleRad: number): void;
  setPassthroughFallback(useRoomBackdrop: boolean): void;
  orbitCamera(yawDeltaRad: number, pitchDeltaRad: number, zoomFactor?: number): void;
  focusMapStopCamera(stopId: string): void;
  enterVR(): Promise<void>;
  enterAR(): Promise<void>;
  exitXR(): void;
  resetCamera(): void;
}
