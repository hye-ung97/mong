import { LoopPlayer } from '../loop';
import { SceneSound, type LayerDef } from '../sound';
import { gain, rnd } from '../synth';

/*
 * Recordings (all CC0, Freesound — see public/sounds/CREDITS.md), mono, levelled so 보슬비 < 비 < 장대비:
 *   light.m4a   bastipictures "rain against window 2" (#243781)    -33 dBFS RMS
 *   medium.m4a  jmbphilmes "Rain light 2 (rural)" (#200273)        -29 dBFS RMS
 *   heavy.m4a   jmbphilmes "Rain heavy 2 (rural)" (#200272)        -25 dBFS RMS, peaks soft-limited
 *   thunder.m4a bastipictures "peal of thunder - distant" (#243782)
 *   wind.m4a    pblzr "AMBIENCE_INTERIOR_WIND_NOISE_WINDOW" (#816508), 90 s from 0:32
 * Thunder and wind keep the balance against 비 chosen on the comparison page.
 */
const BASE = `${import.meta.env.BASE_URL}sounds/rain/`;

/** The scene's 보슬비 / 비 / 장대비 settings (0.25 / 0.6 / 1) and their recordings. */
const LEVELS = [
  { at: 0.25, file: 'light.m4a' },
  { at: 0.6, file: 'medium.m4a' },
  { at: 1, file: 'heavy.m4a' },
] as const;
const SPREAD = 0.6; // pan of the two copies that turn a mono recording into wide stereo
const COPY_GAIN = 0.7; // two uncorrelated copies at 0.7 ≈ the power of one at 1
const THUNDER_GAIN = 1.4;
const LOAD_OTHERS_AFTER = 2500; // ms: other levels load after the current one, so switching is instant

export const RAIN_LAYERS: readonly LayerDef[] = [
  { id: 'rain', label: '빗소리', icon: 'rain', def: 0.85 },
  { id: 'thunder', label: '천둥', icon: 'zap', def: 0.7 },
  { id: 'wind', label: '창밖 바람', icon: 'wind', def: 0.4 },
];

/** How much of each level to play for a rain strength, with equal-power cross-fades between neighbours. */
export function levelWeights(I: number): number[] {
  const w = LEVELS.map(() => 0);
  if (I <= LEVELS[0].at) w[0] = 1;
  else if (I >= LEVELS[LEVELS.length - 1].at) w[LEVELS.length - 1] = 1;
  else {
    const i = I < LEVELS[1].at ? 0 : 1;
    const k = (I - LEVELS[i].at) / (LEVELS[i + 1].at - LEVELS[i].at);
    w[i] = Math.cos((k * Math.PI) / 2);
    w[i + 1] = Math.sin((k * Math.PI) / 2);
  }
  return w;
}

/**
 * Rain at the window from real recordings: one recording per rain level, cross-faded when the level
 * changes; a recorded thunder peal 1–2 s after each lightning flash; wind outside.
 */
export class RainSound extends SceneSound {
  private intensity = 0.6;
  private levelGains: GainNode[] = [];
  private readonly loops: LoopPlayer[] = [];
  private readonly started = new Set<string>();
  private thunderBuf: AudioBuffer | null = null;
  private disposed = false;
  private othersTimer = 0;

  start() {
    const c = this.ctx;
    this.levelGains = LEVELS.map(() => {
      const g = gain(c, 0);
      g.connect(this.layer('rain'));
      return g;
    });
    this.applyWeights(0.05);
    void this.startLevel(this.nearestLevel());
    this.othersTimer = window.setTimeout(() => LEVELS.forEach((_, i) => void this.startLevel(i)), LOAD_OTHERS_AFTER);
    void this.wide('wind.m4a', this.layer('wind'));
    this.load(`${BASE}thunder.m4a`)
      .then((b) => {
        if (!this.disposed) this.thunderBuf = b;
      })
      .catch((e) => console.warn('[mong] thunder sound failed to load', e));
  }

  private nearestLevel() {
    let best = 0;
    LEVELS.forEach((l, i) => {
      if (Math.abs(l.at - this.intensity) < Math.abs(LEVELS[best].at - this.intensity)) best = i;
    });
    return best;
  }

  private startLevel(i: number) {
    return this.wide(LEVELS[i].file, this.levelGains[i]);
  }

  /** Two copies of a mono recording, at different points and panned apart, sound like wide stereo. */
  private async wide(file: string, dest: AudioNode) {
    const url = `${BASE}${file}`;
    if (this.started.has(url)) return;
    this.started.add(url);
    try {
      const buf = await this.load(url);
      if (this.disposed) return;
      const c = this.ctx;
      const now = c.currentTime;
      for (const pan of [-SPREAD, SPREAD]) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        p.connect(gain(c, COPY_GAIN)).connect(dest);
        const loop = new LoopPlayer(c, buf, p, { xfade: 3, min: 15, max: 30 });
        loop.start(now + 0.05);
        loop.schedule(now + 2);
        this.loops.push(loop);
      }
    } catch (e) {
      this.started.delete(url);
      console.warn('[mong] rain sound failed to load', url, e);
    }
  }

  private applyWeights(tau: number) {
    const now = this.ctx.currentTime;
    levelWeights(this.intensity).forEach((v, i) => this.levelGains[i].gain.setTargetAtTime(v, now, tau));
  }

  update(state: Record<string, number>) {
    const next = state.intensity ?? this.intensity;
    if (next === this.intensity) return;
    this.intensity = next;
    void this.startLevel(this.nearestLevel()); // in case it hasn't loaded yet
    this.applyWeights(0.7);
  }

  schedule(until: number) {
    for (const loop of this.loops) loop.schedule(until);
  }

  event(name: string) {
    if (name === 'flash') this.thunder(this.ctx.currentTime + rnd(0.8, 2.2));
  }

  /** One peal, a little different each time: pitch, level and direction vary. */
  private thunder(t: number) {
    if (!this.thunderBuf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.thunderBuf;
    src.playbackRate.value = rnd(0.9, 1.05);
    const p = c.createStereoPanner();
    p.pan.value = rnd(-0.35, 0.35);
    src.connect(gain(c, THUNDER_GAIN * rnd(0.7, 1))).connect(p).connect(this.layer('thunder'));
    src.start(t);
    src.onended = () => p.disconnect();
  }

  dispose() {
    this.disposed = true;
    window.clearTimeout(this.othersTimer);
    for (const loop of this.loops) loop.stop();
    super.dispose();
  }
}
