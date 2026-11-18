import { Scene, type SceneVariant } from './base';
import { clamp, layer, rand, roundRect } from './util';

/*
 * 모래멍: an hourglass on a table under a lamp (Doan board sand-hourglass, prototype .doan/assets/sand-hourglass.js).
 *
 * Every grain is one pixel and remembers its band (0..4), brightness (0..63) and kind (plain · dark speck · quartz);
 * its colour is looked up in the palette when it is drawn, so a new palette keeps the shape and spreads over 0.7 s.
 * The light of the round glass (bright in the middle, dark at the edges) depends only on the bulb's shape, so it is
 * baked once. In the lower bulb a grain sticks where it lands for a moment, and the slope slides one cell per step
 * once it is steeper than ~34° (dry sand's angle of repose): small avalanches. The upper bulb sinks into a funnel.
 *
 * The hourglass lives in its own fixed coordinates (glass 540 px high, 122 px half-width, same on phones and
 * desktops) and is only placed and, on short screens, scaled down. Columns whose sand did not change are not
 * repainted.
 */

export type SandPalette = 'desert' | 'white' | 'black' | 'rose' | 'dune' | 'dusk' | 'sea';
/** 15 · 30 minutes for one run, or 끝없이 (it turns itself over every LOOP_SECONDS). */
export type SandMode = '15' | '30' | 'loop';

type RGB = readonly [number, number, number];
interface PaletteDef {
  id: SandPalette;
  label: string;
  /** one colour (the bands are nearly the same) or a set of five bands */
  group: 'one' | 'band';
  bands: readonly RGB[];
  speck: RGB;
  glint: RGB;
  /** dark sand: a faint rim of light on the stream so it does not vanish against the room */
  rim?: RGB;
}

export const SAND_PALETTES: readonly PaletteDef[] = [
  { id: 'desert', label: '사막', group: 'one', bands: [[222, 194, 148], [212, 182, 136], [229, 203, 160], [206, 175, 130], [218, 190, 144]], speck: [92, 70, 54], glint: [255, 247, 228] },
  { id: 'white', label: '백사', group: 'one', bands: [[236, 231, 218], [227, 221, 206], [242, 238, 227], [222, 214, 199], [232, 227, 213]], speck: [118, 110, 102], glint: [255, 255, 255] },
  { id: 'black', label: '흑사', group: 'one', bands: [[64, 60, 58], [56, 53, 52], [72, 66, 62], [50, 48, 48], [66, 61, 59]], speck: [22, 20, 20], glint: [236, 232, 224], rim: [206, 198, 186] },
  { id: 'rose', label: '장밋빛', group: 'one', bands: [[226, 166, 156], [216, 154, 147], [233, 179, 168], [210, 148, 143], [223, 162, 153]], speck: [118, 68, 70], glint: [255, 238, 232] },
  { id: 'dune', label: '사구', group: 'band', bands: [[240, 226, 196], [218, 180, 124], [192, 128, 84], [142, 94, 66], [88, 72, 64]], speck: [52, 40, 34], glint: [255, 246, 226] },
  { id: 'dusk', label: '노을', group: 'band', bands: [[244, 208, 146], [234, 152, 108], [204, 98, 116], [132, 88, 156], [64, 66, 120]], speck: [40, 30, 46], glint: [255, 240, 220] },
  { id: 'sea', label: '바다', group: 'band', bands: [[236, 232, 216], [152, 208, 198], [78, 154, 172], [48, 98, 146], [30, 54, 92]], speck: [20, 30, 44], glint: [240, 252, 255] },
];
export const DEFAULT_PALETTE: SandPalette = 'dusk';
export const isSandPalette = (v: unknown): v is SandPalette => SAND_PALETTES.some((p) => p.id === v);
export const isSandMode = (v: unknown): v is SandMode => v === '15' || v === '30' || v === 'loop';
const paletteOf = (id: SandPalette) => SAND_PALETTES.find((p) => p.id === id) ?? SAND_PALETTES[5];

/** 끝없이: one run takes this long, then it rests a moment and turns itself over. */
export const LOOP_SECONDS = 180;
/** The home card runs at the board's pace so something happens while you look. */
const CARD_SECONDS = 60;
const FLIP_SECONDS = 1.8;
const FLIP_SECONDS_CALM = 0.8; // reduced motion: no turning, the glass dims and comes back
const FADE_SECONDS = 0.7; // palette crossfade
const REST_LOOP = 2.2;
const REST_TIMER = 3.4;
const GRAVITY = 1150;
const MAX_FLY = 4000;
/** Lower bulb: a falling grain stays where it lands with this chance (a bounced one less often). */
const STICK = 0.42;
const STICK_BOUNCED = 0.2;
const BOUNCE = 0.16;
/**
 * An avalanche: the lower slope always creeps a little, so it counts as one when the cells slid within one
 * AVALANCHE_WINDOW are well above the usual creep (AVALANCHE_RISE × its running average) and at least AVALANCHE_MIN.
 */
const AVALANCHE_WINDOW = 0.25;
const AVALANCHE_RISE = 1.8;
const AVALANCHE_MIN = 12;
const AVALANCHE_GAP = 0.6;

/* ---------- the hourglass in its own coordinates ---------- */
const LW = 320; // local box: caps are 300 wide
const LCX = LW / 2;
const LTOP = 26; // glass top (cap above it)
const GLASS_H = 540;
const LBOT = LTOP + GLASS_H;
const LNECK = (LTOP + LBOT) / 2;
const BH = LNECK - LTOP;
const LH = LBOT + 26;
const MAX_HALF = 122;
const NECK_HALF = 3.4;
const CAP_W = 150;
const CAP_H = 22;
const PILLAR = 136;
/** From the top of the cap to the table under the hourglass, local px. */
const SPAN = LBOT + CAP_H + 4 - (LTOP - CAP_H);

const easeIO = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const bell = () => Math.random() + Math.random() + Math.random() - 1.5;

/** Half-width of the glass. s: 0 at the neck, 1 at the cap. */
function half(s: number) {
  const b = Math.pow(Math.sin((Math.min(1, s / 0.8) * Math.PI) / 2), 1.3);
  const sh = s > 0.86 ? Math.sqrt(Math.max(0, 1 - ((s - 0.86) / 0.14) ** 2 * 0.22)) : 1;
  return NECK_HALF + (MAX_HALF - NECK_HALF) * b * sh;
}

