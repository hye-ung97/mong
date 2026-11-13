import { settings } from '../../lib/settings';
import type { Season } from '../../scenes/pond';
import type { StarPhase } from '../../scenes/star';
import { LoopPlayer, type LoopOptions } from '../loop';
import { SceneSound, type LayerDef } from '../sound';
import { burst, gain, rnd } from '../synth';

/*
 * 별멍's night sounds. Recordings (all CC0, Freesound — see public/sounds/CREDITS.md), mono, chosen on a listening page:
 *   dusk.m4a     silencyo "COUNTRY_NIGHT_Crickets_Distant_Frogs_Turtledove" (#81723)       -28 dBFS RMS
 *   calm.m4a     Nox_Sound "Ambiance_Nature_Night_Cricket_Calm_Loop" (#637083)              -28 dBFS RMS
 *   close.m4a    hargissssound "Cricket on Summer Night (binaural)" (#319372)               -28 dBFS RMS
 *   cricket.m4a  kvgarlic "LoneCricketInFallBasement" (#246537)                             -30 dBFS RMS
 *   frog.m4a     greysound "FrogsAndCrickets_ExcerptB" (#32655)                             -28 dBFS RMS
 *   scops.m4a    soundskeep "Scops Owl" (#352557)                                           -30 dBFS RMS
 *   owl.m4a      Elanor1995 "Tawny owl" (#688869), four calls                               peaks at -6 dBFS
 *   wind.m4a     felix.blume "Dry grass rustling in the wind, in the desert of Chile" (#146436)  -28 dBFS RMS
 *
 * Six layers, each heard only in its seasons, and louder or quieter with the time of night. Touching the grass
 * hushes the bugs and frogs for a few seconds. A recording is only fetched once its layer can be heard.
 *
 *   layer      seasons          dusk · night · dawn
 *   풀벌레     summer, autumn   loud · medium · soft      (three recordings, see INSECT_MIX)
 *   귀뚜라미   autumn           soft · loud · medium
 *   개구리     spring, summer   loud · soft · none             (louder in spring, when there are no bugs yet)
 *   소쩍새     spring, summer   none · now and then · rarely
 *   부엉이     autumn, winter   none · now and then · now and then
 *   밤바람     all year         light · light · a little stronger (winter: strong)
 */
const BASE = `${import.meta.env.BASE_URL}sounds/star/`;
const WIDE = [-0.55, 0.55] as const; // two copies of a mono recording, left and right, make it wide stereo
const COPY_GAIN = 0.7; // two uncorrelated copies at 0.7 ≈ the power of one at 1

export const STAR_LAYERS: readonly LayerDef[] = [
  { id: 'insects', label: '풀벌레', icon: 'leaf', def: 0.7 },
  { id: 'cricket', label: '귀뚜라미', icon: 'bug', def: 0.6 },
  { id: 'frog', label: '개구리', icon: 'frog', def: 0.3 },
  { id: 'scops', label: '소쩍새', icon: 'bird', def: 0 },
  { id: 'owl', label: '부엉이', icon: 'owl', def: 0.5 },
  { id: 'wind', label: '밤바람', icon: 'wind', def: 0.25 },
];

type LayerId = 'insects' | 'cricket' | 'frog' | 'scops' | 'owl' | 'wind';
type Night = readonly [dusk: number, night: number, dawn: number];

/** The scene sends its season and its place in the night as numbers, in this order. */
const SEASONS: readonly Season[] = ['spring', 'summer', 'autumn', 'winter'];
const PHASES: readonly StarPhase[] = ['dusk', 'night', 'dawn'];

