import { Scene, type SceneVariant } from './base';
import { TAU, clamp, rand } from './util';

/*
 * 눈멍 (홋카이도의 겨울): the parts its two scenes share (나무 · 발밑) — how hard it snows, footprints that new snow
 * slowly fills, the puffs of snow a step kicks up, and 새 눈 (fresh snow over everything at once).
 */

export interface FallLevel { v: number; label: string; flakes: number; cover: number }

/** 가루눈 · 눈 · 함박눈: flakes on a 390 × 844 screen, and seconds until new snow has filled a footprint. */
export const SNOW_FALLS: readonly FallLevel[] = [
  { v: 0.3, label: '가루눈', flakes: 60, cover: 150 },
  { v: 0.6, label: '눈', flakes: 130, cover: 80 },
  { v: 1, label: '함박눈', flakes: 240, cover: 40 },
];

export const fallOf = (v: number) =>
  SNOW_FALLS.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));

interface Print {
  x: number;
  y: number;
  ang: number;
  /** seconds since it was pressed (it sinks in over the first moment) */
  life: number;
  /** 0 fresh … 1 filled with new snow */
  age: number;
  sc: number;
  /** how much the ground is squashed vertically (seen at a slant) */
  sq: number;
  /** crumbs of snow pushed out around it */
  cr: [number, number, number][];
}

interface Puff { x: number; y: number; vx: number; vy: number; t: number; dur: number; r: number }

interface Walker { x: number; y: number; ang: number }

export interface SnowOpts {
  fall?: number;
  /** new snow fills footprints; off: they stay */
  cover?: boolean;
}

const MAX_PRINTS = 70;
const ease = (x: number) => x * x * (3 - 2 * x);

/** A rounded rectangle added to the current path (several can share one path, unlike util.roundRect). */
export function addRoundRect(x: CanvasRenderingContext2D, px: number, py: number, w: number, h: number, r: number) {
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

/** Colours (`r,g,b`) of a footprint's shade, its darkest dents and the shadows under its crumbs. */
export interface PrintTint { shade: string; dark: string; crumb: string }

/** Night snow under a street lamp (발밑). 나무 tints its prints to the sky. */
const NIGHT_TINT: PrintTint = { shade: '52,70,116', dark: '16,24,60', crumb: '60,78,122' };

/** Sole and heel of a boot, toe toward -y. */
function solePath(x: CanvasRenderingContext2D) {
  x.beginPath();
  addRoundRect(x, -11, -27, 22, 33, 11);
  addRoundRect(x, -9, 9, 18, 17, 8);
}

/** A boot print pressed into snow: the hollow, its lit far rim, the tread, crumbs around it. */
function drawPrint(x: CanvasRenderingContext2D, p: Print, tint: PrintTint) {
  const a = 1 - Math.pow(clamp(p.age, 0, 1), 1.6);
  if (a <= 0) return;
  const k = ease(clamp(p.life / 0.16, 0, 1));
  const s = p.sc;
  const place = (dy: number) => {
    x.save();
    x.translate(p.x, p.y + dy);
    x.scale(1, p.sq);
    x.rotate(p.ang + Math.PI / 2);
    x.scale(s, s);
  };
  place(2.8 * s);
  solePath(x);
  x.fillStyle = `rgba(255,255,255,${0.72 * a * k})`;
  x.fill();
  x.restore();
  place(0);
  solePath(x);
  x.fillStyle = `rgba(${tint.shade},${0.62 * a * k})`;
  x.fill();
  x.clip();
  x.strokeStyle = `rgba(226,236,252,${0.17 * a * k})`;
  x.lineWidth = 1.7;
  x.beginPath();
  for (let y = -23; y <= 24; y += 5) {
    x.moveTo(-12, y);
    x.lineTo(12, y - 2);
  }
  x.stroke();
  x.fillStyle = `rgba(${tint.dark},${0.3 * a * k})`;
  x.fillRect(-12, -29, 24, 7);
  x.fillRect(-12, 8, 24, 5);
  x.restore();
  for (const c of p.cr) {
    x.fillStyle = `rgba(${tint.crumb},${0.3 * a * k})`;
    x.beginPath();
    x.arc(p.x + c[0], p.y + c[1] * p.sq + 1.4, c[2], 0, TAU);
    x.fill();
    x.fillStyle = `rgba(255,255,255,${0.9 * a * k})`;
    x.beginPath();
    x.arc(p.x + c[0], p.y + c[1] * p.sq, c[2], 0, TAU);
    x.fill();
  }
}

/** A dark blue vignette: snow at night stays bluish at the edges instead of going grey. */
export function snowVignette(w: number, h: number, dpr: number, strength: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const x = c.getContext('2d')!;
  x.scale(dpr, dpr);
  const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.78);
  g.addColorStop(0, 'rgba(6,10,26,0)');
  g.addColorStop(1, `rgba(6,10,26,${strength})`);
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  return c;
}

