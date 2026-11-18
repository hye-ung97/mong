import type { SceneVariant } from './base';
import { SnowScene, snowVignette, type PrintTint, type SnowOpts } from './snow';
import { TAU, clamp, layer, rand, rng } from './util';

/** The sky over the hill. `auto` follows the local hour (skyAt). */
export type SkyId = 'dusk' | 'moon' | 'dawn';
export type SnowSky = 'auto' | SkyId;

/** 하늘 in the settings sheet, in this order. */
export const SNOW_SKIES: readonly { id: SnowSky; label: string }[] = [
  { id: 'auto', label: '자동' },
  { id: 'dusk', label: '해 질 녘' },
  { id: 'moon', label: '달밤' },
  { id: 'dawn', label: '새벽' },
];

/**
 * The local hour → the sky. A white midday snowfield is too bright to read anything on, so the
 * daytime keeps the dusk sky.
 */
export function skyAt(hour: number): SkyId {
  if (hour >= 5 && hour < 8) return 'dawn';
  if (hour >= 8 && hour < 19) return 'dusk';
  return 'moon';
}

export const skyOf = (choice: SnowSky, now = new Date()): SkyId => (choice === 'auto' ? skyAt(now.getHours()) : choice);

/** Colours of one sky. `'r,g,b'` strings take an alpha where they are used. */
interface Palette {
  sky: readonly (readonly [number, string])[];
  glow: readonly [number, string];
  stars: number;
  moon: boolean;
  mount: string;
  mountTop: string;
  mist: string;
  far: readonly [string, string];
  mid: readonly [string, string];
  line: string;
  field: readonly [string, string, string];
  light: string;
  shade: string;
  /** 1: the light comes from the right (dawn) */
  lightFrom: 0 | 1;
  rim: string;
  trunk: string;
  snow: string;
  /** footprint shade, its darkest dents, the shadows under its crumbs */
  print: PrintTint;
  flake: string;
  fog: string;
  train: string;
  win: string;
}

const SKIES: Record<SkyId, Palette> = {
  dusk: {
    sky: [[0, '#151b45'], [0.4, '#40407e'], [0.68, '#9579b0'], [0.86, '#efa9b7'], [1, '#ffd0b0']],
    glow: [0.26, 'rgba(255,196,176,0.55)'],
    stars: 0, moon: false,
    mount: '#9089bd', mountTop: '242,214,230', mist: '238,204,224',
    far: ['#c3b0d8', '#d6c2e0'], mid: ['#cdb8de', '#e3cee6'], line: '112,88,152',
    field: ['#f3e2f1', '#d6c1e3', '#a490c4'], light: 'rgba(255,222,230,0.4)', shade: 'rgba(70,52,116,0.24)', lightFrom: 0,
    rim: 'rgba(255,238,244,0.95)',
    trunk: '#2c2240', snow: '#fbeaf2',
    print: { shade: '96,72,140', dark: '44,26,78', crumb: '120,92,156' },
    flake: '#fff6fa', fog: '226,196,222', train: '#2b2440', win: '#ffd9a6',
  },
  moon: {
    sky: [[0, '#03061a'], [0.5, '#0a1434'], [0.84, '#1b2852'], [1, '#2c3a68']],
    glow: [0.78, 'rgba(130,150,210,0.16)'],
    stars: 150, moon: true,
    mount: '#27325c', mountTop: '162,178,218', mist: '84,104,156',
    far: ['#5a6ca2', '#6a7cb2'], mid: ['#7083b8', '#8697c8'], line: '24,32,72',
    field: ['#c6d3f0', '#9eaed8', '#6b7cb0'], light: 'rgba(220,232,255,0.3)', shade: 'rgba(14,22,56,0.32)', lightFrom: 0,
    rim: 'rgba(236,244,255,0.85)',
    trunk: '#0c0f24', snow: '#e2eafc',
    print: { shade: '40,56,106', dark: '14,20,54', crumb: '62,78,128' },
    flake: '#ffffff', fog: '110,130,180', train: '#101426', win: '#ffd28e',
  },
  dawn: {
    sky: [[0, '#0b1544'], [0.45, '#22377a'], [0.78, '#4c66a8'], [0.93, '#9aaad2'], [1, '#f2c6a6']],
    glow: [0.8, 'rgba(255,204,176,0.34)'],
    stars: 40, moon: false,
    mount: '#3d5292', mountTop: '184,198,234', mist: '150,170,215',
    far: ['#6e85c0', '#8095cb'], mid: ['#8399ce', '#9bafdb'], line: '34,50,104',
    field: ['#c4d2f2', '#9db1e0', '#6c84c0'], light: 'rgba(255,226,210,0.24)', shade: 'rgba(20,34,90,0.28)', lightFrom: 1,
    rim: 'rgba(244,240,250,0.9)',
    trunk: '#121a40', snow: '#d6e0f7',
    print: { shade: '44,62,120', dark: '18,28,70', crumb: '66,84,140' },
    flake: '#ffffff', fog: '150,170,215', train: '#141c3c', win: '#ffd6a0',
  },
};

const ease = (x: number) => x * x * (3 - 2 * x);

/** The bare tree: branches (`bare`) and the snow lying on them (`snow`) drawn apart, so a shake thins only the snow. */
interface TreeSprite {
  bare: HTMLCanvasElement;
  snow: HTMLCanvasElement;
  /** where snow lies on a branch (sprite px): a shake drops it from here */
  pts: [number, number][];
  W: number;
  H: number;
  /** centre of the crown, 0…1 of the height */
  crownY: number;
  /** half the crown's width, 0…1 of the sprite's width */
  crownRx: number;
}

const sprites = new Map<SkyId, TreeSprite>();

