import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mapSculpture, accessories } from './transit.mjs';
import { trains } from './trains.mjs';
import { segments } from './segments.mjs';
import { physicalUi } from './physical_ui.mjs';
import { vrControllers } from './vr_controllers.mjs';
import { splats } from './splats.mjs';

const output = fileURLToPath(new URL('./output/', import.meta.url));
mkdirSync(output, { recursive: true });
mapSculpture(output);
accessories(output);
trains(output);
segments(output);
physicalUi(output);
vrControllers(output);
splats(output);
console.log(
  'Generated 20 glTF models, 2 Gaussian scenes and 3 metadata files in ' +
    output,
);
