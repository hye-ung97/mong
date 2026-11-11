import { Scene, type SceneVariant } from './base';
import { TAU, clamp, glow, layer, newSeed, rand, rng, smooth, soft, vignette, vnoise, wallTime } from './util';

/** One wave comes in every this many seconds. The sound uses the same clock. */
export const WAVE_PERIOD = 9;

/** Where we are in the current wave, 0..1, from the shared page clock. */
export const wavePhase = (time = wallTime()) => (time % WAVE_PERIOD) / WAVE_PERIOD;

interface Row { k: number; y: number; amp: number; wl: number; sp: number; ph: number }
interface Glint { k: number; p: number; o: number }
interface Splash { x: number; y: number; age: number }
interface Foot { x: number; y: number; rot: number; inner: number; wash: number }
interface Step { x: number; y: number; ang: number }

const MAX_FEET = 70;
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * 물멍 · 바다: a moonlit sea seen from a seat on the beach. The sand is drawn grain by grain;
 * a tap or a drag on it leaves footprints, and the waves wash away the ones they reach.
 */
export class Sea extends Scene {
  size: number;
  private readonly seed = newSeed();
  private floor: number | null = null;
  private hz = 0;
  private shore = 0;
  private moon = { x: 0, y: 0, r: 0 };
  private light = { x: 0, y: 0 };
  private lamp = { x: 0, y: 0, h: 0, on: false };
  private sandal = { x: 0, y: 0 };
  private rows: Row[] = [];
  private glints: Glint[] = [];
  private splashes: Splash[] = [];
  private feet: Foot[] = [];
  private wet = new Float32Array(0);
  private left = false;
  private quiet = false;
  private last: { x: number; y: number; t: number } | null = null;
  private drag: { x: number; y: number } | null = null;
  private ph = 0;
  private widx = 0;
  private run = 0;
  private reach = 0;
  private front = 0;
  private readonly lampGlow = glow(255, 170, 80, 0.4);
  private readonly lightGlow = glow(255, 240, 200, 0.4);
  private bg!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;

  constructor(variant: SceneVariant, opts: { size?: number } = {}) {
    super(variant);
    this.size = opts.size ?? 1;
  }

  setSize(v: number) {
    this.size = clamp(v, 0.4, 1.6);
  }

  audioState() {
    return { size: this.size };
  }

  /** Top edge (CSS px) of the controls resting on the dry sand; the lantern and sandals sit above them. `null`: none. */
  setEdges(_top: number | null, floor: number | null) {
    const f = floor === null ? null : Math.round(floor);
    if (f === null || this.floor === null ? f === this.floor : Math.abs(f - this.floor) < 2) return;
    this.floor = f;
    if (this.w) this.layout();
  }

  /** Things shrink toward the water: 0.35 at the shoreline, 1 at the bottom of the screen. */
  private pk(y: number) {
    return 0.35 + 0.65 * clamp((y - this.shore) / (this.h - this.shore), 0, 1);
  }

  private reachOf(size: number) {
    return this.h * (0.05 + 0.065 * size);
  }

