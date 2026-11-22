import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
for (const name of ['.env.local', '.env']) {
  const path = resolve(projectRoot, name);
  if (existsSync(path)) process.loadEnvFile(path);
}

export function getConfig() {
  const port = Number(process.env.PORT ?? 3001);
  const storage = resolve(process.env.FARESIGHT_STORAGE_DIR ?? resolve(projectRoot, 'server/storage'));
  const mode = process.env.PIPELINE_MODE ?? 'auto';
  if (mode !== 'auto' && mode !== 'demo' && mode !== 'live') throw new Error('PIPELINE_MODE must be auto, demo, or live');
  return {
    port, host: process.env.HOST ?? '0.0.0.0',
    database: process.env.FARESIGHT_DB_PATH ?? resolve(projectRoot, 'server/data/faresight.db'),
    uploads: resolve(storage, 'uploads'), outputs: resolve(storage, 'outputs'),
    demoAssets: [resolve(projectRoot, 'web/public/assets-demo'), resolve(projectRoot, 'modeling/output')],
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    adminPasscode: process.env.ADMIN_PASSCODE,
    geminiKey: process.env.GEMINI_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: (process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    openaiLiveModel: process.env.OPENAI_LIVE_MODEL || 'gpt-live-1.1',
    openaiLiveBackendModel: process.env.OPENAI_LIVE_BACKEND_MODEL || 'gpt-6-luna',
    openaiLiveVoice: process.env.OPENAI_LIVE_VOICE || 'marin',
    atlasKey: process.env.WLT_API_KEY ?? process.env.WORLDLABS_API_KEY,
    atlasBaseUrl: (process.env.WLT_API_BASE_URL || 'https://api.atlas.worldlabs.ai/api/v2').replace(/\/+$/, ''),
    replicateKey: process.env.REPLICATE_API_TOKEN,
    mbtaKey: process.env.MBTA_API_KEY,
    mode,
  } as const;
}

export type Config = ReturnType<typeof getConfig>;
