import { WAVE_PERIOD } from '../../scenes/sea';
import { SceneSound, type LayerDef } from '../sound';
import { blip, burst, chain, filter, gain, loopNoise, rnd } from '../synth';

/* ---------- 어항 ---------- */

export const AQUARIUM_LAYERS: readonly LayerDef[] = [
  { id: 'filter', label: '여과기 물소리', icon: 'waves', def: 0.6 },
  { id: 'bubbles', label: '보글보글', icon: 'drop', def: 0.7 },
];

/** Fish tank: the filter's steady water noise, a trickle, a stream of bubbles; a plop when you feed. */
export class AquariumSound extends SceneSound {
  private trickle!: GainNode;

  start() {
    const c = this.ctx;
    this.keep(loopNoise(c, this.env.noise.pink, chain(filter(c, 'bandpass', 900, 0.5), gain(c, 0.14), this.layer('filter'))));
    this.keep(loopNoise(c, this.env.noise.brown, chain(filter(c, 'lowpass', 160, 0.7), gain(c, 0.1), this.layer('filter'))));
    this.trickle = gain(c, 0.02);
    this.keep(loopNoise(c, this.env.noise.white, chain(filter(c, 'bandpass', 2800, 1.2), this.trickle, this.layer('filter'))));
  }

  schedule(until: number) {
    const c = this.ctx;
    this.poisson('trickle', 6, until, (t) => this.trickle.gain.setTargetAtTime(rnd(0.008, 0.05), t, 0.06));
    this.poisson('bubble', 5, until, (t) => {
      const n = Math.random() < 0.25 ? 3 : 1;
      for (let i = 0; i < n; i++) {
        const f = rnd(260, 640);
        const dur = rnd(0.03, 0.07);
        blip(c, this.layer('bubbles'), t + i * rnd(0.03, 0.07), { f0: f, f1: f * rnd(1.8, 2.6), sweep: dur * 0.8, dur, gain: rnd(0.03, 0.1), pan: rnd(0.3, 0.7) });
      }
    });
  }

  event(name: string, data?: Record<string, number | string>) {
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const pan = typeof data?.x === 'number' ? data.x * 1.4 - 0.7 : 0;
    if (name === 'feed') {
      blip(c, this.out, t, { f0: 560, f1: 240, dur: 0.14, gain: 0.3, pan });
      burst(c, this.out, t, this.env.noise.white, { dur: 0.05, gain: 0.08, type: 'highpass', freq: 2500, pan });
    } else if (name === 'eat') {
      blip(c, this.layer('bubbles'), t, { f0: 900, f1: 1400, dur: 0.03, gain: 0.05, pan: rnd(-0.4, 0.4) });
    }
  }
}

/* ---------- 바다 ---------- */

export const SEA_LAYERS: readonly LayerDef[] = [
  { id: 'waves', label: '파도', icon: 'waves', def: 0.8 },
  { id: 'wind', label: '바람', icon: 'wind', def: 0.25 },
];

/** Sea: each wave swells, breaks and fizzes back — on the same clock the picture uses. */
export class SeaSound extends SceneSound {
  private size = 1;
  private surfGain!: GainNode;
  private surfLp!: BiquadFilterNode;
  private washGain!: GainNode;
  private windBp!: BiquadFilterNode;
  private windGain!: GainNode;
  private scheduledCycle = -Infinity;

  start() {
    const c = this.ctx;
    this.keep(loopNoise(c, this.env.noise.brown, chain(filter(c, 'lowpass', 260, 0.5), gain(c, 0.14), this.layer('waves'))));
    this.surfLp = filter(c, 'lowpass', 500, 0.5);
    this.surfGain = gain(c, 0.12);
    this.keep(loopNoise(c, this.env.noise.brown, chain(this.surfLp, this.surfGain, this.layer('waves'))));
    this.washGain = gain(c, 0.01);
    this.keep(loopNoise(c, this.env.noise.pink, chain(filter(c, 'highpass', 700, 0.5), filter(c, 'lowpass', 5000, 0.5), this.washGain, this.layer('waves'))));
    this.windBp = filter(c, 'bandpass', 380, 0.8);
    this.windGain = gain(c, 0.15);
    this.keep(loopNoise(c, this.env.noise.brown, chain(this.windBp, this.windGain, this.layer('wind'))));
  }

  update(state: Record<string, number>) {
    this.size = state.size ?? this.size;
  }

