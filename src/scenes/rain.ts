import { Scene, type SceneVariant } from './base';
import { TAU, clamp, disc, glow, layer, vignette } from './util';

interface Streak { x: number; y: number; len: number; v: number }
interface Slider { x: number; y: number; r: number; v: number; wait: number; seed: number; tr: number }
interface Car { x: number; v: number; y: number; head: boolean }
interface FarBuilding { x: number; w: number; top: number; seed: number }
interface MidBuilding { x: number; w: number; top: number; h: number; tank: boolean; wins: { x: number; y: number; c: string }[] }
interface City {
  far: FarBuilding[];
  mid: MidBuilding[];
  lamps: { x: number; y: number }[];
  neons: { x: number; y: number; w: number; h: number; c: readonly [number, number, number] }[];
  tower: FarBuilding;
}
type Rng = () => number;

const WIN = ['255,206,140', '255,176,96', '255,224,180', '190,214,255', '255,150,100'] as const;
const NEON: readonly (readonly [number, number, number])[] = [[255, 93, 143], [79, 224, 208], [255, 170, 70]];
const BOKEH: readonly (readonly [number, number, number])[] = [
  [255, 176, 96], [255, 210, 140], [255, 150, 90], [130, 176, 255], [255, 128, 168], [210, 225, 255],
];
/** Layouts at least this wide get the three-pane window (matches the desktop UI breakpoint). */
const WIDE = 768;
/** How fast wiped glass mists over again: the share of the way back per tick. */
const REFOG_STEP = 0.03;
const REFOG_EVERY = 0.5;

/** Seeded random numbers, so the view outside stays the same city when the window is resized. */
function rng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

let filterSupport: boolean | null = null;
function hasFilter() {
  if (filterSupport === null) filterSupport = 'filter' in canvas(1, 1).getContext('2d')!;
  return filterSupport;
}

/** A blurred copy. Browsers without canvas filters get a shrink-and-stretch blur instead. */
function blurred(src: HTMLCanvasElement, w: number, h: number, radius: number) {
  const out = canvas(w, h);
  const x = out.getContext('2d')!;
  if (hasFilter()) {
    const m = radius * 2;
    x.filter = `blur(${radius}px)`;
    x.drawImage(src, -m, -m, w + m * 2, h + m * 2);
    x.filter = 'none';
    return out;
  }
  let cur = src;
  let cw = w;
  let ch = h;
  for (let f = 1; f < Math.max(1, radius * 0.8);) {
    f *= 2;
    const next = canvas(Math.max(2, w / f), Math.max(2, h / f));
    const nx = next.getContext('2d')!;
    nx.imageSmoothingQuality = 'high';
    nx.drawImage(cur, 0, 0, cw, ch, 0, 0, next.width, next.height);
    cur = next;
    cw = next.width;
    ch = next.height;
  }
  x.imageSmoothingQuality = 'high';
  x.drawImage(cur, 0, 0, cw, ch, 0, 0, w, h);
  return out;
}

