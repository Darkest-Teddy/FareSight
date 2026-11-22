import { getConfig } from '../config.ts';
import { Store } from '../db/database.ts';
import { mirrorJobs, openCaptures } from '../services/captures.ts';
import { startCaptureBridge } from './captureBridge.ts';
import { startJobWorker } from './jobWorker.ts';

const config = getConfig();
const store = new Store(config.database);
const captures = await openCaptures(config);
const stopMirror = captures && mirrorJobs(store, captures, console.error);
const stop = startJobWorker(store, config, console.error, captures);
const stopBridge = captures?.settings.buildCaptures ? startCaptureBridge(store, config, captures) : undefined;
let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  await stopBridge?.();
  await stop();
  await stopMirror?.();
  await captures?.close();
  store.sqlite.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
