// One train model per MBTA line.
//
// The design vocabulary is taken from Flowcast's mbta-green-line-train.glb, which breaks a train
// into body, roof, glass, doors, headlight, trim and under/skirt. That model is a single
// real-scale Green Line consist (2.7 x 2.4 x 45 m, 3436 triangles) built for a Mapbox scene, so it
// is not reusable here directly: this sculpture is 6500 m to the unit and flat-shaded with baked
// vertex colour. What carries over is the breakdown and the proportions.
//
// Each line gets its own model because the real rolling stock differs:
//
//   Green   Type 8/9 LRV. A light rail trolley: lower, shorter, rounded, white over green, and
//           pantograph-powered, so it carries one on the roof.
//   Red     1700/1800 series heavy rail. Unpainted stainless with a red band, long and boxy,
//           flat-fronted, third rail, so no pantograph.
//   Orange  1400 series. Stainless with an orange band, slightly shorter than Red.
//   Blue    0700 series. Stainless with a blue band, and the one line that runs both third rail
//           and overhead wire, so it keeps a pantograph.
import { Model, box, face } from './geometry.mjs';

/**
 * Cross-section of a car body at distance `z` along it.
 *
 * Eight points: chamfered at the roof line and tucked at the skirt, which is what gives a rail
 * vehicle its silhouette rather than a plain extruded rectangle.
 */
const section = (z, w, h, floor) => [
  [w * 0.72, floor, z],
  [w, floor + h * 0.22, z],
  [w, floor + h * 0.72, z],
  [w * 0.74, floor + h, z],
  [-w * 0.74, floor + h, z],
  [-w, floor + h * 0.72, z],
  [-w, floor + h * 0.22, z],
  [-w * 0.72, floor, z],
];

/** Skin a run of cross-sections. */
function hull(surface, sections, colour) {
  for (let j = 1; j < sections.length; j++)
    for (let i = 0; i < 8; i++) {
      const k = (i + 1) % 8;
      face(
        surface,
        [sections[j - 1][i], sections[j - 1][k], sections[j][k], sections[j][i]],
        colour,
      );
    }
  // Cap both ends so the nose is solid from head on.
  face(surface, sections[0], colour);
  face(surface, [...sections.at(-1)].reverse(), colour);
}

/**
 * The window band.
 *
 * Drawn as two flat strips just proud of the body sides rather than as a cut-out: at this scale a
 * real opening would be invisible, and the inset band is what actually reads as a train.
 */
function glazing(surface, half, floor, height, from, to, colour) {
  const low = floor + height * 0.42;
  const high = floor + height * 0.78;
  const x = half * 1.012;
  for (const side of [-1, 1]) {
    const a = [side * x, low, from];
    const b = [side * x, low, to];
    const c = [side * x, high, to];
    const d = [side * x, high, from];
    face(surface, side > 0 ? [a, b, c, d] : [d, c, b, a], colour);
  }
}

/** A pantograph: the folded arm that collects current from overhead wire. */
function pantograph(surface, half, roof, z, colour) {
  const armTop = roof + 0.0022;
  box(surface, 0, roof + 0.0002, z, half * 0.9, 0.0004, 0.0022, colour);
  // Two legs leaning together, then the contact bar across the top.
  for (const lean of [-1, 1]) {
    const a = [lean * half * 0.34, roof + 0.0004, z - lean * 0.0012];
    const b = [lean * half * 0.34, roof + 0.0004, z - lean * 0.0012 + 0.0003];
    const c = [0, armTop, z + 0.0003];
    const d = [0, armTop, z];
    face(surface, lean > 0 ? [a, b, c, d] : [d, c, b, a], colour);
  }
  box(surface, 0, armTop, z, half * 0.78, 0.00035, 0.0005, colour);
}

/**
 * Build one car.
 *
 * `livery` paints the body, `band` the window strip, and `roof`/`skirt` the darker trim. Headlamps
 * sit at the leading end, which is +z, matching the direction the scene points a train along its
 * track.
 */
