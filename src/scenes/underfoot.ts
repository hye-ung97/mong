import type { SceneVariant } from './base';
import { SnowScene, snowVignette, type SnowOpts } from './snow';
import { TAU, layer, rand, rng } from './util';

/** A flake falling toward the eye: it starts big and blurred above, and lands small on the snow. */
interface Flake { x: number; y: number; t: number; dur: number }

/**
 * 눈멍 · 발밑: standing under a street lamp, looking down at fresh snow. The whole screen is snow to
 * step on: a press leaves a boot print, a drag walks along under the finger. Sapporo shows only in a
 * manhole cover with the clock tower on it, where the snow has melted.
 */
export class Underfoot extends SnowScene {
  private flakes: Flake[] = [];
  private glints: [number, number, number, number][] = [];
  private hole = { x: 0, y: 0, r: 0 };
  private bg!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;
  private seeded = false;
  private pressing = false;
  private lastStep: { x: number; y: number } | null = null;

  constructor(variant: SceneVariant, opts: SnowOpts = {}) {
    super(variant, opts);
  }

  protected get squash() {
    return 1;
  }

  protected bounds() {
    const top = (this.top ?? 0) + 40;
    return { x0: 64, x1: this.w - 64, y0: Math.max(top, this.h * 0.3), y1: this.h - 220 };
  }

  protected scaleAt() {
    const k = 1.5 * (this.w > 600 ? 1.15 : 1);
    return this.card ? k * 0.45 : k;
  }

