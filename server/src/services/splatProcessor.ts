import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';
import type { Asset, Vector3 } from '@faresight/shared';
import type { Config } from '../config.ts';
import { MAX_SPLAT_BYTES, TerminalProviderError, type CommitFile } from './providerHttp.ts';
import { decimatePly, decimateSpz } from './splatDecimate.ts';
import type { PlyLayout } from './splatDecimate.ts';
import { upgradeSpz } from './spzUpgrade.ts';

const maxVertices = 2_000_000;
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
  if (!header) throw new TerminalProviderError('PLY header is missing or too long');
  const offset = header.index + header[0].length;
  const lines = buffer.toString('ascii', 0, offset).split(/\r?\n/);
  if (lines[0] !== 'ply') throw new TerminalProviderError('File is not a PLY');
  const format = lines.find((line) => line.startsWith('format '))?.split(/\s+/)[1];
  if (format !== 'binary_little_endian' && format !== 'binary_big_endian') {
    throw new TerminalProviderError('Gaussian PLY must use binary encoding');
  }

  const element = lines.findIndex((line) => line.startsWith('element '));
  const [, elementName, declaredCount] = lines[element]?.split(/\s+/) ?? [];
  const count = Number(declaredCount);
  if (elementName !== 'vertex' || !Number.isSafeInteger(count) || count < 1) {
    throw new TerminalProviderError('PLY must begin with a nonempty vertex element');
  }
  if (count > maxVertices) throw new TerminalProviderError('PLY vertex count exceeds the safety limit');

  const properties = new Map<string, { offset: number; type: string }>();
  let stride = 0;
  for (const line of lines.slice(element + 1)) {
    const [directive, type, name] = line.split(/\s+/);
    if (directive === 'element' || directive === 'end_header') break;
    if (directive !== 'property') continue;
    if (!Object.hasOwn(scalarBytes, type) || properties.has(name)) throw new TerminalProviderError('Invalid Gaussian vertex property');
    properties.set(name, { offset: stride, type });
    stride += scalarBytes[type];
  }
  const hasOpacity = properties.has('opacity') || properties.has('opacity_linear');
  if (offset + stride * count > buffer.length || !hasOpacity || !gaussianProperties.every((name) => properties.has(name))) {
    throw new TerminalProviderError('PLY vertex payload is truncated or missing Gaussian properties');
  }

  const coordinates = ['x', 'y', 'z'].map((axis) => {
    const property = properties.get(axis);
    if (!property || !['float', 'float32', 'double', 'float64'].includes(property.type)) {
      throw new TerminalProviderError(`PLY vertex is missing floating-point ${axis} centers`);
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
      if (!Number.isFinite(value)) throw new TerminalProviderError('PLY has nonfinite Gaussian centers');
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

export async function convertSplat(
  config: Config, jobId: string, kind: 'room' | 'dish', original: string, commit: CommitFile = rename,
) {
  const format: 'spz' | 'ply' = extname(original) === '.spz' ? 'spz' : 'ply';
  const unique = resolve(config.outputs, `${jobId}.${randomUUID()}.part`);
  const normalized = format === 'spz' ? original : `${unique}.ply`;
  const limited = `${unique}-decimated.ply`;
  const temporary = `${unique}.sog`;
  if ((await stat(original)).size > MAX_SPLAT_BYTES) throw new TerminalProviderError('Splat exceeds the byte limit');

  try {
    let geometry: { count: number; bounds?: NonNullable<Asset['metadata']>['bounds']; width?: number; layout?: PlyLayout };
    let spzVersion: number | undefined;
    if (format === 'spz') {
      const { count, version } = await readSpzHeader(original);
      geometry = { count };
      spzVersion = version;
    } else {
      const payload = await readFile(original);
      geometry = inspectSplat(payload, kind === 'dish');
      await writeFile(normalized, payload, { flag: 'wx' });
    }
    const target = kind === 'room' ? maxGaussians : 60_000;
    const command = await splatCli();
    const decimate = geometry.count > target;
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
    let convertedCount: number | undefined;
    if (command) {
      try {
        const [binary, ...prefix] = command;
        let count = geometry.count;
        if (decimate) {
          await run(binary, [...prefix, ...commands[0]], options);
          if ((await stat(limited)).size > MAX_SPLAT_BYTES) throw new Error('Decimated splat exceeds the byte limit');
          count = inspectSplat(await readFile(limited)).count;
        }
        await run(binary, [...prefix, ...commands.at(-1)!], options);
        const length = (await stat(temporary)).size;
        if (length > 0 && length <= MAX_SPLAT_BYTES) convertedCount = count;
      } catch {
        // A validated original can still be published when compression is unavailable.
      }
    }
    if (convertedCount !== undefined) {
      const sog = resolve(config.outputs, `${jobId}.sog`);
      await commit(temporary, sog);
      metadata.conversion_status = 'compressed';
      return { path: sog, count: convertedCount, format: 'sog' as const, metadata };
    }
    // Without SplatTransform the splat is cut down to the target here, or a full Atlas room is too
    // heavy to render smoothly.
    let fallback = original;
    let count = geometry.count;
    if (format === 'ply') {
      fallback = resolve(config.outputs, `${jobId}-normalized.ply`);
      const reduced = geometry.layout ? decimatePly(await readFile(normalized), geometry.layout, target) : undefined;
      if (reduced) {
        await writeFile(normalized, reduced.file);
        count = reduced.count;
        metadata.conversion_status = 'ply_decimated';
      }
      await commit(normalized, fallback);
    } else {
      // Served as is, so it also has to be a version the viewer can read. Atlas still writes version 2.
      let reduced: { file: Buffer; count: number } | undefined;
      let viewable: Buffer | undefined;
      try {
        const source = await readFile(original);
        reduced = decimateSpz(source, target);
        viewable = (spzVersion === 2 ? upgradeSpz(reduced?.file ?? source) : undefined) ?? reduced?.file;
      } catch (error) {
        throw new TerminalProviderError(error instanceof Error ? error.message : 'Could not upgrade SPZ');
      }
      if (viewable) {
        if (viewable.length > MAX_SPLAT_BYTES) throw new TerminalProviderError('Upgraded SPZ exceeds the byte limit');
        fallback = resolve(config.outputs, `${jobId}.spz`);
        await writeFile(unique, viewable, { flag: 'wx' });
        await commit(unique, fallback);
        if (reduced) {
          count = reduced.count;
          metadata.conversion_status = 'spz_decimated';
        }
      }
    }
    return { path: fallback, count, format, metadata };
  } finally {
    await Promise.all([unique, temporary, limited, ...(format === 'ply' ? [normalized] : [])].map((path) => rm(path, { force: true })));
  }
}

function displayCommand(args: string[]) {
  return args.map((value) => /^[a-zA-Z0-9_@./-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'").join(' ');
}

async function readSpzHeader(path: string) {
  const header = Buffer.alloc(16);
  const file = await open(path, 'r');
  let length: number;
  try {
    ({ bytesRead: length } = await file.read(header));
  } finally {
    await file.close();
  }
  let total = (await stat(path)).size;
  if (length >= 2 && header[0] === 0x1f && header[1] === 0x8b) {
    length = 0;
    total = 0;
    try {
      for await (const chunk of createReadStream(path).compose(createGunzip())) {
        if (length < header.length) {
          length += (chunk as Buffer).copy(header, length);
          if (length === header.length) validateHeader();
        }
        total += chunk.length;
        if (total > MAX_SPLAT_BYTES) throw new TerminalProviderError('Decompressed SPZ exceeds the byte limit');
      }
    } catch (error) {
      if (error instanceof TerminalProviderError) throw error;
      if (['Z_DATA_ERROR', 'Z_BUF_ERROR'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        throw new TerminalProviderError('Invalid compressed SPZ');
      }
      throw error;
    }
  }
  function validateHeader() {
    const count = header.readUInt32LE(8);
    if (length < header.length || header.toString('ascii', 0, 4) !== 'NGSP' || !count || count > maxVertices) {
      throw new TerminalProviderError('Invalid SPZ header or vertex count');
    }
    return count;
  }
  const count = validateHeader();
  if (total < header.length + count * 3) throw new TerminalProviderError('SPZ vertex payload is truncated');
  return { count, version: header.readUInt32LE(4) };
}

/**
 * The factor that brings a dish splat to its real width. `estimated` says the size was judged from
 * the photos instead of given by a person, and the label says so.
 */
export function measureScale(plateDiameter: number | null | undefined, width: number | undefined, estimated = false) {
  if (plateDiameter && width && width > 0) {
    return {
      scale_factor: plateDiameter / width, scale_status: estimated ? 'estimated' as const : 'measured' as const,
      scale_label: estimated ? `Estimated size (about ${Math.round(plateDiameter * 100)} cm wide, judged from the photos)`
        : `Actual size (${Number((plateDiameter * 100).toFixed(1))} cm plate)`,
      plate_diameter_m: plateDiameter,
    };
  }
  return { scale_factor: 1, scale_status: 'approximate' as const, scale_label: 'Approximate size', plate_diameter_m: plateDiameter ?? null };
}
