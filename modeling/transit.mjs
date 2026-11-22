import { readFileSync, writeFileSync } from 'node:fs';
import {
  Model,
  box,
  face,
  loft,
  circle,
  rect,
  sweep,
  spline,
  norm,
  rng,
  sub,
  mix,
  mul,
  add,
  rgb,
  cross,
} from './geometry.mjs';
import { cityBlocks } from './city.mjs';
import { groundPlate } from './ground.mjs';

// ---------------------------------------------------------------------------------------------
// Colour of the map sculpture. The model sits on a light, warm backdrop, so the hierarchy runs
// the opposite way to a glowing map on black: the tracks are the darkest, most saturated things
// on the plate, the city is pale, and nothing lights itself. Geometry is decided further down;
// everything that sets a tone is collected here (and in ground.mjs and city.mjs for the plate,
// the shadows and the blocks).
// ---------------------------------------------------------------------------------------------

/** Ink for the keylines round stations. The same near-black as the contact shadows. */
const INK = '#22252B';

/** The white of a station bead. */
const BEAD_WHITE = '#f4f6fa';

/**
 * The casing: a darker keyline down both sides of every track plate, as on a printed transit map.
 * It is what holds a line's edge against a pale ground, and orange needs it most -- true MBTA
 * orange is only 2.2:1 against cream. Keyed by the line's official colour; a line that is not
 * listed gets its own colour taken CASING_DARKNESS of the way to black.
 */
const CASING = {
  '#00843D': '#005C2B',
  '#DA291C': '#9E1B12',
  '#ED8B00': '#9A5200',
  '#003DA5': '#002A73',
};
const CASING_DARKNESS = 0.34;
/** How far the casing shows beyond each side of the plate, and how far below its top it sits. */
const casingOverhang = 0.0012;
const casingDrop = 0.0004;

/**
 * How much of its own colour a track plate and a station centre give off unlit, as a share of the
 * line colour. Small on purpose: it is not a glow, it only keeps the colour from going muddy on
 * the side turned away from the key light.
 */
const LACQUER_GLOW = 0.2;
const ENAMEL_GLOW = 0.2;
/** Self-light on the white station bodies. Their ink rings share the material, so nearly none. */
const MARKER_GLOW = '#0b0c0e';

/** Width of the ink ring round an ordinary bead, and how far its outer edge dips. */
const beadInkWidth = 0.0012;
const beadInkDip = 0.0005;

/**
 * Landmarks, in the same slate as the city but a step darker and bluer than the blocks round
 * them, so the Prudential still reads as the Prudential without lighting itself.
 */
const LANDMARK = {
  post: '#73809A',
  plinth: '#8A96AF',
  shaft: '#98A5BE',
  tower: '#8F9CB8',
  glassTower: '#8499BE',
  granite: '#AAB4C8',
  graniteTip: '#BFC8D9',
  crown: '#B9C6DC',
};

// Station coordinate snapshot from api-v3.mbta.com/stops, parent stations only.
const stops = JSON.parse(readFileSync(new URL('stops.json', import.meta.url)));
export const focal = [
  [
    'place-bucen',
    'Boston University Central',
    'BU Central',
    '001',
    'Green-B',
    '#00843D',
    0.261,
  ],
  [
    'place-brico',
    "Packard's Corner",
    "Packard's Corner",
    '002',
    'Green-B',
    '#00843D',
    0.268,
  ],
  ['place-kencl', 'Kenmore', 'Kenmore', '003', 'Green-B', '#00843D', 0.208],
  ['place-harsq', 'Harvard', 'Harvard', '004', 'Red', '#DA291C', 0.167],
  ['place-chncl', 'Chinatown', 'Chinatown', '005', 'Orange', '#ED8B00', 0.137],
];
export const project = (lat, lon, y) => [
  ((lon + 71.095) * 111320 * Math.cos((42.354 * Math.PI) / 180)) / 6500,
  y,
  (-(lat - 42.354) * 110540) / 6500,
];
const join = (text) =>
  text.split('|').map((s) => {
    const [name, y] = s.split('@');
    return [name, Number(y)];
  });