/* ---------- colour ---------- */
const JIT = 64;
/** ImageData bytes are R,G,B,A, so as Uint32 they are ABGR. */
const pack = (r: number, g: number, b: number) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;

/** A grain: band (0..4) · brightness (0..63) · kind (0 plain · 1 dark speck · 2 quartz). The top bit marks it as sand. */
function grain(band: number) {
  const r = Math.random();
  const kind = r < 0.045 ? 1 : r < 0.08 ? 2 : 0;
  const jit = clamp(Math.round(32 + bell() * 26), 0, JIT - 1);
  return ((1 << 24) | (kind << 16) | (jit << 8) | band) >>> 0;
}
const lutIndex = (g: number) => ((g & 255) * 3 + ((g >>> 16) & 255)) * JIT + ((g >>> 8) & 255);

/** Five bands × three kinds × 64 brightnesses = 960 colours per palette, made once. */
const LUTS = new Map<SandPalette, Uint32Array>();
function lutOf(id: SandPalette) {
  const hit = LUTS.get(id);
  if (hit) return hit;
  const p = paletteOf(id);
  const lut = new Uint32Array(5 * 3 * JIT);
  for (let b = 0; b < 5; b++) {
    const base = p.bands[b];
    for (let kind = 0; kind < 3; kind++) {
      for (let j = 0; j < JIT; j++) {
        const t = j / (JIT - 1);
        let k = 0.8 + 0.3 * t;
        // light grains a little yellower, dark ones a little redder (quartz and feldspar)
        let r = base[0] + (t - 0.5) * 6;
        let g = base[1] + (t - 0.5) * 8;
        let bl = base[2] + (t - 0.5) * 2;
        if (kind === 1) {
          const m = 0.72;
          r += (p.speck[0] - r) * m; g += (p.speck[1] - g) * m; bl += (p.speck[2] - bl) * m;
          k = 0.85 + 0.25 * t;
        } else if (kind === 2) {
          const m = 0.55;
          r += (p.glint[0] - r) * m; g += (p.glint[1] - g) * m; bl += (p.glint[2] - bl) * m;
          k = 1;
        }
        lut[(b * 3 + kind) * JIT + j] = pack(clamp(r * k, 0, 255) | 0, clamp(g * k, 0, 255) | 0, clamp(bl * k, 0, 255) | 0);
      }
    }
  }
  LUTS.set(id, lut);
  return lut;
}

/* ================= one bulb of settled sand =================
   Column c holds sand from flo[c] up to just below cei[c]; hts[c] is its height now (cells from the bottom).
   dirty[c]: the column must be repainted (its sand or a neighbour's height changed). */
class Pile {
  readonly grid: Uint32Array;
  readonly hts: Int32Array;
  readonly snap: Int32Array;
  readonly dirty: Uint8Array;
  readonly light: Float32Array;
  readonly off: HTMLCanvasElement;
  readonly view: Uint32Array;
  private readonly octx: CanvasRenderingContext2D;
  private readonly img: ImageData;
  count = 0;
  cap = 0;
  allDirty = true;

  constructor(readonly cols: number, readonly rows: number, readonly flo: Int32Array, readonly cei: Int32Array) {
    this.grid = new Uint32Array(cols * rows);
    this.hts = Int32Array.from(flo);
    this.snap = new Int32Array(cols);
    this.dirty = new Uint8Array(cols);
    for (let c = 0; c < cols; c++) this.cap += Math.max(0, cei[c] - flo[c]);
    this.off = document.createElement('canvas');
    this.off.width = cols;
    this.off.height = rows;
    this.octx = this.off.getContext('2d')!;
    this.img = this.octx.createImageData(cols, rows);
    this.view = new Uint32Array(this.img.data.buffer);
    this.light = this.bakeLight();
  }

  at(c: number, k: number) { return (this.rows - 1 - k) * this.cols + c; }

  /** Column c changed height: it and the columns whose light depends on it (two either side) repaint. */
  touch(c: number) {
    const d = this.dirty;
    const a = Math.max(0, c - 2);
    const b = Math.min(this.cols - 1, c + 2);
    for (let i = a; i <= b; i++) d[i] = 1;
  }

  clear() {
    this.grid.fill(0);
    this.hts.set(this.flo);
    this.count = 0;
    this.allDirty = true;
  }

  /** The round glass brings the middle of every row forward; lit from the front right. */
  private bakeLight() {
    const { cols, rows, flo, cei } = this;
    const m = new Float32Array(cols * rows);
    for (let k = 0; k < rows; k++) {
      let L = -1;
      let R = -1;
      for (let c = 0; c < cols; c++) if (k >= flo[c] && k < cei[c]) { if (L < 0) L = c; R = c; }
      if (L < 0) continue;
      const mid = (L + R + 1) / 2;
      const hw = Math.max(1, (R - L + 1) / 2);
      for (let c = L; c <= R; c++) {
        const u = clamp((c + 0.5 - mid) / hw, -1, 1);
        const z = Math.sqrt(1 - u * u);
        const lam = Math.max(0, 0.42 * u + 0.9 * z);
        let f = 0.5 + 0.56 * lam;
        if (Math.min(c - L, R - c) < 2) f *= 0.82; // grains against the glass are in shade
        if (u > 0.82) f *= 1.06; // light coming through the right side of the glass
        m[(rows - 1 - k) * cols + c] = f;
      }
    }
    return m;
  }

  /** A grain comes to rest in column c: with chance `stick` it stays there, otherwise it rolls to the lower side. */
  land(c: number, g: number, dir: number, stick = 0) {
    const h = this.hts;
    const cei = this.cei;
    const last = this.cols - 1;
    c = clamp(c | 0, 0, last);
    for (let i = 0; i < 900; i++) {
      const hc = h[c];
      const full = hc >= cei[c];
      if (!full && i === 0 && stick && Math.random() < stick) break;
      const l = c > 0 && h[c - 1] < cei[c - 1] ? h[c - 1] : 1e9;
      const r = c < last && h[c + 1] < cei[c + 1] ? h[c + 1] : 1e9;
      let canL: boolean;
      let canR: boolean;
      if (full) {
        canL = l < 1e9;
        canR = r < 1e9;
        if (canL && canR) { canL = l <= r; canR = !canL; }
      } else {
        const l2 = c > 1 ? h[c - 2] : 1e9;
        const r2 = c < last - 1 ? h[c + 2] : 1e9;
        canL = l < hc || (l <= hc && l2 < hc && Math.random() < 0.55);
        canR = r < hc || (r <= hc && r2 < hc && Math.random() < 0.55);
      }
      if (!canL && !canR) break;
      if (canL && canR) { if (!dir) dir = Math.random() < 0.5 ? -1 : 1; } else dir = canL ? -1 : 1;
      c += dir;
    }
    if (h[c] >= cei[c]) return false;
    this.grid[this.at(c, h[c])] = g;
    h[c]++;
    this.count++;
    this.touch(c);
    return true;
  }

