import * as pc from 'playcanvas';
// @ts-expect-error PlayCanvas ships the SPZ parser script without TypeScript declarations.
import { SpzParser } from 'playcanvas/scripts/esm/parsers/spz-parser.mjs';
import zstdGlueUrl from '../../../server/vendor/playcanvas-zstd/zstd.wasm.js?url&no-inline';
import zstdWasmUrl from '../../../server/vendor/playcanvas-zstd/zstd.wasm.wasm?url';
import type { XRAssetData } from './bridgeTypes';
import { isSplat } from '../data/preview3D';
import { jarvisPalette, jarvisWaves } from './JarvisReveal';
import type { DebugLog } from './sceneSupport';

type Slot = 'room' | 'dish' | 'compare';

interface Source {
  refs: number;
  asset?: pc.Asset;
  ready: Promise<pc.Asset | null>;
  settle(asset: pc.Asset | null): void;
}

interface Placement {
  slot: Slot;
  data: XRAssetData;
  source: Source;
  parent: pc.Entity;
  entity?: pc.Entity;
  count: number;
  ready: Promise<boolean>;
  elapsed?: number;
  scrub?: { progress: number; applied?: number };
}

export const xrSplatBudget = 240_000;
// An Atlas draft room that could not be decimated arrives at 524,288 Gaussians. This leaves room for it plus
// a few dishes. Rooms converted with splat-transform stay near 100,000, which is what a Quest wants.
const hardGaussianLimit = 800_000;
const materializeSeconds = 2.2;
const starkModifier = { glsl: `
${jarvisPalette}
${jarvisWaves}
uniform float uStarkProgress;
uniform vec3 uStarkOrigin;
uniform float uStarkRadius;
uniform float uStarkHeight;
uniform float uStarkPointSize;

vec3 starkOffsets;
float starkSeen;
float starkGrowth;

void starkWave() {
    vec3 offset = getCenter() - uStarkOrigin;
    float height = clamp(offset.y / uStarkHeight, 0.0, 1.0);
    float distance = clamp(mix(length(offset.xz) / uStarkRadius, height, 0.44), 0.0, 1.0);
    starkOffsets = jarvisWaveOffsets(uStarkProgress, distance);
    starkSeen = jarvisArrival(starkOffsets.x);
    starkGrowth = jarvisGrowth(starkOffsets.y);
}

void modifySplatCenter(inout vec3 center) {}

void modifySplatRotationScale(vec3 originalCenter, vec3 modifiedCenter, inout vec4 rotation, inout vec3 scale) {
    if (uStarkProgress >= 1.0) return;
    starkWave();
    scale = mix(vec3(uStarkPointSize) * starkSeen, scale, starkGrowth);
}

void modifySplatColor(vec3 center, inout vec4 color) {
    if (uStarkProgress >= 1.0) return;
    #ifdef GSPLAT_WORKBUFFER_GEOMETRY
        starkWave();
    #endif
    vec3 originalColor = color.rgb;
    vec3 blue = mix(jarvisBlue, jarvisLitBlue(originalColor), starkGrowth);
    color.rgb = jarvisMaterialColor(blue, originalColor, starkOffsets.z);
    float dotOpacity = clamp(0.41 + 0.60 * sqrt(max(0.0, color.a)), 0.0, 1.0);
    color.a = mix(dotOpacity, color.a, starkGrowth) * starkSeen;
}
` };

export class SplatLoader {
  private sources = new Map<string, Source>();
  private slots = new Map<Slot, Placement>();
  private outgoing = new Map<Placement, { progress: number; duration: number; retain: boolean }>();
  private hidden = new Set<Slot>();
  private roomLayer: number = pc.LAYERID_WORLD;
  private disposed = false;

  constructor(private app: pc.Application, private log: DebugLog, private reducedMotion: MediaQueryList) {
    pc.WasmModule.setConfig('ZstdDecoderModule', { glueUrl: zstdGlueUrl, wasmUrl: zstdWasmUrl });
    app.loader.getHandler('gsplat')?.addParser(new SpzParser(app));
  }

