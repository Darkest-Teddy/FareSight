import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import type { Config } from '../config.ts';

export function findReadableAsset(directory: string, file: string): string | undefined {
  if (!file || basename(file) !== file || file.startsWith('.') || file.includes('\\')) return;
  try {
    const root = realpathSync(directory);
    const path = realpathSync(resolve(root, file));
    const child = relative(root, path);
    if (!child || child === '..' || child.startsWith('..' + sep) || isAbsolute(child) || !statSync(path).isFile()) return;
    accessSync(path, constants.R_OK);
    return path;
  } catch {
    return;
  }
}

export function findDemoAsset(config: Config, file: string): string | undefined {
  for (const directory of config.demoAssets) {
    const path = findReadableAsset(directory, file);
    if (path) return path;
  }
}
