import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  Model,
  box,
  circle,
  face,
  loft,
  rect,
  rod,
  sweep,
  TAU,
} from './geometry.mjs';

// Fabrication dimensions are in millimetres. Convert once at the glTF boundary.
const alloy = '#9697b2',
  slate = '#6f708d',
  ink = '#262b38';
// Paper Map tones for the pieces that sit on the light map (web/src/styles/tokens.css).
const mapPaper = '#FFFDF8',
  mapInk = '#22252B';
const brass = '#c9a462',
  gold = '#d8b778',
  bronze = '#997544';
const walnut = '#4b3425',
  heartwood = '#5e4230',
  cream = '#ebe3cf',
  red = '#8c313f';
const signs = [-1, 1];
const uv = [
  [0, 1],
  [1, 1],
  [1, 0],
  [0, 0],
];

function part(m, name, finish, metal, rough, translation) {
  let mat = m.materials.findIndex((material) => material.name === finish);
  if (mat < 0) mat = m.material(finish, { metal, rough });
  return m.surface(mat, name, translation);
}

// A periodic grayscale veneer modulates the walnut vertex colors. Grain follows
// the timber on both faces of a board and changes direction across each mitre.
function walnutVeneer(model, material) {
  const size = 128,
    pixels = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (TAU * x) / size,
        v = (TAU * y) / size;
      const grain = v + 0.16 * Math.sin(u + 2 * v) + 0.08 * Math.sin(2 * u - v);
      const pores =
        Math.max(0, Math.sin(23 * grain + 1.7 * Math.cos(3 * v))) ** 4;
      pixels[y * (size + 1) + x + 1] = Math.round(
        238 + 10 * Math.sin(7 * grain) - 36 * pores,
      );
    }
  }
  grayscaleTexture(model, material, 'Quarter-sawn walnut', size, pixels);
}

