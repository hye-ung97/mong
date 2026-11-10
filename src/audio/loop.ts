/* Endless ambience from one recording: random sections, cross-faded, so it never audibly repeats. */

const CURVE_LEN = 64;
const FADE_IN = new Float32Array(CURVE_LEN);
const FADE_OUT = new Float32Array(CURVE_LEN);
for (let i = 0; i < CURVE_LEN; i++) {
  const k = i / (CURVE_LEN - 1);
  FADE_IN[i] = Math.sin((k * Math.PI) / 2); // equal-power
  FADE_OUT[i] = Math.cos((k * Math.PI) / 2);
}

export interface LoopOptions {
  /** cross-fade length between sections (s) */
  xfade?: number;
  /** section length range (s) */
  min?: number;
  max?: number;
}

export class LoopPlayer {
  private next = 0;
  private first = true;
  private stopped = false;
  private readonly live = new Set<AudioBufferSourceNode>();
  private readonly xfade: number;
  private readonly min: number;
  private readonly max: number;

  constructor(
    private readonly ctx: AudioContext,
    private readonly buffer: AudioBuffer,
    private readonly dest: AudioNode,
    opts: LoopOptions = {},
  ) {
    this.xfade = opts.xfade ?? 3;
    this.min = opts.min ?? 18;
    this.max = opts.max ?? 40;
  }

  start(at = this.ctx.currentTime) {
    this.next = at;
    this.first = true;
  }

  /** Queue sections so that sound is covered until `until` (audio time). */
  schedule(until: number) {
    if (this.stopped) return;
    const { ctx, buffer } = this;
    if (this.next < ctx.currentTime) this.next = ctx.currentTime + 0.02;
    while (this.next < until) {
      const len = Math.min(this.min + Math.random() * (this.max - this.min), buffer.duration - 0.05);
      const offset = Math.random() * Math.max(0, buffer.duration - len);
      const t = this.next;
      const fadeIn = this.first ? 1.5 : this.xfade;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.setValueCurveAtTime(FADE_IN, t, fadeIn);
      g.gain.setValueCurveAtTime(FADE_OUT, t + len - this.xfade, this.xfade);
      src.connect(g).connect(this.dest);
      src.start(t, offset, len);
      src.onended = () => {
        g.disconnect();
        this.live.delete(src);
      };
      this.live.add(src);
      this.next = t + len - this.xfade;
      this.first = false;
    }
  }

  stop() {
    this.stopped = true;
    for (const s of this.live) {
      try {
        s.stop();
      } catch {
        // already ended
      }
    }
    this.live.clear();
  }
}
