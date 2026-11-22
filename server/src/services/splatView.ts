import { crc32, deflateSync } from 'node:zlib';
import type { PlyLayout } from './splatDecimate.ts';
import { plyColumn } from './splatProcessor.ts';

/** The constant that turns a Gaussian's stored colour coefficient into a colour. */
const SH_C0 = 0.28209479177387814;
const VIEW = 384;
/** Enough points to read the shape. More only slows the drawing down. */
const MAX_POINTS = 300_000;
const BACKGROUND = 235;

function png(width: number, height: number, rgb: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  // Every row starts with a filter byte, left at 0 for "none".
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(rows, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Draws a Gaussian PLY from the front and from the right, side by side, with up at the top: a plain
 * picture of the model's shape and colours for a vision model to look at. It is not a faithful render:
 * each solid Gaussian becomes one dot in its base colour. `turnedOver` draws the model as it would
 * stand after `turnOverPly`, without changing the file.
 */
export function renderSideViews(buffer: Buffer, layout: PlyLayout, turnedOver: boolean): Buffer {
  const [x, y, z] = ['x', 'y', 'z'].map((name) => plyColumn(buffer, layout, name));
  const colour = ['f_dc_0', 'f_dc_1', 'f_dc_2'].map((name) => plyColumn(buffer, layout, name));
  const logit = plyColumn(buffer, layout, 'opacity');
  const linear = plyColumn(buffer, layout, 'opacity_linear');
  if (!x || !y || !z) throw new Error('The splat has no readable positions');
  const sign = turnedOver ? -1 : 1;
  const step = Math.max(1, Math.ceil(layout.count / MAX_POINTS));
  const points: number[] = [];
  const low = [Infinity, Infinity, Infinity];
  const high = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index < layout.count; index += step) {
    const opacity = logit ? 1 / (1 + Math.exp(-logit.get(index))) : linear ? linear.get(index) : 1;
    if (opacity < 0.3) continue;
    const position = [x.get(index), sign * y.get(index), sign * z.get(index)];
    for (let axis = 0; axis < 3; axis++) {
      low[axis] = Math.min(low[axis], position[axis]);
      high[axis] = Math.max(high[axis], position[axis]);
    }
    points.push(...position, ...colour.map((channel) => Math.round(255 * Math.min(1, Math.max(0, 0.5 + SH_C0 * (channel?.get(index) ?? 0))))));
  }
  if (!points.length) throw new Error('The splat has nothing solid to draw');
  const centre = low.map((value, axis) => (value + high[axis]) / 2);
  // One scale for both views, with a margin, so the two pictures show the same model at the same size.
  const span = Math.max(...high.map((value, axis) => value - low[axis]), 1e-6) * 1.12;
  const rgb = Buffer.alloc(VIEW * 2 * VIEW * 3, BACKGROUND);
  const depth = new Float32Array(VIEW * 2 * VIEW).fill(-Infinity);
  const dot = (view: number, across: number, up: number, near: number, at: number) => {
    const column = Math.round((across / span + 0.5) * VIEW);
    const row = Math.round((0.5 - up / span) * VIEW);
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const px = column + dx;
        const py = row + dy;
        if (px < 0 || py < 0 || px >= VIEW || py >= VIEW) continue;
        const pixel = py * VIEW * 2 + view * VIEW + px;
        if (near <= depth[pixel]) continue;
        depth[pixel] = near;
        rgb[pixel * 3] = points[at + 3];
        rgb[pixel * 3 + 1] = points[at + 4];
        rgb[pixel * 3 + 2] = points[at + 5];
      }
    }
  };
  for (let at = 0; at < points.length; at += 6) {
    const px = points[at] - centre[0];
    const py = points[at + 1] - centre[1];
    const pz = points[at + 2] - centre[2];
    dot(0, px, py, pz, at); // from the front: looking down -z, +x to the right
    dot(1, -pz, py, px, at); // from the right: looking down -x, -z to the right
  }
  return png(VIEW * 2, VIEW, rgb);
}
