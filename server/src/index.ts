import { createApp } from './app.ts';
import { getConfig } from './config.ts';

const config = getConfig();
const app = await createApp(config, { logger: true });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  await app.close();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await shutdown();
  process.exitCode = 1;
}
