import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../config.ts';
import type { Upload } from '../db/database.ts';
import { providerRequest, TerminalProviderError } from './providerHttp.ts';

export const TRELLIS_VERSION = 'e8f6c45206993f297372f5436b90350817bd9b4a0d52d2a76df50c1c8afa2b3c';
const base = 'https://api.replicate.com/v1/predictions';

interface Prediction {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled' | 'aborted';
  output?: { gaussian_ply?: string; no_background_images?: string[] | null };
}

function trellisRequest(config: Config, path = '', body?: unknown): Promise<Prediction> {
  if (!config.replicateKey) throw new Error('Replicate API token is missing');
  return providerRequest<Prediction>(base + path, 'Replicate prediction', {
    Authorization: `Bearer ${config.replicateKey}`,
  }, body);
}

export async function submitTrellis(
  config: Config, upload: Upload, assertCurrent: () => void, beforeSubmit: () => void,
): Promise<string> {
  const bytes = await readFile(resolve(config.uploads, upload.file));
  assertCurrent();
  let image = `data:${upload.mime_type};base64,${bytes.toString('base64')}`;
  if (bytes.length > 256 * 1024) {
    const form = new FormData();
    form.set('content', new Blob([bytes], { type: upload.mime_type }), upload.filename);
    const result = await providerRequest<{ urls?: { get?: string } }>('https://api.replicate.com/v1/files', 'Replicate file upload', {
      Authorization: `Bearer ${config.replicateKey}`,
    }, form);
    const fileUrl = typeof result?.urls?.get === 'string' ? URL.parse(result.urls.get) : null;
    if (fileUrl?.origin !== 'https://api.replicate.com' || !fileUrl.pathname.startsWith('/v1/files/')) {
      throw new TerminalProviderError('Replicate did not return a file URL');
    }
    image = fileUrl.href;
  }
  beforeSubmit();
  const prediction = await trellisRequest(config, '', {
    version: TRELLIS_VERSION,
    input: {
      images: [image],
      save_gaussian_ply: true,
      generate_model: false,
      generate_color: false,
      generate_normal: false,
      return_no_background: true,
    },
  });
  if (typeof prediction?.id !== 'string' || !prediction.id) throw new TerminalProviderError('Replicate did not return a prediction ID');
  return prediction.id;
}

export async function pollTrellis(config: Config, predictionId: string): Promise<{ ply: string; preview?: string } | null> {
  const prediction = await trellisRequest(config, `/${encodeURIComponent(predictionId)}`);
  if (['failed', 'canceled', 'aborted'].includes(prediction?.status)) throw new TerminalProviderError(`Replicate prediction ${prediction.status}`);
  if (prediction?.status === 'starting' || prediction?.status === 'processing') return null;
  if (prediction?.status !== 'succeeded' || typeof prediction.output?.gaussian_ply !== 'string' || !prediction.output.gaussian_ply) {
    throw new TerminalProviderError('Replicate output is missing the Gaussian PLY');
  }
  const previews = prediction.output.no_background_images;
  return { ply: prediction.output.gaussian_ply, preview: Array.isArray(previews) && typeof previews[0] === 'string' ? previews[0] : undefined };
}
