import { SceneSound, type LayerDef } from '../sound';
import { blip, burst, filter, gain, loopNoise, rnd } from '../synth';

/*
 * 눈멍 (시계탑 · 발밑) share one soundscape and one mix.
 * There are no snow recordings yet, so everything here is synthesized for now. The plan (Doan board
 * `snow`) is CC0 recordings like the other scenes: single footfalls cut from a walk in fresh snow,
 * a muffled snowy-night ambience, a distant Sapporo streetcar and a struck bell. They would replace
 * `crunch`, the night bed, `tram` and `strike` one by one without changing the layers.
 */

export const SNOW_LAYERS: readonly LayerDef[] = [
  { id: 'steps', label: '뽀드득', icon: 'foot', def: 0.8 },
  { id: 'night', label: '눈 오는 밤', icon: 'wind', def: 0.55 },
  { id: 'tram', label: '먼 전차', icon: 'tram', def: 0.3 },
  { id: 'bell', label: '시계탑 종', icon: 'bell', def: 0.5 },
];

/** The clock tower's bell strikes once every this many minutes (on the wall clock: :00, :10, :20 …). */
export const BELL_EVERY_MIN = 10;
/** A streetcar passes in the distance about this often (seconds, on average). */
const TRAM_EVERY = 75;

/** Seconds until the next whole BELL_EVERY_MIN on the local clock. */
function secondsToNextBell(now = new Date()) {
  const into = (now.getMinutes() % BELL_EVERY_MIN) * 60 + now.getSeconds() + now.getMilliseconds() / 1000;
  const left = BELL_EVERY_MIN * 60 - into;
  return left >= BELL_EVERY_MIN * 60 - 0.05 ? 0 : left;
}

export class SnowSound extends SceneSound {
  private hiss!: GainNode;
  private fall = 0.6;
  private nextBell = -1;

  /** 눈 오는 밤: air that snow has made quiet, a low wind under it, and the faint hiss of flakes landing. */
  start() {
    const c = this.ctx;
    const night = this.layer('night');
    // low wind, slowly swelling and easing
    const wind = gain(c, 0.34);
    const swell = c.createOscillator();
    swell.frequency.value = 0.045;
    const depth = gain(c, 0.14);
    swell.connect(depth).connect(wind.gain);
    this.keep(swell).start();
    this.keep(loopNoise(c, this.env.noise.brown, wind));
    wind.connect(filter(c, 'lowpass', 420, 0.6)).connect(night);
    // flakes landing: very quiet, a little louder the harder it snows
    this.hiss = gain(c, this.hissFor(this.fall));
    this.keep(loopNoise(c, this.env.noise.pink, this.hiss));
    this.hiss.connect(filter(c, 'bandpass', 5200, 0.4)).connect(night);
  }

  private hissFor(fall: number) {
    return 0.012 + 0.03 * fall;
  }

  update(state: Record<string, number>) {
    const f = state.fall ?? this.fall;
    if (f === this.fall) return;
    this.fall = f;
    this.hiss.gain.setTargetAtTime(this.hissFor(f), this.ctx.currentTime, 1.5);
  }

  schedule(until: number) {
    const now = this.ctx.currentTime;
    if (this.nextBell < 0) this.nextBell = now + secondsToNextBell();
    while (this.nextBell <= until) {
      if (this.nextBell >= now - 0.05) this.strike(Math.max(now, this.nextBell));
      this.nextBell += BELL_EVERY_MIN * 60;
    }
    this.poisson('tram', 1 / TRAM_EVERY, until, (t) => this.tram(t));
  }

  event(name: string, data?: Record<string, number | string>) {
    const x = typeof data?.x === 'number' ? data.x : 0.5;
    const pan = (x - 0.5) * 1.3;
    if (name === 'step') this.crunch(pan);
    else if (name === 'sweep') this.swish(pan);
    else if (name === 'fresh') {
      // new snow settling over everything: a soft breath
      burst(this.ctx, this.layer('night'), this.ctx.currentTime + 0.02, this.env.noise.pink, { dur: 1.1, gain: 0.12, type: 'lowpass', freq: 1400, attack: 0.35 });
    }
  }

