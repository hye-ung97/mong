import type { SceneEventData } from '../../scenes/base';
import { LoopPlayer } from '../loop';
import { SceneSound, type LayerDef } from '../sound';
import { filter, gain } from '../synth';

/*
 * 모래멍 · 모래시계. Recordings (all CC0, Freesound — see public/sounds/CREDITS.md), mono, chosen on the listening board
 * .doan/canvases/sand-sound.html:
 *   stream.m4a  davahey "pouring sugar" (#98794): three steady stretches between the pours (11.6–19.8, 24–32, 3–8.4 s),
 *               cross-faded into 20.4 s, evened out, -27 dBFS RMS. The trickle through the neck.
 *   slide.m4a   martinimeniscus "sand slide on glass" (#199395): three slides laid end to end (SLIDES below), -30 dBFS RMS.
 *   flip.m4a    el_boss "Turning a Small Hour Glass" (#625655, the turn, 0–2.4 s) with ekfink "glass jar_set on table_2"
 *               (#235498, softened) landing at 1.6 s, where the flip animation (1.8 s) sets the glass down. 2.9 s.
 *
 * stream.m4a follows the grains per second the scene actually lets through (`flow` in audioState), so a 30분 run is a
 * thin, quiet trickle and 끝없이 a fuller one; it stops when the top is empty.
 *
 * Hooks — the scene's events land here (Sand emits them, SceneSound.event dispatches):
 *   onAvalanche(size)  a slope in the lower bulb slid; size = cells slid in a quarter second beyond the usual creep (12 and up)
 *   onFlip()           the hourglass is turned over (button, Space, or by itself)
 *   onDone()           a 15분 · 30분 run has run out (no sound of its own; the trickle fades with `flow`)
 */
const BASE = `${import.meta.env.BASE_URL}sounds/sand/`;
const SPREAD = 0.5; // pan of the two copies that turn a mono recording into wide stereo
const COPY_GAIN = 0.7;
const TRICKLE_GAIN = 0.6;
/** Grains per second through the neck that sound "full": 끝없이 runs at about this rate. */
const FULL_FLOW = 170;
/** Slides sit 6–10 dB under the trickle. */
const SLIDE_GAIN = 0.32;
/** No two slides closer than this (s), so a burst of small avalanches stays one hush. */
const SLIDE_GAP = 0.7;
const FLIP_GAIN = 0.9;

/** The slides inside slide.m4a: start and length (s). */
const SLIDES: readonly (readonly [number, number])[] = [
  [0, 1.6],
  [1.85, 1.5],
  [3.6, 2.6],
];

export const SAND_LAYERS: readonly LayerDef[] = [
  { id: 'sand', label: '모래 소리', icon: 'sand', def: 0.8 },
];

export class SandSound extends SceneSound {
  private trickle: GainNode | null = null;
  private tone: BiquadFilterNode | null = null;
  private readonly loops: LoopPlayer[] = [];
  private slide: AudioBuffer | null = null;
  private flip: AudioBuffer | null = null;
  private lastSlide = -1;
  private slideAt = -Infinity;
  private disposed = false;

  start() {
    const c = this.ctx;
    this.trickle = gain(c, 0);
    this.tone = filter(c, 'lowpass', 6000, 0.5);
    this.tone.connect(this.trickle).connect(this.layer('sand'));
    void this.loadAll();
  }

  private async loadAll() {
    try {
      const stream = await this.load(`${BASE}stream.m4a`);
      if (this.disposed || !this.tone) return;
      const c = this.ctx;
      const now = c.currentTime;
      for (const pan of [-SPREAD, SPREAD]) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        p.connect(gain(c, COPY_GAIN)).connect(this.tone);
        const loop = new LoopPlayer(c, stream, p, { xfade: 1.2, min: 5, max: 9 });
        loop.start(now + 0.05);
        loop.schedule(now + 2);
        this.loops.push(loop);
      }
    } catch (e) {
      console.warn('[mong] sand sound failed to load', 'stream.m4a', e);
    }
    // the one-shots load after the bed; until then their moments are simply quiet
    for (const [name, set] of [
      ['slide.m4a', (b: AudioBuffer) => (this.slide = b)],
      ['flip.m4a', (b: AudioBuffer) => (this.flip = b)],
    ] as const) {
      this.load(`${BASE}${name}`)
        .then((b) => {
          if (!this.disposed) set(b);
        })
        .catch((e) => console.warn('[mong] sand sound failed to load', name, e));
    }
  }

  schedule(until: number) {
    for (const loop of this.loops) loop.schedule(until);
  }

  /** `flow`: grains per second through the neck. `running`: sand is falling. */
  update(state: Record<string, number>) {
    const t = this.ctx.currentTime;
    const flow = state.running ? state.flow ?? 0 : 0;
    // a thin stream is quieter and duller, but never so quiet it vanishes
    const k = flow > 0 ? Math.min(1.15, Math.sqrt(flow / FULL_FLOW)) : 0;
    this.trickle?.gain.setTargetAtTime(k > 0 ? TRICKLE_GAIN * (0.4 + 0.6 * k) : 0, t, k > 0 ? 0.3 : 0.6);
    this.tone?.frequency.setTargetAtTime(3500 + 6000 * k, t, 0.5);
  }

  event(name: string, data?: SceneEventData) {
    if (name === 'avalanche') this.onAvalanche(Number(data?.size ?? 0));
    else if (name === 'flip') this.onFlip();
    else if (name === 'done') this.onDone();
  }

  /** A slope slid in the lower bulb: one recorded slide, a different one each time, louder for bigger slides. */
  onAvalanche(size: number) {
    const b = this.slide;
    const t = this.ctx.currentTime;
    if (!b || t - this.slideAt < SLIDE_GAP) return;
    this.slideAt = t;
    let i = Math.floor(Math.random() * SLIDES.length);
    if (i === this.lastSlide) i = (i + 1) % SLIDES.length;
    this.lastSlide = i;
    const [at, len] = SLIDES[i];
    const k = Math.min(1, Math.max(0, size) / 60);
    const rate = 0.9 + Math.random() * 0.2;
    this.play(b, at, len, SLIDE_GAIN * (0.45 + 0.55 * k), (Math.random() - 0.5) * 0.5, rate);
  }

  /** Turned over: the glass turns in the hand and is set down on the table. */
  onFlip() {
    if (this.flip) this.play(this.flip, 0, this.flip.duration, FLIP_GAIN, 0.1, 1);
  }

  /** The run is over; the trickle already fades with `flow`. */
  onDone() {}

  private play(b: AudioBuffer, at: number, len: number, level: number, pan: number, rate: number) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = b;
    src.playbackRate.value = rate;
    const p = c.createStereoPanner();
    p.pan.value = pan;
    const g = gain(c, level);
    src.connect(p).connect(g).connect(this.layer('sand'));
    src.onended = () => g.disconnect();
    src.start(c.currentTime + 0.01, at, len);
  }

  dispose() {
    this.disposed = true;
    for (const loop of this.loops) loop.stop();
    super.dispose();
  }
}
