import { Scene, type SceneVariant } from './base';
import { TAU, clamp, glow, layer, newSeed, pick, rand, rng, smooth, soft, vignette, wrapAngle } from './util';

interface Ripple { x: number; y: number; age: number; max: number; power: number }
interface Pt { x: number; y: number; p: number; z: number }
interface Leaf { x: number; y: number; a: number; va: number; vx: number; vy: number; len: number; color: string }
interface Pad { fx: number; fy: number; r: number; flower: boolean; a: number; p: number }
interface Strider { x: number; y: number; a: number; rest: number; hop: number }
interface Mark { i: number; off: number; r: number; c: string }
interface Food { x: number; y: number; age: number; p: number; eaten: boolean }
interface Flake { x: number; y: number; vx: number; vy: number; age: number; life: number; r: number }
interface Koi {
  x: number; y: number; a: number; turn: number; vis: number; boost: number; flee: number | null; phase: number;
  len: number; base: number; color: string; marks: Mark[];
}

const KOI: readonly { base: string; marks: readonly string[] }[] = [
  { base: '#f3eee4', marks: ['#e0442a'] }, // 홍백
  { base: '#f0902a', marks: ['#ffc56a'] },
  { base: '#f3eee4', marks: ['#e0442a', '#1d1d22'] }, // 삼색
  { base: '#f1cd58', marks: ['#fff0b8'] },
  { base: '#27272c', marks: ['#eee8dc'] },
  { base: '#f3eee4', marks: ['#f0902a'] },
  { base: '#e9572f', marks: ['#f3eee4'] },
];
export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export const SEASONS: readonly { id: Season; label: string }[] = [
  { id: 'spring', label: '봄' },
  { id: 'summer', label: '여름' },
  { id: 'autumn', label: '가을' },
  { id: 'winter', label: '겨울' },
];
/** The season outside right now (northern hemisphere). */
export const seasonNow = (): Season => (['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'] as const)[new Date().getMonth()];

interface Look {
  water: readonly [string, string, string];
  /** what hangs on the branch: blossoms, maple leaves, or nothing but snow */
  branch: 'blossom' | 'maple' | 'bare';
  foliage: readonly string[];
  /** what floats on the water */
  drift: readonly string[];
  driftLen: readonly [number, number];
  grass: readonly string[];
  pads: number; // size of the lily pads, 0 = none
  flowers: boolean;
  striders: boolean;
  snow: boolean;
  sparkle: number;
  /** koi are sluggish in cold water */
  pace: number;
}
const LOOKS: Record<Season, Look> = {
  spring: {
    water: ['#3f957f', '#19655c', '#0a3c39'], branch: 'blossom', foliage: ['#f6c1d0', '#f9d7e0', '#fbe6ec', '#f3a9c0'],
    drift: ['#f9d2dd', '#f6bfd0', '#fde6ec', '#f9d2dd', '#f3aac1', '#fde6ec', '#f6bfd0'], driftLen: [8, 12],
    grass: ['#8fd06a', '#6fbf58', '#a6dc7c', '#58a84a'], pads: 0.78, flowers: false, striders: true, snow: false, sparkle: 1, pace: 1,
  },
  summer: {
    water: ['#2c8a68', '#10604c', '#063a2e'], branch: 'maple', foliage: ['#3f9a4a', '#57b25a', '#2f7f3c', '#74c268', '#4aa652'],
    drift: ['#5fae4c', '#8fbf4a'], driftLen: [18, 24],
    grass: ['#5fae4c', '#3f8a3c', '#7cc05a', '#2f6f34'], pads: 1.08, flowers: true, striders: true, snow: false, sparkle: 1.15, pace: 1.1,
  },
  autumn: {
    water: ['#2f8272', '#12514d', '#07302f'], branch: 'maple', foliage: ['#c7452c', '#e0702e', '#e59a34', '#b8362a', '#d4572c', '#8fa040'],
    drift: ['#c98a2e', '#b65a2a', '#d4572c', '#a8a84a', '#e0702e'], driftLen: [20, 28],
    grass: ['#8aa84a', '#6f8f3c', '#b0a850', '#55772f'], pads: 1, flowers: true, striders: true, snow: false, sparkle: 1, pace: 1,
  },
  winter: {
    water: ['#3d6c7c', '#1d4657', '#0c2a38'], branch: 'bare', foliage: ['#f2f6f8', '#e2eaef', '#ffffff'],
    drift: [], driftLen: [0, 0],
    grass: ['#b9a878', '#9c8c62', '#c9bb90', '#857650'], pads: 0, flowers: false, striders: false, snow: true, sparkle: 0.5, pace: 0.55,
  },
};

/** Half-width of a koi along its spine, head to tail. */
const PROFILE = [0.3, 0.74, 0.95, 1, 0.96, 0.86, 0.7, 0.5, 0.32, 0.18, 0.1];
const RIPPLE_SPEED = 42;

/**
 * 물멍 · 연못: a pond at midday, seen from a seat on the stones at its edge. Koi drift under the surface;
 * tap the water and ripples spread, and the koi nearby dart away.
 */
