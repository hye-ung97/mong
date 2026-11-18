import { SceneSound, type LayerDef } from '../sound';
import { blip, burst, filter, gain, loopNoise, rnd } from '../synth';

/*
 * 눈멍 (홋카이도의 겨울: 나무 · 발밑) share one soundscape and one mix.
 * Recordings (all CC0, Freesound — see public/sounds/CREDITS.md), mono, chosen on a listening page:
 *   steps.m4a   billox30 "Close-micd Snow Steps" (#175002), 20 single footfalls laid end to end
 *   train.m4a   Profispiesser "FXSaSc Train Passing Far Open Field" (#520188), the whole 21 s pass
 *   wind.m4a    TRP "Wind winter trees variable gusts 70km" (#574565), one 8 s gust from 1:24
 *   shake.m4a   Vrymaa "Snow - Collapse and fall" (#775014), 11 clumps of snow falling, laid end to end
 * 눈 오는 밤 stays synthesized (the listening page's choice). Until a recording has loaded, or if it fails
 * to, the synthesized sound it replaced plays instead.
 *
 * 나무 shows its train and its gusts and reports each one (events `train`, `gust`), so what is heard
 * comes from where it is seen. 발밑 and the home card show neither: there the sound brings them itself.
 */

const BASE = `${import.meta.env.BASE_URL}sounds/snow/`;

/**
 * Recordings this soundscape plays, by name (`${BASE}${name}.m4a`). To use a new recording for a
 * synthesized sound, add the file and its name here; its player below is already waiting for it:
 *   wind   바람 한 줄기: wind across open snow, ~5–8 s, swelling and dying away
 *   train  먼 기차: a train passing far off, ~15–30 s, quiet at both ends (centred on the train's pass)
 *   shake  푸스스: snow sliding off branches and thudding onto snow, ~1–2 s
 */
const RECORDINGS = ['steps', 'wind', 'train', 'shake'] as const;
type RecordingName = (typeof RECORDINGS)[number];
/** The clumps of snow inside shake.m4a: where each starts and how long it lasts (seconds). One plays per shake. */
const SHAKE_CLUMPS: readonly (readonly [number, number])[] = [
  [0, 1.8], [2.05, 1.85], [4.15, 1.6], [6, 1.85], [8.1, 2.3], [10.65, 0.85], [11.75, 0.7], [12.7, 0.8], [13.75, 0.5], [14.5, 1.65], [16.4, 1.35],
];

/** The footfalls inside steps.m4a: where each starts and how long it lasts (seconds). */
const STEPS: readonly (readonly [number, number])[] = [
  [0, 0.89], [1.14, 0.71], [2.1, 1.17], [3.52, 0.76], [4.53, 0.81], [5.59, 0.9], [6.74, 0.75], [7.74, 1.16], [9.15, 1.02], [10.42, 0.93],
  [11.6, 0.89], [12.74, 0.92], [13.91, 0.75], [14.91, 1.08], [16.24, 0.89], [17.38, 0.91], [18.54, 0.76], [19.55, 0.87], [20.67, 0.86], [21.78, 0.99],
];
const STEP_GAIN = 0.55;
/** Levels of the recordings to come, once they are added (wind.m4a · train.m4a · shake.m4a). */
const WIND_GAIN = 0.6;
const TRAIN_GAIN = 0.7;
const SHAKE_GAIN = 0.5;

export const SNOW_LAYERS: readonly LayerDef[] = [
  { id: 'steps', label: '뽀드득', icon: 'foot', def: 0.8 },
  { id: 'night', label: '눈 오는 밤', icon: 'snow', def: 0.55 },
  { id: 'wind', label: '바람 한 줄기', icon: 'wind', def: 0.4 },
  { id: 'train', label: '먼 기차', icon: 'tram', def: 0.3 },
];

/** Where no scene shows them (발밑, the home card): a gust about every 30 s, a train about once a minute. */
const GUST_EVERY = 30;
const TRAIN_EVERY = 60;

