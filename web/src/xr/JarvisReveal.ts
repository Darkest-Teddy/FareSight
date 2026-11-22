import * as pc from 'playcanvas';
import { child, clamp } from './sceneSupport';

export const jarvisPoints = { hero: 26_000, prop: 8_000, detail: 2_200 } as const;

// The reveal draws a model in as a light blue stipple that resolves into colour, and a hidden model
// dissipates back into the same cloud. "Blue" is the body tone of the dots (#6A9DD4, a lighter, airier
// step of the sculpture's water #4F86C6, still dark enough to read on the #F5F0E6 paper); "ice" is the
// paler glint on the leading edge and the scan line across the surface (#A8CBEE).
export const jarvisPalette = `
const vec3 jarvisBlue = vec3(0.416, 0.616, 0.831);
const vec3 jarvisIce = vec3(0.659, 0.796, 0.933);
`;

export const jarvisWaves = `
vec3 jarvisWaveOffsets(float progress, float distance) {
    float lead = -0.12 + 2.02 * progress - distance;
    return lead - vec3(0.0, 0.26, 0.56);
}

float jarvisArrival(float offset) { return smoothstep(-0.08, 0.12, offset); }
float jarvisGrowth(float offset) { return smoothstep(-0.06, 0.24, offset); }

vec3 jarvisLitBlue(vec3 original) {
    float lum = clamp(dot(original, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
    return mix(vec3(0.45, 0.60, 0.79), vec3(0.86, 0.92, 0.97), lum);
}

vec3 jarvisMaterialColor(vec3 blue, vec3 original, float offset) {
    float color = smoothstep(-0.05, 0.20, offset);
    float edge = 1.0 - smoothstep(0.005, 0.055, abs(offset - 0.035));
    return mix(mix(blue, original, color), jarvisIce, 0.34 * edge);
}
`;

const scanSource = `
uniform float uJarvisProgress;
uniform vec4 uJarvisBounds;
uniform vec2 uJarvisHeight;
uniform mat4 uJarvisWorldToLocal;

const float jarvisMeshJoin = 0.18;

float jarvisDistance(vec3 position) {
    vec3 offset = position - uJarvisBounds.xyz;
    vec3 unit = offset / uJarvisBounds.w;
    float radial = length(unit.xz);
    float height = clamp(offset.y / uJarvisHeight.x, 0.0, 1.0);
    float variation = 0.025 * sin(16.0 * unit.x + 7.0 * unit.y) * sin(14.0 * unit.z - 4.0 * unit.y);
    return clamp(mix(radial, height, uJarvisHeight.y) + variation, 0.0, 1.0);
}
`;

const pointShader = {
  uniqueName: 'FareSight Jarvis points',
  attributes: { aPosition: pc.SEMANTIC_POSITION },
  vertexGLSL: `
    attribute vec3 aPosition;
    uniform mat4 matrix_model;
    uniform mat4 matrix_viewProjection;
    ${scanSource}
    ${jarvisPalette}
    ${jarvisWaves}
    varying float vJarvisAlpha;
    varying float vJarvisGlint;
    void main(void) {
        vec3 wave = jarvisWaveOffsets(uJarvisProgress, jarvisDistance(aPosition));
        float arrival = jarvisArrival(wave.x);
        float grow = jarvisGrowth(wave.y);
        float fuse = smoothstep(0.21, 0.34, wave.y);
        gl_Position = matrix_viewProjection * matrix_model * vec4(aPosition, 1.0);
        // Limit the bias with distance so points on the far side stay occluded.
        float depthBias = min(0.0012 * gl_Position.w, 0.00007 / max(gl_Position.w, 0.05));
        gl_Position.z -= clamp(depthBias, 0.0, max(0.0, gl_Position.z + gl_Position.w));
        float worldSize = uJarvisBounds.w * length(matrix_model[1].xyz);
        float scale = mix(0.55, 1.0, smoothstep(0.012, 0.27, worldSize));
        gl_PointSize = mix(2.6, 9.0, grow) * scale;
        float seed = fract(sin(dot(aPosition, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        float shimmer = 0.87 + 0.13 * sin(27.0 * uJarvisProgress + 6.283 * seed);
        vJarvisAlpha = arrival * (1.0 - fuse) * mix(0.92, 0.70, grow) * shimmer;
        vJarvisGlint = 0.20 * grow * shimmer + 0.20 * (1.0 - smoothstep(0.025, 0.095, wave.x));
    }
  `,
  fragmentGLSL: `
    ${jarvisPalette}
    varying float vJarvisAlpha;
    varying float vJarvisGlint;
    void main(void) {
        float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float core = 1.0 - smoothstep(0.27, 0.59, r);
        float halo = 1.0 - smoothstep(0.41, 1.0, r);
        float alpha = (0.80 * core + 0.20 * halo) * vJarvisAlpha;
        if (alpha < 0.008) discard;
        vec3 color = mix(jarvisBlue, jarvisIce, vJarvisGlint * core);
        gl_FragColor = vec4(color, alpha);
    }
  `,
};

