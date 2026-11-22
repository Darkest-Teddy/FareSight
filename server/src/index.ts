import { accessSync, constants, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createApp } from './app.ts';
import { getConfig, projectRoot } from './config.ts';

const webRoot = process.argv.includes('--serve-web') ? resolve(projectRoot, 'web/dist') : undefined;
if (webRoot) accessSync(resolve(webRoot, 'index.html'), constants.R_OK);
// Contribute is served next to the web app when it has been built too (`pnpm build` builds both).
const contributeDist = resolve(projectRoot, 'contribute/dist');
const contributeRoot = webRoot && existsSync(resolve(contributeDist, 'index.html')) ? contributeDist : undefined;
const config = getConfig(webRoot);
const app = await createApp(config, { logger: true, webRoot, contributeRoot });
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