export const routes = [
  [
    'green-b',
    'Green-B',
    'Green Line B',
    '#00843D',
    '#38E08A',
    join(
      "Boston College@.265|South Street@.265|Chestnut Hill Avenue@.26|Chiswick Road@.263|Sutherland Road@.267|Washington Street@.267|Warren Street@.265|Allston Street@.267|Griggs Street@.27|Harvard Avenue@.267|Packard's Corner@.268|Babcock Street@.268|Amory Street@.265|Boston University Central@.261|Boston University East@.256|Blandford Street@.249|Kenmore@.208|Hynes Convention Center@.193|Copley@.189|Arlington@.183|Boylston@.176|Park Street@.174|Government Center@.182|Haymarket@.193|North Station@.204|Science Park/West End@.274|Lechmere@.282",
    ),
  ],
  [
    'green-c',
    'Green-C',
    'Green Line C',
    '#00843D',
    '#38E08A',
    join(
      "Cleveland Circle@.256|Englewood Avenue@.256|Dean Road@.255|Tappan Street@.258|Washington Square@.261|Fairbanks Street@.262|Brandon Hall@.263|Summit Avenue@.263|Coolidge Corner@.26|Saint Paul Street@.258|Kent Street@.257|Hawes Street@.254|Saint Mary's Street@.249|Kenmore@.208",
    ),
  ],
  [
    'green-d',
    'Green-D',
    'Green Line D',
    '#00843D',
    '#38E08A',
    join(
      'Chestnut Hill@.25|Reservoir@.25|Beaconsfield@.253|Brookline Hills@.253|Brookline Village@.245|Longwood@.254|Fenway@.247|Kenmore@.208',
    ),
  ],
  [
    'green-e',
    'Green-E',
    'Green Line E',
    '#00843D',
    '#38E08A',
    join(
      'Heath Street@.258|Back of the Hill@.257|Riverway@.256|Mission Park@.256|Fenwood Road@.255|Brigham Circle@.255|Longwood Medical Area@.253|Museum of Fine Arts@.251|Northeastern University@.248|Symphony@.207|Prudential@.194|Copley@.189',
    ),
  ],
  [
    'red',
    'Red',
    'Red Line',
    '#DA291C',
    '#FF5A4E',
    [
      ...join(
        'Alewife@.169|Davis@.164|Porter@.143|Harvard@.167|Central@.151|Kendall/MIT@.174',
      ),
      [[42.36155, -71.08055], 0.25],
      [[42.36148, -71.07562], 0.285],
      ...join(
        'Charles/MGH@.269|Park Street@.101|Downtown Crossing@.103|South Station@.119|Broadway@.137|Andrew@.16|JFK/UMass@.188',
      ),
    ],
  ],
  [
    'orange',
    'Orange',
    'Orange Line',
    '#ED8B00',
    '#FFB03B',
    [
      ...join('Assembly@.204|Sullivan Square@.204|Community College@.196'),
      [[42.36934, -71.06405], 0.13],
      ...join(
        'North Station@.15|Haymarket@.144|State@.138|Downtown Crossing@.139|Chinatown@.137|Tufts Medical Center@.145|Back Bay@.162|Massachusetts Avenue@.178|Ruggles@.193|Roxbury Crossing@.203|Jackson Square@.205|Stony Brook@.208',
      ),
    ],
  ],
  [
    'blue',
    'Blue',
    'Blue Line',
    '#003DA5',
    '#4A90FF',
    [
      ...join('Bowdoin@.161|Government Center@.144|State@.112|Aquarium@.121'),
      [[42.36337, -71.0456], 0.082],
      ...join('Maverick@.123|Airport@.177'),
    ],
  ],
];
export const json = (file, data) =>
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
function clipToFootprint(points) {
  // Leave room for the radius of each rounded terminus.
  const out = [],
    limits = [0.738, Infinity, 0.513];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    let lo = 0,
      hi = 1;
    for (const k of [0, 2]) {
      const delta = b[k] - a[k],
        v = limits[k];
      if (Math.abs(delta) < 1e-12) {
        if (Math.abs(a[k]) > v) hi = -1;
        continue;
      }
      const t = (-v - a[k]) / delta,
        u = (v - a[k]) / delta;
      lo = Math.max(lo, Math.min(t, u));
      hi = Math.min(hi, Math.max(t, u));
    }
    if (hi <= lo) continue;
    if (!out.length || lo > 0) out.push(lo === 0 ? a : mix(a, b, lo));
    out.push(hi === 1 ? b : mix(a, b, hi));
  }
  return out.map((p) => p.map(Math.fround));
}

// Track plates. The network reads as flat roads rather than cylindrical tubes: a wide, thin
// ribbon following the path, with just enough thickness that its edges catch light and the shape
// is unmistakably 3D instead of painted on.
//
// Each cross-section is a rectangle carried along the path, lofted to the next. Corner order is
// [+side bottom, +side top, -side top, -side bottom], which makes loft() emit outward normals for
// the two walls and the top without any extra bookkeeping.
function flatTrack(surface, points, halfWidth, thickness, color = '#ffffff') {
  const half = thickness / 2;
  const rings = points.map((point, i) => {
    const tangent = norm(
      sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]),
    );
    // Horizontal perpendicular: the plate stays level no matter how the path climbs.
    const side = norm([-tangent[2], 0, tangent[0]]).map((n) => n * halfWidth);
    const [x, y, z] = point;
    return [
      [x + side[0], y - half, z + side[2]],
      [x + side[0], y + half, z + side[2]],
      [x - side[0], y + half, z - side[2]],
      [x - side[0], y - half, z - side[2]],
    ];
  });
  loft(surface, rings, color);
}

/** A face wound so that it looks toward `toward`, whichever order its corners were given in. */
function faceToward(surface, pts, toward, color) {
  const n = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  const facing = n[0] * toward[0] + n[1] * toward[1] + n[2] * toward[2];
  face(surface, facing < 0 ? [...pts].reverse() : pts, color);
}

