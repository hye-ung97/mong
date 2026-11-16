import type { SceneVariant } from './base';
import { SnowScene, addRoundRect, snowVignette, type SnowOpts } from './snow';
import { TAU, clamp, layer, rand, rng } from './util';

interface Flake { x: number; y: number; z: number; ph: number }
interface Sweep { x: number; y: number; age: number; r: number }

const MAX_SWEEPS = 520;
const DRAG_START = 14; // px a press may move before it becomes a sweep

/** A bare tree. With `lights`, its twigs carry illumination bulbs. */
function treeSprite(seed: number, lights: boolean) {
  const W = 280;
  const H = 340;
  return layer(W, H, 2, (x) => {
    x.lineCap = 'round';
    const r = rng(seed);
    const pts: [number, number, number][] = [];
    const branch = (px: number, py: number, ang: number, len: number, wd: number, depth: number) => {
      const ex = px + Math.cos(ang) * len;
      const ey = py + Math.sin(ang) * len;
      x.strokeStyle = '#17151d';
      x.lineWidth = wd;
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(ex, ey);
      x.stroke();
      if (Math.abs(Math.cos(ang)) > 0.35 && wd > 0.9) {
        // snow lying along the branch
        x.strokeStyle = 'rgba(232,240,252,0.9)';
        x.lineWidth = Math.max(0.9, wd * 0.45);
        x.beginPath();
        x.moveTo(px, py - wd * 0.42);
        x.lineTo(ex, ey - wd * 0.42);
        x.stroke();
      }
      const n = Math.ceil(len / 13);
      for (let i = 1; i <= n; i++) pts.push([px + ((ex - px) * i) / n, py + ((ey - py) * i) / n, depth]);
      if (depth <= 0) return;
      const k = depth > 3 ? 2 : r() < 0.55 ? 2 : 3;
      for (let i = 0; i < k; i++) {
        const spread = (i - (k - 1) / 2) * (0.5 + r() * 0.35) + (r() - 0.5) * 0.3;
        branch(ex, ey, ang + spread, len * (0.64 + r() * 0.14), wd * 0.62, depth - 1);
      }
    };
    branch(W / 2, H, -Math.PI / 2 + (r() - 0.5) * 0.08, H * 0.3, 9, 5);
    if (!lights) return;
    x.shadowColor = 'rgba(255,196,112,0.95)';
    x.shadowBlur = 7;
    x.fillStyle = '#fff1cc';
    for (const p of pts) {
      if (p[2] > 3 || r() > 0.5) continue;
      x.beginPath();
      x.arc(p[0], p[1], 1.25, 0, TAU);
      x.fill();
    }
  });
}

/** A row of lit office towers from x0 to x1 standing on baseY. */
function towerBlocks(x: CanvasRenderingContext2D, r: () => number, x0: number, x1: number, baseY: number, minH: number, maxH: number) {
  let px = x0;
  while (px < x1) {
    const bw = 22 + r() * 34;
    const bh = minH + r() * (maxH - minH);
    const tone = 18 + Math.floor(r() * 14);
    x.fillStyle = `rgb(${tone},${tone + 6},${tone + 26})`;
    x.fillRect(px, baseY - bh, bw, bh + 2);
    x.fillStyle = 'rgba(232,240,252,0.5)';
    x.fillRect(px, baseY - bh - 1.5, bw, 2);
    for (let wy = baseY - bh + 6; wy < baseY - 6; wy += 7) {
      for (let wx = px + 4; wx < px + bw - 4; wx += 6) {
        if (r() < 0.36) {
          x.fillStyle = r() < 0.75 ? 'rgba(255,205,130,0.75)' : 'rgba(200,225,255,0.6)';
          x.fillRect(wx, wy, 2.6, 3.4);
        }
      }
    }
    px += bw + 1 + r() * 3;
  }
}

/**
 * 눈멍 · 시계탑: the Sapporo clock tower seen from across the street on a snowy night, office towers
 * all around. Its clock shows the time now. The lower part of the screen is the snowed-in forecourt:
 * a press leaves a footprint, a drag sweeps the snow away down to the red brick paving, and new snow
 * fills both in again.
 */