  show(slot: Slot, data: XRAssetData | null | undefined, parent: pc.Entity): Promise<boolean> {
    const previous = this.slots.get(slot);
    if (!isSplat(data) || this.disposed) { this.clear(slot, 0.62); return Promise.resolve(false); }
    if (previous && previous.data.url === data.url && previous.data.scale_factor === data.scale_factor &&
      previous.data.scale_status === data.scale_status && previous.parent === parent) {
      previous.data = data;
      return previous.ready;
    }

    if (data.gaussian_count > 0 && !this.fits(slot, data.gaussian_count)) {
      this.log(`Gaussian safety limit exceeded while opening ${data.id}`, 'warn');
      this.clear(slot, 0.62);
      return Promise.resolve(false);
    }
    const source = this.acquire(data.url);
    this.clear(slot, 0.62);
    const placement: Placement = { slot, data, parent, source, count: 0, ready: Promise.resolve(false) };
    this.slots.set(slot, placement);
    placement.ready = this.attach(slot, placement);
    return placement.ready;
  }

  private async attach(slot: Slot, placement: Placement): Promise<boolean> {
    const asset = await placement.source.ready;
    if (this.slots.get(slot) !== placement) return false;
    if (!asset) {
      this.clear(slot);
      return false;
    }

    const { data, parent } = placement;
    const resource = asset.resource as pc.GSplatResourceBase;
    const count = resource.numSplats || data.gaussian_count || 0;
    if (!this.fits(slot, count)) {
      this.log(`Gaussian safety limit exceeded while opening ${data.id}`, 'warn');
      this.clear(slot);
      return false;
    }
    for (const [retired, fade] of this.outgoing) {
      if (count + this.loadedSplats <= hardGaussianLimit) break;
      if (fade.retain) continue;
      this.outgoing.delete(retired);
      this.disposePlacement(retired);
    }
    const entity = new pc.Entity(data.id, this.app);
    entity.addComponent('gsplat', { asset, unified: true, layers: [slot === 'room' ? this.roomLayer : pc.LAYERID_WORLD] });
    // A size given by a person and a size judged from the photos are both drawn. Anything else stays as built.
    const sized = data.scale_status === 'measured' || data.scale_status === 'estimated';
    const scale = sized && Number.isFinite(data.scale_factor) && data.scale_factor > 0
      ? data.scale_factor : 1;
    entity.setLocalScale(scale, scale, scale);
    // A dish stands on its parent: built dishes come centred on their middle, which would sink them halfway
    // into the table and leave the body that collides for them sitting above the model.
    const base = slot === 'room' ? undefined : resource.aabb?.getMin().y;
    if (base !== undefined && Number.isFinite(base)) entity.setLocalPosition(0, -base * scale, 0);
    parent.addChild(entity);
    placement.entity = entity;
    placement.count = count;
    if (placement.scrub) this.applyScrub(placement);
    else {
      entity.enabled = !this.hidden.has(slot);
      if (entity.enabled) this.reveal(slot);
    }
    return true;
  }

  private fits(slot: Slot, count: number): boolean {
    let total = count;
    for (const [other, placement] of this.slots) {
      if (other !== slot) total += placement.count || placement.data.gaussian_count || 0;
    }
    return total <= hardGaussianLimit;
  }

  setRoomLayer(layerId: number): void {
    if (this.roomLayer === layerId) return;
    this.roomLayer = layerId;
    for (const placement of [this.slots.get('room'), ...this.outgoing.keys()]) {
      if (placement?.slot === 'room' && placement.entity?.gsplat) placement.entity.gsplat.layers = [layerId];
    }
  }

  seekReveal(slot: Slot, progress: number): void {
    const placement = this.slots.get(slot);
    if (!placement) return;
    const scrub = placement.scrub ??= { progress: 0 };
    scrub.progress = pc.math.clamp(progress, 0, 1);
    this.applyScrub(placement);
  }

