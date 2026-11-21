import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { MarbleTier } from '@faresight/shared';
import type { Config } from '../config.ts';
import type { Upload } from '../db/database.ts';
import { ProviderHttpError, providerRequest } from './providerHttp.ts';

const base = 'https://api.worldlabs.ai/marble/v1';
interface Operation<T> {
  operation_id: string;
  done: boolean;
  error?: { message?: string } | null;
  response?: T | null;
}

function marbleRequest<T>(config: Config, path: string, body?: unknown): Promise<T> {
  if (!config.marbleKey) throw new Error('World Labs API key is missing');
  return providerRequest<T>(base + path, `Marble ${path}`, { 'WLT-Api-Key': config.marbleKey }, body);
}

async function uploadMedia(config: Config, upload: Upload): Promise<string> {
  const prepared = await marbleRequest<{
    media_asset: { media_asset_id: string };
    upload_info: { upload_url: string; required_headers: Record<string, string> };
  }>(config, '/media-assets:prepare_upload', { file_name: upload.file, kind: 'image', extension: extname(upload.file).slice(1) });
  const response = await fetch(prepared.upload_info.upload_url, {
    method: 'PUT', headers: prepared.upload_info.required_headers,
    body: new Uint8Array(await readFile(resolve(config.uploads, upload.file))),
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new ProviderHttpError(response.status, 'Marble media upload');
  if (!prepared.media_asset.media_asset_id) throw new Error('Marble media upload did not return an asset ID');
  return prepared.media_asset.media_asset_id;
}

export function marbleModel(tier: MarbleTier = 'marble-1.1') {
  return tier === 'marble-1.1-draft' ? 'marble-1.0-draft' : tier;
}

export async function submitMarble(config: Config, uploads: Upload[], tier: MarbleTier, beforeSubmit: () => void): Promise<string> {
  const mediaIds = await Promise.all(uploads.slice(0, 8).map((upload) => uploadMedia(config, upload)));
  beforeSubmit();
  const result = await marbleRequest<Operation<{ world_id: string }>>(config, '/worlds:generate', {
    model: marbleModel(tier),
    world_prompt: {
      type: 'multi-image', reconstruct_images: true,
      multi_image_prompt: mediaIds.map((media_asset_id) => ({ content: { source: 'media_asset', media_asset_id } })),
    },
  });
  if (!result.operation_id) throw new Error('Marble did not return an operation ID');
  return result.operation_id;
}

export async function pollMarble(config: Config, operationId: string): Promise<string | null> {
  const result = await marbleRequest<Operation<{ world_id: string }>>(config, `/operations/${encodeURIComponent(operationId)}`);
  if (result.error) throw new Error('Marble world generation failed');
  if (!result.done) return null;
  if (!result.response?.world_id) throw new Error('Marble operation did not return a world ID');
  return result.response.world_id;
}

export async function exportMarblePly(config: Config, worldId: string): Promise<string> {
  const result = await marbleRequest<Operation<{ url: string }>>(config, `/worlds/${encodeURIComponent(worldId)}:export`, {
    asset_type: 'splats', format: 'ply', resolution: '100k',
  });
  if (!result.done || result.error || !result.response?.url) throw new Error('Marble did not return a completed 100k PLY export');
  return result.response.url;
}