// The casing of a track plate: a flange a little wider than the plate and a hair below its top,
// with a wall down its outer edge. From above it is a dark line either side of the colour; from
// the side it is the plate's dark edge. Only the parts that can be seen are built -- the two
// flanges and the two outer walls -- and the ends are wrapped so a terminus is cased as well.
//
// It goes in the plate's own surface and is coloured by vertex colour, so it costs no draw call
// and whatever the runtime does to a line's material (dimming the lines not in focus) takes the
// casing with it.
function trackCasing(surface, points, halfWidth, thickness, tint) {
  const half = thickness / 2;
  const frames = points.map((point, i) => {
    const tangent = norm(
      sub(points[Math.min(i + 1, points.length - 1)], points[Math.max(i - 1, 0)]),
    );
    return { point, along: norm([tangent[0], 0, tangent[2]]), side: norm([-tangent[2], 0, tangent[0]]) };
  });
  // One extra frame beyond each end, so the casing runs round the terminus.
  const beyond = (frame, sign) => ({
    ...frame,
    point: add(frame.point, mul(frame.along, sign * casingOverhang)),
    end: true,
  });
  const run = [beyond(frames[0], -1), ...frames, beyond(frames.at(-1), 1)];
  const rows = run.map(({ point, side }) => {
    const top = point[1] + half - casingDrop;
    const bottom = point[1] - half;
    const at = (reach, y) => [point[0] + side[0] * reach, y, point[2] + side[2] * reach];
    return [-1, 1].map((hand) => ({
      inner: at(hand * halfWidth, top),
      outer: at(hand * (halfWidth + casingOverhang), top),
      foot: at(hand * (halfWidth + casingOverhang), bottom),
    }));
  });
  const up = [0, 1, 0];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    const cap = run[i - 1].end || run[i].end;
    // Past the end of the plate there is nothing in the middle, so the flange spans the full width.
    if (cap) faceToward(surface, [a[0].outer, a[1].outer, b[1].outer, b[0].outer], up, tint);
    for (const hand of [0, 1]) {
      const outward = mul(run[i].side, hand ? 1 : -1);
      if (!cap) faceToward(surface, [a[hand].inner, a[hand].outer, b[hand].outer, b[hand].inner], up, tint);
      faceToward(surface, [a[hand].outer, a[hand].foot, b[hand].foot, b[hand].outer], outward, tint);
    }
  }
  for (const [row, frame, sign] of [
    [rows[0], run[0], -1],
    [rows.at(-1), run.at(-1), 1],
  ])
    faceToward(surface, [row[0].outer, row[1].outer, row[1].foot, row[0].foot], mul(frame.along, sign), tint);
}

// Sculpture layout: the network floats in three shallow layers, with no deck beneath it.
const slabTop = 0.04;
/**
 * Half-width of a track plate. Thin: the lines are the diagram, and the station dots have to read
 * as clearly larger than the line they sit on.
 */
const trackHalfWidth = 0.0042;
/** Plate thickness. Small, but never zero: this is the "flat with a little depth" brief. */
const trackThickness = 0.0028;
// The layers exist only so lines sharing a corridor never z-fight; they are not meant to lift the
// network off the city. At the old spacing the Red and Blue lines sat 0.035 above the building
// bases -- as tall as a twenty-storey tower -- so the whole network read as floating above Boston
// rather than running through it. These steps are just enough to separate the layers.
const layerBase = slabTop + 0.0015;
const layerStep = 0.0035;
const layerOf = { Orange: 0, Green: 1, Red: 2, Blue: 2 };
const puckRise = 0.0075;
const tubeHeight = (routeId) =>
  layerBase + layerStep * layerOf[routeId.split('-')[0]];

const mixHex = (a, b, t) =>
  '#' +
  [1, 3, 5]
    .map((i) => {
      const u = parseInt(a.slice(i, i + 2), 16),
        v = parseInt(b.slice(i, i + 2), 16);
      return Math.round(u + (v - u) * t)
        .toString(16)
        .padStart(2, '0');
    })
    .join('');

/**
 * The vertex colour that turns a material of colour `base` into `target`. Vertex colour multiplies
 * the material's base colour in linear light, so this is their ratio channel by channel; where the
 * base has none of a channel the ratio is undefined and the average of the others stands in.
 */
