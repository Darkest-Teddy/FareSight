export type Category =
  | 'restaurant' | 'study' | 'music' | 'activity' | 'shop' | 'market'
  | 'outdoor' | 'museum' | 'event_space' | 'hotel' | 'stadium';
export type CategoryGroup = 'A' | 'B' | 'C' | 'D';
export type Vector3 = [number, number, number];

export interface Stop {
  stop_id: string;
  name: string;
  area_code: string;
  lat: number;
  lon: number;
  lines: string[];
  primary_color: string;
  segment_asset: string;
}

export interface Place {
  id: string;
  name: string;
  category: Category;
  category_group: CategoryGroup;
  cravings: string[];
  lat: number;
  lon: number;
  stop_id: string;
  pin_index: number;
  walk_from_stop_m: number;
  typical_price: number;
  price_checked_on: string;
  hours: Record<string, [string, string]>;
  vibe: string;
  photos: string[];
  family_friendly: boolean;
  evening_venue: boolean;
  stated_capacity?: number;
  room_asset_id?: string | null;
  dishes: Dish[];
  rooms: Room[];
  seat_views: SeatView[];
  reviews: Review[];
  seed_status?: 'demo_venue' | 'planning_estimate';
  details?: PlaceDetails;
}

/** Researched public facts about a real venue, with sources. */
export interface PlaceDetails {
  checked_on: string;
  address: string | null;
  website: string | null;
  phone: string | null;
  /** False when no reliable published schedule was found and `hours` are planning estimates. */
  hours_verified: boolean;
  hours_note: string | null;
  hours_source: string | null;
  awards: PlaceAward[];
  ratings: PlaceRating[];
  review_highlights: string[];
  review_sources: string[];
}

export interface PlaceAward {
  title: string;
  org: string;
  year: number | null;
  url: string | null;
}

export interface PlaceRating {
  source: string;
  rating: number;
  count: number | null;
  url: string | null;
}

export interface Dish {
  id: string;
  place_id: string;
  name: string;
  price: number | null;
  portion_note: string;
  plate_diameter_m?: number;
  asset_id?: string | null;
  asset?: Asset | null;
}

export interface Room {
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
  asset?: Asset | null;
}

export interface SeatView {
  id: string;
  place_id: string;
  section: string;
  row: string;
  seat_label: string;
  captured_on: string;
  asset_id?: string | null;
}

export interface Review {
  id: string;
  rating: number;
  text: string;
  author: string;
  sample?: boolean;
  created_at: string;
}

export interface Asset {
  id: string;
  kind: 'room' | 'dish' | 'seat_view' | 'photo_gallery';
  provenance: 'ai_spatial_preview' | 'trellis_dish_splat' | 'demo_splat' | 'photo_gallery';
  provenance_label: string;
  backend: string;
  scale_status: 'measured' | 'approximate' | 'unknown';
  scale_label: string;
  scale_factor: number;
  plate_diameter_m?: number | null;
  gaussian_count: number;
  format: 'sog' | 'ply' | 'spz' | 'gallery';
  url: string;
  original_ply_url?: string | null;
  original_spz_url?: string | null;
  thumbnail_url?: string | null;
  preview_url?: string | null;
  spawn_point?: Vector3 | null;
  transform?: { position: Vector3; rotation: Vector3; scale: number } | null;
  source_photos: string[];
  captured_on: string;
  status: 'needs_review' | 'pending_review' | 'ready' | 'rejected';
  metadata?: {
    bounds?: { min: Vector3; max: Vector3 };
    measured_width?: number;
    target_gaussians?: number;
    splat_transform_command?: string;
    conversion_status?: 'compressed' | 'ply_fallback' | 'spz_fallback';
  };
}

