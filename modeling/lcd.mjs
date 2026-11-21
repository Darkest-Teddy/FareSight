import { deflateSync } from 'node:zlib';

// Five-row dot-matrix type, shared by the installed LCD face and its station legend.
const glyphs = {
  A: '010101111101101',
  B: '110101110101110',
  C: '011100100100011',
  D: '110101101101110',
  E: '111100110100111',
  F: '111100110100100',
  G: '011100101101011',
  H: '101101111101101',
  I: '111010010010111',
  J: '001001001101010',
  K: '101101110101101',
  L: '100100100100111',
  M: '101111111101101',
  N: '101111111111101',
  O: '010101101101010',
  P: '110101110100100',
  Q: '010101101111011',
  R: '110101110101101',
  S: '011100010001110',
  T: '111010010010010',
  U: '101101101101111',
  V: '101101101101010',
  W: '101101111111101',
  X: '101101010101101',
  Y: '101101010010010',
  Z: '111001010100111',
  0: '111101101101111',
  1: '010110010010111',
  2: '110001010100111',
  3: '110001010001110',
  4: '101101111001001',
  5: '111100110001110',
  6: '011100110101010',
  7: '111001010010010',
  8: '010101010101010',
  9: '010101011001110',
  '-': '000000111000000',
  "'": '010010000000000',
  '/': '001001010100100',
};
function crc32(buf) {
  let n = 0xffffffff;
  for (const b of buf) {
    n ^= b;
    for (let k = 0; k < 8; k++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0);
  }
  return (n ^ 0xffffffff) >>> 0;
}
function chunk(id, data) {
  const tag = Buffer.from(id),
    b = Buffer.alloc(data.length + 12);
  b.writeUInt32BE(data.length);
  tag.copy(b, 4);
  data.copy(b, 8);
  b.writeUInt32BE(crc32(Buffer.concat([tag, data])), 8 + data.length);
  return b;
}
export function displayTexture(area, station) {
  const w = 480,
    h = 144,
    pixels = Buffer.alloc((w * 3 + 1) * h);
  const px = (x, y, c) => {
    const k = y * (1 + w * 3) + 1 + 3 * x;
    for (let i = 0; i < 3; i++) pixels[k + i] = c[i];
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = 0.84 + 0.13 * (1 - y / h) + 0.025 * Math.cos(y * Math.PI * 0.5);
      px(x, y, [32 * t, 144 * t, 158 * t]);
    }
  function label(x, y, str, size) {
    for (const ch of str) {
      const glyph = glyphs[ch];
      if (glyph)
        for (let i = 0; i < 15; i++)
          if (glyph[i] === '1')
            for (let v = 0; v < size; v++)
              for (let u = 0; u < size; u++)
                px(
                  x + (i % 3) * size + u,
                  y + Math.floor(i / 3) * size + v,
                  [213, 251, 226],
                );
      x += size * 4;
    }
  }
  label(20, 17, 'AREA - ' + area, 5);
  label(
    20,
    71,
    station.toUpperCase(),
    Math.min(9, Math.floor(440 / (station.length * 4))),
  );
  for (let x = 20; x < 460; x++) px(x, 57, [122, 202, 197]);
  for (let x = 400; x < 460; x += 8)
    for (let y = 22; y < 39; y++)
      for (let u = 0; u < 4; u++) px(x + u, y, [129, 221, 206]);
  return encodePng(w, h, pixels);
}
// `pixels` holds 8-bit RGB scanlines, each prefixed with a zero filter byte.
export function encodePng(w, h, pixels) {
  const info = Buffer.alloc(13);
  info.writeUInt32BE(w);
  info.writeUInt32BE(h, 4);
  info[8] = 8;
  info[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', info),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
