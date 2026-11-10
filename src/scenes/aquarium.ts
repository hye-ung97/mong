import { Scene } from './base';
import { TAU, clamp, glow, layer, pick, rand, vignette } from './util';

type FishKind = 'neon' | 'gold' | 'pearl';
const FISH: Record<FishKind, { len: number; h: number; body: [string, string]; belly: string; fin: string; speed: number }> = {
  neon: { len: 24, h: 0.34, body: ['#d5e0ea', '#7f93a8'], belly: '#e8eef3', fin: 'rgba(220,235,245,0.35)', speed: 52 },
  gold: { len: 44, h: 0.5, body: ['#ffab45', '#ff6f24'], belly: '#ffd89c', fin: 'rgba(255,140,60,0.55)', speed: 38 },
  pearl: { len: 54, h: 0.5, body: ['#e9e3c9', '#a9a68e'], belly: '#f6f1df', fin: 'rgba(240,232,205,0.35)', speed: 30 },
};

interface Point { x: number; y: number }
interface Fish {
  kind: FishKind; x: number; y: number; vx: number; vy: number; dir: number; phase: number;
  size: number; depth: number; target: Point; ox: number; oy: number;
}
interface Food { x: number; y: number; vy: number; p: number; age: number; settled: boolean; eaten: boolean }
interface Bubble { x: number; y: number; r: number; vy: number; p: number }
interface Tap { x: number; y: number; age: number }
interface Plant { x: number; base: number; h: number; bw: number; color: string; p: number; sp: number; front: boolean }
interface Ray { x: number; w: number; p: number; a: number }

/** 물멍 · 어항: fish swim about; tap the water to drop food and they gather. */
export class Aquarium extends Scene {
  private sandY = 0;
  private box = { l: 0, r: 0, t: 0, b: 0 };
  private sandAt: (x: number) => number = () => 0;
  private fish: Fish[] = [];
  private food: Food[] = [];
  private bubbles: Bubble[] = [];
  private taps: Tap[] = [];
  private plants: Plant[] = [];
  private rays: Ray[] = [];
  private stone: Point = { x: 0, y: 0 };
  private school: Point = { x: 0, y: 0 };
  private schoolT: Point = { x: 0, y: 0 };
  private bubbleAcc = 0;
  private statTimer = 0;
  private readonly caustic = glow(170, 255, 235, 0.4);
  private bg!: HTMLCanvasElement;
  private vig!: HTMLCanvasElement;

  private randPoint(): Point {
    const b = this.box;
    const s = this.s;
    return { x: rand(b.l + 30 * s, b.r - 30 * s), y: rand(b.t + 20 * s, b.b - 20 * s) };
  }