  move(from: number, to: number) {
    const a = this.at(from, this.hts[from] - 1);
    const g = this.grid[a];
    this.grid[a] = 0;
    this.hts[from]--;
    this.grid[this.at(to, this.hts[to])] = g;
    this.hts[to]++;
    this.touch(from);
    this.touch(to);
  }

  /** Slide all the way at once (unseen tidying). */
  relax(lim: number, passes: number) {
    const h = this.hts;
    const flo = this.flo;
    const cei = this.cei;
    const n = this.cols;
    for (let p = 0; p < passes; p++) {
      let moved = false;
      for (let c = 0; c < n - 1; c++) while (h[c] - h[c + 1] > lim && h[c] > flo[c] && h[c + 1] < cei[c + 1]) { this.move(c, c + 1); moved = true; }
      for (let c = n - 1; c > 0; c--) while (h[c] - h[c - 1] > lim && h[c] > flo[c] && h[c - 1] < cei[c - 1]) { this.move(c, c - 1); moved = true; }
      if (!moved) break;
    }
  }

  /**
   * One cell per column per call, so calling it a few times a frame shows sand running down the slope.
   * One cell of difference (45°) is too steep: two cells higher than three columns over (~34°) slides as well.
   */
  slide(lim: number) {
    const h = this.hts;
    const s = this.snap;
    const flo = this.flo;
    const cei = this.cei;
    const n = this.cols;
    s.set(h);
    let moved = 0;
    const ltr = Math.random() < 0.5;
    for (let q = 0; q < n - 1; q++) {
      const c = ltr ? q : n - 2 - q;
      const d = s[c] - s[c + 1];
      const far = c + 3 < n && s[c] - s[c + 3] > 2 && h[c + 3] < cei[c + 3];
      const farL = c - 2 >= 0 && s[c + 1] - s[c - 2] > 2 && h[c - 2] < cei[c - 2];
      if (d > lim || (d >= 1 && far)) {
        let m = Math.max(1, (d - lim + 1) >> 1);
        while (m-- > 0 && h[c] > flo[c] && h[c + 1] < cei[c + 1]) { this.move(c, c + 1); moved++; }
      } else if (-d > lim || (-d >= 1 && farL)) {
        let m = Math.max(1, (-d - lim + 1) >> 1);
        while (m-- > 0 && h[c + 1] > flo[c + 1] && h[c] < cei[c]) { this.move(c + 1, c); moved++; }
      }
    }
    return moved;
  }

  /** n grains per column leave through the hole under columns a..b. */
  drain(a: number, b: number, n: number, out: (c: number, g: number) => void) {
    const g = this.grid;
    const h = this.hts;
    const flo = this.flo;
    for (let c = a; c <= b; c++) {
      const k = Math.min(n, h[c] - flo[c]);
      if (k <= 0) continue;
      for (let j = 0; j < k; j++) out(c, g[this.at(c, flo[c] + j)]);
      for (let q = flo[c]; q < h[c]; q++) g[this.at(c, q)] = q + k < h[c] ? g[this.at(c, q + k)] : 0;
      h[c] -= k;
      this.count -= k;
      this.touch(c);
    }
  }

  /** Every grain, top row first, as [column, grain, column, grain, ...]; the bulb is left empty. */
  takeAll() {
    const out: number[] = [];
    let top = 0;
    for (let c = 0; c < this.cols; c++) if (this.hts[c] > top) top = this.hts[c];
    for (let k = top - 1; k >= 0; k--) {
      for (let c = 0; c < this.cols; c++) {
        if (k < this.flo[c] || k >= this.hts[c]) continue;
        const g = this.grid[this.at(c, k)];
        if (g) out.push(c, g);
      }
    }
    this.clear();
    return out;
  }

  pour(list: number[], map: (c: number) => number) {
    for (let i = 0; i < list.length; i += 2) this.land(map(list[i]), list[i + 1], 0);
  }

  /**
   * Repaint what changed. `lut`: the palette now, `old`/`fade`: the one before and how much of it is left.
   * `glintT`: the clock that picks when a quartz grain on the surface catches the light (null: no sparkle).
   */
  paint(lut: Uint32Array, old: Uint32Array, fade: number, glintT: number | null) {
    const { cols, dirty } = this;
    const all = this.allDirty || fade > 0;
    if (all) this.view.fill(0);
    for (let c = 0; c < cols; c++) {
      if (all || dirty[c]) {
        if (!all) this.clearColumn(c);
        this.paintColumn(c, lut, old, fade, glintT, false);
      } else if (glintT !== null) this.paintColumn(c, lut, old, 0, glintT, true);
      dirty[c] = 0;
    }
    this.allDirty = false;
  }

  private clearColumn(c: number) {
    const { view, cols, rows } = this;
    for (let r = 0; r < rows; r++) view[r * cols + c] = 0;
  }