export class Pond extends Scene {
  drizzle: boolean;
  season: Season;
  private food: Food[] = [];
  private flakes: Flake[] = [];
  private flakeAcc = 0;
  private readonly seed = newSeed();
  private floor: number | null = null;
  private bankY = 0;
  private bankAt: (x: number) => number = () => 0;
  private ripples: Ripple[] = [];
  private next = 0.4;
  private pts: Pt[] = [];
  private koi: Koi[] = [];
  private leaves: Leaf[] | null = null;
  private pads: Pad[] | null = null;
  private striders: Strider[] = [];
  private statTimer = 0;
  private readonly spark = glow(255, 240, 200, 0.2);
  private bg!: HTMLCanvasElement;
  private front!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;

  constructor(variant: SceneVariant, opts: { drizzle?: boolean; season?: Season } = {}) {
    super(variant);
    this.drizzle = opts.drizzle ?? false;
    this.season = opts.season ?? seasonNow();
  }

  setSeason(season: Season) {
    if (season === this.season) return;
    this.season = season;
    this.leaves = null; // what floats on the water changes with the season
    this.flakes = [];
    if (this.w) this.layout();
  }

  /** Scatter a pinch of pellets on the water; the koi come up for them. */
  feed() {
    const s = this.s;
    const cx = rand(0.3, 0.7) * this.w;
    const cy = rand(0.35, 0.6) * this.bankY;
    for (let i = 0; i < 9; i++) {
      const a = rand(0, TAU);
      const d = rand(0, 46) * s;
      this.food.push({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d, age: -i * 0.04, p: rand(0, TAU), eaten: false });
    }
    this.ripples.push({ x: cx, y: cy, age: 0, max: 1.6, power: 0.45 });
    this.emit('feed', { x: cx / this.w });
  }

  setDrizzle(on: boolean) {
    this.drizzle = on;
    this.next = 0;
  }

  audioState() {
    return { drizzle: this.drizzle ? 1 : 0 };
  }

  get koiCount() {
    return this.koi.length;
  }

  /** Top edge (CSS px) of the controls resting on the bank's stones. `null`: none, the bank is just a thin rim. */
  setEdges(_top: number | null, floor: number | null) {
    const f = floor === null ? null : Math.round(floor);
    if (f === null || this.floor === null ? f === this.floor : Math.abs(f - this.floor) < 2) return;
    this.floor = f;
    if (this.w) this.layout();
  }

