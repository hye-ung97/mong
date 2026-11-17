import type { SceneEventData } from '../../scenes/base';
import { LoopPlayer, type LoopOptions } from '../loop';
import { SceneSound, type LayerDef } from '../sound';
import { blip, burst, filter, gain, loopNoise, rnd } from '../synth';

/*
 * 지하철멍: a carriage crossing a bridge at night, fireworks heard from inside. Recordings (all CC0, Freesound —
 * see public/sounds/CREDITS.md), mono, chosen on a listening page (Doan board subway-sound):
 *   train.m4a   SpliceSound "Subway ride, NYC M train over Williamsburg Bridge" (#260193), 150 s on the bridge
 *   ring.m4a    JKata "TrainCrossesAnIronBridge" (#626175), 10.5 s of a train on an iron bridge, heard from outside
 *   booms.m4a   20 single bursts laid end to end: DavidBlouin "Fireworks Festival Montreal" (#628410, from a window
 *               by the Jacques-Cartier bridge) and denalwa "apple blossom festival fireworks" (#188686, ~300 m away)
 *   cabin.m4a   Anya_Media "interior train subway metro standing at quiet suburban railway station" (#650722), 34 s
 *   voices.m4a  SpliceSound "Subway ride interior, quiet walla, NYC M train to Middle Village" (#260189), 89 s
 * The train goes 덜컹 at every rail joint and the bridge rings in the steel truss stretches. Each burst is heard
 * the moment it opens on screen, low and muffled through the glass; each one picks a different recorded boom. Voices in the carriage start turned off (their
 * recording is fetched only once 사람들 is turned up). Until a recording has loaded, or if it fails to, the
 * synthesized sound it replaces plays instead; the synthesized 덜컹, creak and glitter crackle stay on top.
 */

export const SUBWAY_LAYERS: readonly LayerDef[] = [
  { id: 'train', label: '열차', icon: 'subway', def: 0.8 },
  { id: 'fireworks', label: '불꽃', icon: 'spark', def: 0.8 },
  { id: 'cabin', label: '차 안', icon: 'wind', def: 0.4 },
  { id: 'crowd', label: '사람들', icon: 'people', def: 0 },
];

const BASE = `${import.meta.env.BASE_URL}sounds/subway/`;

/** The boom lands with the flash on screen (no sound delay for distance), this far ahead so it is scheduled exactly. */
const BOOM_LEAD = 0.01;
/** How much of the bridge's ring is heard on the truss and on the open stretches (synthesized / recorded). */
const RING_TRUSS = 0.32;
const RING_OPEN = 0.05;
const RING_REC_TRUSS = 0.55;
const RING_REC_OPEN = 0.03;
/** The ring was recorded outside the bridge; inside the carriage only its low roar comes through. */
const RING_LOWPASS = 1500;

/**
 * The bursts inside booms.m4a: where each slice starts, how long it is (seconds), and whether it is a big one.
 * Each slice starts BOOM_PRE before its boom. Every slice peaks at -3 dBFS; big and small differ by the gains below.
 */
const BOOMS: readonly (readonly [number, number, 0 | 1])[] = [
  [0, 2.6, 1], [2.85, 1.65, 1], [4.75, 2.04, 1], [7.04, 2.14, 1], [9.43, 2, 1], [11.68, 2.6, 1],
  [14.53, 2.09, 1], [16.87, 2.11, 1], [19.23, 1.84, 1], [21.32, 2.4, 1], [23.97, 2.6, 1], [26.82, 2.45, 1],
  [29.52, 1.36, 0], [31.13, 1.31, 0], [32.69, 1.19, 0], [34.13, 2.6, 0], [36.98, 1.94, 0], [39.17, 2.6, 0],
  [42.02, 2.6, 0], [44.87, 2.6, 0],
];
const BOOM_PRE = 0.05;
const BOOM_BIG = 0.45;
const BOOM_SMALL = 0.28;
/** The window between us and the fireworks: everything above this is mostly lost. */
const GLASS_LOWPASS = 1200;