  /** `topOnly`: just the two surface cells, where quartz may sparkle. */
  private paintColumn(c: number, lut: Uint32Array, old: Uint32Array, fade: number, glintT: number | null, topOnly: boolean) {
    const { cols, rows, grid: g, hts: h, flo, view, light } = this;
    const last = cols - 1;
    const top = h[c];
    if (top <= flo[c]) return;
    const hl = c > 1 ? h[c - 2] : c > 0 ? h[c - 1] : top;
    const hr = c < last - 1 ? h[c + 2] : c < last ? h[c + 1] : top;
    // higher on the left: the surface faces the lamp on the right
    const face = 1 + clamp(hl - hr, -6, 6) * 0.03;
    const open = Math.min(c > 0 ? h[c - 1] : top, c < last ? h[c + 1] : top);
    const fo = Math.round(fade * 256);
    const fn = 256 - fo;
    for (let k = topOnly ? Math.max(flo[c], top - 2) : flo[c]; k < top; k++) {
      const i = (rows - 1 - k) * cols + c;
      const gr = g[i];
      const kind = (gr >>> 16) & 255;
      const d = top - 1 - k;
      if (topOnly && kind !== 2) continue;
      const li = lutIndex(gr);
      let col = lut[li];
      if (fo) {
        const o = old[li];
        col = ((((col & 255) * fn + (o & 255) * fo) >> 8)
          | (((((col >>> 8) & 255) * fn + ((o >>> 8) & 255) * fo) >> 8) << 8)
          | (((((col >>> 16) & 255) * fn + ((o >>> 16) & 255) * fo) >> 8) << 16)) >>> 0;
      }
      let f: number;
      if (d === 0) f = face * 1.1;
      else if (k >= open) f = face * 1.04;
      else if (d < 3) f = face;
      else f = 1 - Math.min(0.2, (d - 3) * 0.014);
      f *= light[i];
      if (glintT !== null && d < 2 && kind === 2) {
        const ph = ((gr >>> 8) & 255) * 0.37 + c * 0.11;
        const s = Math.sin(glintT * 1.7 + ph * 9.1);
        if (s > 0.94) f *= 1 + (s - 0.94) * 9;
      }
      let r = (col & 255) * f;
      let gg = ((col >>> 8) & 255) * f;
      let b = ((col >>> 16) & 255) * f;
      if (f > 1.08) {
        const t = (f - 1.08) * 60;
        r += t; gg += t; b += t;
      }
      view[i] = ((255 << 24) | ((b > 255 ? 255 : b | 0) << 16) | ((gg > 255 ? 255 : gg | 0) << 8) | (r > 255 ? 255 : r | 0)) >>> 0;
    }
  }

  put() { this.octx.putImageData(this.img, 0, 0); }
}

/** Falling grains. k: 0 still falling · 1 bounced off the cone. */
class Fly {
  readonly x = new Float32Array(MAX_FLY);
  readonly y = new Float32Array(MAX_FLY);
  readonly vx = new Float32Array(MAX_FLY);
  readonly vy = new Float32Array(MAX_FLY);
  readonly g = new Uint32Array(MAX_FLY);
  readonly k = new Uint8Array(MAX_FLY);
  n = 0;

  add(x: number, y: number, vx: number, vy: number, g: number) {
    if (this.n >= MAX_FLY) return false;
    const i = this.n++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.g[i] = g; this.k[i] = 0;
    return true;
  }

  kill(i: number) {
    const j = --this.n;
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.g[i] = this.g[j]; this.k[i] = this.k[j];
  }
}

type State = 'run' | 'rest' | 'flip';

export interface SandOptions {
  palette?: SandPalette;
  mode?: SandMode;
  /** 15분 · 30분: turn it over again once it has run out (off: it stops). 끝없이 always turns over. */
  autoflip?: boolean;
}

/**
 * 모래멍 · 모래시계. Stats for the view: `left` (seconds left in 15분 · 30분), `flips` (끝없이), `done` (a timed run
 * ended; 1 if it will turn over by itself). Events for the sound: `flip`, `avalanche` {size}, `done`.
 */
export class Sand extends Scene {
  palette: SandPalette;
  mode: SandMode;
  autoflip: boolean;

  private lut: Uint32Array;
  private oldLut: Uint32Array;
  private fade = 0;

  private readonly cols = Math.ceil(MAX_HALF * 2);
  private readonly rows = Math.ceil(BH);
  private readonly x0 = LCX - Math.ceil(MAX_HALF * 2) / 2;
  private readonly up: Pile;
  private readonly lo: Pile;
  /** the columns right above the neck */
  private ha = -1;
  private hb = -1;
  private readonly fly = new Fly();
  private total = 0;
  /** grains per second through the neck */
  private rate = 1;
  private acc = 0;
  private starve = 0;

  private state: State = 'run';
  private wait = 0;
  private ft = 0;
  private swapped = false;
  private flips = 0;
  private angle = 0;
  private lift = 0;
  private dim = 0;
  private tilt = 0;
  private tiltTo = 0;
  private dragging = false;
  private sx = 0;

  /** grains per second actually leaving the neck (smoothed), for the sound */
  private flowed = 0;
  private gps = 0;
  private slid = 0;
  private slidT = 0;
  /** running average of cells slid per window */
  private creep = 0;
  private lastAvalanche = 0;
  private lastLeft = -1;
  private lastFlips = -1;

  /** Stamped falling grains, cleared again before the next paint. */
  private stamped: number[] = [];

  /* placement on screen */
  private edgeTop: number | null = null;
  private edgeFloor: number | null = null;
  private k = 1;
  private sx0 = 0;
  private sNeck = 0;
  private room: HTMLCanvasElement | null = null;
  private back: HTMLCanvasElement | null = null;
  private front: HTMLCanvasElement | null = null;
  private frame: HTMLCanvasElement | null = null;

  constructor(variant: SceneVariant, opts: SandOptions = {}) {
    super(variant);
    this.palette = opts.palette && isSandPalette(opts.palette) ? opts.palette : DEFAULT_PALETTE;
    this.mode = variant === 'card' ? 'loop' : opts.mode && isSandMode(opts.mode) ? opts.mode : 'loop';
    this.autoflip = opts.autoflip ?? false;
    this.lut = this.oldLut = lutOf(this.palette);

    const { cols, rows, x0 } = this;
    const fu = new Int32Array(cols);
    const cu = new Int32Array(cols);
    const fl = new Int32Array(cols);
    const cl = new Int32Array(cols);
    const wall = 2.2; // glass thickness
    for (let c = 0; c < cols; c++) {
      const dx = Math.abs(x0 + c + 0.5 - LCX);
      let a = -1, b = -1, a2 = -1, b2 = -1;
      for (let k = 0; k < rows; k++) {
        const s = (k + 0.5) / BH;
        if (dx <= half(s) - wall) { if (a < 0) a = k; b = k; }
        if (dx <= half(1 - s) - wall) { if (a2 < 0) a2 = k; b2 = k; }
      }
      fu[c] = a < 0 ? 0 : a; cu[c] = a < 0 ? 0 : b + 1;
      fl[c] = a2 < 0 ? 0 : a2; cl[c] = a2 < 0 ? 0 : b2 + 1;
    }
    this.up = new Pile(cols, rows, fu, cu);
    this.lo = new Pile(cols, rows, fl, cl);
    for (let c = 0; c < cols; c++) if (cu[c] > 0 && fu[c] === 0) { if (this.ha < 0) this.ha = c; this.hb = c; }

    this.fill(0.78);
    this.total = this.up.count;
    // 끝없이 (and the home card) opens part-way through a run; a timer starts with a full top
    if (this.mode === 'loop') this.fast(variant === 'card' ? 0.38 : 0.3);
    this.pace();
  }