interface MaterialBinding {
  instance: pc.MeshInstance;
  original: pc.StandardMaterial;
  temporary: pc.StandardMaterial;
}

interface ScanResources {
  inverse: pc.Mat4;
  materials: Set<pc.StandardMaterial>;
  bindings: MaterialBinding[];
  points?: pc.Entity;
  pointMaterial?: pc.ShaderMaterial;
}

interface Reveal {
  progress: number;
  goal: 0 | 1;
  time: number;
  duration: number;
  delay: number;
  limit: number;
  manual: boolean;
  resources?: ScanResources;
  onFinish?: () => void;
  onDestroy: pc.EventHandle;
}

type Geometry = { instance: pc.MeshInstance; mesh: pc.Mesh; transform: pc.Mat4 };

function geometryOf(root: pc.Entity): Geometry[] {
  const inverse = new pc.Mat4().invert(root.getWorldTransform());
  const geometry: Geometry[] = [];
  for (const render of root.findComponents('render')) {
    if (!render.enabled || !render.entity.enabled) continue;
    for (const instance of render.meshInstances) {
      if (instance.mesh && instance.visible && instance.material instanceof pc.StandardMaterial) {
        geometry.push({ instance, mesh: instance.mesh, transform: new pc.Mat4().mul2(inverse, instance.node.getWorldTransform()) });
      }
    }
  }
  return geometry;
}

interface Surface {
  positions: Float32Array;
  indices?: Uint32Array;
  base: number;
  baseVertex: number;
  count: number;
  areas: Float64Array;
  area: number;
}