  private applyScrub(placement: Placement): void {
    const { entity, scrub } = placement;
    const splat = entity?.gsplat;
    if (!entity || !splat || !scrub) return;
    const progress = this.app.graphicsDevice.isWebGL2 && !this.reducedMotion.matches
      ? scrub.progress : Number(scrub.progress > 0);
    const previous = scrub.applied;
    if (previous === progress) return;
    scrub.applied = progress;
    placement.elapsed = undefined;
    this.outgoing.delete(placement);
    if (progress === 0) {
      this.hidePlacement(placement);
      return;
    }
    entity.enabled = true;
    if (progress === 1) this.finishEffect(splat);
    else if (previous !== undefined && previous > 0 && previous < 1) this.writeProgress(splat, progress);
    else this.beginEffect(placement, progress);
  }

  reveal(slot: Slot): void {
    const placement = this.slots.get(slot);
    if (!placement || this.hidden.has(slot)) return;
    placement.scrub = undefined;
    if (this.beginEffect(placement, 0)) placement.elapsed = 0;
  }

  setVisible(slot: Slot, visible: boolean): void {
    const wasVisible = !this.hidden.has(slot);
    if (wasVisible === visible) return;
    if (visible) this.hidden.delete(slot);
    else this.hidden.add(slot);
    const placement = this.slots.get(slot);
    const entity = placement?.entity;
    if (!placement || !entity) return;
    if (visible) {
      const progress = this.outgoing.get(placement)?.progress ?? 0;
      this.outgoing.delete(placement);
      entity.enabled = true;
      if (this.beginEffect(placement, progress)) placement.elapsed = progress * materializeSeconds;
    } else if (!this.startExit(placement, 0.58, true)) {
      this.hidePlacement(placement);
    }
  }

  private beginEffect(placement: Placement, progress: number): boolean {
    const entity = placement.entity;
    const splat = entity?.gsplat;
    if (!entity || !splat || !this.app.graphicsDevice.isWebGL2 || this.reducedMotion.matches) return false;
    const room = placement.slot === 'room';
    const scale = entity.getLocalScale().x;
    const bounds = splat.resource?.aabb;
    const half = bounds?.halfExtents;
    const radius = (half && Math.hypot(half.x, half.z)) || (room ? 3.8 : 0.18) / scale;
    splat.setParameter('uStarkOrigin', bounds && half ? [bounds.center.x, bounds.center.y - half.y, bounds.center.z] : [0, 0, 0]);
    splat.setParameter('uStarkRadius', radius);
    splat.setParameter('uStarkHeight', half && half.y > 0 ? 2 * half.y : (room ? 2.6 : 0.18) / scale);
    splat.setParameter('uStarkPointSize', room ? 0.0075 : 0.0018);
    this.writeProgress(splat, progress);
    splat.setWorkBufferModifier(starkModifier);
    splat.workBufferUpdate = pc.WORKBUFFER_UPDATE_ALWAYS;
    return true;
  }

  private writeProgress(splat: pc.GSplatComponent, progress: number): void {
    splat.setParameter('uStarkProgress', pc.math.lerp(progress, progress * progress * (3 - 2 * progress), 0.30));
  }

  update(dt: number): void {
    for (const placement of this.slots.values()) {
      const splat = placement.entity?.gsplat;
      if (!splat || placement.elapsed === undefined || !placement.entity?.enabled || this.outgoing.has(placement)) continue;
      const time = this.reducedMotion.matches ? materializeSeconds : Math.min(materializeSeconds, placement.elapsed + dt);
      this.writeProgress(splat, time / materializeSeconds);
      if (time === materializeSeconds) {
        this.finishEffect(splat);
        placement.elapsed = undefined;
      } else placement.elapsed = time;
    }
    for (const [placement, fade] of this.outgoing) {
      const splat = placement.entity?.gsplat;
      fade.progress -= dt / fade.duration;
      if (!splat || !placement.entity?.enabled || this.reducedMotion.matches || fade.progress <= 0) {
        this.outgoing.delete(placement);
        if (fade.retain) this.hidePlacement(placement);
        else this.disposePlacement(placement);
      } else this.writeProgress(splat, fade.progress);
    }
  }

