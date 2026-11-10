/* Small Web Audio building blocks: looping noise beds, filtered bursts, pitched blips. */

export type NoiseKind = 'white' | 'pink' | 'brown';

/** Seamlessly looping stereo noise. The first part is cross-faded with the overrun so the loop point is inaudible. */
export function makeNoise(ctx: BaseAudioContext, kind: NoiseKind, seconds = 6): AudioBuffer {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const fade = Math.floor(rate * 0.25);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const raw = new Float32Array(len + fade);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
    for (let i = 0; i < raw.length; i++) {
      const white = Math.random() * 2 - 1;
      if (kind === 'white') raw[i] = white * 0.5;
      else if (kind === 'pink') {
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      } else {
        last = (last + 0.02 * white) / 1.02;
        raw[i] = last * 3.5;
      }
    }
    const out = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) out[i] = raw[i];
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      out[i] = raw[i] * k + raw[len + i] * (1 - k);
    }
  }
  return buf;
}

/** A looping noise source started at a random point (so layers never line up). */
export function loopNoise(ctx: AudioContext, buffer: AudioBuffer, dest: AudioNode): AudioBufferSourceNode {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.loop = true;
  src.connect(dest);
  src.start(0, Math.random() * buffer.duration);
  return src;
}

export function filter(ctx: AudioContext, type: BiquadFilterType, freq: number, q = 0.7): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

export function gain(ctx: AudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** Connects a chain of nodes left to right and returns the last one. */
export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

function panned(ctx: AudioContext, dest: AudioNode, pan: number): AudioNode {
  if (!pan || !ctx.createStereoPanner) return dest;
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(dest);
  return p;
}

/** Exponential attack/decay envelope. */
function envelope(param: AudioParam, t: number, peak: number, attack: number, decay: number) {
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + attack);
  param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

export interface BurstOpts {
  dur: number;
  gain: number;
  type: BiquadFilterType;
  freq: number;
  q?: number;
  attack?: number;
  pan?: number;
}

/** A short burst of filtered noise: crackles, ticks, splashes, thumps. */
export function burst(ctx: AudioContext, dest: AudioNode, t: number, buffer: AudioBuffer, o: BurstOpts) {
  const attack = o.attack ?? 0.001;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const f = filter(ctx, o.type, o.freq, o.q ?? 1);
  const g = ctx.createGain();
  envelope(g.gain, t, o.gain, attack, o.dur);
  src.connect(f).connect(g).connect(panned(ctx, dest, o.pan ?? 0));
  const offset = Math.random() * Math.max(0, buffer.duration - attack - o.dur - 0.1);
  src.start(t, offset, attack + o.dur + 0.05);
  src.onended = () => g.disconnect();
}

export interface BlipOpts {
  f0: number;
  f1: number;
  dur: number;
  gain: number;
  type?: OscillatorType;
  attack?: number;
  sweep?: number;
  pan?: number;
}

/** A pitched blip that glides from f0 to f1: bubbles, drops, crickets, birds. */
export function blip(ctx: AudioContext, dest: AudioNode, t: number, o: BlipOpts) {
  const attack = o.attack ?? 0.003;
  const osc = ctx.createOscillator();
  osc.type = o.type ?? 'sine';
  osc.frequency.setValueAtTime(o.f0, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + (o.sweep ?? o.dur));
  const g = ctx.createGain();
  envelope(g.gain, t, o.gain, attack, o.dur);
  osc.connect(g).connect(panned(ctx, dest, o.pan ?? 0));
  osc.start(t);
  osc.stop(t + attack + o.dur + 0.05);
  osc.onended = () => g.disconnect();
}

export const rnd = (a: number, b: number) => a + Math.random() * (b - a);