function readSurface({ mesh, transform }: Geometry): Surface | undefined {
  const primitive = mesh.primitive[pc.RENDERSTYLE_SOLID];
  const vertexCount = mesh.vertexBuffer?.numVertices ?? 0;
  if (!primitive || !vertexCount || !primitive.count) return;
  const buffer = primitive.indexed ? mesh.indexBuffer[pc.RENDERSTYLE_SOLID] : undefined;
  if (primitive.indexed && !buffer) return;
  const positions = new Float32Array(vertexCount * 3);
  if (!mesh.getPositions(positions)) return;
  const m = transform.data;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    positions[i] = m[0] * x + m[4] * y + m[8] * z + m[12];
    positions[i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    positions[i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
  const indices = buffer && new Uint32Array(buffer.numIndices);
  if (indices) mesh.getIndices(indices);
  const { base, count } = primitive;
  const baseVertex = primitive.baseVertex ?? 0;
  const triangleCount = primitive.type === pc.PRIMITIVE_TRIANGLES ? Math.floor(count / 3) : 0;
  const areas = new Float64Array(triangleCount);
  let area = 0;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const offset = base + triangle * 3;
    const a = ((indices ? indices[offset] : offset) + baseVertex) * 3;
    const b = ((indices ? indices[offset + 1] : offset + 1) + baseVertex) * 3;
    const c = ((indices ? indices[offset + 2] : offset + 2) + baseVertex) * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    area += Math.sqrt(nx * nx + ny * ny + nz * nz) || 0;
    areas[triangle] = area;
  }
  return { positions, indices, base, baseVertex, count, areas, area };
}

function samplePositions(geometry: Geometry[], limit: number): Float32Array {
  const surfaces = geometry.map(readSurface).filter((surface): surface is Surface => !!surface);
  const triangles = surfaces.filter(({ area }) => area > 0);
  const totalArea = triangles.reduce((total, { area }) => total + area, 0);
  const vertices = surfaces.reduce((total, { count }) => total + count, 0);
  const accents = Math.min(vertices, totalArea ? Math.round(limit * 0.09) : limit);
  const coats = totalArea ? limit - accents : 0;
  const points = new Float32Array((coats + accents) * 3);
  let seed = 711;
  const random = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 0x100000000;
  };

  // Walk the cumulative areas in order, taking one sample per equal-area stratum.
  let part = 0;
  let triangle = 0;
  let preceding = 0;
  for (let i = 0; i < coats; i++) {
    const area = (i + random()) * totalArea / coats;
    while (part + 1 < triangles.length && area >= preceding + triangles[part].area) {
      preceding += triangles[part++].area;
      triangle = 0;
    }
    const { positions, indices, base, baseVertex, areas } = triangles[part];
    while (triangle + 1 < areas.length && area - preceding >= areas[triangle]) triangle++;
    const offset = base + triangle * 3;
    const a = ((indices ? indices[offset] : offset) + baseVertex) * 3;
    const b = ((indices ? indices[offset + 1] : offset + 1) + baseVertex) * 3;
    const c = ((indices ? indices[offset + 2] : offset + 2) + baseVertex) * 3;
    const r1 = Math.sqrt(random());
    const r2 = random();
    let wa = 1 - r1;
    let wb = r1 * (1 - r2);
    let wc = r1 * r2;
    if (i % 12 === 0) {
      const edge = Math.floor(random() * 3);
      wa = edge === 0 ? 0 : edge === 1 ? r2 : 1 - r2;
      wb = edge === 1 ? 0 : edge === 2 ? r2 : 1 - r2;
      wc = 1 - wa - wb;
    }
    const write = i * 3;
    for (let axis = 0; axis < 3; axis++) {
      points[write + axis] = wa * positions[a + axis] + wb * positions[b + axis] + wc * positions[c + axis];
    }
  }

  part = 0;
  preceding = 0;
  for (let i = 0; i < accents; i++) {
    const vertex = Math.floor((i + 0.5) * vertices / accents);
    while (vertex >= preceding + surfaces[part].count) preceding += surfaces[part++].count;
    const { positions, indices, base, baseVertex } = surfaces[part];
    const offset = base + vertex - preceding;
    const index = ((indices ? indices[offset] : offset) + baseVertex) * 3;
    const write = (coats + i) * 3;
    points[write] = positions[index];
    points[write + 1] = positions[index + 1];
    points[write + 2] = positions[index + 2];
  }
  return points;
}

const pointCache = new WeakMap<pc.Mesh, Map<string, Float32Array>>();

function cachedPoints(geometry: Geometry[], limit: number): Float32Array {
  if (!geometry.length) return new Float32Array();
  const key = geometry.map(({ mesh, transform }) =>
    mesh.id + ':' + Array.from(transform.data, (value) => Math.round(value * 100_000)).join(',')).join('|') + '#' + limit;
  const mesh = geometry[0].mesh;
  let cache = pointCache.get(mesh);
  if (!cache) pointCache.set(mesh, cache = new Map());
  const previous = cache.get(key);
  if (previous) {
    cache.delete(key);
    cache.set(key, previous);
    return previous;
  }
  const points = samplePositions(geometry, limit);
  // Moving fingers, keys, or billboards can change the hierarchy each time.
  if (cache.size >= 4) cache.delete(cache.keys().next().value!);
  cache.set(key, points);
  return points;
}

function scanBounds(geometry: Geometry[]): { originRadius: Float32Array; height: Float32Array } {
  const bounds = new pc.BoundingBox();
  const next = new pc.BoundingBox();
  geometry.forEach(({ mesh, transform }, i) => {
    next.setFromTransformedAabb(mesh.aabb, transform);
    if (i === 0) bounds.copy(next);
    else bounds.add(next);
  });
  const { center, halfExtents: half } = bounds;
  const radius = Math.max(0.002, Math.hypot(half.x, half.z));
  const height = Math.max(0.002, 2 * half.y);
  return {
    originRadius: new Float32Array([center.x, center.y - half.y, center.z, radius]),
    height: new Float32Array([height, clamp(0.20 + 0.78 * height / (height + radius), 0.24, 0.58)]),
  };
}