/** A leafless tree whose four big limbs spread into a wide umbrella; snow lies along every flattish branch. */
function treeSprite(sky: SkyId): TreeSprite {
  const hit = sprites.get(sky);
  if (hit) return hit;
  const P = SKIES[sky];
  // wider than the crown: the outermost twigs reach past it
  const W = 440;
  const H = 340;
  const S = 2;
  const canvas = () => {
    const c = document.createElement('canvas');
    c.width = W * S;
    c.height = H * S;
    const x = c.getContext('2d')!;
    x.scale(S, S);
    x.lineCap = 'round';
    return [c, x] as const;
  };
  const [bare, bx] = canvas();
  const [snow, sx] = canvas();
  bx.strokeStyle = P.trunk;
  sx.strokeStyle = P.snow;
  const r = rng(3);
  const pts: [number, number][] = [];
  const cx = W / 2;
  const crown = { x: cx, y: H * 0.43, rx: 176, ry: H * 0.41 };
  const seg = (px: number, py: number, ang: number, len: number, wd: number, depth: number) => {
    let ex = px + Math.cos(ang) * len;
    let ey = py + Math.sin(ang) * len;
    // branches reaching past the crown turn upward and stay short, so the outline stays round
    const ox = (ex - crown.x) / crown.rx;
    const oy = (ey - crown.y) / crown.ry;
    if (ox * ox + oy * oy > 1.12 && depth < 6) {
      ang += (-Math.PI / 2 - ang) * 0.3;
      len *= 0.62;
      ex = px + Math.cos(ang) * len;
      ey = py + Math.sin(ang) * len;
    }
    const bend = (r() - 0.5) * len * 0.14;
    const mx = (px + ex) / 2 + Math.sin(ang) * bend;
    const my = (py + ey) / 2 - Math.cos(ang) * bend;
    bx.lineWidth = wd;
    bx.beginPath();
    bx.moveTo(px, py);
    bx.quadraticCurveTo(mx, my, ex, ey);
    bx.stroke();
    const flat = Math.abs(Math.cos(ang));
    if (flat > 0.28 && wd > 0.7) {
      const off = wd * 0.45;
      sx.lineWidth = Math.max(0.8, wd * (0.32 + flat * 0.3));
      sx.beginPath();
      sx.moveTo(px, py - off);
      sx.quadraticCurveTo(mx, my - off, ex, ey - off);
      sx.stroke();
      if (depth <= 4) pts.push([(px + ex) / 2, (py + ey) / 2 - off]);
    }
    if (depth <= 0) return;
    const k = depth >= 5 ? 2 + (r() < 0.5 ? 1 : 0) : r() < 0.6 ? 2 : 3;
    for (let i = 0; i < k; i++) {
      let a = ang + (i - (k - 1) / 2) * (0.42 + r() * 0.3) + (r() - 0.5) * 0.35;
      a += (-Math.PI / 2 - a) * 0.08;
      seg(ex, ey, a, len * (0.7 + r() * 0.12), Math.max(0.5, wd * 0.64), depth - 1);
    }
  };
  // the trunk, flaring at its foot
  const trunkTop = H * 0.7;
  bx.fillStyle = P.trunk;
  bx.beginPath();
  bx.moveTo(cx - 10, H);
  bx.quadraticCurveTo(cx - 5, H * 0.86, cx - 4.6, trunkTop);
  bx.lineTo(cx + 4.6, trunkTop);
  bx.quadraticCurveTo(cx + 6, H * 0.86, cx + 11, H);
  bx.closePath();
  bx.fill();
  // four big limbs spread wide into a round umbrella
  [-Math.PI / 2 - 0.86, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.24, -Math.PI / 2 + 0.8].forEach((a, i) => {
    seg(cx + (i - 1.5) * 1.8, trunkTop + 2, a + (r() - 0.5) * 0.12, H * (0.17 + r() * 0.04), 6.5, 6);
  });
  const spr = { bare, snow, pts, W, H, crownY: crown.y / H, crownRx: crown.rx / W };
  sprites.set(sky, spr);
  return spr;
}

/** A falling flake: `z` 0 far … 1 near (bigger, faster, brighter). */
interface Flake { x: number; y: number; z: number; ph: number }
/** A lump of snow falling off a branch. */
interface Clump { x: number; y: number; vx: number; vy: number; r: number; t: number; dead?: boolean }
/** Powder drifting down from a shaken branch, or snow dust a gust lifts off the hill. */
interface Mote { x: number; y: number; vx: number; vy: number; t: number; dur: number; r: number }
interface Drift { x: number; y: number; vx: number; vy: number; len: number; wd: number; t: number; dur: number }
/** What was on screen before the sky changed: it fades out over the new sky. */
interface Fading { far: HTMLCanvasElement; near: HTMLCanvasElement; shadow: HTMLCanvasElement | null; spr: TreeSprite; a: number; dur: number }

export interface TreeOpts extends SnowOpts {
  sky?: SnowSky;
}

/** In 자동, the sky is looked at again this often (seconds of scene time). */
const SKY_CHECK = 20;
/** Seconds a sky change takes: chosen in the sheet, or the hour turning over in 자동. */
const SKY_FADE_PICK = 1.2;
const SKY_FADE_AUTO = 8;
/** A distant train passes about once a minute: seconds from one train setting off to the next. */
const TRAIN_EVERY: readonly [number, number] = [40, 80];
/** A gust crosses the hill about every 30 seconds: seconds of calm between gusts, and how long one blows. */
const GUST_CALM: readonly [number, number] = [20, 34];
const GUST_LEN: readonly [number, number] = [4.5, 6.5];

