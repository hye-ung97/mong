import type { IconName } from '../icons';
import type { SceneEventData } from '../scenes/base';
import type { NoiseKind } from './synth';

export interface LayerDef {
  id: string;
  label: string;
  icon: IconName;
  def: number;
}

/** What a scene sound needs from the engine. */
export interface SoundContext {
  ctx: AudioContext;
  noise: Record<NoiseKind, AudioBuffer>;
  /** page clock (seconds) minus audio clock (seconds) */
  wallOffset(): number;
  /** fetch + decode a recorded sound (cached) */
  load(url: string): Promise<AudioBuffer>;
  /** drop a decoded sound from the cache */
  release(url: string): void;
}

/**
 * One scene's soundscape. Layers are mixable groups (rain, thunder, wind...).
 * Continuous beds start in `start`; random events are scheduled ahead in `schedule`.
 */
export abstract class SceneSound {
  readonly out: GainNode;
  protected readonly ctx: AudioContext;
  private readonly layerNodes = new Map<string, GainNode>();
  private readonly cursors = new Map<string, number>();
  protected readonly sources: AudioScheduledSourceNode[] = [];
  private readonly loaded = new Set<string>();

  constructor(protected readonly env: SoundContext, defs: readonly LayerDef[], mix: Record<string, number> = {}) {
    this.ctx = env.ctx;
    this.out = this.ctx.createGain();
    for (const d of defs) {
      const g = this.ctx.createGain();
      g.gain.value = mix[d.id] ?? d.def;
      g.connect(this.out);
      this.layerNodes.set(d.id, g);
    }
  }

  protected layer(id: string): GainNode {
    const g = this.layerNodes.get(id);
    if (!g) throw new Error(`unknown sound layer ${id}`);
    return g;
  }

  setLayer(id: string, value: number) {
    this.layerNodes.get(id)?.gain.setTargetAtTime(value, this.ctx.currentTime, 0.08);
  }

  /** Load a recording; it is released again when this sound is disposed. */
  protected load(url: string): Promise<AudioBuffer> {
    this.loaded.add(url);
    return this.env.load(url);
  }

  /** Keeps a source to stop when the sound is disposed. */
  protected keep<T extends AudioScheduledSourceNode>(src: T): T {
    this.sources.push(src);
    return src;
  }

  /** Random events at `rate` per second, scheduled up to `until` (audio time). */
  protected poisson(key: string, rate: number, until: number, fire: (t: number) => void) {
    const now = this.ctx.currentTime;
    let t = this.cursors.get(key) ?? now;
    if (t < now) t = now + Math.random() * 0.05;
    if (rate <= 0) {
      this.cursors.set(key, until);
      return;
    }
    while (t < until) {
      fire(t);
      t += -Math.log(1 - Math.random()) / rate;
    }
    this.cursors.set(key, t);
  }

  abstract start(): void;
  /** Schedule anything due before `until` (audio time). Called a few times a second. */
  schedule(_until: number): void {}
  /** Continuous scene values (fire strength, rain strength...). */
  update(_state: Record<string, number>): void {}
  /** One-off scene moments (a log lands, lightning...). */
  event(_name: string, _data?: SceneEventData): void {}

  dispose() {
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    for (const url of this.loaded) this.env.release(url);
    this.out.disconnect();
  }
}
