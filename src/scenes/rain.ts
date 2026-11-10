import { Scene, type SceneVariant } from './base';
import { TAU, clamp, disc, drawDrop, layer, pick, rand, vignette } from './util';

interface Bokeh { x: number; y: number; r: number; img: HTMLCanvasElement; a: number; p: number; vx: number }
interface Streak { x: number; y: number; len: number; v: number }
interface Slider { x: number; y: number; r: number; v: number; wait: number; seed: number; tr: number }
interface Trail { x: number; y: number; r: number; age: number; max: number }

const BOKEH_COLORS: [number, number, number][] = [
  [255, 176, 96], [255, 210, 140], [255, 150, 90], [130, 176, 255], [255, 128, 168], [210, 225, 255], [255, 90, 70],
];

/** 비멍: rain seen from a window — blurred city lights, streaks, drops sliding down the glass. */
export class Rain extends Scene {
  intensity: number;
  private thunder: boolean;
  private flash = 0;
  private flashT = -1;
  private nextFlash = 3;
  private area = 1;
  private bokeh: Bokeh[] = [];
  private streaks: Streak[] = [];
  private sliders: Slider[] = [];
  private trail: Trail[] = [];
  private slideAcc = 0;
  private bg!: HTMLCanvasElement;
  private glass!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;

  constructor(variant: SceneVariant, opts: { intensity?: number; thunder?: boolean } = {}) {
    super(variant);
    this.intensity = opts.intensity ?? 0.6;
    this.thunder = opts.thunder ?? false;
  }

  setIntensity(v: number) {
    this.intensity = clamp(v, 0, 1);
  }

  setThunder(on: boolean) {
    this.thunder = on;
    if (on) this.nextFlash = 3;
  }

  audioState() {
    return { intensity: this.intensity, thunder: this.thunder ? 1 : 0 };
  }

  private newStreak(initial: boolean): Streak {
    const { w, h, s } = this;
    return {
      x: rand(-0.15, 1.05) * w,
      y: initial ? rand(-0.1, 1) * h : rand(-0.25, -0.02) * h,
      len: rand(16, 38) * s,
      v: rand(650, 1100) * s,
    };
  }

