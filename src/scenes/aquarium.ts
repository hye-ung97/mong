import { Scene, type SceneVariant } from './base';
import { TAU, clamp, glow, layer, newSeed, rand, rng, vignette } from './util';

type FishKind = 'neon' | 'gold' | 'pearl' | 'cory';
const FISH: Record<FishKind, { len: number; h: number; body: [string, string]; belly: string; fin: string; speed: number }> = {
  neon: { len: 24, h: 0.34, body: ['#d5e0ea', '#7f93a8'], belly: '#e8eef3', fin: 'rgba(220,235,245,0.35)', speed: 52 },
  gold: { len: 44, h: 0.5, body: ['#ffab45', '#ff6f24'], belly: '#ffd89c', fin: 'rgba(255,140,60,0.55)', speed: 38 },
  pearl: { len: 54, h: 0.5, body: ['#e9e3c9', '#a9a68e'], belly: '#f6f1df', fin: 'rgba(240,232,205,0.35)', speed: 30 },
  cory: { len: 30, h: 0.46, body: ['#c2b292', '#6f6552'], belly: '#eee4cc', fin: 'rgba(214,200,170,0.4)', speed: 24 },
};

interface Point { x: number; y: number }
interface Fish {
  kind: FishKind; x: number; y: number; vx: number; vy: number; dir: number; phase: number;
  size: number; depth: number; target: Point; rest: number; ox: number; oy: number;
  /** seconds left of darting away from a knock on the glass, and the direction */
  flee: number; fx: number; fy: number;
}
interface Food { x: number; y: number; vy: number; p: number; age: number; float: number; settled: boolean; eaten: boolean }
interface Bubble { x: number; y: number; r: number; vy: number; p: number }
interface Tap { x: number; y: number; age: number }
interface Ripple { x: number; age: number; big: boolean }
interface Blade { x: number; base: number; h: number; bw: number; color: string; p: number; sp: number; front: boolean }
interface Stem { x: number; base: number; h: number; p: number; sp: number; red: boolean; leaf: number }
interface Ray { x: number; w: number; p: number; a: number }

const FOOD_LIFE = 26;

/**
 * 물멍 · 어항: a lit tank in a dark room, seen from the side — the water surface with air above it,
 * the glass edges and the cabinet it stands on. Food goes in from the open top; a tap on the glass
 * is a knock from outside, and the fish nearby dart away.
 */
export class Aquarium extends Scene {
  moon: boolean;
  private readonly seed = newSeed();
  private top: number | null = null;
  private floor: number | null = null;
  private night: number;
  private surfY = 0;
  private floorY = 0;
  private gl = 0;
  private box = { l: 0, r: 0, t: 0, b: 0 };
  private sandAt: (x: number) => number = () => 0;
  private fish: Fish[] = [];
  private food: Food[] = [];
  private bubbles: Bubble[] = [];
  private taps: Tap[] = [];
  private ripples: Ripple[] = [];
  private blades: Blade[] = [];
  private stems: Stem[] = [];
  private rays: Ray[] = [];
  private stone: Point = { x: 0, y: 0 };
  private snail = { x: 0, y: 0, a: -2.2, placed: false };
  private school: Point = { x: 0, y: 0 };
  private schoolT: Point = { x: 0, y: 0 };
  private bubbleAcc = 0;
  private statTimer = 0;
  private readonly caustic = glow(190, 255, 235, 0.4);
  private readonly neonGlow = glow(70, 215, 255, 0.4);
  private bg!: HTMLCanvasElement;
  private front!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;

  constructor(variant: SceneVariant, opts: { moon?: boolean } = {}) {
    super(variant);
    this.moon = opts.moon ?? false;
    this.night = this.moon ? 1 : 0;
  }

  /** 달빛 조명: the tank sinks into blue and the fish slow down. */
  setMoon(on: boolean) {
    this.moon = on;
  }

  audioState() {
    return { moon: this.moon ? 1 : 0 };
  }

