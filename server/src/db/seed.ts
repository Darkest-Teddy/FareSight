import { STOPS } from '@faresight/shared';
import type { Asset, Category, CategoryGroup, Dish, Place, Vector3 } from '@faresight/shared';

const demoDate = '2026-11-21';
const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const group: Record<Category, CategoryGroup> = {
  restaurant: 'A', study: 'B', shop: 'B', market: 'B', music: 'C', activity: 'C',
  event_space: 'C', outdoor: 'D', museum: 'D', hotel: 'D', stadium: 'D',
};

type Listing = [
  id: string, name: string, category: Category, lat: number, lon: number, walkMeters: number,
  price: number, open: string, close: string, cravings: string[], vibe: string,
  family: boolean, evening?: boolean,
];

const listings: Listing[][] = [
  [
    ['bu-ramen-01', 'Tsuru Tonkotsu Ramen', 'restaurant', 42.35015, -71.10665, 85, 14.5, '11:30', '22:00', ['ramen', 'katsu', 'noodles'], 'Small ramen counter with table seating along the wall.', true, true],
    ['bu-pavement-01', 'Pavement Coffeehouse', 'study', 42.34985, -71.10721, 50, 9, '07:00', '19:00', ['coffee', 'bagels', 'study'], 'Bagels between lectures and a library nook for reading.', true],
    ['bu-nudpob-01', 'Nud Pob Thai Cuisine', 'restaurant', 42.34986, -71.10731, 60, 17, '11:30', '21:30', ['thai', 'noodles', 'curry'], 'Campus standby for pad see ew and Thai curries.', true, true],
    ['bu-halal-01', 'The Halal Shack at the GSU', 'restaurant', 42.35100, -71.10917, 225, 13, '11:00', '20:00', ['halal', 'rice bowls', 'shawarma'], 'Halal rice bowls and wraps in the George Sherman Union food hall.', true],
    ['bu-beach-01', 'BU Beach', 'outdoor', 42.35117, -71.10557, 180, 0, '06:00', '22:00', ['picnic', 'outdoors', 'river'], 'Grassy campus lawn overlooking the Charles.', true],
    ['bu-grill-01', 'University Grill & Pizza', 'restaurant', 42.34960, -71.10558, 130, 10, '11:00', '22:00', ['pizza', 'subs', 'takeout'], 'Slices and hot subs for a quick campus lunch.', true, true],
  ],
  [
    ['allston-karaoke-01', 'Echo Box Karaoke Lounge', 'event_space', 42.35207, -71.12457, 90, 48, '16:00', '01:00', ['karaoke', 'private room', 'groups'], 'Private karaoke suite with a sofa wall and an open floor.', true, true],
    ['allston-brownsugar-01', 'Brown Sugar Cafe', 'restaurant', 42.35215, -71.12196, 280, 20, '11:30', '22:00', ['thai', 'curry', 'fried rice'], 'Shared Thai plates in a lively dining room.', true, true],
    ['allston-bostongoods-01', 'Boston Goods Clothing Co.', 'shop', 42.35712, -71.13269, 1000, 14, '11:00', '19:00', ['thrift', 'vintage', 'clothing'], 'Secondhand and vintage racks with a buy-by-the-pound section.', true],
    ['allston-super88-01', 'Super 88 Market & Food Court', 'market', 42.35254, -71.12539, 100, 13, '09:00', '21:00', ['dumplings', 'boba', 'groceries'], 'Grocery aisles and a food court for groups with different cravings.', true],
    ['allston-coreanos-01', 'Coreanos', 'restaurant', 42.35297, -71.13302, 720, 16, '12:00', '21:00', ['tacos', 'korean', 'fried chicken'], 'Small Korean-Mexican counter serving kimchi rice and tacos.', true, true],
    ['allston-brightonmusic-01', 'Brighton Music Hall', 'music', 42.35266, -71.13264, 690, 28, '19:00', '23:00', ['live music', 'indie', 'standing room'], 'Standing-room shows with a close view of the stage. Admission varies by event.', false, true],
  ],
  [
    ['kenmore-fenway-01', 'Fenway Park', 'stadium', 42.34646, -71.09710, 380, 38, '10:00', '22:00', ['baseball', 'seat view', 'family outing'], 'Ballpark with a mix of grandstand, box and bleacher seating.', true, true],
    ['kenmore-hob-01', 'House of Blues Boston', 'music', 42.34741, -71.09576, 230, 45, '19:00', '23:00', ['live music', 'balcony', 'concert'], 'Concert hall across from Fenway with a general-admission floor.', false, true],
    ['kenmore-jefes-01', "El Jefe's Taqueria", 'restaurant', 42.34926, -71.09680, 160, 12, '10:00', '04:00', ['tacos', 'burritos', 'late night'], 'Build-your-own tacos and burritos before or after a game.', true, true],
    ['kenmore-eastern-01', 'Eastern Standard Kitchen and Drinks', 'restaurant', 42.34722, -71.10131, 660, 34, '16:00', '23:00', ['brasserie', 'burgers', 'dinner'], 'Brasserie booths and a long bar near Fenway.', true, true],
    ['kenmore-esplanade-01', 'Charles River Esplanade', 'outdoor', 42.35096, -71.09561, 610, 0, '06:00', '22:00', ['river walk', 'picnic', 'sunset'], 'Riverside paths with a view across the Charles toward Cambridge.', true],
  ],
  [
    ['harvard-cafe-01', 'Charles & Folio Study Café', 'study', 42.37364, -71.11832, 120, 9.25, '08:00', '20:00', ['matcha', 'tiramisu', 'study'], 'Window seats and long tables for a study break.', true],
    ['harvard-bookstore-01', 'Harvard Book Store', 'shop', 42.37254, -71.11636, 250, 18, '10:00', '21:00', ['used books', 'bookshop', 'gifts'], 'Independent bookshop with used books downstairs.', true],
    ['harvard-felipes-01', "Felipe's Taqueria", 'restaurant', 42.37347, -71.12051, 180, 14, '11:00', '23:00', ['tacos', 'burritos', 'rooftop'], 'Counter-service burritos and a seasonal rooftop.', true, true],
    ['harvard-tatte-01', 'Tatte Bakery & Cafe', 'study', 42.37267, -71.11686, 200, 15, '07:00', '20:00', ['bakery', 'coffee', 'shakshuka'], 'Coffee, pastries and café lunches near the Yard.', true],
    ['harvard-art-01', 'Harvard Art Museums', 'museum', 42.37410, -71.11411, 510, 0, '10:00', '17:00', ['art', 'museum', 'family outing'], 'Free galleries organized around the Calderwood Courtyard.', true],
  ],
  [
    ['chinatown-heila-01', 'Hei La Moon', 'restaurant', 42.35241, -71.06021, 250, 24, '09:00', '21:00', ['dim sum', 'dumplings', 'family meal'], 'Cantonese dining room with dim sum and dishes to share.', true, true],
    ['chinatown-winsor-01', 'Winsor Dim Sum Café', 'restaurant', 42.35099, -71.06054, 270, 17, '09:00', '21:00', ['dim sum', 'dumplings', 'rice rolls'], 'Compact café with dim sum ordered from a menu.', true, true],
    ['chinatown-genes-01', "Gene's Chinese Flatbread Cafe", 'restaurant', 42.35344, -71.05959, 330, 14, '11:00', '18:30', ['hand-pulled noodles', 'cumin', 'flatbread'], 'Counter seats for chewy hand-pulled noodles and cumin lamb.', true],
    ['chinatown-hoyuen-01', 'Ho Yuen Bakery', 'restaurant', 42.35148, -71.06060, 250, 5, '08:00', '18:00', ['bakery', 'egg tarts', 'buns'], 'Takeaway buns and egg tarts on Beach Street.', true],
    ['chinatown-q-01', 'The Q', 'restaurant', 42.35171, -71.06261, 95, 38, '12:00', '00:00', ['hot pot', 'late night', 'groups'], 'Tabletop hot pot near the theater district.', true, true],
    ['chinatown-taiwan-01', 'Taiwan Café', 'restaurant', 42.35147, -71.06026, 270, 19, '11:30', '22:00', ['taiwanese', 'soup dumplings', 'rice'], 'Taiwanese comfort food and shareable plates on Oxford Street.', true, true],
  ],
];