  private acquire(url: string): Source {
    const existing = this.sources.get(url);
    if (existing) {
      existing.refs++;
      return existing;
    }

    let resolveAsset!: (asset: pc.Asset | null) => void;
    const ready = new Promise<pc.Asset | null>((resolve) => { resolveAsset = resolve; });
    const source: Source = { refs: 1, ready, settle: resolveAsset };
    this.sources.set(url, source);
    this.app.assets.loadFromUrl(url, 'gsplat', (error, asset) => {
      source.asset = asset ?? this.app.assets?.getByUrl(url) ?? undefined;
      if (this.disposed) {
        this.unload(source);
        return;
      }
      if (error || !asset?.resource) {
        this.log(`Could not load splat ${url}: ${String(error ?? 'missing resource')}`, 'warn');
        source.settle(null);
      } else {
        source.settle(asset);
      }
      if (source.refs === 0) this.release(url, source);
    });
    return source;
  }

  clear(slot: Slot, duration = 0): void {
    const placement = this.slots.get(slot);
    if (!placement) return;
    this.slots.delete(slot);
    if (duration > 0 && this.startExit(placement, duration, false)) return;
    this.outgoing.delete(placement);
    this.disposePlacement(placement);
  }

  private startExit(placement: Placement, duration: number, retain: boolean): boolean {
    const activeFade = this.outgoing.get(placement);
    if (activeFade) {
      activeFade.retain = retain;
      return true;
    }
    const progress = placement.scrub?.applied ?? (placement.elapsed ?? materializeSeconds) / materializeSeconds;
    if (progress > 0 && placement.entity?.enabled && this.beginEffect(placement, progress)) {
      this.outgoing.set(placement, { progress, duration, retain });
      return true;
    }
    return false;
  }

  private hidePlacement(placement: Placement): void {
    const entity = placement.entity;
    if (!entity) return;
    entity.enabled = false;
    if (entity.gsplat) this.finishEffect(entity.gsplat);
    placement.elapsed = undefined;
  }

  private finishEffect(splat: pc.GSplatComponent): void {
    splat.setWorkBufferModifier(null);
    splat.workBufferUpdate = pc.WORKBUFFER_UPDATE_AUTO;
  }

  private disposePlacement(placement: Placement): void {
    placement.entity?.destroy();
    placement.source.refs--;
    if (placement.source.refs === 0 && placement.source.asset) this.release(placement.data.url, placement.source);
  }

  private release(url: string, source: Source): void {
    if (this.sources.get(url) !== source) return;
    this.sources.delete(url);
    this.unload(source);
  }

  private unload(source: Source): void {
    if (!source.asset) return;
    source.asset.unload();
    this.app.assets?.remove(source.asset);
    source.asset = undefined;
  }

  get loadedSplats(): number {
    let count = 0;
    for (const placement of this.slots.values()) count += placement.count;
    for (const [placement, { retain }] of this.outgoing) if (!retain) count += placement.count;
    return count;
  }

  label(slot: Slot): string | undefined {
    const placement = this.slots.get(slot);
    return placement?.entity && (placement.data.scale_label || placement.data.provenance_label);
  }

  height(slot: 'dish' | 'compare'): number | undefined {
    const entity = this.slots.get(slot)?.entity;
    const bounds = entity?.gsplat?.resource?.aabb;
    if (entity && bounds) return bounds.halfExtents.y * 2 * entity.getLocalScale().y;
  }

  destroy(): void {
    this.disposed = true;
    for (const slot of this.slots.keys()) this.clear(slot);
    for (const placement of this.outgoing.keys()) this.disposePlacement(placement);
    this.outgoing.clear();
    for (const source of this.sources.values()) source.settle(null);
    this.sources.clear();
  }
}
