import * as pc from 'playcanvas';
// @ts-expect-error PlayCanvas ships the SPZ parser script without TypeScript declarations.
import { SpzParser } from 'playcanvas/scripts/esm/parsers/spz-parser.mjs';
import zstdGlueUrl from '../../../server/vendor/playcanvas-zstd/zstd.wasm.js?url&no-inline';
import zstdWasmUrl from '../../../server/vendor/playcanvas-zstd/zstd.wasm.wasm?url';
import type { XRAssetData } from './bridgeTypes';
import type { DebugLog } from './sceneSupport';

type Slot = 'room' | 'dish' | 'compare';

interface Source {
  refs: number;
  asset?: pc.Asset;
  ready: Promise<pc.Asset | null>;
}

interface Placement {
  data: XRAssetData;
  source: Source;
  parent: pc.Entity;
  entity?: pc.Entity;
  count: number;
  ready: Promise<boolean>;
}

const softGaussianBudget = 160_000;
const hardGaussianLimit = 450_000;

export function isSplat(asset: XRAssetData | null | undefined): asset is XRAssetData {
  return !!asset?.url && (asset.format === 'ply' || asset.format === 'sog' || asset.format === 'spz');
}

export class SplatLoader {
  private sources = new Map<string, Source>();
  private slots = new Map<Slot, Placement>();
  private disposed = false;

  constructor(private app: pc.Application, private log: DebugLog) {
    pc.WasmModule.setConfig('ZstdDecoderModule', { glueUrl: zstdGlueUrl, wasmUrl: zstdWasmUrl });
    app.loader.getHandler('gsplat')?.addParser(new SpzParser(app));
  }

  show(slot: Slot, data: XRAssetData | null | undefined, parent: pc.Entity): Promise<boolean> {
    const previous = this.slots.get(slot);
    if (!isSplat(data) || this.disposed) { this.clear(slot); return Promise.resolve(false); }
    if (previous && previous.data.url === data.url && previous.data.scale_factor === data.scale_factor &&
      previous.data.scale_status === data.scale_status && previous.parent === parent) {
      previous.data = data;
      return previous.ready;
    }

    const source = this.acquire(data.url);
    this.clear(slot);
    const placement: Placement = { data, parent, source, count: 0, ready: Promise.resolve(false) };
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
    const resource = asset.resource as pc.GSplatResource;
    const count = resource.numSplats || data.gaussian_count || 0;
    const totalAfter = count + this.loadedSplats;
    if (totalAfter > hardGaussianLimit) {
      this.log(`Gaussian safety limit exceeded while opening ${data.id} (${totalAfter.toLocaleString()} splats)`, 'warn');
      this.clear(slot);
      return false;
    }
    if (totalAfter > softGaussianBudget) {
      this.log(`Combined splats (${totalAfter.toLocaleString()}) exceed ${softGaussianBudget.toLocaleString()} Quest target; relying on PlayCanvas splatBudget LOD`, 'warn');
    }

    const entity = new pc.Entity(data.id, this.app);
    entity.addComponent('gsplat', { asset, unified: true });
    const scale = data.scale_status === 'measured' && Number.isFinite(data.scale_factor) && data.scale_factor > 0
      ? data.scale_factor : 1;
    entity.setLocalScale(scale, scale, scale);
    parent.addChild(entity);
    placement.entity = entity;
    placement.count = count;
    return true;
  }

  private acquire(url: string): Source {
    const existing = this.sources.get(url);
    if (existing) {
      existing.refs++;
      return existing;
    }

    let resolveAsset!: (asset: pc.Asset | null) => void;
    const source: Source = {
      refs: 1,
      ready: new Promise((resolve) => { resolveAsset = resolve; }),
    };
    this.sources.set(url, source);
    this.app.assets.loadFromUrl(url, 'gsplat', (error, asset) => {
      if (this.disposed) { resolveAsset(null); return; }
      source.asset = asset ?? this.app.assets.getByUrl(url) ?? undefined;
      if (error || !asset?.resource) {
        this.log(`Could not load splat ${url}: ${String(error ?? 'missing resource')}`, 'warn');
        resolveAsset(null);
      } else {
        resolveAsset(asset);
      }
      if (source.refs === 0) this.release(url, source);
    });
    return source;
  }

  clear(slot: Slot): void {
    const placement = this.slots.get(slot);
    if (!placement) return;
    this.slots.delete(slot);
    placement.entity?.destroy();
    placement.source.refs--;
    if (placement.source.refs === 0 && placement.source.asset) this.release(placement.data.url, placement.source);
  }

  private release(url: string, source: Source): void {
    if (this.sources.get(url) !== source) return;
    this.sources.delete(url);
    if (source.asset) {
      source.asset.unload();
      this.app.assets.remove(source.asset);
    }
  }

  get loadedSplats(): number {
    let count = 0;
    for (const placement of this.slots.values()) count += placement.count;
    return count;
  }

  label(slot: Slot): string | undefined {
    const placement = this.slots.get(slot);
    return placement?.entity && (placement.data.scale_label || placement.data.provenance_label);
  }

  destroy(): void {
    this.disposed = true;
    for (const slot of this.slots.keys()) this.clear(slot);
    this.sources.clear();
  }
}