  /* ---------- controls ---------- */

  setPalette(id: SandPalette) {
    if (!isSandPalette(id) || id === this.palette) return;
    this.oldLut = this.lut;
    this.fade = 1;
    this.palette = id;
    this.lut = lutOf(id);
  }

  /** 15분 · 30분 count from now: what is left on top runs out in exactly that time (an almost empty top turns over first). */
  setMode(m: SandMode) {
    if (!isSandMode(m)) return;
    this.mode = m;
    this.restat();
    if (m !== 'loop' && (this.state === 'rest' || this.up.count < this.total * 0.15)) {
      if (!this.flip()) this.pace();
    } else this.pace();
  }

  setAutoflip(on: boolean) { this.autoflip = on; }

  get flipping() { return this.state === 'flip'; }

  /** Turn it over (any time but mid-turn). False while it is turning. */
  flip() {
    if (this.state === 'flip') return false;
    const f = this.fly;
    for (let i = 0; i < f.n; i++) this.lo.land(Math.floor(f.x[i] - this.x0), f.g[i], 0);
    f.n = 0;
    this.state = 'flip';
    this.ft = 0;
    this.swapped = false;
    this.emit('flip');
    return true;
  }

  dragStart(x: number) {
    this.dragging = true;
    this.sx = x;
  }

  dragMove(x: number) {
    if (!this.dragging) return false;
    // reduced motion: it leans half as far
    this.tiltTo = clamp((x - this.sx) / 240, -1, 1) * 0.16 * this.motion;
    return true;
  }

  dragEnd() { this.dragging = false; }

