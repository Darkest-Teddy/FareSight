import { createApp } from './app.ts';
import { getConfig } from './config.ts';

const config = getConfig();
const app = await createApp(config, { logger: true });
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  const deadline = setTimeout(() => {
    app.log.error('Shutdown drain deadline exceeded');
    process.exit(1);
  }, 15_000).unref();
  try {
    await app.close();
  } finally {
    clearTimeout(deadline);
  }
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
