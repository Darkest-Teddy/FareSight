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

// Empty when the API shares this origin (the dev proxy, or a reverse proxy in front of both apps).
// Set VITE_API_ORIGIN at build time when the subdomain talks to the API on another host.
const apiOrigin = String(import.meta.env.VITE_API_ORIGIN ?? '').replace(/\/$/, '');

async function request<T>(path: string, body?: object | FormData, code?: string): Promise<T> {
  const multipart = body instanceof FormData;
  const headers = new Headers({ accept: 'application/json' });
  if (body && !multipart) headers.set('content-type', 'application/json');
  if (code) headers.set('x-admin-passcode', code);
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
  const data = await response.json().catch(() => undefined);
  if (!response.ok || data === undefined) {
    throw new ApiError(data?.error ?? data?.message ?? `Server returned HTTP ${response.status}.`, response.status);
  }
  return data as T;
}

const pathId = (id: string) => encodeURIComponent(id);
const unwrapJob = (result: GenerationJob | { job: GenerationJob }) => 'job' in result ? result.job : result;

export interface JobRequest {
  kind: 'room' | 'dish';
  place_id: string;
  upload_ids: string[];
  dish_id?: string;
  dish_name?: string;
  plate_diameter_m?: number;
  model_tier?: RoomModelTier;
}

export const api = {
  places: () => request<Place[]>('/restaurants'),

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

  async generate(job: JobRequest, code: string) {
    return unwrapJob(await request<GenerationJob | { job: GenerationJob }>('/jobs', job, code));
  },

  async job(id: string) {
    return unwrapJob(await request<GenerationJob | { job: GenerationJob }>(`/jobs/${pathId(id)}`));
  },

  async retry(id: string, code: string) {
    return unwrapJob(await request<GenerationJob | { job: GenerationJob }>(`/jobs/${pathId(id)}/retry`, {}, code));
  },

  vehicles: () => request<{ vehicles: MbtaVehicle[] }>('/mbta/vehicles'),
};
