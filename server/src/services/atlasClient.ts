import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Config } from '../config.ts';
import type { Upload } from '../db/database.ts';
import { downloadFile, ProviderHttpError, providerRequest } from './providerHttp.ts';

type AssetId = { assetId: string };
export type AtlasSplat = { assetId?: string | null; url?: string | null };
export interface AtlasPosedFrame {
  imageAsset: AssetId;
  depth: { depthAsset: AssetId };
  camera: { extrinsics: object; intrinsics: object };
}
interface Operation<T> {
  id: string;
  done: boolean;
  error?: { code?: number; message?: string | null } | null;
  response?: T | null;
}

function request<T>(config: Config, path: string, body?: unknown, key?: string): Promise<T> {
  if (!config.atlasKey) throw new Error('World Labs Atlas API key is missing');
  return providerRequest<T>(config.atlasBaseUrl + path, `Atlas ${path}`, {
    'WLT-Api-Key': config.atlasKey, ...(key ? { 'Idempotency-Key': key } : {}),
  }, body);
}

export async function uploadAtlasImage(config: Config, upload: Upload): Promise<string> {
  const bytes = await readFile(resolve(config.uploads, upload.file));
  const result = await request<{ id: string }>(config, '/assets', {
    asset: { displayName: upload.filename, base64: `data:${upload.mime_type};base64,${bytes.toString('base64')}` },
  });
  if (!result.id) throw new Error('Atlas did not return an image asset ID');
  return result.id;
}

async function submit(config: Config, task: string, body: object, key: string): Promise<string> {
  const operation = await request<Operation<unknown>>(config, `/tasks:${task}`, body, key);
  if (!operation.id) throw new Error(`Atlas ${task} did not return an operation ID`);
  return operation.id;
}

async function poll<T>(config: Config, id: string, task: string): Promise<T | null> {
  const operation = await request<Operation<T>>(config, `/operations/${encodeURIComponent(id)}`);
  if (operation.done !== true) return null;
  if (operation.error) throw new Error(`Atlas ${task} failed: ${operation.error.message ?? operation.error.code ?? 'unknown error'}`);
  if (!operation.response) throw new Error(`Atlas ${task} completed without a response`);
  return operation.response;
}

export function submitAtlasPose(config: Config, jobId: string, assetIds: string[]) {
  return submit(config, 'images2PosedRGBD', {
    base64Outputs: false, frames: assetIds.map((assetId) => ({ imageAsset: { assetId } })),
    canonicalizeToFirstFrame: true, refinePoses: true, targetResolution: [1280, 720],
  }, `${jobId}-pose`);
}

export async function pollAtlasPose(config: Config, id: string): Promise<AtlasPosedFrame[] | null> {
  const result = await poll<{ frames?: AtlasPosedFrame[] }>(config, id, 'images2PosedRGBD');
  if (!result) return null;
  if (!Array.isArray(result.frames) || result.frames.length < 2 || result.frames.some((frame) =>
    !frame?.imageAsset?.assetId || !frame.depth?.depthAsset?.assetId || !frame.camera?.extrinsics || !frame.camera.intrinsics)) {
    throw new Error('Atlas did not return at least two complete posed RGBD frames');
  }
  return result.frames.map(({ imageAsset, depth, camera }) => ({
    imageAsset: { assetId: imageAsset.assetId }, depth: { depthAsset: { assetId: depth.depthAsset.assetId } }, camera,
  }));
}

export function submitAtlasSplats(config: Config, jobId: string, posedFrames: AtlasPosedFrame[], refine: boolean) {
  return submit(config, 'posedImages2Splats', { refine, posedFrames }, `${jobId}-splats`);
}

export async function pollAtlasSplats(config: Config, id: string, refine: boolean): Promise<AtlasSplat | null> {
  const result = await poll<{ draftSplat?: AtlasSplat; refinedSplats?: Record<string, AtlasSplat> }>(config, id, 'posedImages2Splats');
  if (!result) return null;
  const splat = refine
    ? Object.entries(result.refinedSplats ?? {}).sort(([a], [b]) => Number(b) - Number(a))[0]?.[1]
    : result.draftSplat;
  if (!splat?.assetId && !splat?.url) throw new Error('Atlas did not return an SPZ asset');
  return splat;
}

export async function downloadAtlasSplat(config: Config, splat: AtlasSplat, destination: string): Promise<string> {
  if (splat.url) {
    try {
      return await downloadFile(splat.url, () => destination);
    } catch (error) {
      if (!splat.assetId || !(error instanceof ProviderHttpError) || ![401, 403, 404, 410].includes(error.status)) throw error;
    }
  }
  if (!splat.assetId) throw new Error('Atlas SPZ asset is missing its download URL and asset ID');
  const result = await request<{ readUrl: string }>(config, `/assets/${encodeURIComponent(splat.assetId)}:createReadUrl`, {});
  if (!result.readUrl) throw new Error('Atlas did not return an SPZ download URL');
  return downloadFile(result.readUrl, () => destination);
}
