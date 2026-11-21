import { encodePng } from './lcd.mjs';
import { rng } from './geometry.mjs';

// Facade tiles are drawn near-white so each building's vertex colour supplies the wall finish.
// One tile is one structural bay wide and one storey tall, and repeats across the elevation.
const SIZE = 128;
const hex = (c) => {
  const n = parseInt(c.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

class Tile {
  data = new Float32Array(SIZE * SIZE * 3);
  fill(color) {
    return this.rect(0, 0, 1, 1, color);
  }
  // Coordinates are fractions of the tile; v runs from the storey's ceiling (0) to its floor (1).
  rect(u0, v0, u1, v1, color, alpha = 1) {
    const c = hex(color);
    for (let y = Math.round(v0 * SIZE); y < Math.round(v1 * SIZE); y++)
      for (let x = Math.round(u0 * SIZE); x < Math.round(u1 * SIZE); x++) {
        const k = ((y & (SIZE - 1)) * SIZE + (x & (SIZE - 1))) * 3;
        for (let i = 0; i < 3; i++) this.data[k + i] += (c[i] - this.data[k + i]) * alpha;
      }
    return this;
  }
  // A glazed opening with a frame, a cool reflection gradient and optional glazing bars.
  window(u0, v0, u1, v1, { frame = '#f4f1ea', bars = [1, 1], glass = '#33404d', inset = 0.012 } = {}) {
    this.rect(u0 - inset, v0 - inset, u1 + inset, v1 + inset, frame);
    this.rect(u0, v0, u1, v1, glass);
    this.rect(u0, v0, u1, v0 + (v1 - v0) * 0.38, '#5d7284', 0.55);
    this.rect(u0, v0, u1, v0 + 0.012, '#141a20', 0.5);
    const [nx, ny] = bars;
    for (let i = 1; i < nx; i++) {
      const u = u0 + ((u1 - u0) * i) / nx;
      this.rect(u - 0.005, v0, u + 0.005, v1, frame);
    }
    for (let i = 1; i < ny; i++) {
      const v = v0 + ((v1 - v0) * i) / ny;
      this.rect(u0, v - 0.005, u1, v + 0.005, frame);
    }
    return this;
  }
  grain(amount, seed, stretch = 1) {
    const random = rng(seed);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x += stretch) {
        const n = 1 + (random() - 0.5) * amount;
        for (let s = 0; s < stretch && x + s < SIZE; s++)
          for (let i = 0; i < 3; i++) this.data[(y * SIZE + x + s) * 3 + i] *= n;
      }
    return this;
  }
  png() {
    const pixels = Buffer.alloc((SIZE * 3 + 1) * SIZE);
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE * 3; x++)
        pixels[y * (SIZE * 3 + 1) + 1 + x] = Math.max(0, Math.min(255, Math.round(this.data[y * SIZE * 3 + x])));
    return encodePng(SIZE, SIZE, pixels);
  }
}

