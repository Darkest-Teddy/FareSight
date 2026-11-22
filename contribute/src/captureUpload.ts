// Sends a room's photos straight from the phone to object storage. The API only hands out
// short-lived upload URLs and records what arrived; the photos never pass through it.
import type { RoomModelTier } from '@faresight/shared';
import { api, type FrameRecord, type UploadFile } from './api';
import { wait } from './dom';
import { prepareImage } from './photos';
import { withCode } from './ui/CodeSheet';

const PARALLEL = 3;
const ATTEMPTS = 3;
const REGISTER_BATCH = 20;
const FRAMES_JSON = 'frames.json';

/** A capture being sent. Kept between attempts, so a retry only sends the photos that did not arrive. */
export interface CaptureUpload {
  id: string;
  /** Sequence numbers of the photos already in the bucket and registered. */
  sent: Set<number>;
  /** The build has been started, so only its job is left to fetch. */
  completed?: boolean;
}

async function put(url: string, body: Blob, contentType: string) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body });
      if (response.ok) return;
      // A refused upload (an expired URL, a wrong type) will be refused again.
      if (response.status < 500 || attempt >= ATTEMPTS - 1) throw new Error(`Storage answered HTTP ${response.status}.`);
    } catch (error) {
      if (attempt >= ATTEMPTS - 1 || (error instanceof Error && error.message.startsWith('Storage answered'))) throw error;
    }
    await wait(500 * 2 ** attempt);
  }
}

const frameName = (seq: number) => `frames/${String(seq).padStart(6, '0')}.jpg`;

function deviceInfo() {
  return { user_agent: navigator.userAgent, screen: [screen.width, screen.height], pixel_ratio: devicePixelRatio };
}

/**
 * Uploads the photos and starts the build. `onFrame` reports each photo as it is sent.
 * Throws on the first photo that cannot be sent; pass the same `capture` again to pick up where it stopped.
 */
export async function sendCapture(options: {
  placeId: string;
  files: File[];
  tier: RoomModelTier;
  capture?: CaptureUpload;
  onCapture(capture: CaptureUpload): void;
  onFrame(seq: number, state: 'sending' | 'sent' | 'failed', sent: number): void;
}) {
  const { placeId, files, tier, onFrame } = options;
  let capture = options.capture;
  if (!capture) {
    capture = { id: await withCode((code) => api.createCapture(placeId, deviceInfo(), code)), sent: new Set() };
    options.onCapture(capture);
  }
  const { id, sent } = capture;
  if (capture.completed) return { captureId: id, job: await api.captureJob(id) };

  // Phone cameras also produce HEIC and oversized files, so every frame is made a JPEG first.
  const frames = await Promise.all(files.map(async (file, seq) => ({ seq, file: sent.has(seq) ? file : await prepareImage(file, true) })));
  const started = Math.min(...files.map((file) => file.lastModified));
  const pending = frames.filter(({ seq }) => !sent.has(seq));
  const wanted: UploadFile[] = pending.map(({ seq, file }) => ({ name: frameName(seq), content_type: 'image/jpeg', size: file.size }));
  // The key of a frame only depends on the capture and its number, so the manifest can be written before the photos land.
  const keyOf = (seq: number) => `captures/${id}/${frameName(seq)}`;
  const manifest = new Blob([JSON.stringify({
    version: 1, capture_id: id, mode: 'room', tracking: 'none',
    frames: files.map((file, seq) => ({
      seq, key: keyOf(seq), t_ms: Math.max(0, file.lastModified - started), orientation: null, pose: null,
    })),
  })], { type: 'application/json' });
  wanted.push({ name: FRAMES_JSON, content_type: 'application/json', size: manifest.size });
  const urls = new Map((await withCode((code) => api.uploadUrls(id, wanted, code))).map(({ name, url }) => [name, url]));
  const urlFor = (name: string) => {
    const url = urls.get(name);
    if (!url) throw new Error('The server did not return an upload address.');
    return url;
  };

  const landed: FrameRecord[] = [];
  let failure: unknown;
  const queue = [...pending];
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    for (let next = queue.shift(); next && !failure; next = queue.shift()) {
      const { seq, file } = next;
      onFrame(seq, 'sending', sent.size + landed.length);
      try {
        await put(urlFor(frameName(seq)), file, 'image/jpeg');
        landed.push({ seq, key: keyOf(seq), t_ms: Math.max(0, files[seq].lastModified - started) });
        onFrame(seq, 'sent', sent.size + landed.length);
      } catch {
        onFrame(seq, 'failed', sent.size + landed.length);
        failure = new Error(`Photo ${seq + 1} could not be sent. Check your connection and try again.`);
      }
    }
  }));
  // Register what did arrive even when another photo failed, so the retry skips it.
  for (let start = 0; start < landed.length; start += REGISTER_BATCH) {
    const batch = landed.slice(start, start + REGISTER_BATCH);
    await withCode((code) => api.registerFrames(id, batch, code));
    for (const { seq } of batch) sent.add(seq);
  }
  if (failure) throw failure;

  await put(urlFor(FRAMES_JSON), manifest, 'application/json');
  await withCode((code) => api.completeCapture(id, tier, code));
  capture.completed = true;
  return { captureId: id, job: await api.captureJob(id) };
}
