import { SceneSound, type LayerDef } from '../sound';
import { blip, burst, chain, filter, gain, loopNoise, rnd } from '../synth';

export const RAIN_LAYERS: readonly LayerDef[] = [
  { id: 'rain', label: '빗소리', icon: 'rain', def: 0.75 },
  { id: 'thunder', label: '천둥', icon: 'zap', def: 0.3 },
  { id: 'wind', label: '창밖 바람', icon: 'wind', def: 0.2 },
];

/** Rain at the window: a wash that follows rain strength, drops ticking on glass, wind, thunder after lightning. */
export class RainSound extends SceneSound {
  private intensity = 0.6;
  private rainLp!: BiquadFilterNode;
  private rainGain!: GainNode;
  private heavyGain!: GainNode;
  private windBp!: BiquadFilterNode;
  private windGain!: GainNode;

  start() {
    const c = this.ctx;
    this.rainLp = filter(c, 'lowpass', 5000, 0.5);
    this.rainGain = gain(c, 0.35);
    this.keep(loopNoise(c, this.env.noise.pink, chain(filter(c, 'highpass', 280, 0.5), this.rainLp, this.rainGain, this.layer('rain'))));
    this.heavyGain = gain(c, 0.05);
    this.keep(loopNoise(c, this.env.noise.brown, chain(filter(c, 'lowpass', 240, 0.5), this.heavyGain, this.layer('rain'))));
    this.windBp = filter(c, 'bandpass', 420, 0.9);
    this.windGain = gain(c, 0.15);
    this.keep(loopNoise(c, this.env.noise.brown, chain(this.windBp, this.windGain, this.layer('wind'))));
  }

  update(state: Record<string, number>) {
    this.intensity = state.intensity ?? this.intensity;
    const I = this.intensity;
    const now = this.ctx.currentTime;
    this.rainLp.frequency.setTargetAtTime(2200 + 6000 * I, now, 0.6);
    this.rainGain.gain.setTargetAtTime(0.12 + 0.42 * I, now, 0.6);
    this.heavyGain.gain.setTargetAtTime(0.3 * I * I, now, 0.6);
  }

  schedule(until: number) {
    const I = this.intensity;
    const c = this.ctx;
    // drops tapping the window
    this.poisson('tick', 4 + 36 * I, until, (t) => {
      blip(c, this.layer('rain'), t, { f0: rnd(2200, 5200), f1: rnd(1800, 4800), dur: rnd(0.008, 0.02), gain: rnd(0.008, 0.045), attack: 0.001, pan: rnd(-0.8, 0.8) });
    });
    // fatter drops on the sill
    this.poisson('plip', 0.5 + 1.5 * I, until, (t) => {
      const f = rnd(900, 1600);
      blip(c, this.layer('rain'), t, { f0: f, f1: f * 1.6, sweep: 0.03, dur: 0.06, gain: rnd(0.02, 0.06), pan: rnd(-0.6, 0.6) });
    });
    // gusts
    this.poisson('gust', 0.4, until, (t) => {
      this.windBp.frequency.setTargetAtTime(rnd(260, 650), t, 1.5);
      this.windGain.gain.setTargetAtTime(rnd(0.06, 0.32), t, 2);
    });
  }

  event(name: string) {
    if (name === 'flash') this.thunder(this.ctx.currentTime + rnd(0.8, 2.2));
  }

  private thunder(t: number) {
    const c = this.ctx;
    const dest = this.layer('thunder');
    const close = Math.random() < 0.5;
    const src = c.createBufferSource();
    src.buffer = this.env.noise.brown;
    const lp = filter(c, 'lowpass', rnd(150, 300), 0.6);
    const env = c.createGain();
    const rumble = c.createGain();
    const attack = rnd(0.05, 0.3);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(rnd(0.9, 1.4), t + attack);
    env.gain.setTargetAtTime(0.0001, t + attack, rnd(1.2, 2));
    for (let k = 0; k < 14; k++) rumble.gain.setTargetAtTime(rnd(0.35, 1), t + k * rnd(0.2, 0.35), 0.08);
    src.connect(lp).connect(env).connect(rumble).connect(dest);
    src.start(t, Math.random() * 2, 8);
    src.onended = () => rumble.disconnect();
    if (close) burst(c, dest, t, this.env.noise.white, { dur: 0.18, gain: 0.25, type: 'bandpass', freq: 1100, q: 0.6 });
  }
}