  /**
   * 뽀드득: snow grains catch and slip again and again under the boot. Short ticks that speed up and
   * slow down over a third of a second, with the soft thud of the foot under them.
   */
  private crunch(pan: number) {
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    const sr = c.sampleRate;
    const n = Math.floor(sr * rnd(0.3, 0.4));
    const buf = c.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const f0 = rnd(46, 60);
    const f1 = rnd(96, 126);
    const decay = Math.exp(-1 / (sr * 0.0034));
    let next = 0;
    let g = 0;
    for (let i = 0; i < n; i++) {
      const k = i / n;
      if (i >= next) {
        g = rnd(0.55, 1);
        const f = f0 + (f1 - f0) * Math.sin(Math.PI * Math.min(1, k * 1.15));
        next = i + (sr / f) * rnd(0.72, 1.28);
      }
      g *= decay;
      const hump = Math.sin(Math.PI * k * 2 - 0.5);
      const env = Math.min(1, k / 0.04) * Math.pow(1 - k, 1.3) * (0.65 + 0.35 * hump * hump);
      d[i] = (Math.random() * 2 - 1) * (g * 0.9 + 0.07) * env;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rnd(0.92, 1.08);
    const peak = filter(c, 'peaking', rnd(1500, 2100), 1.1);
    peak.gain.value = 9;
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const out = gain(c, 0.7);
    src.connect(filter(c, 'highpass', 420)).connect(peak).connect(filter(c, 'lowpass', 6200)).connect(out).connect(p).connect(this.layer('steps'));
    src.start(t);
    src.onended = () => p.disconnect();
    blip(c, this.layer('steps'), t, { f0: 96, f1: 48, dur: 0.1, gain: 0.22, sweep: 0.08, pan });
  }

  /** 사락: snow pushed aside by a sweep. */
  private swish(pan: number) {
    burst(this.ctx, this.layer('steps'), this.ctx.currentTime + 0.01, this.env.noise.white, {
      dur: 0.24, gain: 0.16, type: 'bandpass', freq: rnd(2600, 3600), q: 0.7, attack: 0.08, pan,
    });
  }

  /** 먼 전차: a streetcar rumbling past a few blocks away, left to right or back, with its bell. */
  private tram(t: number) {
    const c = this.ctx;
    const dur = rnd(8, 11);
    const dir = Math.random() < 0.5 ? -1 : 1;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner();
    p.pan.setValueAtTime(-0.7 * dir, t);
    p.pan.linearRampToValueAtTime(0.7 * dir, t + dur);
    const src = c.createBufferSource();
    src.buffer = this.env.noise.brown;
    src.loop = true;
    src.connect(filter(c, 'bandpass', rnd(140, 190), 0.9)).connect(g).connect(p).connect(this.layer('tram'));
    src.start(t, Math.random() * this.env.noise.brown.duration);
    src.stop(t + dur + 0.1);
    src.onended = () => p.disconnect();
    // its bell, twice, softened by the distance
    const far = filter(c, 'lowpass', 2400);
    far.connect(this.layer('tram'));
    const at = t + dur * rnd(0.3, 0.5);
    const bellPan = -0.2 * dir;
    for (const dt of [0, 0.22]) blip(c, far, at + dt, { f0: 1480, f1: 1460, dur: 0.5, gain: 0.05, pan: bellPan });
    window.setTimeout(() => far.disconnect(), (at - c.currentTime + 2) * 1000);
  }

  /** 시계탑 종: one stroke of a bronze bell across the street. Inharmonic partials, the high ones die first. */
  private strike(t: number) {
    const c = this.ctx;
    const base = 233;
    const out = gain(c, 0.16);
    out.connect(filter(c, 'lowpass', 2600)).connect(this.layer('bell'));
    const partials: [number, number, number][] = [
      [0.5, 0.45, 9], [1, 1, 7], [1.183, 0.6, 5], [1.506, 0.35, 4], [2, 0.4, 3.5], [2.514, 0.2, 2.5], [2.662, 0.15, 2], [3.011, 0.1, 1.6],
    ];
    for (const [ratio, amp, decay] of partials) {
      const o = c.createOscillator();
      o.frequency.value = base * ratio * rnd(0.998, 1.002);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.1);
      o.onended = () => g.disconnect();
    }
    burst(c, out, t, this.env.noise.white, { dur: 0.03, gain: 0.25, type: 'bandpass', freq: 1800, q: 1.2 });
    window.setTimeout(() => out.disconnect(), (t - c.currentTime + 10) * 1000);
  }
}