/**
 * Base for 나무 and 발밑. A press leaves a boot print (left and right feet take turns, toes
 * pointing the way you walk), snow puffs out around it, and falling snow fills it in again.
 */
export abstract class SnowScene extends Scene {
  fall: FallLevel;
  covering: boolean;
  /** footprints pressed by hand (the trail someone left before does not count) */
  steps = 0;
  protected prints: Print[] = [];
  protected puffs: Puff[] = [];
  protected flush = false;
  protected readonly card: boolean;
  /** bottom edge (CSS px) of the controls at the top of the screen, if any */
  protected top: number | null = null;
  private side = 1;
  /** the last print pressed, so the next one points the way you walk */
  protected last: { x: number; y: number; ang: number; t: number } | null = null;

  constructor(variant: SceneVariant, opts: SnowOpts = {}) {
    super(variant);
    this.fall = fallOf(opts.fall ?? 0.6);
    this.covering = opts.cover ?? true;
    this.card = variant === 'card';
  }

  setFall(v: number) {
    this.fall = fallOf(v);
    this.fillFlakes();
  }

  setCover(on: boolean) {
    this.covering = on;
  }

  /** 새 눈: snow covers every footprint within a second. */
  fresh() {
    this.flush = true;
    this.emit('fresh');
  }

  /** Bottom edge (CSS px) of the tabs and scene switch, so the scenery fits below them. `null`: none. */
  setEdges(top: number | null) {
    const t = top === null ? null : Math.round(top);
    if (t === this.top || (t !== null && this.top !== null && Math.abs(t - this.top) < 2)) return;
    this.top = t;
    if (this.w) this.layout();
  }

  audioState() {
    return { fall: this.fall.v };
  }

  /** A press on the scene. True when it did something (a footprint, shaking the tree). */
  abstract pressStart(x: number, y: number): boolean;
  /** Dragging. True when something new happened (to keep the controls awake). */
  abstract pressMove(x: number, y: number): boolean;
  /** Letting go. `cancel`: the touch was taken away (scrolling, a system gesture), so nothing is left behind. */
  abstract pressEnd(cancel?: boolean): void;

