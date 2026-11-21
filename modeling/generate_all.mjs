import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapSculpture, accessories } from './transit.mjs';
import { segments } from './segments.mjs';
import { splats } from './splats.mjs';

const output = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(output, { recursive: true });
mapSculpture(output);
accessories(output);
segments(output);
splats(output);
console.log(
  'Generated 8 glTF models, 6 Gaussian scenes and 3 metadata files in ' +
    output,
);