/** Rim shadow and highlights of a droplet; the drop itself is SHADE_K of the sprite. */
const SHADE_K = 0.86;
let shadeSprite: HTMLCanvasElement | null = null;
function shade() {
  if (shadeSprite) return shadeSprite;
  const S = 96;
  const sp = canvas(S, S);
  const x = sp.getContext('2d')!;
  const c = S / 2;
  const R = c * SHADE_K;
  x.save();
  x.beginPath();
  x.arc(c, c, R, 0, TAU);
  x.clip();
  let g = x.createRadialGradient(c, c, R * 0.5, c, c, R);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.78, 'rgba(0,0,0,0.16)');
  g.addColorStop(1, 'rgba(0,0,0,0.62)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  g = x.createLinearGradient(0, c - R, 0, c + R * 0.1);
  g.addColorStop(0, 'rgba(0,0,0,0.42)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, S, S);
  x.strokeStyle = 'rgba(226,238,255,0.62)';
  x.lineWidth = R * 0.13;
  x.lineCap = 'round';
  x.beginPath();
  x.arc(c, c, R * 0.82, Math.PI * 0.2, Math.PI * 0.8);
  x.stroke();
  x.restore();
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.beginPath();
  x.ellipse(c - R * 0.32, c - R * 0.4, R * 0.17, R * 0.1, -0.6, 0, TAU);
  x.fill();
  shadeSprite = sp;
  return sp;
}

/**
 * 비멍: a rainy night seen from a seat by the window.
 *
 * The city outside is painted once, sharp. From it come the view through clear glass and the
 * view through misted glass; a mist mask blends the two, and rubbing the glass wipes the mask.
 * Droplets show the sharp city upside down, like small lenses. The full scene adds the window
 * frame and a sill inside the room; the home card shows the glass only.
 */
export class Rain extends Scene {
  intensity: number;
  private thunder: boolean;
  private readonly seed = Math.floor(Math.random() * 0xffffffff);
  /** Top edge (CSS px) of the controls that sit on the sill; null until the view measures it. */
  private floor: number | null = null;
  private flash = 0;
  private flashT = -1;
  private nextFlash = 3;
  private bolt: [number, number][] | null = null;
  private area = 1;
  private wide = false;
  /** Bottom of the glass. Below it is the sill, when there is one. */
  private H = 0;
  private ledge = 0;
  private hasFrame = false;
  private hasSill = false;
  private city!: City;
  private beacon = { x: 0, y: 0 };
  private mug = { x: 0, y: 0 };
  private streaks: Streak[] = [];
  private sliders: Slider[] = [];
  private cars: Car[] = [];
  private hitAcc = 0;
  private slideAcc = 0;
  private evapAcc = 0;
  private fogAcc = 0;
  private carAcc = 1;
  private wipeLast: { x: number; y: number } | null = null;
  private clear!: HTMLCanvasElement;
  private foggy!: HTMLCanvasElement;
  private flashBg!: HTMLCanvasElement;
  private ref!: HTMLCanvasElement;
  private fogBase!: HTMLCanvasElement;
  private mask: HTMLCanvasElement | null = null;
  private mx!: CanvasRenderingContext2D;
  private fogComp!: HTMLCanvasElement;
  private fx!: CanvasRenderingContext2D;
  private glass: HTMLCanvasElement | null = null;
  private gx!: CanvasRenderingContext2D;
  private frameLayer: HTMLCanvasElement | null = null;
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

  /**
   * Tells the scene where the controls resting on the sill begin (their top edge, CSS px),
   * so the sill ends just above them. `null` means there are none: the window has no sill.
   */
  setFloor(y: number | null) {
    const next = y === null ? -1 : Math.round(y);
    if (this.floor !== null && Math.abs(next - this.floor) < 2) return;
    this.floor = next;
    if (this.w) this.layout();
  }

  /* ---------- wiping the mist ---------- */
  wipeStart(x: number, y: number) {
    this.wipeLast = { x, y };
    this.wipe(x, y, x, y);
  }

  /** Returns true while a wipe is in progress. */
  wipeMove(x: number, y: number) {
    if (!this.wipeLast) return false;
    this.wipe(this.wipeLast.x, this.wipeLast.y, x, y);
    this.wipeLast = { x, y };
    return true;
  }

  wipeEnd() {
    this.wipeLast = null;
  }

  tap(x: number, y: number) {
    this.wipe(x, y, x, y);
  }

  private wipe(x0: number, y0: number, x1: number, y1: number) {
    const m = this.mx;
    const wd = 46 * this.s;
    m.globalCompositeOperation = 'destination-out';
    m.lineCap = 'round';
    m.strokeStyle = '#000';
    // a wide faint pass, then narrower firmer ones: a soft-edged swipe
    for (const [k, a] of [[1.3, 0.22], [1, 0.5], [0.72, 1]] as const) {
      m.globalAlpha = a;
      m.lineWidth = wd * k;
      m.beginPath();
      m.moveTo(x0, y0);
      m.lineTo(x1 + 0.01, y1 + 0.01);
      m.stroke();
    }
    m.globalAlpha = 1;
    m.globalCompositeOperation = 'source-over';
  }

  /** Moves the mask a small step back towards the resting mist. */
  private refog() {
    const m = this.mx;
    m.globalCompositeOperation = 'destination-out';
    m.fillStyle = `rgba(0,0,0,${REFOG_STEP})`;
    m.fillRect(0, 0, this.w, this.h);
    m.globalCompositeOperation = 'lighter';
    m.globalAlpha = REFOG_STEP;
    m.drawImage(this.fogBase, 0, 0);
    m.globalAlpha = 1;
    m.globalCompositeOperation = 'source-over';
  }

  /* ---------- geometry ---------- */
  private frameThickness() {
    return (this.wide ? 15 : 9) * this.s;
  }

  private mullionWidth() {
    return (this.wide ? 11 : 8) * this.s;
  }

  private mullions() {
    return this.wide ? [this.w * 0.27, this.w * 0.73] : [this.w * 0.5];
  }

  private panes() {
    if (!this.hasFrame) return [{ x: 0, w: this.w }];
    const ft = this.frameThickness();
    const xs = [ft, ...this.mullions(), this.w - ft];
    return xs.slice(0, -1).map((x, i) => ({ x, w: xs[i + 1] - x }));
  }

  /* ---------- the city outside ---------- */
  private genCity(R: Rng) {
    const { w, H, s } = this;
    const r = (a: number, b: number) => a + R() * (b - a);
    const far: FarBuilding[] = [];
    for (let bx = -20 * s; bx < w;) {
      const bw = r(28, 72) * s;
      far.push({ x: bx, w: bw, top: H * 0.78 - r(0.12, 0.4) * H, seed: R() * 0xffffffff });
      bx += bw + r(0, 10) * s;
    }
    const mid: MidBuilding[] = [];
    for (let bx = -30 * s; bx < w;) {
      const bw = r(64, 132) * s;
      const bh = r(0.2, 0.52) * H;
      const gap = r(4, 28) * s;
      const tank = R() < 0.35;
      // each building lights its own windows, so a resize keeps the buildings before it unchanged
      const B = rng(R() * 0xffffffff);
      const b: MidBuilding = { x: bx, w: bw, top: H * 0.84 - bh, h: bh, tank, wins: [] };
      const cw = 14 * s;
      const ch = 19 * s;
      const cols = Math.floor((bw - 8 * s) / cw);
      const rows = Math.floor((bh - 16 * s) / ch);
      const ox = bx + (bw - cols * cw) / 2 + 3.5 * s;
      const lit = 0.12 + B() * 0.3;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const on = B() < lit;
          const c = WIN[Math.floor(B() * WIN.length)];
          if (on) b.wins.push({ x: ox + col * cw, y: b.top + 10 * s + row * ch, c });
        }
      }
      mid.push(b);
      bx += bw + gap;
    }
    const lamps: City['lamps'] = [];
    const ln = this.wide ? 4 : 2;
    for (let i = 0; i < ln; i++) lamps.push({ x: (w * (i + 0.5 + r(-0.12, 0.12))) / ln, y: H * 0.7 });
    const neons: City['neons'] = [];
    const tall = mid.filter((b) => b.h > H * 0.3 && b.x > 0 && b.x + b.w < w);
    for (let i = 0; i < (this.wide ? 3 : 2) && tall.length; i++) {
      const b = tall.splice(Math.floor(R() * tall.length), 1)[0];
      neons.push({ x: b.x + b.w * r(0.62, 0.8), y: b.top + r(24, 60) * s, w: 7 * s, h: r(34, 52) * s, c: NEON[i % NEON.length] });
    }
    const tower = far.reduce((a, b) => (b.top < a.top ? b : a), far[0]);
    this.beacon = { x: tower.x + tower.w / 2, y: tower.top - 22 * s };
    this.city = { far, mid, lamps, neons, tower };
  }

  /** `lit`: the moment of a lightning flash — bright sky, buildings as black outlines. */
  private paintCity(x: CanvasRenderingContext2D, lit: boolean, R: Rng) {
    const { w, h, H, s } = this;
    const { far, mid, lamps, neons, tower } = this.city;
    const r = (a: number, b: number) => a + R() * (b - a);
    let g = x.createLinearGradient(0, 0, 0, H * 0.84);
    if (lit) {
      g.addColorStop(0, '#7e92c8');
      g.addColorStop(1, '#c9d4f2');
    } else {
      g.addColorStop(0, '#070b16');
      g.addColorStop(0.5, '#101a30');
      g.addColorStop(1, '#222b45');
    }
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    if (!lit) {
      // the city's glow on low cloud
      g = x.createRadialGradient(w * 0.5, H * 0.84, 0, w * 0.5, H * 0.84, Math.max(w * 0.7, H * 0.55));
      g.addColorStop(0, 'rgba(255,150,90,0.24)');
      g.addColorStop(1, 'rgba(255,150,90,0)');
      x.fillStyle = g;
      x.fillRect(0, 0, w, H);
      for (let i = 0; i < 9; i++) {
        const cx = r(0, w);
        const cy = r(0, H * 0.4);
        const cr = r(60, 150) * s;
        g = x.createRadialGradient(cx, cy, 0, cx, cy, cr);
        g.addColorStop(0, 'rgba(70,86,120,0.2)');
        g.addColorStop(1, 'rgba(70,86,120,0)');
        x.fillStyle = g;
        x.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
      }
    }
    x.fillStyle = lit ? 'rgb(58,70,104)' : 'rgb(22,31,51)';
    for (const b of far) x.fillRect(b.x, b.top, b.w + 1, H - b.top);
    x.fillRect(tower.x + tower.w / 2 - s, tower.top - 22 * s, 2 * s, 22 * s);
    if (!lit) {
      for (const b of far) {
        const B = rng(b.seed);
        for (let wy = b.top + 6 * s; wy < H * 0.76; wy += 9 * s) {
          for (let wx = b.x + 4 * s; wx < b.x + b.w - 4 * s; wx += 7 * s) {
            const on = B() < 0.1;
            const c = WIN[Math.floor(B() * WIN.length)];
            if (!on) continue;
            x.fillStyle = `rgba(${c},0.5)`;
            x.fillRect(wx, wy, 2.4 * s, 3.4 * s);
          }
        }
      }
    }
    x.fillStyle = lit ? 'rgb(10,13,23)' : 'rgb(9,13,23)';
    for (const b of mid) {
      x.fillRect(b.x, b.top, b.w, H - b.top);
      if (b.tank) x.fillRect(b.x + b.w * 0.2, b.top - 9 * s, 20 * s, 9 * s);
    }
    // the street
    g = x.createLinearGradient(0, H * 0.84, 0, H);
    if (lit) {
      g.addColorStop(0, 'rgb(40,50,74)');
      g.addColorStop(1, 'rgb(20,26,40)');
    } else {
      g.addColorStop(0, '#0d121d');
      g.addColorStop(1, '#04060a');
    }
    x.fillStyle = g;
    x.fillRect(0, H * 0.84, w, h - H * 0.84);
    if (lit) return;
    for (const b of mid) {
      for (const wn of b.wins) {
        x.fillStyle = `rgba(${wn.c},0.16)`;
        x.fillRect(wn.x - 3 * s, wn.y - 3 * s, 13 * s, 16 * s);
        x.fillStyle = `rgba(${wn.c},0.92)`;
        x.fillRect(wn.x, wn.y, 7 * s, 10 * s);
      }
    }
    // light on the wet road: short broken dashes that the blur turns into a smear
    const smear = (cx: number, color: string, width: number, a: number) => {
      for (let y = H * 0.855; y < H + 12 * s; y += 3.2 * s) {
        const k = 1 - (y - H * 0.855) / (H * 0.16);
        if (k <= 0) break;
        x.fillStyle = `rgba(${color},${a * k * r(0.4, 1)})`;
        const ww = width * r(0.5, 1.5);
        x.fillRect(cx - ww / 2 + r(-2, 2) * s, y, ww, 2 * s);
      }
    };
    for (const n of neons) {
      const [cr, cg, cb] = n.c;
      g = x.createRadialGradient(n.x, n.y + n.h / 2, 0, n.x, n.y + n.h / 2, 46 * s);
      g.addColorStop(0, `rgba(${cr},${cg},${cb},0.42)`);
      g.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
      x.fillStyle = g;
      x.fillRect(n.x - 50 * s, n.y - 30 * s, 100 * s, n.h + 60 * s);
      x.fillStyle = `rgb(${cr},${cg},${cb})`;
      x.fillRect(n.x - n.w / 2, n.y, n.w, n.h);
      smear(n.x, `${cr},${cg},${cb}`, 12 * s, 0.3);
    }
    for (const l of lamps) {
      x.fillStyle = 'rgb(4,6,10)';
      x.fillRect(l.x - 1.5 * s, l.y, 3 * s, H * 0.86 - l.y);
      x.fillRect(l.x - 9 * s, l.y - 2 * s, 12 * s, 3 * s);
      const hx = l.x - 8 * s;
      const hy = l.y + 2 * s;
      g = x.createLinearGradient(0, hy, 0, H * 0.88);
      g.addColorStop(0, 'rgba(255,196,120,0.2)');
      g.addColorStop(1, 'rgba(255,196,120,0)');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(hx, hy);
      x.lineTo(hx - 46 * s, H * 0.88);
      x.lineTo(hx + 46 * s, H * 0.88);
      x.closePath();
      x.fill();
      g = x.createRadialGradient(hx, hy, 0, hx, hy, 62 * s);
      g.addColorStop(0, 'rgba(255,214,150,0.95)');
      g.addColorStop(0.12, 'rgba(255,190,110,0.5)');
      g.addColorStop(1, 'rgba(255,190,110,0)');
      x.fillStyle = g;
      x.fillRect(hx - 62 * s, hy - 62 * s, 124 * s, 124 * s);
      smear(hx, '255,196,120', 18 * s, 0.4);
    }
  }

  /* ---------- the window frame, the sill and what stands on it ---------- */
  private paintFrame(x: CanvasRenderingContext2D, R: Rng) {
    const { w, h, H, s, wide, ledge } = this;
    const r = (a: number, b: number) => a + R() * (b - a);
    const ft = this.frameThickness();
    const mw = this.mullionWidth();
    const px1 = Math.max(1, s);
    let g: CanvasGradient;
    // the frame's shadow on the edges of the glass
    const edge = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number) => {
      g = x.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, 'rgba(0,0,0,0.5)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(rx, ry, rw, rh);
    };
    edge(ft, 0, ft + 16 * s, 0, ft, 0, 16 * s, H);
    edge(w - ft, 0, w - ft - 16 * s, 0, w - ft - 16 * s, 0, 16 * s, H);
    edge(0, ft, 0, ft + 20 * s, 0, ft, w, 20 * s);
    if (this.hasSill) edge(0, H, 0, H - 34 * s, 0, H - 34 * s, w, 34 * s);
    for (const mx of this.mullions()) {
      edge(mx - mw / 2, 0, mx - mw / 2 - 10 * s, 0, mx - mw / 2 - 10 * s, 0, 10 * s, H);
      edge(mx + mw / 2, 0, mx + mw / 2 + 10 * s, 0, mx + mw / 2, 0, 10 * s, H);
    }
    const post = (px: number, pw: number) => {
      g = x.createLinearGradient(px, 0, px + pw, 0);
      g.addColorStop(0, '#0b0908');
      g.addColorStop(0.55, '#1c1511');
      g.addColorStop(1, '#0d0a09');
      x.fillStyle = g;
      x.fillRect(px, 0, pw, H);
      x.fillStyle = 'rgba(255,188,124,0.2)'; // lamp light catching the edge
      x.fillRect(px + pw - px1, 0, px1, H);
    };
    post(0, ft);
    post(w - ft, ft);
    for (const mx of this.mullions()) post(mx - mw / 2, mw);
    x.fillStyle = '#0c0a08';
    x.fillRect(0, 0, w, ft);
    if (!this.hasSill) return;

    // top of the sill: warm from the lamp, a little cold light from outside along the glass
    g = x.createLinearGradient(0, H, 0, H + ledge);
    g.addColorStop(0, '#3d2c20');
    g.addColorStop(1, '#22180f');
    x.fillStyle = g;
    x.fillRect(0, H, w, ledge);
    g = x.createRadialGradient(w * 0.78, H + ledge / 2, 0, w * 0.78, H + ledge / 2, w * 0.5);
    g.addColorStop(0, 'rgba(255,176,104,0.3)');
    g.addColorStop(1, 'rgba(255,176,104,0)');
    x.fillStyle = g;
    x.fillRect(0, H, w, ledge);
    g = x.createLinearGradient(0, H, 0, H + ledge * 0.6);
    g.addColorStop(0, 'rgba(150,180,230,0.16)');
    g.addColorStop(1, 'rgba(150,180,230,0)');
    x.fillStyle = g;
    x.fillRect(0, H, w, ledge);
    x.fillStyle = 'rgba(255,214,160,0.3)';
    x.fillRect(0, H + ledge - px1, w, px1);
    // the wall under the sill
    g = x.createLinearGradient(0, H + ledge, 0, h);
    g.addColorStop(0, '#16110e');
    g.addColorStop(1, '#080606');
    x.fillStyle = g;
    x.fillRect(0, H + ledge, w, h - H - ledge);
    g = x.createLinearGradient(0, H + ledge, 0, H + ledge + 18 * s);
    g.addColorStop(0, 'rgba(0,0,0,0.6)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g;
    x.fillRect(0, H + ledge, w, 18 * s);

    // mug
    const base = H + ledge * 0.6;
    const mx = wide ? w * 0.135 : w * 0.21;
    const mwid = 34 * s;
    const mh = 38 * s;
    x.fillStyle = 'rgba(0,0,0,0.45)';
    x.beginPath();
    x.ellipse(mx - 6 * s, base, mwid * 0.75, 4 * s, 0, 0, TAU);
    x.fill();
    x.strokeStyle = '#1a130f';
    x.lineWidth = 5 * s;
    x.beginPath();
    x.arc(mx - mwid / 2 - s, base - mh * 0.52, 9 * s, Math.PI * 0.5, Math.PI * 1.5);
    x.stroke();
    g = x.createLinearGradient(mx - mwid / 2, 0, mx + mwid / 2, 0);
    g.addColorStop(0, '#0e0b09');
    g.addColorStop(0.7, '#2c2018');
    g.addColorStop(1, '#5a3f2b');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(mx - mwid / 2, base - mh);
    x.lineTo(mx + mwid / 2, base - mh);
    x.lineTo(mx + mwid / 2 - 3 * s, base - 4 * s);
    x.quadraticCurveTo(mx + mwid / 2 - 3 * s, base, mx + mwid / 2 - 8 * s, base);
    x.lineTo(mx - mwid / 2 + 8 * s, base);
    x.quadraticCurveTo(mx - mwid / 2 + 3 * s, base, mx - mwid / 2 + 3 * s, base - 4 * s);
    x.closePath();
    x.fill();
    x.fillStyle = '#3a2a1e';
    x.beginPath();
    x.ellipse(mx, base - mh, mwid / 2, 4.5 * s, 0, 0, TAU);
    x.fill();
    x.fillStyle = '#090706';
    x.beginPath();
    x.ellipse(mx, base - mh + 0.6 * s, mwid / 2 - 3 * s, 3 * s, 0, 0, TAU);
    x.fill();
    this.mug = { x: mx, y: base - mh - 2 * s };

    // potted plant
    const px = wide ? w * 0.9 : w * 0.8;
    const pw = 40 * s;
    const ph = 32 * s;
    x.fillStyle = 'rgba(0,0,0,0.45)';
    x.beginPath();
    x.ellipse(px - 8 * s, base, pw * 0.7, 4 * s, 0, 0, TAU);
    x.fill();
    const leaves = Array.from({ length: 11 }, () => ({ a: r(-0.75, 0.75), L: r(54, 118) * s, o: r(-10, 10) * s }));
    leaves.sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
    for (const lf of leaves) {
      const bx = px + lf.o;
      const by = base - ph + 2 * s;
      const tx = bx + Math.sin(lf.a) * lf.L * 1.05;
      const ty = by - Math.cos(lf.a) * lf.L;
      const nx = Math.cos(lf.a);
      const ny = Math.sin(lf.a);
      const wd = lf.L * 0.09 + 3 * s;
      const cx = (bx + tx) / 2 + Math.sin(lf.a) * lf.L * 0.12;
      const cy = (by + ty) / 2 - lf.L * 0.1;
      g = x.createLinearGradient(bx - wd, 0, bx + wd + Math.abs(tx - bx), 0);
      g.addColorStop(0, 'rgb(8,14,11)');
      g.addColorStop(1, 'rgb(26,38,26)');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(bx - nx * 2 * s, by);
      x.quadraticCurveTo(cx - nx * wd, cy - ny * wd, tx, ty);
      x.quadraticCurveTo(cx + nx * wd, cy + ny * wd, bx + nx * 2 * s, by);
      x.closePath();
      x.fill();
      x.strokeStyle = 'rgba(214,176,120,0.2)';
      x.lineWidth = px1;
      x.beginPath();
      x.moveTo(bx + nx * 2 * s, by);
      x.quadraticCurveTo(cx + nx * wd, cy + ny * wd, tx, ty);
      x.stroke();
    }
    g = x.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
    g.addColorStop(0, '#17100c');
    g.addColorStop(0.65, '#3d291c');
    g.addColorStop(1, '#74492f');
    x.fillStyle = g;
    x.beginPath();
    x.moveTo(px - pw / 2, base - ph);
    x.lineTo(px + pw / 2, base - ph);
    x.lineTo(px + pw / 2 - 6 * s, base);
    x.lineTo(px - pw / 2 + 6 * s, base);
    x.closePath();
    x.fill();
    x.fillRect(px - pw / 2 - 2 * s, base - ph - 4 * s, pw + 4 * s, 7 * s);
  }

  /* ---------- layers ---------- */
  layout() {
    const { w, h, dpr } = this;
    const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.35));
    this.area = clamp((w * h) / (390 * 844), 1, 3);
    this.wide = w >= WIDE;
    this.hasFrame = this.variant === 'full';
    this.ledge = (this.wide ? 26 : 22) * s;
    // until the view has measured its controls, assume the usual dock height
    const floor = this.floor ?? h - (this.wide ? 96 : 124);
    const sillTop = floor - 20 * s - this.ledge;
    this.hasSill = this.hasFrame && floor > 0 && sillTop > h * 0.5;
    const H = (this.H = this.hasSill ? sillTop : h);
    const R = rng(this.seed);
    const r = (a: number, b: number) => a + R() * (b - a);

    this.genCity(R);
    const sharp = canvas(w, h);
    this.paintCity(sharp.getContext('2d')!, false, rng(this.seed + 1));
    this.clear = blurred(sharp, w, h, 1.5 * s);

    // through misted glass: everything melts into soft lights, as 비멍 used to look
    const foggy = blurred(sharp, w, h, 15 * s);
    let x = foggy.getContext('2d')!;
    x.globalCompositeOperation = 'lighter';
    const n = clamp(Math.round((w * H) / 9000), 14, 90);
    for (let i = 0; i < n; i++) {
      const c = BOKEH[Math.floor(R() * BOKEH.length)];
      const br = r(12, 46) * s;
      x.globalAlpha = r(0.08, 0.26);
      x.drawImage(disc(c[0], c[1], c[2]), r(0, w) - br, r(0.42, 0.96) * H - br, br * 2, br * 2);
    }
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.fillStyle = 'rgba(168,188,218,0.27)';
    x.fillRect(0, 0, w, h);
    this.foggy = foggy;

    const lit = canvas(w, h);
    this.paintCity(lit.getContext('2d')!, true, rng(this.seed + 1));
    this.flashBg = blurred(lit, w, h, 2.6 * s);

    // what the droplets show: the sharp city turned upside down and brightened
    const ref = canvas(w / 2, h / 2);
    x = ref.getContext('2d')!;
    x.translate(ref.width, ref.height);
    x.rotate(Math.PI);
    x.drawImage(sharp, 0, 0, ref.width, ref.height);
    x.globalCompositeOperation = 'lighter';
    x.globalAlpha = 0.8;
    x.drawImage(sharp, 0, 0, ref.width, ref.height);
    this.ref = ref;

    // resting mist: thick at the bottom of the pane, thin around eye level
    const F = this.variant === 'full' ? 0.55 : 0.45;
    const fb = canvas(w, h);
    x = fb.getContext('2d')!;
    let g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `rgba(255,255,255,${0.3 * F})`);
    g.addColorStop(0.5, `rgba(255,255,255,${0.55 * F})`);
    g.addColorStop(1, `rgba(255,255,255,${Math.min(1, 1.02 * F)})`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'destination-out';
    for (const p of this.panes()) {
      const cx = p.x + p.w / 2;
      const cy = H * 0.3;
      const cr = Math.max(p.w * 0.62, H * 0.3);
      g = x.createRadialGradient(cx, cy, 0, cx, cy, cr);
      g.addColorStop(0, 'rgba(0,0,0,0.38)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    }
    for (let i = 0; i < 14 * this.area; i++) {
      const cx = r(0, w);
      const cy = r(0, H);
      const cr = r(40, 120) * s;
      g = x.createRadialGradient(cx, cy, 0, cx, cy, cr);
      g.addColorStop(0, `rgba(0,0,0,${r(0.05, 0.2)})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(cx - cr, cy - cr, cr * 2, cr * 2);
    }
    this.fogBase = fb;
    // a resize keeps what was wiped and the drops already on the glass
    const oldMask = this.mask;
    this.mask = canvas(w, h);
    this.mx = this.mask.getContext('2d')!;
    this.mx.drawImage(oldMask ?? fb, 0, 0, w, h);
    this.fogComp = canvas(w, h);
    this.fx = this.fogComp.getContext('2d')!;

    const oldGlass = this.glass;
    this.glass = canvas(w * dpr, h * dpr);
    this.gx = this.glass.getContext('2d')!;
    if (oldGlass) this.gx.drawImage(oldGlass, 0, 0, this.glass.width, this.glass.height);
    this.gx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!oldGlass) {
      const count = Math.round((60 + 300 * this.intensity) * this.area);
      for (let i = 0; i < count; i++) this.hit(0.25 + Math.random() * 0.75);
    }

    this.frameLayer = this.hasFrame ? layer(w, h, dpr, (fx) => this.paintFrame(fx, rng(this.seed + 2))) : null;
    this.vig = vignette(w, h, 1, this.hasSill ? 0.36 : 0.5);
    this.streaks = Array.from({ length: Math.round(360 * this.area) }, () => this.newStreak(true));
    this.sliders = [];
    this.cars = [];
    this.wipeLast = null;
  }

  private newStreak(initial: boolean): Streak {
    const { w, H, s } = this;
    return {
      x: (-0.15 + Math.random() * 1.2) * w,
      y: (initial ? -0.1 + Math.random() * 1.1 : -0.25 + Math.random() * 0.23) * H,
      len: (16 + Math.random() * 22) * s,
      v: (650 + Math.random() * 450) * s,
    };
  }

  /* ---------- droplets ---------- */
  private drop(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, alpha: number) {
    const r = Math.max(rx, ry);
    ctx.globalAlpha = alpha;
    if (r < 2.1) {
      ctx.fillStyle = 'rgba(6,10,18,0.5)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = 'rgba(214,230,255,0.62)';
      ctx.beginPath();
      ctx.arc(x - r * 0.15, y + r * 0.32, r * 0.5, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    }
    const { w, h, ref } = this;
    const k = ref.width / w;
    // a drop is a wide-angle lens: it shows a patch of the city many times its own size
    const span = Math.min(r * 13, w * 0.9, h * 0.9);
    const sx = clamp(w - x - span / 2, 0, w - span);
    const sy = clamp(h - y - span / 2, 0, h - span);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.clip();
    ctx.drawImage(ref, sx * k, sy * k, span * k, span * k, x - rx, y - ry, rx * 2, ry * 2);
    ctx.restore();
    ctx.drawImage(shade(), x - rx / SHADE_K, y - ry / SHADE_K, (rx * 2) / SHADE_K, (ry * 2) / SHADE_K);
    ctx.globalAlpha = 1;
  }

  /** A new drop lands on the glass and stays. */
  private hit(alpha = 1) {
    const r = (Math.pow(Math.random(), 2.6) * 4.4 + 0.7) * this.s;
    this.drop(this.gx, Math.random() * this.w, Math.random() * this.H, r, r * (0.92 + Math.random() * 0.18), alpha);
  }

  private activeStreaks() {
    return Math.min(this.streaks.length, Math.round((40 + 320 * this.intensity) * this.area * this.motion));
  }

  step(dt: number) {
    const { w, h, H, s } = this;
    const I = this.intensity;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    this.t += dt;
    const active = this.activeStreaks();
    for (let i = 0; i < active; i++) {
      const st = this.streaks[i];
      const v = st.v * (0.75 + 0.45 * I);
      st.y += v * dt;
      st.x += v * 0.16 * dt;
      if (st.y - st.len > H) Object.assign(st, this.newStreak(false));
    }
    // cars on the street below
    this.carAcc -= dt;
    if (this.carAcc <= 0 && this.cars.length < 4) {
      const dir = Math.random() < 0.5 ? -1 : 1;
      this.cars.push({ x: dir > 0 ? -30 * s : w + 30 * s, v: dir * rnd(50, 110) * s, y: H * (dir > 0 ? 0.925 : 0.895), head: Math.random() < 0.5 });
      this.carAcc = rnd(2, 6);
    }
    for (const c of this.cars) c.x += c.v * dt;
    this.cars = this.cars.filter((c) => c.x > -60 * s && c.x < w + 60 * s);
    // drops keep landing and slowly dry, so the glass follows the rain's strength
    const g = this.gx;
    this.hitAcc += dt * (1.5 + 7 * I) * this.area;
    while (this.hitAcc >= 1) {
      this.hitAcc -= 1;
      this.hit();
    }
    this.evapAcc += dt;
    if (this.evapAcc > 3) {
      this.evapAcc = 0;
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = 'rgba(0,0,0,0.06)';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }
    // drops heavy enough to run down
    this.slideAcc += dt * (0.3 + 1.8 * I) * (w / 390);
    while (this.slideAcc >= 1) {
      this.slideAcc -= 1;
      if (this.sliders.length < 24 * this.area) {
        this.sliders.push({ x: rnd(0, w), y: rnd(-0.05, 0.7) * H, r: rnd(3.6, 7.6) * s, v: 0, wait: rnd(0.2, 1.6), seed: rnd(0, TAU), tr: 0 });
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
      // it sweeps up the small drops in its way...
      g.globalCompositeOperation = 'destination-out';
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(d.x, d.y, d.r * 1.15, 0, TAU);
      g.fill();
      g.globalCompositeOperation = 'source-over';
      // ...and leaves a line of beads behind
      d.tr += d.v * dt;
      if (d.tr > 7 * s) {
        d.tr = 0;
        if (Math.random() < 0.7) {
          const br = d.r * rnd(0.2, 0.42);
          this.drop(g, d.x + rnd(-1, 1) * s, d.y - d.r * 1.25 - br, br, br * 1.1, 1);
        }
      }
    }
    this.sliders = this.sliders.filter((d) => d.y < H + 20);
    this.fogAcc += dt;
    if (this.fogAcc > REFOG_EVERY) {
      this.fogAcc = 0;
      if (!this.wipeLast) this.refog();
    }
    if (this.thunder) {
      this.nextFlash -= dt;
      if (this.nextFlash <= 0) {
        this.flashT = 0;
        this.nextFlash = rnd(20, 40);
        const bx = rnd(0.2, 0.8) * w;
        const pts: [number, number][] = [[bx, -10]];
        for (let i = 1; i <= 9; i++) pts.push([bx + rnd(-16, 16) * s * i * 0.35 + i * rnd(-3, 3) * s, (H * 0.3 * i) / 9]);
        this.bolt = pts;
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
    const { w, h, H, s, t } = this;
    const I = this.intensity;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.clear, 0, 0, w, h);
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.85;
      ctx.drawImage(this.flashBg, 0, 0, w, h);
      if (this.bolt && this.flashT < 0.24) {
        ctx.strokeStyle = '#fff';
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        for (const [lw, a] of [[10 * s, 0.16], [2.2 * s, 1]]) {
          ctx.globalAlpha = this.flash * a;
          ctx.lineWidth = lw;
          ctx.beginPath();
          this.bolt.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.globalCompositeOperation = 'lighter';
    // warning light on the tallest tower
    ctx.globalAlpha = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(t * 2.6), 6);
    ctx.drawImage(glow(255, 60, 50), this.beacon.x - 9 * s, this.beacon.y - 9 * s, 18 * s, 18 * s);
    for (const c of this.cars) {
      const sp = c.head ? glow(255, 238, 205) : glow(255, 56, 46);
      const r = (c.head ? 11 : 8) * s;
      for (const o of [-6, 6]) {
        ctx.globalAlpha = 0.9;
        ctx.drawImage(sp, c.x + o * s - r, c.y - r, r * 2, r * 2);
        ctx.globalAlpha = 0.26; // and its reflection on the wet road
        ctx.drawImage(sp, c.x + o * s - r * 0.8, c.y + 2 * s, r * 1.6, 52 * s);
      }
    }
    ctx.strokeStyle = 'rgb(190,210,240)';
    ctx.lineWidth = Math.max(0.7, 1.1 * s);
    ctx.lineCap = 'round';
    const active = this.activeStreaks();
    for (let bucket = 0; bucket < 3; bucket++) {
      ctx.globalAlpha = (0.07 + bucket * 0.07) * (0.7 + 0.5 * I) * (1 + this.flash);
      ctx.beginPath();
      for (let i = bucket; i < active; i += 3) {
        const st = this.streaks[i];
        ctx.moveTo(st.x, st.y);
        ctx.lineTo(st.x - st.len * 0.16, st.y - st.len);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    // misted glass: the soft view, kept only where the mask still has mist
    const f = this.fx;
    f.globalCompositeOperation = 'copy';
    f.drawImage(this.foggy, 0, 0);
    f.globalCompositeOperation = 'destination-in';
    f.drawImage(this.mask!, 0, 0);
    ctx.drawImage(this.fogComp, 0, 0, w, h);
    if (this.flash > 0) {
      ctx.globalAlpha = this.flash * 0.2;
      ctx.fillStyle = '#c8d6ff';
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = 'rgba(10,18,32,0.1)';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(this.glass!, 0, 0, w, h);
    for (const d of this.sliders) {
      const sp = clamp(d.v / (200 * s), 0, 1);
      this.drop(ctx, d.x, d.y, d.r * (1 - 0.14 * sp), d.r * (1 + 0.45 * sp), 1);
    }
    if (this.frameLayer) {
      // the room's lamp, reflected in the glass
      ctx.globalCompositeOperation = 'lighter';
      const lx = w * (this.wide ? 0.84 : 0.8);
      const ly = H * 0.2;
      ctx.globalAlpha = 0.11 + 0.01 * Math.sin(t * 0.7);
      ctx.drawImage(glow(255, 178, 108), lx - 150 * s, ly - 150 * s, 300 * s, 300 * s);
      ctx.globalAlpha = 0.1;
      ctx.drawImage(glow(255, 214, 160), lx - 26 * s, ly - 26 * s, 52 * s, 52 * s);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.frameLayer, 0, 0, w, h);
      if (this.hasSill) this.drawSteam(ctx);
    }
    ctx.drawImage(this.vig, 0, 0, w, h);
  }

  /** Steam rising from the mug on the sill. */
  private drawSteam(ctx: CanvasRenderingContext2D) {
    const { s, t, mug } = this;
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const life = (t * 0.22 + i / 3) % 1;
      ctx.strokeStyle = `rgba(255,236,214,${0.1 * Math.sin(life * Math.PI)})`;
      ctx.lineWidth = (4 + 5 * life) * s;
      ctx.beginPath();
      for (let k = 0; k <= 10; k++) {
        const p = k / 10;
        const y = mug.y - (8 + 52 * life) * s * p - 20 * s * life;
        const x = mug.x + (i - 1) * 5 * s + Math.sin(t * 0.9 + p * 4 + i * 2.1) * 7 * s * p;
        if (k) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
