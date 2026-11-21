import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

export class ProviderHttpError extends Error {
  constructor(status: number, operation: string) {
    super(`${operation} returned HTTP ${status}`);
    this.status = status;
  }

  readonly status: number;
}

export async function providerRequest<T>(url: string, operation: string, headers: Record<string, string>, body?: unknown): Promise<T> {
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new ProviderHttpError(response.status, operation);
  return await response.json() as T;
}

export async function downloadFile(url: string, destination: (mimeType: string) => string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(90_000) });
  if (!response.ok || !response.body) throw new ProviderHttpError(response.status, 'Asset download');
  const file = destination(response.headers.get('content-type')?.split(';')[0] ?? '');
  const temporary = `${file}.${randomUUID()}.part`;
  try {
    await pipeline(response.body, createWriteStream(temporary, { flags: 'wx' }));
    await rename(temporary, file);
    return file;
  } finally {
    await rm(temporary, { force: true });
  }
}
