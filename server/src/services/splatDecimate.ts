import { gunzipSync, gzipSync } from 'node:zlib';

const HEADER_BYTES = 16;
const SH_DIM_FOR_DEGREE = [0, 3, 8, 15];
/** Survivors grow by at most this much, to close the gaps left by the Gaussians that were dropped. */
const MAX_GROWTH = 1.3;

/** How much to enlarge each surviving Gaussian after cutting `count` down to `target`. */
export function growthFor(count: number, target: number) {
  return Math.min(MAX_GROWTH, Math.cbrt(count / target));
}

/**
 * Chooses which `target` Gaussians to keep, given each one's position per axis and a visibility score.
 * Returns their indices in ascending order.
 *
 * The scene is split into cubes. The most visible Gaussian of every cube is kept first, then the second
 * most visible of every cube, and so on until the target is reached. That keeps every part of the scene
 * covered, where taking the globally most visible ones would leave holes in finely detailed areas.
 */
export function pickGaussians(axes: (Int32Array | Float64Array)[], score: Float64Array, target: number): Uint32Array {
  const count = score.length;
  // Grid bounds ignore the outermost 1% on each side, so a few stray Gaussians cannot stretch the cubes.
  const low = [0, 0, 0];
  let extent = 1;
  for (let axis = 0; axis < 3; axis++) {
    const sorted = axes[axis].slice().sort();
    low[axis] = sorted[Math.floor((count - 1) * 0.01)];
    extent = Math.max(extent, sorted[Math.ceil((count - 1) * 0.99)] - low[axis]);
  }
  const cells = new Uint32Array(count);
  const fill = (perSide: number) => {
    for (let index = 0; index < count; index++) {
      let cell = 0;
      for (let axis = 2; axis >= 0; axis--) {
        const at = Math.floor((axes[axis][index] - low[axis]) / extent * perSide);
        cell = cell * perSide + Math.max(0, Math.min(perSide - 1, at));
      }
      cells[index] = cell;
    }
  };
  // The finest grid with no more occupied cubes than the target, so every cube keeps at least one Gaussian.
  let perSide = 1024;
  for (; perSide > 2; perSide /= 2) {
    fill(perSide);
    const sorted = cells.slice().sort();
    let occupied = 1;
    for (let index = 1; index < count; index++) if (sorted[index] !== sorted[index - 1]) occupied++;
    if (occupied <= target) break;
  }
  if (perSide === 2) fill(perSide);

  const order = new Uint32Array(count).map((_, index) => index);
  order.sort((a, b) => cells[a] - cells[b] || score[b] - score[a]);
  const rank = new Uint32Array(count);
  for (let at = 1; at < count; at++) {
    if (cells[order[at]] === cells[order[at - 1]]) rank[order[at]] = rank[order[at - 1]] + 1;
  }
  order.sort((a, b) => rank[a] - rank[b] || score[b] - score[a]);
  // Back in file order, which keeps neighbours together and so compresses better.
  return order.slice(0, target).sort();
}

/**
 * Cuts a gzipped SPZ (version 2 or 3) down to `target` Gaussians. Returns nothing when the file is
 * already small enough or is not a version this reads.
 */
export function decimateSpz(file: Buffer, target: number): { file: Buffer; count: number } | undefined {
  if (file.length < 2 || file[0] !== 0x1f || file[1] !== 0x8b) return undefined;
  const data = gunzipSync(file);
  if (data.length < HEADER_BYTES || data.toString('ascii', 0, 4) !== 'NGSP') return undefined;
  const version = data.readUInt32LE(4);
  if (version !== 2 && version !== 3) return undefined;
  const count = data.readUInt32LE(8);
  if (count <= target) return undefined;
  const shDim = SH_DIM_FOR_DEGREE[data[12]];
  if (shDim === undefined) throw new Error(`Invalid SPZ: unsupported SH degree ${data[12]}`);
  // Stream order and bytes per Gaussian: positions, alphas, colors, scales, rotations, spherical harmonics.
  const widths = [9, 1, 3, 3, version === 2 ? 3 : 4, shDim * 3];
  const starts = widths.map((_, stream) => HEADER_BYTES + count * widths.slice(0, stream).reduce((sum, width) => sum + width, 0));
  const [positions, alphas, , scales] = starts;
  if (data.length < starts[5] + count * widths[5]) throw new Error('Invalid SPZ: file is shorter than its header says');

  // Visibility: opacity times the area of the Gaussian's two longest axes. Scales are stored as log values, 16 steps per e.
  const score = new Float64Array(count);
  const axes = [new Int32Array(count), new Int32Array(count), new Int32Array(count)];
  for (let index = 0; index < count; index++) {
    const scale = scales + index * 3;
    const smallest = Math.min(data[scale], data[scale + 1], data[scale + 2]);
    score[index] = data[alphas + index] * Math.exp((data[scale] + data[scale + 1] + data[scale + 2] - smallest) / 16);
    for (let axis = 0; axis < 3; axis++) axes[axis][index] = data.readIntLE(positions + index * 9 + axis * 3, 3);
  }

  const kept = pickGaussians(axes, score, target);

  const output = Buffer.alloc(HEADER_BYTES + target * widths.reduce((sum, width) => sum + width, 0));
  data.copy(output, 0, 0, HEADER_BYTES);
  output.writeUInt32LE(target, 8);
  let write = HEADER_BYTES;
  const growth = Math.round(16 * Math.log(growthFor(count, target)));
  for (const [stream, width] of widths.entries()) {
    for (const index of kept) {
      const from = starts[stream] + index * width;
      data.copy(output, write, from, from + width);
      if (stream === 3) for (let axis = 0; axis < 3; axis++) output[write + axis] = Math.min(255, output[write + axis] + growth);
      write += width;
    }
  }
  return { file: gzipSync(output), count: target };
}

