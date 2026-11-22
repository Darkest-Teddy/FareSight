import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';

const maxResponseBytes = 8 * 1024 * 1024;
export const MAX_SPLAT_BYTES = 256 * 1024 * 1024;

export class TerminalProviderError extends Error {}

export class ProviderHttpError extends Error {
  constructor(status: number, operation: string) {
    super(`${operation} returned HTTP ${status}`);
    this.status = status;
  }

  readonly status: number;
}

function httpsUrl(input: string) {
  const url = URL.parse(input);
  if (!url || url.protocol !== 'https:' || url.username || url.password || url.port
    || !url.hostname.includes('.') || isIP(url.hostname) || /\.(?:localhost|local|internal|test|invalid)\.?$/i.test(url.hostname)) {
    throw new TerminalProviderError('Provider URL must use a trusted HTTPS hostname');
  }
  return url;
}

const hosts = (host: string, domain: string) => host === domain || host.endsWith('.' + domain);

function downloadUrl(input: string, provider: 'atlas' | 'trellis') {
  const url = httpsUrl(input);
  const valid = provider === 'atlas'
    ? hosts(url.hostname, 'worldlabs.ai') || hosts(url.hostname, 'storage.googleapis.com')
    : hosts(url.hostname, 'replicate.delivery');
  if (!valid) throw new TerminalProviderError('Unexpected provider download host');
  return url;
}

async function* limitedBody(response: Response, maxBytes: number) {
  if (!response.body) return;
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body.cancel();
    throw new TerminalProviderError('Provider response exceeds the byte limit');
  }
  const reader = response.body.getReader();
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new TerminalProviderError('Provider response exceeds the byte limit');
      yield value;
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}

export async function providerRequest<T>(url: string, operation: string, headers: Record<string, string>, body?: unknown): Promise<T> {
  httpsUrl(url);
  const multipart = body instanceof FormData;
  const response = await fetch(url, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...headers, ...(body === undefined || multipart ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(25_000),
    redirect: 'error',
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderHttpError(response.status, operation);
  }
  const chunks = [];
  for await (const chunk of limitedBody(response, maxResponseBytes)) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
  } catch {
    throw new TerminalProviderError('Provider returned invalid JSON');
  }
}

export type CommitFile = (temporary: string, destination: string) => void | Promise<void>;

export async function downloadFile(
  input: string, destination: (mimeType: string) => string, provider: 'atlas' | 'trellis',
  commit: CommitFile = rename, maxBytes = MAX_SPLAT_BYTES,
): Promise<string> {
  let url = downloadUrl(input, provider);
  const signal = AbortSignal.timeout(90_000);
  let response: Response;
  for (let redirects = 0; ; redirects++) {
    response = await fetch(url.href, { signal, redirect: 'manual' });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    await response.body?.cancel();
    const next = response.headers.get('location');
    const target = next && URL.parse(next, url);
    if (redirects >= 3 || !target) throw new TerminalProviderError('Invalid provider download redirect');
    url = downloadUrl(target.href, provider);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ProviderHttpError(response.status, 'Asset download');
  }
  if (!response.body) throw new TerminalProviderError('Provider asset response has no body');
  const file = destination(response.headers.get('content-type')?.split(';')[0] ?? '');
  const temporary = `${file}.${randomUUID()}.part`;
  try {
    await pipeline(limitedBody(response, maxBytes), createWriteStream(temporary, { flags: 'wx' }), { signal });
    await commit(temporary, file);
    return file;
  } finally {
    await rm(temporary, { force: true });
  }
}