export type JobStage = 'queued' | 'generating' | 'downloading' | 'converting' | 'needs_review' | 'ready' | 'failed';
export const ROOM_MODEL_TIERS = ['atlas-draft', 'atlas-refined'] as const;
export type RoomModelTier = typeof ROOM_MODEL_TIERS[number];
export type MarbleTier = RoomModelTier;
export const MAX_ROOM_PHOTOS = 32;
export const ROOM_PHOTO_REQUIREMENT = 'Atlas room reconstruction requires 2 to 32 overlapping photos.';

export interface GenerationJob {
  id: string;
  kind: 'room' | 'dish';
  place_id: string;
  dish_id?: string | null;
  dish_name?: string | null;
  status: JobStage;
  provider: 'atlas-v2' | 'trellis-replicate' | 'demo-sim';
  pose_operation_id?: string | null;
  provider_task_id?: string | null;
  input_upload_ids: string[];
  plate_diameter_m?: number | null;
  model_tier?: RoomModelTier;
  progress: number;
  status_message: string;
  error?: string | null;
  original_ply_path?: string | null;
  original_spz_path?: string | null;
  converted_asset_path?: string | null;
  preview_image_path?: string | null;
  asset_id?: string | null;
  created_at: string;
  updated_at: string;
}

export type UploadCategory = 'interior' | 'food' | 'menu' | 'exterior' | 'obstructed' | 'other';

export interface IntakeSelectionResult {
  restaurant_id: string;
  room_groups: {
    group_id: string;
    label: string;
    upload_ids: string[];
    confidence: number;
    reason: string;
  }[];
  recommended_room_upload_ids: string[];
  recommended_dish_upload_id: string | null;
  flagged: { upload_id: string; category: UploadCategory; reason: string }[];
  used_model: string;
  manual_override_allowed: true;
}

export interface RestaurantManifest {
  restaurant: Pick<Place, 'id' | 'name' | 'stop_id' | 'vibe' | 'typical_price' | 'price_checked_on'>;
  room_asset: Asset | null;
  spawn_point: Vector3;
  menu_items: { dish: Dish; dish_asset: Asset | null }[];
  rooms: Room[];
  source_photos: string[];
  generation_label: string;
  scale_label: string;
  updated_at: string;
}

export type MbtaSource = 'live' | 'simulated';
export interface MbtaVehicle {
  id: string;
  route_id: string;
  trip_id: string | null;
  stop_id: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
  direction_id: number;
  current_status: string;
  updated_at: string;
}
export interface MbtaPrediction {
  id: string;
  route_id: string;
  stop_id: string;
  trip_id: string | null;
  direction_id: number;
  arrival_time: string | null;
  departure_time: string | null;
  headsign: string | null;
  status: string | null;
  last_trip: boolean;
}
export interface MbtaAlert {
  id: string;
  header: string;
  description: string | null;
  severity: number;
  effect: string;
  route_ids: string[];
  stop_ids: string[];
  url: string | null;
}

export interface TripEstimate {
  from_stop_id: string;
  to_stop_id: string;
  route_id: string | null;
  transfer_station: string | null;
  transfers: number;
  walk_to_station_min: number;
  wait_min: number;
  ride_min: number;
  transfer_min: number;
  walk_to_venue_min: number;
  total_min: number;
  fare: number;
  round_trip_fare: number;
  planner_url: string;
  prediction_source?: MbtaSource | 'estimate';
  last_train_time?: string | null;
  schedule_source?: MbtaSource;
}

export interface FilterState {
  categories?: Category[];
  category_groups?: CategoryGroup[];
  cravings?: string[];
  max_price?: number | null;
  max_trip_min?: number | null;
  family_friendly?: boolean;
  evening_only?: boolean;
  stop_id?: string | null;
}

export type PairingMessage =
  | { type: 'open_place'; place_id: string }
  | { type: 'open_dish'; place_id: string; dish_id: string }
  | { type: 'send_trip'; trip: TripEstimate }
  | { type: 'sync_filters'; filters: FilterState }
  | { type: 'peer_joined'; peers: number };