/**
 * 눈멍 · 나무: one leafless tree on a snowy hill in Hokkaido, under a sky that follows the hour
 * (해 질 녘 · 달밤 · 새벽). A press on the snow leaves a boot print and a drag walks along the finger,
 * the prints growing smaller toward the hill. A press on the tree shakes it: snow falls off its
 * branches, and new snow slowly whitens them again. Now and then a lit train crosses the far
 * fields and a gust blows snow dust off the hill; the sound hears both (events `train`, `gust`).
 */
export class Tree extends SnowScene {
  sky: SkyId;
  private choice: SnowSky;
  private P: Palette;
  private flakes: Flake[] = [];
  private far!: HTMLCanvasElement;
  private near!: HTMLCanvasElement;
  private shadow: HTMLCanvasElement | null = null;
  private vig!: HTMLCanvasElement;
  private spr: TreeSprite;
  private fading: Fading | null = null;
  private skyClock = 0;
  /* the hill */
  private k = 1;
  private tx = 0;
  private ty = 0;
  private tb = 0;
  private crestD = 0;
  private crestS = 1;
  private TH = 0;
  private TW = 0;
  private trainY = 0;
  /* the tree: snow on its branches (0…1), how it sways */
  private load = 1;
  /** 새 눈 is whitening the branches again */
  private refill = false;
  private swayT = 9;
  private swayA = 0;
  private clumps: Clump[] = [];
  private powder: Mote[] = [];
  private drift: Drift[] = [];
  private driftAcc = 0;
  private wind = 0;
  private gust: { t: number; dur: number } | null = null;
  private gustNext = 0;
  private train: { x: number; dir: number; speed: number } | null = null;
  private trainNext = 0;
  private fogKey = '';
  private fogG: CanvasGradient | null = null;
  private seeded = false;
  private walking = false;
  private lastStep: { x: number; y: number } | null = null;
  /** what the last press touched: the tree or the snow */
  lastPress: 'tree' | 'ground' | null = null;

  constructor(variant: SceneVariant, opts: TreeOpts = {}) {
    super(variant, opts);
    this.choice = opts.sky ?? 'auto';
    this.sky = skyOf(this.choice);
    this.P = SKIES[this.sky];
    this.spr = treeSprite(this.sky);
    // the home card stays still: no trains, no gusts
    this.trainNext = this.card ? Infinity : rand(15, 35);
    this.gustNext = this.card ? Infinity : rand(10, 20);
  }

  /** 하늘 in the settings sheet. */
  setSky(choice: SnowSky) {
    this.choice = choice;
    this.changeSky(skyOf(choice), SKY_FADE_PICK);
  }

  private changeSky(sky: SkyId, fade: number) {
    if (sky === this.sky) return;
    if (this.w && this.far) {
      this.fading = { far: this.far, near: this.near, shadow: this.shadow, spr: this.spr, a: 1, dur: fade * (this.motion < 1 ? 0.5 : 1) };
    }
    this.sky = sky;
    this.P = SKIES[sky];
    this.spr = treeSprite(sky);
    this.fogKey = '';
    if (this.w) this.paint();
  }

  /** 새 눈: footprints fill and the branches are white again within a second. */
  fresh() {
    super.fresh();
    this.refill = true;
  }

  /** The sound follows the train and the gusts this scene shows (the home card has none). */
  audioState() {
    return { fall: this.fall.v, drives: this.card ? 0 : 1 };
  }

  protected get squash() {
    return 0.42;
  }

  protected bounds() {
    return { x0: 30, x1: this.w - 30, y0: this.tb + 30 * this.k, y1: this.h - 60 };
  }

  /** Prints shrink toward the hill, so a walk up to the tree feels far. */
  protected scaleAt(y: number) {
    const top = this.tb + 10;
    const bot = this.h - (this.card ? 10 : 130);
    const t = clamp((y - top) / Math.max(1, bot - top), 0, 1);
    return (0.28 + 0.92 * t) * (this.card ? 0.45 : this.w > 600 ? 1.1 : 1);
  }

  /** The near hill's skyline. */
  private crest(x: number) {
    return this.ty + this.crestD * (1 - Math.exp(-(((x - this.tx) / this.crestS) ** 2))) + 3 * this.k * Math.sin(x * 0.013 + 1);
  }

  layout() {
    const { w, h, card } = this;
    const wide = w > 600;
    this.k = card ? 0.5 : wide ? 1.1 : 1;
    // the tree stands a little right of centre; a home card keeps its top-left tag and bottom-left title clear
    const ty = (this.ty = Math.round(h * (card ? 0.66 : wide ? 0.6 : 0.585)));
    this.tx = Math.round(card ? w * 0.7 : w * (wide ? 0.63 : 0.6));
    const G = card ? h * 0.12 : h * 0.075; // from the horizon down to the foot of the tree
    this.crestD = card ? h * 0.1 : h * 0.085;
    this.crestS = w * (card ? 0.55 : wide ? 0.36 : 0.44);
    this.tb = this.crest(this.tx);
    this.trainY = ty - G + G * 0.72;
    let TH = card ? h * 0.56 : wide ? 330 : clamp(258 * (w / 390), 220, 300);
    // the crown stays below the tabs and the scene switch (short or landscape screens)
    if (!card) TH = Math.max(h * 0.28, Math.min(TH, this.tb + 3 - ((this.top ?? 0) + 12)));
    this.TH = TH;
    this.TW = (TH * this.spr.W) / this.spr.H;
    this.fading = null;
    this.paint();
    this.vig = snowVignette(w, h, this.dpr, card ? 0.4 : 0.55);
    this.fillFlakes();
    if (!this.seeded) {
      this.seeded = true;
      this.seedWalk(card ? 3 : 7);
    }
  }