/** Which layers sound in which season (spring, summer, autumn, winter), and how strongly. */
const SEASON_ON: Record<LayerId, readonly [number, number, number, number]> = {
  insects: [0, 1, 1, 0],
  cricket: [0, 0, 1, 0],
  frog: [1.6, 1, 0, 0], // spring has no bugs yet: the frogs carry the night
  scops: [1, 1, 0, 0],
  owl: [0, 0, 1, 1],
  wind: [1, 1, 1, 1.8],
};
/** Level at dusk, night and dawn. */
const NIGHT_LEVEL: Record<LayerId, Night> = {
  insects: [1, 0.7, 0.35],
  cricket: [0.5, 1, 0.7],
  frog: [1, 0.5, 0],
  scops: [0, 1, 0.4],
  owl: [0, 1, 1],
  wind: [0.5, 0.5, 0.8],
};
const HUSHED: readonly LayerId[] = ['insects', 'cricket', 'frog'];
const LAYER_IDS = Object.keys(SEASON_ON) as LayerId[];

/** A looping recording: its layer, its level against the others, where it sits, how its sections are joined. */
interface Voice {
  layer: LayerId;
  gain: number;
  pans: readonly number[];
  loop: LoopOptions;
}
type VoiceId = 'dusk' | 'calm' | 'close' | 'cricket' | 'frog' | 'scops' | 'wind';

const VOICES: Record<VoiceId, Voice> = {
  dusk: { layer: 'insects', gain: 1, pans: WIDE, loop: { xfade: 4, min: 25, max: 50 } },
  calm: { layer: 'insects', gain: 1, pans: WIDE, loop: { xfade: 3, min: 18, max: 36 } },
  close: { layer: 'insects', gain: 1, pans: WIDE, loop: { xfade: 4, min: 22, max: 45 } },
  // one cricket, a little to the left: a single copy, and short joins so it is not two crickets for long
  cricket: { layer: 'cricket', gain: 1, pans: [-0.4], loop: { xfade: 1.5, min: 20, max: 40 } },
  frog: { layer: 'frog', gain: 1, pans: WIDE, loop: { xfade: 3, min: 20, max: 45 } },
  scops: { layer: 'scops', gain: 1, pans: [0.45], loop: { xfade: 3, min: 20, max: 40 } },
  // the recording is as loud as the others, but 밤바람 sits low in the mix (0.25 × 0.5), so it gets a lift
  wind: { layer: 'wind', gain: 2.2, pans: WIDE, loop: { xfade: 5, min: 25, max: 55 } },
};
const VOICE_IDS = Object.keys(VOICES) as VoiceId[];

/**
 * 풀벌레 is three recordings. How much of each is heard at dusk, in the dead of night and toward dawn:
 * the busy field first, then the calm even chirping, then the one cricket close by once the rest has thinned out.
 * This is the table to change by ear.
 */
const INSECT_MIX: Partial<Record<VoiceId, Night>> = {
  dusk: [1, 0.35, 0],
  calm: [0.3, 1, 0.5],
  close: [0, 0.45, 1],
};

/** The four calls inside owl.m4a: where each starts and how long it lasts (seconds, with room for the fades). */
const OWL_CALLS = [[0.72, 1.7], [5.82, 1.8], [12.92, 1.6], [18.22, 1.8]] as const;
const OWL_GAIN = 0.4;
const OWL_EVERY = [14, 45] as const; // seconds between calls
const SCOPS_SPELL = [18, 40] as const; // the scops owl calls for this long...
const SCOPS_REST = [25, 70] as const; // ...then is silent for this long

/** A value at dusk (0), night (1) or dawn (2), and in between. */
const across = (n: Night, p: number) => (p <= 1 ? n[0] + (n[1] - n[0]) * p : n[1] + (n[2] - n[1]) * (p - 1));

/** Which layers are heard in a season (the sound sheet only shows these). */
export const starLayersFor = (season: number) => STAR_LAYERS.filter((l) => SEASON_ON[l.id as LayerId][season] > 0);

