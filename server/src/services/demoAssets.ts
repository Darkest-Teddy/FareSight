import { statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import type { Config } from '../config.ts';

export function findDemoAsset(config: Config, file: string): string | undefined {
  if (basename(file) !== file || file.startsWith('.')) return undefined;
  return config.demoAssets.map((directory) => resolve(directory, file))
    .find((path) => statSync(path, { throwIfNoEntry: false })?.isFile());
}
