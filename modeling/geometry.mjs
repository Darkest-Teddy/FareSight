import { writeFileSync } from 'node:fs';

export const TAU = Math.PI * 2;
export const add = (a, b) => a.map((x, i) => x + b[i]);
export const sub = (a, b) => a.map((x, i) => x - b[i]);
export const mul = (a, s) => a.map((x) => x * s);
export const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
export const dot = (a, b) => a.reduce((n, x, i) => n + x * b[i], 0);
export const cross = ([a, b, c], [x, y, z]) => [
  b * z - c * y,
  c * x - a * z,
  a * y - b * x,
];
export const norm = (a) => mul(a, 1 / (Math.hypot(...a) || 1));
export function rng(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
export function rgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [n >> 16, (n >> 8) & 255, n & 255].map((v) => v / 255);
}
const linear = (x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4);
const colorCache = new Map();
function vertexColor(color) {
  if (!colorCache.has(color))
    colorCache.set(
      color,
      rgb(color).map((c) => Math.round(linear(c) * 255)),
    );
  return colorCache.get(color);
}
export class Surface {
  positions = [];
  normals = [];
  colors = [];
  indices = [];
  uvs = [];
  constructor(material, name, translation) {
    Object.assign(this, { material, name, translation });
  }
  vertex(p, n, color, uv) {
    const i = this.positions.length / 3;
    this.positions.push(...p);
    this.normals.push(...n);
    this.colors.push(...vertexColor(color), 255);
    if (uv) this.uvs.push(...uv);
    return i;
  }
}
export class Model {
  textures = [];
  materials = [];
  surfaces = [];
  batches = new Map();
  material(
    name,
    {
      metal = 0,
      rough = 0.55,
      alpha = 1,
      emission,
      double = false,
      color = '#ffffff',
    } = {},
  ) {
    const mat = {
      name,
      pbrMetallicRoughness: {
        baseColorFactor: [...rgb(color).map(linear), alpha],
        metallicFactor: metal,
        roughnessFactor: rough,
      },
    };
    if (alpha < 1) mat.alphaMode = 'BLEND';
    if (double) mat.doubleSided = true;
    if (emission) mat.emissiveFactor = rgb(emission).map(linear);
    return this.materials.push(mat) - 1;
  }
  surface(material, name = this.materials[material].name, translation) {
    const key = material + '|' + name;
    if (!this.batches.has(key)) {
      const s = new Surface(material, name, translation);
      this.batches.set(key, s);
      this.surfaces.push(s);
    }
    return this.batches.get(key);
  }
  save(file, extras) {
    const gltf = {
      ...(extras && { extras }),
      asset: { version: '2.0', generator: 'FareSight procedural studio' },
      scene: 0,
      scenes: [{ nodes: [] }],
      nodes: [],
      meshes: [],
      materials: this.materials,
      buffers: [],
      bufferViews: [],
      accessors: [],
    };
    const parts = [];
    let size = 0;
    function accessor(arr, kind, type, n, target, normalized = false) {
      const data =
        kind === 5126
          ? new Float32Array(arr)
          : kind === 5123
            ? new Uint16Array(arr)
            : kind === 5125
              ? new Uint32Array(arr)
              : new Uint8Array(arr);
      const bytes = Buffer.from(data.buffer);
      const view =
        gltf.bufferViews.push({
          buffer: 0,
          byteOffset: size,
          byteLength: bytes.length,
          target,
        }) - 1;
      const padded = Buffer.alloc((bytes.length + 3) & ~3);
      bytes.copy(padded);
      parts.push(padded);
      size += padded.length;
      const min = Array(n).fill(Infinity),
        max = Array(n).fill(-Infinity);
      for (let i = 0; i < data.length; i++) {
        const d = i % n;
        min[d] = Math.min(min[d], data[i]);
        max[d] = Math.max(max[d], data[i]);
      }
      return (
        gltf.accessors.push({
          bufferView: view,
          componentType: kind,
          count: data.length / n,
          type,
          min,
          max,
          ...(normalized ? { normalized: true } : {}),
        }) - 1
      );
    }
    for (const s of this.surfaces.filter((s) => s.indices.length)) {
      const attrs = {
        POSITION: accessor(s.positions, 5126, 'VEC3', 3, 34962),
        NORMAL: accessor(s.normals, 5126, 'VEC3', 3, 34962),
        COLOR_0: accessor(s.colors, 5121, 'VEC4', 4, 34962, true),
      };
      if (s.uvs.length)
        attrs.TEXCOORD_0 = accessor(s.uvs, 5126, 'VEC2', 2, 34962);
      const indices = accessor(
        s.indices,
        s.positions.length / 3 > 65535 ? 5125 : 5123,
        'SCALAR',
        1,
        34963,
      );
      const mesh =
        gltf.meshes.push({
          name: s.name,
          primitives: [{ attributes: attrs, indices, material: s.material }],
        }) - 1;
      const node =
        gltf.nodes.push({
          name: s.name,
          mesh,
          ...(s.translation ? { translation: s.translation } : {}),
        }) - 1;
      gltf.scenes[0].nodes.push(node);
    }
    if (this.textures.length) {
      gltf.images = [];
      gltf.textures = [];
      for (const { bytes, name, material, sampler } of this.textures) {
        const bufferView =
          gltf.bufferViews.push({
            buffer: 0,
            byteOffset: size,
            byteLength: bytes.length,
          }) - 1;
        const padded = Buffer.alloc((bytes.length + 3) & ~3);
        bytes.copy(padded);
        parts.push(padded);
        size += padded.length;
        const source =
          gltf.images.push({ name, mimeType: 'image/png', bufferView }) - 1;
        const texture = { source };
        if (sampler) {
          gltf.samplers ??= [];
          texture.sampler = gltf.samplers.push(sampler) - 1;
        }
        const index = gltf.textures.push(texture) - 1;
        gltf.materials[material].pbrMetallicRoughness.baseColorTexture = {
          index,
        };
        gltf.materials[material].emissiveTexture = { index };
      }
    }
    gltf.buffers.push({ byteLength: size });
    const json = Buffer.from(JSON.stringify(gltf));
    const j = Buffer.alloc((json.length + 3) & ~3, 32);
    json.copy(j);
    const h = Buffer.alloc(20);
    h.write('glTF');
    h.writeUInt32LE(2, 4);
    h.writeUInt32LE(28 + j.length + size, 8);
    h.writeUInt32LE(j.length, 12);
    h.write('JSON', 16);
    const b = Buffer.alloc(8);
    b.writeUInt32LE(size);
    b.write('BIN\0', 4);
    writeFileSync(file, Buffer.concat([h, j, b, ...parts]));
  }
}
export function face(s, pts, c, uv) {
  const normal = norm(cross(sub(pts[1], pts[0]), sub(pts[2], pts[0])));
  const ids = pts.map((p, i) => s.vertex(p, normal, c, uv?.[i]));
  for (let i = 1; i < ids.length - 1; i++)
    s.indices.push(ids[0], ids[i], ids[i + 1]);
}
export function loft(s, rings, c, { top = true, bottom = true } = {}) {
  const count = rings[0].length;
  for (let j = 1; j < rings.length; j++)
    for (let i = 0; i < count; i++) {
      const k = (i + 1) % count;
      face(s, [rings[j - 1][i], rings[j][i], rings[j][k], rings[j - 1][k]], c);
    }
  if (bottom) face(s, rings[0], c);
  if (top) face(s, [...rings.at(-1)].reverse(), c);
}
export function rect(x, y, z, w, d, ch = 0) {
  const a = w / 2,
    b = d / 2,
    k = Math.min(ch, a * 0.95, b * 0.95);
  return (
    k
      ? [
          [a, -b + k],
          [a, b - k],
          [a - k, b],
          [-a + k, b],
          [-a, b - k],
          [-a, -b + k],
          [-a + k, -b],
          [a - k, -b],
        ]
      : [
          [a, -b],
          [a, b],
          [-a, b],
          [-a, -b],
        ]
  ).map(([u, v]) => [x + u, y, z + v]);
}
export function box(s, x, y, z, w, h, d, c, ch = 0) {
  loft(
    s,
    [rect(x, y - h / 2, z, w, d, ch), rect(x, y + h / 2, z, w, d, ch)],
    c,
  );
}
export function sweep(s, path, r, c, sides = 10, caps = true) {
  let u;
  const rings = [];
  for (let i = 0; i < path.length; i++) {
    const tangent = norm(
      sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)]),
    );
    u = u
      ? norm(sub(u, mul(tangent, dot(u, tangent))))
      : norm(
          cross(Math.abs(tangent[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], tangent),
        );
    const v = cross(tangent, u);
    const ring = [];
    const radius = typeof r === 'function' ? r(i) : r;
    for (let j = 0; j < sides; j++) {
      const angle = (TAU * j) / sides,
        n = add(mul(u, Math.cos(angle)), mul(v, Math.sin(angle)));
      ring.push(s.vertex(add(path[i], mul(n, radius)), n, c));
    }
    rings.push(ring);
    if (i)
      for (let j = 0; j < sides; j++) {
        const a = rings[i - 1],
          b = ring,
          k = (j + 1) % sides;
        s.indices.push(a[j], a[k], b[k], a[j], b[k], b[j]);
      }
  }
  if (caps)
    for (const [i, rev] of [
      [0, true],
      [rings.length - 1, false],
    ]) {
      const ring = rings[i].map((k) => s.positions.slice(k * 3, k * 3 + 3));
      face(s, rev ? ring.reverse() : ring, c);
    }
}
export function rod(s, a, b, r, c, n = 8) {
  sweep(s, [a, b], r, c, n);
}
export function circle(x, y, z, r, n = 32) {
  return Array.from({ length: n }, (_, i) => [
    x + r * Math.cos((i * TAU) / n),
    y,
    z + r * Math.sin((i * TAU) / n),
  ]);
}
export function ring(s, x, y, z, r, t, c, n = 32, sides = 6) {
  const p = circle(x, y, z, r, n);
  sweep(s, [...p, p[0]], t, c, sides, false);
}
export function ellipsoid(s, center, radii, c, lon = 10, lat = 6) {
  const rows = [];
  for (let j = 0; j <= lat; j++) {
    const a = (Math.PI * j) / lat;
    rows.push(
      Array.from({ length: lon }, (_, i) => {
        const b = (TAU * i) / lon,
          v = [
            Math.sin(a) * Math.cos(b),
            Math.cos(a),
            Math.sin(a) * Math.sin(b),
          ];
        return s.vertex(
          add(
            center,
            v.map((n, k) => n * radii[k]),
          ),
          norm(v.map((n, k) => n / radii[k])),
          c,
        );
      }),
    );
  }
  for (let j = 0; j < lat; j++)
    for (let i = 0; i < lon; i++) {
      const k = (i + 1) % lon,
        a = rows[j],
        b = rows[j + 1];
      if (j) s.indices.push(a[i], a[k], b[i]);
      if (j < lat - 1) s.indices.push(a[k], b[k], b[i]);
    }
}
// Centripetal Catmull–Rom with reflected endpoint controls, preserving every knot.
export function spline(pts, step = 0.019) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const b = pts[i],
      c = pts[i + 1],
      a = pts[i - 1] ?? sub(mul(b, 2), c),
      d = pts[i + 2] ?? sub(mul(c, 2), b);
    const dt = (p, q) => Math.sqrt(Math.hypot(...sub(q, p))),
      t1 = dt(a, b),
      t2 = t1 + dt(b, c),
      t3 = t2 + dt(c, d);
    const steps = Math.max(2, Math.ceil(Math.hypot(...sub(c, b)) / step));
    for (let j = 0; j < steps; j++) {
      const u = j / steps,
        t = t1 + u * (t2 - t1);
      const p = mix(a, b, t / t1),
        q = mix(b, c, u),
        r = mix(c, d, (t - t2) / (t3 - t2));
      out.push(mix(mix(p, q, t / t2), mix(q, r, (t - t1) / (t3 - t1)), u));
    }
  }
  return [...out, pts.at(-1)];
}
