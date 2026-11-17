import { Scene, type SceneVariant } from './base';
import { TAU, clamp, pick, rand, rng } from './util';

/*
 * 지하철멍: a late-night train crossing a bridge over the Han, fireworks over Yeouido outside the glass.
 * Three seats share the outside and differ only in the carriage around the glass:
 *   seat    맞은편 창: on the long bench, looking at the window across the aisle; handles sway in front of it
 *   door    문 앞: standing at the doors, looking out through their two panes; an LED board runs above them.
 *           Where the screen is wide enough, the benches and windows either side of the doors show too
 *   window  창가: turned round on the seat, right up against the glass, the lit carriage reflected in it
 * The bridge never ends (7 panels of steel truss, 5 open ones, again and again) and the far skyline is one
 * strip whose ends meet, so the ride loops without a seam. At 축제 a 30 s finale comes now and then.
 */

export type SubwaySeat = 'seat' | 'door' | 'window';

/** The shells mixed into a show, and the shaped ones that come now and then. */
type MixType = 'peony' | 'chrys' | 'willow' | 'ring' | 'palm' | 'glitter' | 'double' | 'crossette' | 'shift';
type Shape = 'heart' | 'star' | 'saturn';
type ShellType = MixType | Shape;
type C3 = readonly [number, number, number];

export interface ShowLevel {
  v: number;
  label: string;
  /** seconds to the next shell */
  gap: readonly [number, number];
  /** chance that two or three go up together */
  multi: number;
  types: Readonly<Record<MixType, number>>;
}

/** 드문드문 · 축제 · 피날레. */
export const SHOWS: readonly ShowLevel[] = [
  { v: 0.3, label: '드문드문', gap: [2.6, 4.6], multi: 0, types: { peony: 3, chrys: 2, willow: 3, ring: 1, palm: 1, glitter: 1, double: 2, crossette: 1, shift: 2 } },
  { v: 0.6, label: '축제', gap: [0.75, 1.7], multi: 0.28, types: { peony: 4, chrys: 3, willow: 2, ring: 2, palm: 2, glitter: 2, double: 3, crossette: 2, shift: 2 } },
  { v: 1, label: '피날레', gap: [0.16, 0.4], multi: 0.5, types: { peony: 4, chrys: 3, willow: 3, ring: 1, palm: 2, glitter: 3, double: 3, crossette: 3, shift: 2 } },
];
const FEST = SHOWS[1];
const FINALE = SHOWS[2];
export const showOf = (v: number) => SHOWS.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));

/** 축제's occasional finale: the first a minute in, then every 3–5 minutes, 30 s each, rising and settling over 4 s. */
const RUSH_FIRST = 60;
const RUSH_EVERY: readonly [number, number] = [180, 300];
const RUSH_LEN = 30;
const RUSH_RAMP = 4;

/** Seconds per steel panel passing the window: about one a second, slow enough not to flicker. */
const TRUSS_PANELS = 7;
const OPEN_PANELS = 5;
const PANELS = TRUSS_PANELS + OPEN_PANELS;

/* colours seen in real fireworks */
const COL = {
  gold: [255, 200, 112], silver: [236, 240, 255], red: [255, 86, 78], green: [104, 236, 146],
  blue: [104, 156, 255], violet: [190, 132, 255], orange: [255, 150, 70], pink: [255, 128, 186], cyan: [118, 226, 255],
} as const satisfies Record<string, C3>;
type Colour = keyof typeof COL;
const PALS: readonly (readonly Colour[])[] = [
  ['gold'], ['silver'], ['red', 'gold'], ['green'], ['blue', 'silver'], ['violet'], ['orange'], ['pink', 'violet'],
  ['cyan', 'blue'], ['red'], ['green', 'gold'], ['gold', 'silver'],
];
const FLASH_WHITE: C3 = [255, 246, 228];

function pickWeighted<K extends string>(weights: Readonly<Record<K, number>>, fallback: K): K {
  let sum = 0;
  for (const k in weights) sum += weights[k];
  let r = Math.random() * sum;
  for (const k in weights) {
    r -= weights[k];
    if (r <= 0) return k;
  }
  return fallback;
}
const pickType = (types: Readonly<Record<MixType, number>>) => pickWeighted(types, 'peony');

/** Shaped shells: about one in ten, a few more in a finale; hearts a little more often than the others. */
const SHAPED_CHANCE = 0.1;
const SHAPED_FINALE = 0.14;
const SHAPES: Readonly<Record<Shape, number>> = { heart: 2, star: 1.5, saturn: 1.5 };
const pickShape = () => pickWeighted(SHAPES, 'heart');
const isShaped = (t: ShellType): t is Shape => t in SHAPES;

