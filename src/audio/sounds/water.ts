import { findHits, type Hit } from '../assets';
import { LoopPlayer } from '../loop';
import { SceneSound, type LayerDef } from '../sound';
import { blip, burst, gain, rnd } from '../synth';

/*
 * Recordings (all CC0, Freesound — see public/sounds/CREDITS.md), mono, chosen on a listening page:
 *   aquarium.m4a  7778 "Indoor Nice Fish Tank Ambiance" (#197805)
 *   sea.m4a       jedg "Beach atmos gentle waves" (#505812), recorded at night
 *   pond.m4a      Garuda1982 "Village pond with bird sounds and natural background" (#759738)
 *   steps.m4a     bruno.auzet "footsteps in wet coarse sand" (#539175)
 * The short moments on top (food, a knock on the glass, ripples, a koi feeding) are still synthesized.
 */
const BASE = `${import.meta.env.BASE_URL}sounds/water/`;
const SPREAD = 0.55; // pan of the two copies that turn a mono recording into wide stereo
const COPY_GAIN = 0.7;

/** A scene sound whose bed is one recording, looped without an audible seam and spread into stereo. */
abstract class RecordedSound extends SceneSound {
  protected disposed = false;
  private readonly loops: LoopPlayer[] = [];

  protected async bed(file: string, dest: AudioNode, opts: { xfade: number; min: number; max: number }) {
    try {
      const buf = await this.load(`${BASE}${file}`);
      if (this.disposed) return;
      const c = this.ctx;
      const now = c.currentTime;
      for (const pan of [-SPREAD, SPREAD]) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        p.connect(gain(c, COPY_GAIN)).connect(dest);
        const loop = new LoopPlayer(c, buf, p, opts);
        loop.start(now + 0.05);
        loop.schedule(now + 2);
        this.loops.push(loop);
      }
    } catch (e) {
      console.warn('[mong] water sound failed to load', file, e);
    }
  }

  schedule(until: number) {
    for (const loop of this.loops) loop.schedule(until);
  }

  dispose() {
    this.disposed = true;
    for (const loop of this.loops) loop.stop();
    super.dispose();
  }
}

/* ---------- 어항 ---------- */

export const AQUARIUM_LAYERS: readonly LayerDef[] = [
  { id: 'filter', label: '어항 물소리', icon: 'waves', def: 0.8 },
  { id: 'bubbles', label: '먹이 · 톡톡', icon: 'drop', def: 0.7 },
];

/** Fish tank: a recording of a tank in a quiet room; a plop when you feed, a tock when you knock on the glass. */
export class AquariumSound extends RecordedSound {
  start() {
    void this.bed('aquarium.m4a', this.layer('filter'), { xfade: 2.5, min: 12, max: 24 });
  }

  event(name: string, data?: Record<string, number | string>) {
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const pan = typeof data?.x === 'number' ? data.x * 1.4 - 0.7 : 0;
    if (name === 'feed') {
      blip(c, this.layer('bubbles'), t, { f0: 560, f1: 240, dur: 0.14, gain: 0.3, pan });
      burst(c, this.layer('bubbles'), t, this.env.noise.white, { dur: 0.05, gain: 0.08, type: 'highpass', freq: 2500, pan });
    } else if (name === 'eat') {
      blip(c, this.layer('bubbles'), t, { f0: 900, f1: 1400, dur: 0.03, gain: 0.05, pan: rnd(-0.4, 0.4) });
    } else if (name === 'knock') {
      // a fingertip on the glass: a short dull tock, twice
      for (const dt of [0, 0.11]) {
        blip(c, this.layer('bubbles'), t + dt, { f0: 620, f1: 380, dur: 0.05, gain: dt ? 0.12 : 0.18, type: 'triangle', pan });
        burst(c, this.layer('bubbles'), t + dt, this.env.noise.white, { dur: 0.012, gain: 0.05, type: 'bandpass', freq: 1800, q: 2, pan });
      }
    }
  }
}

/* ---------- 바다 ---------- */

export const SEA_LAYERS: readonly LayerDef[] = [
  { id: 'waves', label: '파도', icon: 'waves', def: 0.85 },
  { id: 'steps', label: '발자국', icon: 'foot', def: 0.9 },
];

const STEP_GAIN = 1.6;

/** Sea: a quiet beach recorded at night. Bigger waves play it louder; footsteps come from a recording of wet sand. */
export class SeaSound extends RecordedSound {
  private size = 1;
  private level!: GainNode;
  private steps: AudioBuffer | null = null;
  private hits: Hit[] = [];
  private stepRef = 0.3;
  private lastHit = -1;

  private levelFor(size: number) {
    return 0.55 + 0.45 * size; // 잔잔 0.82 · 보통 1 · 높음 1.23
  }

