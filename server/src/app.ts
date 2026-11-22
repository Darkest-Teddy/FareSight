import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import staticFiles from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { getConfig } from './config.ts';
import type { Config } from './config.ts';
import { Store } from './db/database.ts';
import { registerAdminAndCommunity } from './routes/admin.ts';
import { registerCaptures } from './routes/captures.ts';
import { registerCatalog } from './routes/catalog.ts';
import { registerLive } from './routes/live.ts';
import { registerMbta } from './routes/mbta.ts';
import { registerPairing } from './routes/pairing.ts';
import { registerPipeline } from './routes/pipeline.ts';
import { registerRealtime } from './routes/realtime.ts';
import { createCaptureEvents } from './services/captureEvents.ts';
import { mirrorJobs, openCaptures } from './services/captures.ts';
import { findDemoAsset } from './services/demoAssets.ts';
import { MAX_IMAGE_BYTES } from './services/imagePrep.ts';
import { startCaptureBridge } from './worker/captureBridge.ts';
import { startJobWorker } from './worker/jobWorker.ts';

export async function createApp(config: Config = getConfig(), options: { logger?: boolean; worker?: boolean } = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 4096 });
  mkdirSync(config.uploads, { recursive: true });
  mkdirSync(config.outputs, { recursive: true });
  const store = new Store(config.database);

  const logError = (error: unknown) => app.log.error(error);
  // Optional: Postgres and object storage for room captures. Without them photos stay on this server's disk.
  // If they cannot be reached at startup the rest of the app still runs, and the apps fall back to plain uploads.
  const captures = await openCaptures(config).catch((error) => {
    console.error('Capture storage is unavailable, so captures are switched off until the next restart:', error);
    return undefined;
  });
  const captureEvents = captures && createCaptureEvents(captures, logError);
  const stopMirror = captures && mirrorJobs(store, captures, logError);

  let stopWorker: (() => Promise<void>) | undefined;
  let stopBridge: (() => Promise<void>) | undefined;
  app.addHook('onClose', async () => {
    try {
      await stopBridge?.();
      await stopWorker?.();
      await stopMirror?.();
      await captureEvents?.close();
      await captures?.close();
    } finally {
      store.sqlite.close();
    }
  });

  await app.register(cors, { origin: '*' });
  await app.register(multipart, { limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 5, fieldSize: 2048 } });
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  await app.register(staticFiles, {
    root: config.uploads, prefix: '/storage/uploads/', index: false, redirect: false,
  });
  await app.register(staticFiles, {
    root: config.outputs, prefix: '/storage/outputs/', index: false, redirect: false,
    decorateReply: false, allowedPath: (path) => !/\.part(?:\.sog)?$/.test(path),
  });

  app.get<{ Params: { file: string } }>('/assets-demo/:file', async ({ params }, reply) => {
    const path = findDemoAsset(config, params.file);
    if (!path) return reply.code(404).send({ error: 'Demo asset not found' });
    return reply.sendFile(params.file, dirname(path));
  });
  app.get('/api/health', async () => ({
    status: 'ok', database: 'sqlite', pipeline_mode: config.mode, ...(captures ? { captures: true } : {}),
  }));
  registerCatalog(app, store, config);
  registerAdminAndCommunity(app, store, config);
  registerPipeline(app, store, config);
  registerCaptures(app, store, config, captures, captureEvents);
  registerMbta(app, config, store);
  registerLive(app, store, config);
  registerRealtime(app, config);
  registerPairing(app);
  if (options.worker !== false) {
    app.addHook('onReady', async () => {
      stopWorker = startJobWorker(store, config, logError, captures);
      if (captures) stopBridge = startCaptureBridge(store, config, captures, logError);
    });
  }
  return app;
}