export class SnowSound extends SceneSound {
  private hiss!: GainNode;
  private fall = 0.6;
  /** the scene on screen shows the train and the gusts, and reports them */
  private driven = false;
  private nextGust = -1;
  private nextTrain = -1;
  private disposed = false;
  private rec: Partial<Record<RecordingName, AudioBuffer>> = {};
  private clacks: AudioBuffer | null = null;
  private lastStep = -1;

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
    for (const id of RECORDINGS) {
      this.load(`${BASE}${id}.m4a`)
        .then((b) => {
          if (!this.disposed) this.rec[id] = b;
        })
        .catch((e) => console.warn('[mong] snow sound failed to load', `${id}.m4a`, e));
    }
  }

  dispose() {
    this.disposed = true;
    super.dispose();
  }

  private hissFor(fall: number) {
    return 0.012 + 0.03 * fall;
  }

  update(state: Record<string, number>) {
    this.driven = state.drives === 1;
    const f = state.fall ?? this.fall;
    if (f === this.fall) return;
    this.fall = f;
    this.hiss.gain.setTargetAtTime(this.hissFor(f), this.ctx.currentTime, 1.5);
  }

  /** With nothing on screen to bring them (발밑, the home card), gusts and trains come by themselves. */
  schedule(until: number) {
    const now = this.ctx.currentTime;
    if (this.driven) {
      this.nextGust = this.nextTrain = -1;
      return;
    }
    if (this.nextGust < 0) this.nextGust = now + rnd(8, 20);
    if (this.nextTrain < 0) this.nextTrain = now + rnd(15, 40);
    while (this.nextGust <= until) {
      if (this.nextGust >= now - 0.05) this.gust(Math.max(now, this.nextGust), rnd(4.5, 6.5));
      this.nextGust += GUST_EVERY * rnd(0.6, 1.4);
    }
    while (this.nextTrain <= until) {
      if (this.nextTrain >= now - 0.05) this.train(Math.max(now, this.nextTrain), rnd(18, 26), Math.random() < 0.5 ? 1 : -1);
      this.nextTrain += TRAIN_EVERY * rnd(0.6, 1.4);
    }
  }

  event(name: string, data?: Record<string, number | string>) {
    const num = (k: string, d: number) => (typeof data?.[k] === 'number' ? (data[k] as number) : d);
    const pan = (num('x', 0.5) - 0.5) * 1.3;
    const t = this.ctx.currentTime + 0.01;
    if (name === 'step') {
      if (this.rec.steps) this.lastStep = this.footfall(this.rec.steps, STEPS, STEP_GAIN, this.lastStep, pan);
      else this.crunch(pan);
    } else if (name === 'shake') this.shake(t, num('amount', 1), pan * 0.85);
    else if (name === 'gust') this.gust(t, num('dur', 5));
    else if (name === 'train') this.train(t, num('dur', 20), num('dir', 1) < 0 ? -1 : 1);
    else if (name === 'fresh') {
      // new snow settling over everything: a soft breath
      burst(this.ctx, this.layer('night'), t + 0.01, this.env.noise.pink, { dur: 1.1, gain: 0.12, type: 'lowpass', freq: 1400, attack: 0.35 });
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

  /**
   * 푸스스: snow pouring off the shaken branches, then a few lumps thudding onto the hill. As loud as
   * 뽀드득 (its layer), and softer the less snow was left on the branches (`amount` 0…1).
   */
  private shake(t: number, amount: number, pan: number) {
    const c = this.ctx;
    const out = this.layer('steps');
    const k = 0.4 + 0.6 * Math.max(0, Math.min(1, amount));
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(out);
    const rec = this.rec.shake;
    if (rec) {
      const src = c.createBufferSource();
      src.buffer = rec;
      src.playbackRate.value = rnd(0.94, 1.06);
      // a bigger clump when more snow was left on the branches
      const pool = SHAKE_CLUMPS.filter(([, len]) => (amount > 0.5 ? len >= 1.3 : len < 1.9));
      const [from, len] = pool[Math.floor(Math.random() * pool.length)];
      src.connect(gain(c, SHAKE_GAIN * k)).connect(p);
      src.start(t, from, len);
      src.onended = () => p.disconnect();
      return;
    }
    const src = c.createBufferSource();
    src.buffer = this.env.noise.white;
    const lp = filter(c, 'lowpass', 2600);
    lp.frequency.setValueAtTime(2600, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + 1.2);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * k, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.3);
    src.connect(lp).connect(g).connect(p);
    src.start(t, Math.random() * (src.buffer.duration - 1.5), 1.4);
    src.onended = () => p.disconnect();
    for (let i = 0, at = t + 0.32; i < 3; i++, at += rnd(0.12, 0.26)) {
      const f0 = rnd(70, 96);
      blip(c, out, at, { f0, f1: 40, dur: 0.15, sweep: 0.12, gain: 0.13 * k, pan: pan + rnd(-0.2, 0.2) });
    }
  }

  /** 바람 한 줄기: a gust crossing the open snow, left to right like the snow dust it carries. */
  private gust(t: number, dur: number) {
    const c = this.ctx;
    const p = c.createStereoPanner();
    p.pan.setValueAtTime(-0.35, t);
    p.pan.linearRampToValueAtTime(0.35, t + dur);
    p.connect(this.layer('wind'));
    const rec = this.rec.wind;
    if (rec) {
      const len = Math.min(rec.duration, dur + 2);
      const src = c.createBufferSource();
      src.buffer = rec;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(WIND_GAIN, t + Math.min(0.6, len * 0.2));
      g.gain.setValueAtTime(WIND_GAIN, t + len - Math.min(1, len * 0.25));
      g.gain.linearRampToValueAtTime(0.0001, t + len);
      src.connect(g).connect(p);
      this.keep(src).start(t, 0, len);
      src.onended = () => p.disconnect();
      return;
    }
    // the body of the gust: noise whose pitch rises as it swells and falls as it dies
    const src = c.createBufferSource();
    src.buffer = this.env.noise.white;
    src.loop = true;
    const bp = filter(c, 'bandpass', 380, 0.7);
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.linearRampToValueAtTime(980, t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(360, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.34, t + dur * 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(p);
    // and the fine hiss of snow dust lifted off the hill
    const hp = filter(c, 'bandpass', 4200, 0.6);
    const g2 = c.createGain();
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.linearRampToValueAtTime(0.05, t + dur * 0.5);
    g2.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(hp).connect(g2).connect(p);
    this.keep(src).start(t, Math.random() * src.buffer.duration);
    src.stop(t + dur + 0.1);
    src.onended = () => p.disconnect();
  }

  /**
   * 먼 기차: a train rumbling over the far fields, clattering on the rail joints. `dir` 1 crosses from
   * left to right, -1 back; `dur` is how long it is in sight, and it is loudest halfway.
   */
  private train(t: number, dur: number, dir: 1 | -1) {
    const c = this.ctx;
    const panAt = (dt: number) => (-0.8 + (1.6 * Math.max(0, Math.min(dur, dt))) / dur) * dir;
    const p = c.createStereoPanner();
    p.connect(this.layer('train'));
    const rec = this.rec.train;
    if (rec) {
      // the recording's middle where the train is halfway across
      const lead = (dur - rec.duration) / 2;
      const from = Math.max(0, -lead);
      const len = Math.min(rec.duration - from, dur);
      const at = t + Math.max(0, lead);
      p.pan.setValueAtTime(panAt(at - t), at);
      p.pan.linearRampToValueAtTime(panAt(at - t + len), at + len);
      const src = c.createBufferSource();
      src.buffer = rec;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(TRAIN_GAIN, at + Math.min(1.5, len * 0.2));
      g.gain.setValueAtTime(TRAIN_GAIN, at + len - Math.min(1.5, len * 0.2));
      g.gain.linearRampToValueAtTime(0.0001, at + len);
      src.connect(filter(c, 'lowpass', 2400)).connect(g).connect(p);
      this.keep(src).start(at, from, len);
      src.onended = () => p.disconnect();
      return;
    }
    p.pan.setValueAtTime(panAt(0), t);
    p.pan.linearRampToValueAtTime(panAt(dur), t + dur);
    const src = c.createBufferSource();
    src.buffer = this.clackLoop();
    src.loop = true;
    src.playbackRate.value = rnd(0.92, 1.08);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.5, t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(filter(c, 'lowpass', 240)).connect(g).connect(p);
    this.keep(src).start(t, Math.random() * src.buffer.duration);
    src.stop(t + dur + 0.1);
    src.onended = () => p.disconnect();
  }

  /** (합성) 덜컹덜컹: rumble with the wheels knocking twice on each rail joint, looping. */
  private clackLoop() {
    if (this.clacks) return this.clacks;
    const c = this.ctx;
    const sr = c.sampleRate;
    const n = Math.floor(sr * 1.68);
    const buf = c.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    for (const at of [0.1, 0.32, 0.94, 1.16]) {
      const i0 = Math.floor(at * sr);
      for (let j = 0; j < sr * 0.03 && i0 + j < n; j++) d[i0 + j] += (Math.random() * 2 - 1) * 3 * Math.exp(-j / (sr * 0.006));
    }
    return (this.clacks = buf);
  }
}
