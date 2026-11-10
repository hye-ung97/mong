import { Scene, type SceneVariant } from './base';
import {
  TAU, clamp, easeOutBounce, glow, layer, mix, pick, rand, rgb, roundRect, smooth, vignette, type RGB,
} from './util';

export type WoodKind = 'oak' | 'pine' | 'birch';

/** Oak burns long, pine crackles and throws sparks, birch flares bright. */
export const WOOD: Record<WoodKind, { life: number; bark: readonly [RGB, RGB]; sparks: number; bright: number }> = {
  oak: { life: 1.5, bark: [[122, 82, 50], [64, 40, 24]], sparks: 1, bright: 1 },
  pine: { life: 0.85, bark: [[146, 82, 46], [76, 38, 20]], sparks: 1.8, bright: 1.05 },
  birch: { life: 0.8, bark: [[226, 220, 206], [150, 142, 128]], sparks: 1, bright: 1.3 },
};

interface Crack { u: number; v: number; l: number; a: number; p: number }
interface Log {
  x: number; y: number; a: number; len: number; th: number;
  burn: number; ignite: number; drop: number; life: number; fast: boolean;
  kind: WoodKind; cracks: Crack[];
}
interface Flame { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; seed: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; seed: number }
interface Smoke { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number }
interface Stone { a: number; w: number; h: number; tone: number; front: boolean }
interface Star { x: number; y: number; r: number; p: number; sp: number }
interface Ember { x: number; y: number; r: number; p: number; sp: number }

const MAX_LOGS = 5;
const DROP_TIME = 0.7; // s for a new log to fall and settle
/** First contact of the bounce (easeOutBounce reaches 1 at x = 1/2.75). */
const FIRST_CONTACT = DROP_TIME / 2.75;

/** 불멍: a campfire whose logs really burn down; add logs to keep it going. */
export class Fire extends Scene {
  private fx = 0.5;
  private fy = 0.66;
  private fyBase = 0.66;
  private fyTarget = 0.66;
  private cx = 0;
  private by = 0;
  private horizon = 0;
  private logs: Log[] = [];
  private flames: Flame[] = [];
  private sparks: Spark[] = [];
  private smoke: Smoke[] = [];
  private stones: Stone[] = [];
  private flare = 0;
  private cool = 0;
  private sinceAdd = 0;
  /** Add a log by itself when the fire runs low, so a long session never goes dark. */
  autoTend = true;
  private added = 0;
  private intensity = 0.6;
  private flicker = 1;
  private sparkMul = 1;
  private statTimer = 0;
  private acc = { flame: 0, spark: 0, smoke: 0 };
  private readonly flameSprites = [glow(255, 246, 214, 0.3), glow(255, 186, 80), glow(255, 106, 36), glow(176, 46, 14)];
  private readonly ember = glow(255, 132, 48, 0.25);
  private readonly smokeSprite = glow(120, 116, 112, 0.5);
  private readonly stars: Star[] = Array.from({ length: 80 }, () => ({
    x: Math.random(), y: Math.random(), r: rand(0.5, 1.5), p: rand(0, TAU), sp: rand(0.5, 2),
  }));
  private readonly embers: Ember[] = Array.from({ length: 30 }, () => ({
    x: rand(-1, 1), y: rand(-1, 1), r: rand(3, 9), p: rand(0, TAU), sp: rand(1, 3.5),
  }));
  private bg!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;

  constructor(variant: SceneVariant) {
    super(variant);
    const start: [number, number, number, number, number, number][] = [
      [-36, -12, -0.44, 152, 26, 0.3],
      [36, -12, 0.44, 152, 26, 0.22],
      [0, 4, 0.05, 178, 28, 0.12],
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
      life: rand(85, 125) * WOOD[o.kind].life,
      fast: false,
      cracks: Array.from({ length: 10 }, () => ({
        u: rand(-0.42, 0.34), v: rand(-0.3, 0.32), l: rand(0.04, 0.12), a: rand(-0.6, 0.6), p: rand(0, TAU),
      })),
      ...o,
    };
  }