  /** The far layer (sky, mountains, two hills with windbreaks, a farmhouse) and the near hill, for this sky. */
  private paint() {
    const { w, h, dpr, k, P, tx, tb, ty } = this;
    const wide = w > 600;
    const G = this.card ? h * 0.12 : h * 0.075;
    const hz = ty - G;
    const r = rng(23);
    this.far = layer(w, h, dpr, (x) => {
      const sky = x.createLinearGradient(0, 0, 0, hz + G * 0.6);
      for (const [o, c] of P.sky) sky.addColorStop(o, c);
      x.fillStyle = sky;
      x.fillRect(0, 0, w, h);
      let g = x.createRadialGradient(w * P.glow[0], hz, 0, w * P.glow[0], hz, Math.max(w, h) * 0.75);
      g.addColorStop(0, P.glow[1]);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, hz + G);
      const ns = Math.round((P.stars * (w * hz)) / (390 * 430));
      for (let i = 0; i < ns; i++) {
        const sx = r() * w;
        const sy = r() * (hz - 30 * k);
        const b = r();
        x.fillStyle = `rgba(255,255,255,${(0.25 + b * 0.6) * (1 - (sy / hz) * 0.6)})`;
        x.beginPath();
        x.arc(sx, sy, 0.4 + b * b * 1.1, 0, TAU);
        x.fill();
      }
      if (P.moon) {
        const mx = w * (wide ? 0.2 : 0.17);
        const my = Math.max((this.top ?? 0) + 40 * k, h * (wide ? 0.22 : 0.235));
        const mr = 15 * k;
        g = x.createRadialGradient(mx, my, 0, mx, my, mr * 7);
        g.addColorStop(0, 'rgba(220,230,255,0.32)');
        g.addColorStop(0.25, 'rgba(200,215,255,0.1)');
        g.addColorStop(1, 'rgba(200,215,255,0)');
        x.fillStyle = g;
        x.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
        x.fillStyle = '#f5f2e4';
        x.beginPath();
        x.arc(mx, my, mr, 0, TAU);
        x.fill();
        x.fillStyle = 'rgba(180,176,160,0.35)';
        for (const [a, b, c] of [[-0.3, -0.2, 0.32], [0.25, 0.15, 0.25], [-0.05, 0.38, 0.18]]) {
          x.beginPath();
          x.arc(mx + a * mr, my + b * mr, c * mr, 0, TAU);
          x.fill();
        }
      }
      /* a far mountain range, a little higher on the left: lit slopes bright, the others in shade */
      const peaks: [number, number, number][] = [[w * 0.15, 56 * k, 70 * k], [w * 0.33, 36 * k, 52 * k]];
      for (let i = 0; i < 6; i++) peaks.push([r() * w * 1.2 - w * 0.1, (14 + r() * 30) * k, (36 + r() * 60) * k]);
      const massif = (xx: number) => {
        let m = 0;
        for (const [px, ph, pw] of peaks) m = Math.max(m, ph * Math.exp(-1.6 * Math.pow(Math.abs(xx - px) / pw, 1.35)));
        return m;
      };
      const ridge = (xx: number) => {
        const m = massif(xx);
        const rough = 2.4 * Math.sin(xx * 0.071 + 0.7) + 1.4 * Math.sin(xx * 0.163 + 2.1) + 0.7 * Math.sin(xx * 0.41);
        return hz - 6 * k - m - rough * k * (0.4 + m / (40 * k));
      };
      x.beginPath();
      x.moveTo(0, hz + 20);
      for (let xx = 0; xx <= w; xx += 2) x.lineTo(xx, ridge(xx));
      x.lineTo(w, hz + 20);
      x.closePath();
      x.fillStyle = P.mount;
      x.fill();
      x.save();
      x.clip();
      for (let xx = 0; xx <= w; xx += 2) {
        const top = ridge(xx);
        const sl = massif(xx - 8) - massif(xx + 8);
        const lit = P.lightFrom ? sl > 0 : sl < 0;
        const a = ease(clamp(Math.abs(sl) / 14, 0, 1));
        const g2 = x.createLinearGradient(0, top, 0, Math.min(hz, top + 38 * k));
        const c = lit ? P.mountTop : P.line;
        g2.addColorStop(0, `rgba(${c},${lit ? 0.5 * a : 0.16 * a})`);
        g2.addColorStop(1, `rgba(${c},0)`);
        x.fillStyle = g2;
        x.fillRect(xx, top, 2, hz - top + 2);
      }
      x.restore();
      g = x.createLinearGradient(0, hz - 24 * k, 0, hz + 6);
      g.addColorStop(0, `rgba(${P.mist},0)`);
      g.addColorStop(1, `rgba(${P.mist},0.85)`);
      x.fillStyle = g;
      x.fillRect(0, hz - 24 * k, w, 30 * k + 6);
      /* two far hills with rows of windbreak trees */
      const farY = (xx: number) => hz + G * 0.1 + G * 0.12 * Math.sin(xx * 0.011 + 1.3) + G * 0.06 * Math.sin(xx * 0.029);
      const midY = (xx: number) => hz + G * 0.3 + G * 0.1 * Math.sin(xx * 0.0085 + 2.3) + G * 0.05 * Math.sin(xx * 0.023 + 0.5);
      const hill = (fy: (xx: number) => number, c0: string, c1: string) => {
        x.beginPath();
        x.moveTo(0, h);
        for (let xx = 0; xx <= w; xx += 3) x.lineTo(xx, fy(xx));
        x.lineTo(w, h);
        x.closePath();
        const hg = x.createLinearGradient(0, fy(w / 2) - G * 0.1, 0, fy(w / 2) + G * 0.8);
        hg.addColorStop(0, c0);
        hg.addColorStop(1, c1);
        x.fillStyle = hg;
        x.fill();
        x.strokeStyle = P.rim;
        x.globalAlpha = 0.35;
        x.lineWidth = 1;
        x.beginPath();
        for (let xx = 0; xx <= w; xx += 3) {
          if (xx) x.lineTo(xx, fy(xx));
          else x.moveTo(xx, fy(xx));
        }
        x.stroke();
        x.globalAlpha = 1;
      };
      const trees = (fy: (xx: number) => number, x0: number, x1: number, dy: number, tall: number, gap: number, alpha: number) => {
        for (let xx = x0; xx < x1; xx += gap * (0.8 + r() * 0.5)) {
          const by = fy(xx) + dy;
          const th = tall * (0.7 + r() * 0.5);
          x.strokeStyle = `rgba(${P.line},${alpha})`;
          x.lineWidth = Math.max(0.6, tall * 0.1);
          x.beginPath();
          x.moveTo(xx, by);
          x.lineTo(xx, by - th);
          x.stroke();
          x.fillStyle = `rgba(${P.line},${alpha * 0.75})`;
          x.beginPath();
          x.ellipse(xx, by - th * 0.62, Math.max(0.7, tall * 0.17), th * 0.4, 0, 0, TAU);
          x.fill();
        }
      };
      hill(farY, P.far[0], P.far[1]);
      trees(farY, w * 0.04, w * 0.34, G * 0.05, 4 * k, 2.4 * k, 0.4);
      trees(farY, w * 0.56, w * 0.92, G * 0.08, 3.5 * k, 2.2 * k, 0.35);
      hill(midY, P.mid[0], P.mid[1]);
      x.strokeStyle = `rgba(${P.line},0.1)`;
      x.lineWidth = 0.8;
      for (let j = 0; j < 3; j++) {
        x.beginPath();
        for (let xx = 0; xx <= w; xx += 4) {
          const yy = midY(xx) + G * (0.12 + j * 0.1) + 2 * Math.sin(xx * 0.02 + j);
          if (xx) x.lineTo(xx, yy);
          else x.moveTo(xx, yy);
        }
        x.stroke();
      }
      trees(midY, -w * 0.02, w * 0.26, G * 0.06, 7 * k, 3 * k, 0.5);
      trees(midY, w * 0.74, w * 1.02, G * 0.1, 6 * k, 2.8 * k, 0.45);
      /* a small farmhouse at the edge of the fields, one window lit */
      const fx0 = w * 0.36;
      const fy0 = midY(fx0) + G * 0.16;
      x.fillStyle = `rgba(${P.line},0.6)`;
      x.fillRect(fx0 - 6 * k, fy0 - 5 * k, 12 * k, 5 * k);
      x.beginPath();
      x.moveTo(fx0 - 7.5 * k, fy0 - 5 * k);
      x.lineTo(fx0, fy0 - 10 * k);
      x.lineTo(fx0 + 7.5 * k, fy0 - 5 * k);
      x.closePath();
      x.fill();
      x.fillStyle = P.snow;
      x.globalAlpha = 0.85;
      x.beginPath();
      x.moveTo(fx0 - 7.5 * k, fy0 - 5.4 * k);
      x.lineTo(fx0, fy0 - 10.4 * k);
      x.lineTo(fx0 + 7.5 * k, fy0 - 5.4 * k);
      x.lineTo(fx0, fy0 - 8.6 * k);
      x.closePath();
      x.fill();
      x.globalAlpha = 1;
      x.save();
      x.shadowColor = 'rgba(255,200,130,0.9)';
      x.shadowBlur = 5 * k;
      x.fillStyle = P.win;
      x.fillRect(fx0 - 3.5 * k, fy0 - 3.4 * k, 2 * k, 1.8 * k);
      x.restore();
      /* the railway embankment */
      x.strokeStyle = `rgba(${P.line},0.2)`;
      x.lineWidth = 0.8;
      x.beginPath();
      x.moveTo(0, this.trainY + 1);
      x.lineTo(w, this.trainY + 1);
      x.stroke();
    });

