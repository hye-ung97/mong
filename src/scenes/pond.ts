import { Scene, type SceneVariant } from './base';
import { TAU, clamp, glow, layer, rand, smooth, vignette } from './util';

interface Ripple { x: number; y: number; age: number; max: number; power: number }
interface Pt { x: number; y: number; p: number; z: number }
interface Leaf { x: number; y: number; a: number; va: number; vx: number; vy: number; len: number; color: string }
interface Pad { fx: number; fy: number; r: number; a: number; p: number }

/** 물멍 · 연못: sunlight sparkling on a pond; tap to send out ripples. */
export class Pond extends Scene {
  drizzle: boolean;
  private ripples: Ripple[] = [];
  private next = 0.4;
  private pts: Pt[] = [];
  private leaves: Leaf[] | null = null;
  private pads: Pad[] | null = null;
  private readonly spark = glow(255, 240, 200, 0.2);
  private bg!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;

  constructor(variant: SceneVariant, opts: { drizzle?: boolean } = {}) {
    super(variant);
    this.drizzle = opts.drizzle ?? false;
  }

  setDrizzle(on: boolean) {
    this.drizzle = on;
    this.next = 0;
  }

  audioState() {
    return { drizzle: this.drizzle ? 1 : 0 };
  }

  layout() {
    const { w, h } = this;
    const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.35));
    this.bg = layer(w, h, this.dpr, (x) => {
      const g = x.createRadialGradient(w * 0.45, h * 0.3, 0, w * 0.45, h * 0.3, Math.hypot(w, h) * 0.75);
      g.addColorStop(0, '#1a6262');
      g.addColorStop(0.45, '#0b3a3b');
      g.addColorStop(1, '#041a1c');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.filter = `blur(${Math.round(30 * s)}px)`;
      x.fillStyle = 'rgba(0,10,12,0.45)';
      for (let i = 0; i < 5; i++) {
        x.beginPath();
        x.ellipse(rand(0, w), rand(0, h), rand(60, 160) * s, rand(40, 120) * s, rand(0, 3), 0, TAU);
        x.fill();
      }
      x.filter = 'none';
    });
    const n = clamp(Math.round(((w * h) / 260) * this.motion), 300, 3200);
    this.pts = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, h), p: rand(0, TAU), z: rand(0.6, 1.4) }));
    if (!this.pads) {
      this.pads = [[0.74, 0.62, 34], [0.86, 0.7, 26], [0.66, 0.73, 22]].map(([fx, fy, r]) => ({ fx, fy, r, a: rand(0, TAU), p: rand(0, TAU) }));
    }
    if (!this.leaves) {
      this.leaves = ['#c98a2e', '#b65a2a', '#a8a84a'].map((color) => ({
        x: rand(0.15, 0.85) * w, y: rand(0.15, 0.85) * h, a: rand(0, TAU), va: rand(-0.08, 0.08),
        vx: rand(-5, 5) * s, vy: rand(-3, 3) * s, len: rand(24, 34) * s, color,
      }));
    }
    this.vig = vignette(w, h, this.dpr, 0.55);
  }

  private addRipple(x: number, y: number, power: number) {
    this.ripples.push({ x, y, age: 0, max: 4.5, power });
    this.emit('ripple', { power, x: x / this.w });
  }

  tap(x: number, y: number) {
    this.addRipple(x, y, 1.2);
  }

  step(dt: number) {
    const { w, h, s } = this;
    this.t += dt;
    this.next -= dt;
    if (this.next <= 0) {
      this.addRipple(rand(0.1, 0.9) * w, rand(0.1, 0.9) * h, this.drizzle ? rand(0.4, 0.8) : rand(0.6, 1));
      this.next = this.drizzle ? rand(0.15, 0.5) : rand(1.4, 3);
    }
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < r.max);
    for (const L of this.leaves ?? []) {
      for (const r of this.ripples) {
        const dx = L.x - r.x;
        const dy = L.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        const front = r.age * 42 * s;
        if (Math.abs(d - front) < 8 * s) {
          L.vx += (dx / d) * 60 * s * dt * r.power;
          L.vy += (dy / d) * 60 * s * dt * r.power;
        }
      }
      L.vx *= 1 - 0.3 * dt;
      L.vy *= 1 - 0.3 * dt;
      L.x += (L.vx + 3 * s) * dt;
      L.y += (L.vy + Math.sin(this.t * 0.2 + L.a) * 2 * s) * dt;
      L.a += L.va * dt;
      const m = 40 * s;
      if (L.x > w + m) L.x = -m;
      if (L.x < -m) L.x = w + m;
      if (L.y > h + m) L.y = -m;
      if (L.y < -m) L.y = h + m;
    }
  }

  private drawPad(ctx: CanvasRenderingContext2D, pd: Pad) {
    const s = this.s;
    const r = pd.r * s;
    const x = pd.fx * this.w + Math.sin(this.t * 0.4 + pd.p) * 2 * s;
    const y = pd.fy * this.h + Math.cos(this.t * 0.33 + pd.p) * 2 * s;
    const a = pd.a + Math.sin(this.t * 0.15 + pd.p) * 0.05;
    ctx.fillStyle = 'rgba(0,10,12,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 5 * s, y + 8 * s, r, r * 0.96, 0, 0, TAU);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#4f9a5c');
    g.addColorStop(1, '#25603d');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, a + 0.22, a + TAU - 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(160,220,160,0.22)';
    ctx.lineWidth = Math.max(0.6, 0.8 * s);
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      const va = a + 0.22 + (i / 8) * (TAU - 0.44);
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(va) * r * 0.9, y + Math.sin(va) * r * 0.9);
    }
    ctx.stroke();
  }

  private leafPath(ctx: CanvasRenderingContext2D, len: number) {
    ctx.beginPath();
    ctx.moveTo(-len * 0.5, 0);
    ctx.quadraticCurveTo(0, -len * 0.42, len * 0.5, 0);
    ctx.quadraticCurveTo(0, len * 0.42, -len * 0.5, 0);
    ctx.closePath();
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, s, t } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, w, h);
    for (const r of this.ripples) {
      const k = r.age / r.max;
      for (let j = 0; j < 3; j++) {
        const rad = (r.age * 42 - j * 11) * s;
        if (rad <= 0) continue;
        const a = (1 - k) * (0.38 - j * 0.1) * r.power;
        ctx.strokeStyle = `rgba(190,255,245,${a})`;
        ctx.lineWidth = Math.max(0.8, 1.6 * s);
        ctx.beginPath();
        ctx.arc(r.x, r.y, rad, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = `rgba(0,18,20,${a * 0.7})`;
        ctx.lineWidth = Math.max(0.8, 2 * s);
        ctx.beginPath();
        ctx.arc(r.x, r.y, Math.max(0, rad - 3 * s), 0, TAU);
        ctx.stroke();
      }
    }
    // 윤슬: bands of sparkle drifting across the surface
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgb(255,248,220)';
    for (const p of this.pts) {
      const f = Math.sin((p.x * 0.028) / s + t * 0.6)
        + Math.sin((p.y * 0.041) / s - t * 0.5 + (p.x * 0.01) / s)
        + 0.7 * Math.sin(((p.x - p.y) * 0.019) / s + t * 0.9);
      let b = smooth(0.9, 2.3, f);
      if (b <= 0.01) continue;
      b *= 0.45 + 0.55 * Math.sin(t * 5 + p.p * 7);
      if (b <= 0.03) continue;
      const sz = (0.8 + 3 * b) * p.z * s;
      ctx.globalAlpha = Math.min(1, b * 1.1);
      ctx.fillRect(p.x - sz, p.y - 0.5, sz * 2, 1);
      ctx.fillRect(p.x - 0.5, p.y - sz * 0.6, 1, sz * 1.2);
      if (b > 0.55) {
        ctx.globalAlpha = b * 0.45;
        ctx.drawImage(this.spark, p.x - sz * 2, p.y - sz * 2, sz * 4, sz * 4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const pd of this.pads ?? []) this.drawPad(ctx, pd);
    for (const L of this.leaves ?? []) {
      ctx.save();
      ctx.translate(L.x + 6 * s, L.y + 9 * s);
      ctx.rotate(L.a);
      ctx.fillStyle = 'rgba(0,10,12,0.35)';
      this.leafPath(ctx, L.len);
      ctx.fill();
      ctx.restore();
      ctx.save();
      ctx.translate(L.x, L.y);
      ctx.rotate(L.a);
      ctx.fillStyle = L.color;
      this.leafPath(ctx, L.len);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,30,10,0.45)';
      ctx.lineWidth = Math.max(0.6, 0.9 * s);
      ctx.beginPath();
      ctx.moveTo(-L.len * 0.62, 0);
      ctx.lineTo(L.len * 0.48, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.drawImage(this.vig, 0, 0, w, h);
  }
}