  layout() {
    const { w, h } = this;
    const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.35));
    this.area = clamp((w * h) / (390 * 844), 1, 3);
    const n = clamp(Math.round((w * h) / 6500), 18, 120);
    this.bokeh = Array.from({ length: n }, () => {
      const c = pick(BOKEH_COLORS);
      const road = Math.random() < 0.25;
      return {
        x: rand(0, w),
        y: road ? rand(0.72, 0.86) * h : rand(0.3, 0.95) * h,
        r: rand(12, road ? 30 : 58) * s,
        img: disc(c[0], c[1], c[2]),
        a: rand(0.14, 0.4),
        p: rand(0, TAU),
        vx: road ? pick([-1, 1]) * rand(18, 40) * s : 0,
      };
    });
    this.streaks = Array.from({ length: Math.round(360 * this.area) }, () => this.newStreak(true));
    this.bg = layer(w, h, this.dpr, (x) => {
      let g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#070c17');
      g.addColorStop(0.55, '#111b2d');
      g.addColorStop(1, '#1b2436');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.filter = `blur(${Math.round(10 * s)}px)`;
      x.fillStyle = 'rgba(3,6,12,0.75)';
      for (let bx = -20; bx < w;) {
        const bw = rand(50, 140) * s;
        const bh = rand(0.25, 0.6) * h;
        x.fillRect(bx, h * 0.92 - bh, bw, bh + 0.1 * h);
        bx += bw + rand(6, 30) * s;
      }
      x.filter = 'none';
      g = x.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.7);
      g.addColorStop(0, 'rgba(255,160,90,0.16)');
      g.addColorStop(1, 'rgba(255,160,90,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    });
    this.glass = layer(w, h, this.dpr, (x) => {
      const count = Math.round((w * h) / 1500);
      for (let i = 0; i < count; i++) {
        drawDrop(x, rand(0, w), rand(0, h), Math.pow(Math.random(), 2.2) * 3.2 * s + 0.6, 0.9);
      }
    });
    this.vig = vignette(w, h, this.dpr, 0.5);
    this.sliders = [];
    this.trail = [];
  }

  private activeStreaks() {
    return Math.min(this.streaks.length, Math.round((40 + 320 * this.intensity) * this.area * this.motion));
  }

  step(dt: number) {
    const { w, h, s } = this;
    const I = this.intensity;
    this.t += dt;
    const active = this.activeStreaks();
    for (let i = 0; i < active; i++) {
      const st = this.streaks[i];
      const v = st.v * (0.75 + 0.45 * I);
      st.y += v * dt;
      st.x += v * 0.16 * dt;
      if (st.y - st.len > h) Object.assign(st, this.newStreak(false));
    }
    for (const b of this.bokeh) {
      if (!b.vx) continue;
      b.x += b.vx * dt;
      if (b.x < -b.r) b.x = w + b.r;
      if (b.x > w + b.r) b.x = -b.r;
    }
    this.slideAcc += dt * (0.3 + 1.8 * I) * (w / 390);
    while (this.slideAcc >= 1) {
      this.slideAcc -= 1;
      if (this.sliders.length < 40 * this.area) {
        this.sliders.push({ x: rand(0, w), y: rand(-0.05, 0.7) * h, r: rand(3.5, 7.5) * s, v: 0, wait: rand(0.2, 1.6), seed: rand(0, TAU), tr: 0 });
      }
    }
    for (const d of this.sliders) {
      if (d.wait > 0) {
        d.wait -= dt;
        continue;
      }
      const go = Math.pow(0.5 + 0.5 * Math.sin(this.t * 1.1 + d.seed), 3);
      const target = (12 + 220 * go) * s * (d.r / (5 * s));
      d.v += (target - d.v) * Math.min(1, dt * 3);
      d.y += d.v * dt;
      d.x += Math.sin(this.t * 2.3 + d.seed) * 5 * s * dt;
      d.tr += d.v * dt;
      if (d.tr > 6 * s) {
        d.tr = 0;
        if (Math.random() < 0.7) {
          this.trail.push({ x: d.x + rand(-1, 1) * s, y: d.y - d.r * 0.9, r: d.r * rand(0.2, 0.4), age: 0, max: rand(3, 8) });
        }
      }
    }
    this.sliders = this.sliders.filter((d) => d.y < h + 20);
    for (const p of this.trail) p.age += dt;
    this.trail = this.trail.filter((p) => p.age < p.max);
    if (this.trail.length > 600) this.trail.splice(0, this.trail.length - 600);
    if (this.thunder) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flashT = 0;
        this.nextFlash = rand(20, 40);
        this.emit('flash');
      }
    }
    if (this.flashT >= 0) {
      this.flashT += dt;
      const ft = this.flashT;
      this.flash = ft < 0.07 ? 1 : ft < 0.15 ? 0.15 : ft < 0.24 ? 0.75 : Math.max(0, 0.75 - (ft - 0.24) * 1.6);
      if (ft > 1) {
        this.flashT = -1;
        this.flash = 0;
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, s, t } = this;
    const I = this.intensity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const b of this.bokeh) {
      ctx.globalAlpha = clamp(b.a * (0.75 + 0.25 * Math.sin(t * 0.6 + b.p)) * (1 + this.flash * 0.6), 0, 1);
      ctx.drawImage(b.img, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    ctx.strokeStyle = 'rgb(190,210,240)';
    ctx.lineWidth = Math.max(0.7, 1.1 * s);
    ctx.lineCap = 'round';
    const active = this.activeStreaks();
    for (let bucket = 0; bucket < 3; bucket++) {
      ctx.globalAlpha = (0.08 + bucket * 0.08) * (0.7 + 0.5 * I);
      ctx.beginPath();
      for (let i = bucket; i < active; i += 3) {
        const st = this.streaks[i];
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(st.x - st.len * 0.16, st.y - st.len);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.22;
      ctx.fillStyle = '#c8d6ff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(12,20,34,0.12)';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.glass, 0, 0, w, h);
    for (const p of this.trail) drawDrop(ctx, p.x, p.y, p.r, 1 - p.age / p.max);
    for (const d of this.sliders) drawDrop(ctx, d.x, d.y, d.r, 1);
    ctx.drawImage(this.vig, 0, 0, w, h);
  }
}
