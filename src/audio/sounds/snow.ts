import { SceneSound, type LayerDef } from '../sound';
import { blip, burst, filter, gain, loopNoise, rnd } from '../synth';

/*
 * 눈멍 (시계탑 · 발밑) share one soundscape and one mix.
 * Recordings (all CC0, Freesound — see public/sounds/CREDITS.md), mono, chosen on a listening page:
 *   steps.m4a   billox30 "Close-micd Snow Steps" (#175002), 20 single footfalls laid end to end
 *   deep.m4a    msimmonsvoice "Footsteps in snow, various speeds" (#719624), 16 single footfalls in snow
 *               30 cm deep, laid end to end: the boot sinking into a snow pile
 *   sweep.m4a   Vrymaa "Broom - Sweep, outdoor" (#734668), four strokes
 *   tram.m4a    AmazingRolo "tram bell" (#448366), the bell and the streetcar pulling away
 *   bell.m4a    MVMTech "Church Bell" (#569356), one stroke
 * 눈 오는 밤 stays synthesized (the listening page's choice). Until a recording has loaded, or if it
 * fails to, the synthesized sound it replaced plays instead.
 */

const BASE = `${import.meta.env.BASE_URL}sounds/snow/`;

/** The footfalls inside steps.m4a: where each starts and how long it lasts (seconds). */
const STEPS: readonly (readonly [number, number])[] = [
  [0, 0.89], [1.14, 0.71], [2.1, 1.17], [3.52, 0.76], [4.53, 0.81], [5.59, 0.9], [6.74, 0.75], [7.74, 1.16], [9.15, 1.02], [10.42, 0.93],
  [11.6, 0.89], [12.74, 0.92], [13.91, 0.75], [14.91, 1.08], [16.24, 0.89], [17.38, 0.91], [18.54, 0.76], [19.55, 0.87], [20.67, 0.86], [21.78, 0.99],
];
const STEP_GAIN = 0.55;
/** The footfalls inside deep.m4a, heard when the boot sinks into a snow pile. */
const DEEP_STEPS: readonly (readonly [number, number])[] = [
  [0, 0.84], [1.09, 1.19], [2.53, 0.89], [3.67, 0.89], [4.81, 0.84], [5.9, 0.77], [6.92, 0.85], [8.02, 0.78],
  [9.05, 0.81], [10.11, 1.04], [11.4, 0.99], [12.64, 0.94], [13.83, 0.79], [14.87, 0.77], [15.89, 0.82], [16.96, 0.74],
];
const DEEP_GAIN = 0.6;
/** sweep.m4a: where each stroke starts, and the stretch that repeats while the broom keeps going. */
const SWEEP_STROKES = [0.06, 1.08, 1.92, 2.88] as const;
const SWEEP_LOOP = [0.9, 3.7] as const;
const SWEEP_GAIN = 0.45;
/** The broom is heard this long after the last sweep (the scene reports one every 0.17 s while dragging). */
const SWEEP_HOLD = 0.3;
const TRAM_GAIN = 0.8;
const BELL_GAIN = 0.4;

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
  private disposed = false;
  private rec: { steps?: AudioBuffer; deep?: AudioBuffer; sweep?: AudioBuffer; tram?: AudioBuffer; bell?: AudioBuffer } = {};
  private lastStep = -1;
  private lastDeep = -1;
  private broom: { src: AudioBufferSourceNode; g: GainNode; p: StereoPannerNode } | null = null;

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
    for (const id of ['steps', 'deep', 'sweep', 'tram', 'bell'] as const) {
      this.load(`${BASE}${id}.m4a`)
        .then((b) => {
          if (!this.disposed) this.rec[id] = b;
        })
        .catch((e) => console.warn('[mong] snow sound failed to load', `${id}.m4a`, e));
    }
  }

  dispose() {
    this.disposed = true;
    try {
      this.broom?.src.stop();
    } catch {
      // already stopped
    }
    super.dispose();
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
    if (name === 'step') {
      // in a snow pile: the deep-snow footfalls. Until they have loaded, the usual ones
      if (data?.deep && this.rec.deep) this.lastDeep = this.footfall(this.rec.deep, DEEP_STEPS, DEEP_GAIN, this.lastDeep, pan);
      else if (this.rec.steps) this.lastStep = this.footfall(this.rec.steps, STEPS, STEP_GAIN, this.lastStep, pan);
      else this.crunch(pan);
    } else if (name === 'sweep') {
      if (this.rec.sweep) this.sweep(this.rec.sweep, pan);
      else this.swish(pan);
    } else if (name === 'fresh') {
      // new snow settling over everything: a soft breath
      burst(this.ctx, this.layer('night'), this.ctx.currentTime + 0.02, this.env.noise.pink, { dur: 1.1, gain: 0.12, type: 'lowpass', freq: 1400, attack: 0.35 });
    }
  }

  /** 뽀드득: one recorded footfall, never the same one twice in a row, a touch different in pitch each time. Returns which one. */
  private footfall(buf: AudioBuffer, steps: readonly (readonly [number, number])[], vol: number, last: number, pan: number) {
    const c = this.ctx;
    const t = c.currentTime + 0.01;
    let i = Math.floor(Math.random() * steps.length);
    if (i === last) i = (i + 1) % steps.length;
    const [at, len] = steps[i];
    const level = vol * rnd(0.85, 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rnd(0.96, 1.04);
    const g = gain(c, level);
    g.gain.setValueAtTime(level, t + len - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + len);
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(g).connect(p).connect(this.layer('steps'));
    src.start(t, at, len + 0.05);
    src.onended = () => p.disconnect();
    return i;
  }

  /**
   * 사락사락: the broom recording runs for as long as sweeps keep coming and fades out soon after the
   * last one. Each run starts on a stroke.
   */
  private sweep(buf: AudioBuffer, pan: number) {
    const c = this.ctx;
    const now = c.currentTime;
    const to = Math.max(-1, Math.min(1, pan));
    let b = this.broom;
    if (!b) {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = SWEEP_LOOP[0];
      src.loopEnd = SWEEP_LOOP[1];
      src.playbackRate.value = rnd(0.95, 1.05);
      const g = gain(c, 0);
      const p = c.createStereoPanner();
      p.pan.value = to;
      src.connect(g).connect(p).connect(this.layer('steps'));
      src.start(now, SWEEP_STROKES[Math.floor(Math.random() * SWEEP_STROKES.length)]);
      const mine = (b = this.broom = { src, g, p });
      src.onended = () => {
        p.disconnect();
        if (this.broom === mine) this.broom = null;
      };
    }
    b.p.pan.setTargetAtTime(to, now, 0.1);
    b.g.gain.cancelScheduledValues(now);
    b.g.gain.setTargetAtTime(SWEEP_GAIN, now, 0.03);
    b.g.gain.setTargetAtTime(0, now + SWEEP_HOLD, 0.08);
    b.src.stop(now + SWEEP_HOLD + 0.6); // a later sweep pushes this back
  }

  /**
   * (합성) 뽀드득: snow grains catch and slip again and again under the boot. Short ticks that speed up and
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

  /** (합성) 사락: snow pushed aside by a sweep. */
  private swish(pan: number) {
    burst(this.ctx, this.layer('steps'), this.ctx.currentTime + 0.01, this.env.noise.white, {
      dur: 0.24, gain: 0.16, type: 'bandpass', freq: rnd(2600, 3600), q: 0.7, attack: 0.08, pan,
    });
  }

  /** 먼 전차: a streetcar rumbling past a few blocks away, left to right or back, with its bell. */
  private tram(t: number) {
    const c = this.ctx;
    const rec = this.rec.tram;
    if (rec) {
      // the recording: its bell, then the streetcar pulling away. Softened and drifting off to one side
      const side = Math.random() < 0.5 ? -1 : 1;
      const src = c.createBufferSource();
      src.buffer = rec;
      src.playbackRate.value = rnd(0.97, 1.03);
      const p = c.createStereoPanner();
      p.pan.setValueAtTime(-0.15 * side, t);
      p.pan.linearRampToValueAtTime(0.7 * side, t + rec.duration);
      src.connect(filter(c, 'lowpass', 2400)).connect(gain(c, TRAM_GAIN * rnd(0.7, 1))).connect(p).connect(this.layer('tram'));
      this.keep(src).start(t);
      src.onended = () => p.disconnect();
      return;
    }
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
    if (this.rec.bell) {
      const src = c.createBufferSource();
      src.buffer = this.rec.bell;
      const g = gain(c, BELL_GAIN);
      src.connect(filter(c, 'lowpass', 2600)).connect(g).connect(this.layer('bell'));
      this.keep(src).start(t);
      src.onended = () => g.disconnect();
      return;
    }
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