function cloneForScan(original: pc.StandardMaterial): pc.StandardMaterial {
  const temporary = original.clone();
  temporary.cull = pc.CULLFACE_NONE;
  if (original.blendType === pc.BLEND_NONE) {
    temporary.blendType = pc.BLEND_NORMAL;
    temporary.depthWrite = true;
  }
  const chunks = temporary.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
  const declarations = chunks.get('litUserDeclarationPS') ?? '';
  const start = chunks.get('litUserMainStartPS') ?? '';
  const end = chunks.get('litUserMainEndPS') ?? '';
  chunks.set('litUserDeclarationPS', declarations + scanSource + jarvisPalette + jarvisWaves);
  chunks.set('litUserMainStartPS', start + `
    vec3 jarvisLocal = (uJarvisWorldToLocal * vec4(vPositionW, 1.0)).xyz;
    vec3 jarvisWave = jarvisWaveOffsets(uJarvisProgress, jarvisDistance(jarvisLocal));
    if (jarvisWave.y < jarvisMeshJoin) discard;
  `);
  chunks.set('litUserMainEndPS', end + `
    #ifdef FORWARD_PASS
      vec3 originalColor = gl_FragColor.rgb;
      vec3 blue = jarvisLitBlue(originalColor);
      ${original.cull === pc.CULLFACE_BACK ? `
        if (!gl_FrontFacing) {
          originalColor = mix(originalColor, vec3(0.62, 0.61, 0.58), 0.70);
          blue = mix(blue, vec3(0.62, 0.72, 0.84), 0.55);
        }
      ` : ''}
      gl_FragColor.rgb = jarvisMaterialColor(blue, originalColor, jarvisWave.z);
      gl_FragColor.a *= smoothstep(jarvisMeshJoin, 0.27, jarvisWave.y);
    #endif
  `);
  temporary.update();
  return temporary;
}

export class JarvisReveal {
  private active = new Map<pc.Entity, Reveal>();

  constructor(private device: pc.GraphicsDevice, private reducedMotion: MediaQueryList) {}

  get enabled(): boolean { return this.device.isWebGL2 && !this.reducedMotion.matches; }

  isAnimating(root: pc.Entity): boolean { return this.active.has(root); }

  show(root: pc.Entity, duration = 0.72, limit: number = jarvisPoints.prop, delay = 0): void {
    this.animate(root, 1, duration, limit, delay);
  }

  hide(root: pc.Entity, duration = 0.60, limit: number = jarvisPoints.prop, onFinish?: () => void): void {
    this.animate(root, 0, duration, limit, 0, onFinish);
  }

  private animate(root: pc.Entity, goal: 0 | 1, duration: number, limit: number, delay: number, onFinish?: () => void): void {
    if (!this.enabled || (goal === 0 && !root.enabled)) {
      this.finish(root, goal === 1);
      onFinish?.();
      return;
    }
    const ancestor = this.ancestorReveal(root.parent);
    if (ancestor) {
      this.finish(root, goal === 1);
      this.releaseResources(ancestor);
      onFinish?.();
      return;
    }
    const previous = this.active.get(root);
    if (previous && !previous.manual && previous.goal !== goal) {
      previous.goal = goal;
      previous.time = previous.progress;
      previous.duration = duration;
      previous.delay = 0;
      previous.onFinish = onFinish;
      root.enabled = true;
      return;
    }
    const progress = previous && previous.goal !== goal ? previous.progress : 1 - goal;
    this.cancel(root);
    const reveal: Reveal = {
      progress, goal, time: progress, duration, delay, limit, manual: false, onFinish,
      onDestroy: root.once('destroy', () => this.cancel(root)),
    };
    this.active.set(root, reveal);
    root.enabled = delay <= 0;
  }

  seek(root: pc.Entity, progress: number, limit: number = jarvisPoints.hero): void {
    if (!this.device.isWebGL2 || progress <= 0 || progress >= 1) {
      this.finish(root, progress > 0);
      return;
    }
    let reveal = this.active.get(root);
    if (!reveal?.manual) {
      this.cancel(root);
      reveal = {
        progress, goal: 1, time: 0, duration: 1, delay: 0, limit, manual: true,
        onDestroy: root.once('destroy', () => this.cancel(root)),
      };
      this.active.set(root, reveal);
    }
    root.enabled = true;
    reveal.progress = progress;
  }

  refresh(root: pc.Entity, duration = 0.72, limit: number = jarvisPoints.prop): void {
    const reveal = this.ancestorReveal(root);
    if (reveal) this.releaseResources(reveal);
    else if (root.enabled) this.show(root, duration, limit);
  }

  private ancestorReveal(node: pc.GraphNode | null): Reveal | undefined {
    for (; node; node = node.parent) {
      if (!(node instanceof pc.Entity)) continue;
      const reveal = this.active.get(node);
      if (reveal) return reveal;
    }
    return undefined;
  }