export const places: Place[] = listings.flatMap((entries, stopIndex) => entries.map((listing, pin_index) => {
  const [id, name, category, lat, lon, walk_from_stop_m, typical_price, open, close, cravings, vibe, family_friendly, evening_venue = false] = listing;
  return {
    id, name, category, category_group: group[category], lat, lon, stop_id: STOPS[stopIndex].stop_id,
    pin_index, walk_from_stop_m, cravings, typical_price, price_checked_on: '',
    hours: Object.fromEntries(days.map((day): [string, [string, string]] => [day, [open, close]])),
    vibe, family_friendly, evening_venue, seed_status: 'planning_estimate',
    photos: [], room_asset_id: null, dishes: [], rooms: [], seat_views: [], reviews: [],
  };
}));

const byId = (id: string) => places.find((place) => place.id === id)!;
const pavement = byId('bu-pavement-01');
pavement.hours.sat = ['07:00', '14:00'];
pavement.hours.sun = ['07:00', '14:00'];
delete byId('harvard-art-01').hours.mon;

export const demoAssets: Asset[] = [];

function addDemoAsset(input: Pick<Asset, 'id' | 'kind' | 'scale_status' | 'scale_label'> & {
  file: string;
  spawn_point?: Vector3;
  plate_diameter_m?: number;
}): Asset {
  const { file, ...fields } = input;
  const url = `/assets-demo/${file}`;
  const asset: Asset = {
    ...fields, format: 'ply', url, original_ply_url: url, captured_on: demoDate,
    gaussian_count: 0, scale_factor: 1, status: 'ready', source_photos: [],
    backend: 'prebuilt-demo',
    provenance: 'demo_splat',
    provenance_label: input.kind === 'room' ? 'Procedural demo room splat' : 'Prebuilt demo dish splat',
  };
  demoAssets.push(asset);
  return asset;
}