  protected abstract fillFlakes(): void;
  /** Where a remembered walk may wander. */
  protected abstract bounds(): { x0: number; x1: number; y0: number; y1: number };
  /** Footprint size at this height on the screen. */
  protected abstract scaleAt(y: number): number;
  /** Vertical squash of the ground (1: seen from above). */
  protected abstract get squash(): number;
  /** Anything else new snow still has to cover before 새 눈 is done. */
  protected get stillCovering() {
    return false;
  }
  protected puff(x: number, y: number, n: number, spread: number, up: boolean) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      const v = rand(20, 70) * spread;
      this.puffs.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * (up ? 0.5 : 1) - (up ? rand(20, 60) : 0),
        t: 0, dur: rand(0.35, 0.7), r: rand(1.2, 3),
      });
    }
  }

  /** One boot print. `byHand`: counted, heard, and it kicks up snow. */
  protected addPrint(x: number, y: number, byHand: boolean) {
    const sc = this.scaleAt(y);
    const sq = this.squash;
    let ang = this.last ? this.last.ang : -Math.PI / 2;
    if (this.last) {
      const dx = x - this.last.x;
      const dy = (y - this.last.y) / sq;
      const dist = Math.hypot(dx, dy);
      if (dist > 8 && dist < 230 * sc && this.t - this.last.t < 3) ang = Math.atan2(dy, dx);
    }
    this.side = -this.side;
    const off = 12 * sc * this.side;
    const px = x + Math.cos(ang + Math.PI / 2) * off;
    const py = y + Math.sin(ang + Math.PI / 2) * off * sq;
    const cr: [number, number, number][] = [];
    for (let i = 0; i < 9; i++) {
      const a = rand(0, TAU);
      const rad = rand(26, 40) * sc;
      cr.push([Math.cos(a) * rad * 0.7, Math.sin(a) * rad, rand(0.8, 2.1) * sc]);
    }
    this.prints.push({ x: px, y: py, ang, life: 0, age: 0, sc, sq, cr });
    if (this.prints.length > MAX_PRINTS) this.prints.shift();
    this.last = { x, y, ang, t: this.t };
    if (!byHand) return;
    this.steps++;
    this.stat('steps', this.steps);
    this.puff(px, py, 9, sc, false);
    this.emit('step', { x: clamp(x / this.w, 0, 1) });
  }

  /** Someone walked here a while ago: a trail already half filled with snow. */
  protected seedTrail(n: number) {
    const b = this.bounds();
    const wk: Walker = { x: rand(b.x0 + 30, b.x1 - 30), y: (b.y0 + b.y1) / 2 + rand(-20, 60), ang: rand(-2.2, -0.9) };
    const cx = (b.x0 + b.x1) / 2;
    const cy = (b.y0 + b.y1) / 2;
    for (let i = 0; i < n; i++) {
      wk.ang += rand(-0.42, 0.42);
      if (wk.x < b.x0 || wk.x > b.x1 || wk.y < b.y0 || wk.y > b.y1) {
        let df = Math.atan2(cy - wk.y, cx - wk.x) - wk.ang;
        while (df > Math.PI) df -= TAU;
        while (df < -Math.PI) df += TAU;
        wk.ang += df * 0.9;
      }
      const sc = this.scaleAt(wk.y);
      wk.x += Math.cos(wk.ang) * 64 * sc;
      wk.y += Math.sin(wk.ang) * 64 * sc * this.squash;
      this.addPrint(wk.x, wk.y, false);
      const p = this.prints[this.prints.length - 1];
      p.life = 1;
      p.age = clamp(0.78 - (i / n) * 0.8, 0, 1);
    }
    this.last = null;
  }

  /** Footprints sink in, then new snow fills them (unless covering is off); puffs settle. */
  protected stepPrints(dt: number) {
    const cover = this.flush ? 1.1 : this.fall.cover;
    const fill = this.flush || this.covering;
    for (const p of this.prints) {
      p.life += dt;
      if (fill) p.age += dt / cover;
    }
    if (this.prints.length && this.prints.some((p) => p.age >= 1)) this.prints = this.prints.filter((p) => p.age < 1);
    if (this.flush && !this.prints.length && !this.stillCovering) this.flush = false;
    for (const p of this.puffs) {
      p.t += dt / p.dur;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy = p.vy * 0.94 + 60 * dt;
    }
    if (this.puffs.length) this.puffs = this.puffs.filter((p) => p.t < 1);
  }

  protected drawPrints(x: CanvasRenderingContext2D, tint: PrintTint = NIGHT_TINT) {
    for (const p of this.prints) drawPrint(x, p, tint);
  }

  protected drawPuffs(x: CanvasRenderingContext2D) {
    x.fillStyle = '#fff';
    for (const p of this.puffs) {
      x.globalAlpha = (1 - p.t) * 0.85;
      x.beginPath();
      x.arc(p.x, p.y, p.r * (1 + p.t), 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
  }
}