  layout() {
    const { w, h, dpr } = this;
    const R = rng(this.seed);
    const rr = (a: number, b: number) => a + R() * (b - a);
    const rp = <T>(list: readonly T[]): T => list[Math.floor(R() * list.length)];
    const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.25));
    const landscape = w > h * 1.4;
    const wide = w > 900;
    const hz = (this.hz = h * (landscape ? 0.3 : 0.27));
    const shore = (this.shore = h * (landscape ? 0.5 : 0.44));
    const moon = (this.moon = { x: w * 0.72, y: hz * (landscape ? 0.52 : 0.81), r: 17 * s });
    // the lantern and the sandals sit on the dry sand just above the controls
    const dryTop = shore + this.reachOf(1.5) + 20 * s;
    const seat = this.variant === 'full' && this.floor !== null ? this.floor - 112 : h * 0.86;
    const room = seat > dryTop;
    this.lamp = { x: w * (wide ? 0.2 : 0.16), y: seat + 6, h: 0, on: room };
    this.sandal = { x: w * (wide ? 0.7 : 0.8), y: seat };
    this.wet = new Float32Array(Math.ceil(w / 8) + 2).fill(shore + this.reachOf(this.size) * 0.9);
    this.tide();

    this.bg = layer(w, h, dpr, (x) => {
      let g = x.createLinearGradient(0, 0, 0, hz);
      g.addColorStop(0, '#050816');
      g.addColorStop(1, '#1b2452');
      x.fillStyle = g;
      x.fillRect(0, 0, w, hz);
      for (let i = 0; i < Math.round((w * hz) / 1500); i++) {
        x.fillStyle = `rgba(230,236,255,${rr(0.15, 0.7)})`;
        const r = rr(0.4, 1.3);
        x.fillRect(rr(0, w), rr(0, hz * 0.92), r, r);
      }
      g = x.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, moon.r * 7);
      g.addColorStop(0, 'rgba(255,240,210,0.35)');
      g.addColorStop(1, 'rgba(255,240,210,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, hz);
      x.fillStyle = '#fff3dc';
      x.beginPath();
      x.arc(moon.x, moon.y, moon.r, 0, TAU);
      x.fill();
      x.fillStyle = 'rgba(200,190,170,0.25)';
      for (const [dx, dy, r] of [[-0.3, -0.2, 0.25], [0.25, 0.15, 0.18], [0.05, 0.4, 0.12]]) {
        x.beginPath();
        x.arc(moon.x + dx * moon.r, moon.y + dy * moon.r, r * moon.r, 0, TAU);
        x.fill();
      }
      /* the sea */
      g = x.createLinearGradient(0, hz, 0, shore);
      g.addColorStop(0, '#0f1a42');
      g.addColorStop(1, '#0a1230');
      x.fillStyle = g;
      x.fillRect(0, hz, w, shore - hz + 2);
      x.fillStyle = 'rgba(160,180,255,0.14)';
      x.fillRect(0, hz - 1, w, 2);
      /* a far headland with a lighthouse, and fishing boats' lights */
      x.fillStyle = '#070b1c';
      x.beginPath();
      x.moveTo(0, hz + 1);
      x.lineTo(0, hz - 15 * s);
      x.quadraticCurveTo(w * 0.1, hz - 20 * s, w * 0.2, hz - 7 * s);
      x.quadraticCurveTo(w * 0.27, hz - 2 * s, w * 0.32, hz + 1);
      x.closePath();
      x.fill();
      this.light = { x: w * 0.085, y: hz - 30 * s };
      x.fillRect(this.light.x - 1.6 * s, this.light.y, 3.2 * s, 14 * s);
      x.fillRect(this.light.x - 2.6 * s, this.light.y - 2 * s, 5.2 * s, 2.4 * s);
      for (const fx of wide ? [0.4, 0.47, 0.93] : [0.42, 0.53]) {
        const bx = w * fx;
        const by = hz - 1.5 * s;
        soft(x, glow(255, 232, 190, 0.4), bx, by, 7 * s, 7 * s, 0.6);
        x.fillStyle = '#fff1d0';
        x.fillRect(bx - s, by - s, 2 * s, 2 * s);
        x.fillStyle = 'rgba(255,232,190,0.3)';
        x.fillRect(bx - 0.6 * s, hz + 1, 1.2 * s, 9 * s);
      }
      this.paintSand(x, wide);
      this.paintProps(x, wide, dryTop, R, rr, rp);
    });
    this.rows = Array.from({ length: 10 }, (_, i) => {
      const k = i / 9;
      return { k, y: hz + (shore - hz) * Math.pow(k, 1.7), amp: (0.6 + 6 * k) * s, wl: (30 + 260 * k) * s, sp: (6 + 26 * k) * s, ph: rr(0, TAU) };
    });
    this.glints = Array.from({ length: 46 }, (_, i) => ({ k: i / 45, p: rr(0, TAU), o: rr(-1, 1) }));
    this.vig = vignette(w, h, dpr, 0.5);

    /* someone left their sandals and walked down to the water */
    this.feet = [];
    this.left = false;
    this.last = null;
    this.drag = null;
    if (room) {
      this.quiet = true; // these were walked before we sat down
      const sd = this.sandal;
      for (const p of this.trail(sd.x - 40 * s, sd.y - 16 * s, w * (wide ? 0.56 : 0.5), shore + h * 0.03, rr)) this.stepAt(p.x, p.y, p.ang);
      this.quiet = false;
    }
  }

  /** Sand, one grain at a time: fine far away, coarse up close, with wind ripples and the lantern's warm light baked in. */
  private paintSand(x: CanvasRenderingContext2D, wide: boolean) {
    const { w, h, s, dpr, hz, shore, lamp } = this;
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    const y0 = Math.max(0, Math.floor((shore - 8 * s) * dpr));
    const img = x.createImageData(W, H - y0);
    const D = img.data;
    const R2 = Math.pow((wide ? 150 : 105) * s, 2);
    const lit = lamp.on ? 1 : 0;
    let o = 0;
    for (let py = y0; py < H; py++) {
      const yy = py / dpr;
      const k = (yy - hz) / (h - hz);
      const z = 1 / k;
      const dT = clamp((yy - shore) / (h - shore), 0, 1);
      const br = lerp(140, 106, dT);
      const bg = lerp(128, 95, dT);
      const bb = lerp(108, 80, dT);
      const ga = 0.07 + 0.2 * k;
      for (let px = 0; px < W; px++) {
        const xx = px / dpr;
        const u = (xx - w / 2) / k / s;
        const m1 = vnoise(u * 0.012 + 40, z * 6);
        const m2 = vnoise(u * 0.05 + 9, z * 30 + 3);
        const rip = Math.sin(z * 110 + (vnoise(u * 0.006, z * 3) - 0.5) * 9 + u * 0.004);
        const dx = xx - lamp.x;
        const dy = (yy - lamp.y) / 0.45;
        const I = lit * Math.exp(-(dx * dx + dy * dy) / R2);
        let b = 1 + (m1 - 0.5) * 0.24 + (m2 - 0.5) * 0.12 + rip * 0.035 * (1 + 1.2 * I) + (Math.random() - 0.5) * ga;
        const r0 = Math.random();
        if (r0 < 0.004 * k) b += 0.4; // a grain that glints
        else if (r0 < 0.012 * k) b -= 0.22; // a dark grain
        D[o] = (br * (1 + I * 0.5) + 52 * I) * b;
        D[o + 1] = (bg * (1 + I * 0.3) + 22 * I) * b;
        D[o + 2] = bb * (1 + I * 0.05) * b;
        D[o + 3] = 255;
        o += 4;
      }
    }
    x.putImageData(img, 0, y0);
  }

  /** What lies on the sand: pebbles, shells, a starfish, the lantern, a pair of sandals. */
  private paintProps(
    x: CanvasRenderingContext2D, wide: boolean, dryTop: number,
    R: () => number, rr: (a: number, b: number) => number, rp: <T>(list: readonly T[]) => T,
  ) {
    const { w, h, s, lamp, sandal } = this;
    const bottom = Math.max(dryTop + 10, this.floor !== null && this.variant === 'full' ? this.floor - 30 : h - 20);
    for (let i = 0; i < Math.round(w / 26); i++) {
      const px = rr(0, w);
      const py = rr(dryTop, h - 20);
      const r = rr(1.6, 4.2) * s * this.pk(py);
      const rot = rr(-0.3, 0.3);
      const tone = rp([['#b9b3a8', '#5a554d'], ['#8d8f96', '#3d3f47'], ['#c9b79a', '#6b5a44']] as const);
      if (lamp.on && (Math.hypot(px - lamp.x, py - lamp.y) < 40 * s || Math.hypot(px - sandal.x, py - sandal.y) < 50 * s)) continue;
      x.fillStyle = 'rgba(20,14,8,0.4)';
      x.beginPath();
      x.ellipse(px + r * 0.25, py + r * 0.35, r * 1.05, r * 0.55, 0, 0, TAU);
      x.fill();
      const g = x.createLinearGradient(0, py - r * 0.6, 0, py + r * 0.6);
      g.addColorStop(0, tone[0]);
      g.addColorStop(1, tone[1]);
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(px, py, r, r * 0.6, rot, 0, TAU);
      x.fill();
    }
    const shells = wide ? [[0.31, 0.2], [0.44, 0.5], [0.62, 0.3], [0.84, 0.42], [0.9, 0.2], [0.1, 0.36]] : [[0.36, 0.18], [0.6, 0.42], [0.9, 0.12], [0.44, 0.6]];
    for (const [fx, fy] of shells) {
      const px = w * fx;
      const py = dryTop + (bottom - dryTop) * fy;
      const r = 7.5 * s * this.pk(py);
      x.save();
      x.translate(px, py);
      x.scale(1, 0.72);
      x.rotate(rr(-0.9, 0.9));
      x.fillStyle = 'rgba(20,14,8,0.4)';
      x.beginPath();
      x.ellipse(r * 0.2, r * 0.3, r, r * 0.6, 0, 0, TAU);
      x.fill();
      x.fillStyle = rp(['#eadbc8', '#e9c9c0', '#f1e6d4']);
      x.beginPath();
      x.ellipse(0, 0, r, r * 0.8, 0, Math.PI, TAU);
      x.lineTo(0, r * 0.5);
      x.closePath();
      x.fill();
      x.strokeStyle = 'rgba(132,96,78,0.55)';
      x.lineWidth = Math.max(0.5, 0.7 * s);
      x.beginPath();
      for (let i = 1; i < 7; i++) {
        const a = Math.PI + (i / 7) * Math.PI;
        x.moveTo(0, r * 0.5);
        x.lineTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.76);
      }
      x.stroke();
      x.restore();
    }
    { // a starfish
      const px = w * (wide ? 0.44 : 0.34);
      const py = dryTop + (bottom - dryTop) * 0.34;
      const r = 10 * s * this.pk(py);
      x.save();
      x.translate(px, py);
      x.scale(1, 0.62);
      x.rotate(0.4);
      for (const [ox, oy, col] of [[r * 0.15, r * 0.3, 'rgba(20,14,8,0.4)'], [0, 0, '#d6805a']] as const) {
        x.fillStyle = col;
        x.beginPath();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * TAU - Math.PI / 2;
          const rad = i % 2 ? r * 0.4 : r;
          x.lineTo(ox + Math.cos(a) * rad, oy + Math.sin(a) * rad);
        }
        x.closePath();
        x.fill();
      }
      x.fillStyle = 'rgba(255,214,180,0.6)';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * TAU - Math.PI / 2;
        x.beginPath();
        x.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.07, 0, TAU);
        x.fill();
      }
      x.restore();
    }
    if (!lamp.on) return;
    void R;
    { // sandals, left where their owner stepped out of them
      const L = 46 * s * this.pk(sandal.y);
      for (const [ox, oy, ang] of [[0, 0, -0.5], [L * 0.62, L * 0.2, -0.15]]) {
        x.save();
        x.translate(sandal.x + ox, sandal.y + oy);
        x.scale(1, 0.62);
        x.rotate(ang);
        x.fillStyle = 'rgba(16,10,6,0.45)';
        x.beginPath();
        x.ellipse(L * 0.06, L * 0.12, L * 0.24, L * 0.52, 0, 0, TAU);
        x.fill();
        x.fillStyle = '#c9584e';
        x.beginPath();
        x.ellipse(0, 0, L * 0.22, L * 0.5, 0, 0, TAU);
        x.fill();
        x.fillStyle = '#e07a6c';
        x.beginPath();
        x.ellipse(0, -L * 0.02, L * 0.17, L * 0.43, 0, 0, TAU);
        x.fill();
        x.strokeStyle = '#f3ebdc';
        x.lineWidth = L * 0.07;
        x.lineCap = 'round';
        x.beginPath();
        x.moveTo(-L * 0.19, L * 0.02);
        x.lineTo(0, -L * 0.24);
        x.lineTo(L * 0.19, L * 0.02);
        x.stroke();
        x.restore();
      }
    }
    { // the lantern
      const H = (lamp.h = 50 * s * this.pk(lamp.y));
      const lx = lamp.x;
      const ly = lamp.y;
      x.fillStyle = 'rgba(16,10,6,0.5)';
      x.beginPath();
      x.ellipse(lx, ly, H * 0.34, H * 0.1, 0, 0, TAU);
      x.fill();
      x.fillStyle = '#17181c';
      x.fillRect(lx - H * 0.24, ly - H * 0.14, H * 0.48, H * 0.14);
      const g = x.createRadialGradient(lx, ly - H * 0.4, 0, lx, ly - H * 0.4, H * 0.34);
      g.addColorStop(0, '#fff3c8');
      g.addColorStop(0.5, '#ffc063');
      g.addColorStop(1, '#d9781f');
      x.fillStyle = g;
      x.fillRect(lx - H * 0.2, ly - H * 0.66, H * 0.4, H * 0.52);
      x.strokeStyle = 'rgba(30,20,10,0.6)';
      x.lineWidth = Math.max(1, 1.2 * s);
      x.beginPath();
      x.moveTo(lx - H * 0.07, ly - H * 0.66);
      x.lineTo(lx - H * 0.07, ly - H * 0.14);
      x.moveTo(lx + H * 0.07, ly - H * 0.66);
      x.lineTo(lx + H * 0.07, ly - H * 0.14);
      x.stroke();
      x.fillStyle = '#1d1e23';
      x.beginPath();
      x.moveTo(lx - H * 0.26, ly - H * 0.66);
      x.lineTo(lx + H * 0.26, ly - H * 0.66);
      x.lineTo(lx + H * 0.14, ly - H * 0.8);
      x.lineTo(lx - H * 0.14, ly - H * 0.8);
      x.closePath();
      x.fill();
      x.strokeStyle = '#2a2b31';
      x.lineWidth = Math.max(1, 1.6 * s);
      x.beginPath();
      x.arc(lx, ly - H * 0.8, H * 0.2, Math.PI, TAU);
      x.stroke();
    }
  }

  /** Where the feet land on a walk from one point up to another. */
  private trail(x0: number, y0: number, x1: number, y1: number, rr: (a: number, b: number) => number): Step[] {
    const out: Step[] = [];
    const ang = Math.atan2(y1 - y0, x1 - x0);
    let x = x0;
    let y = y0;
    for (let i = 0; i < 40 && y > y1; i++) {
      out.push({ x, y, ang: ang + rr(-0.07, 0.07) });
      const st = this.stride(y);
      x += Math.cos(ang) * st;
      y += Math.sin(ang) * st;
    }
    return out;
  }

  private stride(y: number) {
    return 42 * this.s * this.pk(y);
  }

  private stepAt(x: number, y: number, ang: number | null) {
    const { s, t } = this;
    const L = this.last;
    let a = ang;
    if (a === null) {
      // a lone tap faces the sea; taps close together walk from one to the next
      const d = L ? Math.hypot(x - L.x, y - L.y) : 0;
      a = L && t - L.t < 2.5 && d > 8 * s && d < 150 * s ? Math.atan2(y - L.y, x - L.x) : -Math.PI / 2 + rand(-0.25, 0.25);
    }
    this.left = !this.left;
    const side = this.left ? -1 : 1;
    const off = 9 * s * this.pk(y);
    this.feet.push({ x: x - Math.sin(a) * off * side, y: y + Math.cos(a) * off * side, rot: a + Math.PI / 2, inner: this.left ? 1 : -1, wash: 0 });
    if (this.feet.length > MAX_FEET) this.feet.shift();
    this.last = { x, y, t };
    if (this.warmed && !this.quiet) {
      const wetY = this.wet[Math.min(this.wet.length - 1, Math.max(0, Math.round(x / 8)))];
      this.emit('step', { x: x / this.w, wet: y < wetY ? 1 : 0, left: this.left ? 1 : 0 });
    }
  }

  /** A press on the scene. On the sand it leaves a footprint (true); on the water, a pebble's splash. */
  walkStart(x: number, y: number) {
    if (y < this.hz) return false;
    if (y < this.edge(x) + 4) {
      this.splashes.push({ x, y, age: 0 });
      this.emit('splash', { depth: clamp((y - this.hz) / (this.shore - this.hz), 0, 1) });
      return false;
    }
    this.drag = { x, y };
    this.stepAt(x, y, null);
    return true;
  }

  /** Dragging over the sand walks along the path. True when a new footprint landed. */
  walkMove(x: number, y: number) {
    const d = this.drag;
    if (!d || y < this.edge(x) + 4) return false;
    if (Math.hypot(x - d.x, y - d.y) < this.stride(y)) return false;
    this.stepAt(x, y, Math.atan2(y - d.y, x - d.x));
    this.drag = { x, y };
    return true;
  }

  walkEnd() {
    this.drag = null;
  }

  tap(x: number, y: number) {
    this.walkStart(x, y);
    this.walkEnd();
  }

  /** Swash: a fast run-up and a slow retreat, on the shared clock so the sound matches. */
  private tide() {
    const now = wallTime();
    const ph = (this.ph = wavePhase(now));
    this.widx = Math.floor(now / WAVE_PERIOD);
    this.run = ph < 0.3 ? 1 - Math.pow(1 - ph / 0.3, 2) : 1 - smooth(0, 1, (ph - 0.3) / 0.7);
    this.reach = this.reachOf(this.size);
    this.front = this.shore + this.run * this.reach;
  }

  /** The water's edge on the sand at x. */
  private edge(x: number) {
    const { s, t } = this;
    return this.front
      + (Math.sin(x * 0.018 + 1.3) * 7 + Math.sin(x * 0.047 + t * 0.6) * 3 + Math.sin(x * 0.008 + this.widx * 2.1) * 12) * s * (0.35 + 0.65 * this.run);
  }

  step(dt: number) {
    const { s, shore } = this;
    this.t += dt;
    this.tide();
    const wet = this.wet;
    for (let i = 0; i < wet.length; i++) {
      const e = this.edge(i * 8);
      wet[i] = e > wet[i] ? e : Math.max(shore, wet[i] - dt * 1.6 * s); // wet sand dries slowly
    }
    for (const f of this.feet) if (this.edge(f.x) > f.y - 3 * s) f.wash += dt * 2;
    this.feet = this.feet.filter((f) => f.wash < 1);
    for (const sp of this.splashes) sp.age += dt;
    this.splashes = this.splashes.filter((sp) => sp.age < 1.6);
  }

  private footPath(ctx: CanvasRenderingContext2D, L: number, inner: number) {
    const el = (cx: number, cy: number, rx: number, ry: number) => {
      ctx.moveTo(cx + rx, cy);
      ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    };
    ctx.beginPath();
    el(0, L * 0.3, L * 0.13, L * 0.17); // heel
    el(-inner * L * 0.035, L * 0.06, L * 0.095, L * 0.2); // outer edge
    el(0, -L * 0.17, L * 0.18, L * 0.2); // ball
    for (let i = 0; i < 5; i++) {
      const r = L * (0.06 - i * 0.007);
      el(inner * (L * 0.15 - i * L * 0.08), -L * 0.44 + i * L * 0.042, r, r);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, s, t, hz, shore, moon, ph, run } = this;
    const A = this.size;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, w, h);
    /* the moon's path and the swell */
    ctx.globalCompositeOperation = 'lighter';
    for (const gl of this.glints) {
      const y = hz + (shore - hz) * Math.pow(gl.k, 1.4) + 2 * s;
      const wid = (6 + 120 * gl.k) * s * (0.5 + 0.5 * Math.sin(t * 1.7 + gl.p));
      const a = (0.1 + 0.35 * (1 - gl.k)) * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.3 + gl.p * 3)));
      ctx.fillStyle = `rgba(255,236,200,${a})`;
      ctx.fillRect(moon.x - wid / 2 + gl.o * (10 + 40 * gl.k) * s + Math.sin(t + gl.p) * 4 * s, y, wid, Math.max(1, (0.8 + 2.2 * gl.k) * s));
    }
    for (const r of this.rows) {
      ctx.strokeStyle = `rgba(150,175,235,${0.08 + 0.28 * r.k})`;
      ctx.lineWidth = Math.max(0.6, (0.5 + 1.6 * r.k) * s);
      ctx.beginPath();
      for (let x = 0; x <= w + 10; x += 10) {
        const y = r.y
          + Math.sin(((x + t * r.sp) / r.wl) * TAU + r.ph) * r.amp * A * 0.5
          + Math.sin(((x * 0.6 - t * r.sp * 0.7) / r.wl) * TAU) * r.amp * A * 0.3;
        if (x) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    const beam = Math.pow(Math.max(0, Math.sin((t * TAU) / 5)), 10); // the lighthouse turns
    const br = (5 + 16 * beam) * s;
    ctx.globalAlpha = 0.25 + 0.75 * beam;
    ctx.drawImage(this.lightGlow, this.light.x - br, this.light.y - br, br * 2, br * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    /* wet sand: darker, smooth, and the moon shows on it */
    const wet = this.wet;
    for (const [off, a] of [[0, 0.2], [-5 * s, 0.17], [-11 * s, 0.15]]) {
      ctx.fillStyle = `rgba(12,14,28,${a})`;
      ctx.beginPath();
      ctx.moveTo(0, shore - 8 * s);
      for (let i = 0; i < wet.length; i++) ctx.lineTo(i * 8, wet[i] + off);
      ctx.lineTo(w + 8, shore - 8 * s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    const wetY = wet[Math.min(wet.length - 1, Math.round(moon.x / 8))];
    for (let i = 0; i < 9; i++) {
      const y = shore + (wetY - 12 * s - shore) * (i / 9);
      const wid = (50 + 90 * (i / 9)) * s * (0.6 + 0.4 * Math.sin(t * 0.9 + i * 2.1));
      ctx.fillStyle = `rgba(255,236,200,${0.06 * (1 - i / 11)})`;
      ctx.fillRect(moon.x - wid / 2 + Math.sin(t * 0.6 + i) * 5 * s, y, wid, Math.max(1, 1.6 * s));
    }
    ctx.globalCompositeOperation = 'source-over';

    /* footprints: the wall toward the moon is in shadow, the far rim catches the light */
    for (const f of this.feet) {
      const pk = this.pk(f.y);
      const L = 54 * s * pk;
      const fy = 0.6 + 0.3 * clamp((f.y - shore) / (h - shore), 0, 1);
      const a = 1 - f.wash;
      const passes: [number, string, number][] = [
        [1.7 * pk * s, `rgba(255,236,204,${0.22 * a})`, 1.07],
        [0, `rgba(40,28,16,${0.42 * a})`, 1],
        [-1.4 * pk * s, `rgba(8,5,2,${0.26 * a})`, 0.78],
      ];
      for (const [oy, col, sc] of passes) {
        ctx.save();
        ctx.translate(f.x, f.y + oy);
        ctx.scale(1, fy);
        ctx.rotate(f.rot);
        ctx.scale(sc, sc);
        ctx.fillStyle = col;
        this.footPath(ctx, L, f.inner);
        ctx.fill();
        ctx.restore();
      }
    }

    /* the sheet of water that ran up the sand */
    const g = ctx.createLinearGradient(0, shore - 4 * s, 0, this.front + 8 * s);
    g.addColorStop(0, 'rgba(12,22,58,0.96)');
    g.addColorStop(0.4, 'rgba(40,62,112,0.5)');
    g.addColorStop(1, 'rgba(130,155,195,0.12)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, shore - 8 * s);
    for (let x = 0; x <= w + 10; x += 10) ctx.lineTo(x, this.edge(x));
    ctx.lineTo(w + 10, shore - 8 * s);
    ctx.closePath();
    ctx.fill();
    if (ph > 0.3) { // foam left where the water turned back
      ctx.fillStyle = `rgba(235,242,255,${0.4 * (1 - smooth(0.3, 0.9, ph))})`;
      for (let i = 0; i < wet.length; i++) {
        if ((i * 7) % 5 === 0) continue;
        ctx.fillRect(i * 8 + ((i * 13) % 5), wet[i] - ((i * 11) % 4) * s, (1 + ((i * 3) % 3)) * s, Math.max(1, s));
      }
    }
    const foamA = ph < 0.35 ? 0.9 : 0.9 * (1 - (ph - 0.35) / 0.65) + 0.12;
    const line = (alpha: number, width: number, back: number) => {
      ctx.strokeStyle = `rgba(238,244,255,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let x = 0; x <= w + 6; x += 6) {
        const y = this.edge(x) - (back ? back * (0.3 + 1.5 * vnoise(x * 0.02 + back, this.widx * 3.1 + t * 0.15)) * s * (0.4 + run) : 0);
        if (x) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    line(foamA * 0.16, 10 * s, 0);
    line(foamA * 0.22, 1.2 * s, 16);
    line(foamA * 0.35, 1.5 * s, 8);
    line(foamA, 2.6 * s, 0);
    ctx.fillStyle = `rgba(236,242,255,${foamA * 0.6})`;
    for (let i = 0; i < 90 * (w / 390); i++) {
      const x = (i * 97.3 + Math.sin(i * 7.1) * 20) % w;
      const back = (2 + ((i * 13) % 17)) * s * (0.5 + run);
      ctx.beginPath();
      ctx.arc(x, this.edge(x) - back, (0.6 + ((i * 7) % 3) * 0.45) * s, 0, TAU);
      ctx.fill();
    }
    /* the wave rising just offshore, then breaking */
    const q = smooth(0.7, 1, ph);
    const yb = ph > 0.7 ? shore - (8 + 40 * (1 - q)) * s : shore - 8 * s;
    const ba = ph > 0.7 ? 0.12 + 0.68 * q : ph < 0.15 ? 0.8 * (1 - ph / 0.15) : 0.08;
    const crest = (dy: number) => {
      ctx.beginPath();
      for (let x = 0; x <= w + 10; x += 10) {
        const y = yb + dy + Math.sin(x * 0.02 + t * 0.4) * 3 * s;
        if (x) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    ctx.strokeStyle = `rgba(3,6,20,${0.55 * ba})`;
    ctx.lineWidth = 6 * s * A;
    crest(4 * s);
    ctx.strokeStyle = `rgba(226,236,255,${ba})`;
    ctx.lineWidth = (1.4 + 3.6 * ba) * s;
    crest(0);
    for (const sp of this.splashes) {
      const k = sp.age / 1.6;
      const depth = clamp((sp.y - hz) / (shore - hz), 0.1, 1.4);
      for (let j = 0; j < 2; j++) {
        const r = (6 + 50 * k - j * 10) * s * (0.4 + depth);
        if (r <= 0) continue;
        ctx.strokeStyle = `rgba(210,225,255,${(1 - k) * 0.5})`;
        ctx.lineWidth = s;
        ctx.beginPath();
        ctx.ellipse(sp.x, sp.y, r, r * 0.25, 0, 0, TAU);
        ctx.stroke();
      }
    }
    if (this.lamp.on) { // the lantern flickers
      const H = this.lamp.h;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.5 + 0.12 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1)) * 0.7;
      ctx.drawImage(this.lampGlow, this.lamp.x - H * 1.5, this.lamp.y - H * 1.9, H * 3, H * 3);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.drawImage(this.vig, 0, 0, w, h);
  }
}