  finish(root: pc.Entity, visible: boolean): void {
    this.cancel(root);
    root.enabled = visible;
  }

  cancel(root: pc.Entity): void {
    const reveal = this.active.get(root);
    if (!reveal) return;
    this.active.delete(root);
    reveal.onDestroy.off();
    this.releaseResources(reveal);
  }

  private releaseResources(reveal: Reveal): void {
    const resources = reveal.resources;
    if (!resources) return;
    reveal.resources = undefined;
    for (const { instance, original, temporary } of resources.bindings) {
      if (instance.material === temporary) instance.material = original;
    }
    resources.points?.destroy();
    resources.pointMaterial?.destroy();
    for (const material of resources.materials) material.destroy();
  }

  private prepare(root: pc.Entity, limit: number): ScanResources {
    for (const [entity, reveal] of this.active) {
      if (!entity.isDescendantOf(root)) continue;
      this.finish(entity, reveal.goal === 1);
      reveal.onFinish?.();
    }
    const geometry = geometryOf(root);
    const materials = new Map<pc.StandardMaterial, pc.StandardMaterial>();
    const bindings: MaterialBinding[] = [];
    for (const { instance } of geometry) {
      const original = instance.material as pc.StandardMaterial;
      let temporary = materials.get(original);
      if (!temporary) {
        temporary = cloneForScan(original);
        materials.set(original, temporary);
      }
      instance.material = temporary;
      bindings.push({ instance, original, temporary });
    }
    const { originRadius, height } = scanBounds(geometry);
    const resources: ScanResources = { materials: new Set(materials.values()), inverse: new pc.Mat4(), bindings };
    for (const surface of resources.materials) {
      surface.setParameter('uJarvisBounds', originRadius);
      surface.setParameter('uJarvisHeight', height);
    }
    const positions = cachedPoints(geometry, limit);
    if (!positions.length) return resources;
    const points = child(root, 'Jarvis reveal points');
    const mesh = new pc.Mesh(this.device);
    mesh.setPositions(positions);
    mesh.update(pc.PRIMITIVE_POINTS);
    const material = new pc.ShaderMaterial(pointShader);
    material.blendType = pc.BLEND_NORMAL;
    material.depthTest = true;
    material.depthWrite = false;
    material.cull = pc.CULLFACE_NONE;
    material.setParameter('uJarvisBounds', originRadius);
    material.setParameter('uJarvisHeight', height);
    material.update();
    const instance = new pc.MeshInstance(mesh, material, points);
    // Draw the dots after the surface so depth testing keeps them on the visible edge.
    instance.drawBucket = 0;
    points.addComponent('render', { meshInstances: [instance], castShadows: false });
    resources.points = points;
    resources.pointMaterial = material;
    return resources;
  }

  update(dt: number): void {
    if (!this.active.size) return;
    for (const [root, reveal] of this.active) {
      if (!this.enabled) {
        if (reveal.manual) { this.releaseResources(reveal); continue; }
        this.finish(root, reveal.goal === 1);
        reveal.onFinish?.();
        continue;
      }
      if (!reveal.manual) {
        if (root.parent && !root.parent.enabled) {
          if (reveal.goal === 0) {
            this.finish(root, false);
            reveal.onFinish?.();
          }
          continue;
        }
        if (reveal.delay > 0) {
          reveal.delay -= dt;
          if (reveal.delay > 0) continue;
        }
        root.enabled = true;
        const time = reveal.time + (reveal.goal === 1 ? dt : -dt) / reveal.duration;
        reveal.time = clamp(time, 0, 1);
        reveal.progress = reveal.time;
        if (reveal.progress === reveal.goal) {
          this.finish(root, reveal.goal === 1);
          reveal.onFinish?.();
          continue;
        }
      }
      if (!root.enabled) continue;
      const resources = reveal.resources ??= this.prepare(root, reveal.limit);
      resources.inverse.invert(root.getWorldTransform());
      for (const surface of resources.materials) {
        surface.setParameter('uJarvisProgress', reveal.progress);
        surface.setParameter('uJarvisWorldToLocal', resources.inverse.data);
      }
      resources.pointMaterial?.setParameter('uJarvisProgress', reveal.progress);
    }
  }

  destroy(): void {
    for (const root of this.active.keys()) this.cancel(root);
  }
}
