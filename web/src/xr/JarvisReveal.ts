import * as pc from 'playcanvas';
import { child, clamp } from './sceneSupport';

export const jarvisPalette = `
const vec3 jarvisBlue = vec3(0.117647, 0.745098, 1.0);
const vec3 jarvisIce = vec3(0.784314, 0.968627, 1.0);
`;

const scanSource = `
uniform float uJarvisProgress;
uniform vec4 uJarvisBounds;
uniform vec2 uJarvisHeight;
uniform mat4 uJarvisWorldToLocal;

float jarvisDistance(vec3 position) {
    vec3 offset = position - uJarvisBounds.xyz;
    float radial = length(offset.xz) / uJarvisBounds.w;
    float height = max(0.0, offset.y) / uJarvisHeight.x;
    return clamp(mix(radial, height, uJarvisHeight.y), 0.0, 1.0);
}

float jarvisLead() { return -0.065 + 1.43 * uJarvisProgress; }
float jarvisSolid() { return jarvisLead() - 0.27; }
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
    varying vec3 vJarvisColor;
    varying float vJarvisAlpha;
    void main(void) {
        float noise = fract(sin(dot(aPosition, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        float distance = jarvisDistance(aPosition);
        float leadOffset = jarvisLead() - distance + (noise - 0.5) * 0.053;
        float scanOffset = jarvisSolid() - distance;
        float arrived = smoothstep(-0.046, 0.073, leadOffset);
        float cloud = 1.0 - smoothstep(-0.024, 0.039, scanOffset);
        float front = 1.0 - smoothstep(0.0, 0.062, abs(leadOffset));
        float seam = 1.0 - smoothstep(0.0, 0.027, abs(scanOffset));
        float spark = max(front, seam * 0.88);
        vec3 raised = aPosition;
        raised.y += uJarvisBounds.w * (0.020 + 0.055 * noise) * (1.0 - arrived);
        gl_Position = matrix_viewProjection * matrix_model * vec4(raised, 1.0);
        float worldSize = uJarvisBounds.w * length(matrix_model[1].xyz);
        gl_PointSize = clamp((3.0 + 2.4 * spark) * smoothstep(0.002, 0.13, worldSize), 1.0, 5.4);
        vJarvisColor = mix(jarvisBlue, jarvisIce, spark);
        vJarvisAlpha = arrived * cloud * (0.58 + 0.36 * spark) * (0.67 + 0.33 * noise);
    }
  `,
  fragmentGLSL: `
    varying vec3 vJarvisColor;
    varying float vJarvisAlpha;
    void main(void) {
        float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float intensity = (1.0 - smoothstep(0.28, 1.0, r)) * vJarvisAlpha;
        if (intensity < 0.012) discard;
        gl_FragColor = vec4(vJarvisColor, intensity);
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

function samplePositions(geometry: Geometry[], limit: number): Float32Array {
  const total = geometry.reduce((sum, { mesh }) => sum + mesh.vertexBuffer.numVertices, 0);
  const capacity = Math.min(limit, total);
  const positions = new Float32Array(capacity * 3);
  const stride = Math.max(1, total / Math.max(1, capacity));
  const position = new pc.Vec3();
  let cursor = stride / 2;
  let start = 0;
  let count = 0;
  for (const { mesh, transform } of geometry) {
    const buffer = mesh.vertexBuffer;
    const end = start + buffer.numVertices;
    if (cursor < end && count < capacity) {
      // Read the retained CPU storage without requesting a full vertex copy or GPU upload.
      const accessor = new pc.VertexIterator(buffer).element[pc.SEMANTIC_POSITION];
      while (cursor < end && count < capacity) {
        if (accessor) {
          const offset = Math.floor(cursor - start) * accessor.stride;
          const data = accessor.array;
          position.set(data[offset], data[offset + 1], data[offset + 2]);
          transform.transformPoint(position, position);
          positions[count * 3] = position.x;
          positions[count * 3 + 1] = position.y;
          positions[count * 3 + 2] = position.z;
          count++;
        }
        cursor += stride;
      }
    }
    start = end;
  }
  return positions.subarray(0, count * 3);
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
    height: new Float32Array([height, clamp(height / (height + radius), 0, 0.72)]),
  };
}

function cloneForScan(original: pc.StandardMaterial): pc.StandardMaterial {
  const temporary = original.clone();
  const chunks = temporary.getShaderChunks(pc.SHADERLANGUAGE_GLSL);
  const declarations = chunks.get('litUserDeclarationPS') ?? '';
  const start = chunks.get('litUserMainStartPS') ?? '';
  const end = chunks.get('litUserMainEndPS') ?? '';
  chunks.set('litUserDeclarationPS', declarations + scanSource + jarvisPalette);
  chunks.set('litUserMainStartPS', start + `
    vec3 jarvisLocal = (uJarvisWorldToLocal * vec4(vPositionW, 1.0)).xyz;
    float jarvisOffset = jarvisSolid() - jarvisDistance(jarvisLocal);
    if (jarvisOffset < 0.0) discard;
  `);
  chunks.set('litUserMainEndPS', end + `
    #ifdef FORWARD_PASS
      float jarvisSeam = 1.0 - smoothstep(0.002, 0.038, jarvisOffset);
      vec3 jarvisSeamColor = mix(jarvisBlue, jarvisIce, 0.82 * jarvisSeam);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, jarvisSeamColor, jarvisSeam * 0.92);
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

  show(root: pc.Entity, duration = 0.72, limit = 900, delay = 0): void {
    this.animate(root, 1, duration, limit, delay);
  }

  hide(root: pc.Entity, duration = 0.60, limit = 900, onFinish?: () => void): void {
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

  seek(root: pc.Entity, progress: number, limit = 3000): void {
    if (!this.enabled || progress <= 0 || progress >= 1) {
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

  refresh(root: pc.Entity, duration = 0.72, limit = 900): void {
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
    const positions = samplePositions(geometry, limit);
    if (!positions.length) return resources;
    const points = child(root, 'Jarvis reveal points');
    const mesh = new pc.Mesh(this.device);
    mesh.setPositions(positions);
    mesh.update(pc.PRIMITIVE_POINTS);
    const material = new pc.ShaderMaterial(pointShader);
    material.blendType = pc.BLEND_ADDITIVEALPHA;
    material.depthWrite = false;
    material.cull = pc.CULLFACE_NONE;
    material.setParameter('uJarvisBounds', originRadius);
    material.setParameter('uJarvisHeight', height);
    material.update();
    const instance = new pc.MeshInstance(mesh, material, points);
    points.addComponent('render', { meshInstances: [instance], castShadows: false });
    resources.points = points;
    resources.pointMaterial = material;
    return resources;
  }

  update(dt: number): void {
    if (!this.active.size) return;
    for (const [root, reveal] of this.active) {
      if (!this.enabled) {
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
