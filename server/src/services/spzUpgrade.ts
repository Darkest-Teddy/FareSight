import { gunzipSync, gzipSync } from 'node:zlib';

const HEADER_BYTES = 16;
const SH_DIM_FOR_DEGREE = [0, 3, 8, 15];

/**
 * Rewrites an SPZ version 2 file as version 3, which is the oldest version the PlayCanvas viewer reads.
 * The two differ only in how rotations are stored: version 2 keeps x, y and z in a byte each, version 3
 * packs the three smallest components into 32 bits. Returns nothing when the file is not a gzipped
 * version 2 SPZ, so newer files pass through untouched.
 */
export function upgradeSpz(file: Buffer): Buffer | undefined {
  if (file.length < 2 || file[0] !== 0x1f || file[1] !== 0x8b) return undefined;
  const data = gunzipSync(file);
  if (data.length < HEADER_BYTES || data.toString('ascii', 0, 4) !== 'NGSP' || data.readUInt32LE(4) !== 2) return undefined;
  const count = data.readUInt32LE(8);
  const shDim = SH_DIM_FOR_DEGREE[data[12]];
  if (shDim === undefined) throw new Error(`Invalid SPZ: unsupported SH degree ${data[12]}`);
  // Stream order: positions (9 bytes), alphas (1), colors (3), scales (3), rotations, spherical harmonics.
  const rotations = HEADER_BYTES + count * 16;
  const harmonics = rotations + count * 3;
  if (data.length < harmonics + count * shDim * 3) throw new Error('Invalid SPZ: file is shorter than its header says');

  const upgraded = Buffer.alloc(data.length + count);
  data.copy(upgraded, 0, 0, rotations);
  upgraded.writeUInt32LE(3, 4);
  const q = [0, 0, 0, 0];
  for (let index = 0; index < count; index++) {
    let squares = 0;
    for (let axis = 0; axis < 3; axis++) {
      q[axis] = data[rotations + index * 3 + axis] / 127.5 - 1;
      squares += q[axis] * q[axis];
    }
    // Version 2 always stores the quaternion with a non-negative w.
    q[3] = Math.sqrt(Math.max(0, 1 - squares));
    const length = Math.sqrt(squares + q[3] * q[3]) || 1;
    let largest = 0;
    for (let axis = 1; axis < 4; axis++) if (Math.abs(q[axis]) > Math.abs(q[largest])) largest = axis;
    const flip = q[largest] < 0;
    let packed = largest;
    for (let axis = 0; axis < 4; axis++) {
      if (axis === largest) continue;
      const value = q[axis] / length;
      const magnitude = Math.min(511, Math.round(511 * Math.abs(value) / Math.SQRT1_2));
      packed = packed * 1024 + ((value < 0) !== flip ? 512 : 0) + magnitude;
    }
    upgraded.writeUInt32LE(packed, rotations + index * 4);
  }
  data.copy(upgraded, rotations + count * 4, harmonics);
  return gzipSync(upgraded);
}
