import { findHits, findPops, loudestAt, type Hit } from '../assets';
import { LoopPlayer } from '../loop';
import { SceneSound, type LayerDef } from '../sound';
import { chain, filter, gain, rnd } from '../synth';

/*
 * Recordings (all CC0, Freesound — see public/sounds/CREDITS.md):
 *   bed.m4a   HECKFRICKER "Campfire 02" (#729396), 100 s from 2:18
 *   log.mp3   ventousawins "wooden log drop" (#681416), three drops
 *   flare.mp3 Saladsounds "Sudden Burst of Small Flame" (#828434)
 */
const BASE = `${import.meta.env.BASE_URL}sounds/fire/`;
/*
 * Levels keep the balance chosen on the comparison page: bed 0.8, log 1.0, flare 0.6 (raw recordings).
 * Bed path ≈ 0.9 layer × 0.87 level; fx layer is 0.8, so the fx gains below are divided by 0.8.
 */
const LOG_GAIN = 1.25;
const FLARE_GAIN = 0.75;
const POP_MIN_PEAK = 0.04; // only crackles that are clearly audible in the recording
const FLARE_AFTER_IMPACT = 1.5; // s from the log landing to the flame catching
const FLARE_TAIL = 2.3; // s of the flare kept after its burst
const BOOST_DECAY = 2.5; // s, extra crackling after a log goes in

export const FIRE_LAYERS: readonly LayerDef[] = [
  { id: 'bed', label: '모닥불', icon: 'flame', def: 0.9 },
  { id: 'crackle', label: '타닥 소리', icon: 'log', def: 0.6 },
  { id: 'fx', label: '장작 넣는 소리', icon: 'hand', def: 0.8 },
];

const pick = <T>(list: readonly T[]) => list[Math.floor(Math.random() * list.length)];

/**
 * Campfire from real recordings: an endless crackling bed whose level and brightness follow the
 * fire, extra 타닥 pops cut from the same recording, and a log drop + flame burst when a log goes in.
 */
export class FireSound extends SceneSound {
  private intensity = 0.7;
  private crackleMul = 1;
  private boost = 0;
  private boostAt = 0;
  private disposed = false;
  private bedTone!: BiquadFilterNode;
  private bedLevel!: GainNode;
  private loop: LoopPlayer | null = null;
  private bed: AudioBuffer | null = null;
  private pops: Hit[] = [];
  private log: AudioBuffer | null = null;
  private logHits: Hit[] = [];
  private flare: AudioBuffer | null = null;
  private flareBurst = 1.2;
  /** peak of the drop heard on the comparison page; other drops are matched to it */
  private logRef = 0.1;

  start() {
    const c = this.ctx;
    this.bedTone = filter(c, 'lowpass', 16000, 0.5);
    this.bedLevel = gain(c, 0.8);
    chain(this.bedTone, this.bedLevel, this.layer('bed'));
    void this.load();
  }

  private async load() {
    const [bed, log, flare] = await Promise.allSettled([
      this.env.load(`${BASE}bed.m4a`),
      this.env.load(`${BASE}log.mp3`),
      this.env.load(`${BASE}flare.mp3`),
    ]);
    if (this.disposed) return;
    if (bed.status === 'fulfilled') {
      this.bed = bed.value;
      this.pops = findPops(bed.value, { max: 24, minPeak: POP_MIN_PEAK });
      if (this.pops.length < 6) this.pops = findPops(bed.value, { max: 12 }).sort((a, b) => b.peak - a.peak).slice(0, 8);
      this.loop = new LoopPlayer(this.ctx, bed.value, this.bedTone, { xfade: 3, min: 20, max: 45 });
      this.loop.start(this.ctx.currentTime + 0.05);
      this.loop.schedule(this.ctx.currentTime + 2);
    } else console.warn('[mong] fire bed sound failed to load', bed.reason);
    if (log.status === 'fulfilled') {
      this.log = log.value;
      this.logHits = findHits(log.value, { minGap: 0.8, threshold: 0.15, maxDur: 1.4 });
      this.logRef = this.logHits[0]?.peak ?? 0.1;
    } else console.warn('[mong] log sound failed to load', log.reason);
    if (flare.status === 'fulfilled') {
      this.flare = flare.value;
      this.flareBurst = loudestAt(flare.value);
    } else console.warn('[mong] flare sound failed to load', flare.reason);
  }