  layout() {
    const { w, h } = this;
    let scale = 1;
    this.fx = 0.5;
    this.fyBase = 0.66;
    if (this.variant === 'card') {
      if (w / h > 1.4) {
        this.fx = 0.7;
        this.fyBase = 0.7;
        scale = 1.15;
      } else {
        this.fyBase = 0.52;
        scale = 0.95;
      }
    } else if (w > h && h < 520) {
      this.fyBase = 0.72; // landscape phone
    } else if (w > 900) {
      this.fyBase = 0.64;
      scale = 0.85;
    }
    if (this.fyTarget === this.fy) this.fyTarget = this.fyBase;
    this.fy = this.fyTarget;
    const s = (this.s = clamp(Math.min(w / 390, h / 420), 0.3, 2) * scale);
    this.cx = w * this.fx;
    this.by = h * this.fy;
    const hz = (this.horizon = Math.max(h * 0.14, h * this.fyBase - 200 * s));
    this.stones = Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * TAU + rand(-0.07, 0.07);
      return { a, w: rand(30, 46), h: rand(18, 27), tone: rand(0.75, 1.15), front: Math.sin(a) > 0.05 };
    });
    this.bg = layer(w, h, this.dpr, (x) => {
      let g = x.createLinearGradient(0, 0, 0, hz);
      g.addColorStop(0, '#030409');
      g.addColorStop(1, '#0e101b');
      x.fillStyle = g;
      x.fillRect(0, 0, w, hz + 1);
      g = x.createLinearGradient(0, hz, 0, h);
      g.addColorStop(0, '#0b0907');
      g.addColorStop(1, '#17100b');
      x.fillStyle = g;
      x.fillRect(0, hz, w, h - hz);
      // distant ridge
      x.fillStyle = '#08090e';
      x.beginPath();
      x.moveTo(0, hz + 2);
      for (let px = 0; px <= w + 20; px += 20) {
        x.lineTo(px, hz - (16 + 10 * Math.sin(px * 0.008) + 6 * Math.sin(px * 0.021 + 1)) * s);
      }
      x.lineTo(w + 20, hz + 2);
      x.closePath();
      x.fill();
      // pine silhouettes
      x.fillStyle = '#030406';
      for (let tx = -10; tx < w + 20;) {
        const near = Math.abs(tx - this.cx) < 150 * s;
        const th = rand(40, 125) * s * (near ? 0.5 : 1);
        const tw = th * rand(0.32, 0.42);
        for (let k = 0; k < 3; k++) {
          const bottom = hz + 3 - th * 0.3 * k;
          const top = bottom - th * (k === 2 ? 0.4 : 0.55);
          const half = (tw / 2) * (1 - 0.26 * k);
          x.beginPath();
          x.moveTo(tx - half, bottom);
          x.lineTo(tx, top);
          x.lineTo(tx + half, bottom);
          x.closePath();
          x.fill();
        }
        tx += tw * rand(0.45, 0.95);
      }
    });
    this.vig = vignette(w, h, this.dpr, 0.6);
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
    const x = atX === undefined ? rand(-24, 24) : clamp((atX - this.cx) / this.s, -30, 30);
    this.logs.push(this.makeLog({ x, y: rand(-20, -8), a: side * rand(0.16, 0.55), len: rand(138, 170), th: rand(22, 29), kind }));
    this.cool = 4;
    this.emit('add', { kind, impactIn: FIRST_CONTACT });
  }

  private land(L: Log) {
    const burst = Math.round(34 * WOOD[L.kind].sparks * this.motion);
    for (let i = 0; i < burst; i++) this.spawnSpark(true);
    this.flare = WOOD[L.kind].bright;
    this.emit('land', { kind: L.kind });
  }

  tap() {
    this.addLogByHand();
  }

  audioState() {
    return { intensity: this.intensity, crackle: this.sparkMul };
  }

  private spawnFlame(burning: Log[]) {
    const s = this.s;
    let x = this.cx + rand(-30, 30) * s;
    let y = this.by - rand(2, 14) * s;
    let power = 0.7;
    if (burning.length && Math.random() < 0.8) {
      const L = pick(burning);
      const u = rand(-0.36, 0.36) * L.len * s;
      x = this.cx + L.x * s + Math.cos(L.a) * u;
      y = this.by + L.y * s + Math.sin(L.a) * u - L.th * s * 0.35;
      power = L.ignite * (1 - 0.6 * smooth(0.5, 1, L.burn));
    }
    const I = this.intensity;
    this.flames.push({
      x,
      y,
      vx: rand(-14, 14) * s,
      vy: -rand(40, 100) * s,
      life: 0,
      max: rand(0.55, 1.1) * (0.75 + 0.45 * I) * (0.6 + 0.4 * power),
      size: rand(14, 28) * s * (0.55 + 0.5 * I) * (0.5 + 0.5 * power),
      seed: rand(0, TAU),
    });
  }

  private spawnSpark(burst: boolean) {
    const s = this.s;
    this.sparks.push({
      x: this.cx + rand(-45, 45) * s,
      y: this.by - rand(burst ? 0 : 20, burst ? 30 : 90) * s,
      vx: rand(-30, 30) * s * (burst ? 2.2 : 1),
      vy: -rand(70, 170) * s * (burst ? 1.3 : 1),
      life: 0,
      max: rand(0.8, 2.4),
      r: rand(0.7, 1.6) * Math.max(0.8, s),
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
    for (const L of this.logs) {
      if (L.drop < 1) {
        L.drop = Math.min(1, L.drop + dt / DROP_TIME);
        if (L.drop === 1) this.land(L);
        continue;
      }
      L.ignite = Math.min(1, L.ignite + dt / 3);
      L.burn += (dt / L.life) * (0.35 + 0.65 * L.ignite) * (L.fast ? 7 : 1);
      fuel += L.ignite * (1 - smooth(0.7, 1, L.burn)) * (L.len / 160);
    }
    this.logs = this.logs.filter((L) => L.burn < 1);
    this.cool -= dt;
    this.sinceAdd += dt;
    if (this.variant === 'card') {
      if (this.cool <= 0 && (this.logs.length < 3 || fuel < 1.5)) this.addLog();
    } else if (this.autoTend && this.cool <= 0 && this.sinceAdd > 20 && (this.logs.length < 2 || fuel < 1.3)) {
      this.addLog(pick<WoodKind>(['oak', 'oak', 'pine', 'birch']));
    }
    this.flare = Math.max(0, this.flare - dt / 2.8);
    this.flicker = 0.86 + 0.07 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 13.1 + 1.3) + 0.03 * Math.sin(t * 23.7 + 2.1);
    this.intensity = clamp(fuel / 3.6 + this.flare * 0.22, 0.06, 1.25);

    const burning = this.logs.filter((L) => L.drop >= 1 && L.ignite > 0.05 && L.burn < 0.97);
    this.sparkMul = burning.length ? burning.reduce((n, L) => n + WOOD[L.kind].sparks, 0) / burning.length : 1;
    this.acc.flame += dt * (30 + 160 * this.intensity);
    while (this.acc.flame >= 1) {
      this.acc.flame -= 1;
      this.spawnFlame(burning);
    }
    this.acc.spark += dt * (1 + 5 * this.intensity) * this.sparkMul * this.motion;
    while (this.acc.spark >= 1) {
      this.acc.spark -= 1;
      this.spawnSpark(false);
    }
    this.acc.smoke += dt * 3;
    while (this.acc.smoke >= 1) {
      this.acc.smoke -= 1;
      this.smoke.push({
        x: this.cx + rand(-20, 20) * s,
        y: this.by - (120 + 90 * this.intensity) * s,
        vx: rand(-6, 6) * s,
        vy: -rand(18, 30) * s,
        life: 0,
        max: rand(4, 7),
        r: rand(18, 30) * s,
      });
    }

    const cx = this.cx;
    for (const p of this.flames) {
      p.life += dt;
      const k = p.life / p.max;
      p.vy -= 150 * s * dt;
      p.x += (p.vx + (cx - p.x) * 1.6 * k + Math.sin(t * 4.2 + (p.y * 0.035) / s + p.seed * 0.3) * 26 * s * k) * dt;
      p.y += p.vy * dt;
    }
    this.flames = this.flames.filter((p) => p.life < p.max);
    for (const p of this.sparks) {
      p.life += dt;
      p.vx += Math.sin(t * 3 + p.seed) * 50 * s * dt;
      p.vy += 18 * s * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    this.sparks = this.sparks.filter((p) => p.life < p.max);
    for (const p of this.smoke) {
      p.life += dt;
      p.x += (p.vx + Math.sin(t * 0.5 + p.y * 0.01) * 6 * s) * dt;
      p.y += p.vy * dt;
      p.r += 6 * s * dt;
    }
    this.smoke = this.smoke.filter((p) => p.life < p.max);

    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 0.3;
      this.stat('intensity', clamp(this.intensity / 1.2, 0, 1));
      this.stat('logs', this.logs.filter((L) => L.drop >= 1).length);
    }
  }

  private drawStones(ctx: CanvasRenderingContext2D, front: boolean, I: number) {
    const { s, cx, by } = this;
    const rx = 132 * s;
    const ry = 38 * s;
    const cy = by + 10 * s;
    const list = this.stones.filter((st) => st.front === front).sort((a, b) => Math.sin(a.a) - Math.sin(b.a));
    for (const st of list) {
      const x = cx + Math.cos(st.a) * rx;
      const y = cy + Math.sin(st.a) * ry;
      const sw = st.w * s;
      const sh = st.h * s;
      const lit = clamp((front ? 0.3 : 0.85) * I * 0.6, 0, 1);
      const g = ctx.createLinearGradient(0, y - sh / 2, 0, y + sh / 2);
      g.addColorStop(0, rgb(mix([40 * st.tone, 36 * st.tone, 34 * st.tone], [196, 98, 46], lit)));
      g.addColorStop(1, 'rgb(14,12,11)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, sw / 2, sh / 2, 0, 0, TAU);
      ctx.fill();
    }
  }

  private drawLog(ctx: CanvasRenderingContext2D, L: Log, I: number) {
    const s = this.s;
    const d = L.drop < 1 ? easeOutBounce(L.drop) : 1;
    const len = L.len * s * (1 - 0.3 * smooth(0.55, 1, L.burn));
    const th = L.th * s * (1 - 0.35 * smooth(0.5, 1, L.burn));
    const char = clamp(L.burn * 1.6 + L.ignite * 0.25, 0, 1);
    const bark = WOOD[L.kind].bark;
    ctx.save();
    ctx.translate(this.cx + L.x * s, this.by + L.y * s - (1 - d) * 260 * s);
    ctx.rotate(L.a + (1 - d) * 0.5 * (L.a < 0 ? -1 : 1));
    ctx.globalAlpha = 1 - smooth(0.85, 1, L.burn);
    const g = ctx.createLinearGradient(0, -th / 2, 0, th / 2);
    g.addColorStop(0, rgb(mix(bark[0], [46, 33, 27], char)));
    g.addColorStop(1, rgb(mix(bark[1], [16, 11, 9], char)));
    ctx.fillStyle = g;
    roundRect(ctx, -len / 2, -th / 2, len, th, th / 2);
    ctx.fill();
    // bark grain (birch gets its dark marks instead)
    ctx.strokeStyle = `rgba(0,0,0,${0.22 + 0.2 * char})`;
    ctx.lineWidth = Math.max(0.6, 0.9 * s);
    if (L.kind === 'birch' && char < 0.7) {
      ctx.setLineDash([4 * s, 7 * s]);
      ctx.lineWidth = Math.max(0.8, 1.6 * s);
    }
    for (let i = 0; i < 4; i++) {
      const yy = (-0.3 + i * 0.2) * th;
      ctx.beginPath();
      ctx.moveTo(-len * 0.42, yy);
      ctx.bezierCurveTo(-len * 0.1, yy + th * 0.06, len * 0.15, yy - th * 0.06, len * 0.4, yy);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalCompositeOperation = 'lighter';
    // firelight on the upper edge
    const rim = ctx.createLinearGradient(0, -th / 2, 0, th * 0.1);
    rim.addColorStop(0, `rgba(255,140,60,${0.4 * I * L.ignite})`);
    rim.addColorStop(1, 'rgba(255,140,60,0)');
    ctx.fillStyle = rim;
    roundRect(ctx, -len / 2, -th / 2, len, th, th / 2);
    ctx.fill();
    // glowing cracks in the char
    const glowA = L.ignite * smooth(0.05, 0.45, L.burn + 0.1);
    if (glowA > 0.01) {
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(0.8, 1.7 * s);
      for (const c of L.cracks) {
        const fl = 0.55 + 0.45 * Math.sin(this.t * (2 + c.p) + c.p * 3);
        ctx.strokeStyle = `rgba(255,${(120 + 90 * fl) | 0},40,${glowA * fl})`;
        const x0 = c.u * len;
        const y0 = c.v * th;
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x0 + Math.cos(c.a) * c.l * len, y0 + Math.sin(c.a) * c.l * len * 0.3);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // cut end of the log
    if (char < 0.85) {
      const ex = len / 2 - th * 0.15;
      ctx.fillStyle = rgb(mix([200, 154, 100], [62, 42, 30], char));
      ctx.beginPath();
      ctx.ellipse(ex, 0, th * 0.3, th * 0.47, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = `rgba(110,66,34,${0.7 * (1 - char)})`;
      ctx.lineWidth = Math.max(0.5, 0.8 * s);
      ctx.beginPath();
      ctx.ellipse(ex, 0, th * 0.17, th * 0.27, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  draw(ctx: CanvasRenderingContext2D) {
    const { w, h, s, cx, by, t } = this;
    const I = this.intensity * this.flicker;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, w, h);
    ctx.fillStyle = '#e8ecff';
    for (const st of this.stars) {
      ctx.globalAlpha = 0.12 + 0.35 * (0.5 + 0.5 * Math.sin(t * st.sp + st.p));
      ctx.fillRect(st.x * w, st.y * (this.horizon - 40 * s), st.r, st.r);
    }
    ctx.globalAlpha = 1;
    // light thrown by the fire
    ctx.globalCompositeOperation = 'lighter';
    const R = (260 + 70 * I) * s;
    let g = ctx.createRadialGradient(cx, by - 30 * s, 0, cx, by - 30 * s, R * 1.5);
    g.addColorStop(0, `rgba(255,124,44,${0.34 * I})`);
    g.addColorStop(0.35, `rgba(255,92,30,${0.12 * I})`);
    g.addColorStop(1, 'rgba(255,80,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    // ash bed
    ctx.fillStyle = '#110a07';
    ctx.beginPath();
    ctx.ellipse(cx, by + 8 * s, 112 * s, 30 * s, 0, 0, TAU);
    ctx.fill();
    this.drawStones(ctx, false, I);
    // embers
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(cx, by + 6 * s);
    ctx.scale(1, 0.28);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, 105 * s);
    g.addColorStop(0, `rgba(255,120,36,${0.7 * I})`);
    g.addColorStop(0.55, `rgba(190,50,12,${0.35 * I})`);
    g.addColorStop(1, 'rgba(120,20,4,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 105 * s, 0, TAU);
    ctx.fill();
    ctx.restore();
    for (const e of this.embers) {
      const er = e.r * s;
      ctx.globalAlpha = clamp(0.25 + 0.75 * Math.sin(t * e.sp + e.p), 0, 1) * clamp(I, 0, 1);
      ctx.drawImage(this.ember, cx + e.x * 88 * s - er, by + 8 * s + e.y * 18 * s - er, er * 2, er * 2);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const L of this.logs) this.drawLog(ctx, L, I);
    // flames
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(0.3 * I, 0, 1);
    const cr = 120 * s * (0.7 + 0.4 * I);
    ctx.drawImage(this.flameSprites[1], cx - cr, by - 40 * s - cr * 1.1, cr * 2, cr * 2);
    for (const p of this.flames) {
      const k = p.life / p.max;
      const idx = k < 0.1 ? 0 : k < 0.4 ? 1 : k < 0.72 ? 2 : 3;
      const sz = p.size * (1.1 - 0.7 * k);
      ctx.globalAlpha = Math.pow(1 - k, 1.1) * 0.55 * smooth(0, 0.08, k);
      ctx.drawImage(this.flameSprites[idx], p.x - sz * 0.85, p.y - sz * 1.5, sz * 1.7, sz * 2.8);
    }
    for (const p of this.sparks) {
      const k = p.life / p.max;
      ctx.globalAlpha = (1 - k) * (0.55 + 0.45 * Math.sin(t * 22 + p.seed * 5));
      ctx.fillStyle = k < 0.35 ? '#ffe7b0' : '#ff9a4c';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 - 0.5 * k), 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.drawStones(ctx, true, I);
    for (const p of this.smoke) {
      const k = p.life / p.max;
      ctx.globalAlpha = 0.07 * Math.sin(k * Math.PI);
      ctx.drawImage(this.smokeSprite, p.x - p.r, p.y - p.r, p.r * 2, p.r * 2);
    }
    ctx.globalAlpha = 1;
    ctx.drawImage(this.vig, 0, 0, w, h);
  }
}
