// pnpm --filter @faresight/server buckets
// Creates the raw and splat buckets if they are missing and applies their CORS and read rules.
import { getConfig } from '../config.ts';
import { createObjectStorage } from '../services/objectStorage.ts';

const { captures } = getConfig();
if (!captures) throw new Error('Set DATABASE_URL and the VULTR_S3_* variables first (see .env.example).');
const storage = createObjectStorage(captures);
try {
  for (const [bucket, open] of [[captures.rawBucket, false], [captures.splatBucket, true]] as const) {
    const notes = await storage.setupBucket(bucket, { public: open, origins: captures.appOrigins });
    console.log(`${bucket} (${open ? 'public read' : 'private'}): ${notes.join(', ') || 'already set up'}`);
  }
} finally {
  storage.close();
}