  layout() {
    const { w, h, dpr } = this;
    const R = rng(this.seed);
    const rr = (a: number, b: number) => a + R() * (b - a);
    const rp = <T>(list: readonly T[]): T => list[Math.floor(R() * list.length)];
    const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.25));
    const wide = w > 900;
    const card = this.variant === 'card';
    const seated = !card && this.floor !== null && this.floor > h * 0.55;
    const bankY = (this.bankY = seated ? (this.floor as number) - 56 : h - Math.min(70 * s, h * 0.16));
    const bankAt = (this.bankAt = (x: number) => bankY + (Math.sin(x * 0.013 + 0.6) * 10 + Math.sin(x * 0.034 + 2) * 5) * s);
    const dark = glow(0, 20, 18, 0.4);
    const look = LOOKS[this.season];

    this.bg = layer(w, h, dpr, (x) => {
      let g: CanvasGradient = x.createRadialGradient(w * 0.45, h * 0.32, 0, w * 0.45, h * 0.32, Math.hypot(w, h) * 0.75);
      g.addColorStop(0, look.water[0]);
      g.addColorStop(0.5, look.water[1]);
      g.addColorStop(1, look.water[2]);
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      for (let i = 0; i < 6; i++) soft(x, dark, rr(0, w), rr(0, bankY), rr(90, 200) * s, rr(70, 150) * s, 0.4);
      /* the shallows by the bank: pebbles on the bed show through */
      for (let i = 0; i < Math.round(w / 3.2); i++) {
        const px = rr(0, w);
        const d = rr(0, 1);
        const py = bankAt(px) - d * d * 120 * s;
        x.globalAlpha = (1 - d) * 0.5;
        x.fillStyle = rp(['#93a086', '#6f8270', '#a9a98c', '#587062', '#7d8a7c']);
        x.beginPath();
        x.ellipse(px, py, rr(5, 13) * s, rr(4, 9) * s, rr(0, 3), 0, TAU);
        x.fill();
      }
      x.globalAlpha = 1;
      g = x.createLinearGradient(0, bankY - 130 * s, 0, bankY + 10 * s);
      g.addColorStop(0, 'rgba(150,196,150,0)');
      g.addColorStop(1, 'rgba(150,196,150,0.24)');
      x.fillStyle = g;
      x.fillRect(0, bankY - 130 * s, w, 160 * s);
      /* shade under the branch; a bare winter branch casts little */
      for (let i = 0; i < (look.branch === 'bare' ? 12 : wide ? 70 : 44); i++) {
        const k = R();
        soft(x, dark, w * (1 - k * (wide ? 0.42 : 0.6)) + rr(-40, 40) * s, h * (0.03 + k * 0.2) + rr(-34, 50) * s, rr(16, 40) * s, rr(12, 30) * s, 0.42);
      }
    });

    /* in front: the bank's stones, moss and grass, and a maple branch reaching in from above */
    this.front = layer(w, h, dpr, (x) => {
      let g: CanvasGradient;
      const edgePath = (off: number) => {
        x.beginPath();
        x.moveTo(0, h);
        for (let px = 0; px <= w + 8; px += 8) x.lineTo(px, bankAt(px) + off);
        x.lineTo(w + 8, h);
        x.closePath();
      };
      if (look.snow) { // a rim of thin ice along the bank
        x.fillStyle = 'rgba(224,240,248,0.2)';
        edgePath(-24 * s);
        x.fill();
        x.fillStyle = 'rgba(236,246,252,0.26)';
        edgePath(-13 * s);
        x.fill();
      }
      x.fillStyle = 'rgba(2,18,14,0.5)'; // the stones' shade on the water
      edgePath(-7 * s);
      x.fill();
      g = x.createLinearGradient(0, bankY, 0, h);
      g.addColorStop(0, '#1a2317');
      g.addColorStop(1, '#0a0d09');
      x.fillStyle = g;
      edgePath(6 * s);
      x.fill();
      const shine = glow(255, 255, 240, 0.4);
      const stone = (cx: number, cy: number, rx: number, ry: number, tone: readonly [string, string], moss: boolean) => {
        const n = 10;
        const pts: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const a = (i / n) * TAU;
          const j = rr(0.82, 1.1);
          pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]);
        }
        const path = (ox: number, oy: number) => {
          x.beginPath();
          x.moveTo((pts[n - 1][0] + pts[0][0]) / 2 + ox, (pts[n - 1][1] + pts[0][1]) / 2 + oy);
          for (let i = 0; i < n; i++) {
            const p = pts[i];
            const q = pts[(i + 1) % n];
            x.quadraticCurveTo(p[0] + ox, p[1] + oy, (p[0] + q[0]) / 2 + ox, (p[1] + q[1]) / 2 + oy);
          }
          x.closePath();
        };
        x.fillStyle = 'rgba(0,8,6,0.5)';
        path(4 * s, 7 * s);
        x.fill();
        g = x.createLinearGradient(cx - rx, cy - ry, cx + rx * 0.6, cy + ry);
        g.addColorStop(0, tone[0]);
        g.addColorStop(1, tone[1]);
        x.fillStyle = g;
        path(0, 0);
        x.fill();
        x.save();
        x.clip();
        soft(x, shine, cx - rx * 0.35, cy - ry * 0.4, rx * 0.7, ry * 0.6, 0.22);
        for (let i = 0; i < rx * ry * 0.03; i++) {
          x.fillStyle = R() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.14)';
          x.fillRect(cx + rr(-1, 1) * rx, cy + rr(-1, 1) * ry, rr(1, 2.4) * s, rr(1, 2) * s);
        }
        if (moss) {
          for (let i = 0; i < 16; i++) {
            x.fillStyle = look.snow ? rp(['#f2f6f8', '#e2eaef', '#ffffff', '#d5e0e8']) : rp(['#4f8a42', '#3c7438', '#6aa04c', '#2f5f30']);
            x.beginPath();
            x.arc(cx + rx * (0.25 + rr(-0.4, 0.5)), cy + ry * (0.3 + rr(-0.4, 0.5)), rr(4, 10) * s, 0, TAU);
            x.fill();
          }
        }
        x.restore();
      };
      const tones: readonly (readonly [string, string])[] = [['#b4b6aa', '#5a5e56'], ['#a39f90', '#4c4a43'], ['#929995', '#444b49'], ['#bdb6a2', '#63604f']];
      const rows = Math.max(0, Math.min(5, Math.ceil((h - bankY) / (56 * s)) - 1));
      for (let row = rows; row >= 0; row--) {
        for (let px = -30 * s + row * 23 * s; px < w + 40 * s;) {
          const rx = rr(34, 60) * s * (1 + row * 0.12);
          const ry = rr(22, 32) * s * (1 + row * 0.12);
          stone(px + rx, bankAt(px + rx) + (22 + row * 56) * s + rr(-6, 6) * s, rx, ry, rp(tones), R() < (look.snow ? 0.75 : 0.4));
          px += rx * 1.85;
        }
      }
      g = x.createLinearGradient(0, bankY + 30 * s, 0, h); // darker where the controls rest
      g.addColorStop(0, 'rgba(4,8,6,0)');
      g.addColorStop(0.45, 'rgba(4,8,6,0.5)');
      g.addColorStop(1, 'rgba(4,8,6,0.78)');
      x.fillStyle = g;
      x.fillRect(0, bankY + 30 * s, w, h - bankY);
      /* tufts of grass leaning over the water; first their shadows, then the blades */
      const tufts = wide ? [0.05, 0.21, 0.36, 0.55, 0.7, 0.86, 0.97] : [0.04, 0.3, 0.63, 0.93];
      for (const pass of [0, 1]) {
        tufts.forEach((fx, ti) => {
          for (let i = 0; i < 13; i++) {
            const sx = Math.sin(ti * 91.7 + i * 17.3);
            const sy = Math.sin(ti * 37.1 + i * 53.9);
            const bx = w * fx + sx * 16 * s;
            const by = bankAt(bx) + (10 + sy * 6) * s;
            const len = (46 + 34 * Math.sin(i * 2.3 + ti)) * s;
            const lean = sx * 0.6;
            const tx = bx + Math.sin(lean) * len + (pass ? 0 : 5 * s);
            const ty = by - Math.cos(lean) * len * 0.9 + (pass ? 0 : 8 * s);
            x.strokeStyle = pass ? look.grass[i % 4] : 'rgba(0,14,10,0.3)';
            x.lineWidth = (1.6 + (i % 3) * 0.5) * s;
            x.lineCap = 'round';
            x.beginPath();
            x.moveTo(bx + (pass ? 0 : 3 * s), by + (pass ? 0 : 4 * s));
            x.quadraticCurveTo(bx + Math.sin(lean) * len * 0.2, by - len * 0.6, tx, ty);
            x.stroke();
          }
        });
      }
      /* the maple branch */
      const leaves: [number, number, number, number][] = [];
      const twig = (x0: number, y0: number, x1: number, y1: number, wd: number, depth: number) => {
        const mx = (x0 + x1) / 2 + rr(-18, 18) * s;
        const my = (y0 + y1) / 2 + rr(-12, 12) * s;
        x.strokeStyle = '#3a2a22';
        x.lineWidth = wd;
        x.lineCap = 'round';
        x.beginPath();
        x.moveTo(x0, y0);
        x.quadraticCurveTo(mx, my, x1, y1);
        x.stroke();
        const n = depth ? 7 : 4;
        for (let i = 1; i <= n; i++) {
          const k = i / n;
          const lp = (a: number, b: number) => a + (b - a) * k;
          const px = lp(lp(x0, mx), lp(mx, x1));
          const py = lp(lp(y0, my), lp(my, y1));
          if (depth < 2 && k > 0.2 && (depth === 0 || R() < 0.4)) {
            twig(px, py, px + rr(-90, 20) * s, py + rr(20, 100) * s * (R() < 0.5 ? 1 : -0.4), wd * 0.5, depth + 1);
          }
          for (let j = 0; j < (depth ? 2 : 1); j++) leaves.push([px + rr(-16, 16) * s, py + rr(-14, 16) * s, rr(8, 14) * s, rr(0, TAU)]);
        }
      };
      twig(w + 10, -14 * s, w * (wide ? 0.7 : 0.6), h * (wide ? 0.2 : 0.16), 7 * s, 0);
      const leaf = (lx: number, ly: number, r: number, a: number, col: string) => {
        x.save();
        x.translate(lx, ly);
        x.rotate(a);
        x.fillStyle = col;
        x.beginPath();
        if (look.branch === 'bare') { // a lump of snow on the twig
          x.ellipse(0, 0, r * 0.7, r * 0.42, 0, 0, TAU);
          x.fill();
          x.restore();
          return;
        }
        if (look.branch === 'blossom') { // five round petals
          for (let i = 0; i < 5; i++) {
            const ang = (i / 5) * TAU;
            x.moveTo(Math.cos(ang) * r * 0.45 + r * 0.42, Math.sin(ang) * r * 0.45);
            x.arc(Math.cos(ang) * r * 0.45, Math.sin(ang) * r * 0.45, r * 0.42, 0, TAU);
          }
          x.fill();
          if (col.startsWith('#')) {
            x.fillStyle = '#e9809c';
            x.beginPath();
            x.arc(0, 0, r * 0.16, 0, TAU);
            x.fill();
          }
          x.restore();
          return;
        }
        for (let i = 0; i < 14; i++) {
          const ang = (i / 14) * TAU;
          const rad = i % 2 === 0 ? r * (i === 0 ? 1.15 : i === 7 ? 0.5 : 0.95) : r * 0.36;
          x.lineTo(Math.cos(ang) * rad, Math.sin(ang) * rad);
        }
        x.closePath();
        x.fill();
        x.restore();
      };
      for (const [lx, ly, r, a] of leaves) leaf(lx + 9 * s, ly + 14 * s, r, a, 'rgba(0,14,10,0.2)');
      for (const [lx, ly, r, a] of leaves) leaf(lx, ly, r, a, rp(look.foliage));
    });

    const n = clamp(Math.round(((w * h) / 420) * this.motion), 200, 2600);
    this.pts = Array.from({ length: n }, () => ({ x: rr(0, w), y: rr(0, bankY), p: rr(0, TAU), z: rr(0.6, 1.4) }));
    this.vig = vignette(w, h, dpr, 0.5);
    if (!this.pads) {
      const list: [number, number, number, boolean][] = wide
        ? [[0.12, 0.3, 40, true], [0.19, 0.2, 28, false], [0.07, 0.48, 26, false], [0.2, 0.44, 20, false], [0.82, 0.66, 38, false], [0.9, 0.52, 28, true], [0.74, 0.76, 24, false], [0.5, 0.2, 22, false]]
        : [[0.2, 0.33, 36, true], [0.37, 0.27, 24, false], [0.1, 0.45, 24, false], [0.76, 0.7, 34, false], [0.9, 0.8, 24, true], [0.64, 0.82, 20, false], [0.86, 0.58, 17, false]];
      this.pads = list.map(([fx, fy, r, flower]) => ({ fx, fy, r, flower, a: rand(0, TAU), p: rand(0, TAU) }));
    }
    if (!this.leaves) {
      this.leaves = look.drift.slice(0, wide ? 7 : look.branch === 'blossom' ? 6 : 3).map((color) => ({
        x: rand(0.15, 0.85) * w, y: rand(0.3, 0.8) * bankY, a: rand(0, TAU), va: rand(-0.08, 0.08),
        vx: rand(-5, 5) * s, vy: rand(-3, 3) * s, len: rand(look.driftLen[0], look.driftLen[1]) * s, color,
      }));
    }
    if (!this.koi.length) {
      this.striders = card ? [] : [0, 1].map(() => ({ x: rand(0.2, 0.8) * w, y: rand(0.3, 0.8) * bankY, a: rand(0, TAU), rest: rand(0.5, 2), hop: 0 }));
      for (let i = 0; i < (card ? 3 : wide ? 7 : 5); i++) {
        const spec = KOI[i % KOI.length];
        this.koi.push({
          x: rand(0.2, 0.8) * w, y: rand(0.3, 0.75) * bankY, a: rand(0, TAU), turn: 0, vis: 0, boost: 0, flee: null, phase: rand(0, TAU),
          len: rand(78, 112) * s, base: rand(16, 26) * s, color: spec.base,
          marks: Array.from({ length: 3 + Math.floor(rand(0, 3)) }, () => ({ i: 1 + Math.floor(rand(0, 7)), off: rand(-0.7, 0.7), r: rand(0.07, 0.13), c: pick(spec.marks) })),
        });
      }
    }
    for (const f of this.koi) {
      f.x = clamp(f.x, 0, w);
      f.y = clamp(f.y, 0, bankY);
    }
    for (const L of this.leaves) L.y = clamp(L.y, 40 * s, bankY - 40 * s);
  }

  private get look() {
    return LOOKS[this.season];
  }

  private addRipple(x: number, y: number, power: number) {
    this.ripples.push({ x, y, age: 0, max: 4.5 * Math.min(1, power + 0.3), power });
    this.emit('ripple', { power, x: x / this.w });
  }

  tap(x: number, y: number) {
    if (y > this.bankAt(x)) return; // the stones
    this.addRipple(x, y, 1.2);
    for (const f of this.koi) { // koi close by are startled and dart away
      if (Math.hypot(f.x - x, f.y - y) < 170 * this.s) {
        f.flee = Math.atan2(f.y - y, f.x - x) + rand(-0.4, 0.4);
        f.boost = 1;
      }
    }
  }

  step(dt: number) {
    const { w, s, bankY } = this;
    this.t += dt;
    const t = this.t;
    this.next -= dt;
    if (this.next <= 0) {
      const x = rand(0.05, 0.95) * w;
      this.addRipple(x, rand(0.05, 0.95) * this.bankAt(x), this.drizzle ? rand(0.35, 0.75) : rand(0.5, 0.9));
      this.next = this.drizzle ? rand(0.15, 0.5) : rand(1.4, 3);
    }
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < r.max);
    const m = 60 * s;
    const cx = w / 2;
    const cy = bankY * 0.52;
    const pace = this.look.pace;
    for (const p of this.food) p.age += dt;
    const food = this.food.filter((p) => !p.eaten && p.age > 0);
    for (const f of this.koi) {
      f.turn += rand(-1, 1) * dt * 1.4;
      f.turn *= 1 - 0.6 * dt;
      let steer = f.turn;
      let hungry = 0;
      if (f.flee === null && food.length) { // head for the nearest pellet
        const hx = f.x + Math.cos(f.a) * f.len * 0.5;
        const hy = f.y + Math.sin(f.a) * f.len * 0.5;
        let best: Food | null = null;
        let bd = 420 * s;
        for (const p of food) {
          const d = Math.hypot(p.x - hx, p.y - hy);
          if (d < bd) {
            bd = d;
            best = p;
          }
        }
        if (best) {
          steer += wrapAngle(Math.atan2(best.y - f.y, best.x - f.x) - f.a) * 2.6;
          hungry = 1.6;
          if (bd < 10 * s) {
            best.eaten = true;
            this.ripples.push({ x: best.x, y: best.y, age: 0, max: 1, power: 0.3 });
            this.emit('eat', { x: best.x / w });
          }
        }
      }
      const out = f.x < m || f.x > w - m || f.y < m * 1.3 || f.y > this.bankAt(f.x) - 70 * s;
      if (out && !hungry) steer += wrapAngle(Math.atan2(cy - f.y, cx - f.x) - f.a) * 1.4;
      if (f.flee !== null) {
        steer += wrapAngle(f.flee - f.a) * 7;
        if (f.boost < 0.5) f.flee = null;
      }
      f.boost *= Math.exp(-dt * 1.3);
      f.a += steer * dt;
      f.vis += (steer - f.vis) * Math.min(1, dt * 4);
      const speed = f.base * pace * (1 + hungry + f.boost * 6);
      f.x += Math.cos(f.a) * speed * dt;
      f.y += Math.sin(f.a) * speed * dt;
      f.phase += dt * (2.2 + speed / (9 * s));
    }
    for (const L of this.leaves ?? []) {
      for (const r of this.ripples) {
        const dx = L.x - r.x;
        const dy = L.y - r.y;
        const d = Math.hypot(dx, dy) || 1;
        if (Math.abs(d - r.age * RIPPLE_SPEED * s) < 8 * s) {
          L.vx += (dx / d) * 60 * s * dt * r.power;
          L.vy += (dy / d) * 60 * s * dt * r.power;
        }
      }
      L.vx *= 1 - 0.3 * dt;
      L.vy *= 1 - 0.3 * dt;
      L.x += (L.vx + 3 * s) * dt;
      L.y += (L.vy + Math.sin(t * 0.2 + L.a) * 2 * s) * dt;
      L.a += L.va * dt;
      if (L.x > w + 40 * s) L.x = -40 * s;
      if (L.x < -40 * s) L.x = w + 40 * s;
      L.y = clamp(L.y, 40 * s, bankY - 40 * s);
    }
    this.food = this.food.filter((p) => !p.eaten && p.age < 40);
    if (this.look.snow) { // snow drifts down and melts where it lands
      this.flakeAcc += dt * (w * bankY) / 26000 * this.motion;
      while (this.flakeAcc >= 1) {
        this.flakeAcc -= 1;
        this.flakes.push({ x: rand(-0.1, 1) * w, y: rand(-0.1, 1) * this.h, vx: rand(8, 20) * s, vy: rand(14, 30) * s, age: 0, life: rand(2.5, 5), r: rand(1, 2.6) * s });
      }
      for (const fl of this.flakes) {
        fl.age += dt;
        fl.x += (fl.vx + Math.sin(t * 1.3 + fl.life * 9) * 8 * s) * dt;
        fl.y += fl.vy * dt;
      }
      this.flakes = this.flakes.filter((fl) => fl.age < fl.life);
    }
    for (const st of this.look.striders ? this.striders : []) {
      st.rest -= dt;
      if (st.rest <= 0) {
        st.rest = rand(0.7, 2.4);
        st.hop = 0.22;
        st.a += rand(-1.2, 1.2);
        if (st.x < m || st.x > w - m || st.y < m * 2 || st.y > bankY - m * 1.5) st.a = Math.atan2(cy - st.y, cx - st.x);
        this.ripples.push({ x: st.x, y: st.y, age: 0, max: 1.1, power: 0.3 });
      }
      if (st.hop > 0) {
        st.hop -= dt;
        st.x += Math.cos(st.a) * 120 * s * dt;
        st.y += Math.sin(st.a) * 120 * s * dt;
      }
    }
    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 1;
      this.stat('koi', this.koi.length);
    }
  }

  private drawKoi(ctx: CanvasRenderingContext2D, f: Koi, shadow: boolean) {
    const L = f.len;
    const n = PROFILE.length - 1;
    const W = L * 0.135;
    const dx = Math.cos(f.a);
    const dy = Math.sin(f.a);
    const nx = -dy;
    const ny = dx;
    const hx = f.x + dx * L * 0.5;
    const hy = f.y + dy * L * 0.5;
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const d = k * L;
      const lat = Math.sin(f.phase - i * 0.55) * L * 0.075 * Math.pow(k, 1.2) - f.vis * L * 0.22 * k * k;
      pts.push([hx - dx * d + nx * lat, hy - dy * d + ny * lat]);
    }
    const body = () => {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const p = pts[i];
        const wd = PROFILE[i] * W;
        if (i) ctx.lineTo(p[0] + nx * wd, p[1] + ny * wd);
        else ctx.moveTo(p[0] + nx * wd, p[1] + ny * wd);
      }
      for (let i = n; i >= 0; i--) {
        const p = pts[i];
        const wd = PROFILE[i] * W;
        ctx.lineTo(p[0] - nx * wd, p[1] - ny * wd);
      }
      ctx.closePath();
    };
    const tail = pts[n];
    const pre = pts[n - 1];
    const tl = Math.hypot(tail[0] - pre[0], tail[1] - pre[1]) || 1;
    const tx = (tail[0] - pre[0]) / tl;
    const ty = (tail[1] - pre[1]) / tl;
    const fins = () => {
      ctx.beginPath();
      ctx.moveTo(tail[0], tail[1]);
      ctx.quadraticCurveTo(tail[0] + tx * L * 0.1 + nx * L * 0.04, tail[1] + ty * L * 0.1 + ny * L * 0.04, tail[0] + tx * L * 0.2 + nx * L * 0.12, tail[1] + ty * L * 0.2 + ny * L * 0.12);
      ctx.lineTo(tail[0] + tx * L * 0.13, tail[1] + ty * L * 0.13);
      ctx.lineTo(tail[0] + tx * L * 0.2 - nx * L * 0.12, tail[1] + ty * L * 0.2 - ny * L * 0.12);
      ctx.quadraticCurveTo(tail[0] + tx * L * 0.1 - nx * L * 0.04, tail[1] + ty * L * 0.1 - ny * L * 0.04, tail[0], tail[1]);
      ctx.fill();
      for (const side of [-1, 1]) {
        const p = pts[3];
        const flap = 0.95 + 0.2 * Math.sin(f.phase * 0.7 + side);
        ctx.beginPath();
        ctx.ellipse(p[0] + nx * side * (W + L * 0.05) - dx * L * 0.03, p[1] + ny * side * (W + L * 0.05) - dy * L * 0.03, L * 0.1, L * 0.042, f.a + side * (Math.PI - flap), 0, TAU);
        ctx.fill();
      }
    };
    if (shadow) {
      ctx.fillStyle = 'rgba(0,16,14,0.3)';
      body();
      ctx.fill();
      fins();
      return;
    }
    ctx.fillStyle = f.color;
    ctx.globalAlpha = 0.6;
    fins();
    ctx.globalAlpha = 1;
    body();
    ctx.fill();
    ctx.save();
    ctx.clip();
    for (const mk of f.marks) {
      const p = pts[mk.i];
      ctx.fillStyle = mk.c;
      ctx.beginPath();
      ctx.ellipse(p[0] + nx * mk.off * W, p[1] + ny * mk.off * W, mk.r * L * 1.3, mk.r * L, f.a, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = W * 0.2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[2][0], pts[2][1]);
    for (let i = 3; i <= 7; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(10,12,14,0.8)';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(pts[1][0] + nx * side * W * 0.62, pts[1][1] + ny * side * W * 0.62, L * 0.014, 0, TAU);
      ctx.fill();
    }
  }

  private drawPad(ctx: CanvasRenderingContext2D, pd: Pad) {
    const { s, t } = this;
    const r = pd.r * s * this.look.pads;
    let x = pd.fx * this.w + Math.sin(t * 0.4 + pd.p) * 2 * s;
    let y = pd.fy * this.bankY + Math.cos(t * 0.33 + pd.p) * 2 * s;
    for (const rp of this.ripples) { // a passing ripple nudges the pad
      const dx = x - rp.x;
      const dy = y - rp.y;
      const d = Math.hypot(dx, dy) || 1;
      const off = Math.abs(d - rp.age * RIPPLE_SPEED * s);
      if (off < 16 * s) {
        const k = (1 - off / (16 * s)) * 3.5 * s * rp.power * (1 - rp.age / rp.max);
        x += (dx / d) * k;
        y += (dy / d) * k;
      }
    }
    const a = pd.a + Math.sin(t * 0.15 + pd.p) * 0.05;
    ctx.fillStyle = 'rgba(0,14,12,0.35)';
    ctx.beginPath();
    ctx.ellipse(x + 5 * s, y + 8 * s, r, r * 0.96, 0, 0, TAU);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, '#5aa862');
    g.addColorStop(1, '#27663f');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, a + 0.22, a + TAU - 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(170,230,170,0.24)';
    ctx.lineWidth = Math.max(0.6, 0.8 * s);
    ctx.beginPath();
    for (let i = 1; i < 8; i++) {
      const va = a + 0.22 + (i / 8) * (TAU - 0.44);
      ctx.moveTo(x, y);
      ctx.lineTo(x + Math.cos(va) * r * 0.9, y + Math.sin(va) * r * 0.9);
    }
    ctx.stroke();
    if (!pd.flower || !this.look.flowers) return;
    const fx = x + r * 0.5; // a water lily
    const fy = y - r * 0.55;
    const Rf = r * 0.62;
    ctx.fillStyle = 'rgba(0,14,12,0.3)';
    ctx.beginPath();
    ctx.arc(fx + 4 * s, fy + 7 * s, Rf * 0.9, 0, TAU);
    ctx.fill();
    const rings: [number, number, string, number][] = [[9, Rf, '#f3b6c8', 0], [7, Rf * 0.72, '#f9d6e0', 0.4], [5, Rf * 0.45, '#fff2f5', 0.2]];
    for (const [count, rad, col, rot] of rings) {
      ctx.fillStyle = col;
      for (let i = 0; i < count; i++) {
        const pa = (i / count) * TAU + rot + pd.p;
        ctx.beginPath();
        ctx.ellipse(fx + Math.cos(pa) * rad * 0.5, fy + Math.sin(pa) * rad * 0.5, rad * 0.52, rad * 0.21, pa, 0, TAU);
        ctx.fill();
      }
    }
    ctx.fillStyle = '#f0c12e';
    ctx.beginPath();
    ctx.arc(fx, fy, Rf * 0.16, 0, TAU);
    ctx.fill();
  }

  private leafPath(ctx: CanvasRenderingContext2D, len: number) {
    ctx.beginPath();
    ctx.moveTo(-len * 0.5, 0);
    ctx.quadraticCurveTo(0, -len * 0.42, len * 0.5, 0);
    ctx.quadraticCurveTo(0, len * 0.42, -len * 0.5, 0);
    ctx.closePath();
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, s, t, bankY } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, w, h);
    /* koi: their shadows on the bed first */
    ctx.save();
    ctx.translate(9 * s, 15 * s);
    for (const f of this.koi) this.drawKoi(ctx, f, true);
    ctx.restore();
    for (const f of this.koi) this.drawKoi(ctx, f, false);
    ctx.fillStyle = 'rgba(16,84,74,0.2)'; // a layer of water over them
    ctx.fillRect(0, 0, w, bankY + 30 * s);
    for (const r of this.ripples) {
      const k = r.age / r.max;
      for (let j = 0; j < 3; j++) {
        const rad = (r.age * RIPPLE_SPEED - j * 11) * s;
        if (rad <= 0) continue;
        const a = (1 - k) * (0.4 - j * 0.1) * r.power;
        ctx.strokeStyle = `rgba(200,255,245,${a})`;
        ctx.lineWidth = Math.max(0.8, 1.6 * s);
        ctx.beginPath();
        ctx.arc(r.x, r.y, rad, 0, TAU);
        ctx.stroke();
        ctx.strokeStyle = `rgba(0,22,20,${a * 0.7})`;
        ctx.lineWidth = Math.max(0.8, 2 * s);
        ctx.beginPath();
        ctx.arc(r.x, r.y, Math.max(0, rad - 3 * s), 0, TAU);
        ctx.stroke();
      }
    }
    // 윤슬: bands of sparkle drifting across the surface; clouds dim them while it drizzles
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgb(255,248,220)';
    const dim = (this.drizzle ? 0.35 : 1) * this.look.sparkle;
    for (const p of this.pts) {
      const f = Math.sin((p.x * 0.028) / s + t * 0.6)
        + Math.sin((p.y * 0.041) / s - t * 0.5 + (p.x * 0.01) / s)
        + 0.7 * Math.sin(((p.x - p.y) * 0.019) / s + t * 0.9);
      let b = smooth(1.1, 2.4, f);
      if (b <= 0.01) continue;
      b *= (0.45 + 0.55 * Math.sin(t * 5 + p.p * 7)) * dim;
      if (b <= 0.03) continue;
      const sz = (0.8 + 3 * b) * p.z * s;
      ctx.globalAlpha = Math.min(1, b * 1.1);
      ctx.fillRect(p.x - sz, p.y - 0.5, sz * 2, 1);
      ctx.fillRect(p.x - 0.5, p.y - sz * 0.6, 1, sz * 1.2);
      if (b > 0.55) {
        ctx.globalAlpha = b * 0.3;
        ctx.drawImage(this.spark, p.x - sz * 2, p.y - sz * 2, sz * 4, sz * 4);
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#c98f4e'; // pellets floating on the water
    for (const p of this.food) {
      if (p.age < 0) continue;
      ctx.globalAlpha = clamp((40 - p.age) / 4, 0, 1);
      ctx.beginPath();
      ctx.arc(p.x + Math.sin(t * 0.7 + p.p) * 2 * s, p.y + Math.cos(t * 0.6 + p.p) * 2 * s, 2.2 * s, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (this.look.pads) for (const pd of this.pads ?? []) this.drawPad(ctx, pd);
    for (const L of this.leaves ?? []) {
      ctx.save();
      ctx.translate(L.x + 6 * s, L.y + 9 * s);
      ctx.rotate(L.a);
      ctx.fillStyle = 'rgba(0,14,12,0.35)';
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
    /* water striders */
    const legs = [[7, -8], [7, 8], [-8, -7], [-8, 7]];
    for (const st of this.look.striders ? this.striders : []) {
      ctx.save();
      ctx.translate(st.x, st.y);
      ctx.rotate(st.a);
      ctx.fillStyle = 'rgba(0,14,12,0.35)';
      for (const [lx, ly] of legs) {
        ctx.beginPath();
        ctx.ellipse(lx * s + 3 * s, ly * s + 5 * s, 2.6 * s, 1.6 * s, 0, 0, TAU);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(20,24,20,0.85)';
      ctx.lineWidth = Math.max(0.7, 0.8 * s);
      ctx.beginPath();
      for (const [lx, ly] of legs) {
        ctx.moveTo(0, 0);
        ctx.lineTo(lx * s, ly * s);
      }
      ctx.stroke();
      ctx.lineWidth = 2 * s;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-4 * s, 0);
      ctx.lineTo(4 * s, 0);
      ctx.stroke();
      ctx.restore();
    }
    ctx.drawImage(this.front, 0, 0, w, h);
    if (this.flakes.length) {
      ctx.fillStyle = '#ffffff';
      for (const fl of this.flakes) {
        const k = fl.age / fl.life;
        ctx.globalAlpha = 0.85 * Math.min(1, k * 6) * (1 - k * k);
        ctx.beginPath();
        ctx.arc(fl.x, fl.y, fl.r * (1.4 - 0.4 * k), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.vig, 0, 0, w, h);
  }
}
