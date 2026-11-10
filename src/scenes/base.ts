import { prefersReducedMotion } from './util';

/** `full` fills the screen; `card` is a small live preview on the home screen. */
export type SceneVariant = 'full' | 'card';

export type SceneEventData = Record<string, number | string>;

export interface SceneHooks {
  /** Continuous values the UI shows (fire strength, log count, ...). */
  onStat?: (key: string, value: number) => void;
  /** One-off moments the sound follows (a log lands, lightning, a ripple, ...). */
  onEvent?: (name: string, data?: SceneEventData) => void;
}

export abstract class Scene {
  t = 0;
  w = 0;
  h = 0;
  dpr = 1;
  s = 1;
  warmed = false;
  hooks: SceneHooks = {};
  /** 1 normally, 0.5 when the visitor asked for reduced motion. */
  readonly motion = prefersReducedMotion() ? 0.5 : 1;

  constructor(readonly variant: SceneVariant) {}

  resize(w: number, h: number, dpr: number) {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.layout();
  }

  abstract layout(): void;
  abstract step(dt: number): void;
  abstract draw(ctx: CanvasRenderingContext2D): void;

  /** A tap or click on the scene, in CSS pixels. */
  tap(_x: number, _y: number): void {}

  /** Values the sound follows continuously. */
  audioState(): Record<string, number> {
    return {};
  }

  protected emit(name: string, data?: SceneEventData) {
    this.hooks.onEvent?.(name, data);
  }

  protected stat(key: string, value: number) {
    this.hooks.onStat?.(key, value);
  }
}
