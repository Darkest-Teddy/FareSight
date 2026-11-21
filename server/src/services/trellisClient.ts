import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../config.ts';
import type { Upload } from '../db/database.ts';
import { providerRequest } from './providerHttp.ts';

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

export async function submitTrellis(config: Config, upload: Upload, beforeSubmit: () => void): Promise<string> {
  const publicUrl = new URL(config.publicBaseUrl);
  const local = /^(localhost|0\.0\.0\.0|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(publicUrl.hostname);
  const image = local
    ? `data:${upload.mime_type};base64,${(await readFile(resolve(config.uploads, upload.file))).toString('base64')}`
    : new URL(upload.url, publicUrl).href;
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
  if (!prediction.id) throw new Error('Replicate did not return a prediction ID');
  return prediction.id;
}

export async function pollTrellis(config: Config, predictionId: string): Promise<{ ply: string; preview?: string } | null> {
  const prediction = await trellisRequest(config, `/${encodeURIComponent(predictionId)}`);
  if (['failed', 'canceled', 'aborted'].includes(prediction.status)) throw new Error(`Replicate prediction ${prediction.status}`);
  if (prediction.status !== 'succeeded') return null;
  if (!prediction.output?.gaussian_ply) throw new Error('Replicate output is missing the Gaussian PLY');
  return { ply: prediction.output.gaussian_ply, preview: prediction.output.no_background_images?.[0] };
}
