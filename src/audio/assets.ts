/* Loading recorded sounds and finding the useful moments inside them. */

const cache = new Map<string, Promise<AudioBuffer>>();

/** Fetch + decode once per URL (shared by every scene sound and preview). */
export function loadBuffer(ctx: BaseAudioContext, url: string): Promise<AudioBuffer> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
        return r.arrayBuffer();
      })
      .then((bytes) => ctx.decodeAudioData(bytes));
    cache.set(url, p);
    p.catch(() => cache.delete(url));
  }
  return p;
}

/** Forget a decoded sound so its memory can be freed (it is fetched again from the HTTP cache if needed). */
export function releaseBuffer(url: string) {
  cache.delete(url);
}

/** A slice of a buffer: where to start, how long, where the hit is, how loud it peaks. */
export interface Hit {
  start: number;
  dur: number;
  /** time of the transient inside the buffer (seconds) */
  onset: number;
  peak: number;
}

function mono(buf: AudioBuffer): Float32Array {
  const a = buf.getChannelData(0);
  if (buf.numberOfChannels === 1) return a;
  const b = buf.getChannelData(1);
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = (a[i] + b[i]) * 0.5;
  return out;
}

function peakIn(x: Float32Array, from: number, to: number) {
  let p = 0;
  for (let i = Math.max(0, from); i < Math.min(x.length, to); i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** RMS energy per window. */
function envelope(x: Float32Array, win: number, highpass = false): Float32Array {
  const n = Math.floor(x.length / win);
  const env = new Float32Array(n);
  for (let w = 0; w < n; w++) {
    let e = 0;
    const o = w * win;
    for (let i = o; i < o + win; i++) {
      const v = highpass ? x[i] - (i ? x[i - 1] : 0) : x[i];
      e += v * v;
    }
    env[w] = Math.sqrt(e / win);
  }
  return env;
}

/**
 * Separate loud events (e.g. three log drops in one file). Each hit runs from just
 * before its attack until it has died away.
 */
export function findHits(buf: AudioBuffer, opts: { minGap?: number; threshold?: number; maxDur?: number } = {}): Hit[] {
  const { minGap = 0.8, threshold = 0.2, maxDur = 1.6 } = opts;
  const x = mono(buf);
  const sr = buf.sampleRate;
  const win = Math.round(sr * 0.01);
  const env = envelope(x, win);
  const max = env.reduce((m, v) => Math.max(m, v), 0);
  const gap = Math.round(minGap / 0.01);
  const peaks: number[] = [];
  for (let i = 0; i < env.length; i++) {
    if (env[i] < max * threshold) continue;
    let isMax = true;
    for (let j = Math.max(0, i - gap); j < Math.min(env.length, i + gap); j++) {
      if (env[j] > env[i]) { isMax = false; break; }
    }
    if (isMax && (!peaks.length || i - peaks[peaks.length - 1] > gap)) peaks.push(i);
  }
  return peaks.map((p, k) => {
    let s = p;
    while (s > 0 && p - s < 15 && env[s - 1] > env[p] * 0.08) s--;
    const limit = Math.min(env.length, k + 1 < peaks.length ? peaks[k + 1] - 3 : env.length, p + Math.round(maxDur / 0.01));
    let e = p;
    let quiet = 0;
    while (e < limit && quiet < 6) {
      quiet = env[e] < env[p] * 0.03 ? quiet + 1 : 0;
      e++;
    }
    const start = Math.max(0, s * 0.01 - 0.02);
    return { start, dur: e * 0.01 - start, onset: s * 0.01, peak: peakIn(x, Math.round(start * sr), Math.round((e * 0.01) * sr)) };
  });
}

/** Sharp crackles inside an ambience recording: short, bright, well above what surrounds them. */
export function findPops(buf: AudioBuffer, opts: { max?: number; ratio?: number; minPeak?: number } = {}): Hit[] {
  const { max = 48, ratio = 5, minPeak = 0 } = opts;
  const x = mono(buf);
  const sr = buf.sampleRate;
  const win = Math.round(sr * 0.004);
  const hf = envelope(x, win, true);
  const n = hf.length;
  // running average over ~0.4 s as the local background
  const half = 50;
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + hf[i];
  const base = (i: number) => {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half);
    return (prefix[b] - prefix[a]) / (b - a);
  };
  const globalMax = hf.reduce((m, v) => Math.max(m, v), 0);
  const cands: { i: number; score: number; bg: number }[] = [];
  for (let i = 1; i < n - 1; i++) {
    const v = hf[i];
    if (v < globalMax * 0.04) continue;
    const bg = base(i);
    if (v < bg * ratio) continue;
    let isMax = true;
    for (let j = Math.max(0, i - 15); j < Math.min(n, i + 15); j++) {
      if (hf[j] > v) { isMax = false; break; }
    }
    if (isMax) cands.push({ i, score: v / bg, bg });
  }
  cands.sort((a, b) => b.score - a.score);
  const taken: number[] = [];
  const pops: Hit[] = [];
  for (const c of cands) {
    if (pops.length >= max) break;
    if (taken.some((t) => Math.abs(t - c.i) < 40)) continue;
    taken.push(c.i);
    let e = c.i;
    while (e < n && e - c.i < 75 && hf[e] > c.bg * 1.6) e++;
    const start = Math.max(0, (c.i - 1) * 0.004);
    const dur = Math.max(0.06, (e - c.i + 4) * 0.004);
    const peak = peakIn(x, Math.round(start * sr), Math.round((start + dur) * sr));
    if (peak < minPeak) continue;
    pops.push({ start, dur, onset: c.i * 0.004, peak });
  }
  return pops;
}

/** Time of the loudest 10 ms in the buffer. */
export function loudestAt(buf: AudioBuffer) {
  const env = envelope(mono(buf), Math.round(buf.sampleRate * 0.01));
  let best = 0;
  for (let i = 1; i < env.length; i++) if (env[i] > env[best]) best = i;
  return best * 0.01;
}

export function bufferPeak(buf: AudioBuffer) {
  const x = mono(buf);
  return peakIn(x, 0, x.length);
}