  /** The tabs end at `top` and the controls start at `floor` (CSS px); the hourglass stands in between. */
  setEdges(top: number | null, floor: number | null) {
    const t = top === null ? null : Math.round(top);
    const f = floor === null ? null : Math.round(floor);
    const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 2);
    if (same(t, this.edgeTop) && same(f, this.edgeFloor)) return;
    this.edgeTop = t;
    this.edgeFloor = f;
    if (this.w) this.layout();
  }

  /** `flow`: grains per second through the neck right now. `running`: sand is falling. */
  audioState() {
    return { flow: this.gps, running: this.state === 'run' && this.up.count + this.fly.n > 0 ? 1 : 0 };
  }

  /* ---------- sand ---------- */

  private get seconds() {
    if (this.variant === 'card') return CARD_SECONDS;
    return this.mode === 'loop' ? LOOP_SECONDS : Number(this.mode) * 60;
  }

  /** 끝없이: a full top takes LOOP_SECONDS. 15분 · 30분: what is on top now takes exactly that long. */
  private pace() {
    this.rate = this.mode === 'loop' || this.variant === 'card'
      ? this.total / this.seconds
      : Math.max(1, this.up.count) / this.seconds;
  }

  /** Five bands laid one over another in the top bulb. */
  private fill(frac: number) {
    const pile = this.up;
    const n = Math.floor(pile.cap * frac);
    const per = n / 6.5;
    for (let i = 0; i < n; i++) pile.land(Math.floor(Math.random() * pile.cols), grain(Math.floor(i / per) % 5), 0);
    pile.relax(1, 40);
  }

  /** Move what would already have run down. */
  private fast(frac: number) {
    const n = Math.floor(this.up.count * frac);
    const mid = (this.ha + this.hb) / 2;
    let moved = 0;
    let guard = 0;
    while (moved < n && this.up.count > 0 && guard++ < 600000) {
      let got = 0;
      this.up.drain(this.ha, this.hb, 1, (_c, g) => {
        this.lo.land(Math.round(mid + bell() * 2.4), g, 0);
        got++;
      });
      moved += got;
      if (!got || (guard & 3) === 0) this.up.relax(got ? 1 : 0, 3);
    }
    this.up.relax(1, 80);
    for (let i = 0; i < 160; i++) { this.up.slide(1); this.lo.slide(1); }
  }

  /** On its side, top and bottom change places. */
  private swap() {
    const map = (c: number) => this.cols - 1 - c;
    const a = this.lo.takeAll();
    const b = this.up.takeAll();
    this.up.pour(a, map);
    this.lo.pour(b, map);
    this.up.relax(1, 120);
    this.lo.relax(1, 120);
    this.swapped = true;
    this.acc = 0;
    this.starve = 0;
    this.pace();
  }

  /* ---------- layout ---------- */

  layout() {
    const { w, h, dpr } = this;
    const full = this.variant === 'full';
    const top = full ? (this.edgeTop ?? 20) : 0;
    const floor = full ? (this.edgeFloor ?? h) : h;
    const room = Math.max(120, floor - top - (full ? 16 : 0));
    // the same size everywhere; only screens too short (or the home card) get a smaller one
    this.k = Math.min(1, room / (SPAN + 10), (w * (full ? 0.94 : 0.9)) / LW);
    this.sx0 = w / 2;
    this.sNeck = full ? (top + floor) / 2 - 4 * this.k : h * 0.44;
    this.paintRoom();
    const kd = dpr * this.k;
    this.back = layer(LW, LH, kd, (x) => this.paintBack(x));
    this.front = layer(LW, LH, kd, (x) => this.paintFront(x));
    this.frame = layer(LW, LH, kd, (x) => this.paintFrame(x));
  }

  /** Screen y of a local y, with the hourglass upright. */
  private sy(ly: number) { return this.sNeck + (ly - LNECK) * this.k; }

  private paintRoom() {
    const { w, h, dpr, k } = this;
    const ty = this.sy(LBOT + CAP_H);
    const cx = this.sx0;
    this.room = layer(w, h, dpr, (x) => {
      let g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1d1814'); g.addColorStop(0.7, '#130f0c'); g.addColorStop(1, '#0a0806');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      // the lamp at the top right warms the wall
      const lx = Math.min(w * 0.9, cx + 420);
      g = x.createRadialGradient(lx, 96 * k, 0, lx, 96 * k, 600);
      g.addColorStop(0, 'rgba(255,192,124,0.26)'); g.addColorStop(0.4, 'rgba(255,190,120,0.07)'); g.addColorStop(1, 'rgba(255,190,120,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      // the faintest grain on the wall
      x.globalAlpha = 0.035;
      const dots = Math.min(9000, Math.round((w * ty) / 120));
      for (let i = 0; i < dots; i++) { x.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; x.fillRect(Math.random() * w, Math.random() * ty, 1, 1); }
      x.globalAlpha = 1;
      // the table
      g = x.createLinearGradient(0, ty, 0, h);
      g.addColorStop(0, '#523b29'); g.addColorStop(0.04, '#36261b'); g.addColorStop(1, '#0d0806');
      x.fillStyle = g; x.fillRect(0, ty, w, h - ty);
      x.globalAlpha = 0.07;
      for (let i = 0; i < 22; i++) {
        x.strokeStyle = Math.random() < 0.5 ? '#000' : '#ffd7a8';
        x.lineWidth = rand(0.5, 1.4);
        const yy = ty + 6 + Math.pow(Math.random(), 1.6) * (h - ty);
        x.beginPath(); x.moveTo(0, yy); x.bezierCurveTo(w * 0.3, yy + rand(-3, 3), w * 0.7, yy + rand(-3, 3), w, yy + rand(-2, 2)); x.stroke();
      }
      x.globalAlpha = 1;
      x.fillStyle = 'rgba(255,220,180,0.22)'; x.fillRect(0, ty, w, 1);
      // its shadow, long to the left, away from the lamp
      x.save();
      x.translate(cx - 34 * k, ty + 6 * k); x.scale(k, 0.11 * k);
      g = x.createRadialGradient(0, 0, 0, 0, 0, 210);
      g.addColorStop(0, 'rgba(0,0,0,0.65)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(-220, -220, 440, 440);
      x.restore();
    });
  }

  private outline(x: CanvasRenderingContext2D, inset = 0) {
    const N = 180;
    x.beginPath();
    for (let i = 0; i <= N; i++) {
      const y = LTOP + (GLASS_H * i) / N;
      x.lineTo(LCX + half(Math.abs(y - LNECK) / BH) - inset, y);
    }
    for (let i = N; i >= 0; i--) {
      const y = LTOP + (GLASS_H * i) / N;
      x.lineTo(LCX - half(Math.abs(y - LNECK) / BH) + inset, y);
    }
    x.closePath();
  }

  private side(x: CanvasRenderingContext2D, dir: number, k: number, s0: number, s1: number) {
    x.beginPath();
    for (let i = 0; i <= 40; i++) {
      const s = s0 + ((s1 - s0) * i) / 40;
      x.lineTo(LCX + half(s) * k, LNECK + dir * s * BH);
    }
  }

  /** Behind the sand: the inside of the glass is a little hazy, the back pillars show through. */
  private paintBack(x: CanvasRenderingContext2D) {
    x.save();
    this.outline(x);
    x.clip();
    let g = x.createLinearGradient(LCX - MAX_HALF, 0, LCX + MAX_HALF, 0);
    g.addColorStop(0, 'rgba(255,236,214,0.02)'); g.addColorStop(0.7, 'rgba(255,236,214,0.045)'); g.addColorStop(1, 'rgba(255,220,180,0.08)');
    x.fillStyle = g; x.fillRect(0, LTOP, LW, GLASS_H);
    for (const px of [LCX - PILLAR, LCX + PILLAR]) {
      g = x.createLinearGradient(px - 5, 0, px + 5, 0);
      g.addColorStop(0, 'rgba(36,24,15,0)'); g.addColorStop(0.5, 'rgba(90,64,42,0.4)'); g.addColorStop(1, 'rgba(36,24,15,0)');
      x.fillStyle = g; x.fillRect(px - 5, LTOP, 10, GLASS_H);
    }
    x.restore();
  }

  /** The front of the glass: its edge, thickness and the lamp's reflections. */
  private paintFront(x: CanvasRenderingContext2D) {
    this.outline(x);
    const g = x.createLinearGradient(LCX - MAX_HALF, 0, LCX + MAX_HALF, 0);
    g.addColorStop(0, 'rgba(255,236,214,0.16)'); g.addColorStop(0.5, 'rgba(255,236,214,0.1)'); g.addColorStop(1, 'rgba(255,226,190,0.42)');
    x.lineWidth = 1.3; x.strokeStyle = g; x.stroke();
    this.outline(x, 2.2);
    x.lineWidth = 0.8; x.strokeStyle = 'rgba(255,240,222,0.08)'; x.stroke();
    x.lineCap = 'round';
    for (const dir of [-1, 1]) {
      // right: a long wide reflection and a thin highlight
      this.side(x, dir, 0.72, 0.3, 0.8); x.lineWidth = 9; x.strokeStyle = 'rgba(255,240,220,0.06)'; x.stroke();
      this.side(x, dir, 0.79, 0.36, 0.76); x.lineWidth = 1.8; x.strokeStyle = 'rgba(255,244,228,0.34)'; x.stroke();
      this.side(x, dir, 0.9, 0.5, 0.7); x.lineWidth = 3.4; x.strokeStyle = 'rgba(255,226,190,0.12)'; x.stroke();
      // left, the dark side: one faint line
      this.side(x, dir, -0.84, 0.4, 0.68); x.lineWidth = 1.4; x.strokeStyle = 'rgba(255,240,222,0.09)'; x.stroke();
    }
    // the neck: thick glass gathers light
    let r = x.createRadialGradient(LCX + 1.5, LNECK, 0, LCX + 1.5, LNECK, 14);
    r.addColorStop(0, 'rgba(255,236,210,0.22)'); r.addColorStop(1, 'rgba(255,236,210,0)');
    x.fillStyle = r; x.fillRect(LCX - 16, LNECK - 16, 32, 32);
    x.fillStyle = 'rgba(255,240,220,0.5)'; x.fillRect(LCX + NECK_HALF - 0.6, LNECK - 6, 0.8, 12);
    // a glint on each rounded shoulder, top right
    for (const yy of [LTOP + 26, LBOT - 30]) {
      r = x.createRadialGradient(LCX + MAX_HALF * 0.62, yy, 0, LCX + MAX_HALF * 0.62, yy, 22);
      r.addColorStop(0, 'rgba(255,240,220,0.16)'); r.addColorStop(1, 'rgba(255,240,220,0)');
      x.fillStyle = r; x.fillRect(LCX + MAX_HALF * 0.62 - 24, yy - 24, 48, 48);
    }
  }

  /** Wooden caps, brass rings and the pillars. */
  private paintFrame(x: CanvasRenderingContext2D) {
    const cw = CAP_W;
    const ch = CAP_H;
    const cap = (y: number) => {
      let g = x.createLinearGradient(0, y, 0, y + ch);
      g.addColorStop(0, '#6e4f36'); g.addColorStop(0.3, '#4c3625'); g.addColorStop(1, '#22160d');
      x.fillStyle = g;
      roundRect(x, LCX - cw, y, cw * 2, ch, 7); x.fill();
      g = x.createLinearGradient(LCX - cw, 0, LCX + cw, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(255,200,150,0.12)');
      x.fillStyle = g; roundRect(x, LCX - cw, y, cw * 2, ch, 7); x.fill();
      x.save();
      roundRect(x, LCX - cw, y, cw * 2, ch, 7); x.clip();
      x.globalAlpha = 0.12;
      for (let i = 0; i < 9; i++) {
        x.strokeStyle = i % 2 ? '#1a0f08' : '#a8805a';
        x.lineWidth = rand(0.4, 1);
        const yy = y + rand(3, ch - 3);
        x.beginPath(); x.moveTo(LCX - cw, yy); x.bezierCurveTo(LCX - 40, yy + rand(-2, 2), LCX + 40, yy + rand(-2, 2), LCX + cw, yy + rand(-1, 1)); x.stroke();
      }
      x.restore();
      x.fillStyle = 'rgba(255,226,190,0.26)'; x.fillRect(LCX - cw + 7, y, cw * 2 - 14, 1);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(LCX - cw + 4, y + ch * 0.58, cw * 2 - 8, 1);
    };
    cap(LTOP - ch);
    cap(LBOT);
    for (const y of [LTOP, LBOT - 5]) {
      const hw = half(1) + 4;
      const g = x.createLinearGradient(LCX - hw, 0, LCX + hw, 0);
      g.addColorStop(0, '#5a4224'); g.addColorStop(0.55, '#b8965e'); g.addColorStop(0.8, '#f0d49a'); g.addColorStop(1, '#6e5230');
      x.fillStyle = g;
      x.fillRect(LCX - hw, y, hw * 2, 5);
      x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(LCX - hw, y === LTOP ? y + 4 : y, hw * 2, 1);
    }
    for (const px of [LCX - PILLAR, LCX + PILLAR]) {
      const g = x.createLinearGradient(px - 5, 0, px + 5, 0);
      const lit = px > LCX;
      g.addColorStop(0, '#21150d'); g.addColorStop(lit ? 0.62 : 0.45, lit ? '#a37a54' : '#6e5038'); g.addColorStop(1, '#2a1c12');
      x.fillStyle = g;
      x.fillRect(px - 4.5, LTOP, 9, GLASS_H);
      for (const yy of [LTOP + 28, LNECK, LBOT - 28]) {
        x.fillStyle = g;
        roundRect(x, px - 7, yy - 6, 14, 12, 6); x.fill();
        x.fillStyle = 'rgba(255,226,190,0.22)'; x.fillRect(px - 5, yy - 6, 10, 1);
      }
    }
  }

  /* ---------- step ---------- */

  step(dt: number) {
    this.t += dt;
    if (this.fade > 0) this.fade = Math.max(0, this.fade - dt / FADE_SECONDS);
    if (!this.dragging) this.tiltTo *= Math.max(0, 1 - dt * 2.2);
    this.tilt += (this.tiltTo - this.tilt) * Math.min(1, dt * 4);
    const { up, lo, fly: f } = this;
    let flowed = 0;

    if (this.state === 'run') {
      const nh = this.hb - this.ha + 1;
      this.acc += this.rate * dt;
      const k = Math.floor(this.acc / nh);
      if (k > 0) {
        this.acc -= k * nh;
        const mid = this.x0 + (this.ha + this.hb + 1) / 2;
        up.drain(this.ha, this.hb, k, (c, g) => {
          // leaving the neck: drawn to the middle, spreading ever so slightly
          const x = mid + (this.x0 + c + 0.5 - mid) * 0.5 + rand(-0.4, 0.4);
          f.add(x, LNECK + rand(-1, 3), bell() * 7, rand(25, 60), g);
          flowed++;
        });
      }
      let fed = false;
      for (let c = this.ha; c <= this.hb; c++) if (up.hts[c] > up.flo[c]) fed = true;
      // top: once the neck runs dry, the sand around slides in one cell at a time and sinks into a funnel
      for (let i = 0; i < 8; i++) up.slide(1);
      if (!fed) {
        this.starve += dt;
        up.relax(0, 2);
      } else this.starve = 0;
      if (up.count > 0 && this.starve > 1.2) {
        // the last few grains left on the glass just run out
        up.drain(0, this.cols - 1, 1, (_c, g) => {
          f.add(LCX + bell(), LNECK, bell() * 6, rand(20, 50), g);
          flowed++;
        });
      }
      if (up.count <= 0 && f.n === 0) {
        up.clear();
        this.state = 'rest';
        const timed = this.mode !== 'loop' && this.variant === 'full';
        this.wait = timed ? REST_TIMER : REST_LOOP;
        if (timed) {
          this.stat('done', this.autoflip ? 1 : 0);
          this.emit('done', { mode: this.mode });
        }
      }
    } else if (this.state === 'rest') {
      this.wait -= dt;
      if (this.wait <= 0 && (this.mode === 'loop' || this.variant === 'card' || this.autoflip)) this.flip();
    } else {
      this.ft += dt;
      const calm = this.motion < 1;
      const p = clamp(this.ft / (calm ? FLIP_SECONDS_CALM : FLIP_SECONDS), 0, 1);
      if (!this.swapped && p >= 0.5) this.swap();
      if (calm) {
        this.dim = Math.sin(Math.PI * p);
      } else {
        const e = easeIO(p);
        this.angle = this.swapped ? Math.PI * e - Math.PI : Math.PI * e;
        this.lift = Math.sin(Math.PI * p);
      }
      if (p >= 1) {
        this.angle = 0;
        this.lift = 0;
        this.dim = 0;
        this.state = 'run';
        this.flips++;
      }
    }

    // falling grains; leaning the glass pulls them sideways
    const gx = GRAVITY * Math.sin(this.tilt);
    const gy = GRAVITY * Math.cos(this.tilt);
    const last = this.cols - 1;
    for (let i = 0; i < f.n; i++) {
      f.vx[i] += gx * dt;
      f.vy[i] += gy * dt;
      f.vx[i] *= 1 - dt * 0.6;
      f.x[i] += f.vx[i] * dt;
      f.y[i] += f.vy[i] * dt;
      let c = Math.floor(f.x[i] - this.x0);
      if (c < 0 || c > last || lo.cei[c] === 0) {
        f.x[i] = clamp(f.x[i], this.x0 + 1, this.x0 + last);
        c = clamp(c, 0, last);
        f.vx[i] *= -0.4;
      }
      const surf = LBOT - lo.hts[c];
      if (f.y[i] >= surf) {
        if (f.k[i] === 0 && f.vy[i] > 160 && Math.random() < BOUNCE) {
          // hits the top of the cone and bounces
          f.k[i] = 1;
          f.y[i] = surf - 1;
          f.vx[i] = (Math.random() < 0.5 ? -1 : 1) * rand(25, 85);
          f.vy[i] = -rand(25, 95);
          continue;
        }
        const dir = f.vx[i] > 12 ? 1 : f.vx[i] < -12 ? -1 : 0;
        lo.land(c, f.g[i], dir, f.k[i] ? STICK_BOUNCED : STICK);
        f.kill(i);
        i--;
      }
    }
    // bottom: sand stays where it fell until the slope is too steep, then slides down a cell at a time
    const slid = lo.slide(1) + lo.slide(1);

    // for the sound: the stream, and avalanches
    this.flowed += flowed;
    this.slid += slid;
    this.slidT += dt;
    if (this.slidT >= AVALANCHE_WINDOW) {
      this.gps += (this.flowed / this.slidT - this.gps) * 0.5;
      const extra = this.slid - this.creep;
      if (this.state === 'run' && this.slid > this.creep * AVALANCHE_RISE && extra >= AVALANCHE_MIN
        && this.t - this.lastAvalanche > AVALANCHE_GAP && this.variant === 'full') {
        this.lastAvalanche = this.t;
        this.emit('avalanche', { size: Math.round(extra) });
      }
      this.creep += (this.slid - this.creep) * 0.08;
      this.flowed = 0;
      this.slid = 0;
      this.slidT = 0;
    }

    if (this.variant === 'full') {
      if (this.mode === 'loop') {
        if (this.flips !== this.lastFlips) this.stat('flips', (this.lastFlips = this.flips));
      } else {
        const left = this.state === 'flip' ? Math.round(this.seconds) : Math.max(0, Math.round((up.count + f.n) / this.rate));
        if (left !== this.lastLeft) this.stat('left', (this.lastLeft = left));
      }
    }
  }

  /** Re-announce the status line (after the mode changed). */
  private restat() {
    this.lastLeft = -1;
    this.lastFlips = -1;
  }

  /** Falling grains are stamped over the lower bulb's picture; the faster, the longer the tail. */
  private stamp() {
    const { lo, fly: f } = this;
    const v = lo.view;
    const { cols, rows } = lo;
    const y0 = LBOT - rows;
    const lut = this.lut;
    // dark sand (흑사): a one-pixel rim on the lamp side so the stream does not disappear
    const rc = paletteOf(this.palette).rim;
    const rim = rc ? (((110 << 24) | (rc[2] << 16) | (rc[1] << 8) | rc[0]) >>> 0) : 0;
    const st = this.stamped;
    for (let i = 0; i < f.n; i++) {
      const c = Math.floor(f.x[i] - this.x0);
      if (c < 0 || c >= cols) continue;
      const r1 = Math.floor(f.y[i] - y0);
      const stop = rows - lo.hts[c];
      const len = clamp(Math.round(Math.abs(f.vy[i]) / 150), 1, 4);
      const col = lut[lutIndex(f.g[i])];
      const dim = ((col & 0xfefefe) >>> 1) | 0xff000000; // the tail is half as bright
      let hit = false;
      for (let j = 0; j < len; j++) {
        const r = r1 - j;
        if (r < 0 || r >= stop) continue;
        hit = true;
        v[r * cols + c] = j === 0 ? col : ((dim & 0xffffff) | ((v[r * cols + c] ? 255 : 150) << 24)) >>> 0;
        if (rim && c + 1 < cols && !v[r * cols + c + 1]) v[r * cols + c + 1] = j === 0 ? rim : ((rim & 0xffffff) | (55 << 24)) >>> 0;
      }
      if (hit) st.push(c);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { up, lo, cols, rows, k } = this;
    if (!this.room || !this.back || !this.front || !this.frame) return;
    ctx.drawImage(this.room, 0, 0, this.w, this.h);

    // last frame's falling grains come off the picture
    for (const c of this.stamped) {
      lo.dirty[c] = 1;
      if (c + 1 < cols) lo.dirty[c + 1] = 1;
    }
    this.stamped.length = 0;
    const glintT = this.motion < 1 ? null : this.t;
    up.paint(this.lut, this.oldLut, this.fade, glintT);
    up.put();
    lo.paint(this.lut, this.oldLut, this.fade, glintT);
    this.stamp();
    lo.put();

    ctx.save();
    if (this.dim) ctx.globalAlpha = 1 - 0.85 * this.dim;
    const s = k * (1 - 0.32 * this.lift);
    ctx.translate(this.sx0, this.sNeck - 40 * this.lift * k);
    ctx.rotate(this.angle + this.tilt);
    ctx.scale(s, s);
    ctx.translate(-LCX, -LNECK);
    ctx.drawImage(this.back, 0, 0, LW, LH);
    // whole grains when shown at full size; smoothed when the hourglass is drawn smaller
    ctx.imageSmoothingEnabled = s < 0.999;
    ctx.drawImage(up.off, this.x0, LNECK - rows, cols, rows);
    ctx.drawImage(lo.off, this.x0, LBOT - rows, cols, rows);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.front, 0, 0, LW, LH);
    ctx.drawImage(this.frame, 0, 0, LW, LH);
    ctx.restore();
  }
}
