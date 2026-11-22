import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';
import type { Asset, Vector3 } from '@faresight/shared';
import type { Config } from '../config.ts';
import { decimatePly, decimateSpz } from './splatDecimate.ts';
import type { PlyLayout } from './splatDecimate.ts';
import { upgradeSpz } from './spzUpgrade.ts';

const run = promisify(execFile);
const options = { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 };
const scalarBytes: Record<string, number> = {
  char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2,
  int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8,
};
const gaussianProperties = [
  'f_dc_0', 'f_dc_1', 'f_dc_2', 'scale_0', 'scale_1', 'scale_2',
  'rot_0', 'rot_1', 'rot_2', 'rot_3',
];

export function inspectSplat(buffer: Buffer, centerDish = false) {
  const header = /(?:^|\n)end_header\r?\n/.exec(buffer.toString('ascii', 0, 65536));
  if (!header) throw new Error('PLY header is missing or too long');
  const offset = header.index + header[0].length;
  const lines = buffer.toString('ascii', 0, offset).split(/\r?\n/);
  if (lines[0] !== 'ply') throw new Error('File is not a PLY');
  const format = lines.find((line) => line.startsWith('format '))?.split(/\s+/)[1];
  if (format !== 'binary_little_endian' && format !== 'binary_big_endian') {
    throw new Error('Gaussian PLY must use binary encoding');
  }

  const element = lines.findIndex((line) => line.startsWith('element '));
  const [, elementName, declaredCount] = lines[element]?.split(/\s+/) ?? [];
  const count = Number(declaredCount);
  if (elementName !== 'vertex' || !Number.isSafeInteger(count) || count < 1) {
    throw new Error('PLY must begin with a nonempty vertex element');
  }

  const properties = new Map<string, { offset: number; type: string }>();
  let stride = 0;
  for (const line of lines.slice(element + 1)) {
    const [directive, type, name] = line.split(/\s+/);
    if (directive === 'element' || directive === 'end_header') break;
    if (directive !== 'property') continue;
    if (!Object.hasOwn(scalarBytes, type) || properties.has(name)) throw new Error('Invalid Gaussian vertex property');
    properties.set(name, { offset: stride, type });
    stride += scalarBytes[type];
  }
  const hasOpacity = properties.has('opacity') || properties.has('opacity_linear');
  if (offset + stride * count > buffer.length || !hasOpacity || !gaussianProperties.every((name) => properties.has(name))) {
    throw new Error('PLY vertex payload is truncated or missing Gaussian properties');
  }

  const coordinates = ['x', 'y', 'z'].map((axis) => {
    const property = properties.get(axis);
    if (!property || !['float', 'float32', 'double', 'float64'].includes(property.type)) {
      throw new Error(`PLY vertex is missing floating-point ${axis} centers`);
    }
    const double = property.type === 'double' || property.type === 'float64';
    const little = format === 'binary_little_endian';
    return {
      offset: property.offset,
      read: double ? (little ? 'readDoubleLE' : 'readDoubleBE') : (little ? 'readFloatLE' : 'readFloatBE'),
      write: double ? (little ? 'writeDoubleLE' : 'writeDoubleBE') : (little ? 'writeFloatLE' : 'writeFloatBE'),
    } as const;
  });

  const min: Vector3 = [Infinity, Infinity, Infinity];
  const max: Vector3 = [-Infinity, -Infinity, -Infinity];
  const xs = new Float64Array(count);
  const zs = new Float64Array(count);
  for (let index = 0; index < count; index++) {
    const row = offset + index * stride;
    for (const [axis, coordinate] of coordinates.entries()) {
      const value = buffer[coordinate.read](row + coordinate.offset);
      if (!Number.isFinite(value)) throw new Error('PLY has nonfinite Gaussian centers');
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
      if (axis === 0) xs[index] = value;
      if (axis === 2) zs[index] = value;
    }
  }
  const quantile = (sorted: Float64Array, percentile: number) => {
    const index = (sorted.length - 1) * percentile;
    const below = Math.floor(index);
    return sorted[below] + (sorted[Math.ceil(index)] - sorted[below]) * (index - below);
  };
  xs.sort();
  zs.sort();
  const x5 = quantile(xs, 0.05);
  const x95 = quantile(xs, 0.95);
  const z5 = quantile(zs, 0.05);
  const z95 = quantile(zs, 0.95);
  const width = Math.max(x95 - x5, z95 - z5);
  if (centerDish) {
    for (const [axis, midpoint] of [[0, (x5 + x95) / 2], [2, (z5 + z95) / 2]] as const) {
      const coordinate = coordinates[axis];
      for (let index = 0; index < count; index++) {
        const at = offset + index * stride + coordinate.offset;
        buffer[coordinate.write](buffer[coordinate.read](at) - midpoint, at);
      }
      min[axis] -= midpoint;
      max[axis] -= midpoint;
    }
  }
  const layout: PlyLayout = { offset, stride, count, little: format === 'binary_little_endian', properties };
  return { count, bounds: { min, max }, width, layout };
}

/** No published splat has more Gaussians than this. Rooms are cut to it; dishes are cut much lower. */
export const maxGaussians = 400_000;

