import { Scene, type SceneVariant } from './base';
import { TAU, clamp, layer, rand, smooth, vignette, wallTime } from './util';

/** One wave comes in every this many seconds. The sound uses the same clock. */
export const WAVE_PERIOD = 9;

/** Where we are in the current wave, 0..1, from the shared page clock. */
export const wavePhase = (time = wallTime()) => (time % WAVE_PERIOD) / WAVE_PERIOD;

interface Row { k: number; y: number; amp: number; wl: number; sp: number; ph: number }
interface Glint { k: number; p: number; o: number }
interface Splash { x: number; y: number; age: number }

/** 물멍 · 바다: a moonlit sea; waves run up the beach and slide back. */
export class Sea extends Scene {
  size: number;
  private hz = 0;
  private shore = 0;
  private moon = { x: 0, y: 0, r: 0 };
  private rows: Row[] = [];
  private glints: Glint[] = [];
  private splashes: Splash[] = [];
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

  layout() {
    const { w, h } = this;
    const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.35));
    const landscape = w > h * 1.4;
    const hz = (this.hz = h * (landscape ? 0.4 : 0.36));
    const shore = (this.shore = h * (landscape ? 0.66 : 0.6));
    const moon = (this.moon = { x: w * 0.7, y: h * (landscape ? 0.18 : 0.14), r: 20 * s });
    this.bg = layer(w, h, this.dpr, (x) => {
      let g = x.createLinearGradient(0, 0, 0, hz);
      g.addColorStop(0, '#050816');
      g.addColorStop(1, '#1a2350');
      x.fillStyle = g;
      x.fillRect(0, 0, w, hz);
      for (let i = 0; i < Math.round((w * hz) / 1800); i++) {
        x.fillStyle = `rgba(230,236,255,${rand(0.15, 0.7)})`;
        const r = rand(0.4, 1.3);
        x.fillRect(rand(0, w), rand(0, hz * 0.9), r, r);
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
      g = x.createLinearGradient(0, hz, 0, shore);
      g.addColorStop(0, '#0d1638');
      g.addColorStop(1, '#0a1230');
      x.fillStyle = g;
      x.fillRect(0, hz, w, shore - hz);
      g = x.createLinearGradient(0, shore, 0, h);
      g.addColorStop(0, '#4b4759');
      g.addColorStop(0.45, '#35323f');
      g.addColorStop(1, '#1b1a24');
      x.fillStyle = g;
      x.fillRect(0, shore, w, h - shore);
      x.fillStyle = 'rgba(160,180,255,0.12)';
      x.fillRect(0, hz - 1, w, 2);
    });
    this.rows = Array.from({ length: 10 }, (_, i) => {
      const k = i / 9;
      return { k, y: hz + (shore - hz) * Math.pow(k, 1.7), amp: (0.6 + 6 * k) * s, wl: (30 + 260 * k) * s, sp: (6 + 26 * k) * s, ph: rand(0, TAU) };
    });
    this.glints = Array.from({ length: 46 }, (_, i) => ({ k: i / 45, p: rand(0, TAU), o: rand(-1, 1) }));
    this.vig = vignette(w, h, this.dpr, 0.5);
  }

  step(dt: number) {
    this.t += dt;
    for (const sp of this.splashes) sp.age += dt;
    this.splashes = this.splashes.filter((sp) => sp.age < 1.6);
  }

  tap(x: number, y: number) {
    if (y > this.hz && y < this.shore) {
      this.splashes.push({ x, y, age: 0 });
      this.emit('splash', { depth: (y - this.hz) / (this.shore - this.hz) });
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, s, t, hz, shore, moon } = this;
    const A = this.size;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, w, h);
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
    ctx.globalCompositeOperation = 'source-over';

    // swash: fast run-up, slow retreat — phase from the shared clock so the sound matches
    const ph = wavePhase();
    const run = ph < 0.3 ? 1 - Math.pow(1 - ph / 0.3, 2) : 1 - smooth(0, 1, (ph - 0.3) / 0.7);
    const reach = (h * 0.85 - shore) * (0.3 + 0.25 * A);
    const front = shore + run * reach;
    let g = ctx.createLinearGradient(0, shore, 0, shore + reach);
    g.addColorStop(0, 'rgba(10,10,22,0.45)');
    g.addColorStop(1, 'rgba(10,10,22,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, shore, w, reach);
    const edge = (x: number) => front + (Math.sin(x * 0.018 + 1.3) * 7 + Math.sin(x * 0.047 + t * 0.6) * 3) * s;
    g = ctx.createLinearGradient(0, shore - 4 * s, 0, front);
    g.addColorStop(0, 'rgba(14,24,62,0.95)');
    g.addColorStop(0.55, 'rgba(34,52,104,0.6)');
    g.addColorStop(1, 'rgba(90,112,165,0.28)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, shore - 4 * s);
    for (let x = 0; x <= w + 10; x += 10) ctx.lineTo(x, edge(x));
    ctx.lineTo(w + 10, shore - 4 * s);
    ctx.closePath();
    ctx.fill();
    // moonlight on the wet sheet
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 10; i++) {
      const y = shore + (front - shore) * (i / 10);
      const wid = (40 + 90 * (i / 10)) * s * (0.6 + 0.4 * Math.sin(t * 1.3 + i * 2.1));
      ctx.fillStyle = `rgba(255,236,200,${0.07 * (1 - i / 12)})`;
      ctx.fillRect(moon.x - wid / 2 + Math.sin(t * 0.8 + i) * 6 * s, y, wid, Math.max(1, 1.6 * s));
    }
    ctx.globalCompositeOperation = 'source-over';
    const foamA = ph < 0.35 ? 0.85 : 0.85 * (1 - (ph - 0.35) / 0.65) + 0.15;
    const foamLine = (alpha: number, width: number) => {
      ctx.strokeStyle = `rgba(235,242,255,${alpha})`;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let x = 0; x <= w + 10; x += 10) {
        const y = edge(x);
        if (x) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    };
    foamLine(foamA * 0.18, 8 * s);
    foamLine(foamA, 2 * s);
    ctx.fillStyle = `rgba(232,240,255,${foamA * 0.55})`;
    for (let i = 0; i < 70 * (w / 390); i++) {
      const x = (i * 97.3 + Math.sin(i * 7.1) * 20) % w;
      const back = (2 + ((i * 13) % 11)) * s * (0.5 + run);
      ctx.beginPath();
      ctx.arc(x, edge(x) - back, (0.6 + ((i * 7) % 3) * 0.4) * s, 0, TAU);
      ctx.fill();
    }
    // the wave breaking just offshore
    const br = ph < 0.12 ? ph / 0.12 : 1 - smooth(0.12, 0.6, ph);
    ctx.strokeStyle = `rgba(220,232,255,${0.15 + 0.5 * br})`;
    ctx.lineWidth = (1.5 + 3 * br) * s;
    ctx.beginPath();
    for (let x = 0; x <= w + 10; x += 10) {
      const y = shore - 10 * s + Math.sin(x * 0.02 + t * 0.4) * 3 * s;
      if (x) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    for (const sp of this.splashes) {
      const k = sp.age / 1.6;
      const depth = (sp.y - hz) / (shore - hz);
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
    ctx.drawImage(this.vig, 0, 0, w, h);
  }
}
