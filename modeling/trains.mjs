// One train model per MBTA line, built from Flowcast's own asset.
//
// An earlier version modelled these procedurally and they read as grey lumps: at this scale the
// hand-built hull lost its livery and its window band, and nothing about it said "Green Line
// train". So the geometry now comes straight from Flowcast's mbta-green-line-train.glb, vendored
// into modeling/vendor/ and recoloured per line.
//
// That model suits the job well: 3436 triangles across 16 primitives, one per material, with no
// textures at all -- every colour is a baseColorFactor. Recolouring a line is therefore a matter
// of swapping one material's factor, and the geometry stays byte-identical to Flowcast's.
//
// The accent material is `mbta_green`, which holds #00843D converted to linear. Each line gets its
// own official colour in that slot.
//
// One honest limitation: Flowcast only ships the Green Line LRV, so Red, Orange and Blue reuse its
// bodyshell. Their real rolling stock is heavy rail and shaped differently. The livery and the
// detailing are right; the carbody is a stand-in until those models exist.
import { readFileSync, writeFileSync } from 'node:fs';

/** The material slot holding the line accent in Flowcast's model. */
const ACCENT = 'mbta_green';

/** glTF stores colour factors in linear space, so sRGB hex has to be converted. */
const toLinear = (hex) =>
  [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });

export const TRAINS = {
  green: { file: 'mbta-train-green.glb', accent: '#00843D' },
  red: { file: 'mbta-train-red.glb', accent: '#DA291C' },
  orange: { file: 'mbta-train-orange.glb', accent: '#ED8B00' },
  blue: { file: 'mbta-train-blue.glb', accent: '#003DA5' },
};

/** Split a .glb into its JSON and binary chunks. */
function readGlb(file) {
  const bytes = readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const json = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString('utf8'));
  // The BIN chunk follows the JSON chunk's own 8-byte header.
  const binStart = 20 + jsonLength;
  const binLength = bytes.readUInt32LE(binStart);
  const bin = bytes.subarray(binStart + 8, binStart + 8 + binLength);
  return { json, bin };
}

/** Reassemble a .glb. Chunks are padded to four bytes: JSON with spaces, BIN with zeros. */
function writeGlb(file, json, bin) {
  const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const jsonChunk = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
  const binChunk = Buffer.concat([bin, Buffer.alloc(binPad)]);

  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + binChunk.length, 8);

  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonChunk.length, 0);
  jsonHeader.write('JSON', 4);

  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(binChunk.length, 0);
  binHeader.write('BIN\0', 4);

  writeFileSync(file, Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]));
}

/** Write every line's train model into `dir`. */
export function trains(dir) {
  const source = new URL('vendor/mbta-green-line-train.glb', import.meta.url);
  const { json, bin } = readGlb(source);

  const accentIndex = json.materials.findIndex((m) => m.name === ACCENT);
  if (accentIndex < 0)
    throw new Error(`vendored train model has no "${ACCENT}" material to recolour`);

  for (const [line, spec] of Object.entries(TRAINS)) {
    // Deep copy so each line writes its own document and they cannot share mutated state.
    const doc = JSON.parse(JSON.stringify(json));
    const material = doc.materials[accentIndex];
    material.name = `mbta_${line}`;
    material.pbrMetallicRoughness = {
      ...material.pbrMetallicRoughness,
      baseColorFactor: [...toLinear(spec.accent), 1],
    };
    doc.asset = {
      ...doc.asset,
      extras: {
        ...(doc.asset.extras ?? {}),
        faresightLine: line,
        source: 'Flowcast mbta-green-line-train.glb, recoloured',
      },
    };
    writeGlb(dir + spec.file, doc, bin);
  }
}

/** Route id to model family, for the runtime. */
export const familyOf = (routeId) => {
  const family = String(routeId).split('-')[0].toLowerCase();
  return family in TRAINS ? family : 'green';
};
