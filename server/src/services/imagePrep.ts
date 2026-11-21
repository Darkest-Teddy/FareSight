import { createHash, randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
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
  const sha256 = createHash('sha256').update(input.bytes).digest('hex');
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
        mime_type: type.mime, sha256, byte_length: input.bytes.length,
        width: dimensions.width, height: dimensions.height,
        place_id: input.place_id, dish_id: input.dish_id ?? null, source_url: input.source_url ?? null,
        file, url: `/storage/uploads/${file}`, created_at: new Date().toISOString(),
      };
      const path = resolve(config.uploads, file);
      writeFileSync(path, input.bytes, { flag: 'wx' });
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
