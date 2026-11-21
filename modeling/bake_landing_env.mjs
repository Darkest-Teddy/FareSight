/**
 * Turns the Radiance HDRs in modeling/hdri-src into web-sized equirect JPEGs.
 *
 *   node modeling/bake_landing_env.mjs
 *
 * The HDRs are 5-6 MB each, which is far too much to push at someone who is
 * only scrolling a landing page, and the browser would have to decode RGBE
 * before it could show anything. Baking them once gives us ~400 KB files that
 * sample as plain sRGB, and it is also where each act gets its grade: the
 * living room is lifted and cooled towards the glassy look of the reference,
 * the restaurant is warmed and settled down.
 *
 * Writes to web/public/landing/env/.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Jimp } from 'jimp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'modeling', 'hdri-src');
const outDir = join(root, 'web', 'public', 'landing', 'env');

/**
 * `exposure` scales linear radiance before tone mapping. `temperature` tints
 * the result: positive is warmer, negative cooler. `saturation` is a simple
 * multiplier around luma, and `lift` raises the shadows so the room reads as
 * airy rather than contrasty.
 */
const jobs = [
  {
    src: 'hotel_room_2k.hdr',
    out: 'home',
    // Cool and bright: the first act is meant to feel like clean daylight.
    grade: { exposure: 0.85, temperature: -0.05, saturation: 1.12, lift: 0.03 },
  },
  {
    src: 'warm_restaurant_2k.hdr',
    out: 'restaurant',
    // Warm and a stop down, so arriving somewhere feels like a change of light.
    grade: { exposure: 0.7, temperature: 0.06, saturation: 1.12, lift: 0.01 },
  },
];

/** Big enough for legible reflections, small enough to not matter on mobile. */
const envSize = { w: 1024, h: 512 };

/** Reads the Radiance header and returns the pixel offset plus dimensions. */
function readHeader(buffer) {
  if (buffer.toString('ascii', 0, 10) !== '#?RADIANCE') throw new Error('not a Radiance .hdr');
  let offset = 0;
  let line = '';
  // The header is newline-delimited text; a blank line ends it, and the
  // resolution line follows immediately after.
  for (;;) {
    const end = buffer.indexOf(0x0a, offset);
    if (end < 0) throw new Error('truncated header');
    line = buffer.toString('ascii', offset, end);
    offset = end + 1;
    if (line === '') break;
  }
  const end = buffer.indexOf(0x0a, offset);
  const resolution = buffer.toString('ascii', offset, end);
  offset = end + 1;
  const match = /^-Y (\d+) \+X (\d+)$/.exec(resolution);
  if (!match) throw new Error(`unsupported orientation: ${resolution}`);
  return { offset, width: Number(match[2]), height: Number(match[1]) };
}

/** Decodes RGBE scanlines (adaptive RLE or flat) into a Float32Array of RGB. */
function decodePixels(buffer, offset, width, height) {
  const out = new Float32Array(width * height * 3);
  const scanline = new Uint8Array(width * 4);

  for (let y = 0; y < height; y += 1) {
    const rle = buffer[offset] === 2 && buffer[offset + 1] === 2
      && ((buffer[offset + 2] << 8) | buffer[offset + 3]) === width && width >= 8 && width < 0x8000;

    if (rle) {
      offset += 4;
      // Adaptive RLE stores the four components as separate planes.
      for (let channel = 0; channel < 4; channel += 1) {
        let x = 0;
        while (x < width) {
          let count = buffer[offset];
          offset += 1;
          if (count > 128) {
            const value = buffer[offset];
            offset += 1;
            for (let i = 0; i < count - 128; i += 1) scanline[(x + i) * 4 + channel] = value;
            x += count - 128;
          } else {
            for (let i = 0; i < count; i += 1) scanline[(x + i) * 4 + channel] = buffer[offset + i];
            offset += count;
            x += count;
          }
        }
      }
    } else {
      for (let i = 0; i < width * 4; i += 1) scanline[i] = buffer[offset + i];
      offset += width * 4;
    }

    for (let x = 0; x < width; x += 1) {
      const exponent = scanline[x * 4 + 3];
      // An exponent of zero means the pixel is black; ldexp would misbehave.
      const scale = exponent === 0 ? 0 : Math.pow(2, exponent - 136);
      const base = (y * width + x) * 3;
      out[base] = scanline[x * 4] * scale;
      out[base + 1] = scanline[x * 4 + 1] * scale;
      out[base + 2] = scanline[x * 4 + 2] * scale;
    }
  }
  return out;
}

/** Narkowicz's ACES fit: cheap, and it keeps highlights from going chalky. */
function aces(x) {
  return Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
}

const toSrgb = (x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);

function grade(pixels, width, height, { exposure, temperature, saturation, lift }) {
  const out = Buffer.alloc(width * height * 4);
  // Warming pushes red up and blue down; cooling does the reverse.
  const rGain = 1 + temperature * 0.6;
  const bGain = 1 - temperature * 0.6;

  for (let i = 0, p = 0; i < pixels.length; i += 3, p += 4) {
    let r = aces(pixels[i] * exposure * rGain);
    let g = aces(pixels[i + 1] * exposure);
    let b = aces(pixels[i + 2] * exposure * bGain);

    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = luma + (r - luma) * saturation;
    g = luma + (g - luma) * saturation;
    b = luma + (b - luma) * saturation;

    // Lift shadows without washing out the highlights.
    r += lift * (1 - r); g += lift * (1 - g); b += lift * (1 - b);

    out[p] = Math.round(toSrgb(Math.min(1, Math.max(0, r))) * 255);
    out[p + 1] = Math.round(toSrgb(Math.min(1, Math.max(0, g))) * 255);
    out[p + 2] = Math.round(toSrgb(Math.min(1, Math.max(0, b))) * 255);
    out[p + 3] = 255;
  }
  return out;
}

async function main() {
  await mkdir(outDir, { recursive: true });

  for (const job of jobs) {
    const buffer = await readFile(join(srcDir, job.src));
    const { offset, width, height } = readHeader(buffer);
    const pixels = decodePixels(buffer, offset, width, height);
    const bitmap = grade(pixels, width, height, job.grade);

    // This never appears on screen. The rooms are built from real geometry,
    // and this is only what lights them and what they reflect, so it can be
    // far smaller than a background plate would have to be.
    const image = Jimp.fromBitmap({ data: bitmap, width, height }).resize(envSize);
    const file = join(outDir, `${job.out}-env.jpg`);
    await writeFile(file, await image.getBuffer('image/jpeg', { quality: 86 }));

    console.log(`${job.src}  ${width}x${height}  ->  ${job.out}-env.jpg  (${envSize.w}x${envSize.h})`);
  }
}

main().catch((error) => { console.error('Failed:', error.message); process.exit(1); });