function grayscaleTexture(model, material, name, size, pixels) {
  const chunk = (type, data) => {
    const bytes = Buffer.alloc(data.length + 12);
    bytes.writeUInt32BE(data.length);
    bytes.write(type, 4);
    data.copy(bytes, 8);
    bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
    return bytes;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  const bytes = Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  model.textures.push({ name, material, bytes });
}

// Rotate the builder's horizontal loft rings onto the front of the instrument.
function outline(x, y, z, w, h, corner) {
  return rect(x, z, -y, w, h, corner).map(([u, d, v]) => [u, -v, d]);
}

function panel(s, x, y, w, h, corner, layers, color) {
  loft(
    s,
    layers.map(([z, inset]) =>
      outline(
        x,
        y,
        z,
        w - inset * 2,
        h - inset * 2,
        Math.max(0.1, corner - inset / 2),
      ),
    ),
    color,
  );
}

// An actual opening with an outward slope, a flat crest and a return to the inset.
function bezel(s, x, y, w, h, corner, sections) {
  let previous;
  for (const [inset, z, color] of sections) {
    const rim = outline(
      x,
      y,
      z,
      w - 2 * inset,
      h - 2 * inset,
      Math.max(0.2, corner - inset),
    );
    if (previous) {
      for (let i = 0; i < rim.length; i++) {
        const k = (i + 1) % rim.length;
        face(s, [previous[i], rim[i], rim[k], previous[k]], color);
      }
    }
    previous = rim;
  }
}

function canvas(m, name, center, w, h, color, tilt = 0) {
  const material = m.material(name + ' enamel', { color, rough: 0.55 });
  const s = m.surface(material, name, center);
  face(
    s,
    [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([u, v]) => [
      (u * w) / 2,
      ((v * h) / 2) * Math.cos(tilt),
      ((-v * h) / 2) * Math.sin(tilt),
    ]),
    '#ffffff',
    uv,
  );
}

function screw(s, x, y, z, r, direction = 1) {
  const cap = z + 0.35 * direction;
  rod(s, [x, y, z - 0.5 * direction], [x, y, cap], r, brass, 12);
  // The dark screwdriver slot lies on the head's outer face.
  const points = [
    [-0.62, -0.12],
    [0.62, -0.12],
    [0.62, 0.12],
    [-0.62, 0.12],
  ].map(([a, b]) => [
    x + r * (0.92 * a - 0.39 * b),
    y + r * (0.39 * a + 0.92 * b),
    cap + direction * 0.04,
  ]);
  face(s, direction > 0 ? points : points.reverse(), ink);
}

function turnedCollar(s, profile) {
  loft(
    s,
    profile.map(([y, r]) => circle(0, y, 0, r, 24)),
    brass,
  );
}

function controlDeck() {
  const m = new Model();
  const chassis = part(m, 'Deck_Chassis', 'Satin alloy', 0.48, 0.36);
  const well = part(m, 'Deck_Well', 'Anodized key well', 0.32, 0.48);
  const trim = part(m, 'Deck_Trim', 'Machined fittings', 0.64, 0.35);
  const back = part(m, 'Deck_Back', 'Dock graphite', 0.27, 0.52);
  panel(
    chassis,
    0,
    0,
    352,
    150,
    13,
    [
      [-9, 4],
      [-6, 0],
      [5.5, 0],
      [9, 3],
    ],
    alloy,
  );
  panel(
    well,
    0,
    -18,
    317,
    87,
    5,
    [
      [8, 1],
      [9.4, 0],
    ],
    ink,
  );
  bezel(chassis, 0, -18, 324, 94, 8, [
    [0, 8.9],
    [1.8, 11, slate],
    [3, 11, alloy],
    [4.6, 9.2, slate],
  ]);
  panel(
    well,
    0,
    47,
    323,
    42,
    5,
    [
      [8, 1],
      [14.2, 0],
    ],
    ink,
  );
  bezel(trim, 0, 47, 325, 43, 5, [
    [0, 9],
    [1.2, 15.2, bronze],
    [2.4, 15.4, brass],
    [5.8, 14.3, ink],
  ]);
  canvas(m, 'Deck_Status', [0, 47, 14.6], 312, 32, '#354440');

  for (const side of signs) {
    panel(
      trim,
      side * 173,
      -3,
      14,
      90,
      4,
      [
        [-6, 2],
        [-4, 0],
        [6.6, 0],
        [8, 1.5],
      ],
      red,
    );
    for (let i = -2; i <= 2; i++)
      panel(
        trim,
        side * 174,
        i * 14 - 3,
        11,
        3,
        1,
        [
          [7.9, 0],
          [8.8, 0.5],
        ],
        '#ac5155',
      );
    panel(
      trim,
      side * 164,
      -16,
      3,
      89,
      1,
      [
        [8, 0],
        [10.4, 0.5],
      ],
      brass,
    );
    for (const sy of signs) screw(trim, side * 166.5, sy * 62, 9, 2.5);
  }
  panel(
    back,
    0,
    0,
    327,
    128,
    10,
    [
      [-9.8, 2],
      [-8.6, 0],
    ],
    ink,
  );
  for (const side of signs) {
    for (let i = 0; i < 6; i++)
      panel(
        back,
        side * (66 + 13 * i),
        0,
        5,
        90 - i * 3,
        2,
        [
          [-10.8, 0.7],
          [-9.6, 0],
        ],
        slate,
      );
    for (const sy of signs) screw(trim, side * 149, sy * 50, -9.8, 2.3, -1);
  }
  panel(
    trim,
    0,
    0,
    86,
    63,
    10,
    [
      [-10.3, 0.8],
      [-9.5, 0],
    ],
    bronze,
  );
  panel(
    back,
    0,
    0,
    82,
    59,
    9,
    [
      [-10.65, 0.6],
      [-10.2, 0],
    ],
    '#383b48',
  );
  for (const x of [-12, -4, 4, 12])
    rod(trim, [x, -16, -10.5], [x, -16, -10.8], 1.65, gold, 12);
  const keys = [
    ['Map', 'Station', 'Back'],
    ['Recenter', 'Table', 'Debug'],
  ];
  keys.forEach((row, j) =>
    row.forEach((name, i) => {
      const x = (i - 1) * 105,
        y = j === 0 ? 5 : -41;
      const cap = part(m, 'KeyBody_' + name, 'Moulded keycaps', 0.12, 0.45, [
        x,
        y,
        11,
      ]);
      panel(
        cap,
        0,
        0,
        92,
        36,
        3,
        [
          [-5.5, 1],
          [-4.3, 0],
          [-1.5, 0],
          [4.7, 2.4],
          [5.5, 3],
        ],
        j === 0 ? cream : alloy,
      );
      canvas(
        m,
        'KeyFace_' + name,
        [x, y, 17.2],
        82,
        28,
        j === 0 ? '#eee7d7' : '#aaabc0',
      );
    }),
  );
  return m;
}

// A rounded rectangle in the instrument's front plane, counter-clockwise seen from the front.
function roundedFace(w, h, r, z = 0, steps = 6) {
  const points = [];
  for (const [k, sx, sy] of [
    [0, 1, -1],
    [1, 1, 1],
    [2, -1, 1],
    [3, -1, -1],
  ])
    for (let i = 0; i <= steps; i++) {
      const angle = ((k - 1 + i / steps) * TAU) / 4;
      points.push([
        sx * (w / 2 - r) + r * Math.cos(angle),
        sy * (h / 2 - r) + r * Math.sin(angle),
        z,
      ]);
    }
  return points;
}

// The venue marker's label: a paper card with a hairline of ink around it, and nothing else.
//
// It used to be a slate housing in a brass bezel with four screws, a turned collar, two struts and
// a red tab -- instrument-panel furniture that read as heavy and dark over the pale station
// islands. A map label wants to be the lightest thing on the map. So this is now two parts: an
// ink slab, and the card face a couple of millimetres smaller that the app draws the venue onto.
// The slab showing around the face is the outline. It is kept thin: the map is looked down on, so
// a deep slab shows its top as a heavy black bar along every label. The needle and the foot marker under it are drawn by the app, which restyles them
// per venue (web/src/xr/StationDioramaScene.ts).
function venueFlag() {
  const m = new Model();
  const width = 204,
    height = 64,
    radius = 10,
    edge = 2.4,
    center = 58;
  // The slab is the outline, so it must stay ink whatever the light is doing: black base colour,
  // ink emission. The app tints the base towards grey to mute a filtered-out venue.
  const slab = m.surface(
    m.material('Pin ink', { color: '#000000', emission: mapInk, rough: 1 }),
    'Pin_Housing',
  );
  loft(
    slab,
    [-1.2, 1.2].map((z) =>
      roundedFace(width + 2 * edge, height + 2 * edge, radius + edge, z)
        .map(([x, y, depth]) => [x, y + center, depth])
        .reverse(),
    ),
    '#ffffff',
  );
  const card = m.surface(
    m.material('Pin_Plate enamel', { color: mapPaper, rough: 0.55 }),
    'Pin_Plate',
    [0, center, 1.5],
  );
  const outline = roundedFace(width, height, radius);
  face(
    card,
    outline,
    '#ffffff',
    outline.map(([x, y]) => [x / width + 0.5, 0.5 - y / height]),
  );
  return m;
}

function stationMedallion() {
  const m = new Model();
  const shell = part(m, 'Station_Housing', 'Cast bronze and slate', 0.56, 0.38);
  const trim = part(m, 'Station_Fittings', 'Brushed brass', 0.7, 0.32);
  panel(
    shell,
    0,
    64,
    244,
    88,
    12,
    [
      [-5.8, 3],
      [-4.8, 0],
      [-3, 0],
      [-2.5, 0.5],
      [0.6, 0.5],
      [1.1, 0],
      [6.4, 0],
      [9.1, 2.2],
    ],
    slate,
  );
  panel(
    trim,
    0,
    64,
    244,
    88,
    12,
    [
      [-2.7, 0.32],
      [-2.4, 0],
      [0.3, 0],
      [0.8, 0.32],
    ],
    brass,
  );
  bezel(trim, 0, 64, 243, 87, 11.8, [
    [0, 6.5],
    [2, 10.3, bronze],
    [3.5, 10.3, gold],
    [7.8, 9.3, brass],
  ]);
  canvas(m, 'Station_Plate', [0, 64, 9.6], 224, 70, '#34444d');
  turnedCollar(trim, [
    [0, 6.8],
    [1, 7.6],
    [3.8, 7.6],
    [5, 6.4],
    [6.2, 6.4],
    [7.8, 7.5],
  ]);
  panel(
    trim,
    0,
    8.4,
    59,
    5.2,
    2.4,
    [
      [-3, 1],
      [-2.3, 0],
      [2.3, 0],
      [3, 1],
    ],
    bronze,
  );
  for (const side of signs) {
    rod(trim, [side * 25, 9, 0], [side * 25, 21, 0], 2.7, brass, 16);
    for (const y of signs) screw(trim, side * 116.5, 64 + y * 26, 9.6, 1.6);
    for (let i = -1; i <= 1; i++)
      panel(
        trim,
        side * 55,
        64 + i * 5,
        65 - Math.abs(i) * 12,
        2.2,
        0.8,
        [
          [-6.4, 0.3],
          [-5.7, 0],
        ],
        bronze,
      );
  }
  // A cast transit roundel identifies the station from the reverse.
  rod(trim, [0, 64, -5.7], [0, 64, -6.6], 23, brass, 48);
  rod(shell, [0, 64, -6.5], [0, 64, -7.1], 20.3, ink, 48);
  panel(
    trim,
    0,
    71,
    25,
    5,
    0.5,
    [
      [-7.7, 0.2],
      [-7, 0],
    ],
    gold,
  );
  panel(
    trim,
    0,
    60,
    5,
    17.2,
    0.5,
    [
      [-7.7, 0.2],
      [-7, 0],
    ],
    gold,
  );
  return m;
}

function menuStand() {
  const m = new Model();
  const wood = part(m, 'Menu_Plinth', 'Oiled walnut', 0.02, 0.48);
  const board = part(m, 'Menu_Board', 'Oiled walnut', 0.02, 0.48);
  const liner = part(m, 'Menu_Liner', 'Brushed brass', 0.68, 0.33);
  const fittings = part(m, 'Menu_Fittings', 'Brushed brass', 0.68, 0.33);
  loft(
    wood,
    [
      [0, 243, 67],
      [2.5, 250, 72],
      [9.5, 250, 72],
      [14, 244, 67],
    ].map(([y, w, d]) => rect(0, y, 0, w, d, 6)),
    walnut,
  );
  const angle = Math.PI / 10,
    co = Math.cos(angle),
    si = Math.sin(angle);
  // The board's lower edge seats in the front shoe; rear legs meet the hinges.
  const mount = ([x, y, z]) => [
    x,
    12.5 + (y + 59) * co + z * si,
    20 - (y + 59) * si + z * co,
  ];
  panel(
    board,
    0,
    0,
    256,
    118,
    5,
    [
      [-5, 1.5],
      [-3.6, 0],
      [3.7, 0],
      [5, 1.2],
    ],
    heartwood,
  );
  walnutVeneer(m, wood.material);
  for (const timber of [wood, board]) {
    for (let i = 0; i < timber.positions.length; i += 3) {
      const [x, y, z] = timber.positions.slice(i, i + 3);
      timber.uvs.push(x / 240, (y + z) / 105);
    }
  }
  bezel(liner, 0, 0, 252, 114, 4, [
    [0, 4.8],
    [1.3, 6.3, brass],
    [2.7, 6.3, gold],
    [5.9, 5.2, bronze],
  ]);
  for (const x of signs)
    for (const y of signs) screw(liner, x * 119, y * 49, -5, 2, -1);
  for (const s of [board, liner]) {
    for (let i = 0; i < s.positions.length; i += 3) {
      const p = mount(s.positions.slice(i, i + 3));
      const [x, y, z] = s.normals.slice(i, i + 3);
      for (let j = 0; j < 3; j++) s.positions[i + j] = p[j];
      s.normals[i] = x;
      s.normals[i + 1] = y * co + z * si;
      s.normals[i + 2] = -y * si + z * co;
    }
  }
  canvas(m, 'Menu_Card', mount([0, 0, 5.6]), 238, 102, '#eee4ce', angle);
  box(fittings, 0, 16, 25.6, 229, 7, 5.8, brass, 2.5);
  for (const side of signs) {
    const x = side * 87,
      pivot = mount([x, 25, -7]);
    box(fittings, x, 14.3, -27, 18, 2.4, 12, bronze, 2);
    rod(fittings, [x, 14.5, -28], pivot, 2.1, gold, 12);
    rod(fittings, [x, 14, 13], pivot, 1.8, brass, 12);
    rod(
      fittings,
      [x - 4.8, pivot[1], pivot[2]],
      [x + 4.8, pivot[1], pivot[2]],
      3.4,
      brass,
      16,
    );
    screw(fittings, side * 104, 16, 28.5, 1.5);
  }
  return m;
}

function plaqueStand() {
  const m = new Model();
  const frame = part(m, 'Plaque_Frame', 'Mitred walnut', 0.02, 0.46);
  const trim = part(m, 'Plaque_Brass', 'Brushed brass', 0.68, 0.34);
  const back = part(m, 'Plaque_Back', 'Dark backing', 0.12, 0.54);
  walnutVeneer(m, frame.material);
  // Each mitre runs from the outside corner through the entire moulding section.
  const profile = [
    [0, -9.61],
    [0, 8],
    [2.5, 11.6],
    [5, 13.8],
    [10, 13.8],
    [11.5, 12.1],
    [18, 12.1],
    [21, 10.8],
    [21, -9.61],
  ];
  const contour = (inset, z) => [
    [-300 + inset, -180 + inset, z],
    [300 - inset, -180 + inset, z],
    [300 - inset, 180 - inset, z],
    [-300 + inset, 180 - inset, z],
  ];
  for (let i = 0; i < 4; i++) {
    const k = (i + 1) % 4;
    const colors = [
      walnut,
      heartwood,
      '#624734',
      '#634632',
      walnut,
      heartwood,
      walnut,
      walnut,
      walnut,
    ];
    for (let j = 0; j < profile.length; j++) {
      const outer = contour(...profile[j]),
        inner = contour(...profile[(j + 1) % profile.length]);
      const rail = [outer[i], outer[k], inner[k], inner[i]];
      face(
        frame,
        rail,
        i % 2 && j === 3 ? '#543c2c' : colors[j],
        rail.map(([x, y, z]) =>
          i % 2 ? [y / 240, (x + z) / 105] : [x / 240, (y + z) / 105],
        ),
      );
    }
  }
  panel(
    back,
    0,
    0,
    567,
    327,
    3,
    [
      [-6.4, 2],
      [-5, 0],
      [12.2, 0],
    ],
    ink,
  );
  bezel(trim, 0, 0, 562, 322, 3, [
    [0, 10.7],
    [1.6, 13.4, bronze],
    [3.2, 13.4, gold],
    [6.6, 12.35, brass],
  ]);
  canvas(m, 'Plaque_Face', [0, 0, 12.6], 548, 308, '#e8deca');
  for (const x of signs) {
    for (const y of signs) {
      // Flush L-shaped corner shoes wrap the two rails at each outer mitre.
      const points = [
        [0, 0],
        [36, 0],
        [32, 4],
        [4, 4],
        [4, 26],
        [0, 30],
      ];
      const corners = points.map(([u, v]) => [
        x * (294.5 - u),
        y * (174.5 - v),
        14,
      ]);
      if (x * y < 0) corners.reverse();
      for (let i = 0; i < corners.length; i++) {
        const a = corners[i],
          b = corners[(i + 1) % corners.length];
        face(trim, [[a[0], a[1], 13.6], [b[0], b[1], 13.6], b, a], bronze);
      }
      if (x * y < 0) corners.reverse();
      for (const ids of [
        [0, 1, 2, 3],
        [0, 3, 4, 5],
      ])
        face(
          trim,
          (x * y > 0 ? ids : [...ids].reverse()).map((i) => corners[i]),
          brass,
        );
      screw(trim, x * 285, y * 172.5, 14, 1.2);
      screw(trim, x * 275, y * 154, -6.5, 2.8, -1);
    }
  }
  // A folded French cleat sits inside the depth of the rear moulding.
  loft(
    trim,
    [
      [82, -7, 3],
      [85, -7.9, 3.2],
      [96, -7.5, 3.2],
    ].map(([y, z, d]) => rect(0, y, z, 215, d, 1)),
    bronze,
  );
  for (const side of signs) screw(trim, side * 91, 92, -9, 2.2, -1);
  return m;
}

// Local book coordinates run right, up the spine, and out of the paper face.
// The last rotation reclines the entire binding about its heel on the cradle.
const bookTilt = (24 * Math.PI) / 180,
  bookFold = (10 * Math.PI) / 180;
function bookVector(side, x, y, z) {
  const a = side * bookFold,
    c = Math.cos(a),
    s = Math.sin(a);
  const forward = x * s + z * c;
  return [
    x * c - z * s,
    y * Math.cos(bookTilt) + forward * Math.sin(bookTilt),
    -y * Math.sin(bookTilt) + forward * Math.cos(bookTilt),
  ];
}
function bookPoint(side, x, y, z) {
  const [dx, dy, dz] = bookVector(side, x, y, z);
  return [
    dx,
    22 + 11 * Math.sin(bookTilt) + dy,
    48 + 11 * Math.cos(bookTilt) + dz,
  ];
}
function placeBookPart(surface, first, side) {
  for (let i = first; i < surface.positions.length; i += 3) {
    const position = bookPoint(side, ...surface.positions.slice(i, i + 3));
    const normal = bookVector(side, ...surface.normals.slice(i, i + 3));
    for (let k = 0; k < 3; k++) {
      surface.positions[i + k] = position[k];
      surface.normals[i + k] = normal[k];
    }
  }
}

function coverLeather(model, material) {
  // A repeating field of irregular cells reproduces the shallow pebble grain.
  const size = 96,
    cells = 12,
    pixels = Buffer.alloc((size + 1) * size);
  const seed = (x, y, salt) => {
    const n =
      Math.sin(
        ((x + cells) % cells) * 127.1 + ((y + cells) % cells) * 311.7 + salt,
      ) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x * cells) / size,
        v = (y * cells) / size;
      let nearest = Infinity,
        next = Infinity;
      for (let i = -1; i <= 1; i++)
        for (let j = -1; j <= 1; j++) {
          const a = Math.floor(u) + i,
            b = Math.floor(v) + j;
          const distance = Math.hypot(
            a + 0.15 + 0.7 * seed(a, b, 0) - u,
            b + 0.15 + 0.7 * seed(a, b, 9) - v,
          );
          if (distance < nearest) {
            next = nearest;
            nearest = distance;
          } else next = Math.min(next, distance);
        }
      pixels[y * (size + 1) + x + 1] = Math.round(
        222 + 32 * Math.min(1, 4 * (next - nearest)),
      );
    }
  grayscaleTexture(model, material, 'Pebbled calfskin', size, pixels);
}