  layout() {
    const { w, h, dpr } = this;
    // wide screens move the manhole cover inward so all of it shows
    const wide = w > 600;
    const mr = this.card ? 38 : 76;
    const mx = this.card ? w - 30 : wide ? w - 170 : w - 58;
    const my = this.card ? h * 0.36 : wide ? 300 : Math.max(268, (this.top ?? 0) + 120);
    this.hole = { x: mx, y: my, r: mr + 16 };
    this.bg = layer(w, h, dpr, (x) => {
      const r = rng(11);
      let g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#aebcd8');
      g.addColorStop(1, '#9fafd0');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      /* the orange street lamp overhead */
      const lx = w * 0.42;
      const ly = h * 0.5;
      g = x.createRadialGradient(lx, ly, 0, lx, ly, h * 0.6);
      g.addColorStop(0, 'rgba(255,222,176,0.9)');
      g.addColorStop(0.45, 'rgba(255,208,150,0.42)');
      g.addColorStop(1, 'rgba(255,200,140,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      /* snow lying unevenly */
      for (let i = 0; i < 26; i++) {
        const bx = r() * w;
        const by = r() * h;
        const br = 50 + r() * 110;
        g = x.createRadialGradient(bx, by - br * 0.2, 0, bx, by, br);
        g.addColorStop(0, r() < 0.55 ? 'rgba(255,255,255,0.13)' : 'rgba(64,84,132,0.1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g;
        x.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      const grains = (9000 * (w * h)) / (390 * 844);
      for (let i = 0; i < grains; i++) {
        x.fillStyle = r() < 0.6 ? 'rgba(255,255,255,0.1)' : 'rgba(58,78,128,0.07)';
        x.fillRect(r() * w, r() * h, 1 + r() * 1.4, 1 + r() * 1.4);
      }
      this.paintManhole(x, mx, my, mr, r);
    });
    this.vig = snowVignette(w, h, dpr, 0.82);
    const r = rng(12);
    this.glints = [];
    const n = Math.round((46 * w * h) / (390 * 844));
    for (let i = 0; i < n; i++) this.glints.push([r() * w, r() * h, r() * TAU, 0.6 + r() * 1.6]);
    this.fillFlakes();
    if (!this.seeded) {
      this.seeded = true;
      this.seedTrail(this.card ? 4 : 8);
    }
  }

  /** A manhole cover with the clock tower cast into it. The iron is warm, so the snow on it has melted. */
  private paintManhole(x: CanvasRenderingContext2D, mx: number, my: number, mr: number, r: () => number) {
    const k = mr / 76;
    let g = x.createRadialGradient(mx, my, mr - 6 * k, mx, my, mr + 20 * k);
    g.addColorStop(0, 'rgba(84,100,140,0.7)');
    g.addColorStop(1, 'rgba(84,100,140,0)');
    x.fillStyle = g;
    x.beginPath();
    x.arc(mx, my, mr + 20 * k, 0, TAU);
    x.fill();
    g = x.createRadialGradient(mx - 20 * k, my - 24 * k, 4 * k, mx, my, mr);
    g.addColorStop(0, '#565a66');
    g.addColorStop(1, '#262830');
    x.fillStyle = g;
    x.beginPath();
    x.arc(mx, my, mr, 0, TAU);
    x.fill();
    x.save();
    x.translate(mx, my);
    x.scale(k, k);
    x.strokeStyle = 'rgba(255,236,206,0.2)';
    x.lineWidth = 2;
    x.beginPath();
    x.arc(0, 0, 70, 0, TAU);
    x.stroke();
    x.beginPath();
    x.arc(0, 0, 51, 0, TAU);
    x.stroke();
    x.lineWidth = 1.6;
    x.beginPath();
    for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU;
      x.moveTo(Math.cos(a) * 54, Math.sin(a) * 54);
      x.lineTo(Math.cos(a) * 67, Math.sin(a) * 67);
    }
    x.stroke();
    /* the clock tower in relief */
    x.strokeStyle = 'rgba(255,236,206,0.34)';
    x.lineWidth = 2;
    x.lineJoin = 'round';
    x.beginPath();
    x.rect(-30, 8, 60, 24);
    x.moveTo(-34, 8);
    x.lineTo(-22, -4);
    x.lineTo(22, -4);
    x.lineTo(34, 8);
    x.rect(-10, -26, 20, 22);
    x.moveTo(-13, -26);
    x.lineTo(0, -40);
    x.lineTo(13, -26);
    x.moveTo(5, -15);
    x.arc(0, -15, 5, 0, TAU);
    for (let i = -2; i <= 2; i++) {
      if (!i) continue;
      x.moveTo(i * 11, 14);
      x.lineTo(i * 11, 26);
    }
    x.stroke();
    x.restore();
    /* the snow around its rim */
    for (let i = 0; i < 54; i++) {
      const a = r() * TAU;
      const rad = mr - 3 * k + r() * 20 * k;
      const br = (5 + r() * 11) * k;
      x.fillStyle = r() < 0.5 ? 'rgba(190,202,226,0.97)' : 'rgba(204,214,234,0.97)';
      x.beginPath();
      x.ellipse(mx + Math.cos(a) * rad, my + Math.sin(a) * rad, br * 1.5, br * (0.6 + r() * 0.4), a + Math.PI / 2, 0, TAU);
      x.fill();
    }
  }

  protected fillFlakes() {
    const want = Math.round((this.fall.flakes * (this.w * this.h)) / (390 * 844));
    while (this.flakes.length < want) this.flakes.push(this.newFlake(true));
    this.flakes.length = want;
  }

  private newFlake(anywhere: boolean): Flake {
    return { x: rand(-20, this.w + 20), y: rand(-20, this.h + 20), t: anywhere ? Math.random() : 0, dur: rand(1.6, 3.2) };
  }

  /* ---------- stepping ---------- */
  private onCover(x: number, y: number) {
    return Math.hypot(x - this.hole.x, y - this.hole.y) < this.hole.r;
  }

  pressStart(x: number, y: number) {
    if (this.card) return false;
    this.pressing = true;
    this.lastStep = null;
    if (this.onCover(x, y)) return false;
    this.addPrint(x, y, true);
    this.lastStep = { x, y };
    return true;
  }

  /** Dragging walks: a new footprint every stride along the finger's path. */
  pressMove(x: number, y: number) {
    if (!this.pressing || this.onCover(x, y)) return false;
    const stride = 62 * this.scaleAt();
    if (this.lastStep && Math.hypot(x - this.lastStep.x, y - this.lastStep.y) <= stride) return false;
    this.addPrint(x, y, true);
    this.lastStep = { x, y };
    return true;
  }

  pressEnd() {
    this.pressing = false;
    this.lastStep = null;
  }

  /* ---------- time ---------- */
  step(dt: number) {
    this.t += dt;
    this.stepPrints(dt);
    const sp = (0.75 + this.fall.v * 0.5) * this.motion;
    for (const f of this.flakes) {
      f.t += (dt / f.dur) * sp;
      f.x += 9 * dt * (1.3 - f.t) * this.motion;
      f.y += 16 * dt * (1.3 - f.t) * this.motion;
      if (f.t >= 1) Object.assign(f, this.newFlake(false));
    }
  }

  draw(x: CanvasRenderingContext2D) {
    const { w, h } = this;
    x.drawImage(this.bg, 0, 0, w, h);
    /* now and then a snow crystal catches the lamp */
    for (const g of this.glints) {
      const a = Math.pow(Math.max(0, Math.sin(this.t * g[3] + g[2])), 8);
      if (a < 0.03) continue;
      x.fillStyle = `rgba(255,255,255,${a})`;
      x.fillRect(g[0] - 0.5, g[1] - 3, 1, 6);
      x.fillRect(g[0] - 3, g[1] - 0.5, 6, 1);
    }
    this.drawPrints(x);
    this.drawPuffs(x);
    x.fillStyle = '#fff';
    const size = this.card ? 0.5 : 1;
    for (const f of this.flakes) {
      x.globalAlpha = Math.min(1, f.t * 4) * (0.16 + 0.62 * f.t);
      x.beginPath();
      x.arc(f.x, f.y, (5.2 * (1 - f.t) + 0.9) * size, 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
    x.drawImage(this.vig, 0, 0, w, h);
  }
}
