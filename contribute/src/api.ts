import type { GenerationJob, MbtaVehicle, Place, RoomModelTier } from '@faresight/shared';

export interface Upload {
  id: string;
  filename: string;
  url: string;
  place_id: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export type ContributorJob = Omit<GenerationJob, 'status'> & {
  status: GenerationJob['status'] | 'rejected';
  rejection_reason?: string | null;
};

export function jobStatus(job: ContributorJob) {
  if ((job.status === 'needs_review' || job.status === 'failed')
    && (job.rejection_reason || job.status_message?.startsWith('Asset rejected'))) {
    return 'rejected';
  }
  return job.status;
}

// Empty when the API shares this origin (the dev proxy, or a reverse proxy in front of both apps).
// Set VITE_API_ORIGIN at build time when the subdomain talks to the API on another host.
const apiOrigin = String(import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

async function request<T>(path: string, body?: object | FormData, code?: string, idempotencyKey?: string): Promise<T> {
  const multipart = body instanceof FormData;
  const headers = new Headers({ accept: 'application/json' });
  if (body && !multipart) headers.set('content-type', 'application/json');
  if (code) headers.set('X-Upload-Passcode', code);
  if (idempotencyKey) headers.set('Idempotency-Key', idempotencyKey);
  let response: Response;
  try {
    response = await fetch(apiOrigin + '/api' + path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: multipart ? body : body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(body ? 120_000 : 8_000),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
    throw new ApiError(timedOut ? 'The server took too long to answer.' : 'Could not reach the FareSight server.', 0);
  }
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => undefined);
  if (!response.ok || data === undefined) {
    throw new ApiError(data?.error ?? data?.message ?? `Server returned HTTP ${response.status}.`, response.status);
  }
  return data as T;
}

const pathId = (id: string) => encodeURIComponent(id);
const unwrapJob = (result: ContributorJob | { job: ContributorJob }) => 'job' in result ? result.job : result;

export interface JobRequest {
  kind: 'room' | 'dish';
  place_id: string;
  upload_ids: string[];
  dish_id?: string;
  dish_name?: string;
  dish_price?: number;
  plate_diameter_m?: number;
  model_tier?: RoomModelTier;
}

export interface UploadFile { name: string; content_type: string; size: number }
export interface UploadUrl { name: string; key: string; url: string; expires_at: string }
export interface FrameRecord { seq: number; key: string; t_ms: number }

let captureStorage: Promise<boolean> | undefined;

export const api = {
  places: () => request<Place[]>('/restaurants'),

  /**
   * Whether this server keeps room photos in object storage. If so, the phone sends them
   * straight to the bucket; otherwise they go through `upload` as before.
   */
  captureStorage() {
    return captureStorage ??= request<{ captures?: boolean }>('/health').then(({ captures }) => captures === true, () => {
      captureStorage = undefined;
      return false;
    });
  },

  async createCapture(placeId: string, deviceInfo: object, code: string) {
    return (await request<{ capture_id: string }>('/captures', { place_id: placeId, mode: 'room', device_info: deviceInfo }, code)).capture_id;
  },

  /** Short-lived URLs to PUT each file to. The server names the keys; `name` is `frames/NNNNNN.jpg` or `frames.json`. */
  async uploadUrls(captureId: string, files: UploadFile[], code: string) {
    return (await request<{ urls: UploadUrl[] }>(`/captures/${pathId(captureId)}/upload-urls`, { files }, code)).urls;
  },

  registerFrames: (captureId: string, frames: FrameRecord[], code: string) =>
    request<void>(`/captures/${pathId(captureId)}/frames`, { frames }, code),

  /** Starts the build once every file is in the bucket. Calling it again returns the same job. */
  async completeCapture(captureId: string, tier: RoomModelTier | undefined, code: string) {
    return (await request<{ job_id: string }>(`/captures/${pathId(captureId)}/complete`, { model_tier: tier }, code)).job_id;
  },

  async captureJob(captureId: string) {
    const { generation_job } = await request<{ generation_job: ContributorJob | null }>(`/captures/${pathId(captureId)}`);
    if (!generation_job) throw new ApiError('This capture has not been sent yet.', 404);
    return generation_job;
  },

  captureEventsUrl: (captureId: string) => `${apiOrigin}/api/captures/${pathId(captureId)}/events`,

  /**
   * Checks an invite code without creating anything. The upload route authenticates before it
   * reads the body, so an empty body answers 401 for a wrong code and 400 once the code is accepted.
   */
  async checkCode(code: string): Promise<boolean> {
    try {
      await request('/uploads', {}, code);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return false;
      if (error instanceof ApiError && error.status === 400) return true;
      throw error;
    }
  },

  async upload(placeId: string, file: File, code: string): Promise<Upload> {
    const body = new FormData();
    body.set('place_id', placeId);
    body.set('file', file);
    const result = await request<Upload | { upload: Upload }>('/uploads', body, code);
    return 'upload' in result ? result.upload : result;
  },

  async generate(job: JobRequest, code: string, idempotencyKey: string) {
    const result = unwrapJob(await request<ContributorJob | { job: ContributorJob }>('/jobs', job, code, idempotencyKey));
    if (!result?.id) throw new ApiError('The server did not return a scan. Try starting the build again.', 0);
    return result;
  },

  async job(id: string) {
    return unwrapJob(await request<ContributorJob | { job: ContributorJob }>(`/jobs/${pathId(id)}`));
  },

  async retry(id: string, code: string) {
    return unwrapJob(await request<ContributorJob | { job: ContributorJob }>(`/jobs/${pathId(id)}/retry`, {}, code));
  },

  vehicles: () => request<{ vehicles: MbtaVehicle[] }>('/mbta/vehicles'),

  /** Sends a review of a place. The server publishes it once a FareSight admin approves it. */
  review: (placeId: string, review: { author_label: string; text: string; rating: number }) =>
    request<{ id: string; created_at: string }>(`/restaurants/${pathId(placeId)}/reviews`, review),
};