  /**
   * Where the page's controls sit (CSS px): `top` is the bottom edge of the chrome above the water,
   * `floor` the top edge of the controls resting on the cabinet. `null`: nothing there.
   */
  setEdges(top: number | null, floor: number | null) {
    const t = top === null ? null : Math.round(top);
    const f = floor === null ? null : Math.round(floor);
    const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 2);
    if (same(t, this.top) && same(f, this.floor)) return;
    this.top = t;
    this.floor = f;
    if (this.w) this.layout();
  }

  get fishCount() {
    return this.fish.length;
  }

  private randPoint(): Point {
    const b = this.box;
    return { x: rand(b.l, b.r), y: rand(b.t, b.b) };
  }

  private sandPoint(): Point {
    const x = rand(this.box.l, this.box.r);
    return { x, y: this.sandAt(x) - 9 * this.s };
  }

  layout() {
    const { w, h, dpr } = this;
    const R = rng(this.seed);
    const rr = (a: number, b: number) => a + R() * (b - a);
    const rp = <T>(list: readonly T[]): T => list[Math.floor(R() * list.length)];
    const scale = this.variant === 'card' && w / h > 1.4 ? 1.3 : 1;
    const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.45, 1.25) * scale);
    const wide = w > 900;
    // a preview card, or a screen whose controls are tucked away, shows the water without the cabinet
    const bare = this.variant === 'card' || this.floor === null || this.floor < h * 0.55;
    const surfY = (this.surfY = bare ? Math.max(14 * s, h * 0.1) : clamp((this.top ?? (wide ? 124 : 150)) + 44, h * 0.1, h * 0.3));
    const cabY = bare ? h + 2 : (this.floor as number) - 16;
    const floorY = (this.floorY = bare ? h : cabY - 9 * s);
    const gl = (this.gl = bare ? 0 : 7 * s);
    const fl = floorY;
    const bump = (x: number, c0: number, sd: number) => Math.exp(-Math.pow((x / w - c0) / sd, 2));
    const sandH = Math.min(1, (floorY - surfY) / (360 * s));
    const sandAt = (this.sandAt = (x: number) =>
      fl - (40 + 40 * bump(x, 0.1, 0.2) + 30 * bump(x, 0.88, 0.16)) * s * sandH - Math.sin(x * 0.02) * 3 * s);
    const bt = surfY + 30 * s;
    this.box = { l: gl + 26 * s, r: w - gl - 26 * s, t: bt, b: Math.max(bt + 20 * s, fl - 96 * s * sandH) };

    /* behind: the room, the air above the water, water, sand, rocks, driftwood */
    this.bg = layer(w, h, dpr, (x) => {
      x.fillStyle = '#06080a';
      x.fillRect(0, 0, w, h);
      let g = x.createLinearGradient(0, 0, 0, surfY);
      g.addColorStop(0, '#16292c');
      g.addColorStop(1, '#0b181b');
      x.fillStyle = g;
      x.fillRect(0, 0, w, surfY);
      g = x.createLinearGradient(0, 0, 0, surfY * 0.8); // the lamp above
      g.addColorStop(0, 'rgba(210,250,255,0.5)');
      g.addColorStop(0.25, 'rgba(160,235,240,0.16)');
      g.addColorStop(1, 'rgba(160,235,240,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, surfY);
      g = x.createLinearGradient(0, surfY, 0, floorY);
      g.addColorStop(0, '#2c9fa9');
      g.addColorStop(0.22, '#14606f');
      g.addColorStop(0.65, '#0a3645');
      g.addColorStop(1, '#06212b');
      x.fillStyle = g;
      x.fillRect(0, surfY, w, floorY - surfY);
      g = x.createRadialGradient(w / 2, surfY, 0, w / 2, surfY, Math.max(w * 0.6, (floorY - surfY) * 0.9));
      g.addColorStop(0, 'rgba(150,240,235,0.22)');
      g.addColorStop(1, 'rgba(150,240,235,0)');
      x.fillStyle = g;
      x.fillRect(0, surfY, w, floorY - surfY);
      for (const side of [0, 1]) { // the back corners fall into shadow
        g = x.createLinearGradient(side ? w : 0, 0, side ? w - w * 0.3 : w * 0.3, 0);
        g.addColorStop(0, 'rgba(2,14,20,0.6)');
        g.addColorStop(1, 'rgba(2,14,20,0)');
        x.fillStyle = g;
        x.fillRect(side ? w * 0.7 : 0, surfY, w * 0.3, floorY - surfY);
      }
      x.fillStyle = 'rgba(6,50,56,0.5)'; // blurry plants far behind
      for (let i = 0; i < Math.round(w / 46); i++) {
        x.beginPath();
        x.ellipse(rr(0, w), floorY - 30 * s, rr(14, 30) * s, Math.min(rr(70, 230) * s, (floorY - surfY) * 0.7), 0, Math.PI, TAU);
        x.fill();
      }
      /* sand */
      x.beginPath();
      x.moveTo(0, floorY);
      for (let px = 0; px <= w + 6; px += 6) x.lineTo(px, sandAt(px));
      x.lineTo(w + 6, floorY);
      x.closePath();
      g = x.createLinearGradient(0, floorY - 90 * s * sandH, 0, floorY);
      g.addColorStop(0, '#d8cba3');
      g.addColorStop(0.45, '#a3966f');
      g.addColorStop(1, '#4f4a38');
      x.fillStyle = g;
      x.fill();
      x.save();
      x.clip();
      for (let i = 0; i < Math.round(w / 2.4); i++) {
        const px = rr(0, w);
        const py = sandAt(px) + rr(2, 80) * s;
        x.fillStyle = rp(['rgba(255,246,214,0.5)', 'rgba(120,108,80,0.6)', 'rgba(70,66,52,0.5)', 'rgba(226,212,170,0.6)']);
        x.beginPath();
        x.ellipse(px, py, rr(0.8, 2.6) * s, rr(0.6, 1.8) * s, 0, 0, TAU);
        x.fill();
      }
      g = x.createLinearGradient(0, floorY - 16 * s, 0, floorY);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.45)');
      x.fillStyle = g;
      x.fillRect(0, floorY - 16 * s, w, 16 * s);
      x.restore();
      /* rocks */
      const rock = (cx: number, base: number, rw: number, rh: number) => {
        const n = 7;
        const pts: [number, number][] = [];
        for (let i = 0; i < n; i++) {
          const a = Math.PI + (i / (n - 1)) * Math.PI;
          const j = i === 0 || i === n - 1 ? 1 : rr(0.78, 1.12);
          pts.push([cx + Math.cos(a) * rw * j, base + Math.sin(a) * rh * j]);
        }
        const path = (list: [number, number][]) => {
          x.beginPath();
          list.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])));
          x.closePath();
        };
        const rg = x.createLinearGradient(0, base - rh, 0, base);
        rg.addColorStop(0, '#8b9a9b');
        rg.addColorStop(0.5, '#4d5f63');
        rg.addColorStop(1, '#1b282c');
        x.fillStyle = rg;
        path(pts);
        x.fill();
        const mid: [number, number] = [cx + rr(-0.15, 0.15) * rw, base - rh * 0.45];
        x.fillStyle = 'rgba(214,236,232,0.2)';
        path([pts[1], pts[2], pts[3], mid]);
        x.fill();
        x.fillStyle = 'rgba(0,0,0,0.26)';
        path([pts[4], pts[5], pts[6], mid]);
        x.fill();
        x.strokeStyle = 'rgba(0,0,0,0.3)';
        x.lineWidth = Math.max(0.8, s);
        x.beginPath();
        x.moveTo(pts[3][0], pts[3][1]);
        x.lineTo(mid[0], mid[1]);
        x.lineTo(pts[5][0], pts[5][1]);
        x.stroke();
      };
      const rk = sandH;
      const rx = w * 0.8;
      rock(rx - 44 * s, sandAt(rx - 44 * s) + 8 * s, 34 * s, 46 * s * rk);
      rock(rx + 6 * s, sandAt(rx) + 10 * s, 52 * s, 86 * s * rk);
      rock(rx + 58 * s, sandAt(rx + 58 * s) + 8 * s, 30 * s, 38 * s * rk);
      rock(w * 0.36, sandAt(w * 0.36) + 6 * s, 22 * s, 20 * s * rk);
      /* driftwood with moss */
      const moss: [number, number, number][] = [];
      const branch = (x0: number, y0: number, ang: number, len: number, wd: number, depth: number) => {
        const n = 12;
        let px = x0;
        let py = y0;
        let a = ang;
        const pts: [number, number][] = [[px, py]];
        for (let i = 1; i <= n; i++) {
          a += rr(-0.16, 0.16) + (depth === 0 ? 0.035 : 0);
          px += Math.cos(a) * (len / n);
          py += Math.sin(a) * (len / n);
          pts.push([px, py]);
          if (depth < 2 && (i === 5 || i === 9) && R() < 0.85) {
            branch(px, py, a + (i === 5 ? -1 : 1) * rr(0.5, 0.9), len * rr(0.35, 0.5), wd * (1 - i / n) * 0.75 + 2 * s, depth + 1);
          }
        }
        x.lineCap = 'round';
        for (let i = 1; i <= n; i++) {
          const k = 1 - (i / n) * 0.85;
          x.strokeStyle = '#3b281f';
          x.lineWidth = wd * k;
          x.beginPath();
          x.moveTo(pts[i - 1][0], pts[i - 1][1]);
          x.lineTo(pts[i][0], pts[i][1]);
          x.stroke();
        }
        for (let i = 1; i <= n; i++) {
          const k = 1 - (i / n) * 0.85;
          x.strokeStyle = 'rgba(168,128,96,0.5)';
          x.lineWidth = wd * k * 0.3;
          x.beginPath();
          x.moveTo(pts[i - 1][0], pts[i - 1][1] - wd * k * 0.26);
          x.lineTo(pts[i][0], pts[i][1] - wd * k * 0.26);
          x.stroke();
          if (depth < 2 && R() < 0.4) moss.push([pts[i][0], pts[i][1] - wd * k * 0.4, rr(4, 8) * s * (depth ? 0.7 : 1)]);
        }
      };
      const wx = w * 0.07;
      branch(wx, sandAt(wx) + 6 * s, -0.62, Math.min(w * 0.56, 330 * s, (floorY - surfY) * 0.62), 22 * s * Math.max(0.6, rk), 0);
      for (const [mx, my, mr] of moss) {
        for (let i = 0; i < 5; i++) {
          x.fillStyle = rp(['#2f8f55', '#3aa767', '#256f47']);
          x.beginPath();
          x.arc(mx + rr(-1, 1) * mr, my + rr(-0.5, 0.5) * mr, mr * rr(0.5, 0.9), 0, TAU);
          x.fill();
        }
        x.fillStyle = 'rgba(190,255,200,0.35)';
        x.beginPath();
        x.arc(mx - mr * 0.3, my - mr * 0.4, mr * 0.3, 0, TAU);
        x.fill();
      }
      /* low carpet grass over the sand; the middle front stays open */
      for (let px = gl; px < w - gl; px += rr(2.5, 5) * s) {
        const d = Math.abs(px / w - 0.52);
        if (d < 0.13 && R() < 0.8) continue;
        const py = sandAt(px) + rr(0, 5) * s;
        const bh = rr(5, 15) * s;
        x.strokeStyle = rp(['#3fae6a', '#2b8a55', '#58c07a', '#237048']);
        x.lineWidth = rr(1, 2) * s;
        x.lineCap = 'round';
        x.beginPath();
        x.moveTo(px, py);
        x.quadraticCurveTo(px + rr(-3, 3) * s, py - bh * 0.6, px + rr(-5, 5) * s, py - bh);
        x.stroke();
      }
    });

    /* in front: reflections on the glass, its edges, the base trim, the cabinet */
    this.front = layer(w, h, dpr, (x) => {
      let g: CanvasGradient;
      x.save();
      x.beginPath();
      x.rect(gl, 0, w - gl * 2, floorY);
      x.clip();
      x.globalCompositeOperation = 'lighter';
      for (const [fx, fw, a] of [[0.16, 0.1, 0.035], [0.3, 0.035, 0.03], [0.74, 0.07, 0.022]]) {
        x.fillStyle = `rgba(220,245,255,${a})`;
        x.beginPath();
        x.moveTo(w * fx, 0);
        x.lineTo(w * (fx + fw), 0);
        x.lineTo(w * (fx + fw) - floorY * 0.34, floorY);
        x.lineTo(w * fx - floorY * 0.34, floorY);
        x.closePath();
        x.fill();
      }
      x.restore();
      if (bare) return;
      for (const side of [0, 1]) {
        const x0 = side ? w - gl : 0;
        g = x.createLinearGradient(x0, 0, x0 + gl, 0);
        const a = side ? [1, 0.5, 0] : [0, 0.5, 1];
        g.addColorStop(a[0], 'rgba(6,20,22,0.95)');
        g.addColorStop(a[1], 'rgba(60,150,140,0.75)');
        g.addColorStop(a[2], 'rgba(190,255,240,0.7)');
        x.fillStyle = g;
        x.fillRect(x0, 0, gl, floorY);
      }
      x.fillStyle = '#040607';
      x.fillRect(0, floorY, w, cabY - floorY);
      x.fillStyle = 'rgba(150,240,225,0.28)';
      x.fillRect(0, floorY, w, Math.max(1, s));
      g = x.createLinearGradient(0, cabY, 0, h);
      g.addColorStop(0, '#221a15');
      g.addColorStop(0.12, '#17120f');
      g.addColorStop(1, '#080606');
      x.fillStyle = g;
      x.fillRect(0, cabY, w, h - cabY);
      x.fillStyle = 'rgba(255,255,255,0.025)';
      for (let i = 0; i < 9; i++) x.fillRect(0, cabY + rr(14, h - cabY), w, Math.max(1, s));
      g = x.createLinearGradient(0, cabY, 0, cabY + 70 * s); // the tank's light spills onto the cabinet
      g.addColorStop(0, 'rgba(90,220,205,0.2)');
      g.addColorStop(1, 'rgba(90,220,205,0)');
      x.fillStyle = g;
      x.fillRect(0, cabY, w, 70 * s);
      x.fillStyle = 'rgba(170,250,235,0.3)';
      x.fillRect(0, cabY, w, Math.max(1, s));
    });
    this.vig = vignette(w, h, dpr, 0.42);

    /* plants: stems with paired leaves, and long blades */
    this.stems = [];
    this.blades = [];
    const tall = floorY - surfY;
    const groups: [number, number, boolean][] = wide
      ? [[0.035, 5, false], [0.12, 4, true], [0.6, 3, false], [0.93, 4, true], [0.975, 3, false]]
      : [[0.05, 4, false], [0.16, 3, true], [0.95, 4, true]];
    for (const [fx, count, red] of groups) {
      for (let i = 0; i < count; i++) {
        const px = w * fx + rr(-16, 16) * s;
        this.stems.push({ x: px, base: sandAt(px) + 3 * s, h: Math.min(rr(150, 300) * s, tall * 0.72), p: rr(0, TAU), sp: rr(0.5, 0.9), red, leaf: rr(8, 11) * s });
      }
    }
    for (const fx of wide ? [0.02, 0.2, 0.5, 0.66, 0.99] : [0.01, 0.27, 0.99]) {
      for (let i = 0; i < 4; i++) {
        const px = w * fx + rr(-14, 14) * s;
        this.blades.push({
          x: px, base: sandAt(px) + 4 * s, h: Math.min(rr(170, 380) * s, tall * 0.9), bw: rr(6, 12) * s,
          color: rp(['#2f8c63', '#3aa275', '#24785a', '#2a6e4f']), p: rr(0, TAU), sp: rr(0.5, 0.9), front: fx < 0.03 || fx > 0.97,
        });
      }
    }
    this.rays = Array.from({ length: wide ? 7 : 5 }, () => ({ x: rr(0, w), w: rr(30, 90) * s, p: rr(0, TAU), a: rr(0.5, 1) }));
    this.stone = { x: w * 0.66, y: sandAt(w * 0.66) - 2 * s };
    if (!this.snail.placed) this.snail = { x: w * 0.9, y: floorY - 150 * s, a: -2.2, placed: true };
    this.snail.x = clamp(this.snail.x, w * 0.55, w - gl - 14 * s);
    this.snail.y = clamp(this.snail.y, surfY + 20 * s, Math.max(surfY + 20 * s, floorY - 70 * s));
    if (!this.fish.length) this.spawnFish();
    else {
      for (const f of this.fish) {
        f.x = clamp(f.x, this.box.l, this.box.r);
        f.y = clamp(f.y, this.box.t, this.sandAt(f.x) - 8 * s);
        f.target = f.kind === 'cory' ? this.sandPoint() : this.randPoint();
      }
    }
    this.school = { x: w * 0.5, y: (this.box.t + this.box.b) / 2 };
    this.schoolT = this.randPoint();
    this.food = [];
  }

  private spawnFish() {
    const add = (kind: FishKind, extra: Partial<Fish> = {}) => {
      const p = kind === 'cory' ? this.sandPoint() : this.randPoint();
      this.fish.push({
        kind, x: p.x, y: p.y, vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1, phase: rand(0, TAU),
        size: rand(0.9, 1.1), depth: rand(0.65, 1), target: p, rest: 0, ox: 0, oy: 0, flee: 0, fx: 0, fy: 0, ...extra,
      });
    };
    for (let i = 0; i < 12; i++) add('neon', { ox: rand(-70, 70), oy: rand(-34, 34), depth: rand(0.75, 1) });
    add('gold', { depth: 1 });
    add('gold', { depth: 0.8 });
    add('pearl', { depth: 0.9 });
    add('cory', { depth: 1 });
    add('cory', { depth: 0.9 });
    this.fish.sort((a, b) => a.depth - b.depth);
  }

  /** Drop a pinch of food onto the surface. Without a point, it lands somewhere near the middle. */
  feed(x?: number) {
    const s = this.s;
    const px = clamp(x ?? rand(0.3, 0.7) * this.w, this.box.l, this.box.r);
    this.ripples.push({ x: px, age: 0, big: true });
    for (let i = 0; i < 8; i++) {
      this.food.push({
        x: px + rand(-18, 18) * s, y: this.surfY + 3 * s, vy: rand(16, 28) * s, p: rand(0, TAU),
        age: 0, float: rand(0.3, 1.4), settled: false, eaten: false,
      });
    }
    this.emit('feed', { x: px / this.w });
  }

  /**
   * A tap on the scene. Above the water (the tank's open top) it drops food; on the glass it is a knock
   * and the fish close by dart away. Returns what happened.
   */
  poke(x: number, y: number): 'feed' | 'knock' | null {
    const s = this.s;
    if (y > this.floorY) return null; // the cabinet
    if (y < this.surfY + 10 * s) {
      this.feed(x);
      return 'feed';
    }
    this.taps.push({ x, y, age: 0 });
    for (const f of this.fish) {
      const dx = f.x - x;
      const dy = f.y - y;
      const d = Math.hypot(dx, dy) || 1;
      if (d > 170 * s) continue;
      f.flee = rand(0.7, 1.1);
      f.fx = dx / d;
      f.fy = dy / d;
    }
    this.emit('knock', { x: x / this.w });
    return 'knock';
  }

  tap(x: number, y: number) {
    this.poke(x, y);
  }

  step(dt: number) {
    const { s, surfY } = this;
    this.t += dt;
    const t = this.t;
    this.night += ((this.moon ? 1 : 0) - this.night) * Math.min(1, dt * 1.6);
    const calm = 1 - 0.45 * this.night;
    const sc = this.school;
    const st = this.schoolT;
    const sdx = st.x - sc.x;
    const sdy = st.y - sc.y;
    const sd = Math.hypot(sdx, sdy);
    if (sd < 20 * s) this.schoolT = this.randPoint();
    else {
      sc.x += (sdx / sd) * 34 * s * calm * dt;
      sc.y += (sdy / sd) * 20 * s * calm * dt;
    }
    const food = this.food.filter((p) => !p.eaten);
    for (const f of this.fish) {
      const spec = FISH[f.kind];
      let tx: number;
      let ty: number;
      let speed = spec.speed * s * calm;
      let best: Food | null = null;
      let bd = (f.kind === 'cory' ? 150 : 300) * s;
      for (const p of food) {
        if (f.kind === 'cory' && !p.settled) continue; // bottom fish only take what has sunk
        const dd = Math.hypot(p.x - f.x, p.y - f.y);
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      if (f.flee > 0) {
        f.flee -= dt;
        best = null;
        tx = f.x + f.fx * 200 * s;
        ty = f.y + f.fy * 200 * s;
        speed *= 3;
      } else if (best) {
        tx = best.x;
        ty = best.y;
        speed *= 2.2;
      } else if (f.kind === 'neon') {
        tx = sc.x + f.ox * s;
        ty = sc.y + f.oy * s;
        speed *= 1.2;
      } else {
        if (f.rest > 0) f.rest -= dt;
        else if (Math.hypot(f.target.x - f.x, f.target.y - f.y) < 26 * s) {
          f.target = f.kind === 'cory' ? this.sandPoint() : this.randPoint();
          if (f.kind === 'cory') f.rest = rand(0.6, 2.6);
        }
        tx = f.target.x;
        ty = f.target.y;
        if (f.rest > 0) speed *= 0.08;
      }
      const dx = tx - f.x;
      const dy = ty - f.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ease = f.kind === 'neon' && !best ? clamp(dist / (40 * s), 0.15, 1) : 1;
      const k = Math.min(1, dt * (f.flee > 0 ? 6 : best ? 2.6 : 1.1));
      f.vx += ((dx / dist) * speed * ease - f.vx) * k;
      f.vy += ((dy / dist) * speed * 0.55 * ease - f.vy) * k;
      f.x = clamp(f.x + f.vx * dt, this.box.l, this.box.r);
      f.y = clamp(f.y + f.vy * dt, surfY + 14 * s, this.sandAt(f.x) - 8 * s);
      f.phase += dt * (4 + Math.hypot(f.vx, f.vy) / (6 * s));
      if (Math.abs(f.vx) > 3 * s) f.dir += ((f.vx >= 0 ? 1 : -1) - f.dir) * Math.min(1, dt * 3.2);
      if (best && bd < spec.len * s * 0.45) {
        best.eaten = true;
        this.bubbles.push({ x: f.x + Math.sign(f.dir) * spec.len * s * 0.5, y: f.y, r: 1.6 * s, vy: -30 * s, p: rand(0, TAU) });
        this.emit('eat');
      }
    }
    for (const p of this.food) {
      p.age += dt;
      if (p.settled || p.age < p.float) continue; // floats for a moment, then sinks
      p.y += p.vy * dt;
      p.x += Math.sin(t * 2 + p.p) * 10 * s * dt;
      const floor = this.sandAt(p.x) - 2 * s;
      if (p.y >= floor) {
        p.y = floor;
        p.settled = true;
      }
    }
    this.food = this.food.filter((p) => !p.eaten && p.age < FOOD_LIFE);
    this.bubbleAcc += dt * 6 * this.motion;
    while (this.bubbleAcc >= 1) {
      this.bubbleAcc -= 1;
      this.bubbles.push({ x: this.stone.x + rand(-4, 4) * s, y: this.stone.y, r: rand(1.4, 3.4) * s, vy: -rand(40, 70) * s, p: rand(0, TAU) });
    }
    for (const b of this.bubbles) {
      b.vy -= 12 * s * dt;
      b.y += b.vy * dt;
      b.x += Math.sin(t * 5 + b.p) * 14 * s * dt;
      b.r *= 1 + 0.05 * dt;
      if (b.y <= surfY + 3 * s && Math.random() < 0.3) this.ripples.push({ x: b.x, age: 0, big: false });
    }
    this.bubbles = this.bubbles.filter((b) => b.y > surfY + 3 * s);
    for (const r of this.ripples) r.age += dt;
    this.ripples = this.ripples.filter((r) => r.age < (r.big ? 1.6 : 0.8));
    for (const tp of this.taps) tp.age += dt;
    this.taps = this.taps.filter((tp) => tp.age < 0.9);
    /* the snail creeps over the glass */
    const sn = this.snail;
    sn.a += Math.sin(t * 0.13) * 0.05 * dt;
    sn.x += Math.cos(sn.a) * 2.2 * s * dt;
    sn.y += Math.sin(sn.a) * 2.2 * s * dt;
    if (sn.x < this.w * 0.55 || sn.x > this.w - this.gl - 14 * s || sn.y < surfY + 60 * s || sn.y > this.floorY - 70 * s) sn.a += Math.PI * 1.2 * dt;
    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 0.5;
      this.stat('fish', this.fish.length);
      this.stat('food', this.food.length);
    }
  }

  private drawBlade(ctx: CanvasRenderingContext2D, p: Blade) {
    const s = this.s;
    const t = this.t;
    const segs = 10;
    const pts: [number, number][] = [];
    for (let i = 0; i <= segs; i++) {
      const k = i / segs;
      const sway = (Math.sin(t * p.sp + p.p + k * 2.4) * 22 * k * k + Math.sin(t * 0.33 + p.p) * 8 * k) * s;
      pts.push([p.x + sway, p.base - k * p.h]);
    }
    ctx.fillStyle = p.color;
    ctx.beginPath();
    for (let i = 0; i <= segs; i++) {
      const half = (p.bw * (1 - (i / segs) * 0.9)) / 2;
      if (i) ctx.lineTo(pts[i][0] - half, pts[i][1]);
      else ctx.moveTo(pts[i][0] - half, pts[i][1]);
    }
    for (let i = segs; i >= 0; i--) {
      const half = (p.bw * (1 - (i / segs) * 0.9)) / 2;
      ctx.lineTo(pts[i][0] + half, pts[i][1]);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(190,255,210,0.16)';
    ctx.lineWidth = Math.max(0.6, 0.9 * s);
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }

  private drawStem(ctx: CanvasRenderingContext2D, p: Stem) {
    const s = this.s;
    const t = this.t;
    const n = Math.max(6, Math.round(p.h / (13 * s)));
    const pts: [number, number][] = [];
    ctx.strokeStyle = '#2a6a48';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const x = p.x + (Math.sin(t * p.sp + p.p + k * 2.2) * 16 * k * k + Math.sin(t * 0.3 + p.p) * 7 * k) * s;
      const y = p.base - k * p.h;
      pts.push([x, y]);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    for (let i = 1; i <= n; i++) {
      const k = i / n;
      const [x, y] = pts[i];
      // the red stems turn redder toward the top: one accent among the greens
      ctx.fillStyle = p.red
        ? `rgb(${Math.round(60 + 150 * k * k)},${Math.round(150 - 60 * k * k)},${Math.round(90 - 20 * k)})`
        : `rgb(${Math.round(50 + 40 * k)},${Math.round(150 + 40 * k)},${Math.round(96 + 10 * k)})`;
      const L = p.leaf * (0.6 + 0.5 * Math.sin(k * Math.PI * 0.9 + 0.3));
      const tilt = 0.5 + 0.12 * Math.sin(t * 1.1 + i + p.p);
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(x + side * L * 0.55 * Math.cos(tilt), y - L * 0.55 * Math.sin(tilt), L * 0.6, L * 0.24, -side * tilt, 0, TAU);
        ctx.fill();
      }
    }
  }

  private drawFish(ctx: CanvasRenderingContext2D, f: Fish) {
    const spec = FISH[f.kind];
    const L = spec.len * this.s * f.size * (0.75 + 0.25 * f.depth);
    const H = L * spec.h;
    const wag = Math.sin(f.phase) * 0.22;
    const flip = (f.dir < 0 ? -1 : 1) * Math.max(0.12, Math.abs(f.dir));
    const pitch = clamp(Math.atan2(f.vy, Math.abs(f.vx) + 0.001), -0.4, 0.4);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.scale(flip, 1);
    ctx.rotate(pitch);
    ctx.globalAlpha = 0.55 + 0.45 * f.depth;
    ctx.fillStyle = spec.fin;
    ctx.beginPath();
    ctx.moveTo(-L * 0.36, 0);
    ctx.quadraticCurveTo(-L * 0.55, wag * H - H * 0.1, -L * 0.74, -H * 0.55 + wag * H * 1.5);
    ctx.quadraticCurveTo(-L * 0.62, wag * H, -L * 0.74, H * 0.55 + wag * H * 1.5);
    ctx.quadraticCurveTo(-L * 0.55, wag * H + H * 0.1, -L * 0.36, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(L * 0.08, -H * 0.4);
    ctx.quadraticCurveTo(-L * 0.08, -H * 0.88, -L * 0.26, -H * 0.36);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(L * 0.02, H * 0.38);
    ctx.quadraticCurveTo(-L * 0.1, H * 0.7, -L * 0.22, H * 0.34);
    ctx.closePath();
    ctx.fill();
    const g = ctx.createLinearGradient(0, -H / 2, 0, H / 2);
    g.addColorStop(0, spec.body[1]);
    g.addColorStop(0.5, spec.body[0]);
    g.addColorStop(1, spec.belly);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(L * 0.5, 0);
    ctx.bezierCurveTo(L * 0.42, -H * 0.64, -L * 0.18, -H * 0.62, -L * 0.4, -H * 0.06);
    ctx.lineTo(-L * 0.4, H * 0.06);
    ctx.bezierCurveTo(-L * 0.18, H * 0.6, L * 0.42, H * 0.64, L * 0.5, 0);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    if (f.kind === 'neon') {
      ctx.fillStyle = '#ff3d55';
      ctx.beginPath();
      ctx.ellipse(-L * 0.14, H * 0.2, L * 0.3, H * 0.24, 0, 0, TAU);
      ctx.fill();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = '#38d4ff';
      ctx.lineWidth = H * 0.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(L * 0.3, -H * 0.1);
      ctx.lineTo(-L * 0.36, -H * 0.02);
      ctx.stroke();
    } else if (f.kind === 'pearl' || f.kind === 'cory') {
      ctx.fillStyle = f.kind === 'pearl' ? 'rgba(255,255,255,0.55)' : 'rgba(40,34,26,0.5)';
      for (let i = 0; i < 14; i++) {
        const u = ((i * 37) % 13) / 13;
        const v = ((i * 17) % 7) / 7;
        ctx.beginPath();
        ctx.arc((-0.3 + u * 0.6) * L, (-0.3 + v * 0.55) * H, 0.022 * L, 0, TAU);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(255,240,200,0.28)';
      ctx.beginPath();
      ctx.ellipse(L * 0.1, -H * 0.18, L * 0.28, H * 0.12, -0.1, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = '#f4f7f8';
    ctx.beginPath();
    ctx.arc(L * 0.3, -H * 0.1, L * 0.055, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0b1114';
    ctx.beginPath();
    ctx.arc(L * 0.315, -H * 0.1, L * 0.032, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  private surf(x: number) {
    const { s, t } = this;
    return this.surfY + Math.sin(x * 0.03 + t * 1.6) * 2 * s + Math.sin(x * 0.011 - t) * 1.6 * s;
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, s, t, surfY, floorY, gl } = this;
    const N = this.night;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, w, h);
    ctx.save();
    ctx.beginPath();
    ctx.rect(gl, 0, w - gl * 2, floorY);
    ctx.clip();
    /* light shafts and caustics on the sand */
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rays) {
      const sway = Math.sin(t * 0.22 + r.p) * 36 * s;
      const a = (0.06 + 0.04 * Math.sin(t * 0.55 + r.p * 2)) * r.a;
      const g = ctx.createLinearGradient(0, surfY, 0, floorY);
      g.addColorStop(0, `rgba(180,245,255,${a})`);
      g.addColorStop(1, 'rgba(180,245,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(r.x - r.w / 2, surfY);
      ctx.lineTo(r.x + r.w / 2, surfY);
      ctx.lineTo(r.x + r.w * 1.3 + sway + 50 * s, floorY);
      ctx.lineTo(r.x - r.w * 0.3 + sway + 50 * s, floorY);
      ctx.closePath();
      ctx.fill();
    }
    const n = Math.round(w / (26 * s));
    for (let i = 0; i < n; i++) {
      const cx = (i / n) * w + Math.sin(t * 0.5 + i * 1.3) * 18 * s;
      const cy = this.sandAt(cx) + (10 + 8 * Math.sin(i * 2.1)) * s;
      ctx.globalAlpha = 0.12 + 0.09 * Math.sin(t * 1.4 + i * 2.3);
      ctx.drawImage(this.caustic, cx - 28 * s, cy - 7 * s, 56 * s, 14 * s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.blades) if (!p.front) this.drawBlade(ctx, p);
    for (const p of this.stems) this.drawStem(ctx, p);
    for (const f of this.fish) this.drawFish(ctx, f);
    for (const p of this.blades) if (p.front) this.drawBlade(ctx, p);
    ctx.fillStyle = '#d98a42';
    for (const p of this.food) {
      ctx.globalAlpha = p.settled ? clamp((FOOD_LIFE - p.age) / 4, 0, 1) : 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2.4 * s, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(0.8, s);
    for (const b of this.bubbles) {
      ctx.strokeStyle = 'rgba(220,250,255,0.55)';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28, 0, TAU);
      ctx.fill();
    }
    /* the surface: from below it shines like a mirror */
    ctx.globalCompositeOperation = 'lighter';
    const sg = ctx.createLinearGradient(0, surfY, 0, surfY + 46 * s);
    sg.addColorStop(0, 'rgba(200,250,255,0.3)');
    sg.addColorStop(1, 'rgba(200,250,255,0)');
    ctx.fillStyle = sg;
    ctx.beginPath();
    ctx.moveTo(0, surfY + 46 * s);
    for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, this.surf(x));
    ctx.lineTo(w + 8, surfY + 46 * s);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(230,255,255,0.75)';
    ctx.lineWidth = 1.6 * s;
    ctx.beginPath();
    for (let x = 0; x <= w + 8; x += 8) {
      const y = this.surf(x);
      if (x) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    for (const r of this.ripples) {
      const k = r.age / (r.big ? 1.6 : 0.8);
      const half = (r.big ? 10 + 70 * k : 4 + 18 * k) * s;
      ctx.strokeStyle = `rgba(235,255,255,${(r.big ? 0.8 : 0.5) * (1 - k)})`;
      ctx.lineWidth = (r.big ? 2.4 : 1.4) * s;
      ctx.beginPath();
      for (let x = r.x - half; x <= r.x + half; x += 6) {
        const y = this.surf(x) - 1.5 * s;
        if (x > r.x - half) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    if (this.variant === 'full') {
      const sn = this.snail;
      const sr = 7 * s;
      ctx.save();
      ctx.translate(sn.x, sn.y);
      ctx.rotate(sn.a);
      ctx.fillStyle = 'rgba(96,84,60,0.9)';
      ctx.beginPath();
      ctx.ellipse(sr * 0.4, sr * 0.5, sr * 1.3, sr * 0.42, 0, 0, TAU);
      ctx.fill();
      const shg = ctx.createRadialGradient(-sr * 0.2, -sr * 0.3, sr * 0.1, 0, 0, sr);
      shg.addColorStop(0, '#d9b070');
      shg.addColorStop(1, '#6b4526');
      ctx.fillStyle = shg;
      ctx.beginPath();
      ctx.arc(0, 0, sr, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(60,34,16,0.7)';
      ctx.lineWidth = Math.max(0.8, s);
      ctx.beginPath();
      ctx.arc(0, 0, sr * 0.55, 0.4, TAU * 0.8);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.drawImage(this.front, 0, 0, w, h);
    /* 달빛 조명: everything sinks into blue; only the neon tetras' stripes glow */
    if (N > 0.01) {
      const m = (a: number, b: number) => Math.round(a + (b - a) * N);
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgb(${m(255, 58)},${m(255, 88)},${m(255, 165)})`;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createLinearGradient(0, 0, 0, floorY);
      g.addColorStop(0, `rgba(90,130,255,${0.22 * N})`);
      g.addColorStop(0.5, `rgba(60,100,230,${0.06 * N})`);
      g.addColorStop(1, 'rgba(60,100,230,0)');
      ctx.fillStyle = g;
      ctx.fillRect(gl, 0, w - gl * 2, floorY);
      for (const f of this.fish) {
        if (f.kind !== 'neon') continue;
        const L = FISH.neon.len * s * f.size;
        ctx.globalAlpha = 0.34 * N * (0.55 + 0.45 * f.depth);
        ctx.drawImage(this.neonGlow, f.x - L * 0.62, f.y - L * 0.3, L * 1.24, L * 0.6);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    /* where the glass was tapped */
    ctx.globalCompositeOperation = 'lighter';
    for (const tp of this.taps) {
      const k = tp.age / 0.9;
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, (10 + 46 * k) * s, 0, TAU);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.vig, 0, 0, w, h);
  }
}