function bookCoverCorner(s, side, end) {
  // Four folded brass shoes cap the cover thickness and return onto both faces.
  const outside = [
    [29, -0.2],
    [4, -0.2],
    [-0.2, 4],
    [-0.2, 25],
  ];
  const inside = [
    [26.5, 3.5],
    [6, 3.5],
    [3.5, 6],
    [3.5, 22.5],
  ];
  const point = ([u, v], z) => [
    side * (208.5 - u),
    142.5 + end * (142.5 - v),
    z,
  ];
  for (let i = 0; i < 3; i++) {
    const strip = [outside[i], outside[i + 1], inside[i + 1], inside[i]];
    if (side * end > 0) strip.reverse();
    for (const [z, reverse] of [
      [-5.8, false],
      [-12.6, true],
    ]) {
      const rim = strip.map((p) => point(p, z));
      face(s, reverse ? rim.reverse() : rim, brass);
    }
    for (let j = 0; j < 4; j++) {
      if ((i > 0 && j === 3) || (i < 2 && j === 1)) continue;
      const a = strip[j],
        b = strip[(j + 1) % 4];
      face(
        s,
        [point(a, -12.6), point(b, -12.6), point(b, -5.8), point(a, -5.8)],
        bronze,
      );
    }
  }
}

function bookBinding(cover, pages, hardware, side) {
  const oxblood = '#462420',
    espresso = '#381c19';
  const first = [cover, pages, hardware].map((s) => s.positions.length);
  panel(
    cover,
    side * 105,
    142.5,
    207,
    285,
    4.8,
    [
      [-12.2, 1.6],
      [-11.1, 0.35],
      [-9.2, 0],
      [-7.1, 0],
      [-6.2, 1.1],
    ],
    oxblood,
  );
  panel(
    cover,
    side * 5.6,
    142.5,
    5.3,
    280,
    2,
    [
      [-12.45, 0.65],
      [-12, 0],
    ],
    espresso,
  );

  // A shallow blind-stamped panel and olive sprig are pressed into the back.
  bezel(cover, side * 107, 142.5, 178, 254, 8, [
    [2.7, -12.2],
    [1.2, -12.9, espresso],
    [0, -12.2, '#613a30'],
  ]);
  bezel(cover, side * 107, 142.5, 166, 242, 5, [
    [1.4, -12.2],
    [0.6, -12.7, espresso],
    [0, -12.2, '#694334'],
  ]);
  const leafColor = '#744c3a';
  for (let j = 0; j < 4; j++)
    for (const branch of signs) {
      const y = 166 + j * 10,
        x = side * 107,
        reach = 13 - j * 1.8;
      const shape = [
        [x, y, -12.21],
        [x + branch * reach * 0.4, y + 9, -12.21],
        [x + branch * reach, y + 15, -12.21],
        [x + branch * reach * 0.7, y + 4, -12.21],
      ];
      if (branch < 0) shape.reverse();
      const vein = [x + branch * reach * 0.55, y + 7.5, -13.2];
      for (let i = 0; i < 4; i++)
        face(cover, [shape[i], shape[(i + 1) % 4], vein], leafColor);
    }
  rod(
    cover,
    [side * 107, 160, -12.35],
    [side * 107, 209, -12.35],
    0.8,
    leafColor,
    6,
  );

  // Each saddle stitch has a raised central ridge and tapers into its two holes.
  const stitch = (x, y, dx, dy, z) => {
    const n = Math.hypot(dx, dy),
      w = 0.42;
    const pts = [
      [x - dx / 2, y - dy / 2, z],
      [x - (dy / n) * w, y + (dx / n) * w, z],
      [x + dx / 2, y + dy / 2, z],
      [x + (dy / n) * w, y - (dx / n) * w, z],
    ];
    if (z < -10) pts.reverse();
    const crown = [x, y, z + (z < -10 ? -0.35 : 0.35)];
    for (let i = 0; i < 4; i++)
      face(cover, [pts[(i + 1) % 4], pts[i], crown], '#a17b5a');
  };
  for (const z of [-12.24, -6.16]) {
    for (let y = 18; y < 273; y += 8) stitch(side * 204.5, y, 0.75, 4.9, z);
    for (const edge of signs)
      for (let x = 16; x < 199; x += 8)
        stitch(side * x, 142.5 + edge * 138.1, 4.9, 0.65, z);
  }
  for (const end of signs) bookCoverCorner(hardware, side, end);

  // The exposed fore-edge shows sewn signatures and a stepped, gilt-edged top leaf.
  for (let layer = 0; layer < 5; layer++) {
    const base = -6.4 + layer * 1.2,
      offset = [0.3, 0.8, 0, 0.6, 0.25][layer];
    panel(
      pages,
      side * 102,
      142.5,
      195 + offset,
      270 + offset,
      2.3,
      [
        [base, 0.38],
        [base + 0.28, 0],
        [base + 0.96, 0],
        [base + 1.22, 0.3],
      ],
      ['#dfd4bc', '#f0e4c9', '#e1d2b3', '#efe6d2', '#e9ddc5'][layer],
    );
  }
  // The gutter dips below the two text quads and terminates at the binding strip.
  for (const [a, b, za, zb, color] of [
    [2, 4, -4.2, -2.7, '#bdab89'],
    [4, 6, -2.7, -1.25, '#dbceb4'],
    [6, 8, -1.25, -0.3, '#efe6d2'],
  ]) {
    const strip = [
      [side * a, 9, za],
      [side * b, 9, zb],
      [side * b, 276, zb],
      [side * a, 276, za],
    ];
    face(pages, side === 1 ? strip : strip.reverse(), color);
  }
  // A short folded spring clip sits on the outer paper margin, clear of the canvas.
  panel(
    hardware,
    side * 199.45,
    65,
    2.3,
    32,
    1.1,
    [
      [-5.9, 0.2],
      [0.3, 0],
      [0.8, 0.35],
    ],
    gold,
  );
  for (let i = first[0]; i < cover.positions.length; i += 3) {
    const [x, y, z] = cover.positions.slice(i, i + 3);
    cover.uvs.push(x / 49, (y + z) / 49);
  }
  [cover, pages, hardware].forEach((s, i) => placeBookPart(s, first[i], side));
}