// Wood-frame houses and triple-deckers: lap siding with two trimmed sash windows per bay.
function clapboard() {
  const t = new Tile().fill('#f1eee8');
  for (let i = 0; i < 16; i++) t.rect(0, i / 16, 1, i / 16 + 0.012, '#b9b4aa', 0.75);
  t.grain(0.05, 11);
  t.rect(0, 0, 1, 0.035, '#fbfaf6');
  for (const u of [0.14, 0.58]) {
    t.rect(u - 0.03, 0.2, u + 0.31, 0.24, '#fbfaf6');
    t.window(u, 0.25, u + 0.28, 0.76, { bars: [1, 2], frame: '#fbfaf6', inset: 0.028 });
    t.rect(u - 0.035, 0.785, u + 0.315, 0.815, '#fbfaf6');
  }
  return t;
}
// Masonry walk-ups: running-bond brick with stone lintels and sills.
function brick() {
  const t = new Tile().fill('#ece6df');
  for (let row = 0; row < 16; row++) {
    t.rect(0, row / 16, 1, row / 16 + 0.011, '#bdb3a8', 0.8);
    for (let col = 0; col < 8; col++)
      t.rect(((col + (row % 2) / 2) / 8) % 1, row / 16, ((col + (row % 2) / 2) / 8) % 1 + 0.008, (row + 1) / 16, '#bdb3a8', 0.6);
  }
  t.grain(0.09, 23, 8);
  t.rect(0, 0, 1, 0.03, '#d8d1c6', 0.7);
  for (const u of [0.13, 0.59]) {
    t.rect(u - 0.03, 0.19, u + 0.31, 0.25, '#fffdf7');
    t.window(u, 0.25, u + 0.28, 0.78, { bars: [1, 2], frame: '#e9e4d8', inset: 0.014 });
    t.rect(u - 0.035, 0.795, u + 0.315, 0.835, '#fffdf7');
  }
  return t;
}
// Street-level retail: sign band, awning, display glazing and a recessed door.
function storefront() {
  const t = new Tile().fill('#e9e5dd');
  t.rect(0, 0, 1, 0.06, '#fbf9f3');
  t.rect(0.04, 0.09, 0.96, 0.26, '#565d68');
  t.rect(0.1, 0.15, 0.62, 0.2, '#f3ead2');
  t.rect(0.02, 0.28, 0.98, 0.37, '#8d4a3f');
  for (let i = 0; i < 6; i++) t.rect(0.02 + i * 0.16, 0.28, 0.1 + i * 0.16, 0.37, '#efe7d6');
  t.window(0.07, 0.42, 0.6, 0.88, { bars: [2, 1], frame: '#4b4f55', glass: '#2c3944', inset: 0.016 });
  t.window(0.7, 0.42, 0.92, 0.985, { bars: [1, 1], frame: '#4b4f55', glass: '#27323b', inset: 0.016 });
  t.rect(0, 0.9, 0.66, 1, '#9b958c');
  return t;
}
// Modern towers: a unitised curtain wall with spandrel panels at each slab.
function curtainWall() {
  const t = new Tile().fill('#55697a');
  t.rect(0, 0, 1, 0.5, '#7b93a6', 0.55);
  t.rect(0, 0.74, 1, 1, '#aeb6ba');
  t.rect(0, 0.72, 1, 0.75, '#e8ebec');
  t.rect(0, 0.985, 1, 1, '#e8ebec');
  for (const u of [0, 0.5]) t.rect(u, 0, u + 0.035, 1, '#e8ebec');
  t.rect(0.25, 0, 0.262, 0.72, '#c9d0d4', 0.7);
  t.rect(0.75, 0, 0.762, 0.72, '#c9d0d4', 0.7);
  return t;
}
// University, civic and office blocks: dressed stone piers framing tall paired windows.
function institutional() {
  const t = new Tile().fill('#efebe3').grain(0.04, 37, 4);
  t.rect(0, 0, 1, 0.05, '#fbf9f4');
  t.rect(0, 0.93, 1, 0.96, '#cfc8bb', 0.8);
  t.rect(0, 0, 0.07, 1, '#fbf9f4', 0.8);
  t.rect(0.5, 0, 0.57, 1, '#fbf9f4', 0.8);
  for (const u of [0.15, 0.65]) t.window(u, 0.16, u + 0.27, 0.84, { bars: [2, 3], frame: '#d9d4c8', inset: 0.016 });
  return t;
}

export const FACADES = {
  clapboard: { tile: clapboard, bayM: 4.6, label: 'Clapboard house elevations' },
  brick: { tile: brick, bayM: 4.4, label: 'Brick walk-up elevations' },
  storefront: { tile: storefront, bayM: 5.2, label: 'Street-level storefronts' },
  curtain: { tile: curtainWall, bayM: 3, label: 'Glass curtain wall' },
  institutional: { tile: institutional, bayM: 5, label: 'Stone institutional elevations' },
};
const cache = new Map();
export function facadeTexture(kind) {
  if (!cache.has(kind)) cache.set(kind, FACADES[kind].tile().png());
  return cache.get(kind);
}