    /* the near hill the tree stands on, and the snowfield to walk on */
    this.near = layer(w, h, dpr, (n) => {
      const nearPath = () => {
        n.beginPath();
        n.moveTo(-2, h + 2);
        for (let xx = -2; xx <= w + 2; xx += 3) n.lineTo(xx, this.crest(xx));
        n.lineTo(w + 2, h + 2);
        n.closePath();
      };
      nearPath();
      let g = n.createLinearGradient(0, tb, 0, h);
      g.addColorStop(0, P.field[0]);
      g.addColorStop(0.35, P.field[1]);
      g.addColorStop(1, P.field[2]);
      n.fillStyle = g;
      n.fill();
      n.save();
      nearPath();
      n.clip();
      g = n.createLinearGradient(P.lightFrom ? w : 0, 0, P.lightFrom ? 0 : w, 0);
      g.addColorStop(0, P.light);
      g.addColorStop(0.55, 'rgba(0,0,0,0)');
      g.addColorStop(1, P.shade);
      n.fillStyle = g;
      n.fillRect(0, tb - 10, w, h);
      for (let i = 0; i < 12; i++) {
        const bx0 = r() * w;
        const by0 = tb + 40 * k + r() * (h - tb);
        const br = (60 + r() * 120) * k;
        g = n.createRadialGradient(bx0, by0, 0, bx0, by0, br);
        g.addColorStop(0, r() < 0.5 ? 'rgba(255,255,255,0.13)' : `rgba(${P.print.shade},0.1)`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        n.save();
        n.translate(bx0, by0);
        n.scale(1, 0.35);
        n.translate(-bx0, -by0);
        n.fillStyle = g;
        n.fillRect(bx0 - br, by0 - br, br * 2, br * 2);
        n.restore();
      }
      // ripples the wind has carved, larger and clearer up close
      const area = (w * (h - tb)) / (390 * 350);
      const nl = Math.round(170 * area);
      for (let i = 0; i < nl; i++) {
        const lx = r() * w;
        const top = this.crest(lx) + 6;
        const ly = top + Math.pow(r(), 0.8) * (h - top);
        const dep = clamp((ly - tb) / (h - tb), 0, 1);
        const len = (8 + r() * 26) * (0.3 + dep) * k;
        n.strokeStyle = r() < 0.55 ? `rgba(255,255,255,${0.16 + dep * 0.16})` : `rgba(${P.print.shade},${0.08 + dep * 0.1})`;
        n.lineWidth = 0.6 + dep * 1.1;
        n.beginPath();
        n.moveTo(lx - len / 2, ly);
        n.quadraticCurveTo(lx, ly - len * 0.12, lx + len / 2, ly + len * 0.03);
        n.stroke();
      }
      const grains = 4000 * area;
      for (let i = 0; i < grains; i++) {
        n.fillStyle = r() < 0.6 ? 'rgba(255,255,255,0.12)' : `rgba(${P.print.shade},0.06)`;
        n.fillRect(r() * w, tb + r() * (h - tb), 1 + r(), 1 + r());
      }
      n.restore();
      n.strokeStyle = P.rim;
      n.lineWidth = 1.2 * Math.max(k, 0.7);
      n.globalAlpha = 0.75;
      n.beginPath();
      for (let xx = -2; xx <= w + 2; xx += 3) {
        if (xx > -2) n.lineTo(xx, this.crest(xx));
        else n.moveTo(xx, this.crest(xx));
      }
      n.stroke();
      n.globalAlpha = 1;
      // a little shade at the foot of the trunk
      g = n.createRadialGradient(0, 0, 0, 0, 0, 34 * k);
      g.addColorStop(0, `rgba(${P.print.shade},0.3)`);
      g.addColorStop(1, `rgba(${P.print.shade},0)`);
      n.save();
      n.translate(tx, tb + 3);
      n.scale(1, 0.22);
      n.fillStyle = g;
      n.beginPath();
      n.arc(0, 0, 34 * k, 0, TAU);
      n.fill();
      n.restore();
    });

    /* under the moon the tree casts a long shadow across the snow */
    this.shadow = null;
    if (P.moon) {
      const spr = this.spr;
      const sh = document.createElement('canvas');
      sh.width = spr.bare.width;
      sh.height = spr.bare.height;
      const s2 = sh.getContext('2d')!;
      s2.drawImage(spr.bare, 0, 0);
      s2.drawImage(spr.snow, 0, 0);
      s2.globalCompositeOperation = 'source-in';
      s2.fillStyle = `rgb(${P.print.dark})`;
      s2.fillRect(0, 0, sh.width, sh.height);
      this.shadow = sh;
    }
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

  /* ---------- the tree ---------- */
  private onTree(x: number, y: number) {
    const cy = this.tb - this.TH * (1 - this.spr.crownY);
    const dx = (x - this.tx) / (this.TW * this.spr.crownRx * 0.98);
    const dy = (y - cy) / (this.TH * 0.44);
    return dx * dx + dy * dy < 1 || (Math.abs(x - this.tx) < 16 && y < this.tb + 4 && y > cy);
  }

  /** A point on the sprite → the screen. */
  private treePoint(p: [number, number]): [number, number] {
    const { spr, TW, TH, tx, tb } = this;
    return [tx - TW / 2 + (p[0] / spr.W) * TW, tb + 3 - TH + (p[1] / spr.H) * TH];
  }

  /** The branches shake and the snow on them falls: lumps that thud into the hill, powder that drifts down. */
  private shakeTree() {
    const was = this.load;
    this.swayT = 0;
    this.swayA = 0.03 + 0.03 * was;
    const pts = this.spr.pts;
    const at = () => this.treePoint(pts[Math.floor(Math.random() * pts.length)]);
    const n = Math.round(10 + 34 * was);
    for (let i = 0; i < n; i++) {
      const [lx, ly] = at();
      this.clumps.push({ x: lx, y: ly, vx: rand(-14, 14), vy: rand(-20, 10), r: rand(1.2, 3.2) * this.k, t: 0 });
    }
    for (let i = 0; i < 70 * was + 20; i++) {
      const [lx, ly] = at();
      this.powder.push({ x: lx + rand(-4, 4), y: ly, vx: rand(-12, 12), vy: rand(4, 26), t: 0, dur: rand(1.4, 2.8), r: rand(0.6, 1.6) * this.k });
    }
    this.load = Math.max(0.15, was - 0.42);
    this.emit('shake', { x: clamp(this.tx / this.w, 0, 1), amount: was });
  }

  /* ---------- walking ---------- */
  pressStart(x: number, y: number) {
    this.lastPress = null;
    if (this.card) return false;
    this.walking = false;
    this.lastStep = null;
    if (this.onTree(x, y)) {
      this.shakeTree();
      this.lastPress = 'tree';
      return true;
    }
    if (y <= this.crest(x) + 10) return false;
    this.addPrint(x, y, true);
    this.lastStep = { x, y };
    this.walking = true;
    this.lastPress = 'ground';
    return true;
  }

  /** Dragging walks: a new footprint every stride along the finger, strides shorter toward the hill. */
  pressMove(x: number, y: number) {
    if (!this.walking || !this.lastStep || y <= this.crest(x) + 10) return false;
    const sc = this.scaleAt(y);
    if (Math.hypot(x - this.lastStep.x, (y - this.lastStep.y) / this.squash) <= 58 * sc) return false;
    this.addPrint(x, y, true);
    this.lastStep = { x, y };
    return true;
  }

  pressEnd() {
    this.walking = false;
    this.lastStep = null;
  }

  /** Someone walked up toward the tree a while ago: a trail already half filled with snow. */
  private seedWalk(n: number) {
    const { w, h, k } = this;
    const wide = w > 600;
    const wk = {
      x: w * (this.card ? 0.42 : wide ? 0.44 : 0.3),
      y: this.card ? h * 0.97 : h - (wide ? 150 : 175),
      tx: this.tx + rand(-30, 26) * k,
      ty: this.tb + 22 * k,
      ang: NaN,
    };
    const sq = this.squash;
    for (let i = 0; i < n; i++) {
      const sc = this.scaleAt(wk.y);
      const want = Math.atan2((wk.ty - wk.y) / sq, wk.tx - wk.x);
      wk.ang = Number.isNaN(wk.ang) ? want : wk.ang + clamp(want - wk.ang, -0.32, 0.32) + rand(-0.14, 0.14);
      wk.x += Math.cos(wk.ang) * 60 * sc;
      wk.y += Math.sin(wk.ang) * 60 * sc * sq;
      this.addPrint(wk.x, wk.y, false);
      const p = this.prints[this.prints.length - 1];
      p.life = 1;
      p.age = 0.05 + 0.6 * (1 - i / n);
      if (wk.y < wk.ty + 4) break;
    }
    this.last = null;
  }

  /* ---------- time ---------- */
  step(dt: number) {
    this.t += dt;
    const { w, k, motion } = this;
    this.stepPrints(dt);
    // falling snow whitens the branches again (함박눈 the fastest); 새 눈 at once
    this.load = Math.min(1, this.load + (this.refill ? dt / 1.1 : (dt * this.fall.v) / 45));
    if (this.load >= 1) this.refill = false;
    this.swayT += dt;

    const sp = (0.6 + this.fall.v * 0.7) * motion;
    for (const f of this.flakes) {
      f.y += (26 + f.z * 80) * sp * dt;
      f.x += (Math.sin(this.t * (0.6 + f.z) + f.ph) * 14 - 10 * f.z + this.wind * (90 + 150 * f.z)) * motion * dt;
      if (f.y > this.h + 6) Object.assign(f, this.newFlake(false));
      if (f.x < -24) f.x = w + 20;
      if (f.x > w + 24) f.x = -20;
    }

    for (const c of this.clumps) {
      c.t += dt;
      c.vy += 340 * dt;
      c.vx *= 0.98;
      c.x += (c.vx + this.wind * 60) * dt;
      c.y += c.vy * dt;
      if (c.y > this.crest(c.x) + 4 + c.r * 3) {
        this.puff(c.x, c.y, 3, 0.35 * k, true);
        c.dead = true;
      }
    }
    if (this.clumps.length) this.clumps = this.clumps.filter((c) => !c.dead && c.t < 4);
    for (const p of this.powder) {
      p.t += dt / p.dur;
      p.vy += 6 * dt;
      p.x += (p.vx + this.wind * 90) * dt;
      p.y += p.vy * dt;
    }
    if (this.powder.length) this.powder = this.powder.filter((p) => p.t < 1);

    /* a gust: snow dust streams sideways off the hill and the tree sways a little */
    if (!this.gust && this.t > this.gustNext) {
      this.gust = { t: 0, dur: rand(GUST_LEN[0], GUST_LEN[1]) };
      this.emit('gust', { dur: this.gust.dur });
    }
    if (this.gust) {
      const gs = this.gust;
      gs.t += dt;
      const s = Math.sin(Math.PI * clamp(gs.t / gs.dur, 0, 1));
      this.wind = s * s;
      this.driftAcc += this.wind * 46 * dt * (w / 390) * motion;
      while (this.driftAcc >= 1) {
        this.driftAcc--;
        const dx = rand(-30, w);
        const onCrest = Math.random() < 0.45;
        const dy = this.crest(dx) - (onCrest ? rand(0, 4) * k : -rand(12, 150) * k);
        this.drift.push({
          x: dx, y: dy, vx: rand(130, 260) * k * motion, vy: onCrest ? rand(-14, -2) : rand(-4, 2),
          len: rand(6, 20) * k, wd: rand(0.6, 1.4) * k, t: 0, dur: rand(0.6, 1.4),
        });
      }
      if (gs.t > gs.dur) {
        this.gust = null;
        this.wind = 0;
        this.gustNext = this.t + rand(GUST_CALM[0], GUST_CALM[1]);
      }
    }
    for (const p of this.drift) {
      p.t += dt / p.dur;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (this.drift.length) this.drift = this.drift.filter((p) => p.t < 1);

    /* a lit train crossing the far fields */
    if (!this.train && this.t > this.trainNext) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      const speed = 24 * k;
      this.train = { x: dir > 0 ? -50 * k : w + 50 * k, dir, speed };
      this.trainNext = this.t + rand(TRAIN_EVERY[0], TRAIN_EVERY[1]);
      // dir 1: it comes in on the left and leaves on the right
      this.emit('train', { dir, dur: (w + 120 * k) / speed });
    }
    if (this.train) {
      const T = this.train;
      T.x += T.dir * T.speed * dt;
      if (T.x < -70 * k || T.x > w + 70 * k) {
        this.train = null;
        // never two in a row: the next waits until this one is gone
        this.trainNext = Math.max(this.trainNext, this.t + TRAIN_EVERY[0] / 2);
      }
    }

    /* 자동: when the hour turns over into another sky, it slowly comes in */
    if (this.choice === 'auto') {
      this.skyClock += dt;
      if (this.skyClock >= SKY_CHECK) {
        this.skyClock = 0;
        this.changeSky(skyAt(new Date().getHours()), SKY_FADE_AUTO);
      }
    }
    if (this.fading) {
      this.fading.a -= dt / this.fading.dur;
      if (this.fading.a <= 0) this.fading = null;
    }
  }

  private drawTrain(x: CanvasRenderingContext2D) {
    const T = this.train!;
    const { k, P } = this;
    const y = this.trainY;
    for (let c = 0; c < 2; c++) {
      const cx = T.x - T.dir * c * 21 * k;
      const g = x.createRadialGradient(cx, y, 0, cx, y, 18 * k);
      g.addColorStop(0, 'rgba(255,214,160,0.26)');
      g.addColorStop(1, 'rgba(255,214,160,0)');
      x.fillStyle = g;
      x.fillRect(cx - 18 * k, y - 18 * k, 36 * k, 36 * k);
      x.fillStyle = P.train;
      x.fillRect(cx - 10 * k, y - 5 * k, 20 * k, 5 * k);
      x.globalAlpha = 0.8;
      x.fillStyle = P.snow;
      x.fillRect(cx - 10 * k, y - 5.7 * k, 20 * k, 1 * k);
      x.globalAlpha = 1;
      x.fillStyle = P.win;
      for (let i = 0; i < 5; i++) x.fillRect(cx - 8 * k + i * 3.6 * k, y - 3.6 * k, 2 * k, 1.6 * k);
    }
    const hx = T.x + T.dir * 10.5 * k;
    const g = x.createRadialGradient(hx, y - 2 * k, 0, hx, y - 2 * k, 9 * k);
    g.addColorStop(0, 'rgba(255,246,220,0.9)');
    g.addColorStop(1, 'rgba(255,246,220,0)');
    x.fillStyle = g;
    x.fillRect(hx - 9 * k, y - 11 * k, 18 * k, 18 * k);
  }

  private drawTree(x: CanvasRenderingContext2D, spr: TreeSprite, sway: number, alpha: number) {
    x.save();
    x.translate(this.tx, this.tb + 3);
    x.transform(1, 0, -sway, 1, 0, 0);
    x.globalAlpha = alpha;
    x.drawImage(spr.bare, -this.TW / 2, -this.TH, this.TW, this.TH);
    x.globalAlpha = alpha * this.load;
    x.drawImage(spr.snow, -this.TW / 2, -this.TH, this.TW, this.TH);
    x.restore();
  }

  private drawShadow(x: CanvasRenderingContext2D, sh: HTMLCanvasElement, sway: number, alpha: number) {
    x.save();
    x.translate(this.tx, this.tb + 2);
    x.transform(1, 0.05, -0.8 + sway, -0.38, 0, 0);
    x.globalAlpha = 0.24 * alpha;
    x.drawImage(sh, -this.TW / 2, -this.TH, this.TW, this.TH);
    x.restore();
  }

  draw(x: CanvasRenderingContext2D) {
    const { w, h, k, P } = this;
    const old = this.fading;
    const fa = old ? ease(clamp(old.a, 0, 1)) : 0;
    x.drawImage(this.far, 0, 0, w, h);
    if (old) {
      x.globalAlpha = fa;
      x.drawImage(old.far, 0, 0, w, h);
      x.globalAlpha = 1;
    }
    if (this.train) this.drawTrain(x);
    // the harder it snows, the more the far hills and mountains blur
    const key = `${this.fall.v}|${this.sky}|${this.tb}`;
    if (key !== this.fogKey || !this.fogG) {
      this.fogKey = key;
      const fa2 = this.fall.v >= 1 ? 0.3 : this.fall.v >= 0.6 ? 0.12 : 0.03;
      this.fogG = x.createLinearGradient(0, 0, 0, this.tb + 30 * k);
      this.fogG.addColorStop(0, `rgba(${P.fog},${fa2 * 0.45})`);
      this.fogG.addColorStop(1, `rgba(${P.fog},${fa2})`);
    }
    x.fillStyle = this.fogG;
    x.fillRect(0, 0, w, h);
    x.drawImage(this.near, 0, 0, w, h);
    if (old) {
      x.globalAlpha = fa;
      x.drawImage(old.near, 0, 0, w, h);
      x.globalAlpha = 1;
    }
    const sway = (this.swayA * Math.exp(-this.swayT / 0.65) * Math.sin(this.swayT * 12) + this.wind * 0.02 * Math.sin(this.t * 2.6)) * this.motion;
    if (this.shadow) this.drawShadow(x, this.shadow, sway, 1 - fa);
    if (old?.shadow) this.drawShadow(x, old.shadow, sway, fa);
    this.drawTree(x, this.spr, sway, 1);
    if (old) this.drawTree(x, old.spr, sway, fa);
    this.drawPrints(x, P.print);
    x.fillStyle = P.snow;
    for (const c of this.clumps) {
      x.beginPath();
      x.arc(c.x, c.y, c.r, 0, TAU);
      x.fill();
    }
    for (const p of this.powder) {
      x.globalAlpha = Math.sin(Math.PI * p.t) * 0.7;
      x.beginPath();
      x.arc(p.x, p.y, p.r, 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
    if (this.drift.length) {
      x.strokeStyle = '#fff';
      x.lineCap = 'round';
      for (const p of this.drift) {
        x.globalAlpha = Math.sin(Math.PI * p.t) * 0.45;
        x.lineWidth = p.wd;
        x.beginPath();
        x.moveTo(p.x - p.len, p.y - p.vy * 0.02);
        x.lineTo(p.x, p.y);
        x.stroke();
      }
      x.globalAlpha = 1;
    }
    this.drawPuffs(x);
    x.fillStyle = P.flake;
    const size = this.card ? 0.7 : 1;
    for (const f of this.flakes) {
      x.globalAlpha = 0.3 + f.z * 0.65;
      x.beginPath();
      x.arc(f.x, f.y, (0.6 + f.z * 2.3) * size, 0, TAU);
      x.fill();
    }
    x.globalAlpha = 1;
    x.drawImage(this.vig, 0, 0, w, h);
  }
}
