import { json } from './transit.mjs';
import { STOP_ID as bucenId, buildSegment as buildBucen } from './segment_bucen.mjs';
import { STOP_ID as bricoId, buildSegment as buildBrico } from './segment_brico.mjs';
import { STOP_ID as kenclId, buildSegment as buildKencl } from './segment_kencl.mjs';
import { STOP_ID as harsqId, buildSegment as buildHarsq } from './segment_harsq.mjs';
import { STOP_ID as chnclId, buildSegment as buildChncl } from './segment_chncl.mjs';

const builders = [
  [bucenId, buildBucen],
  [bricoId, buildBrico],
  [kenclId, buildKencl],
  [harsqId, buildHarsq],
  [chnclId, buildChncl],
];

export function segments(dir) {
  const anchors = {};
  for (const [id, build] of builders) {
    anchors[id] = build(dir);
  }
  json(dir + 'segment-anchors.json', anchors);
}