function flagship(id: string, roomFile: string, spawn_point: Vector3, measured = false): Place {
  const place = byId(id);
  place.seed_status = 'demo_venue';
  place.price_checked_on = demoDate;
  place.room_asset_id = addDemoAsset({
    id: `${id}-room`, kind: 'room', file: roomFile, spawn_point,
    scale_status: measured ? 'measured' : 'approximate',
    scale_label: measured ? 'Actual size (4.2 m × 3.4 m)' : 'Approximate size',
  }).id;
  return place;
}

function addDish(place: Place, id: string, name: string, price: number, diameter: number, file: string, vessel: string, portion_note: string) {
  const plate_diameter_m = diameter;
  const asset = addDemoAsset({
    id: `${id}-splat`, kind: 'dish', file, plate_diameter_m, scale_status: 'measured',
    scale_label: `Actual size (${Math.round(diameter * 100)} cm ${vessel})`,
  });
  const dish: Dish = { id, place_id: place.id, name, price, plate_diameter_m, portion_note, asset_id: asset.id };
  place.dishes.push(dish);
}

const ramen = flagship('bu-ramen-01', 'room-ramen-house.ply', [0, 1.55, 2]);
addDish(ramen, 'bu-ramen-tonkotsu', 'Signature Tonkotsu Ramen', 14.5, 0.24, 'dish-tonkotsu-ramen.ply', 'bowl', 'One 24 cm bowl with pork, noodles and egg.');
addDish(ramen, 'bu-ramen-katsu', 'Crispy Pork Katsu Curry', 15.75, 0.26, 'dish-katsu-curry.ply', 'plate', 'One cutlet with rice and curry on a 26 cm plate.');

const karaoke = flagship('allston-karaoke-01', 'room-karaoke-suite.ply', [0, 1.55, 2], true);
karaoke.stated_capacity = 14;
karaoke.rooms = (['seated', 'standing'] as const).map((seating) => ({
  id: `echo-box-${seating}`, place_id: karaoke.id, name: `Private suite (${seating})`,
  room_type: 'karaoke', stated_capacity: 14, floor_width_m: 4.2, floor_depth_m: 3.4,
  seating, price: 48, price_unit: 'hour', asset_id: karaoke.room_asset_id,
}));

const cafe = flagship('harvard-cafe-01', 'room-study-cafe.ply', [0, 1.55, 2.1]);
addDish(cafe, 'harvard-matcha-tiramisu', 'Ceremonial Matcha Tiramisu + Latte', 9.25, 0.18,
  'dish-matcha-tiramisu.ply', 'plate', 'One slice of matcha tiramisu and a latte.');

byId('kenmore-fenway-01').seat_views = [{
  id: 'fenway-seat-demo', place_id: 'kenmore-fenway-01', section: 'Grandstand 18',
  row: '6', seat_label: 'Demo seat 8', captured_on: '', asset_id: null,
}];
byId('kenmore-hob-01').seat_views = [{
  id: 'hob-seat-demo', place_id: 'kenmore-hob-01', section: 'Mezzanine',
  row: 'Front rail', seat_label: 'Demo rail view', captured_on: '', asset_id: null,
}];