  schedule(until: number) {
    const offset = this.env.wallOffset();
    const now = this.ctx.currentTime;
    // cycle k starts at page time k*T, i.e. audio time k*T - offset
    let k = Math.ceil((now + offset) / WAVE_PERIOD);
    if (k <= this.scheduledCycle) k = this.scheduledCycle + 1;
    for (; k * WAVE_PERIOD - offset < until + 2; k++) {
      this.wave(k * WAVE_PERIOD - offset);
      this.scheduledCycle = k;
    }
    this.poisson('gust', 0.3, until, (t) => {
      this.windBp.frequency.setTargetAtTime(rnd(250, 600), t, 1.8);
      this.windGain.gain.setTargetAtTime(rnd(0.05, 0.28), t, 2.2);
    });
  }

  /** One wave: swell → break at 12% → long fizzy retreat. Matches the scene's swash. */
  private wave(ts: number) {
    const T = WAVE_PERIOD;
    const A = this.size;
    const peak = 0.55 * Math.pow(A, 0.7);
    const floor = 0.12;
    const brk = ts + 0.12 * T;
    this.surfGain.gain.setValueAtTime(floor, ts);
    this.surfGain.gain.linearRampToValueAtTime(peak, brk);
    this.surfGain.gain.setTargetAtTime(floor, brk, 1.6);
    this.surfLp.frequency.setValueAtTime(500, ts);
    this.surfLp.frequency.linearRampToValueAtTime(1800 + 800 * A, brk);
    this.surfLp.frequency.setTargetAtTime(500, brk, 2);
    this.washGain.gain.setValueAtTime(0.01, ts + 0.2 * T);
    this.washGain.gain.linearRampToValueAtTime(0.12 * A, ts + 0.38 * T);
    this.washGain.gain.setTargetAtTime(0.01, ts + 0.45 * T, 1.5);
  }

  event(name: string) {
    if (name !== 'splash') return;
    const t = this.ctx.currentTime + 0.01;
    blip(this.ctx, this.out, t, { f0: 420, f1: 190, dur: 0.12, gain: 0.18 });
    burst(this.ctx, this.out, t, this.env.noise.white, { dur: 0.08, gain: 0.06, type: 'highpass', freq: 2000 });
  }
}

/* ---------- 연못 ---------- */

export const POND_LAYERS: readonly LayerDef[] = [
  { id: 'drops', label: '물방울', icon: 'drop', def: 0.7 },
  { id: 'wind', label: '바람', icon: 'wind', def: 0.3 },
  { id: 'birds', label: '새소리', icon: 'bird', def: 0.2 },
];

/** Pond: a plink for every ripple, wind in the leaves, a bird now and then. */
export class PondSound extends SceneSound {
  private windGain!: GainNode;
  private leaves!: GainNode;

  start() {
    const c = this.ctx;
    this.windGain = gain(c, 0.12);
    this.keep(loopNoise(c, this.env.noise.pink, chain(filter(c, 'lowpass', 900, 0.5), this.windGain, this.layer('wind'))));
    this.leaves = gain(c, 0.01);
    this.keep(loopNoise(c, this.env.noise.white, chain(filter(c, 'highpass', 2500, 0.5), this.leaves, this.layer('wind'))));
  }

  schedule(until: number) {
    this.poisson('gust', 0.35, until, (t) => {
      this.windGain.gain.setTargetAtTime(rnd(0.05, 0.22), t, 2);
      this.leaves.gain.setTargetAtTime(rnd(0.002, 0.03), t, 1.2);
    });
    this.poisson('bird', 0.08, until, (t) => this.bird(t));
  }

  private bird(t: number) {
    const notes = 2 + Math.floor(Math.random() * 4);
    const pan = rnd(-0.8, 0.8);
    const base = rnd(2600, 3400);
    for (let i = 0; i < notes; i++) {
      blip(this.ctx, this.layer('birds'), t + i * rnd(0.1, 0.16), { f0: base * rnd(0.95, 1.05), f1: base * rnd(1.3, 1.6), dur: rnd(0.06, 0.12), gain: 0.05, attack: 0.01, pan });
    }
  }

  event(name: string, data?: Record<string, number | string>) {
    if (name !== 'ripple') return;
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const power = typeof data?.power === 'number' ? data.power : 1;
    const pan = typeof data?.x === 'number' ? data.x * 1.4 - 0.7 : 0;
    const f = rnd(600, 1100);
    blip(c, this.layer('drops'), t, { f0: f, f1: f * rnd(1.5, 2.2), sweep: 0.025, dur: 0.09, gain: 0.12 * power, pan });
    burst(c, this.layer('drops'), t, this.env.noise.white, { dur: 0.015, gain: 0.03 * power, type: 'highpass', freq: 3000, pan });
  }
}
