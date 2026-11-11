import { Scene, type SceneVariant } from './base';
import { clamp, layer, rand } from './util';

export type SandPalette = 'sunset' | 'ocean' | 'forest' | 'candy';

type Stop = readonly [number, number, number];

export const SAND_PALETTES: readonly { id: SandPalette; label: string; stops: readonly Stop[] }[] = [
  { id: 'sunset', label: '노을', stops: [[255, 210, 122], [255, 154, 90], [240, 86, 122], [160, 75, 184], [61, 58, 140]] },
  { id: 'ocean', label: '바다', stops: [[242, 236, 216], [143, 224, 208], [53, 182, 201], [42, 111, 184], [28, 58, 122]] },
  { id: 'forest', label: '숲', stops: [[240, 230, 176], [183, 214, 106], [90, 168, 96], [47, 122, 106], [138, 90, 58]] },
  { id: 'candy', label: '사탕', stops: [[255, 126, 182], [255, 209, 102], [123, 224, 168], [108, 196, 255], [176, 140, 255]] },
];

/** `fill`: seconds to fill the frame. `spread`: half-width of the stream in px. */
const SPEEDS = [
  { v: 0.3, fill: 420, spread: 2.5 },
  { v: 0.6, fill: 200, spread: 5 },
  { v: 1, fill: 90, spread: 9 },
] as const;
const speedOf = (v: number) => SPEEDS.reduce<(typeof SPEEDS)[number]>((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a), SPEEDS[0]);

const GRAVITY = 1500;
const TILT_PUSH = 1100; // sideways pull on falling grains at full tilt (px/s²)
const COLOR_SECONDS = 7; // how long one colour of the palette lasts
const MAX_FLY = 12000;
const HOLD_AFTER_DRAG = 4; // seconds the stream stays where the hand left it
const EMPTY_SECONDS = 7;

type State = 'pour' | 'full' | 'empty';

export interface SandOptions {
  speed?: number;
  palette?: SandPalette;
  autoEmpty?: boolean;
}

/**
 * 모래멍: a stream of coloured sand falls and piles up behind glass.
 * The stream sways slowly (or follows a dragging hand) while its colour moves through the palette,
 * so where it went and how fast it fell stay behind as stripes.
 * Settled sand has no holes, so it is a height per column plus a colour per cell; a grain that lands
 * rolls to the lower side, which makes the slopes.
 */
export class Sand extends Scene {
  palette: SandPalette;
  autoEmpty: boolean;
  private speedLevel: (typeof SPEEDS)[number];
  private top: number | null = null;
  private floor: number | null = null;

  private cell = 2;
  private cols = 0;
  private rows = 0;
  private limit = 0;
  private y0 = 0;
  private grid = new Uint32Array(0);
  private hts = new Int32Array(0);
  private count = 0;
  private off: HTMLCanvasElement | null = null;
  private offCtx: CanvasRenderingContext2D | null = null;
  private img: ImageData | null = null;
  private view = new Uint32Array(0);
  private backdrop: HTMLCanvasElement | null = null;
  private sheen: HTMLCanvasElement | null = null;

  private readonly fx = new Float32Array(MAX_FLY);
  private readonly fy = new Float32Array(MAX_FLY);
  private readonly fvx = new Float32Array(MAX_FLY);
  private readonly fvy = new Float32Array(MAX_FLY);
  private readonly fc = new Uint32Array(MAX_FLY);
  private fn = 0;

  private clock = rand(0, 100);
  private phase = rand(0, 5);
  private p1 = 0;
  private p2 = 0;
  private p3 = 0;
  private nx = 0;
  private nv = 0;
  private tx = 0;
  private hold = 0;
  private dragging = false;
  private acc = 0;
  private state: State = 'pour';
  private wait = 0;
  private emptyRate = 0;
  private emptyAcc = 0;
  private tilt = 0;
  private taper = false;
  private flowK = 1;
  private lastDt = 1 / 60;
  private lastFill = -1;