/** Two copies of a mono recording, at different points and panned apart, sound like wide stereo. */
const SPREAD = 0.6;
const COPY_GAIN = 0.7; // two uncorrelated copies at 0.7 ≈ the power of one at 1
const TRAIN_GAIN = 1;
const CABIN_GAIN = 0.9;
const VOICE_GAIN = 0.9;
/** The recording already rumbles over the joints; the synthesized 덜컹 stays (it lands with the handles' jolt), softer. */
const JOINT_OVER_REC = 0.5;

type RecId = 'train' | 'ring' | 'cabin' | 'voices';
const LOOPS: Record<RecId, LoopOptions & { pans: readonly number[] }> = {
  train: { xfade: 3, min: 20, max: 40, pans: [-SPREAD, SPREAD] },
  ring: { xfade: 1.2, min: 3, max: 8, pans: [0] },
  cabin: { xfade: 2.5, min: 8, max: 16, pans: [-SPREAD, SPREAD] },
  voices: { xfade: 3, min: 15, max: 30, pans: [-SPREAD, SPREAD] },
};

export class SubwaySound extends SceneSound {
  /** the steel truss ring: up on the truss, down on the open stretches */
  private ring!: GainNode;
  /** synthesized beds per layer, faded out once their recording plays */
  private readonly synth = {} as Record<RecId, GainNode>;
  /** where each recording plays into */
  private readonly rec = {} as Record<RecId, GainNode>;
  private readonly playing = new Set<RecId>();
  private readonly asked = new Set<RecId>();
  private readonly synthSources = {} as Record<RecId, AudioScheduledSourceNode[]>;
  private readonly loops: LoopPlayer[] = [];
  private booms: AudioBuffer | null = null;
  private lastBoom = -1;
  private murmur!: GainNode;
  private truss = 0;
  private disposed = false;

  start() {
    const c = this.ctx;
    const n = this.env.noise;
    const bed = (id: RecId, buf: AudioBuffer, type: BiquadFilterType, freq: number, q: number, level: number) => {
      const f = filter(c, type, freq, q);
      f.connect(gain(c, level)).connect(this.synth[id]);
      (this.synthSources[id] ??= []).push(this.keep(loopNoise(c, buf, f)));
    };
    const train = this.layer('train');
    this.ring = gain(c, RING_OPEN);
    this.ring.connect(train);
    for (const id of ['train', 'ring', 'cabin', 'voices'] as const) {
      const dest = id === 'ring' ? this.ring : id === 'train' ? train : this.layer(id === 'cabin' ? 'cabin' : 'crowd');
      this.synth[id] = gain(c, 1);
      this.rec[id] = gain(c, 0);
      this.synth[id].connect(dest);
      if (id === 'ring') this.rec.ring.connect(filter(c, 'lowpass', RING_LOWPASS, 0.5)).connect(dest);
      else this.rec[id].connect(dest);
    }

    bed('train', n.brown, 'lowpass', 150, 0.7, 0.9); // the rumble under the floor
    bed('train', n.pink, 'bandpass', 380, 0.7, 0.18); // the carriage body
    bed('train', n.white, 'bandpass', 3000, 0.8, 0.03); // wheels on the rails
    // the steel truss rings hollow; it fades in and out as the stretches change
    bed('ring', n.pink, 'bandpass', 230, 3, 0.9);
    bed('ring', n.brown, 'lowpass', 70, 0.7, 0.6);

    bed('cabin', n.pink, 'lowpass', 700, 0.6, 0.22); // the air conditioning
    for (const [f, level] of [[118, 0.012], [236, 0.005]]) {
      const o = c.createOscillator();
      o.frequency.value = f;
      o.connect(gain(c, level)).connect(this.synth.cabin);
      o.start();
      this.synthSources.cabin.push(this.keep(o));
    }

    // voices: the synthesized murmur rises and falls; `murmur` also swells at the big bursts
    this.murmur = gain(c, 0.3);
    this.murmur.connect(this.synth.voices);
    const m1 = filter(c, 'bandpass', 520, 0.9);
    const m2 = filter(c, 'bandpass', 1100, 1.2);
    m1.connect(gain(c, 0.5)).connect(this.murmur);
    m2.connect(gain(c, 0.2)).connect(this.murmur);
    this.synthSources.voices = [this.keep(loopNoise(c, n.pink, m1)), this.keep(loopNoise(c, n.pink, m2))];

    for (const id of ['train', 'ring', 'cabin'] as const) void this.startRec(id);
    if (this.layer('crowd').gain.value > 0) void this.startRec('voices');
    this.load(`${BASE}booms.m4a`)
      .then((b) => {
        if (!this.disposed) this.booms = b;
      })
      .catch((e) => console.warn('[mong] subway sound failed to load', 'booms.m4a', e));
  }

