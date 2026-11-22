import { createHash, randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { crc32 } from 'node:zlib';
import { imageSize } from 'image-size';
import type { Config } from '../config.ts';
import type { Store, Upload } from '../db/database.ts';

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const imageTypes: Record<string, { mime: string; ext: string }> = {
  jpg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
};

export function decodeImageBase64(value: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) throw new TypeError('Invalid image base64');
  const image = Buffer.from(value, 'base64');
  if (image.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) throw new TypeError('Invalid image base64');
  return image;
}

function stripImageMetadata(bytes: Buffer, format: string): Buffer {
  const invalid = () => new TypeError('Image payload is malformed or truncated');
  if (format === 'jpg') {
    if (bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw invalid();
    const chunks = [bytes.subarray(0, 2)];
    for (let start = 2; start + 4 < bytes.length;) {
      if (bytes[start] !== 0xff) throw invalid();
      let offset = start + 1;
      while (bytes[offset] === 0xff) offset++;
      if (offset + 3 >= bytes.length) throw invalid();
      const marker = bytes[offset];
      const length = bytes.readUInt16BE(offset + 1);
      const end = offset + 1 + length;
      if (length < 2 || end > bytes.length - 2) throw invalid();
      if (marker === 0xda) return Buffer.concat([...chunks, bytes.subarray(start)]);
      if (marker !== 0xe1 && marker !== 0xed && marker !== 0xfe) chunks.push(bytes.subarray(start, end));
      start = end;
    }
    throw invalid();
  }

  const png = format === 'png';
  const headerLength = png ? 8 : 12;
  if (!png && bytes.readUInt32LE(4) !== bytes.length - 8) throw invalid();
  const chunks = [bytes.subarray(0, headerLength)];
  let foundImage = false;
  let foundEnd = false;
  let offset = headerLength;
  while (offset + (png ? 12 : 8) <= bytes.length) {
    const length = png ? bytes.readUInt32BE(offset) : bytes.readUInt32LE(offset + 4);
    const kind = bytes.toString('ascii', offset + (png ? 4 : 0), offset + (png ? 8 : 4));
    const end = offset + 8 + length + (png ? 4 : length % 2);
    if (end > bytes.length) throw invalid();
    if (png && crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
    if (png && kind === 'IEND') {
      if (length || end !== bytes.length) throw invalid();
      foundEnd = true;
    }
    foundImage ||= png ? kind === 'IDAT' : ['VP8 ', 'VP8L', 'ANMF'].includes(kind);
    if (!(png ? ['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(kind) : ['EXIF', 'XMP '].includes(kind))) {
      const chunk = bytes.subarray(offset, end);
      if (!png && kind === 'VP8X') {
        if (length !== 10) throw invalid();
        const flags = Buffer.from(chunk);
        flags[8] &= ~0x0c;
        chunks.push(flags);
      } else chunks.push(chunk);
    }
    offset = end;
  }
  if (!foundImage || (png && !foundEnd) || offset !== bytes.length) throw invalid();
  const result = Buffer.concat(chunks);
  if (!png) result.writeUInt32LE(result.length - 8, 4);
  return result;
}

export function prepareImage(store: Store, config: Config, input: {
  filename: string;
  mimeType: string;
  bytes: Buffer;
  place_id: string;
  dish_id?: string;
  source_url?: string;
}): Upload & { deduplicated: boolean } {
  if (input.bytes.length > MAX_IMAGE_BYTES) throw new TypeError('Image exceeds 8 MiB');
  let dimensions;
  try {
    dimensions = imageSize(input.bytes);
  } catch {
    throw new TypeError('Upload is not a supported image');
  }
  const type = imageTypes[dimensions.type ?? ''];
  if (!type || type.mime !== input.mimeType.toLowerCase()) throw new TypeError('Use a JPEG, PNG or WebP with a matching MIME type');
  if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 64_000_000) {
    throw new TypeError('Image dimensions are outside the supported range');
  }
  const bytes = stripImageMetadata(input.bytes, dimensions.type!);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  let written: string | undefined;
  try {
    return store.transaction(() => {
      const existing = store.uploadByHash(sha256);
      if (existing) {
        store.linkUpload(existing.id, input.place_id);
        return { ...existing, place_id: input.place_id, dish_id: input.dish_id ?? null, deduplicated: true };
      }
      const id = randomUUID();
      const file = `${id}.${type.ext}`;
      const upload: Upload = {
        id, filename: basename(input.filename.replaceAll('\\', '/')).slice(0, 255),
        mime_type: type.mime, sha256, byte_length: bytes.length,
        width: dimensions.width, height: dimensions.height,
        place_id: input.place_id, dish_id: input.dish_id ?? null, source_url: input.source_url ?? null,
        file, url: `/storage/uploads/${file}`, created_at: new Date().toISOString(),
      };
      const path = resolve(config.uploads, file);
      writeFileSync(path, bytes, { flag: 'wx' });
      written = path;
      store.put('uploads', upload);
      store.linkUpload(id, input.place_id);
      return { ...upload, deduplicated: false };
    });
  } catch (error) {
    if (written) rmSync(written, { force: true });
    throw error;
  }
}
