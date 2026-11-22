import { existsSync } from 'node:fs';
import { hostname } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
for (const name of ['.env.local', '.env']) {
  const path = resolve(projectRoot, name);
  if (existsSync(path)) process.loadEnvFile(path);
}

/** Capture storage: Postgres (Tiger Data) for records and S3-compatible buckets (Vultr) for files. Off unless both are set. */
function captureConfig() {
  const env = process.env;
  const databaseUrl = env.DATABASE_URL;
  const endpoint = env.VULTR_S3_ENDPOINT?.replace(/\/+$/, '');
  const accessKey = env.VULTR_S3_ACCESS_KEY;
  const secretKey = env.VULTR_S3_SECRET_KEY;
  if (!databaseUrl || !endpoint || !accessKey || !secretKey) return undefined;
  const splatBucket = env.SPLAT_BUCKET || 'faresight-splats';
  return {
    databaseUrl,
    // LISTEN and job claiming need a session, which a transaction-mode pooler does not give.
    databaseUrlDirect: env.DATABASE_URL_DIRECT || databaseUrl,
    endpoint, accessKey, secretKey,
    region: env.VULTR_S3_REGION || 'us-east-1',
    rawBucket: env.RAW_BUCKET || 'faresight-raw',
    splatBucket,
    cdnBaseUrl: (env.CDN_BASE_URL || `${endpoint}/${splatBucket}`).replace(/\/+$/, ''),
    appOrigins: (env.APP_ORIGINS || '*').split(',').map((origin) => origin.trim()).filter(Boolean),
    // Stable across restarts, so a restarted worker keeps the heartbeat on the jobs it already holds.
    workerId: env.WORKER_ID || hostname(),
    minFrames: Math.max(2, Number(env.MIN_FRAMES) || 2),
    // Off on a machine that shares the database but must leave the building to another server.
    buildCaptures: env.CAPTURE_BUILDS !== 'false',
  };
}

export type CaptureConfig = NonNullable<ReturnType<typeof captureConfig>>;

export function getConfig() {
  const port = Number(process.env.PORT ?? 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`;
  const parsedBase = URL.parse(publicBaseUrl);
  if (!/^https?:\/\//i.test(publicBaseUrl) || !parsedBase || !['http:', 'https:'].includes(parsedBase.protocol)) {
    throw new Error('PUBLIC_BASE_URL must be an absolute HTTP(S) URL');
  }
  const storage = resolve(process.env.FARESIGHT_STORAGE_DIR ?? resolve(projectRoot, 'server/storage'));
  const mode = process.env.PIPELINE_MODE ?? 'auto';
  if (mode !== 'auto' && mode !== 'demo' && mode !== 'live') throw new Error('PIPELINE_MODE must be auto, demo, or live');
  return {
    port, host: process.env.HOST ?? '0.0.0.0',
    database: process.env.FARESIGHT_DB_PATH ?? resolve(projectRoot, 'server/data/faresight.db'),
    uploads: resolve(storage, 'uploads'), outputs: resolve(storage, 'outputs'),
    demoAssets: [resolve(projectRoot, 'web/public/assets-demo'), resolve(projectRoot, 'modeling/output')],
    publicBaseUrl,
    adminPasscode: process.env.ADMIN_PASSCODE,
    contributorPasscode: process.env.CONTRIBUTOR_PASSCODE,
    allowUnauthenticatedDemo: process.env.ALLOW_UNAUTHENTICATED_DEMO === '1',
    // Contributors upload and start builds without a code. Admin routes still need ADMIN_PASSCODE.
    openUploads: process.env.OPEN_UPLOADS === '1',
    geminiKey: process.env.GEMINI_API_KEY,
    openaiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: (process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    openaiLiveModel: process.env.OPENAI_LIVE_MODEL || 'gpt-live-1.1',
    openaiLiveBackendModel: process.env.OPENAI_LIVE_BACKEND_MODEL || 'gpt-6-luna',
    openaiLiveVoice: process.env.OPENAI_LIVE_VOICE || 'ballad',
    atlasKey: process.env.WLT_API_KEY ?? process.env.WORLDLABS_API_KEY,
    atlasBaseUrl: (process.env.WLT_API_BASE_URL || 'https://api.atlas.worldlabs.ai/api/v2').replace(/\/+$/, ''),
    replicateKey: process.env.REPLICATE_API_TOKEN,
    mbtaKey: process.env.MBTA_API_KEY,
    mode,
    // Finished builds go live at once. Set AUTO_PUBLISH=false to hold them at "needs review" for an admin.
    autoPublish: process.env.AUTO_PUBLISH !== 'false',
    captures: captureConfig(),
  } as const;
}

export type Config = ReturnType<typeof getConfig>;

/** Which backend builds a job, and whether live mode is missing the key for it. */
export function pipelineProvider(config: Config, kind: 'room' | 'dish') {
  const key = kind === 'room' ? config.atlasKey : config.replicateKey;
  const live = kind === 'room' ? 'atlas-v2' as const : 'trellis-replicate' as const;
  const provider = config.mode === 'demo' || (config.mode === 'auto' && !key) ? 'demo-sim' as const : live;
  return { provider, missingKey: config.mode === 'live' && !key };
}
