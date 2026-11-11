import { Scene, type SceneVariant } from './base';
import {
  TAU, clamp, easeOutBounce, glow, layer, mix, pick, rand, rgb, roundRect, smooth, type RGB,
} from './util';

export type WoodKind = 'oak' | 'pine' | 'birch';

/** Oak burns long and low, pine crackles, throws sparks and sways, birch flares tall and bright. */
export const WOOD: Record<WoodKind, {
  life: number; bark: readonly [RGB, RGB]; sparks: number; bright: number; tall: number; turb: number;
}> = {
  oak: { life: 1.5, bark: [[116, 80, 52], [56, 37, 24]], sparks: 1, bright: 1, tall: 1, turb: 0.85 },
  pine: { life: 0.85, bark: [[152, 86, 48], [78, 40, 22]], sparks: 1.8, bright: 1.05, tall: 1.1, turb: 1.3 },
  birch: { life: 0.8, bark: [[234, 228, 214], [160, 152, 138]], sparks: 1, bright: 1.3, tall: 1.2, turb: 1 },
};

interface Crack { u: number; v: number; l: number; a: number; p: number }
interface Ash { u: number; v: number; r: number }
interface Log {
  x: number; y: number; a: number; len: number; th: number;
  burn: number; ignite: number; drop: number; life: number; fast: boolean;
  kind: WoodKind; cracks: Crack[]; ash: Ash[];
  /** How hard it is burning right now, 0..1. */
  power: number;
  /** A small turn it was given by the last poke; settles back by itself. */
  jolt: number;
  /** Its bark, painted once. */
  tex: HTMLCanvasElement;
}
interface Spark { x: number; y: number; px: number; py: number; vx: number; vy: number; life: number; max: number; r: number; seed: number }
interface Smoke { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number }
interface Stone { a: number; w: number; h: number; tone: number; rot: number; verts: number[]; front: boolean }
interface Coal { x: number; y: number; r: number; rot: number; seed: number; verts: number[] }
interface Star { x: number; y: number; r: number; p: number; sp: number }
interface Tree { x: number; th: number; tw: number; lean: number }
/** What the burning logs add up to: each wood pulls the fire its own way. */
interface Mood { bright: number; tall: number; turb: number; sparks: number }
/** Low-resolution heat map the flames are drawn from. */
interface Field {
  cols: number; rows: number; cell: number; x0: number;
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData;
  bloom: HTMLCanvasElement; bctx: CanvasRenderingContext2D;
  heat: Float32Array; hgt: Float32Array; base: Float32Array;
}

const MAX_LOGS = 5;
const DROP_TIME = 0.7; // s for a new log to fall and settle
/** With less wood than this burning, and nothing catching fire, only embers are left. */
const EMBERS_BELOW = 0.6;
/** A log this far burnt is char: it no longer counts as a log. */
const SPENT = 0.8;
/** First contact of the bounce (easeOutBounce reaches 1 at x = 1/2.75). */
const FIRST_CONTACT = DROP_TIME / 2.75;