function menuBook() {
  const m = new Model();
  const cover = part(
    m,
    'MenuBook_Cover',
    'Charcoal espresso book linen',
    0.02,
    0.78,
  );
  const paper = part(m, 'MenuBook_Pages', 'Uncoated cotton paper', 0, 0.91);
  const hinge = part(m, 'MenuBook_Hinge', 'Satin dark bronze', 0.32, 0.67);
  const charcoal = '#262321',
    foldCloth = '#1e1c1a',
    darkBronze = '#6e5d48';

  // Warp and weft alternate over and under one another, with slight differences
  // in yarn width. The weave repeats every 22 mm across the book cloth.
  const size = 192,
    pixels = Buffer.alloc(size * (size + 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / 6 + 0.06 * Math.sin((TAU * y) / size);
      const v = y / 6 + 0.08 * Math.sin((TAU * (x + 2 * y)) / size);
      const warp = Math.sin(Math.PI * u) ** 2,
        weft = Math.sin(Math.PI * v) ** 2;
      const warpOnTop = (Math.floor(u) + Math.floor(v)) % 2 === 0;
      const yarn = warpOnTop
        ? 0.76 * warp + 0.24 * weft
        : 0.8 * weft + 0.2 * warp;
      pixels[y * (size + 1) + x + 1] = Math.round(217 + 36 * yarn);
    }
  }
  grayscaleTexture(m, cover.material, 'Plain-weave linen', size, pixels);
  const clothUVs = (first) => {
    for (let i = first; i < cover.positions.length; i += 3) {
      const [x, y, z] = cover.positions.slice(i, i + 3);
      cover.uvs.push((x + 0.5 * z) / 22, (y + z) / 22);
    }
  };

  for (const side of signs) {
    const startCover = cover.positions.length,
      startPaper = paper.positions.length;
    const cx = side * 102.6,
      cy = 142.5,
      w = 204.3,
      h = 278.2;
    const ring = (inset, z) =>
      outline(
        cx,
        cy,
        z,
        w - 2 * inset,
        h - 2 * inset,
        Math.max(0.7, 2.5 - inset * 0.2),
      );
    // The rear is a continuous surface. A 0.30 mm depression forms the
    // blind-rule border, including its floor and both sloping shoulders.
    const back = ring(0.65, -7.55);
    loft(
      cover,
      [back, ring(0, -6.85), ring(0, -3.7), ring(0.65, -3.05)],
      charcoal,
      { bottom: false },
    );
    let outer = back;
    for (const [inset, z, color] of [
      [7.25, -7.55, charcoal],
      [7.6, -7.25, foldCloth],
      [7.95, -7.25, foldCloth],
      [8.3, -7.55, charcoal],
    ]) {
      const inner = ring(inset, z);
      for (let i = 0; i < outer.length; i++) {
        const k = (i + 1) % outer.length;
        face(cover, [outer[i], outer[k], inner[k], inner[i]], color);
      }
      outer = inner;
    }
    face(cover, outer, charcoal);
    clothUVs(startCover);
    placeBookPart(cover, startCover, side);

    // Three cut paper sections share a 3 mm fore-edge. Their outer and
    // head/tail cuts sit 6 mm inside the cloth-covered boards.
    const sheetX = side * 103.25;
    for (const [bottom, top, w, h, color] of [
      [-3.15, -2.14, 191.0, 266.2, '#e8e0cf'],
      [-2.16, -1.17, 190.8, 265.9, '#ede5d6'],
      [-1.19, -0.15, 191.0, 266.2, '#f3ede0'],
    ]) {
      panel(
        paper,
        sheetX,
        cy,
        w,
        h,
        1.05,
        [
          [bottom, 0.09],
          [bottom + 0.15, 0],
          [top - 0.12, 0],
          [top, 0.1],
        ],
        color,
      );
    }
    // The paper curves down to the hinge only in the narrow unprinted gutter.
    const gutter = [
      [0.5, -2.85, '#cfc6b5'],
      [2.4, -2.25, '#dcd3c2'],
      [4.8, -0.9, '#e8e0cf'],
      [7.9, -0.12, '#f3ede0'],
    ];
    for (let i = 1; i < gutter.length; i++) {
      const [a, za] = gutter[i - 1],
        [b, zb, color] = gutter[i];
      const strip = [
        [side * a, 10, za],
        [side * b, 10, zb],
        [side * b, 275, zb],
        [side * a, 275, za],
      ];
      face(paper, side > 0 ? strip : strip.reverse(), color);
    }
    placeBookPart(paper, startPaper, side);

    const name = side < 0 ? 'Menu_Page_Left' : 'Menu_Page_Right';
    const material = m.material(name + ' cotton', {
      color: '#f3ede0',
      rough: 0.91,
    });
    const canvas = m.surface(
      material,
      name,
      bookPoint(side, side * 103, cy, 0),
    );
    face(
      canvas,
      [
        [-95, -132.5],
        [95, -132.5],
        [95, 132.5],
        [-95, 132.5],
      ].map(([x, y]) => bookVector(side, x, y, 0)),
      '#ffffff',
      uv,
    );
  }

  const spine = cover.positions.length;
  panel(
    cover,
    0,
    142.5,
    6.2,
    277.5,
    1.7,
    [
      [-7.7, 0.6],
      [-7.1, 0],
      [-3.8, 0],
      [-3.25, 0.4],
    ],
    foldCloth,
  );
  clothUVs(spine);
  placeBookPart(cover, spine, 0);

  // Only the rear reveals the narrow metal hinge. Each rivet is seated below
  // the face of the bar, inside a small countersink.
  const half = 1.75,
    bottom = 10,
    top = 275,
    rear = -7.97;
  const rearRect = (y0, y1) =>
    face(
      hinge,
      [
        [-half, y0, rear],
        [-half, y1, rear],
        [half, y1, rear],
        [half, y0, rear],
      ],
      darkBronze,
    );
  loft(
    hinge,
    [rear, -7.15].map((z) =>
      outline(0, (bottom + top) / 2, z, 2 * half, top - bottom, 0),
    ),
    darkBronze,
    { bottom: false },
  );
  let previous = bottom;
  for (const y of [24, 261]) {
    rearRect(previous, y - half);
    const at = (i, r, z, square = false) => {
      const a = (TAU * i) / 16,
        x = Math.cos(a),
        dy = Math.sin(a);
      const d = square ? r / Math.max(Math.abs(x), Math.abs(dy)) : r;
      return [d * x, y + d * dy, z];
    };
    const head = [];
    for (let i = 0; i < 16; i++) {
      const j = (i + 1) % 16;
      face(
        hinge,
        [
          at(j, half, rear, true),
          at(i, half, rear, true),
          at(i, 1.1, rear),
          at(j, 1.1, rear),
        ],
        darkBronze,
      );
      face(
        hinge,
        [
          at(j, 1.1, rear),
          at(i, 1.1, rear),
          at(i, 0.84, -7.79),
          at(j, 0.84, -7.79),
        ],
        '#51463b',
      );
      head.push(at(i, 0.84, -7.79));
    }
    face(hinge, head.reverse(), '#796957');
    previous = y + half;
  }
  rearRect(previous, top);
  placeBookPart(hinge, 0, 0);
  return m;
}