export class StarSound extends SceneSound {
  /** season × time of night, per layer (the hush pulls these down for a moment) */
  private readonly bus = {} as Record<LayerId, GainNode>;
  private readonly level = {} as Record<LayerId, number>;
  /** what the sound sheet's sliders are set to */
  private readonly slider = {} as Record<LayerId, number>;
  private readonly voice = {} as Record<VoiceId, GainNode>;
  private readonly asked = new Set<string>();
  private readonly loops: LoopPlayer[] = [];
  private spell!: GainNode;
  private spellEnd = 0;
  private scopsNext = 0;
  private owlBuf: AudioBuffer | null = null;
  private owlNext = 0;
  private owlLast = -1;
  private readonly owlPan = rnd(-0.6, 0.6); // the owl stays in one place in the dark
  // start where the scene will be (its first update comes a moment later), so no other season's recordings are fetched
  private pos = Math.max(0, PHASES.indexOf(settings().starPhase));
  private season = Math.max(0, SEASONS.indexOf(settings().starSeason));
  private hushUntil = 0;
  private born = 0;
  private disposed = false;

  start() {
    const c = this.ctx;
    for (const id of LAYER_IDS) {
      this.bus[id] = gain(c, 0);
      this.bus[id].connect(this.layer(id));
      this.level[id] = 0;
      this.slider[id] = this.layer(id).gain.value;
    }
    // the scops owl's recording runs on and on; `spell` opens it for a while and closes it again
    this.spell = gain(c, 0);
    this.spell.connect(this.bus.scops);
    for (const id of VOICE_IDS) {
      this.voice[id] = gain(c, INSECT_MIX[id] ? 0 : VOICES[id].gain);
      this.voice[id].connect(id === 'scops' ? this.spell : this.bus[VOICES[id].layer]);
    }
    this.born = c.currentTime;
    this.scopsNext = this.born + rnd(3, 8);
    this.owlNext = this.born + rnd(4, 10);
    this.apply(0);
  }

  update(state: Record<string, number>) {
    this.pos = state.pos ?? this.pos;
    this.season = state.season ?? this.season;
    this.apply(0.8);
  }

  setLayer(id: string, value: number) {
    super.setLayer(id, value);
    if (!(id in this.slider)) return;
    const layer = id as LayerId;
    const was = this.slider[layer];
    this.slider[layer] = value;
    if (value > 0 && was <= 0) {
      this.fetchHeard();
      this.wake(layer);
    }
  }

  private heard(id: LayerId) {
    return this.level[id] > 0 && this.slider[id] > 0;
  }

  /** Target level of each layer from the season and the time of night (hushed layers stay down while hushed). */
  private apply(tc: number) {
    const now = this.ctx.currentTime;
    const p = Math.max(0, Math.min(2, this.pos));
    for (const id of LAYER_IDS) {
      const v = SEASON_ON[id][this.season] * across(NIGHT_LEVEL[id], p);
      const was = this.level[id];
      this.level[id] = v;
      if (v > 0 && was <= 0) this.wake(id);
      if (HUSHED.includes(id) && now < this.hushUntil) continue;
      this.bus[id].gain.setTargetAtTime(v, now, tc || 0.01);
    }
    for (const id of VOICE_IDS) {
      const mix = INSECT_MIX[id];
      if (mix) this.voice[id].gain.setTargetAtTime(VOICES[id].gain * across(mix, p), now, tc || 0.01);
    }
    this.fetchHeard();
  }

  /** Fetch the recordings that can be heard now (the rest wait until their season, hour or slider comes). */
  private fetchHeard() {
    const p = Math.max(0, Math.min(2, this.pos));
    for (const id of VOICE_IDS) {
      const mix = INSECT_MIX[id];
      if (this.heard(VOICES[id].layer) && (!mix || across(mix, p) > 0.01)) void this.startVoice(id);
    }
    if (this.heard('owl') && !this.asked.has('owl')) {
      this.asked.add('owl');
      this.load(`${BASE}owl.m4a`)
        .then((b) => {
          if (!this.disposed) this.owlBuf = b;
        })
        .catch((e) => console.warn('[mong] star sound failed to load', 'owl.m4a', e));
    }
  }

