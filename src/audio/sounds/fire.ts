import { findHits, findPops, loudestAt, type Hit } from '../assets';
import { LoopPlayer } from '../loop';
import type { SceneEventData } from '../../scenes/base';
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
const ARMFUL = 1.2; // s: logs landing closer together than this are heard as one armful
const FLARE_RECOVERY = 4; // s after a whoosh before the fire can flare as loudly again
/** Each wood lands with its own weight: oak heavy and low, birch light. */
const WOOD_PITCH: Record<string, number> = { oak: 0.95, pine: 1, birch: 1.06 };

/** A whoosh that has been scheduled: logs landing before it bursts join it instead of adding their own. */
interface Whoosh { at: number; end: number; gain: GainNode; logs: number; fresh: number }

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
  /** which recorded drop played last, so the same one never plays twice running */
  private lastDrop = -1;
  /** when the last few logs landed (audio time) */
  private thuds: number[] = [];
  private whoosh: Whoosh | null = null;

  start() {
    const c = this.ctx;
    this.bedTone = filter(c, 'lowpass', 16000, 0.5);
    this.bedLevel = gain(c, 0.8);
    chain(this.bedTone, this.bedLevel, this.layer('bed'));
    void this.loadAll();
  }

  private async loadAll() {
    const [bed, log, flare] = await Promise.allSettled([
      this.load(`${BASE}bed.m4a`),
      this.load(`${BASE}log.mp3`),
      this.load(`${BASE}flare.mp3`),
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
  private playAligned(buf: AudioBuffer, o: {
    from: number; onset: number; length: number; at: number; level: number; fadeOut: number; rate?: number; pan?: number;
  }) {
    const c = this.ctx;
    const rate = o.rate ?? 1;
    const now = c.currentTime + 0.01;
    let when = o.at - (o.onset - o.from) / rate;
    let offset = o.from;
    if (when < now) {
      offset += (now - when) * rate;
      when = now;
    }
    const dur = Math.max(0.05, (o.from + o.length - offset) / rate);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    const end = when + dur;
    g.gain.setValueAtTime(o.level, when);
    g.gain.setValueAtTime(o.level, Math.max(when, end - o.fadeOut));
    g.gain.linearRampToValueAtTime(0.0001, end);
    const out = o.pan && c.createStereoPanner ? c.createStereoPanner() : null;
    if (out) {
      out.pan.value = o.pan!;
      src.connect(g).connect(out).connect(this.layer('fx'));
    } else src.connect(g).connect(this.layer('fx'));
    src.start(when, offset, dur * rate + 0.02);
    src.onended = () => {
      g.disconnect();
      out?.disconnect();
    };
    return { gain: g, end };
  }

  /**
   * The log hitting the fire: one of the recorded drops. Logs thrown in together are an armful —
   * each has its own knock, but a different recording from the one before and quieter than it,
   * so they tumble in instead of piling the same sound on itself.
   */
  private thud(impact: number, data?: SceneEventData) {
    if (!this.log || !this.logHits.length) return;
    this.thuds = this.thuds.filter((t) => impact - t < ARMFUL);
    const before = this.thuds.length;
    this.thuds.push(impact);
    let i = Math.floor(Math.random() * this.logHits.length);
    if (i === this.lastDrop) i = (i + 1) % this.logHits.length;
    this.lastDrop = i;
    const h = this.logHits[i];
    this.playAligned(this.log, {
      from: h.start,
      onset: h.onset,
      length: h.dur,
      at: impact,
      level: (LOG_GAIN * (this.logRef / Math.max(0.02, h.peak))) / (1 + 0.4 * before),
      fadeOut: 0.25,
      rate: (WOOD_PITCH[String(data?.kind)] ?? 1) * rnd(0.96, 1.04),
      pan: typeof data?.pan === 'number' ? data.pan * 0.4 : 0,
    });
  }

  private whooshLevel(w: Pick<Whoosh, 'logs' | 'fresh'>) {
    return FLARE_GAIN * w.fresh * Math.min(1.4, 1 + 0.15 * (w.logs - 1));
  }

  /**
   * The flame catching on a moment after a log lands. An armful catches as one fire: logs that
   * land while a whoosh is on its way make that one a little bigger instead of adding their own.
   */
  private catchFire(impact: number) {
    if (!this.flare) return;
    const now = this.ctx.currentTime;
    const w = this.whoosh;
    if (w && now < w.at - 0.05) {
      w.logs += 1;
      const level = this.whooshLevel(w);
      w.gain.gain.cancelScheduledValues(now);
      w.gain.gain.setValueAtTime(level, now);
      w.gain.gain.setValueAtTime(level, w.end - 0.8);
      w.gain.gain.linearRampToValueAtTime(0.0001, w.end);
      return;
    }
    const at = impact + FLARE_AFTER_IMPACT;
    // a fire that has only just flared has less left to give
    const fresh = w ? Math.max(0.4, Math.min(1, (at - w.at) / FLARE_RECOVERY)) : 1;
    const from = Math.max(0, this.flareBurst - 1.2);
    const played = this.playAligned(this.flare, {
      from,
      onset: this.flareBurst,
      length: this.flareBurst - from + FLARE_TAIL,
      at,
      level: this.whooshLevel({ logs: 1, fresh }),
      fadeOut: 0.8,
    });
    this.whoosh = { at, end: played.end, gain: played.gain, logs: 1, fresh };
  }

  /** A rush of crackles (embers scattering) from `at`, never weaker than the one still dying away. */
  private rush(amount: number, at: number) {
    const left = this.boost * Math.exp(-Math.max(0, at - this.boostAt) / BOOST_DECAY);
    this.boost = Math.max(amount, left);
    this.boostAt = at;
  }

  event(name: string, data?: SceneEventData) {
    const now = this.ctx.currentTime;
    // 뒤적이기: the embers scatter, with the same rush of crackles a landing log makes
    if (name === 'poke') this.rush(1, now);
    // burnt wood gave way and the pile slumped
    else if (name === 'settle') this.rush(0.5, now);
    if (name !== 'add') return;
    const impact = now + (typeof data?.impactIn === 'number' ? data.impactIn : 0.25);
    this.thud(impact, data);
    this.catchFire(impact);
    this.rush(1, impact + 0.2);
  }

  dispose() {
    this.disposed = true;
    this.loop?.stop();
    super.dispose();
  }
}