function reviewClipboard() {
  const m = new Model();
  const board = part(
    m,
    'Clipboard_Board',
    'Oiled quarter-sawn walnut',
    0.02,
    0.52,
  );
  const papers = part(m, 'Clipboard_Papers', 'Cotton cover stock', 0, 0.91);
  const clip = part(m, 'Clipboard_Clip', 'Brushed spring brass', 0.68, 0.39);

  // Four radiused corners continue around the small routed bevel on both faces.
  const boardRing = (z, inset) => {
    const points = [];
    for (let corner = 0; corner < 4; corner++) {
      const cx = [141, -141, -141, 141][corner],
        cy = [183, 183, -183, -183][corner];
      for (let i = 0; i <= 6; i++) {
        const angle = ((corner + i / 6) * TAU) / 4;
        points.push([
          cx + (7 - inset) * Math.cos(angle),
          cy + (7 - inset) * Math.sin(angle),
          z,
        ]);
      }
    }
    return points.reverse();
  };
  loft(
    board,
    [
      [-9, 1.3],
      [-8.6, 0.55],
      [-7.8, 0],
      [-1.1, 0],
      [-0.35, 0.55],
      [0, 1.3],
    ].map(([z, d]) => boardRing(z, d)),
    walnut,
  );
  walnutVeneer(m, board.material);
  for (let i = 0; i < board.positions.length; i += 3) {
    const [x, y, z] = board.positions.slice(i, i + 3);
    board.uvs.push((y + 0.5 * z) / 430, (x + z) / 180);
  }

  for (const [x, y, z0, z1, color] of [
    [1, -9, 0, 1.24, '#dfd5c3'],
    [0.65, -8.65, 1.18, 2.51, '#e9dfcf'],
    [-1, -7, 2.46, 4, '#f3ede0'],
  ]) {
    panel(
      papers,
      x,
      y,
      266,
      334,
      1.55,
      [
        [z0, 0.16],
        [z0 + 0.22, 0],
        [z1 - 0.14, 0],
        [z1, 0.1],
      ],
      color,
    );
  }
  canvas(m, 'Review_Card_Face', [0, -8, 4.6], 262, 330, '#f3ede0');

  // The stationary plate seats against the wood. The folded jaw rocks on a
  // transverse pin, with its rolled nose just touching the top sheet.
  panel(
    clip,
    0,
    173.3,
    107,
    15.4,
    3.2,
    [
      [-0.15, 0.6],
      [0.55, 0],
      [2.55, 0],
      [3, 0.5],
    ],
    bronze,
  );
  for (const side of signs) {
    panel(
      clip,
      side * 41,
      170.7,
      4.6,
      8,
      1.4,
      [
        [2.8, 0.25],
        [5.8, 0],
        [7.4, 0.55],
      ],
      brass,
    );
    rod(
      clip,
      [side * 46, 173.6, -8.7],
      [side * 46, 173.6, -9.16],
      1.8,
      bronze,
      16,
    );
    // The head sits below the raised outer rim of the rivet cup.
    const seat = (r, z) =>
      Array.from({ length: 20 }, (_, i) => {
        const a = (-TAU * i) / 20;
        return [side * 46 + r * Math.cos(a), 173.6 + r * Math.sin(a), z];
      });
    loft(
      clip,
      [seat(2.45, 2.9), seat(2.45, 3.2), seat(1.8, 3.58), seat(1.4, 3.27)],
      brass,
    );
  }
  rod(clip, [-43.4, 169.8, 6.15], [43.4, 169.8, 6.15], 1.48, bronze, 16);
  for (const side of signs) {
    const spring = Array.from({ length: 39 }, (_, i) => {
      const t = i / 38,
        a = 4 * TAU * t;
      return [
        side * (28.3 + 7.8 * t),
        169.8 + 2.04 * Math.cos(a),
        6.15 + 2.04 * Math.sin(a),
      ];
    });
    sweep(clip, spring, 0.57, gold, 8);
  }
  loft(
    clip,
    [
      [157.65, 4.7, 111.4, 1.5],
      [158.85, 5.05, 116, 2.1],
      [160.6, 5.95, 115, 1.8],
      [164.4, 7.4, 100, 1.5],
      [167.25, 7.65, 57, 1.45],
      [170.3, 7.2, 49, 1.5],
      [174.9, 6.7, 51, 1.5],
      [178.4, 7.3, 56, 1.55],
      [180.2, 7.35, 53, 1.55],
    ].map(([y, z, w, d]) => rect(0, y, z, w, d, 0.65)),
    brass,
  );
  rod(clip, [-55.3, 158.7, 4.75], [55.3, 158.7, 4.75], 0.78, gold, 12);

  const arch = Array.from({ length: 17 }, (_, i) => {
    const a = Math.PI * (1 - i / 16);
    return [10.5 * Math.cos(a), 181.4 + 9.35 * Math.sin(a), 2.15];
  });
  sweep(
    clip,
    [
      [-13, 176.2, 1.65],
      [-11, 178.8, 2.1],
      ...arch,
      [11, 178.8, 2.1],
      [13, 176.2, 1.65],
    ],
    1.25,
    brass,
    12,
  );

  const key = part(
    m,
    'Review_Dismiss_Btn',
    'Lacquered crimson clasp',
    0.25,
    0.45,
    [112, 165, 5],
  );
  panel(
    key,
    0,
    0,
    48,
    26,
    3.1,
    [
      [-4.5, 0.8],
      [-3.7, 0],
      [-1.65, 0],
      [-1.1, 0.45],
    ],
    brass,
  );
  panel(
    key,
    0,
    0,
    47,
    25,
    2.8,
    [
      [-1.4, 0.35],
      [-0.7, 0],
      [2.9, 0.5],
      [4.5, 1.65],
    ],
    red,
  );
  canvas(m, 'Review_Dismiss_Face', [112, 165, 10.2], 40, 19, '#8c313f');
  return m;
}

export function physicalUi(dir) {
  mkdirSync(dir, { recursive: true });
  for (const [filename, build] of [
    ['vr-control-deck', controlDeck],
    ['venue-pin-flag', venueFlag],
    ['station-medallion', stationMedallion],
    ['table-menu-stand', menuStand],
    ['room-plaque-stand', plaqueStand],
    ['menu-book', menuBook],
    ['review-clipboard', reviewClipboard],
  ]) {
    const model = build();
    for (const s of model.surfaces) {
      s.positions = s.positions.map((v) => v / 1000);
      if (s.translation) s.translation = s.translation.map((v) => v / 1000);
    }
    model.save(join(dir, filename + '.glb'));
    const vertices = model.surfaces.reduce(
      (n, s) => n + s.positions.length / 3,
      0,
    );
    const triangles = model.surfaces.reduce(
      (n, s) => n + s.indices.length / 3,
      0,
    );
    console.log(
      `${filename}: ${vertices} vertices, ${triangles} triangles, ${model.surfaces.length} primitives`,
    );
    console.log(model.surfaces.map((s) => s.name).join(', '));
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  physicalUi(
    process.argv[2] ?? fileURLToPath(new URL('./output/', import.meta.url)),
  );
