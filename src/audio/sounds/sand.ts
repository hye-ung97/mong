import { LoopPlayer } from '../loop';
import { SceneSound, type LayerDef } from '../sound';
import { filter, gain } from '../synth';

/*
 * Recordings (both CC0, Freesound — see public/sounds/CREDITS.md), mono, chosen on a listening page:
 *   pour.m4a   mariethompson "pouring sand and salt 1" (#516921): the one unbroken pour, 31 s from 0:27, levelled
 *   empty.m4a  el_boss "Turning a Small Hour Glass" (#625655): the 4 s where the sand runs (from 0:02), levelled
 */
const BASE = `${import.meta.env.BASE_URL}sounds/sand/`;
const SPREAD = 0.5; // pan of the two copies that turn a mono recording into wide stereo
const COPY_GAIN = 0.7;
const RUSH_GAIN = 0.5; // empty.m4a is about 6 dB hotter than pour.m4a

export const SAND_LAYERS: readonly LayerDef[] = [
  { id: 'sand', label: '모래 소리', icon: 'sand', def: 0.8 },
];

/** Falling sand: the pour gets louder and brighter with the amount of sand; sand running through an hourglass, looped for as long as the frame is emptying. */
export class SandSound extends SceneSound {
  private flow: GainNode | null = null;
  private tone: BiquadFilterNode | null = null;
  private readonly loops: LoopPlayer[] = [];
  private rush: GainNode | null = null;
  private disposed = false;

  start() {
    const c = this.ctx;
    this.flow = gain(c, 0);
    this.tone = filter(c, 'lowpass', 9000, 0.5);
    this.tone.connect(this.flow).connect(this.layer('sand'));
    this.rush = gain(c, 0);
    this.rush.connect(this.layer('sand'));
    void this.loadAll();
  }

  private async loadAll() {
    try {
      const pour = await this.load(`${BASE}pour.m4a`);
      if (this.disposed || !this.tone) return;
      const c = this.ctx;
      const now = c.currentTime;
      for (const pan of [-SPREAD, SPREAD]) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        p.connect(gain(c, COPY_GAIN)).connect(this.tone);
        const loop = new LoopPlayer(c, pour, p, { xfade: 2, min: 9, max: 18 });
        loop.start(now + 0.05);
        loop.schedule(now + 2);
        this.loops.push(loop);
      }
      // the emptying sound runs silently all the time and is turned up while sand drains, so it lasts exactly as long
      const empty = await this.load(`${BASE}empty.m4a`);
      if (this.disposed || !this.rush) return;
      const at = c.currentTime;
      for (const pan of [-SPREAD, SPREAD]) {
        const p = c.createStereoPanner();
        p.pan.value = pan;
        p.connect(gain(c, COPY_GAIN)).connect(this.rush);
        // sections stay longer than the first fade-in (1.5 s) plus the cross-fade
        const loop = new LoopPlayer(c, empty, p, { xfade: 0.8, min: 2.6, max: 3.6 });
        loop.start(at + 0.05);
        loop.schedule(at + 2);
        this.loops.push(loop);
      }
    } catch (e) {
      console.warn('[mong] sand sound failed to load', e);
    }
  }

  schedule(until: number) {
    for (const loop of this.loops) loop.schedule(until);
  }

  update(state: Record<string, number>) {
    const t = this.ctx.currentTime;
    const flow = state.flow ?? 0;
    this.flow?.gain.setTargetAtTime(flow > 0 ? 0.35 + 0.65 * flow : 0, t, 0.5);
    this.tone?.frequency.setTargetAtTime(5500 + 8000 * flow, t, 0.5);
    this.rush?.gain.setTargetAtTime(state.drain ? RUSH_GAIN : 0, t, state.drain ? 0.2 : 0.5);
  }

  dispose() {
    this.disposed = true;
    for (const loop of this.loops) loop.stop();
    super.dispose();
  }
}
