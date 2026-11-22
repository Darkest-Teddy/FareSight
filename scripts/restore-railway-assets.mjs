import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';

const assets = 'web/dist/assets-demo';
const commit = process.env.RAILWAY_GIT_COMMIT_SHA;
const pointerVersion = 'version https://git-lfs.github.com/spec/v1';

async function fetchAsset(source, expectedHash) {
  const path = source.split('/').map(encodeURIComponent).join('/');
  const url = `https://media.githubusercontent.com/media/Darkest-Teddy/Vantage/${commit}/${path}`;
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`${source} returned HTTP ${response.status}`);
      const content = Buffer.from(await response.arrayBuffer());
      assert.equal(createHash('sha256').update(content).digest('hex'), expectedHash, `Checksum mismatch for ${source}`);
      return content;
    } catch (error) {
      if (attempt === 3) throw error;
    }
  }
}

async function restore(name) {
  const destination = `${assets}/${name}`;
  const file = await stat(destination);
  if (!file.isFile() || file.size >= 200) return false;

  // Railway's GitHub snapshot can contain LFS pointers instead of the model files.
  const pointer = await readFile(destination, 'utf8');
  if (!pointer.startsWith(`${pointerVersion}\n`)) return false;
  const expectedHash = pointer.match(/^oid sha256:([a-f\d]{64})$/m)?.[1];
  assert(expectedHash, `Invalid LFS pointer for ${name}`);
  assert.match(commit ?? '', /^[a-f\d]{40}$/, 'Set RAILWAY_GIT_COMMIT_SHA to the deployed commit');

  const publicAsset = `web/public/assets-demo/${name}`;
  const source = existsSync(publicAsset) ? publicAsset : `modeling/output/${name}`;
  await writeFile(destination, await fetchAsset(source, expectedHash));
  return true;
}

const files = await readdir(assets, { recursive: true });
let restored = 0;
for (let index = 0; index < files.length; index += 8) {
  const batch = await Promise.all(files.slice(index, index + 8).map(restore));
  restored += batch.filter(Boolean).length;
}

const map = await readFile(`${assets}/boston-map-sculpture.glb`);
assert.equal(map.subarray(0, 4).toString(), 'glTF', 'The Boston map must be a binary glTF file');
console.log(`Verified the Boston map and restored ${restored} Git LFS assets.`);