function car(model, surfaces, spec, z0, length) {
  const { body, glass, trim, lamp } = surfaces;
  const { half, height, floor, livery, band, roofTint, skirtTint, pan } = spec;

  const nose = Math.min(length * 0.17, 0.0042);
  const back = z0;
  const front = z0 + length;
  const sections = [
    section(back, half * 0.66, height * 0.82, floor + height * 0.08),
    section(back + nose, half, height, floor),
    section(front - nose, half, height, floor),
    section(front, half * 0.66, height * 0.82, floor + height * 0.08),
  ];
  hull(body, sections, livery);

  // Dark skirt under the body: the trucks and underframe read as one shadowed block. Spanned
  // explicitly between two heights rather than offset from the floor, because an offset let the
  // bottom dip below y=0 and the train sank into the rail it was meant to sit on.
  const skirtLow = floor * 0.22;
  const skirtHigh = floor + 0.0002;
  box(
    trim, 0, (skirtLow + skirtHigh) / 2, (back + front) / 2,
    half * 0.82, skirtHigh - skirtLow, length * 0.9, skirtTint,
  );
  // Roof cap, a touch narrower than the body.
  box(trim, 0, floor + height + 0.00015, (back + front) / 2, half * 0.76, 0.0003, length * 0.93, roofTint);

  glazing(glass, half, floor, height, back + nose * 1.15, front - nose * 1.15, band);

  // Headlamps at the leading end.
  for (const side of [-1, 1])
    box(lamp, side * half * 0.42, floor + height * 0.3, front - 0.0004, 0.0008, 0.0008, 0.0006, '#dff6ff');

  if (pan) pantograph(trim, half, floor + height + 0.0004, (back + front) / 2, roofTint);
}

/**
 * Line specs. Lengths are in sculpture units and deliberately stylised -- true scale would put a
 * 45 m consist at 0.007 units, far too small to see -- but the relative proportions are real:
 * the Green Line LRV is the short one, Red the long one.
 */
export const TRAINS = {
  green: {
    file: 'mbta-train-green.glb',
    cars: 2,
    length: 0.0128,
    gap: 0.0012,
    half: 0.0044,
    height: 0.0072,
    floor: 0.0006,
    // Type 8/9: white over green, with a green skirt.
    livery: '#f2f5f7',
    band: '#1d2b33',
    roofTint: '#c9d2d8',
    skirtTint: '#10361f',
    accent: '#00843D',
    pan: true,
  },
  red: {
    file: 'mbta-train-red.glb',
    cars: 2,
    length: 0.0152,
    gap: 0.001,
    half: 0.0046,
    height: 0.0076,
    floor: 0.0007,
    // Unpainted stainless with a red band at the window line.
    livery: '#b9c2cb',
    band: '#DA291C',
    roofTint: '#8e98a3',
    skirtTint: '#232a33',
    accent: '#DA291C',
    pan: false,
  },
  orange: {
    file: 'mbta-train-orange.glb',
    cars: 2,
    length: 0.0142,
    gap: 0.001,
    half: 0.0046,
    height: 0.0076,
    floor: 0.0007,
    livery: '#b9c2cb',
    band: '#ED8B00',
    roofTint: '#8e98a3',
    skirtTint: '#232a33',
    accent: '#ED8B00',
    pan: false,
  },
  blue: {
    file: 'mbta-train-blue.glb',
    cars: 2,
    length: 0.0126,
    gap: 0.001,
    half: 0.0044,
    height: 0.0074,
    floor: 0.0007,
    livery: '#b9c2cb',
    band: '#003DA5',
    roofTint: '#8e98a3',
    skirtTint: '#232a33',
    accent: '#003DA5',
    // The 0700s collect from overhead wire east of Airport, so they carry one.
    pan: true,
  },
};

/** Write every line's train model into `dir`. */
export function trains(dir) {
  for (const spec of Object.values(TRAINS)) {
    const m = new Model();
    const surfaces = {
      body: m.surface(m.material('Car body', { metal: 0.38, rough: 0.33 })),
      glass: m.surface(
        m.material('Window band', { rough: 0.2, emission: '#16242b' }),
      ),
      trim: m.surface(m.material('Roof and underframe', { metal: 0.3, rough: 0.55 })),
      lamp: m.surface(m.material('Head lamps', { emission: '#bfeaff' })),
    };

    const total = spec.cars * spec.length + (spec.cars - 1) * spec.gap;
    let z = -total / 2;
    for (let i = 0; i < spec.cars; i++) {
      car(m, surfaces, spec, z, spec.length);
      z += spec.length + spec.gap;
      // Gangway between cars, so a consist reads as articulated rather than as two loose boxes.
      if (i < spec.cars - 1)
        box(
          surfaces.trim,
          0,
          spec.floor + spec.height * 0.45,
          z - spec.gap / 2,
          spec.half * 0.62,
          spec.height * 0.5,
          spec.gap,
          spec.skirtTint,
        );
    }
    m.save(dir + spec.file);
  }
}

/** Route id to model file, for the runtime. */
export const trainFileFor = (routeId) => {
  const family = String(routeId).split('-')[0].toLowerCase();
  return (TRAINS[family] ?? TRAINS.green).file;
};