function tintToward(base, target) {
  const linear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const encode = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);
  const from = rgb(base).map(linear);
  const to = rgb(target).map(linear);
  const ratios = from.map((v, i) => (v > 1e-4 ? Math.min(1, to[i] / v) : null));
  const known = ratios.filter((r) => r !== null);
  const fallback = known.reduce((n, r) => n + r, 0) / (known.length || 1);
  return (
    '#' +
    ratios
      .map((r) =>
        Math.round(encode(r ?? fallback) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

function drum(surface, [x, , z], bottom, top, radius, color, sides = 14) {
  loft(
    surface,
    [circle(x, bottom, z, radius, sides), circle(x, top, z, radius, sides)],
    color,
    { bottom: false },
  );
}

/**
 * A handful of iconic Boston landmarks, placed by real coordinates at the sculpture's own scale
 * (6500 m per unit). Deliberately a short list of silhouettes people recognise rather than an
 * attempt at a city: the network is still the subject, and these just give it somewhere to be.
 *
 * Heights are real metres. At this scale a 230 m tower is ~0.035 units — about three track layers
 * tall, which is enough to read without competing with the lines.
 */
const METRES = 1 / 6500;
/**
 * True scale makes landmarks invisible: the Prudential is 229 m, which at 6500 m per unit is
 * 0.035 units — about three track plates tall and lost against the background. Cartographic
 * models routinely exaggerate vertical scale for exactly this reason, so landmarks are drawn
 * 2.6x their real height. Footprints stay true, so each still reads as the right shape.
 */
const landmarkLift = 2.6;
/**
 * Footprints need the same treatment. A 64 m tower is 0.0098 units wide — narrower than a track
 * plate (0.015), which is why true-scale landmarks read as slivers rather than buildings. Widened
 * so they sit sensibly against the network they stand beside.
 */
const landmarkWidth = 3.2;
const landmarkList = [
  // name,                  lat,      lon,       w,  d,   height(m), form
  ['Prudential Tower',      42.34725, -71.08215, 64, 64,  229, 'taper'],
  ['200 Clarendon',         42.34880, -71.07513, 58, 32,  241, 'slab'],
  ['Custom House Tower',    42.35940, -71.05360, 32, 32,  151, 'clock'],
  ['Bunker Hill Monument',  42.37635, -71.06082, 15, 15,   67, 'obelisk'],
  ['Citgo Sign',            42.34875, -71.09540, 26, 10,   58, 'sign'],
];

function landmarks(surface, accent, ground) {
  for (const [, lat, lon, w, d, metres, form] of landmarkList) {
    const [x, , z] = project(lat, lon, 0);
    const base = slabTop;
    const h = metres * METRES * landmarkLift;
    const width = w * METRES * landmarkWidth;
    const depth = d * METRES * landmarkWidth;
    // Every landmark stands in a contact shadow the shape of its own foot.
    const foot = (fw, fd) => ground.footprintShadow(rect(x, 0, z, fw, fd).map((p) => [p[0], p[2]]));

    if (form === 'sign') {
      // A billboard on a slim gantry: unmistakable at Kenmore, and cheap.
      const postH = h * 0.45;
      box(surface, x, base + postH / 2, z, 0.0012, postH, 0.0012, LANDMARK.post);
      box(accent, x, base + postH + (h - postH) / 2, z, width, h - postH, 0.0015, LANDMARK.crown);
      continue;
    }

    if (form === 'obelisk') {
      // Square shaft tapering to a pyramidion.
      loft(surface, [
        rect(x, base, z, width, depth),
        rect(x, base + h * 0.88, z, width * 0.62, depth * 0.62),
      ], LANDMARK.granite);
      loft(surface, [
        rect(x, base + h * 0.88, z, width * 0.62, depth * 0.62),
        rect(x, base + h, z, width * 0.06, depth * 0.06),
      ], LANDMARK.graniteTip);
      foot(width, depth);
      continue;
    }

    if (form === 'clock') {
      // Stepped base, shaft, then a lighter crown that reads as the clock stage.
      const shaft = h * 0.68;
      box(surface, x, base + shaft * 0.18, z, width * 1.5, shaft * 0.36, depth * 1.5, LANDMARK.plinth);
      loft(surface, [
        rect(x, base + shaft * 0.36, z, width, depth),
        rect(x, base + shaft, z, width * 0.86, depth * 0.86),
      ], LANDMARK.shaft);
      box(accent, x, base + shaft + (h - shaft) * 0.4, z, width * 0.74, (h - shaft) * 0.8, depth * 0.74, LANDMARK.crown);
      foot(width * 1.5, depth * 1.5);
      continue;
    }

    if (form === 'taper') {
      loft(surface, [
        rect(x, base, z, width, depth),
        rect(x, base + h, z, width * 0.78, depth * 0.78),
      ], LANDMARK.tower);
      foot(width, depth);
      continue;
    }

    // slab: a plain rectangular prism, the Hancock read.
    box(surface, x, base + h / 2, z, width, h, depth, LANDMARK.glassTower);
    foot(width, depth);
  }
}

/**
 * A station bead: a white disc with the line's colour inset on top and an ink ring round it.
 *
 * Both discs are raised clear of the plate so neither z-fights with it, and the white ring is
 * wider than the plate itself, which is what makes a stop legible at map scale. The bead overhangs
 * the track, and white on a pale ground has no edge, so a thin ink collar runs round the rim: it
 * dips slightly outward, which shows it from every side and hides the white wall beneath it.
 */
const dotOuter = 0.0068;
const dotInner = 0.0042;

function stationDot(white, colour, [x, , z], deck) {
  const base = deck + 0.0004;
  const lip = base + 0.0014;
  // White body.
  loft(white, [circle(x, base, z, dotOuter, 20), circle(x, lip, z, dotOuter, 20)], BEAD_WHITE, {
    bottom: false,
    top: false,
  });
  // The white rim left showing around the coloured centre.
  const outer = circle(x, lip, z, dotOuter, 20);
  const inner = circle(x, lip, z, dotInner, 20);
  for (let j = 0; j < 20; j++) {
    const k = (j + 1) % 20;
    face(white, [outer[j], inner[j], inner[k], outer[k]], BEAD_WHITE);
  }
  // Coloured cap, a hair proud of the white so it never z-fights. The enamel material carries the
  // line colour, so the cap itself is left untinted.
  const cap = lip + 0.0003;
  loft(colour, [circle(x, lip, z, dotInner, 20), circle(x, cap, z, dotInner, 20)], '#ffffff', {
    bottom: false,
  });
  // Ink collar.
  const brim = circle(x, lip - 0.0002, z, dotOuter, 20);
  const edge = circle(x, lip - 0.0002 - beadInkDip, z, dotOuter + beadInkWidth, 20);
  for (let j = 0; j < 20; j++) {
    const k = (j + 1) % 20;
    face(white, [edge[j], brim[j], brim[k], edge[k]], INK);
  }
}

// Center and half-width of the Charles, from the Allston bend to the harbor mouth.
export const riverBanks = [
  [-0.739, -0.058, 0.028],
  [-0.63, -0.083, 0.036],
  [-0.537, -0.166, 0.032],
  [-0.535, -0.268, 0.033],
  [-0.459, -0.334, 0.028],
  [-0.355, -0.309, 0.029],
  [-0.298, -0.253, 0.027],
  [-0.266, -0.191, 0.029],
  [-0.276, -0.12, 0.03],
  [-0.234, -0.064, 0.03],
  [-0.165, -0.032, 0.026],
  [-0.066, -0.014, 0.036],
  [0.055, -0.033, 0.047],
  [0.188, -0.084, 0.052],
  [0.246, -0.145, 0.048],
  [0.274, -0.196, 0.042],
  [0.309, -0.235, 0.03],
  [0.368, -0.258, 0.031],
  [0.428, -0.29, 0.035],
  [0.506, -0.302, 0.057],
  [0.578, -0.27, 0.092],
  [0.625, -0.179, 0.105],
  [0.65, -0.065, 0.088],
  [0.678, 0.038, 0.065],
  [0.726, 0.112, 0.037],
];
export function mapSculpture(dir) {
  const m = new Model();
  const batch = (name, options) => m.surface(m.material(name, options));
  // The plate is the one translucent surface. Its colour and opacity are in its vertex colours;
  // the material is plain white and only says "blend me".
  const plate = batch('Ground plate', { rough: 0.9, metal: 0, blend: true });
  const city = batch('City blocks', { rough: 0.74, metal: 0.05 });
  const marker = batch('Station markers', { rough: 0.55, emission: MARKER_GLOW });
  const stone = batch('Landmark stone', { rough: 0.68, metal: 0.06 });
  const glint = batch('Landmark glass', { rough: 0.22, metal: 0.35 });

  // No deck. The brief is a floating network: track plates, stations and a few landmarks, with
  // nothing underneath them but a sheet of gray glass. The slab, its trim, the inlaid street grid
  // and the Charles were all features of that deck and went with it.

  const anchors = {},
    lines = [],
    shells = new Map(),
    marked = new Set(),
    levels = new Map(),
    drums = [];
  for (const [id, routeId, name, color, , knots] of routes) {
    if (!shells.has(color)) {
      // The official line colour, as printed. The brighter `core` in the routes table was for a
      // map that glowed on black; on a light ground it would only wash the lines out.
      shells.set(color, [
        batch('Lacquer ' + color, {
          rough: 0.34,
          metal: 0.05,
          color,
          emission: mixHex('#000000', color, LACQUER_GLOW),
        }),
        batch('Station enamel ' + color, {
          rough: 0.3,
          color,
          emission: mixHex('#000000', color, ENAMEL_GLOW),
        }),
      ]);
    }
    const [shell, enamel] = shells.get(color);
    const y = tubeHeight(routeId);
    const controls = knots.map(([key]) =>
      project(...(Array.isArray(key) ? key : stops[key]), y),
    );
    const points = clipToFootprint(spline(controls, 0.015));
    lines.push({ id, routeId, name, color, points });
    flatTrack(shell, points, trackHalfWidth, trackThickness);

    const sampleIndex = new Map(points.map((p, i) => [p.join(','), i]));
    for (const [k, [key]] of knots.entries()) {
      if (typeof key !== 'string') continue;
      const sample = controls[k].map(Math.fround).join(',');
      const index = sampleIndex.get(sample);
      if (index === undefined || marked.has(sample)) continue;
      marked.add(sample);
      const p = points[index];
      levels.set(key, [...(levels.get(key) ?? []), p]);

      const focus = focal.find((f) => f[1] === key && f[4] === routeId);
      if (!focus) {
        // Ordinary stop: a white disc with the route colour inset, deliberately wider than the
        // track plate (0.0084 across) so every stop reads as a bead on the line rather than a
        // bump in it.
        stationDot(marker, enamel, p, p[1] + trackThickness / 2);
        continue;
      }
      // Explorable stop: a white-rimmed drum on the deck with the line colour on top.
      const [stationId, , label, areaCode] = focus;
      const [lat, lon] = stops[key];
      const top = p[1] + puckRise;
      const skirt = Math.max(slabTop - 0.0004, p[1] - trackThickness / 2 - 0.004);
      loft(
        marker,
        [
          circle(p[0], skirt, p[2], 0.0185, 40),
          circle(p[0], skirt + 0.002, p[2], 0.0165, 40),
          circle(p[0], top - 0.0012, p[2], 0.0165, 40),
          circle(p[0], top, p[2], 0.0153, 40),
        ],
        BEAD_WHITE,
        { bottom: false, top: false },
      );
      const outer = circle(p[0], top, p[2], 0.0153, 40),
        inner = circle(p[0], top, p[2], 0.0108, 40);
      for (let j = 0; j < 40; j++) {
        const l = (j + 1) % 40;
        face(marker, [outer[j], inner[j], inner[l], outer[l]], BEAD_WHITE);
      }
      face(enamel, [...inner].reverse(), '#ffffff');
      // Ink, so the white drum has an edge on a pale ground: a band over the foot, where it meets
      // the plate, and a ring round the rim of the top that carries on down the chamfer. Each sits
      // a hair outside the white it covers.
      const inkBands = [
        [circle(p[0], skirt, p[2], 0.0192, 40), circle(p[0], skirt + 0.0026, p[2], 0.0165, 40)],
        [circle(p[0], top - 0.0014, p[2], 0.0168, 40), circle(p[0], top + 0.0002, p[2], 0.0155, 40)],
        [circle(p[0], top + 0.0002, p[2], 0.0155, 40), circle(p[0], top + 0.0002, p[2], 0.0145, 40)],
      ];
      for (const [low, high] of inkBands)
        for (let j = 0; j < 40; j++) {
          const l = (j + 1) % 40;
          face(marker, [low[j], high[j], high[l], low[l]], INK);
        }
      drums.push(p);
      anchors[stationId] = {
        name: label,
        areaCode: 'AREA - ' + areaCode,
        line: routeId,
        color,
        lat,
        lon,
        tubePos: p,
        topPos: add(p, [0, puckRise, 0]),
        segmentFile: 'segment-' + stationId + '.glb',
      };
    }
  }
  // Every plate is in place; now case them. The casing follows the plates in each line's surface,
  // so the plates keep their place at the front of the vertex buffer.
  for (const line of lines)
    trackCasing(
      shells.get(line.color)[0],
      line.points,
      trackHalfWidth,
      trackThickness,
      tintToward(line.color, CASING[line.color] ?? mixHex(line.color, '#000000', CASING_DARKNESS)),
    );

  // The ground, then everything that casts a shadow on it, in that order: the shadows share the
  // plate's surface and blend over it only because they follow it in the index buffer.
  const ground = groundPlate(plate, lines, slabTop - 0.0006);
  for (const line of lines) ground.trackShadow(line.points);
  for (const p of drums) ground.discShadow(p[0], p[2], 0.0192, 0.009, undefined, 40);
  landmarks(stone, glint, ground);

  // The city goes in last: it needs every centreline so it can avoid building on the tracks.
  const blocks = cityBlocks(city, lines, slabTop, ground);
  if (process.env.FARESIGHT_VERBOSE) console.log('city blocks placed:', blocks);

  // Transfer posts tie stacked platforms of different lines together.
  for (const platforms of levels.values()) {
    const heights = platforms.map((p) => p[1]);
    const low = Math.min(...heights),
      high = Math.max(...heights);
    if (high - low < 1e-6) continue;
    drum(marker, platforms[0], low, high + trackThickness / 2 + 0.0012, 0.0046, BEAD_WHITE, 16);
    // An ink ring round the stretch of post that shows between the two platforms.
    const from = low + trackThickness / 2 + 0.0021;
    const to = high - trackThickness / 2;
    const mid = (from + to) / 2;
    drum(marker, platforms[0], mid - 0.0004, mid + 0.0004, 0.0051, INK, 16);
  }
  m.save(dir + 'boston-map-sculpture.glb');
  json(dir + 'station-anchors.json', anchors);
  json(dir + 'mbta-3d-paths.json', { lines });
}
export function accessories(dir) {
  const t = new Model(),
    hull = t.surface(t.material('Pearl enamel', { metal: 0.46, rough: 0.24 })),
    windows = t.surface(
      t.material('Tintable car glazing', {
        color: '#c1f9ff',
        alpha: 0.74,
        emission: '#24464c',
      }),
    ),
    lamps = t.surface(t.material('LED markers', { emission: '#c6f6fa' }));
  const shape = (z, w, h) => [
    [w * 0.78, -h, z],
    [w, -h * 0.5, z],
    [w, h * 0.52, z],
    [w * 0.65, h, z],
    [-w * 0.65, h, z],
    [-w, h * 0.52, z],
    [-w, -h * 0.5, z],
    [-w * 0.78, -h, z],
  ];
  const sections = [
    [-0.016, 0.0022, 0.0018],
    [-0.012, 0.0048, 0.0036],
    [-0.0085, 0.005, 0.004],
    [0.011, 0.005, 0.004],
    [0.016, 0.0039, 0.0029],
  ].map((v) => shape(...v));
  for (let j = 1; j < sections.length; j++)
    for (let i = 0; i < 8; i++) {
      const k = (i + 1) % 8;
      face(
        hull,
        [
          sections[j - 1][i],
          sections[j - 1][k],
          sections[j][k],
          sections[j][i],
        ],
        '#a7b7c5',
      );
    }
  face(hull, [...sections[0]].reverse(), '#8c9ba3');
  face(hull, sections.at(-1), '#9aa9ab');
  for (const sign of [-1, 1])
    for (let j = 0; j < 5; j++)
      box(
        windows,
        sign * 0.00501,
        0.00055,
        -0.007 + j * 0.0036,
        0.00008,
        0.0021,
        0.0028,
        '#9cd3e2',
      );
  for (const sign of [-1, 1])
    box(
      lamps,
      sign * 0.00125,
      -0.00015,
      -0.01599,
      0.00075,
      0.00065,
      0.00002,
      '#fff4bb',
    );
  // The shared capsule is retired: every line now has its own model in trains.mjs.
  const m = new Model();
  const walnut = m.surface(m.material('Satin quarter-sawn walnut', { rough: 0.36, metal: 0.04 }));
  const brass = m.surface(m.material('Brushed brass', { rough: 0.28, metal: 0.78 }));
  const inlay = m.surface(brass.material, 'Scale inlay');
  const iron = m.surface(m.material('Graphite cast iron', { rough: 0.46, metal: 0.45 }));
  const gold = '#c9a462', patina = '#b48d4c', casting = '#26282e';
  const tau = 2 * Math.PI;

  // Each glued stave samples a different stretch of the same straight-grained stock.
  // Long pores follow the growth rings, with finer, broken fibres between them.
  const { crc32, deflateSync } = process.getBuiltinModule('node:zlib');
  const size = 512, pixels = Buffer.alloc((size * 3 + 1) * size);
  function hash(x, y) {
    let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  function noise(x, y) {
    const i = Math.floor(x), j = Math.floor(y);
    let u = x - i, v = y - j;
    u *= u * (3 - 2 * u);
    v *= v * (3 - 2 * v);
    const a = hash(i, j), b = hash(i, j + 1);
    return (a + u * (hash(i + 1, j) - a)) * (1 - v) +
      (b + u * (hash(i + 1, j + 1) - b)) * v;
  }
  for (let y = 0; y < size; y++) {
    const board = Math.floor(y / 91), v = 1.5 * y + 557 * board;
    for (let x = 0; x < size; x++) {
      const u = 1.5 * x;
      const wave = v + 19 * noise(u / 245, v / 82) + 4 * noise(u / 100, v / 36);
      const rings = wave / 12 + 2 * noise(u / 400, v / 51);
      const pore = (0.5 + 0.5 * Math.cos(tau * rings)) ** 7;
      const tone = 16 * (noise(u / 180, wave / 15) - 0.5) +
        11 * (noise(u / 22, wave / 1.9) - 0.5) - 11 * pore +
        9 * (hash(board, 101) - 0.5) + 3 * (hash(x, y) - 0.5);
      const i = y * (size * 3 + 1) + 1 + 3 * x;
      pixels[i] = Math.round(88 + tone);
      pixels[i + 1] = Math.round(60 + tone * 0.78);
      pixels[i + 2] = Math.round(43 + tone * 0.61);
    }
  }
  function pngChunk(tag, data) {
    const chunk = Buffer.alloc(12 + data.length);
    chunk.writeUInt32BE(data.length);
    chunk.write(tag, 4);
    data.copy(chunk, 8);
    chunk.writeUInt32BE(crc32(chunk.subarray(4, -4)), chunk.length - 4);
    return chunk;
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  m.textures.push({ name: 'Walnut staves', material: walnut.material,
    bytes: Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'),
      pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)),
      pngChunk('IEND', Buffer.alloc(0))]) });

  // The two guides and their ticks replace pieces of the walnut surface at y = 0.
  const sides = 60;
  const radii = [0, 0.09955, 0.10045, 0.14955, 0.15045, 0.444];
  const rings = radii.map((r) => circle(0, 0, 0, r, sides));
  function topFace(surface, points) {
    face(surface, points, surface === inlay ? '#d8b878' : '#ffffff',
      surface === walnut ? points.map(([x, , z]) => [0.5 + x / 0.90, 0.5 + z / 0.90]) : undefined);
  }
  for (let k = 1; k < rings.length; k++) {
    const inner = rings[k - 1], outer = rings[k];
    for (let j = 0; j < sides; j++) {
      const l = (j + 1) % sides;
      if (k === 1) topFace(walnut, [[0, 0, 0], outer[l], outer[j]]);
      else if (k === 2 || k === 4) topFace(inlay, [inner[j], inner[l], outer[l], outer[j]]);
      else if (j % (sides / 12) === 0) {
        const depth = (j % (sides / 4) === 0 ? 0.0055 : 0.0033) / (radii[k] - radii[k - 1]);
        const tip = mix(inner[j], outer[j], depth), next = mix(inner[l], outer[l], depth);
        const width = 0.0009 / (radii[k - 1] * tau / sides);
        const start = mix(inner[j], inner[l], width), end = mix(tip, next, width);
        topFace(inlay, [inner[j], start, end, tip]);
        topFace(walnut, [start, inner[l], next, end]);
        topFace(walnut, [tip, next, outer[l], outer[j]]);
      } else topFace(walnut, [inner[j], inner[l], outer[l], outer[j]]);
    }
  }

  // Revolve a joiner's or foundry profile from the bottom up. The optional third
  // ordinate gives the depth of the eight flutes at that height, fading into collars.
  function turn(surface, color, profile, count = 40) {
    const rows = profile.map(([y, r, relief = 0, rise = 0]) => Array.from({ length: count }, (_, i) => {
      const a = tau * i / count;
      const flute = (0.5 + 0.5 * Math.cos(8 * a)) ** 2;
      const radius = r + relief * flute;
      return [radius * Math.cos(a), y + rise * flute, radius * Math.sin(a)];
    }));
    for (let j = 1; j < rows.length; j++) {
      const lower = rows[j - 1], upper = rows[j];
      const strip = lower.map((p, i) => {
        const prev = (i + count - 1) % count, next = (i + 1) % count;
        const [dx, dy, dz] = sub(upper[i], p);
        const tx = (lower[next][0] - lower[prev][0]) + (upper[next][0] - upper[prev][0]);
        const ty = (lower[next][1] - lower[prev][1]) + (upper[next][1] - upper[prev][1]);
        const tz = (lower[next][2] - lower[prev][2]) + (upper[next][2] - upper[prev][2]);
        const normal = norm([dy * tz - dz * ty, dz * tx - dx * tz, dx * ty - dy * tx]);
        return [p, upper[i]].map((pos) => surface.vertex(pos, normal, color,
          surface === walnut ? [0.5 + pos[0] / 0.90, 0.5 + (pos[2] + pos[1]) / 0.90] : undefined));
      });
      for (let i = 0; i < count; i++) {
        const [a, b] = strip[i], [c, d] = strip[(i + 1) % count];
        surface.indices.push(a, b, d, a, d, c);
      }
    }
  }
  turn(walnut, '#ffffff', [
    [-0.062, 0.105], [-0.062, 0.332], [-0.058, 0.34], [-0.036, 0.34], [-0.036, 0.44],
  ], sides);
  turn(brass, gold, [
    [-0.036, 0.44], [-0.033, 0.447], [-0.029, 0.45], [-0.025, 0.448],
    [-0.007, 0.448], [-0.004, 0.45], [-0.0015, 0.449], [0, 0.444],
  ], sides);

  // Low domed rivets sit on the recessed fascia, inside the rolled edge's envelope.
  for (let i = 0; i < 24; i++) {
    const a = (i + 0.5) * tau / 24, ca = Math.cos(a), sa = Math.sin(a);
    const head = Array.from({ length: 8 }, (_, j) => {
      const angle = tau * j / 8, t = 0.0021 * Math.cos(angle);
      return [0.4475 * ca - t * sa, -0.016 + 0.0021 * Math.sin(angle), 0.4475 * sa + t * ca];
    });
    const crown = [0.4497 * ca, -0.016, 0.4497 * sa];
    for (let j = 0; j < head.length; j++) face(brass, [head[(j + 1) % 8], head[j], crown], '#ddbd7d');
  }

  face(iron, circle(0, -0.740, 0, 0.249, 40), casting);
  turn(iron, casting, [[-0.740, 0.249], [-0.729, 0.260], [-0.724, 0.260]]);
  turn(brass, patina, [[-0.724, 0.260], [-0.720, 0.260], [-0.717, 0.256]]);
  turn(iron, casting, [
    [-0.717, 0.256], [-0.711, 0.249], [-0.708, 0.225], [-0.699, 0.214, 0.002, 0.0015],
    [-0.690, 0.157, 0.007, 0.010], [-0.666, 0.096, 0.009, 0.013], [-0.641, 0.074, 0.004, 0.008], [-0.626, 0.071],
  ]);
  turn(brass, gold, [[-0.626, 0.071], [-0.623, 0.075], [-0.616, 0.075], [-0.611, 0.063]]);
  turn(iron, casting, [
    [-0.611, 0.063], [-0.601, 0.060], [-0.584, 0.048, 0.004], [-0.55, 0.042, 0.005],
    [-0.218, 0.036, 0.004], [-0.197, 0.040], [-0.188, 0.051],
  ]);
  turn(brass, gold, [[-0.188, 0.051], [-0.184, 0.054], [-0.178, 0.054], [-0.175, 0.050]]);
  turn(iron, casting, [
    [-0.175, 0.050], [-0.160, 0.048], [-0.13, 0.054, 0.004],
    [-0.099, 0.085, 0.005], [-0.082, 0.108], [-0.061, 0.108],
  ]);
  m.save(dir + 'table-pedestal.glb');
}