  start() {
    this.level = gain(this.ctx, this.levelFor(this.size));
    this.level.connect(this.layer('waves'));
    void this.bed('sea.m4a', this.level, { xfade: 4, min: 25, max: 50 });
    this.load(`${BASE}steps.m4a`)
      .then((b) => {
        if (this.disposed) return;
        this.steps = b;
        // single footfalls: clear ones only, and not the long splashes at the end of the recording
        this.hits = findHits(b, { minGap: 0.4, threshold: 0.25, maxDur: 0.55 }).filter((h) => h.dur > 0.12);
        const peaks = this.hits.map((h) => h.peak).sort((x, y) => x - y);
        this.stepRef = peaks[Math.floor(peaks.length / 2)] ?? 0.3;
      })
      .catch((e) => console.warn('[mong] footstep sound failed to load', e));
  }

  update(state: Record<string, number>) {
    const next = state.size ?? this.size;
    if (next === this.size) return;
    this.size = next;
    this.level.gain.setTargetAtTime(this.levelFor(next), this.ctx.currentTime, 1.2);
  }

  /** 사박: one recorded footfall, never the same one twice in a row, a touch different in pitch each time. */
  private footstep(x: number, wet: boolean) {
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const pan = x * 1.2 - 0.6;
    if (!this.steps || !this.hits.length) { // until the recording has loaded
      burst(c, this.layer('steps'), t, this.env.noise.white, { dur: 0.1, gain: 0.25, type: 'bandpass', freq: 2400, q: 0.7, attack: 0.012, pan });
      return;
    }
    let i = Math.floor(Math.random() * this.hits.length);
    if (i === this.lastHit) i = (i + 1) % this.hits.length;
    this.lastHit = i;
    const h = this.hits[i];
    const src = c.createBufferSource();
    src.buffer = this.steps;
    src.playbackRate.value = (wet ? 0.92 : 1.04) * rnd(0.95, 1.05);
    const level = STEP_GAIN * Math.min(2.5, this.stepRef / Math.max(0.02, h.peak));
    const g = c.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.setValueAtTime(level, t + Math.max(0, h.dur - 0.08));
    g.gain.linearRampToValueAtTime(0.0001, t + h.dur);
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(this.layer('steps'));
    src.start(t, h.start, h.dur + 0.05);
    src.onended = () => p.disconnect();
  }

  event(name: string, data?: Record<string, number | string>) {
    if (name === 'step') {
      this.footstep(typeof data?.x === 'number' ? data.x : 0.5, data?.wet === 1);
      return;
    }
    if (name !== 'splash') return;
    const t = this.ctx.currentTime + 0.01;
    blip(this.ctx, this.out, t, { f0: 420, f1: 190, dur: 0.12, gain: 0.18 });
    burst(this.ctx, this.out, t, this.env.noise.white, { dur: 0.08, gain: 0.06, type: 'highpass', freq: 2000 });
  }
}

/* ---------- 연못 ---------- */

export const POND_LAYERS: readonly LayerDef[] = [
  { id: 'pond', label: '연못 · 새소리', icon: 'bird', def: 0.8 },
  { id: 'drops', label: '물방울', icon: 'drop', def: 0.7 },
];

/** Pond: a village pond with birdsong, recorded; a plink for every ripple on top. */
export class PondSound extends RecordedSound {
  start() {
    void this.bed('pond.m4a', this.layer('pond'), { xfade: 4, min: 25, max: 55 });
  }

  event(name: string, data?: Record<string, number | string>) {
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    if (name === 'feed') { // a pinch of pellets pattering onto the water
      for (let i = 0; i < 6; i++) {
        const f = rnd(700, 1300);
        blip(c, this.layer('drops'), t + i * rnd(0.02, 0.05), { f0: f, f1: f * 1.6, sweep: 0.02, dur: 0.05, gain: 0.05, pan: rnd(-0.3, 0.3) });
      }
      return;
    }
    if (name === 'eat') { // a koi's mouth breaking the surface
      blip(c, this.layer('drops'), t, { f0: 300, f1: 520, dur: 0.06, gain: 0.07, pan: typeof data?.x === 'number' ? data.x * 1.4 - 0.7 : 0 });
      return;
    }
    if (name !== 'ripple') return;
    const power = typeof data?.power === 'number' ? data.power : 1;
    const pan = typeof data?.x === 'number' ? data.x * 1.4 - 0.7 : 0;
    const f = rnd(600, 1100);
    blip(c, this.layer('drops'), t, { f0: f, f1: f * rnd(1.5, 2.2), sweep: 0.025, dur: 0.09, gain: 0.12 * power, pan });
    burst(c, this.layer('drops'), t, this.env.noise.white, { dur: 0.015, gain: 0.03 * power, type: 'highpass', freq: 3000, pan });
  }
}
