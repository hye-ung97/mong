export const TAU = Math.PI * 2;

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];

export type RGB = readonly [number, number, number];
export const mix = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];
export const rgb = (c: RGB, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

export const easeOutBounce = (x: number) => {
  const n = 7.5625;
  const d = 2.75;
  if (x < 1 / d) return n * x * x;
  if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
  if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
  return n * (x -= 2.625 / d) * x + 0.984375;
};

/** Seconds on the page clock. Scenes that must stay in sync with audio use this. */
export const wallTime = () => performance.now() / 1000;

export const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- sprites ---------- */
const sprites = new Map<string, HTMLCanvasElement>();

function sprite(key: string, paint: (x: CanvasRenderingContext2D, size: number) => void) {
  const hit = sprites.get(key);
  if (hit) return hit;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  paint(c.getContext('2d')!, size);
  sprites.set(key, c);
  return c;
}

/** Soft radial glow, used for flames, embers, caustics. */
export const glow = (r: number, g: number, b: number, mid = 0.45) =>
  sprite(`g${r},${g},${b},${mid}`, (x, S) => {
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(mid, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, S, S);
  });

/** Out-of-focus light disc (bokeh) with a slightly brighter rim. */
export const disc = (r: number, g: number, b: number) =>
  sprite(`d${r},${g},${b}`, (x, S) => {
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(0.76, `rgba(${r},${g},${b},0.42)`);
    gr.addColorStop(0.9, `rgba(${r},${g},${b},0.62)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, S, S);
  });

/** Offscreen layer in CSS pixels, rendered at the given device pixel ratio. */
export function layer(w: number, h: number, dpr: number, paint: (x: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * dpr));
  c.height = Math.max(1, Math.round(h * dpr));
  const x = c.getContext('2d')!;
  x.scale(dpr, dpr);
  paint(x);
  return c;
}

export function vignette(w: number, h: number, dpr: number, strength: number) {
  return layer(w, h, dpr, (x) => {
    const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, `rgba(0,0,0,${strength})`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** A water droplet sitting on glass. */
export function drawDrop(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, a: number) {
  ctx.globalAlpha = a;
  if (r < 2.2) {
    ctx.fillStyle = 'rgba(190,210,240,0.32)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillRect(x - r * 0.4, y - r * 0.5, Math.max(0.6, r * 0.5), Math.max(0.6, r * 0.5));
    ctx.globalAlpha = 1;
    return;
  }
  const g = ctx.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r * 1.1);
  g.addColorStop(0, 'rgba(255,255,255,0.2)');
  g.addColorStop(0.6, 'rgba(150,175,215,0.12)');
  g.addColorStop(1, 'rgba(215,230,255,0.5)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 1.18, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x + r * 0.08, y + r * 0.4, r * 0.78, r * 0.62, 0, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  ctx.beginPath();
  ctx.arc(x - r * 0.34, y - r * 0.46, Math.max(0.7, r * 0.22), 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}
