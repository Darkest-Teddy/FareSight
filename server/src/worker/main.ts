import { getConfig } from '../config.ts';
import { Store } from '../db/database.ts';
import { startJobWorker } from './jobWorker.ts';

const config = getConfig();
const store = new Store(config.database);
const stop = startJobWorker(store, config);
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stop();
  store.sqlite.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