  layout() {
    const { w, h } = this;
    const scale = this.variant === 'card' && w / h > 1.4 ? 1.3 : 1;
    const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.45, 1.25) * scale);
    const sy = (this.sandY = h - Math.min(96 * s, h * 0.2));
    this.box = { l: 24 * s, r: w - 24 * s, t: Math.max(44 * s, h * 0.1), b: sy - 24 * s };
    const sandAt = (this.sandAt = (x: number) => sy + Math.sin(x * 0.012) * 7 * s + Math.sin(x * 0.031 + 1) * 4 * s);
    this.bg = layer(w, h, this.dpr, (x) => {
      let g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#1f8597');
      g.addColorStop(0.3, '#105468');
      g.addColorStop(0.7, '#0a3546');
      g.addColorStop(1, '#06222c');
      x.fillStyle = g;
      x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(6,52,58,0.55)';
      for (let i = 0; i < Math.round(w / 50); i++) {
        x.beginPath();
        x.ellipse(rand(0, w), sy, rand(14, 34) * s, rand(60, 200) * s, 0, Math.PI, TAU);
        x.fill();
      }
      x.beginPath();
      x.moveTo(0, h);
      for (let px = 0; px <= w + 10; px += 10) x.lineTo(px, sandAt(px));
      x.lineTo(w + 10, h);
      x.closePath();
      g = x.createLinearGradient(0, sy - 10 * s, 0, h);
      g.addColorStop(0, '#8f9a7e');
      g.addColorStop(0.4, '#5d6a58');
      g.addColorStop(1, '#2c3832');
      x.fillStyle = g;
      x.fill();
      for (let i = 0; i < Math.round(w / 5); i++) {
        const px = rand(0, w);
        const py = sandAt(px) + rand(4, h - sy);
        x.fillStyle = pick(['#6f7768', '#8a8a74', '#4f5a52', '#9a957c']);
        x.beginPath();
        x.ellipse(px, py, rand(1.5, 4) * s, rand(1, 2.6) * s, 0, 0, TAU);
        x.fill();
      }
      for (const [fx, k] of [[0.18, 1], [0.72, 0.8]]) {
        const rx = w * fx;
        const ry = sandAt(rx) + 6 * s;
        const rw = 80 * s * k;
        const rh = 56 * s * k;
        g = x.createLinearGradient(0, ry - rh, 0, ry);
        g.addColorStop(0, '#3d5f5e');
        g.addColorStop(1, '#14272a');
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(rx - rw, ry);
        x.bezierCurveTo(rx - rw * 0.9, ry - rh * 0.8, rx - rw * 0.3, ry - rh * 1.1, rx + rw * 0.1, ry - rh);
        x.bezierCurveTo(rx + rw * 0.6, ry - rh * 0.95, rx + rw * 0.95, ry - rh * 0.5, rx + rw, ry);
        x.closePath();
        x.fill();
      }
      x.fillStyle = 'rgba(8,60,80,0.25)';
      x.fillRect(0, sy - 20 * s, w, h);
    });
    this.plants = [];
    const clusters = Math.round(3 + w / 130);
    for (let i = 0; i < clusters; i++) {
      const edge = Math.random() < 0.65;
      const cx = edge ? (Math.random() < 0.5 ? rand(0, 0.22) : rand(0.78, 1)) * w : rand(0.1, 0.9) * w;
      const blades = 3 + Math.floor(Math.random() * 3);
      const color = pick(['#2f8c63', '#3aa275', '#24785a', '#4bb07b', '#2a6e4f']);
      const front = Math.random() < 0.3;
      for (let b = 0; b < blades; b++) {
        const px = cx + rand(-12, 12) * s;
        this.plants.push({
          x: px, base: sandAt(px) + 4 * s, h: Math.min(rand(110, 320) * s, (sy - this.box.t) * 0.85),
          bw: rand(7, 14) * s, color, p: rand(0, TAU), sp: rand(0.5, 0.9), front,
        });
      }
    }
    this.rays = Array.from({ length: 5 }, () => ({ x: rand(0, w), w: rand(30, 90) * s, p: rand(0, TAU), a: rand(0.5, 1) }));
    this.stone = { x: w * 0.84, y: sandAt(w * 0.84) + 2 * s };
    if (!this.fish.length) this.spawnFish();
    else {
      for (const f of this.fish) {
        f.x = clamp(f.x, this.box.l, this.box.r);
        f.y = clamp(f.y, this.box.t, this.box.b);
        f.target = this.randPoint();
      }
    }
    this.school = { x: w * 0.5, y: (this.box.t + this.box.b) / 2 };
    this.schoolT = this.randPoint();
    this.food = [];
    this.vig = vignette(w, h, this.dpr, 0.45);
  }

  private spawnFish() {
    const add = (kind: FishKind, extra: Partial<Fish> = {}) => {
      const p = this.randPoint();
      this.fish.push({
        kind, x: p.x, y: p.y, vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1, phase: rand(0, TAU),
        size: rand(0.9, 1.1), depth: rand(0.65, 1), target: this.randPoint(), ox: 0, oy: 0, ...extra,
      });
    };
    for (let i = 0; i < 7; i++) add('neon', { ox: rand(-55, 55), oy: rand(-28, 28), depth: rand(0.75, 1) });
    add('gold', { depth: 1 });
    add('gold', { depth: 0.8 });
    add('pearl', { depth: 0.9 });
    this.fish.sort((a, b) => a.depth - b.depth);
  }

  get fishCount() {
    return this.fish.length;
  }

  /** Drop a pinch of food. Without a point, it lands somewhere near the middle. */
  feed(x?: number, y?: number) {
    const s = this.s;
    const px = x ?? rand(0.3, 0.7) * this.w;
    const py = clamp(y ?? this.box.t + 30 * s, this.box.t, this.box.b - 40 * s);
    this.taps.push({ x: px, y: py, age: 0 });
    for (let i = 0; i < 7; i++) {
      this.food.push({ x: px + rand(-16, 16) * s, y: py + rand(-8, 8) * s, vy: rand(16, 28) * s, p: rand(0, TAU), age: 0, settled: false, eaten: false });
    }
    this.emit('feed', { x: px / this.w });
  }

  tap(x: number, y: number) {
    this.feed(x, y);
  }

  step(dt: number) {
    const s = this.s;
    this.t += dt;
    const t = this.t;
    const sc = this.school;
    const st = this.schoolT;
    const sdx = st.x - sc.x;
    const sdy = st.y - sc.y;
    const sd = Math.hypot(sdx, sdy);
    if (sd < 20 * s) this.schoolT = this.randPoint();
    else {
      sc.x += (sdx / sd) * 34 * s * dt;
      sc.y += (sdy / sd) * 20 * s * dt;
    }
    const food = this.food.filter((p) => !p.eaten);
    for (const f of this.fish) {
      const spec = FISH[f.kind];
      let tx: number;
      let ty: number;
      let speed = spec.speed * s;
      let best: Food | null = null;
      let bd = 260 * s;
      for (const p of food) {
        const dd = Math.hypot(p.x - f.x, p.y - f.y);
        if (dd < bd) {
          bd = dd;
          best = p;
        }
      }
      if (best) {
        tx = best.x;
        ty = best.y;
        speed *= 2.2;
      } else if (f.kind === 'neon') {
        tx = sc.x + f.ox * s;
        ty = sc.y + f.oy * s;
        speed *= 1.2;
      } else {
        if (Math.hypot(f.target.x - f.x, f.target.y - f.y) < 26 * s) f.target = this.randPoint();
        tx = f.target.x;
        ty = f.target.y;
      }
      const dx = tx - f.x;
      const dy = ty - f.y;
      const dist = Math.hypot(dx, dy) || 1;
      const ease = f.kind === 'neon' && !best ? clamp(dist / (40 * s), 0.15, 1) : 1;
      const k = Math.min(1, dt * (best ? 2.6 : 1.1));
      f.vx += ((dx / dist) * speed * ease - f.vx) * k;
      f.vy += ((dy / dist) * speed * 0.55 * ease - f.vy) * k;
      f.x = clamp(f.x + f.vx * dt, this.box.l, this.box.r);
      f.y = clamp(f.y + f.vy * dt, this.box.t, this.box.b);
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
      if (p.settled) continue;
      p.y += p.vy * dt;
      p.x += Math.sin(t * 2 + p.p) * 10 * s * dt;
      const floor = this.sandAt(p.x) - 2 * s;
      if (p.y >= floor) {
        p.y = floor;
        p.settled = true;
      }
    }
    this.food = this.food.filter((p) => !p.eaten && p.age < 22);
    this.bubbleAcc += dt * 5 * this.motion;
    while (this.bubbleAcc >= 1) {
      this.bubbleAcc -= 1;
      this.bubbles.push({ x: this.stone.x + rand(-4, 4) * s, y: this.stone.y, r: rand(1.4, 3.6) * s, vy: -rand(40, 70) * s, p: rand(0, TAU) });
    }
    for (const b of this.bubbles) {
      b.vy -= 12 * s * dt;
      b.y += b.vy * dt;
      b.x += Math.sin(t * 5 + b.p) * 14 * s * dt;
      b.r *= 1 + 0.05 * dt;
    }
    this.bubbles = this.bubbles.filter((b) => b.y > 8 * s);
    for (const tp of this.taps) tp.age += dt;
    this.taps = this.taps.filter((tp) => tp.age < 0.9);
    this.statTimer -= dt;
    if (this.statTimer <= 0) {
      this.statTimer = 0.5;
      this.stat('fish', this.fish.length);
      this.stat('food', this.food.length);
    }
  }

  private drawPlant(ctx: CanvasRenderingContext2D, p: Plant) {
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
    } else if (f.kind === 'pearl') {
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
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

  draw(ctx: CanvasRenderingContext2D) {
    const { w, s, t } = this;
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.bg, 0, 0, w, this.h);
    ctx.globalCompositeOperation = 'lighter';
    for (const r of this.rays) {
      const sway = Math.sin(t * 0.22 + r.p) * 36 * s;
      const a = (0.05 + 0.035 * Math.sin(t * 0.55 + r.p * 2)) * r.a;
      const g = ctx.createLinearGradient(0, 0, 0, this.sandY);
      g.addColorStop(0, `rgba(180,245,255,${a})`);
      g.addColorStop(1, 'rgba(180,245,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(r.x - r.w / 2, 0);
      ctx.lineTo(r.x + r.w / 2, 0);
      ctx.lineTo(r.x + r.w * 1.3 + sway + 50 * s, this.sandY);
      ctx.lineTo(r.x - r.w * 0.3 + sway + 50 * s, this.sandY);
      ctx.closePath();
      ctx.fill();
    }
    const n = Math.round(w / (30 * s));
    for (let i = 0; i < n; i++) {
      const cx = (i / n) * w + Math.sin(t * 0.5 + i * 1.3) * 18 * s;
      const cy = this.sandAt(cx) + (8 + 6 * Math.sin(i * 2.1)) * s;
      ctx.globalAlpha = 0.08 + 0.06 * Math.sin(t * 1.4 + i * 2.3);
      ctx.drawImage(this.caustic, cx - 26 * s, cy - 6 * s, 52 * s, 12 * s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    for (const p of this.plants) if (!p.front) this.drawPlant(ctx, p);
    for (const f of this.fish) this.drawFish(ctx, f);
    for (const p of this.plants) if (p.front) this.drawPlant(ctx, p);
    ctx.fillStyle = '#d98a42';
    for (const p of this.food) {
      ctx.globalAlpha = p.settled ? clamp((22 - p.age) / 4, 0, 1) : 1;
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
    ctx.globalCompositeOperation = 'lighter';
    const sg = ctx.createLinearGradient(0, 0, 0, 40 * s);
    sg.addColorStop(0, 'rgba(200,250,255,0.22)');
    sg.addColorStop(1, 'rgba(200,250,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, 40 * s);
    ctx.strokeStyle = 'rgba(220,255,255,0.18)';
    ctx.lineWidth = 1.2 * s;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = 10 * s + Math.sin(x * 0.03 + t * 1.6) * 2.5 * s + Math.sin(x * 0.011 - t) * 2 * s;
      if (x) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    for (const tp of this.taps) {
      const k = tp.age / 0.9;
      ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`;
      ctx.lineWidth = 2 * s;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, (10 + 46 * k) * s, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,255,255,${0.28 * (1 - k)})`;
      ctx.beginPath();
      ctx.arc(tp.x, tp.y, 18 * s, 0, TAU);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this.vig, 0, 0, w, this.h);
  }
}