/** Colours that suit each shell: hearts red and pink, stars gold and silver, two different colours where a shell has two parts. */
function palFor(t: ShellType): readonly Colour[] {
  if (t === 'heart') return pick<readonly Colour[]>([['red'], ['pink'], ['red', 'pink'], ['pink', 'red']]);
  if (t === 'star') return pick<readonly Colour[]>([['gold'], ['silver'], ['gold', 'silver']]);
  if (t === 'saturn') return [pick<Colour>(['violet', 'blue', 'cyan', 'green']), pick<Colour>(['gold', 'silver'])];
  const p = pick(PALS);
  if ((t === 'double' || t === 'shift') && p.length < 2) {
    const others = (Object.keys(COL) as Colour[]).filter((c) => c !== p[0]);
    return [p[0], pick(others)];
  }
  return p;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const rgba = (c: C3, a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

function mk(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/* ---------- sprites, made once per colour ---------- */
const SPARKS = new Map<string, HTMLCanvasElement>();
/** A spark: a bright round point with a soft edge. */
function spark(c: C3) {
  const key = c.join(',');
  let s = SPARKS.get(key);
  if (s) return s;
  s = mk(32, 32);
  const x = s.getContext('2d')!;
  const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, rgba(c, 1));
  g.addColorStop(0.5, rgba(c, 0.36));
  g.addColorStop(1, rgba(c, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 32, 32);
  SPARKS.set(key, s);
  return s;
}

const GLOWS = new Map<string, HTMLCanvasElement>();
/** The wide soft light round a burst. Smoke lit by a burst asks for mixed colours, so the cache is emptied now and then. */
function halo(c: C3) {
  const key = c.map((v) => v | 0).join(',');
  let s = GLOWS.get(key);
  if (s) return s;
  s = mk(48, 48);
  const x = s.getContext('2d')!;
  const g = x.createRadialGradient(24, 24, 0, 24, 24, 24);
  g.addColorStop(0, rgba(c, 0.55));
  g.addColorStop(0.5, rgba(c, 0.18));
  g.addColorStop(1, rgba(c, 0));
  x.fillStyle = g;
  x.fillRect(0, 0, 48, 48);
  if (GLOWS.size > 400) GLOWS.clear();
  GLOWS.set(key, s);
  return s;
}

let SMOKE: HTMLCanvasElement | null = null;
function smokePuff() {
  if (SMOKE) return SMOKE;
  SMOKE = mk(64, 64);
  const x = SMOKE.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(150,150,170,0.9)');
  g.addColorStop(0.55, 'rgba(120,120,140,0.45)');
  g.addColorStop(1, 'rgba(110,110,130,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  return SMOKE;
}

let DOTS: HTMLCanvasElement | null = null;
/** The dot grid laid over the LED board's letters. */
function ledDots() {
  if (DOTS) return DOTS;
  DOTS = mk(3, 3);
  const x = DOTS.getContext('2d')!;
  x.fillStyle = 'rgba(0,0,0,0.35)';
  x.fillRect(0, 0, 1, 3);
  x.fillRect(1, 0, 2, 1);
  return DOTS;
}

/* ---------- drawing helpers ---------- */
const rr = (x: CanvasRenderingContext2D, X: number, Y: number, W: number, H: number, R: number) => {
  R = Math.max(0, Math.min(R, W / 2, H / 2));
  x.moveTo(X + R, Y);
  x.arcTo(X + W, Y, X + W, Y + H, R);
  x.arcTo(X + W, Y + H, X, Y + H, R);
  x.arcTo(X, Y + H, X, Y, R);
  x.arcTo(X, Y, X + W, Y, R);
  x.closePath();
};
const vgrad = (x: CanvasRenderingContext2D, y0: number, y1: number, stops: [number, string][]) => {
  const g = x.createLinearGradient(0, y0, 0, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
};
const hgrad = (x: CanvasRenderingContext2D, x0: number, x1: number, stops: [number, string][]) => {
  const g = x.createLinearGradient(x0, 0, x1, 0);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
};

/* ---------- where the glass is ---------- */
interface Rect { x: number; y: number; w: number; h: number }
interface Pane extends Rect {
  r: number;
  /** 문 앞: a window over the bench beside the doors, not a door pane */
  side?: boolean;
}

interface Layout {
  /** the holes in the carriage that the outside shows through */
  panes: Pane[];
  /** the part of the outside that can be seen */
  V: Rect;
  /** the horizon, as a fraction of V's height */
  hz: number;
  /** y of the handle rail, 0 for none */
  bar: number;
  handles: { x: number; len: number }[];
  /** vertical scale against a 844 px tall phone */
  k: number;
  /** 문 앞: the door frame and the LED board above it */
  door?: { x0: number; x1: number; y0: number; y1: number };
  /** 문 앞 on wide screens: the benches either side, ending in a pole at bayL and bayR; their foot meets the floor at fl */
  bench?: { fl: number; bayL: number; bayR: number; seatW: number };
  led?: Rect;
  /** 창가: the top of the sill under the glass */
  sill?: number;
}

/** Edges of the page's controls: `top` the bottom of the tabs and scene switch, `bottom` the top of the status line. */
interface Edges { top: number | null; bottom: number | null }

function layoutOf(seat: SubwaySeat, card: boolean, w: number, h: number, e: Edges): Layout {
  if (card) {
    // a home card: all glass, a rail of handles hanging in from the top
    const wide = w > h * 1.8;
    const k = h / 156;
    const xs = wide ? [0.62, 0.74, 0.86] : [0.7, 0.88];
    return {
      panes: [{ x: 0, y: 0, w, h, r: 0 }], V: { x: 0, y: 0, w, h }, hz: wide ? 0.62 : 0.66, bar: 0, k,
      handles: xs.map((f) => ({ x: w * f, len: 18 * k })),
    };
  }
  const k = clamp(h / 844, 0.55, 1.2);
  // nothing above (the landscape rail hides the tabs): the carriage starts at the top; nothing below: at the bottom
  const top = e.top ?? 0;
  const bottom = e.bottom ?? h;

  if (seat === 'door') {
    const ledTop = top + 12 * k;
    const ledH = 34;
    const y0 = ledTop + ledH + 14 * k;
    const y1 = h - 26 * k;
    const dw = Math.min(w - 68, Math.max(322, (y1 - y0) * 0.62));
    const x0 = (w - dw) / 2;
    const x1 = x0 + dw;
    const mid = w / 2;
    const outer = dw * 0.068;
    const inner = dw * 0.059;
    const gy = y0 + 44 * k;
    const gb = Math.min(bottom - 40 * k, gy + (y1 - y0) * 0.62);
    const gh = Math.max(80, gb - gy);
    const gw = mid - inner - (x0 + outer);
    const panes: Pane[] = [
      { x: x0 + outer, y: gy, w: gw, h: gh, r: 18 },
      { x: mid + inner, y: gy, w: gw, h: gh, r: 18 },
    ];
    const L: Layout = {
      panes, V: { x: panes[0].x, y: gy, w: panes[1].x + gw - panes[0].x, h: gh }, hz: 0.5, bar: 0, handles: [], k,
      door: { x0, x1, y0, y1 }, led: { x: mid - (dw - 80) / 2, y: ledTop, w: dw - 80, h: ledH },
    };
    // wide screens: a bench either side of the doors with a window over it, as across the aisle in 맞은편 창.
    // The bench ends in a pole on the seat grid, about a seat clear of the door; the windows' tops line up with the
    // door panes', and the bench's foot meets the floor where the doors do.
    const seatW = Math.round(dw * 0.347);
    const reach = seatW * Math.ceil((mid - x0 + 50 * k) / seatW);
    const bayL = mid - reach;
    const bayR = mid + reach;
    const m = clamp(w * 0.0375, 24, 64);
    const ww = bayL - 24 * k - m;
    if (ww < 120 * k) return L;
    const wb = Math.round(gy + (y1 - gy) * 0.51);
    panes.unshift({ x: m, y: gy, w: ww, h: wb - gy, r: 26, side: true });
    panes.push({ x: w - m - ww, y: gy, w: ww, h: wb - gy, r: 26, side: true });
    L.V = { x: m, y: gy, w: w - 2 * m, h: gh };
    L.bar = gy - 26 * k;
    L.bench = { fl: y1, bayL, bayR, seatW };
    // handles over the benches only, the space before the doors kept clear
    const step = seatW * 0.92;
    const n = Math.max(1, Math.floor((ww - 40 * k) / step) + 1);
    const cx = m + ww / 2;
    for (let i = 0; i < n; i++) {
      const o = (i - (n - 1) / 2) * step;
      L.handles.push({ x: cx + o, len: rand(58, 66) * k }, { x: w - cx - o, len: rand(58, 66) * k });
    }
    return L;
  }

  if (seat === 'window') {
    const sill = Math.min(bottom - 28 * k, h - 194 * k);
    const pane = { x: 12, y: -60, w: w - 24, h: sill + 60, r: 34 };
    return { panes: [pane], V: { x: 12, y: 0, w: w - 24, h: sill }, hz: 0.6, bar: 0, handles: [], k, sill };
  }

  // 맞은편 창: one window on a phone, two or three side by side on wide screens
  const bar = top + 6;
  const y = bar + 26 * k;
  const ph = Math.max(120 * k, bottom - 170 * k - y);
  const margin = w < 600 ? 26 : clamp(w * 0.08, 40, 104);
  const gap = 72;
  const n = Math.max(1, Math.round((w - 2 * margin + gap) / (500 + gap)));
  const pw = (w - 2 * margin - (n - 1) * gap) / n;
  const panes = Array.from({ length: n }, (_, i) => ({ x: margin + i * (pw + gap), y, w: pw, h: ph, r: 28 }));
  const spacing = w < 600 ? 72 : 118;
  const count = Math.floor((w - 40) / spacing) + 1;
  const first = (w - (count - 1) * spacing) / 2;
  return {
    panes, V: { x: margin, y, w: w - 2 * margin, h: ph }, hz: 0.62, bar, k,
    handles: Array.from({ length: count }, (_, i) => ({ x: first + i * spacing, len: rand(58, 66) * k })),
  };
}

/* ---------- the carriage around the glass ---------- */

/** 맞은편 창: ceiling, luggage rack, the wall round the windows, the bench across the aisle, the floor. */
function paintBench(x: CanvasRenderingContext2D, w: number, h: number, L: Layout) {
  const { panes, k } = L;
  const top = panes[0].y;
  const bot = panes[0].y + panes[0].h;
  x.fillStyle = vgrad(x, 0, Math.max(1, top), [[0, '#1d2028'], [0.5, '#262a33'], [1, '#2c3039']]);
  x.fillRect(0, 0, w, top);
  // the strip light along the ceiling
  const ly = Math.max(18, top - 150 * k);
  x.fillStyle = vgrad(x, ly - 18, ly + 26, [[0, 'rgba(240,244,250,0)'], [0.4, 'rgba(240,244,250,0.16)'], [0.5, 'rgba(250,252,255,0.85)'], [0.6, 'rgba(240,244,250,0.16)'], [1, 'rgba(240,244,250,0)']]);
  x.fillRect(0, ly - 18, w, 44);
  // the luggage rack
  const sy = top - 52 * k;
  x.fillStyle = '#353a44';
  x.fillRect(0, sy, w, 6);
  x.fillStyle = 'rgba(150,158,172,0.5)';
  x.fillRect(0, sy, w, 1.5);
  x.strokeStyle = 'rgba(160,168,182,0.22)';
  x.lineWidth = 1;
  x.beginPath();
  for (let i = 0; i < w; i += 9) {
    x.moveTo(i, sy + 6);
    x.lineTo(i + 4, sy + 22 * k);
  }
  x.stroke();
  x.fillStyle = '#3c414c';
  x.fillRect(0, sy + 22 * k, w, 4);
  // the wall round the windows, and their rubber frames
  const wallTop = sy + 22 * k + 4;
  // 문 앞's benches stretch so their foot meets the floor under the doors
  const g = L.bench ? (L.bench.fl - bot) / 240 : k;
  x.fillStyle = vgrad(x, wallTop, bot + 50 * g, [[0, '#2b2f38'], [1, '#23262e']]);
  x.fillRect(0, wallTop, w, bot + 50 * g - wallTop);
  for (const r of panes) {
    x.beginPath();
    rr(x, r.x - 7, r.y - 7, r.w + 14, r.h + 14, r.r + 7);
    x.fillStyle = '#16181d';
    x.fill();
    x.strokeStyle = 'rgba(170,178,192,0.18)';
    x.lineWidth = 1.5;
    x.stroke();
  }
  x.fillStyle = 'rgba(190,198,212,0.28)';
  x.fillRect(0, bot + 20 * g, w, 2);
  // the bench: backrest, seat, front, heater grille
  const sb = bot + 50 * g;
  const sf = sb + 92 * g;
  const ss = sf + 30 * g;
  const sd = ss + 34 * g;
  const fl = L.bench ? L.bench.fl : sd + 34 * g;
  x.fillStyle = vgrad(x, sb, sf, [[0, '#2a3160'], [0.65, '#232a55'], [1, '#1c2247']]);
  x.beginPath();
  rr(x, -20, sb, w + 40, sf - sb + 10, 18 * k);
  x.fill();
  const seatW = L.bench ? L.bench.seatW : Math.round(Math.min(panes[0].w, 340) / 2.7);
  x.lineWidth = 2;
  x.strokeStyle = 'rgba(8,10,26,0.55)';
  x.beginPath();
  for (let i = (w / 2) % seatW; i < w; i += seatW) {
    x.moveTo(i, sb + 10 * k);
    x.lineTo(i, sf + 2);
  }
  x.stroke();
  x.lineWidth = 1;
  x.strokeStyle = 'rgba(120,132,200,0.14)';
  x.beginPath();
  for (let i = (w / 2) % seatW + 2; i < w; i += seatW) {
    x.moveTo(i, sb + 10 * k);
    x.lineTo(i, sf + 2);
  }
  x.stroke();
  x.fillStyle = vgrad(x, sf, ss, [[0, '#343c74'], [1, '#2a3166']]);
  x.fillRect(0, sf, w, ss - sf);
  x.fillStyle = vgrad(x, ss, sd, [[0, '#1d2350'], [1, '#141838']]);
  x.fillRect(0, ss, w, sd - ss);
  x.fillStyle = 'rgba(160,172,240,0.2)';
  x.fillRect(0, ss, w, 1.5);
  x.fillStyle = '#16181e';
  x.fillRect(0, sd, w, fl - sd);
  x.strokeStyle = 'rgba(140,146,160,0.16)';
  x.beginPath();
  for (let i = 4; i < w; i += 6) {
    x.moveTo(i, sd + 8 * k);
    x.lineTo(i, fl - 8 * k);
  }
  x.stroke();
  x.fillStyle = vgrad(x, fl, Math.max(fl + 1, h), [[0, '#2a2c31'], [1, '#383a40']]);
  x.fillRect(0, fl, w, h - fl);
  x.fillStyle = 'rgba(0,0,0,0.45)';
  x.fillRect(0, fl, w, 3);
  // the handle rail (no poles: the rail is enough)
  if (L.bar) {
    x.fillStyle = vgrad(x, L.bar - 4, L.bar + 4, [[0, '#9aa1ad'], [0.4, '#e4e8ee'], [1, '#5c626d']]);
    x.fillRect(0, L.bar - 4, w, 8);
  }
}

/** 문 앞: the wall, the two door leaves with their panes, the yellow strip at the threshold. */
function paintDoor(x: CanvasRenderingContext2D, w: number, h: number, L: Layout) {
  const d = L.door!;
  const k = L.k;
  x.fillStyle = vgrad(x, 0, h, [[0, '#22252d'], [1, '#2a2d35']]);
  x.fillRect(0, 0, w, h);
  const ly = 22;
  x.fillStyle = vgrad(x, ly - 16, ly + 24, [[0, 'rgba(240,244,250,0)'], [0.5, 'rgba(250,252,255,0.8)'], [1, 'rgba(240,244,250,0)']]);
  x.fillRect(0, ly - 16, w, 40);
  // wide screens: the benches and windows either side; not quite wide enough: the wall, in panels
  if (L.bench) paintDoorSides(x, w, h, L);
  else if (d.x0 > 60) {
    x.fillStyle = 'rgba(255,255,255,0.035)';
    for (let px = d.x0 - 150; px > 0; px -= 180) x.fillRect(px, 0, 1, h);
    for (let px = d.x1 + 150; px < w; px += 180) x.fillRect(px, 0, 1, h);
  }
  const { x0, x1, y0, y1 } = d;
  x.fillStyle = '#15171c';
  x.fillRect(x0 - 10, y0 - 10, x1 - x0 + 20, y1 - y0 + 10);
  const mid = w / 2;
  for (const [a, b] of [[x0, mid - 2], [mid + 2, x1]]) {
    x.fillStyle = hgrad(x, a, b, [[0, '#3c424b'], [0.5, '#4b525c'], [1, '#3a4049']]);
    x.fillRect(a, y0, b - a, y1 - y0);
    x.fillStyle = 'rgba(255,255,255,0.06)';
    x.fillRect(a, y0, b - a, 2);
  }
  x.fillStyle = '#0d0e11';
  x.fillRect(mid - 3, y0, 6, y1 - y0);
  for (const r of L.panes) {
    if (r.side) continue;
    x.beginPath();
    rr(x, r.x - 6, r.y - 6, r.w + 12, r.h + 12, r.r + 6);
    x.fillStyle = '#121418';
    x.fill();
  }
  x.fillStyle = '#c9a227';
  x.fillRect(x0 - 10, y1, x1 - x0 + 20, 8 * k);
  x.fillStyle = 'rgba(0,0,0,0.25)';
  for (let i = x0 - 6; i < x1 + 10; i += 7) x.fillRect(i, y1 + 2 * k, 3, 4 * k);
  x.fillStyle = vgrad(x, y1 + 8 * k, Math.max(y1 + 9 * k, h), [[0, '#2a2c31'], [1, '#34363c']]);
  x.fillRect(0, y1 + 8 * k, w, h - y1 - 8 * k);
}

/**
 * 문 앞 on wide screens, either side of the doors: the wall, windows and bench of 맞은편 창. The ceiling runs on
 * over the doors; below the luggage rack only the benches are painted. Then the handle rail over the benches,
 * the glass screen at each bench's end, seen edge on, and the pole beside it.
 */
function paintDoorSides(x: CanvasRenderingContext2D, w: number, h: number, L: Layout) {
  const B = L.bench!;
  const k = L.k;
  const side = L.panes.filter((r) => r.side);
  const top = side[0].y;
  const bot = top + side[0].h;
  const rack = top - 52 * k;
  x.save();
  x.beginPath();
  x.rect(0, 0, w, rack);
  x.rect(0, rack, B.bayL, h - rack);
  x.rect(B.bayR, rack, w - B.bayR, h - rack);
  x.clip();
  paintBench(x, w, h, { ...L, panes: side, bar: 0 });
  x.restore();
  x.fillStyle = vgrad(x, L.bar - 4, L.bar + 4, [[0, '#9aa1ad'], [0.4, '#e4e8ee'], [1, '#5c626d']]);
  x.fillRect(0, L.bar - 4, B.bayL, 8);
  x.fillRect(B.bayR, L.bar - 4, w - B.bayR, 8);
  for (const px of [B.bayL, B.bayR]) {
    const pw = 14 * k;
    x.beginPath();
    rr(x, px < w / 2 ? px - pw : px, bot - 40 * k, pw, B.fl - bot + 20 * k, 7 * k);
    x.fillStyle = 'rgba(150,170,190,0.16)';
    x.fill();
    x.strokeStyle = 'rgba(210,218,230,0.35)';
    x.lineWidth = 1.5;
    x.stroke();
  }
  for (const px of [B.bayL, B.bayR]) {
    const r = 5 * k;
    x.fillStyle = hgrad(x, px - r, px + r, [[0, '#5c626d'], [0.45, '#e8ecf2'], [1, '#6a707b']]);
    x.fillRect(px - r, L.bar - 4, r * 2, B.fl - L.bar + 4);
  }
}

/** 창가: the glass nearly fills the screen; below it the sill and the top of my own backrest. */
function paintWindow(x: CanvasRenderingContext2D, w: number, h: number, L: Layout) {
  const k = L.k;
  const bot = L.sill!;
  x.fillStyle = '#16181d';
  x.fillRect(0, 0, w, h);
  x.fillStyle = hgrad(x, 0, 12, [[0, '#2b2f38'], [1, '#1a1c22']]);
  x.fillRect(0, 0, 12, h);
  x.fillStyle = hgrad(x, w - 12, w, [[0, '#1a1c22'], [1, '#2b2f38']]);
  x.fillRect(w - 12, 0, 12, h);
  x.fillStyle = vgrad(x, bot, bot + 26 * k, [[0, '#9aa1ad'], [0.25, '#e2e6ec'], [1, '#5c626d']]);
  x.fillRect(0, bot, w, 22 * k);
  x.fillStyle = vgrad(x, bot + 22 * k, bot + 60 * k, [[0, '#2b2f38'], [1, '#22252c']]);
  x.fillRect(0, bot + 22 * k, w, 38 * k);
  x.fillStyle = vgrad(x, bot + 60 * k, Math.max(bot + 61 * k, h), [[0, '#343c74'], [0.4, '#2a3160'], [1, '#1c2247']]);
  x.beginPath();
  rr(x, -10, bot + 60 * k, w + 20, h, 22);
  x.fill();
  x.fillStyle = 'rgba(160,172,240,0.22)';
  x.fillRect(0, bot + 66 * k, w, 1.5);
}

/** The lit carriage reflected in the glass: lights, handles, the window frames across the aisle. */
function paintReflection(x: CanvasRenderingContext2D, w: number, L: Layout, seat: SubwaySeat) {
  const V = L.V;
  if (seat === 'window') {
    // what is behind me, in perspective: two strip lights running to a point, the windows across, the handles
    const vx = w * 0.62;
    const vy = V.y + V.h * 0.36;
    const sc = clamp(V.h / 650, 0.6, 1.6);
    x.strokeStyle = 'rgba(235,242,255,0.85)';
    x.lineCap = 'round';
    for (const [sx, sy, lw] of [[-40, -30, 16], [w + 60, -10, 14]]) {
      x.lineWidth = lw * sc;
      x.beginPath();
      x.moveTo(sx, sy);
      x.lineTo(lerp(sx, vx, 0.92), lerp(sy, vy, 0.92));
      x.stroke();
    }
    x.fillStyle = 'rgba(0,0,0,0.6)';
    for (let i = 0; i < 5; i++) {
      const f = i / 5;
      const f2 = (i + 0.8) / 5;
      const ax = lerp(-60, vx, f);
      const bx = lerp(-60, vx, f2);
      x.beginPath();
      x.moveTo(ax, lerp(V.y + V.h * 0.12, vy - 6, f));
      x.lineTo(bx, lerp(V.y + V.h * 0.12, vy - 6, f2));
      x.lineTo(bx, lerp(V.y + V.h * 0.52, vy + 6, f2));
      x.lineTo(ax, lerp(V.y + V.h * 0.52, vy + 6, f));
      x.closePath();
      x.fill();
    }
    x.strokeStyle = 'rgba(225,230,240,0.7)';
    for (let i = 0; i < 7; i++) {
      const f = Math.pow(i / 7, 0.8);
      const hx = lerp(w * 0.95, vx, f);
      const hy = lerp(V.y + V.h * 0.08, vy - 10, f);
      const s = lerp(1, 0.15, f) * sc;
      x.lineWidth = 4 * s;
      x.beginPath();
      x.moveTo(hx, hy);
      x.lineTo(hx, hy + 52 * s);
      x.stroke();
      x.beginPath();
      x.ellipse(hx, hy + 63 * s, 9 * s, 11 * s, 0, 0, TAU);
      x.stroke();
    }
    x.fillStyle = 'rgba(60,72,150,0.55)';
    x.beginPath();
    x.moveTo(-20, V.y + V.h * 0.6);
    x.lineTo(vx, vy + 14);
    x.lineTo(vx, vy + 26);
    x.lineTo(-20, V.y + V.h * 0.84);
    x.closePath();
    x.fill();
    // and me
    x.fillStyle = 'rgba(10,12,20,0.55)';
    const cx = w * 0.3;
    const cy = V.y + V.h * 0.66;
    x.beginPath();
    x.ellipse(cx, cy, 38 * sc, 46 * sc, 0, 0, TAU);
    x.fill();
    x.beginPath();
    x.moveTo(cx - 92 * sc, V.y + V.h + 10);
    x.quadraticCurveTo(cx - 80 * sc, cy + 58 * sc, cx, cy + 50 * sc);
    x.quadraticCurveTo(cx + 80 * sc, cy + 58 * sc, cx + 92 * sc, V.y + V.h + 10);
    x.closePath();
    x.fill();
    return;
  }
  for (const r of L.panes) {
    const y = r.y + r.h * 0.13;
    x.fillStyle = vgrad(x, y - 10, y + 10, [[0, 'rgba(235,242,255,0)'], [0.5, 'rgba(235,242,255,0.75)'], [1, 'rgba(235,242,255,0)']]);
    x.fillRect(r.x, y - 10, r.w, 20);
    x.fillStyle = 'rgba(255,255,255,0.18)';
    x.beginPath();
    x.moveTo(r.x + r.w * 0.62, r.y);
    x.lineTo(r.x + r.w * 0.78, r.y);
    x.lineTo(r.x + r.w * 0.36, r.y + r.h);
    x.lineTo(r.x + r.w * 0.2, r.y + r.h);
    x.closePath();
    x.fill();
  }
  if (seat === 'door') {
    // the seats and windows behind me, in the door panes
    for (const r of L.panes) {
      if (r.side) continue;
      x.fillStyle = 'rgba(60,72,150,0.45)';
      x.fillRect(r.x, r.y + r.h * 0.7, r.w, r.h * 0.16);
      x.fillStyle = 'rgba(0,0,0,0.5)';
      x.fillRect(r.x + 10, r.y + r.h * 0.3, r.w - 20, r.h * 0.34);
    }
  }
}

/* ---------- outside: the Yeouido side of the river ---------- */
interface Skyline {
  c: HTMLCanvasElement;
  /** height down to the horizon, and below it */
  HT: number;
  HB: number;
  /** tops of the tall buildings, for their red aircraft lights */
  tops: { x: number; y: number }[];
  /** y of the far bridge's deck */
  by: number;
}

interface Tower { x: number; w: number; h: number; kind: 'low' | 'tall' | 'twin' | 'gold'; seed: number }

/** The skyline is drawn once, as a strip whose two ends meet, and slides slowly by. */
function buildSkyline(S: number, PW: number, seed: number, dpr: number): Skyline {
  const R = rng(seed);
  const HT = Math.ceil(170 * S);
  const HB = Math.ceil(40 * S);
  const c = mk(PW * dpr, (HT + HB) * dpr);
  const x = c.getContext('2d')!;
  x.scale(dpr, dpr);
  const base = HT;
  const tops: { x: number; y: number }[] = [];
  const towers: Tower[] = [];
  // low flats and offices; one that runs past the right end is drawn again at the left, so the strip has no seam
  let px = 0;
  while (px < PW) {
    const bw = (10 + R() * 26) * S;
    const bh = (14 + Math.pow(R(), 1.6) * 46) * S;
    towers.push({ x: px, w: bw, h: bh, kind: 'low', seed: 0 });
    px += bw + R() * 3 * S;
  }
  // Yeouido: a gold glass tower, twin towers, a cluster of tall offices
  const yx = PW * 0.32;
  const tall = (dx: number, tw: number, th: number, kind: Tower['kind'] = 'tall') =>
    towers.push({ x: yx + dx * S, w: tw * S, h: th * S, kind, seed: 0 });
  tall(120, 22, 98);
  tall(146, 16, 76);
  tall(166, 14, 62);
  tall(230, 20, 132, 'twin');
  tall(256, 20, 118, 'twin');
  tall(300, 18, 70);
  tall(330, 26, 54);
  tall(30, 24, 116, 'gold');
  for (let i = 0; i < 6; i++) towers.push({ x: yx - 90 * S + R() * 520 * S, w: (14 + R() * 14) * S, h: (40 + R() * 40) * S, kind: 'tall', seed: 0 });
  // each building keeps its own lit windows, so a copy at the other end looks the same
  for (const t of towers) t.seed = (R() * 4294967296) >>> 0;
  towers.sort((a, b) => (b.kind === 'low' ? 1 : 0) - (a.kind === 'low' ? 1 : 0));
  for (const t of towers) {
    for (const X of t.x + t.w > PW ? [t.x, t.x - PW] : [t.x]) {
      const Y = base - t.h;
      const Q = rng(t.seed);
      if (t.kind === 'gold') {
        x.beginPath();
        x.moveTo(X, base);
        x.lineTo(X, Y + 10 * S);
        x.lineTo(X + t.w * 0.8, Y);
        x.lineTo(X + t.w, Y + 4 * S);
        x.lineTo(X + t.w, base);
        x.closePath();
        x.fillStyle = vgrad(x, Y, base, [[0, '#c99a4a'], [0.4, '#8a6230'], [1, '#3a2814']]);
        x.fill();
        x.fillStyle = 'rgba(255,214,140,0.35)';
        for (let yy = Y + 14 * S; yy < base - 2; yy += 3 * S) x.fillRect(X + 1, yy, t.w - 2, 0.6 * S);
        x.fillStyle = 'rgba(255,236,190,0.55)';
        x.fillRect(X + t.w * 0.66, Y + 8 * S, 1.2 * S, t.h - 10 * S);
        if (X === t.x) tops.push({ x: X + t.w * 0.8, y: Y - 1 });
        continue;
      }
      x.fillStyle = t.kind === 'low' ? '#0c1020' : '#0e1224';
      x.fillRect(X, Y, t.w, t.h);
      x.fillStyle = 'rgba(120,130,170,0.12)';
      x.fillRect(X, Y, t.w, 1);
      if (t.kind === 'twin') {
        x.fillStyle = 'rgba(232,96,60,0.7)';
        x.fillRect(X, Y, t.w, 3 * S);
        x.fillRect(X, Y, 1.6 * S, 16 * S);
        x.fillRect(X + t.w - 1.6 * S, Y, 1.6 * S, 16 * S);
      }
      const cw = 2.2 * S;
      const ch = 2.6 * S;
      const lit = t.kind === 'low' ? 0.42 : 0.3;
      for (let yy = Y + 4 * S; yy < base - 3 * S; yy += ch + 1.6 * S) {
        for (let xx = X + 2 * S; xx < X + t.w - 2 * S; xx += cw + 1.8 * S) {
          if (Q() > lit) continue;
          const warm = Q() < 0.72;
          x.fillStyle = warm
            ? `rgba(255,${(200 + Q() * 30) | 0},${(130 + Q() * 40) | 0},${0.45 + Q() * 0.45})`
            : `rgba(200,224,255,${0.35 + Q() * 0.4})`;
          x.fillRect(xx, yy, cw, ch * 0.7);
        }
      }
      if (X === t.x && t.h > 70 * S) tops.push({ x: X + t.w / 2, y: Y - 1 });
    }
  }
  // the far bridge just above the water; its lamps are spaced to fit the strip exactly, so the seam keeps the rhythm
  const even = (step: number) => PW / Math.max(1, Math.round(PW / step));
  const by = base - 5 * S;
  x.fillStyle = '#0a0d1a';
  x.fillRect(0, by, PW, 2.2 * S);
  for (let bx = 4, st = even(44 * S); bx < PW; bx += st) x.fillRect(bx, by, 3 * S, base - by + 2);
  for (let bx = 2, st = even(7 * S); bx < PW; bx += st) {
    x.fillStyle = `rgba(255,206,140,${0.55 + R() * 0.35})`;
    x.fillRect(bx, by - 1.4 * S, 1.3 * S, 1.3 * S);
  }
  x.fillStyle = '#080a14';
  x.fillRect(0, base - 1, PW, 2 * S);
  return { c, HT, HB, tops, by };
}

/** The skyline in the water: shrunk, flipped and blown up again, so it looks smeared. */
function buildReflection(sky: Skyline, PW: number, dpr: number) {
  const small = mk((PW * dpr) / 6, (sky.HT * dpr) / 6);
  small.getContext('2d')!.drawImage(sky.c, 0, 0, PW * dpr, sky.HT * dpr, 0, 0, small.width, small.height);
  const c = mk(PW * dpr, sky.HT * dpr);
  const x = c.getContext('2d')!;
  x.imageSmoothingEnabled = true;
  x.translate(0, c.height);
  x.scale(1, -1);
  x.drawImage(small, 0, 0, c.width, c.height);
  return c;
}

/* ---------- fireworks ---------- */
interface Shell { wx: number; y: number; y0: number; ty: number; t: number; dur: number; type: ShellType; pal: readonly Colour[]; near: boolean }
interface Spark {
  x: number; y: number; vx: number; vy: number; age: number; life: number; c: C3; drag: number; g: number;
  size: number; trail: number[] | null; tw: boolean; dim: number;
  /** crossette: splits in four at this age */
  split?: number;
  /** 색 바뀌는 국화: the colour it turns at shiftAt */
  c2?: C3;
  shiftAt?: number;
}
interface Burst { wx: number; y: number; c: C3; age: number; R: number; power: number }
interface Smoke { wx: number; y: number; r: number; age: number; life: number; a: number }
interface Handle { x: number; len: number; a: number; w: number; ph: number }
interface Ripple { z: number; x: number }

const LED_TEXT = '지금 한강을 건너고 있어요 · 창밖으로 여의도 불꽃축제가 보여요';
const LED_FONT = '700 14px ui-monospace, SFMono-Regular, Menlo, monospace';

export interface SubwayOpts {
  seat?: SubwaySeat;
  show?: number;
}

export class Subway extends Scene {
  readonly seat: SubwaySeat;
  show: ShowLevel;
  /** fireworks seen go up since the scene opened */
  shots = 0;

  private top: number | null = null;
  private bottom: number | null = null;
  private L!: Layout;
  private V: Rect = { x: 0, y: 0, w: 1, h: 1 };
  private S = 1;
  /** y of the horizon */
  private hy = 0;
  private area = 1;
  private sky: Skyline | null = null;
  private refl: HTMLCanvasElement | null = null;
  private PW = 1;
  private skyX = 0;
  private cars: { x: number; v: number }[] = [];
  /** the carriage with holes for the glass; the share of firework light each part of it catches; the glass's reflection */
  private inside: HTMLCanvasElement | null = null;
  private lit: HTMLCanvasElement | null = null;
  private tint: HTMLCanvasElement | null = null;
  private glassRefl: HTMLCanvasElement | null = null;
  private handles: Handle[] = [];
  private ripples: Ripple[] = [];
  private ledW = 0;
  private ledDots: CanvasPattern | null = null;

  private shells: Shell[] = [];
  private parts: Spark[] = [];
  private bursts: Burst[] = [];
  private smoke: Smoke[] = [];
  /** how far the fireworks' layer has slid by (they drift past a little faster than the skyline) */
  private fwX = 0;
  private next = rand(0.2, 0.8);
  private rushIn = RUSH_FIRST;
  private rushLeft = 0;
  private rushK = 0;
  private flash = 0;
  private flashC: C3 = [255, 220, 170];

  /** the bridge: distance travelled, the next rail joint, the last jolt */
  private near = 0;
  private nearV = 300;
  private panel = 290;
  private nextJoint = 0;
  private joltT = 9;

  constructor(variant: SceneVariant, opts: SubwayOpts = {}) {
    super(variant);
    this.seat = opts.seat ?? 'seat';
    this.show = showOf(opts.show ?? FEST.v);
  }

  private get card() {
    return this.variant === 'card';
  }

  /** 축제 with its occasional finale on now. */
  get rushing() {
    return this.show === FEST && this.rushLeft > 0;
  }

  /**
   * Where the page's controls sit (CSS px): `top` the bottom edge of the tabs and scene switch, `bottom` the top
   * edge of the status line and dock. `null`: nothing there (the landscape rail).
   */
  setEdges(top: number | null, bottom: number | null) {
    const t = top === null ? null : Math.round(top);
    const b = bottom === null ? null : Math.round(bottom);
    const same = (a: number | null, c: number | null) => (a === null || c === null ? a === c : Math.abs(a - c) < 2);
    if (same(t, this.top) && same(b, this.bottom)) return;
    this.top = t;
    this.bottom = b;
    if (this.w) this.layout();
  }

  setShow(v: number) {
    const next = showOf(v);
    if (next === this.show) return;
    this.show = next;
    this.next = Math.min(this.next, 0.3);
    if (next !== FEST && this.rushLeft > 0) {
      this.rushLeft = 0;
      this.stat('rush', 0);
    }
  }

  layout() {
    const { w, h, dpr } = this;
    const L = (this.L = layoutOf(this.seat, this.card, w, h, { top: this.top, bottom: this.bottom }));
    const V = (this.V = L.V);
    this.S = this.card ? clamp(h / 250, 0.4, 1.1) : clamp(Math.min(V.w / 340, V.h / 360), 0.3, 1.25);
    this.hy = V.y + V.h * L.hz;
    this.area = clamp(V.w / 360, 0.5, 3.2);

    const PW = (this.PW = Math.ceil(Math.max(V.w * 2.6, 1200 * this.S)));
    const seed = { seat: 7, door: 5, window: 3 }[this.seat];
    this.sky = buildSkyline(this.S * 0.8, PW, seed, dpr);
    this.refl = buildReflection(this.sky, PW, dpr);
    // Yeouido's towers start in the middle of the glass
    this.skyX = PW * 0.32 + 170 * this.S * 0.8 - V.x - V.w * 0.5;
    this.cars = Array.from({ length: 8 }, () => ({ x: rand(0, PW), v: rand(9, 16) * this.S * (Math.random() < 0.5 ? -1 : 1) }));

    this.inside = this.lit = this.tint = this.glassRefl = null;
    if (!this.card) this.paintCarriage();
    this.handles = L.handles.map((hd) => ({ ...hd, a: rand(-0.05, 0.05), w: 0, ph: rand(0, TAU) }));
    this.ripples = Array.from({ length: Math.round(46 * Math.max(1, V.w / 360)) }, () => ({ z: Math.random(), x: rand(0, 1) }));

    this.nearV = 300 * this.S * (this.motion < 1 ? 0.6 : 1);
    this.panel = 290 * this.S;
    this.nextJoint = this.near + this.panel * 2.6;
    if (L.led) {
      const m = mk(1, 1).getContext('2d')!;
      m.font = LED_FONT;
      this.ledW = m.measureText(LED_TEXT).width;
    }
  }

  /** The carriage with the glass cut out, the light it catches from the fireworks, and the glass's reflection. */
  private paintCarriage() {
    const { w, h, dpr, L, V } = this;
    const cut = (x: CanvasRenderingContext2D) => {
      x.fillStyle = '#000'; // the holes must be cut with an opaque colour to go all the way through
      x.beginPath();
      for (const r of L.panes) rr(x, r.x, r.y, r.w, r.h, r.r);
      x.fill();
    };
    const c = mk(w * dpr, h * dpr);
    const x = c.getContext('2d')!;
    x.scale(dpr, dpr);
    if (this.seat === 'door') paintDoor(x, w, h, L);
    else if (this.seat === 'window') paintWindow(x, w, h, L);
    else paintBench(x, w, h, L);
    x.globalCompositeOperation = 'destination-out';
    cut(x);
    this.inside = c;
    // nearer the glass, more light: kept at half size, it is only ever drawn blurred
    const lit = mk(c.width / 2, c.height / 2);
    const lx = lit.getContext('2d')!;
    lx.drawImage(c, 0, 0, lit.width, lit.height);
    lx.globalCompositeOperation = 'source-in';
    lx.scale(dpr / 2, dpr / 2);
    const cx = V.x + V.w / 2;
    const cy = V.y + V.h * 0.45;
    const g = lx.createRadialGradient(cx, cy, Math.min(V.w, V.h) * 0.3, cx, cy, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0.12)');
    lx.fillStyle = g;
    lx.fillRect(0, 0, w, h);
    this.lit = lit;
    this.tint = mk(lit.width, lit.height);
    const rc = mk(c.width, c.height);
    const rx = rc.getContext('2d')!;
    rx.scale(dpr, dpr);
    paintReflection(rx, w, L, this.seat);
    rx.globalCompositeOperation = 'destination-in';
    cut(rx);
    this.glassRefl = rc;
  }

  /** A tap on the glass sends a shell up from the river to burst at that height. */
  tap(x: number, y: number) {
    if (!this.card && !this.L.panes.some((r) => x >= r.x && x <= r.x + r.w && y >= Math.max(r.y, 0) && y <= r.y + r.h)) return;
    const V = this.V;
    const sky = this.hy - Math.max(V.y, 0);
    const top = Math.max(V.y, 0) + 0.08 * sky;
    const ty = y < this.hy - 24 * this.S ? Math.max(y, top) : this.hy - rand(0.5, 0.7) * sky;
    this.launch(this.fwX + x, ty, true);
  }

  /** 불꽃 올리기: one shell somewhere over the river. */
  fire() {
    const V = this.V;
    this.launch(this.fwX + V.x + rand(0.2, 0.8) * V.w, this.hy - rand(0.45, 0.75) * (this.hy - Math.max(V.y, 0)), true);
  }

  private launch(wx: number, ty: number, near: boolean, type?: ShellType) {
    const rise = clamp((this.hy - ty) / (260 * this.S), 0.7, 1.9);
    const finale = this.rushK > 0.5 || this.show === FINALE;
    // now and then a shaped shell: a heart, a star, a Saturn
    const kind = type ?? (Math.random() < (finale ? SHAPED_FINALE : SHAPED_CHANCE) ? pickShape() : pickType(finale ? FINALE.types : this.show.types));
    this.shells.push({ wx, y: this.hy + 1, y0: this.hy + 1, ty, t: 0, dur: rise, type: kind, pal: palFor(kind), near });
  }

  private burst(s: Shell) {
    const S = this.S;
    const big = s.type === 'willow' || s.type === 'palm' || s.type === 'saturn';
    const R = rand(50, 96) * S * (big ? 1.15 : isShaped(s.type) ? 1.1 : 1);
    const c1 = COL[s.pal[0]];
    const c2 = COL[s.pal[1] ?? s.pal[0]];
    const cap = this.card ? 700 : 1800;
    const few = this.card ? 0.6 : 1;
    const count = (n: number) => Math.round(n * few);
    /** one star flying off along (dx, dy) at k × the burst's speed */
    const star = (dx: number, dy: number, k: number, c: C3, o: Partial<Spark> = {}) => {
      if (this.parts.length >= cap) return;
      const drag = o.drag ?? 2.1;
      const v = R * drag * k;
      this.parts.push({
        x: s.wx, y: s.ty, vx: dx * v, vy: dy * v, age: 0, life: rand(1.3, 1.9), drag, c,
        g: 26 * S, size: 5.8 * S, trail: null, tw: false, dim: 1, ...o,
      });
    };
    const sphere = (): [number, number] => {
      const u = rand(-1, 1);
      const a = rand(0, TAU);
      const r = Math.sqrt(1 - u * u);
      return [r * Math.cos(a), u];
    };
    // shaped shells face the train, give or take a little turn and lean, so the shape reads; they sag slowly
    const lean = rand(-0.3, 0.3);
    const turn = Math.cos(rand(-0.4, 0.4));
    const face = (px: number, py: number): [number, number] => {
      const x = px * turn;
      return [x * Math.cos(lean) - py * Math.sin(lean), x * Math.sin(lean) + py * Math.cos(lean)];
    };
    const shapedStar = (px: number, py: number, c: C3) =>
      star(...face(px, py), rand(0.97, 1), c, { life: rand(1.7, 2.1), g: 18 * S });

    switch (s.type) {
      case 'heart': {
        const n = count(96);
        for (let i = 0; i < n; i++) {
          const t = (i / n) * TAU;
          const hx = 16 * Math.sin(t) ** 3;
          const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
          shapedStar(hx / 16, (hy - 2.5) / 16, i % 2 ? c2 : c1);
        }
        break;
      }
      case 'star': {
        // five points: ten corners, outer and inner in turn, with the stars spread evenly along the edges
        const corners = Array.from({ length: 10 }, (_, k) => {
          const a = -Math.PI / 2 + (k * Math.PI) / 5;
          const r = k % 2 ? 0.42 : 1;
          return [Math.cos(a) * r, Math.sin(a) * r] as const;
        });
        const n = count(100);
        for (let i = 0; i < n; i++) {
          const f = (i / n) * 10;
          const k = Math.floor(f);
          const [ax, ay] = corners[k];
          const [bx, by] = corners[(k + 1) % 10];
          shapedStar(lerp(ax, bx, f - k), lerp(ay, by, f - k), i % 2 ? c2 : c1);
        }
        break;
      }
      case 'saturn': {
        // a round planet and a tilted ring round it, in two colours
        for (let i = 0, n = count(90); i < n; i++) {
          const [dx, dy] = sphere();
          star(dx * 0.5, dy * 0.5, rand(0.95, 1.02), c1, { life: rand(1.7, 2.1), g: 18 * S, size: 6.4 * S });
        }
        const tilt = rand(0.22, 0.34);
        for (let i = 0, n = count(80); i < n; i++) {
          const a = (i / n) * TAU;
          shapedStar(Math.cos(a) * 1.15, Math.sin(a) * 1.15 * tilt, c2);
        }
        break;
      }
      case 'double':
        // 심 있는 국화: an outer ball in one colour, a smaller core in another
        for (let i = 0, n = count(110); i < n; i++) star(...sphere(), rand(0.92, 1.03), c1);
        for (let i = 0, n = count(50); i < n; i++) star(...sphere(), rand(0.42, 0.5), c2, { life: rand(1.1, 1.5) });
        break;
      case 'crossette':
        // a few heavy stars that each split in four, crackling
        for (let i = 0, n = count(16); i < n; i++) {
          const split = rand(0.55, 0.75);
          star(...sphere(), rand(0.72, 0.8), i % 2 ? c2 : c1, { life: split + 0.05, split, size: 7 * S, trail: [] });
        }
        break;
      case 'shift':
        // 색 바뀌는 국화: every star changes colour about halfway through
        for (let i = 0, n = count(120); i < n; i++) {
          const life = rand(1.8, 2.2);
          star(...sphere(), rand(0.92, 1.03), c1, { life, c2, shiftAt: life * rand(0.32, 0.4) });
        }
        break;
      default: {
        const t = s.type;
        const n = count({ peony: 130, chrys: 100, willow: 80, ring: 72, palm: 12, glitter: 130 }[t]);
        for (let i = 0; i < n; i++) {
          let dx: number;
          let dy: number;
          if (t === 'ring') {
            const a = (i / n) * TAU;
            dx = Math.cos(a);
            dy = Math.sin(a) * 0.55;
          } else if (t === 'palm') {
            const a = (i / n) * TAU + rand(-0.1, 0.1);
            dx = Math.cos(a) * rand(0.85, 1);
            dy = Math.sin(a) * rand(0.85, 1);
          } else [dx, dy] = sphere();
          star(dx, dy, rand(0.9, 1.05), t === 'willow' ? COL.gold : i % 2 ? c2 : c1, {
            drag: t === 'willow' ? 2.6 : t === 'palm' ? 1.5 : 2.1,
            life: t === 'willow' ? rand(2.8, 3.6) : t === 'palm' ? rand(1.8, 2.3) : t === 'glitter' ? rand(1.5, 2.2) : rand(1.3, 1.9),
            g: (t === 'willow' ? 42 : 26) * S,
            size: (t === 'palm' ? 8 : t === 'willow' ? 5 : 5.8) * S,
            trail: t === 'chrys' || t === 'willow' || t === 'palm' ? [] : null,
            tw: t === 'glitter',
          });
        }
      }
    }
    this.bursts.push({ wx: s.wx, y: s.ty, c: c1, age: 0, R, power: s.type === 'palm' ? 0.8 : 1 });
    this.smoke.push({ wx: s.wx + rand(-10, 10) * S, y: s.ty + rand(-8, 8) * S, r: R * rand(0.8, 1.1), age: 0, life: rand(16, 26), a: rand(0.05, 0.09) });
    if (this.smoke.length > 26) this.smoke.shift();
    if (this.card) return;
    this.shots++;
    this.stat('shots', this.shots);
    const pan = clamp(((s.wx - this.fwX) / this.w) * 2 - 1, -1, 1);
    const crackle = s.type === 'glitter' || s.type === 'crossette';
    this.emit('burst', { big: big ? 1 : 0, glitter: crackle ? 1 : 0, pan, near: s.near ? 1 : 0 });
  }

  /** A crossette star at the end of its flight: four smaller stars fly off crosswise. */
  private split(p: Spark) {
    const S = this.S;
    const a = Math.atan2(p.vy, p.vx);
    for (let k = 0; k < 4 && this.parts.length < (this.card ? 700 : 1800); k++) {
      const b = a + Math.PI / 4 + (k * Math.PI) / 2;
      const v = rand(80, 100) * S;
      this.parts.push({
        x: p.x, y: p.y, vx: Math.cos(b) * v + p.vx * 0.3, vy: Math.sin(b) * v + p.vy * 0.3, age: 0, life: rand(0.8, 1.1),
        drag: 2.4, c: p.c, g: 26 * S, size: 4.5 * S, trail: [], tw: false, dim: 1,
      });
    }
  }

  /** Whether the panel at index i is steel truss (or open bridge). */
  private inTruss(i: number) {
    return ((i % PANELS) + PANELS) % PANELS < TRUSS_PANELS;
  }

  audioState() {
    const V = this.V;
    const i = Math.floor((this.near + V.w / 2) / this.panel);
    return { truss: this.inTruss(i) ? 1 : 0, show: this.show.v, rush: this.rushK };
  }

  step(dt: number) {
    this.t += dt;
    const S = this.S;
    const V = this.V;
    // the far skyline creeps by; the fireworks' layer a little faster; the bridge's steel rushes past
    this.near += this.nearV * dt;
    this.skyX += this.nearV * 0.009 * dt;
    this.fwX += this.nearV * 0.014 * dt;
    for (const c of this.cars) {
      c.x += c.v * dt;
      if (c.x < 0) c.x += this.PW;
      if (c.x > this.PW) c.x -= this.PW;
    }
    // a rail joint: 덜컹
    if (this.near > this.nextJoint) {
      this.nextJoint += this.panel * 2.6;
      this.joltT = 0;
      for (const hd of this.handles) hd.w += rand(0.12, 0.22) * this.motion;
      if (!this.card) this.emit('joint');
    }
    this.joltT += dt;
    for (const hd of this.handles) {
      const drive = (0.05 * Math.sin(this.t * 0.62 + hd.ph) + 0.03 * Math.sin(this.t * 1.7 + hd.ph * 2.3)) * this.motion;
      hd.w += (-(9.8 / 0.42) * (hd.a - drive) - 0.9 * hd.w) * dt;
      hd.a += hd.w * dt;
    }

    // 축제's finale now and then (never at 드문드문: it should not wake anyone)
    if (this.show === FEST && !this.card) {
      if (this.rushLeft > 0) {
        this.rushLeft -= dt;
        if (this.rushLeft <= 0) {
          this.rushLeft = 0;
          this.rushIn = rand(...RUSH_EVERY);
          this.stat('rush', 0);
        }
      } else if ((this.rushIn -= dt) <= 0) {
        this.rushLeft = RUSH_LEN;
        this.stat('rush', 1);
      }
    }
    this.rushK = clamp(this.rushK + ((this.rushLeft > 0 ? 1 : -1) * dt) / RUSH_RAMP, 0, 1);

    // the next shell (or two or three together)
    this.next -= dt;
    if (this.next <= 0) {
      const k = this.show === FEST ? this.rushK : 0;
      const multi = lerp(this.show.multi, FINALE.multi, k);
      const n = Math.random() < multi ? (Math.random() < 0.4 ? 3 : 2) : 1;
      const cx = rand(0.18, 0.82);
      const sky = this.hy - Math.max(V.y, 0);
      for (let i = 0; i < n; i++) {
        const fx = clamp(cx + (n > 1 ? (i - (n - 1) / 2) * rand(0.16, 0.24) : 0), 0.08, 0.92);
        const lead = n > 1 && i > 0 ? this.shells[this.shells.length - 1].type : undefined;
        const same = lead && !isShaped(lead) ? lead : undefined;
        this.launch(this.fwX + V.x + fx * V.w, this.hy - rand(0.42, 0.8) * sky, false, same);
      }
      const g = this.show.gap;
      const f = FINALE.gap;
      this.next = rand(lerp(g[0], f[0], k), lerp(g[1], f[1], k)) / Math.pow(this.area, 0.7);
    }

    for (const s of this.shells) {
      s.t += dt;
      const e = 1 - Math.pow(1 - clamp(s.t / s.dur, 0, 1), 2.2);
      s.y = lerp(s.y0, s.ty, e);
      if (Math.random() < 0.8) {
        this.parts.push({
          x: s.wx + rand(-0.6, 0.6) * S, y: s.y, vx: rand(-6, 6) * S, vy: rand(4, 18) * S, age: 0, life: rand(0.3, 0.6),
          c: COL.gold, drag: 3, g: 10 * S, size: 2.2 * S, trail: null, tw: true, dim: 0.5,
        });
      }
    }
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      if (s.t >= s.dur) {
        this.shells.splice(i, 1);
        this.burst(s);
      }
    }
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.age += dt;
      if (p.split !== undefined && p.age >= p.split) {
        this.split(p);
        this.parts.splice(i, 1);
        continue;
      }
      if (p.age >= p.life) {
        this.parts.splice(i, 1);
        continue;
      }
      if (p.c2 && p.shiftAt !== undefined && p.age >= p.shiftAt) {
        p.c = p.c2;
        p.c2 = undefined;
      }
      if (p.trail) {
        p.trail.push(p.x, p.y);
        if (p.trail.length > 16) p.trail.splice(0, 2);
      }
      const f = Math.exp(-p.drag * dt);
      p.vx *= f;
      p.vy = p.vy * f + p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    let fl = 0;
    let r = 0;
    let gg = 0;
    let b = 0;
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const bu = this.bursts[i];
      bu.age += dt;
      if (bu.age > 3) {
        this.bursts.splice(i, 1);
        continue;
      }
      const k = bu.power * (Math.exp(-bu.age * 7) * 0.9 + Math.exp(-bu.age * 1.3) * 0.25);
      fl += k;
      r += bu.c[0] * k;
      gg += bu.c[1] * k;
      b += bu.c[2] * k;
    }
    // the light on the carriage follows smoothly: never more than three flashes a second, even in a finale
    this.flash += (Math.min(1, fl) * this.motion - this.flash) * Math.min(1, dt * 5);
    if (fl > 0.001) this.flashC = [lerp(r / fl, 255, 0.35), lerp(gg / fl, 255, 0.35), lerp(b / fl, 255, 0.35)];
    for (let i = this.smoke.length - 1; i >= 0; i--) {
      const m = this.smoke[i];
      m.age += dt;
      m.wx += 3 * S * dt;
      m.y -= 0.6 * S * dt;
      m.r += 1.2 * S * dt;
      if (m.age > m.life) this.smoke.splice(i, 1);
    }
    // ripples near the bridge: the nearer, the faster
    for (const rp of this.ripples) {
      const sp = this.nearV * 0.16 * Math.pow(rp.z, 2.2) + 2 * S;
      rp.x -= (sp * dt) / (V.w + 80);
      if (rp.x < -0.1) {
        rp.x += 1.2;
        rp.z = Math.random();
      }
    }
  }

  /* ---------- drawing ---------- */
  draw(x: CanvasRenderingContext2D) {
    const { w, h, dpr, S } = this;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    // the carriage rocks gently, and jolts at each rail joint; the outside moves against it
    const jolt = this.joltT < 0.5 ? Math.sin(this.joltT * 46) * Math.exp(-this.joltT * 10) * 1.1 * S : 0;
    const bob = (Math.sin(this.t * 1.9) * 0.35 * S + jolt) * this.motion;
    x.save();
    x.translate(0, bob);
    this.drawSky(x);
    this.drawSkyline(x);
    this.drawSmoke(x);
    this.drawFire(x);
    this.drawWater(x);
    this.drawNear(x);
    x.restore();
    if (this.inside && this.lit && this.tint && this.glassRefl) {
      x.setTransform(1, 0, 0, 1, 0, 0);
      x.drawImage(this.inside, 0, 0);
      if (this.flash > 0.01) {
        // the carriage takes on the colour of the burst
        const t = this.tint.getContext('2d')!;
        t.globalCompositeOperation = 'source-over';
        t.clearRect(0, 0, this.tint.width, this.tint.height);
        t.drawImage(this.lit, 0, 0);
        t.globalCompositeOperation = 'source-in';
        t.fillStyle = rgba(this.flashC, 1);
        t.fillRect(0, 0, this.tint.width, this.tint.height);
        x.globalCompositeOperation = 'lighter';
        x.globalAlpha = clamp(this.flash * 0.32, 0, 0.3);
        x.drawImage(this.tint, 0, 0, w * dpr, h * dpr);
        x.globalAlpha = 1;
      }
      x.globalCompositeOperation = 'screen';
      x.globalAlpha = this.seat === 'window' ? 0.17 : 0.1;
      x.drawImage(this.glassRefl, 0, 0);
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-over';
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    if (this.L.led) this.drawLed(x, this.L.led);
    if (this.card) {
      // a hint of the window's top edge
      x.fillStyle = vgrad(x, 0, h * 0.12, [[0, 'rgba(26,28,34,0.95)'], [1, 'rgba(26,28,34,0)']]);
      x.fillRect(0, 0, w, h * 0.12);
    }
    this.drawHandles(x);
  }

  private drawSky(x: CanvasRenderingContext2D) {
    const { w, V, hy } = this;
    const top = Math.min(0, V.y);
    x.fillStyle = vgrad(x, Math.max(V.y, 0), hy, [[0, '#04060f'], [0.5, '#0a0e22'], [0.82, '#1b1a33'], [0.94, '#3a2a3c'], [1, '#4c3236']]);
    x.fillRect(0, top - 20, w, hy - top + 20);
    if (this.flash <= 0.02) return;
    // the sky takes the bursts' light
    x.globalCompositeOperation = 'lighter';
    for (const b of this.bursts) {
      const k = b.power * Math.exp(-b.age * 4.5);
      if (k < 0.02) continue;
      const bx = b.wx - this.fwX;
      const R = b.R * 2.6;
      const g = x.createRadialGradient(bx, b.y, 0, bx, b.y, R);
      g.addColorStop(0, rgba(b.c, 0.13 * k));
      g.addColorStop(1, rgba(b.c, 0));
      x.fillStyle = g;
      x.fillRect(bx - R, b.y - R, R * 2, R * 2);
    }
    x.globalCompositeOperation = 'source-over';
  }

  private drawSkyline(x: CanvasRenderingContext2D) {
    const { sky, PW, hy, dpr, S, w } = this;
    if (!sky) return;
    const off = ((this.skyX % PW) + PW) % PW;
    const y0 = hy - sky.HT;
    for (let k = -1; k <= Math.ceil(w / PW) + 1; k++) {
      const X = k * PW - off;
      if (X > w || X + PW < 0) continue;
      x.drawImage(sky.c, 0, 0, sky.c.width, sky.HT * dpr, X, y0, PW, sky.HT);
    }
    // red aircraft lights on the tall towers
    if (Math.sin(this.t * 3.2) > 0.2) {
      x.fillStyle = 'rgba(255,70,60,0.95)';
      for (const tp of sky.tops) {
        for (let k = -1; k <= 1; k++) {
          const X = tp.x - off + k * PW;
          if (X < -4 || X > w + 4) continue;
          x.fillRect(X - 1.2 * S, y0 + tp.y - 2 * S, 2.4 * S, 2.4 * S);
        }
      }
    }
    // cars on the far bridge
    for (const c of this.cars) {
      for (let k = -1; k <= 1; k++) {
        const X = c.x - off + k * PW;
        if (X < -4 || X > w + 4) continue;
        x.fillStyle = c.v > 0 ? 'rgba(255,240,220,0.9)' : 'rgba(255,90,80,0.85)';
        x.fillRect(X, y0 + sky.by - 2.2 * S, 1.6 * S, 1.1 * S);
      }
    }
  }

  private drawSmoke(x: CanvasRenderingContext2D) {
    const sp = smokePuff();
    const fl = this.flash;
    for (const m of this.smoke) {
      const a = m.a * Math.min(1, m.age * 2) * (1 - m.age / m.life);
      if (a <= 0.002) continue;
      const X = m.wx - this.fwX;
      x.globalAlpha = a;
      x.drawImage(sp, X - m.r, m.y - m.r * 0.8, m.r * 2, m.r * 1.6);
      if (fl > 0.05) {
        // smoke lights up in the colour of the next burst
        x.globalCompositeOperation = 'lighter';
        x.globalAlpha = a * fl * 2.2;
        x.drawImage(halo(this.flashC), X - m.r, m.y - m.r * 0.8, m.r * 2, m.r * 1.6);
        x.globalCompositeOperation = 'source-over';
      }
    }
    x.globalAlpha = 1;
  }

  private drawFire(x: CanvasRenderingContext2D) {
    const S = this.S;
    const fw = this.fwX;
    x.globalCompositeOperation = 'lighter';
    for (const s of this.shells) {
      x.globalAlpha = 0.9;
      x.drawImage(spark(COL.gold), s.wx - fw - 4 * S, s.y - 4 * S, 8 * S, 8 * S);
    }
    for (const b of this.bursts) {
      const k = Math.exp(-b.age * 1.6) * b.power;
      if (k < 0.03) continue;
      const r = b.R * (1.25 + b.age * 0.2);
      x.globalAlpha = 0.5 * k;
      x.drawImage(halo(b.c), b.wx - fw - r, b.y - r, r * 2, r * 2);
    }
    for (const b of this.bursts) {
      if (b.age > 0.35) continue;
      const k = 1 - b.age / 0.35;
      const r = b.R * (0.35 + b.age * 1.2);
      x.globalAlpha = 0.85 * k * k * b.power * this.motion;
      x.drawImage(spark(FLASH_WHITE), b.wx - fw - r, b.y - r, r * 2, r * 2);
    }
    for (const p of this.parts) {
      const lf = p.age / p.life;
      let a = Math.pow(1 - lf, 1.4) * p.dim;
      if (p.tw && lf > 0.35) a *= Math.random() < 0.55 ? 1 : 0.15;
      if (lf > 0.78 && !p.tw) a *= 0.6 + Math.random() * 0.4;
      if (a < 0.02) continue;
      const X = p.x - fw;
      if (p.trail && p.trail.length > 3) {
        x.globalAlpha = a * 0.5;
        x.strokeStyle = rgba(p.c, 1);
        x.lineWidth = p.size * 0.32;
        x.beginPath();
        x.moveTo(p.trail[0] - fw, p.trail[1]);
        for (let j = 2; j < p.trail.length; j += 2) x.lineTo(p.trail[j] - fw, p.trail[j + 1]);
        x.lineTo(X, p.y);
        x.stroke();
      }
      const s = p.size * (1 - lf * 0.4);
      x.globalAlpha = a;
      x.drawImage(spark(p.c), X - s, p.y - s, s * 2, s * 2);
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
  }

  private drawWater(x: CanvasRenderingContext2D) {
    const { w, V, hy, S, PW } = this;
    if (!this.sky || !this.refl) return;
    const bot = Math.max(V.y + V.h, hy + 10) + 40;
    x.fillStyle = vgrad(x, hy, bot, [[0, '#141428'], [0.25, '#0b0d1c'], [1, '#04050b']]);
    x.fillRect(0, hy, w, bot - hy + 200);
    // the skyline in the water, each band swaying a little
    const off = ((this.skyX % PW) + PW) % PW;
    const RH = this.sky.HT * 1.25;
    const band = 3 * S;
    for (let yy = 0; yy < RH; yy += band) {
      const a = 0.55 * Math.pow(1 - yy / RH, 1.3);
      if (a < 0.02) continue;
      const dx = Math.sin(this.t * 1.4 + yy * 0.21) * 1.6 * S + Math.sin(this.t * 0.7 + yy * 0.05) * 1.2 * S;
      x.globalAlpha = a;
      const sy = (yy / RH) * this.refl.height;
      const sh = Math.max(1, (band / RH) * this.refl.height);
      for (let k = -1; k <= Math.ceil(w / PW) + 1; k++) {
        const X = k * PW - off + dx;
        if (X > w || X + PW < 0) continue;
        x.drawImage(this.refl, 0, sy, this.refl.width, sh, X, hy + yy, PW, band + 0.5);
      }
    }
    x.globalAlpha = 1;
    // the fireworks in the water
    x.globalCompositeOperation = 'lighter';
    for (const b of this.bursts) {
      const k = b.power * (Math.exp(-b.age * 2.2) * 0.6 + 0.1 * Math.exp(-b.age * 0.6));
      if (k < 0.02) continue;
      const X = b.wx - this.fwX;
      const my = hy + (hy - b.y) * 0.5;
      x.globalAlpha = 0.38 * k;
      x.drawImage(spark(b.c), X - b.R * 1.1, my - b.R * 0.9, b.R * 2.2, b.R * 1.8);
    }
    for (let i = 0; i < this.parts.length; i += 3) {
      const p = this.parts[i];
      const lf = p.age / p.life;
      const a = Math.pow(1 - lf, 1.5) * 0.28 * p.dim;
      if (a < 0.03 || p.y > hy) continue;
      const my = hy + (hy - p.y) * 0.5;
      if (my > bot) continue;
      const X = p.x - this.fwX + Math.sin(this.t * 3 + my * 0.3) * 2 * S;
      x.globalAlpha = a;
      x.drawImage(spark(p.c), X - p.size * 0.7, my - p.size * 2.2, p.size * 1.4, p.size * 4.4);
    }
    x.globalAlpha = 1;
    x.globalCompositeOperation = 'source-over';
    // ripples
    const span = bot - 40 - hy;
    const fc = this.flashC;
    const fl = this.flash;
    for (const r of this.ripples) {
      const z = r.z;
      const yy = hy + span * Math.pow(z, 1.7);
      const X = V.x - 40 + r.x * (V.w + 80);
      const a = 0.05 + 0.12 * z + fl * 0.25 * z;
      x.fillStyle = fl > 0.05
        ? `rgba(${lerp(150, fc[0], 0.6) | 0},${lerp(160, fc[1], 0.6) | 0},${lerp(200, fc[2], 0.6) | 0},${a})`
        : `rgba(150,160,200,${a})`;
      x.fillRect(X, yy, (5 + 34 * z * z) * S, Math.max(0.8, 1.2 * z * S));
    }
  }

  /** The near bridge: steel truss, then open railings with the odd catenary mast. Blurred, it goes by fast. */
  private drawNear(x: CanvasRenderingContext2D) {
    const { V, S, panel } = this;
    const fl = this.flash;
    const fc = this.flashC;
    const lit = (base: C3, k: number) => (fl > 0.03
      ? `rgba(${lerp(base[0], fc[0], fl * k) | 0},${lerp(base[1], fc[1], fl * k) | 0},${lerp(base[2], fc[2], fl * k) | 0},`
      : `rgba(${base[0]},${base[1]},${base[2]},`);
    const blur = this.nearV / 26;
    const top = Math.min(V.y, 0) - 60 * S;
    const bot = V.y + V.h + 70 * S;
    const steel = lit([15, 17, 23], 0.16);
    const rim = lit([90, 98, 116], 0.4);
    const i0 = Math.floor((this.near - panel) / panel);
    const i1 = Math.ceil((this.near + V.w + V.x + panel * 2) / panel);
    const sx = (i: number) => V.x + i * panel - this.near;
    const mw = 26 * S;
    for (let i = i0; i <= i1; i++) {
      const X = sx(i);
      if (this.inTruss(i) && this.inTruss(i + 1)) {
        // the diagonals
        const up = i % 2 === 0;
        const ya = up ? bot : top;
        const yb = up ? top : bot;
        x.lineCap = 'butt';
        x.lineWidth = mw * 0.8;
        for (let k = 0; k < 4; k++) {
          const o = (k - 1.5) * blur * 0.32;
          x.strokeStyle = `${steel}${k === 1 || k === 2 ? 0.55 : 0.28})`;
          x.beginPath();
          x.moveTo(X + o, ya);
          x.lineTo(X + panel + o, yb);
          x.stroke();
        }
        x.strokeStyle = `${rim}0.22)`;
        x.lineWidth = 1.5 * S;
        x.beginPath();
        x.moveTo(X - mw * 0.4, ya);
        x.lineTo(X + panel - mw * 0.4, yb);
        x.stroke();
      }
      if (this.inTruss(i)) {
        // the uprights
        const g = x.createLinearGradient(X - mw / 2 - blur, 0, X + mw / 2 + blur, 0);
        g.addColorStop(0, `${steel}0)`);
        g.addColorStop(0.3, `${steel}0.85)`);
        g.addColorStop(0.7, `${steel}0.85)`);
        g.addColorStop(1, `${steel}0)`);
        x.fillStyle = g;
        x.fillRect(X - mw / 2 - blur, top, mw + blur * 2, bot - top);
        x.fillStyle = `${rim}0.18)`;
        x.fillRect(X - mw / 2, top, 1.5 * S, bot - top);
      }
    }
    // the truss's top and bottom chords (the top one shows where the glass is tall)
    const chordTop = V.y + 10 * S;
    const chordBot = V.y + V.h - 12 * S;
    for (let i = i0; i <= i1; i++) {
      if (!this.inTruss(i) || !this.inTruss(i + 1)) continue;
      const X = sx(i);
      if (this.seat !== 'seat' && !this.card) {
        x.fillStyle = `${steel}0.7)`;
        x.fillRect(X, chordTop - 16 * S, panel, 14 * S);
      }
      x.fillStyle = `${steel}0.75)`;
      x.fillRect(X, chordBot, panel, 40 * S);
    }
    // the open stretch: a low railing and now and then a mast
    for (let i = i0; i <= i1; i++) {
      if (this.inTruss(i) && this.inTruss(i + 1)) continue;
      const X = sx(i);
      const ry = chordBot - 4 * S;
      x.fillStyle = `${steel}0.7)`;
      x.fillRect(X, ry, panel, 4 * S);
      x.fillStyle = `${steel}0.5)`;
      x.fillRect(X, ry + 18 * S, panel, 3 * S);
      for (let p = 0; p < panel; p += 36 * S) x.fillRect(X + p, ry, 3 * S + blur * 0.2, 40 * S);
      if (((i % 3) + 3) % 3 === 0) {
        const g = x.createLinearGradient(X - 8 * S - blur * 0.6, 0, X + 8 * S + blur * 0.6, 0);
        g.addColorStop(0, `${steel}0)`);
        g.addColorStop(0.5, `${steel}0.8)`);
        g.addColorStop(1, `${steel}0)`);
        x.fillStyle = g;
        x.fillRect(X - 8 * S - blur * 0.6, top, 16 * S + blur * 1.2, bot - top);
        x.fillRect(X, V.y + V.h * 0.06, 60 * S, 4 * S);
      }
    }
  }

  /** 문 앞: the destination board above the doors, its orange letters running to the left. */
  private drawLed(x: CanvasRenderingContext2D, r: Rect) {
    x.save();
    x.beginPath();
    rr(x, r.x, r.y, r.w, r.h, 8);
    x.fillStyle = '#07080b';
    x.fill();
    x.lineWidth = 2;
    x.strokeStyle = '#2c3038';
    x.stroke();
    x.clip();
    x.font = LED_FONT;
    x.textBaseline = 'middle';
    x.fillStyle = '#ffb547';
    x.shadowColor = 'rgba(255,166,60,0.75)';
    x.shadowBlur = 6;
    const gap = 40;
    const loop = this.ledW + gap;
    const off = ((this.t * 15) % loop + loop) % loop;
    for (let X = r.x + 12 - off; X < r.x + r.w; X += loop) x.fillText(LED_TEXT, X, r.y + r.h / 2 + 1);
    x.shadowBlur = 0;
    this.ledDots ??= x.createPattern(ledDots(), 'repeat');
    if (this.ledDots) {
      x.fillStyle = this.ledDots;
      x.fillRect(r.x, r.y, r.w, r.h);
    }
    x.restore();
  }

  private drawHandles(x: CanvasRenderingContext2D) {
    if (!this.handles.length) return;
    const S = this.card ? (this.h / 156) * 0.55 : this.L.k;
    const fl = this.flash;
    const fc = this.flashC;
    const base: C3 = [196, 200, 210];
    const c: C3 = fl > 0.03 ? [lerp(base[0], fc[0], fl * 0.35), lerp(base[1], fc[1], fl * 0.35), lerp(base[2], fc[2], fl * 0.35)] : base;
    const y0 = this.L.bar || -2;
    for (const hd of this.handles) {
      x.save();
      x.translate(hd.x, y0);
      x.rotate(hd.a);
      x.fillStyle = rgba([c[0] * 0.55, c[1] * 0.55, c[2] * 0.6], 0.95);
      x.fillRect(-3 * S, 0, 6 * S, hd.len);
      x.fillStyle = rgba(c, 0.5);
      x.fillRect(-3 * S, 0, 1.5 * S, hd.len);
      x.strokeStyle = rgba(c, 0.95);
      x.lineWidth = 4.2 * S;
      x.beginPath();
      x.ellipse(0, hd.len + 12 * S, 10 * S, 12 * S, 0, 0, TAU);
      x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.4)';
      x.lineWidth = 1.2 * S;
      x.beginPath();
      x.ellipse(0, hd.len + 12 * S, 10 * S, 12 * S, 0, Math.PI * 1.1, Math.PI * 1.6);
      x.stroke();
      x.restore();
    }
  }
}