/* ---------- tileable noise: shapes the flames, flickers the light, lets each coal breathe ---------- */
const NS = 256;
const NOISE = (() => {
  const out = new Float32Array(NS * NS);
  let amp = 1;
  let total = 0;
  for (const period of [4, 8, 16, 32]) {
    const g = new Float32Array(period * period);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    const cell = NS / period;
    for (let y = 0; y < NS; y++) {
      const gy = y / cell;
      const y0 = Math.floor(gy);
      const ty = gy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const r0 = (y0 % period) * period;
      const r1 = ((y0 + 1) % period) * period;
      for (let x = 0; x < NS; x++) {
        const gx = x / cell;
        const x0 = Math.floor(gx);
        const tx = gx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const c0 = x0 % period;
        const c1 = (x0 + 1) % period;
        const top = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * sx;
        const bot = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * sx;
        out[y * NS + x] += amp * (top + (bot - top) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] = clamp((out[i] / total - 0.5) * 1.9 + 0.5, 0, 1);
  return out;
})();

function ns(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const x0 = xi & 255;
  const x1 = (xi + 1) & 255;
  const y0 = (yi & 255) << 8;
  const y1 = ((yi + 1) & 255) << 8;
  const a = NOISE[y0 + x0];
  const b = NOISE[y0 + x1];
  const c = NOISE[y1 + x0];
  const d = NOISE[y1 + x1];
  const top = a + (b - a) * fx;
  return top + (c + (d - c) * fx - top) * fy;
}

/* ---------- flame colour ramp: heat 0..1 → dark red, orange, pale yellow (RGBA) ---------- */
const LUT = (() => {
  const stops = [
    [0.0, 50, 6, 2, 0],
    [0.12, 90, 12, 4, 0],
    [0.22, 176, 34, 8, 0.42],
    [0.38, 246, 84, 16, 0.74],
    [0.56, 255, 138, 34, 0.86],
    [0.76, 255, 196, 84, 0.92],
    [1.0, 255, 236, 180, 0.96],
  ];
  const out = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    let k = 0;
    while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
    const a = stops[k];
    const b = stops[k + 1];
    const t = clamp((v - a[0]) / (b[0] - a[0]), 0, 1);
    out[i * 4] = a[1] + (b[1] - a[1]) * t;
    out[i * 4 + 1] = a[2] + (b[2] - a[2]) * t;
    out[i * 4 + 2] = a[3] + (b[3] - a[3]) * t;
    out[i * 4 + 3] = (a[4] + (b[4] - a[4]) * t) * 255;
  }
  return out;
})();

/** A lumpy closed shape (stones, coals): an ellipse whose radius varies per vertex. */
function blob(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, verts: number[], rot: number) {
  const n = verts.length;
  const pt = (i: number): [number, number] => {
    const a = (i / n) * TAU + rot;
    return [x + Math.cos(a) * rx * verts[i % n], y + Math.sin(a) * ry * verts[i % n]];
  };
  ctx.beginPath();
  let [px, py] = pt(0);
  let [qx, qy] = pt(1);
  ctx.moveTo((px + qx) / 2, (py + qy) / 2);
  for (let i = 1; i <= n; i++) {
    [px, py] = pt(i);
    [qx, qy] = pt(i + 1);
    ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
  }
  ctx.closePath();
}

/** Bark for one log, drawn once (log px at scale 1, ×2 for sharpness). */
function barkTexture(kind: WoodKind, len: number, th: number) {
  const K = 2;
  const c = document.createElement('canvas');
  c.width = Math.ceil(len * K);
  c.height = Math.ceil(th * K);
  const x = c.getContext('2d')!;
  x.scale(K, K);
  const [hi, lo] = WOOD[kind].bark;
  const g = x.createLinearGradient(0, 0, 0, th);
  g.addColorStop(0, rgb(mix(hi, [255, 236, 210], 0.12)));
  g.addColorStop(0.3, rgb(hi));
  g.addColorStop(1, rgb(lo));
  x.fillStyle = g;
  x.fillRect(0, 0, len, th);
  if (kind === 'birch') {
    // lenticels run around the trunk; a few dark "eyes"
    x.strokeStyle = 'rgba(40,32,26,0.7)';
    for (let i = 0; i < 46; i++) {
      const px = rand(4, len - 12);
      const py = rand(2, th - 2);
      x.lineWidth = rand(0.6, 1.5);
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(px + rand(-0.6, 0.6), py + rand(2.5, 7));
      x.stroke();
    }
    x.fillStyle = 'rgba(34,26,22,0.8)';
    for (let i = 0; i < 3; i++) {
      x.beginPath();
      x.ellipse(rand(16, len - 30), rand(th * 0.3, th * 0.75), rand(4, 8), rand(1.6, 3), rand(-0.2, 0.2), 0, TAU);
      x.fill();
    }
    x.fillStyle = 'rgba(198,150,100,0.35)';
    for (let i = 0; i < 4; i++) x.fillRect(rand(0, len - 30), rand(0, th), rand(10, 26), rand(1, 2.4));
  } else if (kind === 'pine') {
    // reddish plates split by dark furrows
    x.strokeStyle = 'rgba(30,14,8,0.55)';
    x.lineWidth = 1.1;
    for (let row = 0; row < 4; row++) {
      const y0 = (row + 0.5) * (th / 4) + rand(-1.5, 1.5);
      x.beginPath();
      x.moveTo(0, y0);
      for (let px = 0; px <= len; px += 9) x.lineTo(px, y0 + rand(-1.6, 1.6));
      x.stroke();
      for (let px = rand(4, 16); px < len; px += rand(12, 24)) {
        x.beginPath();
        x.moveTo(px, y0);
        x.lineTo(px + rand(-2, 2), y0 + th / 4);
        x.stroke();
      }
    }
    x.fillStyle = 'rgba(214,128,70,0.22)';
    for (let i = 0; i < 26; i++) x.fillRect(rand(0, len), rand(0, th * 0.6), rand(4, 10), rand(1, 2.5));
  } else {
    // oak: long wavy grooves
    for (let i = 0; i < 16; i++) {
      const y0 = rand(1, th - 1);
      let px = rand(-10, len * 0.6);
      const end = px + rand(26, 90);
      x.strokeStyle = i % 4 === 0 ? 'rgba(170,124,84,0.3)' : 'rgba(20,12,7,0.5)';
      x.lineWidth = rand(0.7, 1.6);
      x.beginPath();
      x.moveTo(px, y0);
      for (; px < end; px += 8) x.lineTo(px, y0 + rand(-1.1, 1.1));
      x.stroke();
    }
    x.fillStyle = 'rgba(20,12,7,0.55)';
    x.beginPath();
    x.ellipse(rand(30, len - 50), rand(th * 0.35, th * 0.7), 5, 2.6, 0, 0, TAU);
    x.fill();
  }
  // round it off: darker underside
  const sh = x.createLinearGradient(0, 0, 0, th);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(0.55, 'rgba(0,0,0,0.12)');
  sh.addColorStop(1, 'rgba(0,0,0,0.62)');
  x.fillStyle = sh;
  x.fillRect(0, 0, len, th);
  return c;
}

/**
 * 불멍: a campfire whose logs really burn down; add logs to keep it going.
 * The flames are a low-resolution heat map turned into flame colours, so they split into tongues
 * and tear off. The ground, stones and trees are painted fully lit and darkened by the fire's light.
 */
export class Fire extends Scene {
  private fx = 0.5;
  private fy = 0.635;
  private fyBase = 0.635;
  private fyTarget = 0.635;
  private cx = 0;
  private by = 0;
  private logs: Log[] = [];
  private sparks: Spark[] = [];
  private smoke: Smoke[] = [];
  private backStones: Stone[] = [];
  private frontStones: Stone[] = [];
  private twinkles: Star[] = [];
  private flare = 0;
  private cool = 0;
  private sinceAdd = 0;
  /** Add a log by itself when the fire runs low, so a long session never goes dark. */
  autoTend = true;
  private added = 0;
  private fuel = 0;
  private intensity = 0.6;
  /** How hot the bed of coals is. It builds up as logs burn and outlasts the flames. */
  private coal = 0.6;
  /** The light everything else is lit by: follows the flames, with a living flicker. */
  private light = 0.6;
  private wind = 0;
  /** A jolt (a log landing, a poke) that wakes the coals for a moment. */
  private kick = 0;
  private mood: Mood = { bright: 1, tall: 1, turb: 1, sparks: 1 };
  private statTimer = 0;
  private acc = { spark: 0, smoke: 0 };
  private readonly ember = glow(255, 120, 36, 0.3);
  private readonly emberHot = glow(255, 190, 90, 0.25);
  private readonly smokeSprite = glow(132, 124, 118, 0.5);
  private readonly coals: Coal[] = Array.from({ length: 54 }, () => {
    const a = rand(0, TAU);
    const r = Math.sqrt(Math.random());
    return {
      x: Math.cos(a) * r, y: Math.sin(a) * r, r: rand(5, 12), rot: rand(0, TAU), seed: rand(0, 200),
      verts: Array.from({ length: 7 }, () => rand(0.7, 1.15)),
    };
  }).sort((p, q) => p.y - q.y);
  private field!: Field;
  private lit!: HTMLCanvasElement;
  private sky!: HTMLCanvasElement;
  private skyH = 0;
  private vig!: HTMLCanvasElement;

  constructor(variant: SceneVariant) {
    super(variant);
    const start: [number, number, number, number, number, number][] = [
      [-38, -13, -0.44, 158, 27, 0.3],
      [38, -13, 0.44, 158, 27, 0.22],
      [0, 5, 0.05, 184, 29, 0.12],
    ];
    for (const [x, y, a, len, th, burn] of start) {
      this.logs.push(this.makeLog({ x, y, a, len, th, burn, ignite: 1, drop: 1, kind: 'oak' }));
    }
  }

  private makeLog(o: Partial<Log> & Pick<Log, 'x' | 'y' | 'a' | 'len' | 'th' | 'kind'>): Log {
    return {
      burn: 0,
      ignite: 0,
      drop: 0,
      power: 0,
      jolt: 0,
      life: rand(85, 125) * WOOD[o.kind].life,
      fast: false,
      cracks: Array.from({ length: 13 }, () => ({
        u: rand(-0.4, 0.32), v: rand(-0.32, 0.34), l: rand(0.04, 0.13), a: rand(-0.7, 0.7), p: rand(0, TAU),
      })),
      ash: Array.from({ length: 16 }, () => ({ u: rand(-0.42, 0.36), v: rand(-0.4, 0.1), r: rand(1.5, 4.5) })),
      tex: barkTexture(o.kind, o.len, o.th),
      ...o,
    };
  }

  layout() {
    const { w, h, dpr } = this;
    const card = this.variant === 'card';
    const wide = w > 900;
    const landscape = w > h && h < 520; // landscape phone
    let scale = wide ? 1 : 1.1;
    let fit = 640; // the screen height the scene is composed for
    let rise = landscape ? 150 : 215; // how far above the fire the horizon sits
    this.fx = 0.5;
    this.fyBase = landscape ? 0.74 : wide ? 0.69 : 0.635;
    if (card) {
      fit = 420;
      rise = 150;
      if (w / h > 1.4) {
        this.fx = 0.7;
        this.fyBase = 0.7;
        scale = 1.05;
      } else {
        this.fyBase = 0.52;
        scale = 0.85;
      }
    }
    if (this.fyTarget === this.fy) this.fyTarget = this.fyBase;
    this.fy = this.fyTarget;
    const s = (this.s = clamp(Math.min(w / 390, h / fit), 0.3, 2) * scale);
    const cx = (this.cx = w * this.fx);
    this.by = h * this.fy;
    // the backdrop is painted for the fire's resting place; a lift (open tray) only moves the fire
    const by = h * this.fyBase;
    const hz = Math.max(h * 0.12, by - rise * s);

    /* flame heat field */
    const cell = Math.max(1.6, 2.3 * s);
    const cols = Math.round((400 * s) / cell);
    const rows = Math.round((430 * s) / cell);
    const fc = document.createElement('canvas');
    fc.width = cols;
    fc.height = rows;
    const fctx = fc.getContext('2d')!;
    const bc = document.createElement('canvas');
    bc.width = Math.ceil(cols / 5);
    bc.height = Math.ceil(rows / 5);
    this.field = {
      cols, rows, cell, x0: cx - (cols * cell) / 2,
      canvas: fc, ctx: fctx, img: fctx.createImageData(cols, rows),
      bloom: bc, bctx: bc.getContext('2d')!,
      heat: new Float32Array(cols), hgt: new Float32Array(cols), base: new Float32Array(cols),
    };

    /* stones around the pit */
    const N = 13;
    const stones: Stone[] = Array.from({ length: N }, (_, i) => {
      const a = (i / N) * TAU + rand(-0.08, 0.08) + 0.12;
      return {
        a, w: rand(40, 58), h: rand(24, 34), tone: rand(0.8, 1.15), rot: rand(0, TAU),
        verts: Array.from({ length: 9 }, () => rand(0.84, 1.1)), front: Math.sin(a) > 0.08,
      };
    });
    const byDepth = (a: Stone, b: Stone) => Math.sin(a.a) - Math.sin(b.a);
    this.backStones = stones.filter((st) => !st.front).sort(byDepth);
    this.frontStones = stones.filter((st) => st.front).sort(byDepth);

    /* forest: one list of trees, drawn on the lit layer and cut out of the sky layer */
    const trees: Tree[] = [];
    for (let tx = -20; tx < w + 30;) {
      const near = Math.abs(tx - cx) < 120 * s;
      let th = rand(120, 250) * s * (near ? 0.62 : 1);
      if (card) th = Math.min(th, hz * rand(0.55, 0.9)); // a preview is short: leave some sky
      const tw = th * rand(0.3, 0.4);
      trees.push({ x: tx, th, tw, lean: rand(-0.03, 0.03) });
      tx += tw * rand(0.4, 0.8);
    }
    const forest = (x: CanvasRenderingContext2D, lit: boolean) => {
      // far ridge
      x.fillStyle = lit ? '#15110f' : '#000';
      x.beginPath();
      x.moveTo(-10, hz + 4);
      for (let px = -10; px <= w + 20; px += 16) {
        x.lineTo(px, hz - (40 + 20 * Math.sin(px * 0.006 + 1) + 9 * Math.sin(px * 0.023)) * s);
      }
      x.lineTo(w + 20, hz + 4);
      x.closePath();
      x.fill();
      for (const tr of trees) {
        const side = tr.x < cx ? 1 : -1; // which side faces the fire
        for (let k = 0; k < 5; k++) {
          const bottom = hz + 4 - tr.th * 0.19 * k;
          const top = bottom - tr.th * (k === 4 ? 0.3 : 0.36);
          const half = (tr.tw / 2) * (1 - 0.17 * k);
          const tipX = tr.x + tr.lean * tr.th;
          x.fillStyle = lit ? '#0d0b09' : '#000';
          x.beginPath();
          x.moveTo(tr.x - half, bottom);
          x.lineTo(tipX, top);
          x.lineTo(tr.x + half, bottom);
          x.closePath();
          x.fill();
          if (lit) {
            // the half that faces the fire catches a little warm light
            x.fillStyle = 'rgba(150,84,40,0.5)';
            x.beginPath();
            x.moveTo(tr.x + side * half, bottom);
            x.lineTo(tipX, top);
            x.lineTo(tr.x + side * half * 0.25, bottom);
            x.closePath();
            x.fill();
          }
        }
      }
    };

    this.lit = layer(w, h, dpr, (x) => {
      // ground as if fully lit; the per-frame light mask darkens it
      const g = x.createLinearGradient(0, hz, 0, h);
      g.addColorStop(0, '#3a2819');
      g.addColorStop(1, '#5a3d25');
      x.fillStyle = g;
      x.fillRect(0, hz, w, h - hz);
      const depth = (y: number) => 0.35 + 1.1 * clamp((y - hz) / (h - hz), 0, 1); // things get bigger toward the viewer
      for (let i = 0; i < 2600; i++) {
        const y = hz + Math.pow(Math.random(), 0.8) * (h - hz);
        const k = depth(y);
        x.fillStyle = Math.random() < 0.5 ? 'rgba(20,12,6,0.4)' : 'rgba(190,140,92,0.3)';
        x.fillRect(rand(0, w), y, rand(1, 2.6) * k * s, rand(0.6, 1.3) * k * s);
      }
      for (let i = 0; i < 90; i++) {
        const y = hz + 10 * s + Math.random() * (h - hz);
        const k = depth(y);
        const px = rand(0, w);
        const pg = x.createLinearGradient(0, y - 3 * k * s, 0, y + 3 * k * s);
        pg.addColorStop(0, 'rgba(186,160,136,0.9)');
        pg.addColorStop(1, 'rgba(50,38,30,0.9)');
        x.fillStyle = pg;
        x.beginPath();
        x.ellipse(px, y, rand(2.5, 7) * k * s, rand(1.4, 3.4) * k * s, rand(-0.3, 0.3), 0, TAU);
        x.fill();
      }
      x.lineCap = 'round';
      for (let i = 0; i < 26; i++) {
        const y = hz + 20 * s + Math.random() * (h - hz);
        const k = depth(y);
        const px = rand(0, w);
        const a = rand(-0.5, 0.5);
        x.strokeStyle = 'rgba(46,28,16,0.8)';
        x.lineWidth = rand(1, 2.2) * k * s;
        x.beginPath();
        x.moveTo(px, y);
        x.lineTo(px + Math.cos(a) * rand(10, 30) * k * s, y + Math.sin(a) * 6 * k * s);
        x.stroke();
      }
      // grass tufts, thicker away from the pit
      for (let i = 0; i < 150; i++) {
        const y = hz + Math.random() * (h - hz);
        const k = depth(y);
        const px = rand(-10, w + 10);
        if (Math.hypot((px - cx) / (215 * s), (y - by) / (95 * s)) < 1) continue;
        for (let b = 0; b < 6; b++) {
          const lean = rand(-0.5, 0.5);
          const bl = rand(8, 20) * k * s;
          x.strokeStyle = Math.random() < 0.5 ? 'rgba(118,98,48,0.85)' : 'rgba(54,52,26,0.9)';
          x.lineWidth = rand(0.8, 1.6) * k * s;
          x.beginPath();
          x.moveTo(px + b * 1.5 * k, y);
          x.quadraticCurveTo(px + b * 1.5 * k + lean * bl * 0.4, y - bl * 0.6, px + b * 1.5 * k + lean * bl, y - bl);
          x.stroke();
        }
      }
      const far = x.createLinearGradient(0, hz, 0, hz + 120 * s);
      far.addColorStop(0, 'rgba(6,5,5,0.92)');
      far.addColorStop(1, 'rgba(6,5,5,0)');
      x.fillStyle = far;
      x.fillRect(0, hz, w, 120 * s);
      forest(x, true);
    });

    // only as tall as the sky itself, so drawing it every frame stays cheap
    const top = hz + 2;
    this.skyH = Math.ceil(hz + 6);
    this.sky = layer(w, this.skyH, dpr, (x) => {
      const g = x.createLinearGradient(0, 0, 0, top);
      g.addColorStop(0, '#03050b');
      g.addColorStop(0.6, '#0a0f1d');
      g.addColorStop(1, '#131726');
      x.fillStyle = g;
      x.fillRect(0, 0, w, top);
      // a faint band of milky way
      x.save();
      x.translate(w * 0.62, top * 0.3);
      x.rotate(-0.5);
      const mw = x.createLinearGradient(0, -90 * s, 0, 90 * s);
      mw.addColorStop(0, 'rgba(150,170,230,0)');
      mw.addColorStop(0.5, 'rgba(150,170,230,0.07)');
      mw.addColorStop(1, 'rgba(150,170,230,0)');
      x.fillStyle = mw;
      x.fillRect(-w, -90 * s, w * 2, 180 * s);
      x.restore();
      const stars = card ? Math.round(230 * clamp((w * top) / 117_000, 0.1, 1)) : 230;
      for (let i = 0; i < stars; i++) {
        x.globalAlpha = rand(0.15, 0.75) * (Math.random() < 0.1 ? 1.3 : 0.8);
        x.fillStyle = Math.random() < 0.2 ? '#ffe9cf' : '#e6ecff';
        const r = rand(0.4, 1.3);
        x.fillRect(rand(0, w), Math.pow(Math.random(), 1.3) * top, r, r);
      }
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'destination-out';
      forest(x, false);
    });
    // a few stars above the treetops twinkle
    this.twinkles = Array.from({ length: 16 }, () => ({
      x: rand(0, w), y: rand(0, Math.max(10, hz - 250 * s)) * 0.9, r: rand(1, 1.8), p: rand(0, TAU), sp: rand(0.6, 2.2),
    }));

    this.vig = layer(w, h, dpr, (x) => {
      const g = x.createRadialGradient(w / 2, h * 0.56, Math.min(w, h) * 0.34, w / 2, h * 0.56, Math.hypot(w, h) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.62)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
    });
  }

  /** Lift the fire a little so a bottom sheet doesn't cover it. */
  setLift(on: boolean) {
    this.fyTarget = on ? Math.min(this.fyBase, 0.6) : this.fyBase;
  }

  /** Where the fire sits (once any lift has settled), for drag-and-drop targets. */
  get firePoint() {
    return { x: this.cx, y: this.h * this.fyTarget, s: this.s };
  }

  isNearFire(x: number, y: number) {
    const s = this.s;
    return Math.hypot((x - this.cx) / (175 * s), (y - (this.by - 40 * s)) / (130 * s)) < 1;
  }

  /** A log the visitor added (resets the auto-tend clock). */
  addLogByHand(kind: WoodKind = 'oak', atX?: number) {
    this.sinceAdd = 0;
    this.addLog(kind, atX);
  }

  addLog(kind: WoodKind = 'oak', atX?: number) {
    if (this.logs.length >= MAX_LOGS) {
      const oldest = this.logs.reduce((a, b) => (a.burn > b.burn ? a : b));
      oldest.fast = true;
    }
    this.added += 1;
    const side = this.added % 2 ? 1 : -1;
    const x = atX === undefined ? rand(-26, 26) : clamp((atX - this.cx) / this.s, -30, 30);
    this.logs.push(this.makeLog({ x, y: rand(-24, -10), a: side * rand(0.14, 0.52), len: rand(140, 172), th: rand(23, 29), kind }));
    this.cool = 4;
    this.emit('add', { kind, impactIn: FIRST_CONTACT });
  }

  private land(L: Log) {
    const burst = Math.round(36 * WOOD[L.kind].sparks * this.motion);
    for (let i = 0; i < burst; i++) this.spawnSpark(true);
    this.flare = Math.max(this.flare, WOOD[L.kind].bright * 0.8);
    this.kick = 0.6;
    this.emit('land', { kind: L.kind });
  }

  /**
   * 뒤적이기: a tap on the fire stirs it. Sparks fly, the coals wake up and the flames jump for a
   * couple of seconds. Returns whether the tap was on the fire.
   */
  pokeAt(x: number, y: number) {
    const s = this.s;
    if (Math.hypot((x - this.cx) / (170 * s), (y - (this.by - 60 * s)) / (170 * s)) >= 1) return false;
    if (this.kick > 0.85) return true; // just poked: let it settle a moment before the next one
    const burst = Math.round(46 * (0.5 + this.coal) * this.motion);
    for (let i = 0; i < burst; i++) this.spawnSpark(true);
    this.flare = Math.max(this.flare, 0.9);
    this.kick = 1;
    this.coal = Math.min(1, this.coal + 0.25);
    for (const L of this.logs) {
      if (L.drop < 1) continue;
      L.jolt = rand(-0.05, 0.05);
      L.burn = Math.min(0.99, L.burn + 0.015); // stirring burns the wood a little faster
    }
    this.emit('poke');
    return true;
  }

  tap(x: number, y: number) {
    this.pokeAt(x, y);
  }

  audioState() {
    return { intensity: this.intensity, crackle: this.mood.sparks };
  }

  private spawnSpark(burst: boolean) {
    const s = this.s;
    const x = this.cx + rand(-50, 50) * s;
    const y = this.by - rand(burst ? 0 : 30, burst ? 40 : 130) * s;
    this.sparks.push({
      x,
      y,
      px: x,
      py: y,
      vx: rand(-34, 34) * s * (burst ? 2.4 : 1) + this.wind * 30 * s,
      vy: -rand(80, 190) * s * (burst ? 1.45 : 1),
      life: 0,
      max: rand(0.9, 2.8),
      r: rand(0.7, 1.7) * Math.max(0.8, s),
      seed: rand(0, TAU),
    });
  }

  step(dt: number) {
    const s = this.s;
    this.t += dt;
    const t = this.t;
    if (this.fy !== this.fyTarget) {
      this.fy += (this.fyTarget - this.fy) * Math.min(1, dt * 4);
      if (Math.abs(this.fy - this.fyTarget) < 0.001) this.fy = this.fyTarget;
      this.by = this.h * this.fy;
    }

    let fuel = 0;
    let bright = 0;
    let tall = 0;
    let turb = 0;
    let sparks = 0;
    let wsum = 0;
    for (const L of this.logs) {
      if (L.drop < 1) {
        L.drop = Math.min(1, L.drop + dt / DROP_TIME);
        if (L.drop === 1) this.land(L);
        continue;
      }
      L.ignite = Math.min(1, L.ignite + dt / 3.5);
      const burnt = (dt / L.life) * (0.35 + 0.65 * L.ignite) * (L.fast ? 7 : 1);
      L.burn += burnt;
      this.coal = Math.min(1, this.coal + burnt * 0.5);
      L.power = L.ignite * (1 - smooth(0.5, 1, L.burn));
      const W = WOOD[L.kind];
      fuel += L.power * (L.len / 160);
      bright += W.bright * L.power;
      tall += W.tall * L.power;
      turb += W.turb * L.power;
      sparks += W.sparks * L.power;
      wsum += L.power;
      if (L.jolt) L.jolt *= Math.pow(0.02, dt);
    }
    this.logs = this.logs.filter((L) => L.burn < 1);
    this.mood = wsum > 0.01
      ? { bright: bright / wsum, tall: tall / wsum, turb: turb / wsum, sparks: sparks / wsum }
      : { bright: 1, tall: 1, turb: 1, sparks: 1 };
    this.coal = Math.max(0.12, this.coal - dt / 420);

    this.cool -= dt;
    this.sinceAdd += dt;
    if (this.variant === 'card') {
      if (this.cool <= 0 && (this.logs.length < 3 || fuel < 1.5)) this.addLog();
    } else if (this.autoTend && this.cool <= 0 && this.sinceAdd > 20 && (this.logs.length < 2 || fuel < 1.3)) {
      this.addLog(pick<WoodKind>(['oak', 'oak', 'pine', 'birch']));
    }

    this.flare = Math.max(0, this.flare - dt / 2.6);
    this.kick = Math.max(0, this.kick - dt / 1.4);
    this.wind = 0.5 * Math.sin(t * 0.13) + 0.32 * Math.sin(t * 0.31 + 1.7) + 0.18 * Math.sin(t * 0.83 + 0.4);
    this.fuel = fuel;
    this.intensity = clamp(fuel / 3.3 + this.flare * 0.2, 0.03, 1.25);
    const flicker = 0.8 + 0.4 * ns(t * 26, 11.5) + 0.12 * (ns(t * 90, 71.3) - 0.5);
    this.light = clamp((this.intensity * 0.92 + this.coal * 0.16) * flicker, 0, 1.3);

    this.acc.spark += dt * (0.8 + 5.5 * this.intensity) * this.mood.sparks * this.motion;
    while (this.acc.spark >= 1) {
      this.acc.spark -= 1;
      this.spawnSpark(false);
    }
    this.acc.smoke += dt * (2 + 2 * this.intensity);
    while (this.acc.smoke >= 1) {
      this.acc.smoke -= 1;
      this.smoke.push({
        x: this.cx + rand(-26, 26) * s,
        y: this.by - (70 + 150 * this.intensity) * s,
        vx: rand(-6, 6) * s,
        vy: -rand(20, 36) * s,
        life: 0,
        max: rand(4, 7.5),
        r: rand(20, 34) * s,
      });
    }

    for (const p of this.sparks) {
      p.life += dt;
      p.px = p.x;
      p.py = p.y;
      p.vx += (Math.sin(t * 3 + p.seed) * 60 + this.wind * 26) * s * dt;
      p.vy += 22 * s * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.sparks = this.sparks.filter((p) => p.life < p.max);
    for (const p of this.smoke) {
      p.life += dt;
      p.x += (p.vx + this.wind * 16 * s + Math.sin(t * 0.5 + p.y * 0.01) * 6 * s) * dt;
      p.y += p.vy * dt;
      p.r += 8 * s * dt;
    }
    this.smoke = this.smoke.filter((p) => p.life < p.max);

    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 0.3;
      this.stat('intensity', clamp(this.intensity / 1.2, 0, 1));
      this.stat('logs', this.logs.filter((L) => L.drop >= 1 && L.burn < SPENT).length);
      // 잔불: the flames are gone and no new log is catching
      this.stat('embers', this.fuel < EMBERS_BELOW && this.logs.every((L) => L.ignite >= 1) ? 1 : 0);
    }
  }

  /** Fill the heat field for this moment and turn it into flame colours. */
  private renderFlames() {
    const F = this.field;
    const { cols, rows, cell, heat, hgt, base } = F;
    const s = this.s;
    const t = this.t;
    const m = this.mood;
    const cxc = (this.cx - F.x0) / cell;
    // how much heat each column gets from the logs under it
    heat.fill(0);
    for (const L of this.logs) {
      if (L.drop < 1 || L.power <= 0.01) continue;
      const lx = (this.cx + L.x * s - F.x0) / cell;
      const hl = Math.max(14 * s, Math.abs(Math.cos(L.a)) * L.len * s * 0.44) / cell;
      const p = L.power * WOOD[L.kind].bright;
      const a = Math.max(0, Math.floor(lx - hl));
      const b = Math.min(cols - 1, Math.ceil(lx + hl));
      for (let i = a; i <= b; i++) {
        const u = (i - lx) / hl;
        if (u > -1 && u < 1) heat[i] += p * (1 - u * u) * 0.7;
      }
    }
    const core = Math.min(1, this.fuel / 2.2) * 0.55 + this.flare * 0.3;
    const cw = (54 * s) / cell;
    const maxH = rows * 0.56 * m.tall;
    for (let i = 0; i < cols; i++) {
      const u = (i - cxc) / cw;
      let hN = heat[i] + core * Math.exp(-u * u);
      // a few tongues of flame keep licking out of the coals even when the logs are spent
      hN += this.coal * 0.1 * smooth(0.56, 0.82, ns((i * cell * 0.16) / s + 40, t * 3)) * Math.exp(-u * u * 0.4);
      hN = Math.min(hN, 1.5);
      heat[i] = 0.36 + 0.36 * hN;
      hgt[i] = maxH * Math.pow(hN / 1.5, 0.72) * (0.45 + 0.95 * smooth(0.18, 0.92, ns((i * cell * 0.3) / s + 9, t * 10)));
      base[i] = (12 * s * Math.min(1, hN)) / cell;
    }
    const data = F.img.data;
    const fs = cell / s; // noise is sampled in scene units so every size looks alike
    const rise = t * 150;
    const rise2 = t * 250;
    const warp = (34 * m.turb) / fs;
    const lean = this.wind * 0.13;
    const conv = 0.32; // flames lean in toward the middle as they rise
    const a1 = 1.05 * m.turb;
    const a2 = 0.6 * m.turb;
    let o = 0;
    for (let j = 0; j < rows; j++) {
      const yUp = rows - 1 - j;
      const yn = yUp / rows;
      const ny1 = j * fs * 0.42 + rise;
      const ny2 = j * fs * 1.05 + rise2;
      const bend = lean * yn * yn * rows + 0.5;
      for (let i = 0; i < cols; i++, o += 4) {
        const n1 = ns(i * fs * 0.62 + 31.7, ny1);
        const cf = i + (n1 - 0.5) * warp * (0.5 + yn * 2) - bend + (i - cxc) * conv * yn;
        const ci = Math.floor(cf);
        if (ci < 0 || ci >= cols - 1) { data[o + 3] = 0; continue; }
        const fr = cf - ci;
        const H = hgt[ci] + (hgt[ci + 1] - hgt[ci]) * fr;
        const up = yUp - base[ci];
        const k = H > 1 ? up / H : 2;
        if (up < -3 || k > 1.5) { data[o + 3] = 0; continue; }
        const n2 = ns(i * fs * 1.5 + 77.1, ny2);
        const kk = k < 0 ? 0 : k;
        // the noise tears the flame more the higher it gets, then lets go of it
        const tear = kk < 0.9 ? 1 : 1 - (kk - 0.9) / 0.6;
        let v = (heat[ci] + (heat[ci + 1] - heat[ci]) * fr) * (1 - kk)
          + ((n1 - 0.5) * a1 * (0.12 + kk) + (n2 - 0.5) * a2 * (0.2 + kk)) * tear;
        if (kk > 0.9) v *= tear;
        v *= 0.12 + 0.88 * smooth(-3, 0.22 * H + 2, up); // thin at the very root so the wood shows through
        const q = (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0) << 2;
        data[o] = LUT[q];
        data[o + 1] = LUT[q + 1];
        data[o + 2] = LUT[q + 2];
        data[o + 3] = LUT[q + 3];
      }
    }
    F.ctx.putImageData(F.img, 0, 0);
    F.bctx.globalCompositeOperation = 'copy';
    F.bctx.drawImage(F.canvas, 0, 0, F.bloom.width, F.bloom.height);
  }

  private drawStones(ctx: CanvasRenderingContext2D, front: boolean) {
    const { s, cx, by } = this;
    const rx = 150 * s;
    const ry = 46 * s;
    const cy = by + 8 * s;
    const L = clamp(this.light, 0, 1.1);
    for (const st of front ? this.frontStones : this.backStones) {
      const x = cx + Math.cos(st.a) * rx;
      const y = cy + Math.sin(st.a) * ry;
      const sw = (st.w * s) / 2;
      const sh = (st.h * s) / 2;
      // light comes from the fire: find the edge of the stone that faces it
      let dx = cx - x;
      let dy = by - 26 * s - y;
      const dl = Math.hypot(dx, dy) || 1;
      dx /= dl;
      dy /= dl;
      const g = ctx.createLinearGradient(x + dx * sw, y + dy * sh, x - dx * sw * 0.7, y - dy * sh * 0.9);
      const litC = mix([52 * st.tone, 46 * st.tone, 44 * st.tone], [255, 150, 70], clamp(L * (front ? 0.78 : 0.9), 0, 1));
      const midC = mix([34 * st.tone, 30 * st.tone, 29 * st.tone], [150, 70, 34], clamp(L * (front ? 0.2 : 0.55), 0, 1));
      g.addColorStop(0, rgb(litC));
      g.addColorStop(front ? 0.3 : 0.6, rgb(midC));
      g.addColorStop(1, 'rgb(10,9,9)');
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.beginPath();
      ctx.ellipse(x, y + sh * 0.75, sw * 1.05, sh * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = g;
      blob(ctx, x, y, sw, sh, st.verts, st.rot);
      ctx.fill();
    }
  }

  private drawLog(ctx: CanvasRenderingContext2D, L: Log) {
    const s = this.s;
    const light = clamp(this.light, 0, 1.2);
    const d = L.drop < 1 ? easeOutBounce(L.drop) : 1;
    const len = L.len * s * (1 - 0.3 * smooth(0.55, 1, L.burn));
    const th = L.th * s * (1 - 0.35 * smooth(0.5, 1, L.burn));
    const char = clamp(L.burn * 1.5 + L.ignite * 0.18, 0, 1);
    ctx.save();
    ctx.translate(this.cx + L.x * s, this.by + L.y * s - (1 - d) * 280 * s);
    ctx.rotate(L.a + (1 - d) * 0.5 * (L.a < 0 ? -1 : 1) + L.jolt * this.kick);
    ctx.globalAlpha = 1 - smooth(0.88, 1, L.burn);
    roundRect(ctx, -len / 2, -th / 2, len, th, th / 2);
    ctx.save();
    ctx.clip();
    ctx.drawImage(L.tex, -len / 2, -th / 2, len, th);
    // it chars from the middle of the fire outward
    const mid = clamp(0.5 - (L.x * Math.cos(L.a)) / L.len, 0.2, 0.8);
    const cg = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
    const ca = (dist: number) => clamp(char * 1.5 - dist * 1.1 * (1 - char), 0, 0.97);
    cg.addColorStop(0, `rgba(17,12,10,${ca(mid)})`);
    cg.addColorStop(mid, `rgba(17,12,10,${ca(0)})`);
    cg.addColorStop(1, `rgba(17,12,10,${ca(1 - mid)})`);
    ctx.fillStyle = cg;
    ctx.fillRect(-len / 2, -th / 2, len, th);
    // darkness away from the fire
    ctx.fillStyle = `rgba(0,0,0,${0.62 - 0.5 * clamp(light, 0, 1)})`;
    ctx.fillRect(-len / 2, -th / 2, len, th);
    // ash settles on what has burnt
    const ashA = smooth(0.45, 0.9, L.burn);
    if (ashA > 0.01) {
      ctx.fillStyle = `rgba(170,162,154,${0.3 * ashA})`;
      for (const a of L.ash) {
        ctx.beginPath();
        ctx.ellipse(a.u * len, a.v * th, a.r * s * 1.3, a.r * s * 0.45, 0, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    // firelight along the top
    const rim = ctx.createLinearGradient(0, -th / 2, 0, th * 0.2);
    rim.addColorStop(0, `rgba(255,150,64,${0.5 * light * (0.3 + 0.7 * L.ignite)})`);
    rim.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = rim;
    ctx.fillRect(-len / 2, -th / 2, len, th);
    // the char glows from inside
    const glowA = L.ignite * smooth(0.04, 0.5, L.burn + 0.08) * (0.55 + 0.45 * this.coal);
    if (glowA > 0.01) {
      const pulse = 0.55 + 0.45 * ns(this.t * 9 + L.len, L.th * 3.1);
      const eg = ctx.createRadialGradient((mid - 0.5) * len, th * 0.1, 0, (mid - 0.5) * len, th * 0.1, len * 0.42);
      eg.addColorStop(0, `rgba(255,84,20,${0.5 * glowA * pulse})`);
      eg.addColorStop(0.6, `rgba(200,36,8,${0.2 * glowA * pulse})`);
      eg.addColorStop(1, 'rgba(160,20,4,0)');
      ctx.fillStyle = eg;
      ctx.fillRect(-len / 2, -th / 2, len, th);
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.7, 1.15 * s);
      for (const c of L.cracks) {
        const fl = smooth(0.25, 0.9, ns(this.t * 12 + c.p * 40, c.p * 9));
        ctx.strokeStyle = `rgba(255,${(96 + 100 * fl) | 0},${(24 + 40 * fl) | 0},${glowA * (0.25 + 0.75 * fl)})`;
        const x0 = c.u * len;
        const y0 = c.v * th;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(c.a) * c.l * len, y0 + Math.sin(c.a) * c.l * len * 0.3);
        ctx.stroke();
      }
    }
    ctx.restore();
    // cut end, seen a little from the side
    if (char < 0.9) {
      const ex = len / 2 - th * 0.16;
      ctx.fillStyle = rgb(mix(mix([206, 160, 106], [58, 40, 28], char), [20, 14, 10], 0.55 - 0.5 * clamp(light, 0, 1)));
      ctx.beginPath();
      ctx.ellipse(ex, 0, th * 0.3, th * 0.48, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(96,58,30,${0.7 * (1 - char)})`;
      ctx.lineWidth = Math.max(0.5, 0.8 * s);
      for (const r of [0.34, 0.18]) {
        ctx.beginPath();
        ctx.ellipse(ex, 0, th * r * 0.62, th * r, 0, 0, TAU);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, s, cx, by, t } = this;
    const L = this.light;
    const Lc = clamp(L, 0, 1);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.lit, 0, 0, w, h);

    /* long shadows the stones throw outward */
    for (const st of [...this.backStones, ...this.frontStones]) {
      const x = cx + Math.cos(st.a) * 150 * s;
      const y = by + 8 * s + Math.sin(st.a) * 46 * s;
      const far = 1.75 + 0.2 * ns(t * 20, st.a * 30);
      const x2 = cx + Math.cos(st.a) * 150 * s * far;
      const y2 = by + 8 * s + Math.sin(st.a) * 46 * s * far;
      const nx = -Math.sin(st.a);
      const ny = Math.cos(st.a) * 0.3;
      const hw = st.w * s * 0.42;
      const sg = ctx.createLinearGradient(x, y, x2, y2);
      sg.addColorStop(0, `rgba(0,0,0,${0.36 * Lc})`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.moveTo(x + nx * hw, y + ny * hw);
      ctx.lineTo(x2 + nx * hw * 1.8, y2 + ny * hw * 1.8);
      ctx.lineTo(x2 - nx * hw * 1.8, y2 - ny * hw * 1.8);
      ctx.lineTo(x - nx * hw, y - ny * hw);
      ctx.closePath();
      ctx.fill();
    }

    /* light mask: the ground and trees were painted fully lit, this is the dark of the night */
    ctx.save();
    ctx.translate(cx, by - 6 * s);
    ctx.scale(1, 0.5);
    const R = 500 * s * (0.86 + 0.14 * Lc);
    const g = ctx.createRadialGradient(0, 0, 60 * s, 0, 0, R);
    const p = Math.pow(Lc, 0.7);
    g.addColorStop(0, `rgba(3,2,2,${1 - 0.88 * p})`);
    g.addColorStop(0.2, `rgba(3,2,2,${1 - 0.6 * p})`);
    g.addColorStop(0.45, `rgba(3,2,2,${1 - 0.26 * p})`);
    g.addColorStop(0.75, `rgba(3,2,2,${1 - 0.07 * p})`);
    g.addColorStop(1, 'rgba(3,2,2,0.975)');
    ctx.fillStyle = g;
    ctx.fillRect(-w, -h * 2.2, w * 2, h * 4.4);
    ctx.restore();

    // the sky sits on top, so the night above the trees keeps its own colour
    ctx.drawImage(this.sky, 0, 0, w, this.skyH);
    ctx.fillStyle = '#eef2ff';
    for (const st of this.twinkles) {
      ctx.globalAlpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * st.sp + st.p));
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;

    /* warm haze in the air around the fire */
    ctx.globalCompositeOperation = 'lighter';
    const hr = (300 + 80 * Lc) * s * 1.5;
    let hg = ctx.createRadialGradient(cx, by - 60 * s, 0, cx, by - 60 * s, hr);
    hg.addColorStop(0, `rgba(255,120,40,${0.2 * L})`);
    hg.addColorStop(0.4, `rgba(255,86,26,${0.07 * L})`);
    hg.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = hg;
    ctx.fillRect(cx - hr, by - 60 * s - hr, hr * 2, hr * 2);
    ctx.globalCompositeOperation = 'source-over';

    /* pit: ash, back stones, coals */
    ctx.fillStyle = '#0d0907';
    ctx.beginPath();
    ctx.ellipse(cx, by + 8 * s, 128 * s, 36 * s, 0, 0, TAU);
    ctx.fill();
    this.drawStones(ctx, false);
    const coal = this.coal;
    ctx.fillStyle = '#17100d';
    for (const c of this.coals) {
      const r = c.r * s;
      blob(ctx, cx + c.x * 104 * s, by + 8 * s + c.y * 25 * s, r, r * 0.62, c.verts, c.rot);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(cx, by + 6 * s);
    ctx.scale(1, 0.3);
    const bed = clamp(0.25 + 0.75 * coal, 0, 1) * (0.55 + 0.45 * Lc);
    hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 118 * s);
    hg.addColorStop(0, `rgba(255,112,32,${0.62 * bed})`);
    hg.addColorStop(0.55, `rgba(200,46,10,${0.34 * bed})`);
    hg.addColorStop(1, 'rgba(120,20,4,0)');
    ctx.fillStyle = hg;
    ctx.beginPath();
    ctx.arc(0, 0, 118 * s, 0, TAU);
    ctx.fill();
    ctx.restore();
    for (const c of this.coals) {
      // each coal breathes on its own slow rhythm
      const breath = smooth(0.25, 0.85, ns(c.seed, t * 5 + c.seed * 3)) * (0.3 + 0.7 * coal) + this.kick * 0.4;
      if (breath < 0.03) continue;
      const x = cx + c.x * 104 * s;
      const y = by + 8 * s + c.y * 25 * s;
      const r = c.r * s * 1.7;
      ctx.globalAlpha = clamp(breath, 0, 1);
      ctx.drawImage(breath > 0.7 ? this.emberHot : this.ember, x - r, y - r * 0.62, r * 2, r * 1.24);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    for (const lg of this.logs) this.drawLog(ctx, lg);

    /* flames */
    this.renderFlames();
    const F = this.field;
    const fw = F.cols * F.cell;
    const fh = F.rows * F.cell;
    const fx0 = F.x0;
    const fy0 = by + 16 * s - fh;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.3;
    ctx.drawImage(F.bloom, fx0 - fw * 0.04, fy0 - fh * 0.04, fw * 1.08, fh * 1.08);
    ctx.globalAlpha = 1;
    ctx.drawImage(F.canvas, fx0, fy0, fw, fh);

    /* sparks, with a short tail */
    ctx.lineCap = 'round';
    for (const sp of this.sparks) {
      const k = sp.life / sp.max;
      ctx.globalAlpha = (1 - k) * (0.5 + 0.5 * Math.sin(t * 24 + sp.seed * 5));
      ctx.strokeStyle = k < 0.3 ? '#ffe9b8' : k < 0.7 ? '#ffa24e' : '#e0541c';
      ctx.lineWidth = sp.r * 1.35 * (1 - 0.5 * k);
      ctx.beginPath();
      ctx.moveTo(sp.px - (sp.x - sp.px) * 0.2, sp.py - (sp.y - sp.py) * 0.2);
      ctx.lineTo(sp.x, sp.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.drawStones(ctx, true);

    for (const sm of this.smoke) {
      const k = sm.life / sm.max;
      ctx.globalAlpha = 0.085 * Math.sin(k * Math.PI);
      ctx.drawImage(this.smokeSprite, sm.x - sm.r, sm.y - sm.r, sm.r * 2, sm.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vig, 0, 0, w, h);
  }
}