  setLayer(id: string, value: number) {
    super.setLayer(id, value);
    if (id === 'crowd' && value > 0) void this.startRec('voices');
  }

  /** Start a recorded bed and fade its synthesized stand-in out. */
  private async startRec(id: RecId) {
    if (this.asked.has(id)) return;
    this.asked.add(id);
    try {
      const buf = await this.load(`${BASE}${id}.m4a`);
      if (this.disposed) return;
      const c = this.ctx;
      const now = c.currentTime;
      const { pans, ...opts } = LOOPS[id];
      for (const pan of pans) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        p.connect(gain(c, pans.length > 1 ? COPY_GAIN : 1)).connect(this.rec[id]);
        const loop = new LoopPlayer(c, buf, p, opts);
        loop.start(now + 0.05);
        loop.schedule(now + 2);
        this.loops.push(loop);
      }
      this.playing.add(id);
      this.rec[id].gain.setTargetAtTime(this.recLevel(id), now + 0.05, 0.5);
      this.synth[id].gain.setTargetAtTime(0, now + 0.3, 0.5);
      if (id === 'ring') this.ring.gain.setTargetAtTime(this.ringLevel(), now, 0.5);
      // the stand-in is silent by now; stop it
      window.setTimeout(() => {
        for (const s of this.synthSources[id] ?? []) {
          try {
            s.stop();
          } catch {
            // already stopped
          }
        }
      }, 4000);
    } catch (e) {
      this.asked.delete(id);
      console.warn('[mong] subway sound failed to load', `${id}.m4a`, e);
    }
  }

  private recLevel(id: RecId) {
    return id === 'train' ? TRAIN_GAIN : id === 'cabin' ? CABIN_GAIN : id === 'voices' ? VOICE_GAIN : 1;
  }

  private ringLevel() {
    if (this.playing.has('ring')) return this.truss ? RING_REC_TRUSS : RING_REC_OPEN;
    return this.truss ? RING_TRUSS : RING_OPEN;
  }

  dispose() {
    this.disposed = true;
    for (const loop of this.loops) loop.stop();
    super.dispose();
  }

  schedule(until: number) {
    const c = this.ctx;
    for (const loop of this.loops) loop.schedule(until);
    // a handle creaks on its strap
    this.poisson('creak', 1 / 14, until, (t) => {
      const f0 = rnd(620, 900);
      blip(c, this.layer('cabin'), t, { f0, f1: f0 * 0.82, dur: 0.22, gain: 0.006, attack: 0.05, type: 'triangle', pan: rnd(-0.5, 0.5) });
    });
    // the synthesized voices rise and fall
    if (!this.playing.has('voices')) this.poisson('murmur', 0.7, until, (t) => this.murmur.gain.setTargetAtTime(rnd(0.22, 0.45), t, 0.6));
  }

  update(state: Record<string, number>) {
    this.truss = state.truss ?? 0;
    this.ring.gain.setTargetAtTime(this.ringLevel(), this.ctx.currentTime, 0.9);
  }

  event(name: string, data?: SceneEventData) {
    if (name === 'joint') this.joint();
    else if (name === 'burst') this.boom(data ?? {});
  }

  /** 덜컹: the two wheelsets of a bogie over a rail joint, and on the truss the bridge answers. */
  private joint() {
    const c = this.ctx;
    const n = this.env.noise;
    const dest = this.layer('train');
    const t = c.currentTime + 0.02;
    const k = this.playing.has('train') ? JOINT_OVER_REC : 1;
    for (const dt of [0, 0.12]) {
      burst(c, dest, t + dt, n.white, { type: 'lowpass', freq: 300, q: 0.8, dur: 0.08, gain: 0.55 * k });
      burst(c, dest, t + dt, n.white, { type: 'bandpass', freq: 1600, q: 1.5, dur: 0.035, gain: 0.08 * k });
    }
    if (this.truss) burst(c, dest, t, n.pink, { type: 'bandpass', freq: 420, q: 6, dur: 0.6, gain: 0.12 * k, attack: 0.01 });
  }

  /** A burst heard from inside the carriage: a recorded boom through the glass, and crackle for glittering shells. */
  private boom(d: SceneEventData) {
    const c = this.ctx;
    const n = this.env.noise;
    const dest = this.layer('fireworks');
    const big = Number(d.big) > 0;
    const k = Number(d.near) > 0 ? 1.15 : 1;
    const pan = Number(d.pan ?? 0) * 0.6;
    const t = c.currentTime + BOOM_LEAD;
    if (this.booms) this.recordedBoom(this.booms, t, big, k, pan);
    else this.synthBoom(t, big, k, pan);
    if (Number(d.glitter) > 0) {
      for (let i = 0; i < 14; i++) {
        burst(c, dest, t + 0.35 + rnd(0, 1.3), n.white, { type: 'bandpass', freq: rnd(1200, 2000), q: 1.2, dur: 0.02, gain: rnd(0.01, 0.03) * k, pan: pan + rnd(-0.2, 0.2) });
      }
    }
    // the carriage goes "와" at the big ones (heard only when 사람들 is turned up)
    const voices = this.playing.has('voices') ? this.rec.voices.gain : this.murmur.gain;
    const base = this.playing.has('voices') ? VOICE_GAIN : 0.3;
    if (big) {
      voices.setTargetAtTime(base * 2.2, t + 0.2, 0.25);
      voices.setTargetAtTime(base, t + 1.4, 1.2);
    }
  }

  /** One recorded burst, never the same one twice running, big or small to match the shell. */
  private recordedBoom(buf: AudioBuffer, t: number, big: boolean, k: number, pan: number) {
    const c = this.ctx;
    const pool = BOOMS.flatMap(([, , b], i) => (b === (big ? 1 : 0) && i !== this.lastBoom ? [i] : []));
    const i = pool[Math.floor(Math.random() * pool.length)];
    this.lastBoom = i;
    const [at, len] = BOOMS[i];
    const rate = rnd(0.94, 1.04);
    // the slice starts BOOM_PRE before its boom: start it early, or skip into it, so the boom lands on t
    let start = t - BOOM_PRE / rate;
    let skip = 0;
    if (start < c.currentTime) {
      skip = (c.currentTime - start) * rate;
      start = c.currentTime;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = gain(c, (big ? BOOM_BIG : BOOM_SMALL) * k * rnd(0.85, 1));
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    src.connect(filter(c, 'lowpass', GLASS_LOWPASS, 0.5)).connect(g).connect(p).connect(this.layer('fireworks'));
    src.start(start, at + skip, len - skip);
    src.onended = () => p.disconnect();
  }

  /** (합성) a low boom and its echo off the towers. */
  private synthBoom(t: number, big: boolean, k: number, pan: number) {
    const c = this.ctx;
    const n = this.env.noise;
    const dest = this.layer('fireworks');
    burst(c, dest, t, n.brown, { type: 'lowpass', freq: big ? 240 : 190, q: 0.5, dur: big ? 1.4 : 0.95, gain: (big ? 1.1 : 0.75) * k, attack: 0.006, pan });
    blip(c, dest, t, { f0: 74, f1: 34, dur: big ? 0.75 : 0.5, sweep: 0.5, gain: (big ? 0.6 : 0.4) * k, pan });
    burst(c, dest, t + rnd(0.28, 0.45), n.brown, { type: 'lowpass', freq: 150, q: 0.5, dur: 1.2, gain: 0.25 * k, attack: 0.05, pan: -pan });
  }
}