/** Where the vertex rows of a binary Gaussian PLY sit, as `inspectSplat` reports it. */
export interface PlyLayout {
  offset: number;
  stride: number;
  count: number;
  little: boolean;
  properties: Map<string, { offset: number; type: string }>;
}

/**
 * Cuts a binary Gaussian PLY down to `target` Gaussians, the same way as `decimateSpz`. Returns nothing
 * when it is already small enough or stores scale or opacity as something other than floating point.
 */
export function decimatePly(buffer: Buffer, layout: PlyLayout, target: number): { file: Buffer; count: number } | undefined {
  const { offset, stride, count, little, properties } = layout;
  if (count <= target) return undefined;
  const field = (name: string) => {
    const property = properties.get(name);
    if (!property) return undefined;
    const double = property.type === 'double' || property.type === 'float64';
    if (!double && property.type !== 'float' && property.type !== 'float32') return undefined;
    return {
      read: (row: number) => {
        const at = offset + row * stride + property.offset;
        return double ? (little ? buffer.readDoubleLE(at) : buffer.readDoubleBE(at)) : (little ? buffer.readFloatLE(at) : buffer.readFloatBE(at));
      },
      add: (target: Buffer, at: number, amount: number) => {
        const position = at + property.offset;
        if (double) {
          if (little) target.writeDoubleLE(target.readDoubleLE(position) + amount, position);
          else target.writeDoubleBE(target.readDoubleBE(position) + amount, position);
        } else if (little) target.writeFloatLE(target.readFloatLE(position) + amount, position);
        else target.writeFloatBE(target.readFloatBE(position) + amount, position);
      },
    };
  };
  const centers = ['x', 'y', 'z'].map(field);
  const scales = ['scale_0', 'scale_1', 'scale_2'].map(field);
  // `opacity` is stored before the sigmoid, `opacity_linear` after it.
  const logit = field('opacity');
  const linear = field('opacity_linear');
  if (centers.includes(undefined) || scales.includes(undefined) || !(logit ?? linear)) return undefined;

  const score = new Float64Array(count);
  const axes = [new Float64Array(count), new Float64Array(count), new Float64Array(count)];
  for (let row = 0; row < count; row++) {
    for (let axis = 0; axis < 3; axis++) axes[axis][row] = centers[axis]!.read(row);
    // Scales are stored as natural logs.
    const logs = scales.map((scale) => scale!.read(row));
    const opacity = logit ? 1 / (1 + Math.exp(-logit.read(row))) : linear!.read(row);
    score[row] = opacity * Math.exp(logs[0] + logs[1] + logs[2] - Math.min(...logs));
  }
  const kept = pickGaussians(axes, score, target);

  const header = buffer.toString('ascii', 0, offset).replace(/^element vertex \d+/m, `element vertex ${target}`);
  const end = offset + count * stride;
  // Anything after the vertex rows (other elements) is carried over unchanged.
  const output = Buffer.alloc(Buffer.byteLength(header, 'ascii') + target * stride + buffer.length - end);
  let write = output.write(header, 'ascii');
  const growth = Math.log(growthFor(count, target));
  for (const row of kept) {
    buffer.copy(output, write, offset + row * stride, offset + (row + 1) * stride);
    for (const scale of scales) scale!.add(output, write, growth);
    write += stride;
  }
  buffer.copy(output, write, end);
  return { file: output, count: target };
}