let cli: Promise<string[] | undefined> | undefined;
function splatCli(): Promise<string[] | undefined> {
  cli ??= (async () => {
    for (const command of [['splat-transform'], ['npx', '--no-install', '@playcanvas/splat-transform']]) {
      try {
        await run(command[0], [...command.slice(1), '--version'], { timeout: 4000 });
        return command;
      } catch {
        continue;
      }
    }
    return undefined;
  })();
  return cli;
}

export async function convertSplat(config: Config, jobId: string, kind: 'room' | 'dish', original: string) {
  const format: 'spz' | 'ply' = extname(original) === '.spz' ? 'spz' : 'ply';
  const normalized = format === 'spz' ? original : resolve(config.outputs, `${jobId}-normalized.ply`);
  const limited = resolve(config.outputs, `${jobId}-decimated.ply`);
  const sog = resolve(config.outputs, `${jobId}.sog`);
  const temporary = resolve(config.outputs, `${jobId}.part.sog`);
  let geometry: { count: number; bounds?: NonNullable<Asset['metadata']>['bounds']; width?: number; layout?: PlyLayout };
  if (format === 'spz') {
    geometry = { count: await readSpzCount(original) };
  } else {
    const payload = await readFile(original);
    geometry = inspectSplat(payload, kind === 'dish');
    await writeFile(`${normalized}.part`, payload);
    await rename(`${normalized}.part`, normalized);
  }
  const target = kind === 'room' ? maxGaussians : 60_000;
  const command = await splatCli();
  const decimate = geometry.count > target;
  // SplatTransform requires .ply output when --decimate is the final action.
  const commands = [
    ...(decimate ? [['--gpu', 'cpu', normalized, '--decimate', String(target), limited]] : []),
    ['--gpu', 'cpu', decimate ? limited : normalized, temporary],
  ];
  const executable = command ?? ['splat-transform'];
  const metadata: NonNullable<Asset['metadata']> = {
    bounds: geometry.bounds, measured_width: geometry.width, target_gaussians: target,
    splat_transform_command: commands.map((args) => displayCommand([...executable, ...args])).join(' && '),
    conversion_status: format === 'spz' ? 'spz_fallback' : 'ply_fallback',
  };
  if (command) {
    try {
      const [binary, ...prefix] = command;
      await rm(temporary, { force: true });
      await rm(limited, { force: true });
      let count = geometry.count;
      if (decimate) {
        await run(binary, [...prefix, ...commands[0]], options);
        count = inspectSplat(await readFile(limited)).count;
      }
      await run(binary, [...prefix, ...commands.at(-1)!], options);
      if (!(await stat(temporary)).size) throw new Error('SplatTransform produced an empty SOG');
      await rename(temporary, sog);
      metadata.conversion_status = 'compressed';
      return { path: sog, count, format: 'sog' as const, metadata };
    } catch {
      await rm(temporary, { force: true });
    } finally {
      await rm(limited, { force: true });
    }
  }
  if (format === 'spz') {
    // Served as is, so it has to be a version the viewer can read. Atlas still writes version 2.
    // Without SplatTransform it is also cut down to the target here, or a full Atlas room is too heavy to render smoothly.
    const reduced = decimateSpz(await readFile(original), target);
    const source = reduced?.file ?? await readFile(original);
    const viewable = upgradeSpz(source) ?? reduced?.file;
    if (viewable) {
      const path = resolve(config.outputs, `${jobId}.spz`);
      await writeFile(`${path}.part`, viewable);
      await rename(`${path}.part`, path);
      if (reduced) metadata.conversion_status = 'spz_decimated';
      return { path, count: reduced?.count ?? geometry.count, format, metadata };
    }
  }
  if (geometry.layout) {
    const reduced = decimatePly(await readFile(normalized), geometry.layout, target);
    if (reduced) {
      await writeFile(`${normalized}.part`, reduced.file);
      await rename(`${normalized}.part`, normalized);
      metadata.conversion_status = 'ply_decimated';
      return { path: normalized, count: reduced.count, format, metadata };
    }
  }
  return { path: normalized, count: geometry.count, format, metadata };
}

function displayCommand(args: string[]) {
  return args.map((value) => /^[a-zA-Z0-9_@./-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'").join(' ');
}

async function readSpzCount(path: string) {
  const header = Buffer.alloc(16);
  const file = await open(path, 'r');
  let length: number;
  try {
    ({ bytesRead: length } = await file.read(header));
  } finally {
    await file.close();
  }
  if (length >= 2 && header[0] === 0x1f && header[1] === 0x8b) {
    length = 0;
    for await (const chunk of createReadStream(path).compose(createGunzip())) {
      length += (chunk as Buffer).copy(header, length);
      if (length === header.length) break;
    }
  }
  const count = header.readUInt32LE(8);
  if (length < header.length || header.toString('ascii', 0, 4) !== 'NGSP' || !count) throw new Error('Invalid SPZ header');
  return count;
}

export function measureScale(plateDiameter: number | null | undefined, width: number | undefined) {
  if (plateDiameter && width && width > 0) {
    return {
      scale_factor: plateDiameter / width, scale_status: 'measured' as const,
      scale_label: `Actual size (${Number((plateDiameter * 100).toFixed(1))} cm plate)`, plate_diameter_m: plateDiameter,
    };
  }
  return { scale_factor: 1, scale_status: 'approximate' as const, scale_label: 'Approximate size', plate_diameter_m: plateDiameter ?? null };
}
