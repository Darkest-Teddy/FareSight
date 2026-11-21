import { execFile } from 'node:child_process';
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Asset, Vector3 } from '@faresight/shared';
import type { Config } from '../config.ts';

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
  return { count, bounds: { min, max }, width };
}

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
  const normalized = resolve(config.outputs, `${jobId}-normalized.ply`);
  const limited = resolve(config.outputs, `${jobId}-decimated.ply`);
  const sog = resolve(config.outputs, `${jobId}.sog`);
  const payload = await readFile(original);
  const geometry = inspectSplat(payload, kind === 'dish');
  await writeFile(`${normalized}.part`, payload);
  await rename(`${normalized}.part`, normalized);
  const target = kind === 'room' ? 100_000 : 60_000;
  const command = await splatCli();
  const decimate = geometry.count > target;
  const commands = [
    ...(decimate ? [['--gpu', 'cpu', normalized, '--decimate', String(target), limited]] : []),
    ['--gpu', 'cpu', decimate ? limited : normalized, sog],
  ];
  const executable = command ?? ['splat-transform'];
  const quote = (value: string) => /^[a-zA-Z0-9_@./-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'";
  const metadata: NonNullable<Asset['metadata']> = {
    bounds: geometry.bounds, measured_width: geometry.width, target_gaussians: target,
    splat_transform_command: commands.map((args) => [...executable, ...args].map(quote).join(' ')).join(' && '),
    conversion_status: 'ply_fallback',
  };
  if (command) {
    try {
      const [binary, ...prefix] = command;
      await rm(sog, { force: true });
      await rm(limited, { force: true });
      let count = geometry.count;
      if (decimate) {
        await run(binary, [...prefix, ...commands[0]], options);
        count = inspectSplat(await readFile(limited)).count;
      }
      await run(binary, [...prefix, ...commands.at(-1)!], options);
      if (!(await stat(sog)).size) throw new Error('SplatTransform produced an empty SOG');
      metadata.conversion_status = 'compressed';
      return { path: sog, count, format: 'sog' as const, metadata };
    } catch {
      await rm(sog, { force: true });
    } finally {
      await rm(limited, { force: true });
    }
  }
  return { path: normalized, count: geometry.count, format: 'ply' as const, metadata };
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
