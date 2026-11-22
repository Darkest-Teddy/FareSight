import { MAX_IMAGE_BYTES } from './imagePrep.ts';

export const FRAMES_JSON = 'frames.json';
export const MAX_FRAMES_JSON_BYTES = 1024 * 1024;

export const capturePrefix = (captureId: string) => `captures/${captureId}/`;
export const frameKey = (captureId: string, seq: number) => `${capturePrefix(captureId)}frames/${String(seq).padStart(6, '0')}.jpg`;
export const framesJsonKey = (captureId: string) => capturePrefix(captureId) + FRAMES_JSON;
export const splatPrefix = (captureId: string) => `splats/${captureId}/`;
export const splatKey = (captureId: string, jobId: string, quality: string, format: string) =>
  `${splatPrefix(captureId)}${jobId}/${quality}.${format}`;

/**
 * Validates one file a client asks to upload and builds its object key. Clients name files, never keys:
 * only `frames/NNNNNN.jpg` and `frames.json` exist, so nothing can be written outside the capture's prefix.
 */
export function uploadTarget(captureId: string, file: { name: string; content_type: string; size: number }):
  { key: string } | { error: string } {
  const frame = /^frames\/(\d{6})\.jpg$/.exec(file.name);
  if (frame) {
    if (file.content_type !== 'image/jpeg') return { error: `${file.name} must be image/jpeg` };
    if (file.size > MAX_IMAGE_BYTES) return { error: `${file.name} exceeds 8 MiB` };
    return { key: frameKey(captureId, Number(frame[1])) };
  }
  if (file.name === FRAMES_JSON) {
    if (file.content_type !== 'application/json') return { error: 'frames.json must be application/json' };
    if (file.size > MAX_FRAMES_JSON_BYTES) return { error: 'frames.json exceeds 1 MiB' };
    return { key: framesJsonKey(captureId) };
  }
  return { error: `${file.name} is not an accepted file name. Use frames/NNNNNN.jpg or frames.json.` };
}