  constructor(variant: SceneVariant, opts: SandOptions = {}) {
    super(variant);
    this.palette = opts.palette ?? 'sunset';
    this.autoEmpty = opts.autoEmpty ?? true;
    this.speedLevel = speedOf(opts.speed ?? 0.6);
    this.reseed();
  }

  get speed() { return this.speedLevel.v; }

  setSpeed(v: number) { this.speedLevel = speedOf(v); }

  setPalette(p: SandPalette) { this.palette = p; }

  /** -1 (leaning left) .. 1 (leaning right): the stream bends that way. */
  setTilt(t: number) { this.tilt = clamp(t, -1, 1); }

  /** The sleep timer ended: the stream thins out and stops. */
  setTaper(on: boolean) { this.taper = on; }

  /** The tabs end at `top` and the controls start at `floor` (CSS px); the sand lives in between. */
  setEdges(top: number | null, floor: number | null) {
    const t = top === null ? null : Math.round(top);
    const f = floor === null ? null : Math.round(floor);
    const same = (a: number | null, b: number | null) => (a === null || b === null ? a === b : Math.abs(a - b) < 2);
    if (same(t, this.top) && same(f, this.floor)) return;
    this.top = t;
    this.floor = f;
    if (this.w) this.layout();
  }

  empty() {
    if (this.state === 'empty' || this.count <= 0) return;
    this.state = 'empty';
    this.emptyRate = Math.max(this.count, 2000) / EMPTY_SECONDS;
    this.emptyAcc = 0;
    this.emit('empty');
  }

  dragStart(x: number) {
    this.dragging = true;
    this.tx = x;
  }

  dragMove(x: number) {
    if (!this.dragging) return false;
    this.tx = x;
    return true;
  }

  dragEnd() {
    if (!this.dragging) return;
    this.dragging = false;
    this.hold = HOLD_AFTER_DRAG;
  }

  audioState() {
    return {
      flow: this.state === 'pour' ? this.speedLevel.v * this.flowK : 0,
      drain: this.state === 'empty' ? 1 : 0,
    };
  }

  private reseed() {
    this.p1 = rand(0, 6.28);
    this.p2 = rand(0, 6.28);
    this.p3 = rand(0, 6.28);
  }

  /** Where the stream goes when nobody touches it: a very slow drift plus two sways, so it never repeats a path. */
  private autoX(t: number) {
    return this.w * clamp(
      0.5 + 0.3 * Math.sin(t * 0.053 + this.p3) + 0.14 * Math.sin(t * 0.31 + this.p1) + 0.05 * Math.sin(t * 1.13 + this.p2),
      0.03, 0.97,
    );
  }

  private get rate() { return (this.cols * this.limit) / this.speedLevel.fill; }