  private async startVoice(id: VoiceId) {
    if (this.asked.has(id)) return;
    this.asked.add(id);
    const def = VOICES[id];
    try {
      const buf = await this.load(`${BASE}${id}.m4a`);
      if (this.disposed) return;
      const c = this.ctx;
      const now = c.currentTime;
      for (const pan of def.pans) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        p.connect(gain(c, def.pans.length > 1 ? COPY_GAIN : 1)).connect(this.voice[id]);
        const loop = new LoopPlayer(c, buf, p, def.loop);
        loop.start(now + 0.05);
        loop.schedule(now + 2);
        this.loops.push(loop);
      }
    } catch (e) {
      console.warn('[mong] star sound failed to load', `${id}.m4a`, e);
    }
  }

  /** A bird that has just become audible (its slider, its season, its hour) calls soon instead of after a long wait. */
  private wake(id: LayerId) {
    // not in the first seconds, though: the scene should fade in before anything calls
    const now = Math.max(this.ctx.currentTime, this.born + 3);
    if (id === 'scops' && now > this.spellEnd) this.scopsNext = Math.min(this.scopsNext, now + 0.3);
    if (id === 'owl') this.owlNext = Math.min(this.owlNext, now + rnd(0.8, 2));
  }

  schedule(until: number) {
    for (const loop of this.loops) loop.schedule(until);
    const now = this.ctx.currentTime;
    // 소쩍새: calls for a while, then a long silence
    if (this.heard('scops')) {
      while (this.scopsNext < until) {
        const t = Math.max(this.scopsNext, now);
        const len = rnd(...SCOPS_SPELL);
        this.spell.gain.setTargetAtTime(1, t, 1);
        this.spell.gain.setTargetAtTime(0, t + len, 1.5);
        this.spellEnd = t + len;
        this.scopsNext = this.spellEnd + rnd(...SCOPS_REST);
      }
    }
    // 부엉이: one call, now and then
    if (this.owlBuf && this.heard('owl')) {
      while (this.owlNext < until) {
        const t = Math.max(this.owlNext, now + 0.02);
        this.hoot(this.owlBuf, t);
        this.owlNext = t + rnd(...OWL_EVERY);
      }
    }
  }

  /** One recorded call, never the same one twice in a row, a touch different in pitch and distance each time. */
  private hoot(buf: AudioBuffer, t: number) {
    const c = this.ctx;
    let i = Math.floor(Math.random() * OWL_CALLS.length);
    if (i === this.owlLast) i = (i + 1) % OWL_CALLS.length;
    this.owlLast = i;
    const [at, len] = OWL_CALLS[i];
    const level = OWL_GAIN * rnd(0.6, 1);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rnd(0.97, 1.03);
    const g = gain(c, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(level, t + 0.12);
    g.gain.setValueAtTime(level, t + len - 0.3);
    g.gain.linearRampToValueAtTime(0, t + len);
    const p = c.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, this.owlPan + rnd(-0.08, 0.08)));
    src.connect(g).connect(p).connect(this.bus.owl);
    src.start(t, at, len + 0.05);
    src.onended = () => p.disconnect();
  }

  event(name: string, data?: Record<string, number | string>) {
    if (name !== 'hush') return;
    const c = this.ctx;
    const now = c.currentTime;
    const pan = typeof data?.x === 'number' ? data.x * 1.4 - 0.7 : 0;
    if (this.season === 3) {
      // winter: one step in the snow
      for (let i = 0; i < 5; i++) burst(c, this.bus.wind, now + i * rnd(0.018, 0.03), this.env.noise.white, { dur: 0.04, gain: 0.09, type: 'bandpass', freq: rnd(1800, 3200), q: 1.2, pan });
      return;
    }
    // the bugs and frogs stop at once, then come back one by one: the field first, then the cricket, the frogs last
    this.hushUntil = now + 4.6;
    HUSHED.forEach((id, i) => {
      const g = this.bus[id].gain;
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, 0.05);
      g.setTargetAtTime(this.level[id], now + 2 + i * 0.9, 0.7);
    });
  }

  dispose() {
    this.disposed = true;
    for (const loop of this.loops) loop.stop();
    super.dispose();
  }
}