  update(state: Record<string, number>) {
    this.intensity = state.intensity ?? this.intensity;
    this.crackleMul = state.crackle ?? 1;
    const I = Math.max(0, Math.min(1, this.intensity));
    const now = this.ctx.currentTime;
    // a dying fire is quieter and duller; a roaring one is full and bright
    this.bedLevel.gain.setTargetAtTime(0.35 + 0.65 * I, now, 0.8);
    this.bedTone.frequency.setTargetAtTime(1800 + 16000 * Math.pow(I, 1.5), now, 0.8);
  }

  schedule(until: number) {
    this.loop?.schedule(until);
    if (!this.pops.length) return;
    const now = this.ctx.currentTime;
    const boost = now < this.boostAt ? this.boost : this.boost * Math.exp(-(now - this.boostAt) / BOOST_DECAY);
    const I = Math.max(0, Math.min(1.2, this.intensity));
    // a few extra crackles on top of the recording's own, more when the fire is strong
    const rate = (0.2 + 1.8 * Math.pow(I, 1.5)) * this.crackleMul + 6 * boost;
    this.poisson('pop', rate, until, (t) => this.pop(t));
  }

  /** One 타닥: a crackle cut from the recording, slightly re-pitched and placed. */
  private pop(t: number) {
    if (!this.bed) return;
    const c = this.ctx;
    const h = pick(this.pops);
    const src = c.createBufferSource();
    src.buffer = this.bed;
    src.playbackRate.value = rnd(0.85, 1.15);
    const g = c.createGain();
    const level = rnd(0.5, 1);
    g.gain.setValueAtTime(level, t);
    g.gain.setTargetAtTime(0, t + h.dur * 0.7, 0.015);
    const out = c.createStereoPanner ? c.createStereoPanner() : null;
    if (out) {
      out.pan.value = rnd(-0.5, 0.5);
      src.connect(g).connect(out).connect(this.layer('crackle'));
    } else src.connect(g).connect(this.layer('crackle'));
    src.start(t, h.start, h.dur + 0.05);
    src.onended = () => g.disconnect();
  }

  /** Play part of a buffer so that its `onset` lands exactly at `at`. */
  private playAligned(buf: AudioBuffer, from: number, onset: number, length: number, at: number, level: number, fadeOut: number) {
    const c = this.ctx;
    const now = c.currentTime + 0.01;
    let when = at - (onset - from);
    let offset = from;
    if (when < now) {
      offset += now - when;
      when = now;
    }
    const dur = Math.max(0.05, from + length - offset);
    const src = c.createBufferSource();
    src.buffer = buf;
    const g = c.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.setValueAtTime(level, when + Math.max(0, dur - fadeOut));
    g.gain.linearRampToValueAtTime(0.0001, when + dur);
    src.connect(g).connect(this.layer('fx'));
    src.start(when, offset, dur + 0.02);
    src.onended = () => g.disconnect();
  }

  event(name: string, data?: Record<string, number | string>) {
    if (name !== 'add') return;
    const impactIn = typeof data?.impactIn === 'number' ? data.impactIn : 0.25;
    const impact = this.ctx.currentTime + impactIn;
    // the log hitting the fire — one of the recorded drops at random
    if (this.log && this.logHits.length) {
      const h = pick(this.logHits);
      this.playAligned(this.log, h.start, h.onset, h.dur, impact, LOG_GAIN * (this.logRef / Math.max(0.02, h.peak)), 0.25);
    }
    // the flame catching on a moment later
    if (this.flare) {
      const burstAt = impact + FLARE_AFTER_IMPACT;
      const from = Math.max(0, this.flareBurst - 1.2);
      this.playAligned(this.flare, from, this.flareBurst, this.flareBurst - from + FLARE_TAIL, burstAt, FLARE_GAIN, 0.8);
    }
    // embers scatter: a short rush of crackles
    this.boost = 1;
    this.boostAt = impact + 0.2;
  }

  dispose() {
    this.disposed = true;
    this.loop?.stop();
    super.dispose();
  }
}