  private color(phase: number) {
    const st = (SAND_PALETTES.find((p) => p.id === this.palette) ?? SAND_PALETTES[0]).stops;
    const n = st.length;
    const whole = Math.floor(phase);
    const i = whole % n;
    const x = clamp((phase - whole - 0.3) / 0.4, 0, 1);
    const f = x * x * (3 - 2 * x);
    const a = st[i];
    const b = st[(i + 1) % n];
    const k = Math.random() < 0.03 ? 1.22 : rand(0.84, 1.06); // every grain is a little lighter or darker
    const r = clamp((a[0] + (b[0] - a[0]) * f) * k, 0, 255) | 0;
    const g = clamp((a[1] + (b[1] - a[1]) * f) * k, 0, 255) | 0;
    const bl = clamp((a[2] + (b[2] - a[2]) * f) * k, 0, 255) | 0;
    return (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0; // ImageData bytes are R,G,B,A = little-endian ABGR
  }

  /** One grain settles in column `c`, rolling toward the lower side first. */
  private land(c: number, col: number, dir: number) {
    const h = this.hts;
    const last = this.cols - 1;
    c = clamp(c, 0, last);
    for (let i = 0; i < 600; i++) {
      const hc = h[c];
      const l = c > 0 ? h[c - 1] : 1e9;
      const r = c < last ? h[c + 1] : 1e9;
      const l2 = c > 1 ? h[c - 2] : 1e9;
      const r2 = c < last - 1 ? h[c + 2] : 1e9;
      const canL = l < hc || (l <= hc && l2 < hc && Math.random() < 0.6);
      const canR = r < hc || (r <= hc && r2 < hc && Math.random() < 0.6);
      if (!canL && !canR) break;
      if (canL && canR) {
        if (!dir) dir = Math.random() < 0.5 ? -1 : 1;
      } else dir = canL ? -1 : 1;
      c += dir;
    }
    if (h[c] >= this.rows) return;
    this.grid[(this.rows - 1 - h[c]) * this.cols + c] = col;
    h[c]++;
    this.count++;
  }

  private peak() {
    let m = 0;
    for (let i = 0; i < this.cols; i++) if (this.hts[i] > m) m = this.hts[i];
    return m;
  }

  /** Pile up `frac` of the frame at once, the way the stream would have. */
  private prefill(frac: number) {
    const n = Math.floor(this.cols * this.limit * frac);
    const dt = 1 / this.rate;
    for (let i = 0; i < n; i++) {
      if ((i & 255) === 0 && this.peak() >= this.limit) break;
      this.clock += dt;
      this.phase += dt / COLOR_SECONDS;
      const x = this.autoX(this.clock) + (Math.random() + Math.random() + Math.random() - 1.5) * this.speedLevel.spread * 2;
      this.land(Math.floor(x / this.cell), this.color(this.phase), 0);
    }
    this.nx = this.tx = this.autoX(this.clock);
  }

  layout() {
    const { w, h, dpr } = this;
    const full = this.variant === 'full';
    const floorY = full && this.floor !== null ? clamp(this.floor, h * 0.4, h) : h;
    const topY = full ? (this.top !== null ? this.top : 20) : 12;
    const cell = w * h > 1_600_000 ? 3 : 2;
    const cols = Math.ceil(w / cell);
    const rows = Math.max(8, Math.ceil(floorY / cell));
    const had = this.cols ? this.count / (this.cols * this.limit) : -1;
    const old = { grid: this.grid, hts: this.hts, cols: this.cols, rows: this.rows, cell: this.cell };

    this.cell = cell;
    this.cols = cols;
    this.rows = rows;
    this.y0 = floorY - rows * cell;
    this.limit = Math.max(4, rows - Math.round(topY / cell));
    this.grid = new Uint32Array(cols * rows);
    this.hts = new Int32Array(cols);
    this.count = 0;
    this.fn = 0;
    if (old.cols === cols && old.cell === cell) {
      // same width (the controls moved, a toolbar slid away): keep the pile, bottom-aligned
      for (let c = 0; c < cols; c++) {
        const n = Math.min(old.hts[c], rows);
        for (let k = 0; k < n; k++) this.grid[(rows - 1 - k) * cols + c] = old.grid[(old.rows - 1 - k) * old.cols + c];
        this.hts[c] = n;
        this.count += n;
      }
    } else {
      this.prefill(had >= 0 ? Math.min(had, 0.9) : full ? 0.14 : 0.45);
    }
    this.nx = this.tx = clamp(this.nx || this.autoX(this.clock), 4, w - 4);

    const off = document.createElement('canvas');
    off.width = cols;
    off.height = rows;
    this.off = off;
    this.offCtx = off.getContext('2d')!;
    this.img = this.offCtx.createImageData(cols, rows);
    this.view = new Uint32Array(this.img.data.buffer);

    this.backdrop = layer(w, h, dpr, (x) => {
      let gr = x.createLinearGradient(0, 0, 0, floorY);
      gr.addColorStop(0, '#1b1826');
      gr.addColorStop(1, '#0c0b12');
      x.fillStyle = gr;
      x.fillRect(0, 0, w, h);
      gr = x.createRadialGradient(w / 2, -h * 0.1, 0, w / 2, -h * 0.1, h * 0.8);
      gr.addColorStop(0, 'rgba(180,151,242,0.16)');
      gr.addColorStop(1, 'rgba(180,151,242,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, w, h);
      if (floorY < h) {
        // the stand: the sand rests on it and the controls sit on its front
        gr = x.createLinearGradient(0, floorY, 0, h);
        gr.addColorStop(0, '#2a2533');
        gr.addColorStop(0.12, '#17151d');
        gr.addColorStop(1, '#0a090d');
        x.fillStyle = gr;
        x.fillRect(0, floorY, w, h - floorY);
        x.fillStyle = 'rgba(255,255,255,0.14)';
        x.fillRect(0, floorY, w, 1);
        const slot = this.slotHalf() * cell + 3;
        x.fillStyle = '#050407'; // the slot the sand drains through
        x.fillRect(w / 2 - slot, floorY, slot * 2, 3);
      }
    });
    // glass: one slanted band of light
    this.sheen = layer(w, h, dpr, (x) => {
      const gr = x.createLinearGradient(0, 0, w, w * 0.9);
      gr.addColorStop(0.1, 'rgba(255,255,255,0)');
      gr.addColorStop(0.26, 'rgba(255,255,255,0.05)');
      gr.addColorStop(0.34, 'rgba(255,255,255,0.012)');
      gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      x.fillStyle = gr;
      x.fillRect(0, 0, w, floorY);
    });
    this.lastFill = -1;
  }

  private slotHalf() { return Math.max(3, Math.round(this.cols * 0.025)); }

  step(dt: number) {
    if (!this.cols) return;
    this.lastDt = dt;
    this.clock += dt * this.motion;
    this.phase += dt / COLOR_SECONDS;
    this.flowK += ((this.taper ? 0 : 1) - this.flowK) * Math.min(1, dt * 0.25);
    const { w, cell } = this;

    // where the stream is headed
    if (!this.dragging) {
      if (this.hold > 0) this.hold -= dt;
      else this.tx += (this.autoX(this.clock) - this.tx) * Math.min(1, dt * 1.5);
    }
    const prev = this.nx;
    this.nx += (clamp(this.tx, 4, w - 4) - this.nx) * Math.min(1, dt * 9);
    this.nv = (this.nx - prev) / dt;

    if (this.state === 'pour') {
      this.acc += this.rate * this.flowK * dt;
      const sp = this.speedLevel.spread;
      while (this.acc >= 1 && this.fn < MAX_FLY) {
        this.acc -= 1;
        const i = this.fn++;
        const sub = Math.random();
        this.fvy[i] = rand(160, 260);
        this.fvx[i] = this.nv * 0.4 + rand(-8, 8);
        this.fx[i] = prev + (this.nx - prev) * sub + (Math.random() + Math.random() + Math.random() - 1.5) * sp;
        this.fy[i] = this.y0 - sub * this.fvy[i] * dt - 2;
        this.fc[i] = this.color(this.phase);
      }
      if (this.acc > 1) this.acc = 1;
      if (this.peak() >= this.limit) {
        this.state = 'full';
        this.wait = 2;
        if (this.variant === 'full') this.stat('full', this.autoEmpty ? 1 : 0);
      }
    } else if (this.state === 'full') {
      if (this.autoEmpty || this.variant === 'card') {
        this.wait -= dt;
        if (this.wait <= 0) this.empty();
      }
    } else {
      this.drain(dt);
      if (this.count <= 0) {
        this.count = 0;
        this.reseed();
        this.state = 'pour';
      }
    }

    // grains in the air
    const floorY = this.y0 + this.rows * cell;
    const last = this.cols - 1;
    const push = this.tilt * TILT_PUSH * dt;
    const lean = this.tilt > 0.15 ? 1 : this.tilt < -0.15 ? -1 : 0;
    for (let i = 0; i < this.fn; i++) {
      this.fvy[i] += GRAVITY * dt;
      this.fvx[i] += push;
      this.fy[i] += this.fvy[i] * dt;
      let x = this.fx[i] + this.fvx[i] * dt;
      if (x < 0) {
        x = 0;
        this.fvx[i] = 0;
      } else if (x > w - 1) {
        x = w - 1;
        this.fvx[i] = 0;
      }
      this.fx[i] = x;
      const c = clamp(Math.floor(x / cell), 0, last);
      if (this.fy[i] >= floorY - this.hts[c] * cell) {
        if (this.state !== 'empty') this.land(c, this.fc[i], this.fvx[i] > 12 ? 1 : this.fvx[i] < -12 ? -1 : lean);
        const j = --this.fn;
        this.fx[i] = this.fx[j];
        this.fy[i] = this.fy[j];
        this.fvx[i] = this.fvx[j];
        this.fvy[i] = this.fvy[j];
        this.fc[i] = this.fc[j];
        i--;
      }
    }

    const pct = Math.min(100, Math.round((this.count / (this.cols * this.limit)) * 100));
    if (pct !== this.lastFill) {
      this.lastFill = pct;
      this.stat('fill', pct);
    }
  }

  /** Sand leaves through the slot in the middle of the stand: the columns above it sink, and the tops of their neighbours slide in. */
  private drain(dt: number) {
    const { cols, rows, grid: g, hts: h } = this;
    const hw = this.slotHalf();
    const mid = cols >> 1;
    const a = Math.max(0, mid - hw);
    const b = Math.min(cols - 1, mid + hw);
    this.emptyAcc += this.emptyRate * dt;
    const k = Math.floor(this.emptyAcc / (b - a + 1));
    if (k > 0) {
      this.emptyAcc -= k * (b - a + 1);
      for (let c = a; c <= b; c++) {
        const n = Math.min(k, h[c]);
        if (!n) continue;
        const top = rows - h[c];
        for (let r = rows - 1; r >= top; r--) g[r * cols + c] = r - n >= top ? g[(r - n) * cols + c] : 0;
        h[c] -= n;
        this.count -= n;
      }
    }
    const move = (from: number, to: number) => {
      const at = (rows - h[from]) * cols + from;
      const col = g[at];
      g[at] = 0;
      h[from]--;
      g[(rows - 1 - h[to]) * cols + to] = col;
      h[to]++;
    };
    // while the slot is fed, sand slides at its natural slope; once the slot runs dry, what is left creeps in too
    let fed = false;
    for (let c = a; c <= b; c++) if (h[c] > 0) fed = true;
    const step = fed ? 1 : 0;
    for (let pass = 0; pass < 5; pass++) {
      for (let c = mid; c > 0; c--) while (h[c - 1] - h[c] > step) move(c - 1, c);
      for (let c = mid; c < cols - 1; c++) while (h[c + 1] - h[c] > step) move(c + 1, c);
    }
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, cols, rows, cell, view } = this;
    if (!this.off || !this.offCtx || !this.img || !this.backdrop || !this.sheen) return;
    view.set(this.grid);
    for (let i = 0; i < this.fn; i++) {
      const c = Math.floor(this.fx[i] / cell);
      if (c < 0 || c >= cols) continue;
      const r1 = Math.floor((this.fy[i] - this.y0) / cell);
      const len = clamp(Math.round((this.fvy[i] * this.lastDt) / cell), 1, 7);
      const stop = rows - this.hts[c];
      for (let r = Math.max(0, r1 - len + 1); r <= r1 && r < stop; r++) view[r * cols + c] = this.fc[i];
    }
    this.offCtx.putImageData(this.img, 0, 0);
    ctx.drawImage(this.backdrop, 0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, this.y0, cols * cell, rows * cell);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.sheen, 0, 0, w, h);
  }
}
