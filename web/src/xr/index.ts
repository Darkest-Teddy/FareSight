import type { FareSightSceneEngine, XRSceneCallbacks } from './bridgeTypes';
import { PlayCanvasApp } from './PlayCanvasApp';

export type * from './bridgeTypes';

export function createFareSightEngine(canvas: HTMLCanvasElement, callbacks: XRSceneCallbacks): FareSightSceneEngine {
  return new PlayCanvasApp(canvas, callbacks);
}