export class ClockTower extends SnowScene {
  private flakes: Flake[] = [];
  private sweeps: Sweep[] = [];
  private gy = 0;
  private face = { x: 0, y: 0, r: 0 };
  private press: { x: number; y: number } | null = null;
  private sweeping = false;
  private lastSweep: { x: number; y: number } | null = null;
  private swishAt = 0;
  private bg!: HTMLCanvasElement;
  private brick!: HTMLCanvasElement;
  private mask!: HTMLCanvasElement;
  private tmp!: HTMLCanvasElement;
  private brush!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;
  private seeded = false;

  constructor(variant: SceneVariant, opts: SnowOpts = {}) {
    super(variant, opts);
  }

  protected get squash() {
    return 0.5;
  }

  protected get stillCovering() {
    return this.sweeps.length > 0;
  }

  protected bounds() {
    return { x0: 46, x1: this.w - 46, y0: this.gy + 46, y1: this.h - 150 };
  }

  /** Footprints are smaller toward the building. */
  protected scaleAt(y: number) {
    const k = 0.5 + 0.75 * clamp((y - this.gy) / (this.h - this.gy), 0, 1);
    return this.card ? k * 0.6 : k;
  }

  layout() {
    const { w, h, dpr, card } = this;
    // wide screens lower the ground a little so the tower fits under the tabs and the scene switch
    const gy = (this.gy = Math.round(h * (card ? 0.74 : w > 600 ? 0.63 : 0.57)));
    const top = card ? 14 : (this.top ?? 20) + 12;
    const u = card
      ? Math.min((gy - top) / 305, w / 290)
      : clamp(Math.min(w / 390, (gy - top) / 305), 0.45, 1.5);
    // a home card keeps its top-left tag and bottom-left title clear by standing the tower to the right
    const cx = card ? clamp(w * 0.75, 135 * u + 4, w - 135 * u - 4) : w / 2;
    const lamps = [cx - 168 * u, cx + 168 * u];
    this.face = { x: cx, y: gy - 198 * u, r: 21 * u };

    this.bg = layer(w, h, dpr, (x) => {
      const r = rng(41);
      let g = x.createLinearGradient(0, 0, 0, gy);
      g.addColorStop(0, '#050918');
      g.addColorStop(0.55, '#121b3b');
      g.addColorStop(1, '#3a3458');
      x.fillStyle = g;
      x.fillRect(0, 0, w, gy + 4);
      g = x.createRadialGradient(cx, gy, 0, cx, gy, w * 0.9);
      g.addColorStop(0, 'rgba(255,178,124,0.3)');
      g.addColorStop(1, 'rgba(255,178,124,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, gy + 4);
      towerBlocks(x, r, -10, w + 10, gy + 2, 150 * u, 300 * u);
      x.fillStyle = 'rgba(8,12,30,0.42)';
      x.fillRect(0, 0, w, gy + 4);
      this.paintTower(x, cx, gy, u);

      /* the forecourt under snow */
      g = x.createLinearGradient(0, gy, 0, h);
      g.addColorStop(0, '#aab7d6');
      g.addColorStop(0.22, '#dfe7f6');
      g.addColorStop(0.62, '#e9effa');
      g.addColorStop(1, '#b4c1de');
      x.fillStyle = g;
      x.fillRect(0, gy, w, h - gy);
      g = x.createLinearGradient(0, gy, 0, gy + 26);
      g.addColorStop(0, 'rgba(40,52,96,0.4)');
      g.addColorStop(1, 'rgba(40,52,96,0)');
      x.fillStyle = g;
      x.fillRect(0, gy, w, 26);
      for (const lx of lamps) {
        x.save();
        x.translate(lx, gy + 34);
        x.scale(1, 0.3);
        g = x.createRadialGradient(0, 0, 0, 0, 0, 150 * u);
        g.addColorStop(0, 'rgba(255,204,138,0.6)');
        g.addColorStop(1, 'rgba(255,204,138,0)');
        x.fillStyle = g;
        x.beginPath();
        x.arc(0, 0, 150 * u, 0, TAU);
        x.fill();
        x.restore();
      }
      const grains = (5000 * (w * (h - gy))) / (390 * 360);
      for (let i = 0; i < grains; i++) {
        x.fillStyle = r() < 0.6 ? 'rgba(255,255,255,0.12)' : 'rgba(58,78,128,0.07)';
        x.fillRect(r() * w, gy + r() * (h - gy), 1 + r() * 1.4, 1 + r());
      }
      /* trees and street lamps */
      const trees = [treeSprite(52, false), treeSprite(77, false)];
      ([[cx - 196 * u, 0], [cx + 200 * u, 1]] as const).forEach(([tx, i]) => {
        const th = 250 * u;
        const tw = (th * 280) / 340;
        x.drawImage(trees[i], tx - tw / 2, gy + 10 - th, tw, th);
      });
      for (const lx of lamps) {
        x.strokeStyle = '#171927';
        x.lineWidth = 3 * u;
        x.lineCap = 'round';
        x.beginPath();
        x.moveTo(lx, gy + 12);
        x.lineTo(lx, gy - 128 * u);
        x.stroke();
        g = x.createRadialGradient(lx, gy - 132 * u, 0, lx, gy - 132 * u, 62 * u);
        g.addColorStop(0, 'rgba(255,226,172,0.95)');
        g.addColorStop(0.16, 'rgba(255,202,132,0.5)');
        g.addColorStop(1, 'rgba(255,202,132,0)');
        x.fillStyle = g;
        x.beginPath();
        x.arc(lx, gy - 132 * u, 62 * u, 0, TAU);
        x.fill();
        x.fillStyle = '#fff6df';
        x.beginPath();
        x.arc(lx, gy - 132 * u, 6 * u, 0, TAU);
        x.fill();
        x.fillStyle = '#e9effa';
        x.beginPath();
        x.ellipse(lx, gy - 139 * u, 8 * u, 3.4 * u, 0, 0, TAU);
        x.fill();
      }
    });

    /* the red brick paving under the snow, shown where it is swept */
    this.brick = layer(w, h, dpr, (x) => {
      const r = rng(43);
      x.fillStyle = '#2a1614';
      x.fillRect(0, gy, w, h - gy);
      let yy = gy;
      let row = 0;
      while (yy < h) {
        const t = (yy - gy) / (h - gy);
        const bh = 5 + t * 15;
        const bw = bh * 2.5;
        for (let px = -(row % 2) * bw * 0.5 - r() * 2; px < w; px += bw) {
          const tone = r();
          x.fillStyle = tone < 0.34 ? '#7c3a31' : tone < 0.68 ? '#8f4a3a' : '#6a312c';
          x.fillRect(px + 1, yy + 1, bw - 2, bh - 2);
        }
        yy += bh;
        row++;
      }
      let g = x.createLinearGradient(0, gy, 0, h);
      g.addColorStop(0, 'rgba(10,14,40,0.5)');
      g.addColorStop(0.5, 'rgba(10,14,40,0.12)');
      g.addColorStop(1, 'rgba(10,14,40,0.4)');
      x.fillStyle = g;
      x.fillRect(0, gy, w, h - gy);
      for (const lx of lamps) {
        x.save();
        x.translate(lx, gy + 34);
        x.scale(1, 0.3);
        g = x.createRadialGradient(0, 0, 0, 0, 0, 150 * u);
        g.addColorStop(0, 'rgba(255,190,120,0.35)');
        g.addColorStop(1, 'rgba(255,190,120,0)');
        x.fillStyle = g;
        x.beginPath();
        x.arc(0, 0, 150 * u, 0, TAU);
        x.fill();
        x.restore();
      }
    });
    const half = (c: HTMLCanvasElement) => {
      c.width = Math.max(1, Math.round(w / 2));
      c.height = Math.max(1, Math.round(h / 2));
      return c;
    };
    this.mask = half(document.createElement('canvas'));
    this.tmp = half(document.createElement('canvas'));
    this.brush = layer(64, 64, 1, (x) => {
      const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.55, 'rgba(255,255,255,0.85)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, 64, 64);
    });
    this.vig = snowVignette(w, h, dpr, 0.6);
    this.fillFlakes();
    if (!this.seeded) {
      this.seeded = true;
      this.seedTrail(this.card ? 4 : 7);
    }
  }

  /** The clock tower itself, in its own units: 270 wide, 312 tall, standing on (cx, gy). */
  private paintTower(x: CanvasRenderingContext2D, cx: number, gy: number, u: number) {
    x.save();
    x.translate(cx, gy);
    x.scale(u, u);
    const wall = (px: number, py: number, ww: number, hh: number) => {
      const wg = x.createLinearGradient(0, py, 0, py + hh);
      wg.addColorStop(0, '#9aa6c2');
      wg.addColorStop(1, '#c9cfdd');
      x.fillStyle = wg;
      x.fillRect(px, py, ww, hh);
      // white clapboard
      x.strokeStyle = 'rgba(30,40,80,0.13)';
      x.lineWidth = 1;
      x.beginPath();
      for (let yy = py + 4; yy < py + hh; yy += 5) {
        x.moveTo(px, yy);
        x.lineTo(px + ww, yy);
      }
      x.stroke();
    };
    const win = (px: number, py: number, ww: number, hh: number) => {
      x.save();
      x.shadowColor = 'rgba(255,190,110,0.9)';
      x.shadowBlur = 14;
      x.fillStyle = '#ffd08a';
      x.beginPath();
      x.moveTo(px, py + hh);
      x.lineTo(px, py + ww / 2);
      x.arc(px + ww / 2, py + ww / 2, ww / 2, Math.PI, 0);
      x.lineTo(px + ww, py + hh);
      x.closePath();
      x.fill();
      x.restore();
      x.strokeStyle = 'rgba(70,40,30,0.7)';
      x.lineWidth = 1.2;
      x.beginPath();
      x.moveTo(px + ww / 2, py + 2);
      x.lineTo(px + ww / 2, py + hh);
      x.moveTo(px, py + hh * 0.55);
      x.lineTo(px + ww, py + hh * 0.55);
      x.stroke();
    };
    const snowCap = (pts: readonly (readonly [number, number])[]) => {
      x.fillStyle = '#e9effa';
      x.beginPath();
      x.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
      x.closePath();
      x.fill();
    };
    /* the main hall */
    wall(-135, -92, 270, 92);
    x.fillStyle = '#6a2c2e';
    x.beginPath();
    x.moveTo(-146, -92);
    x.lineTo(146, -92);
    x.lineTo(118, -132);
    x.lineTo(-118, -132);
    x.closePath();
    x.fill();
    snowCap([[-141, -98], [141, -98], [118, -136], [-118, -136]]);
    x.fillStyle = 'rgba(160,178,214,0.5)';
    x.fillRect(-141, -99, 282, 3);
    for (const px of [-118, -84, -50, 30, 64, 98]) win(px, -76, 20, 46);
    /* porch */
    wall(-24, -62, 48, 62);
    x.fillStyle = '#6a2c2e';
    x.beginPath();
    x.moveTo(-30, -62);
    x.lineTo(30, -62);
    x.lineTo(0, -84);
    x.closePath();
    x.fill();
    snowCap([[-30, -64], [30, -64], [0, -88]]);
    x.fillStyle = '#35221e';
    x.beginPath();
    addRoundRect(x, -11, -44, 22, 44, 3);
    x.fill();
    x.fillStyle = 'rgba(255,208,138,0.9)';
    x.fillRect(-8, -40, 16, 12);
    /* tower */
    wall(-31, -246, 62, 114);
    x.fillStyle = 'rgba(30,40,80,0.18)';
    x.fillRect(-31, -246, 8, 114);
    x.fillStyle = '#35221e';
    x.fillRect(-9, -162, 18, 22);
    x.strokeStyle = 'rgba(255,255,255,0.25)';
    x.lineWidth = 1;
    x.beginPath();
    for (let yy = -158; yy < -142; yy += 4) {
      x.moveTo(-8, yy);
      x.lineTo(8, yy);
    }
    x.stroke();
    x.fillStyle = '#6a2c2e';
    x.beginPath();
    x.moveTo(-40, -246);
    x.lineTo(40, -246);
    x.lineTo(0, -292);
    x.closePath();
    x.fill();
    snowCap([[-40, -249], [40, -249], [0, -296]]);
    x.strokeStyle = '#2a2430';
    x.lineWidth = 1.6;
    x.beginPath();
    x.moveTo(0, -294);
    x.lineTo(0, -312);
    x.stroke();
    /* the red star */
    x.fillStyle = '#d2463f';
    x.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 ? 2.6 : 6.2;
      x.lineTo(Math.cos(a) * rad, -232 + Math.sin(a) * rad);
    }
    x.closePath();
    x.fill();
    /* clock face (the hands are drawn live) */
    x.save();
    x.shadowColor = 'rgba(255,214,150,0.95)';
    x.shadowBlur = 18;
    x.fillStyle = '#fff3d8';
    x.beginPath();
    x.arc(0, -198, 21, 0, TAU);
    x.fill();
    x.restore();
    x.strokeStyle = '#2a2430';
    x.lineWidth = 2.4;
    x.beginPath();
    x.arc(0, -198, 21, 0, TAU);
    x.stroke();
    x.lineWidth = 1.3;
    x.beginPath();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      x.moveTo(Math.cos(a) * 16, -198 + Math.sin(a) * 16);
      x.lineTo(Math.cos(a) * 19, -198 + Math.sin(a) * 19);
    }
    x.stroke();
    x.restore();
  }

  protected fillFlakes() {
    const want = Math.round((this.fall.flakes * (this.w * this.h)) / (390 * 844));
    while (this.flakes.length < want) this.flakes.push(this.newFlake(true));
    this.flakes.length = want;
  }

  private newFlake(anywhere: boolean): Flake {
    const z = Math.pow(Math.random(), 1.6) * 0.85 + 0.15;
    return { x: rand(-20, this.w + 20), y: anywhere ? rand(-10, this.h) : -10, z, ph: rand(0, TAU) };
  }

  /* ---------- pressing and sweeping ---------- */
  pressStart(x: number, y: number) {
    if (this.card) return false;
    this.press = { x, y };
    this.sweeping = false;
    this.lastSweep = null;
    return y > this.gy + 18;
  }

  pressMove(x: number, y: number) {
    if (!this.press) return false;
    if (!this.sweeping && Math.hypot(x - this.press.x, y - this.press.y) > DRAG_START) {
      this.sweeping = true;
      this.sweepTo(this.press.x, this.press.y);
    }
    if (!this.sweeping) return false;
    this.sweepTo(x, y);
    return true;
  }

  /** Letting go without dragging leaves a footprint on the forecourt. */
  pressEnd(cancel = false) {
    const p = this.press;
    this.press = null;
    if (p && !cancel && !this.sweeping && p.y > this.gy + 18) this.addPrint(p.x, p.y, true);
    this.sweeping = false;
  }

  private sweepTo(x: number, y: number) {
    const y1 = Math.max(y, this.gy + 16);
    const lp = this.lastSweep;
    const dx = lp ? x - lp.x : 0;
    const dy = lp ? y1 - lp.y : 0;
    const dist = Math.hypot(dx, dy);
    const n = lp ? Math.max(1, Math.ceil(dist / 9)) : 1;
    for (let i = 1; i <= n; i++) {
      const px = lp ? lp.x + (dx * i) / n : x;
      const py = lp ? lp.y + (dy * i) / n : y1;
      this.sweeps.push({ x: px, y: py, age: 0, r: 30 * this.scaleAt(py) });
    }
    if (this.sweeps.length > MAX_SWEEPS) this.sweeps.splice(0, this.sweeps.length - MAX_SWEEPS);
    if (dist > 3) {
      // snow flies the way the broom goes
      const sc = this.scaleAt(y1);
      for (let i = 0; i < 2; i++) {
        this.puffs.push({
          x: x + rand(-8, 8), y: y1 + rand(-4, 4),
          vx: (dx / dist) * rand(60, 150) * sc + rand(-20, 20), vy: (dy / dist) * rand(30, 70) * sc - rand(10, 50),
          t: 0, dur: rand(0.35, 0.7), r: rand(1.2, 3) * sc,
        });
      }
      if (this.t - this.swishAt > 0.17) {
        this.swishAt = this.t;
        this.emit('sweep', { x: clamp(x / this.w, 0, 1) });
      }
    }
    this.lastSweep = { x, y: y1 };
  }

  /* ---------- time ---------- */
  step(dt: number) {
    this.t += dt;
    this.stepPrints(dt);
    // swept ground stays a little longer than a footprint
    const cover = this.flush ? 1.1 : this.fall.cover * 1.6;
    if (this.flush || this.covering) for (const s of this.sweeps) s.age += dt / cover;
    if (this.sweeps.length && this.sweeps[0].age >= 1) this.sweeps = this.sweeps.filter((s) => s.age < 1);
    const sp = (0.6 + this.fall.v * 0.7) * this.motion;
    const { w, h } = this;
    for (const f of this.flakes) {
      f.y += (26 + f.z * 80) * sp * dt;
      f.x += (Math.sin(this.t * (0.6 + f.z) + f.ph) * 14 - 10 * f.z) * dt * this.motion;
      if (f.y > h + 6) Object.assign(f, this.newFlake(false));
      if (f.x < -24) f.x = w + 20;
    }
  }

  draw(x: CanvasRenderingContext2D) {
    const { w, h } = this;
    x.drawImage(this.bg, 0, 0, w, h);
    /* the hands show the time now */
    const now = new Date();
    const f = this.face;
    const ha = (((now.getHours() % 12) + now.getMinutes() / 60) / 12) * TAU - Math.PI / 2;
    const ma = (now.getMinutes() / 60) * TAU - Math.PI / 2;
    x.strokeStyle = '#2a2430';
    x.lineCap = 'round';
    x.lineWidth = f.r * 0.13;
    x.beginPath();
    x.moveTo(f.x, f.y);
    x.lineTo(f.x + Math.cos(ha) * f.r * 0.5, f.y + Math.sin(ha) * f.r * 0.5);
    x.stroke();
    x.lineWidth = f.r * 0.09;
    x.beginPath();
    x.moveTo(f.x, f.y);
    x.lineTo(f.x + Math.cos(ma) * f.r * 0.76, f.y + Math.sin(ma) * f.r * 0.76);
    x.stroke();
    /* swept patches: the brick shows through, with a soft rim of pushed snow */
    if (this.sweeps.length) {
      const m = this.mask.getContext('2d')!;
      const t = this.tmp.getContext('2d')!;
      const mw = this.mask.width;
      const mh = this.mask.height;
      const kx = mw / w;
      const ky = mh / h;
      m.clearRect(0, 0, mw, mh);
      for (const s of this.sweeps) {
        m.globalAlpha = clamp((1 - s.age) * 1.6, 0, 1) * 0.5;
        const rx = s.r * kx;
        const ry = s.r * 0.5 * ky;
        m.drawImage(this.brush, s.x * kx - rx, s.y * ky - ry, rx * 2, ry * 2);
      }
      m.globalAlpha = 1;
      t.globalCompositeOperation = 'source-over';
      t.clearRect(0, 0, mw, mh);
      t.drawImage(this.mask, 0, 0);
      t.globalCompositeOperation = 'source-in';
      t.drawImage(this.brick, 0, 0, mw, mh);
      x.globalAlpha = 0.5;
      x.drawImage(this.mask, 0, -3, w, h);
      x.globalAlpha = 1;
      x.drawImage(this.tmp, 0, 0, w, h);
    }
    this.drawPrints(x);
    this.drawPuffs(x);
    x.fillStyle = '#fff';
    for (const fl of this.flakes) {
      x.globalAlpha = 0.3 + fl.z * 0.65;
      x.beginPath();
      x.arc(fl.x, fl.y, (0.6 + fl.z * 2.3) * (this.card ? 0.8 : 1), 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
    x.drawImage(this.vig, 0, 0, w, h);
  }
}
