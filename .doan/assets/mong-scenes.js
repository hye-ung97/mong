/* mong — live scene renderers for the Doan design board.
   Prototype-quality Canvas 2D scenes:
     fire     불멍 (campfire with burning logs)
     rain     비멍 (rain on a window, blurred city lights)
     aquarium 물멍 A안 (fish tank)
     sea      물멍 B안 (night sea waves)
     pond     물멍 C안 (sparkling pond surface)
   Each <canvas data-scene="..."> mounts one scene. Buttons with data-action
   inside the same .screen talk to that screen's scene. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const easeOutBounce = (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  };

  /* ---------- shared sprites & helpers ---------- */
  const sprites = new Map();
  function sprite(key, paint) {
    if (sprites.has(key)) return sprites.get(key);
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    paint(c.getContext('2d'), S);
    sprites.set(key, c);
    return c;
  }
  const glow = (r, g, b, mid = 0.45) => sprite(`g${r},${g},${b},${mid}`, (x, S) => {
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(mid, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
  });
  const disc = (r, g, b) => sprite(`d${r},${g},${b}`, (x, S) => {
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(0.76, `rgba(${r},${g},${b},0.42)`);
    gr.addColorStop(0.9, `rgba(${r},${g},${b},0.62)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
  });

  function layer(w, h, dpr, paint) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    paint(x);
    return c;
  }
  function vignette(w, h, dpr, strength) {
    return layer(w, h, dpr, (x) => {
      const g = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${strength})`);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    });
  }
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  /* a water droplet on glass */
  function drawDrop(ctx, x, y, r, a) {
    ctx.globalAlpha = a;
    if (r < 2.2) {
      ctx.fillStyle = 'rgba(190,210,240,0.32)';
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
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
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 1.18, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.beginPath(); ctx.ellipse(x + r * 0.08, y + r * 0.4, r * 0.78, r * 0.62, 0, 0, Math.PI); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath(); ctx.arc(x - r * 0.34, y - r * 0.46, Math.max(0.7, r * 0.22), 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }

  /* ---------- base ---------- */
  class Scene {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.screen = canvas.closest('.screen');
      this.d = canvas.dataset;
      this.t = 0; this.w = 0; this.h = 0; this.dpr = 1; this.statTimer = 0;
    }
    num(key, fallback) {
      const v = parseFloat(this.d[key]);
      return Number.isFinite(v) ? v : fallback;
    }
    resize(w, h, dpr) { this.w = w; this.h = h; this.dpr = dpr; this.layout(); }
    layout() {}
    step() {}
    draw() {}
    tap() {}
    action() {}
    stat(key, value) {
      if (!this.screen) return;
      this.screen.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => {
        if (el.dataset.statMode === 'width') el.style.width = `${Math.round(clamp(value, 0, 1) * 100)}%`;
        else el.textContent = value;
      });
    }
  }

  /* ---------- 불멍 : campfire ---------- */
  class Fire extends Scene {
    constructor(c) {
      super(c);
      this.fx = this.num('fx', 0.5);
      this.fy = this.num('fy', 0.66);
      this.autoAdd = this.num('autoAdd', 0);
      this.autoTimer = this.autoAdd ? this.autoAdd * 0.35 : 0;
      this.flames = []; this.sparks = []; this.smoke = []; this.logs = [];
      this.flare = 0; this.cool = 0; this.added = 0; this.intensity = 0.6; this.flicker = 1;
      this.acc = { flame: 0, spark: 0, smoke: 0 };
      this.sprites = [glow(255, 246, 214, 0.3), glow(255, 186, 80), glow(255, 106, 36), glow(176, 46, 14)];
      this.ember = glow(255, 132, 48, 0.25);
      this.smokeSprite = glow(120, 116, 112, 0.5);
      this.stars = Array.from({ length: 80 }, () => ({ x: Math.random(), y: Math.random(), r: rand(0.5, 1.5), p: rand(0, TAU), sp: rand(0.5, 2) }));
      this.embers = Array.from({ length: 30 }, () => ({ x: rand(-1, 1), y: rand(-1, 1), r: rand(3, 9), p: rand(0, TAU), sp: rand(1, 3.5) }));
      [[-36, -12, -0.44, 152, 26, 0.3], [36, -12, 0.44, 152, 26, 0.22], [0, 4, 0.05, 178, 28, 0.12]]
        .forEach(([x, y, a, len, th, burn]) => this.logs.push(this.makeLog({ x, y, a, len, th, burn, ignite: 1, drop: 1 })));
    }
    makeLog(o) {
      return Object.assign({
        burn: 0, ignite: 0, drop: 0, life: rand(85, 125), fast: false,
        cracks: Array.from({ length: 10 }, () => ({ u: rand(-0.42, 0.34), v: rand(-0.3, 0.32), l: rand(0.04, 0.12), a: rand(-0.6, 0.6), p: rand(0, TAU) })),
      }, o);
    }
    layout() {
      const { w, h } = this;
      const s = this.s = clamp(Math.min(w / 390, h / 420), 0.3, 2) * this.num('scale', 1);
      this.cx = w * this.fx;
      this.by = h * this.fy;
      const hz = this.horizon = Math.max(h * 0.14, this.by - 200 * s);
      this.stones = Array.from({ length: 14 }, (_, i) => {
        const a = (i / 14) * TAU + rand(-0.07, 0.07);
        return { a, w: rand(30, 46), h: rand(18, 27), tone: rand(0.75, 1.15), front: Math.sin(a) > 0.05 };
      });
      this.bg = layer(w, h, this.dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, hz);
        g.addColorStop(0, '#030409'); g.addColorStop(1, '#0e101b');
        x.fillStyle = g; x.fillRect(0, 0, w, hz + 1);
        g = x.createLinearGradient(0, hz, 0, h);
        g.addColorStop(0, '#0b0907'); g.addColorStop(1, '#17100b');
        x.fillStyle = g; x.fillRect(0, hz, w, h - hz);
        // distant ridge
        x.fillStyle = '#08090e';
        x.beginPath(); x.moveTo(0, hz + 2);
        for (let px = 0; px <= w + 20; px += 20) x.lineTo(px, hz - (16 + 10 * Math.sin(px * 0.008) + 6 * Math.sin(px * 0.021 + 1)) * s);
        x.lineTo(w + 20, hz + 2); x.closePath(); x.fill();
        // pine silhouettes
        x.fillStyle = '#030406';
        for (let tx = -10; tx < w + 20;) {
          const near = Math.abs(tx - this.cx) < 150 * s;
          const th = rand(40, 125) * s * (near ? 0.5 : 1), tw = th * rand(0.32, 0.42);
          for (let k = 0; k < 3; k++) {
            const bottom = hz + 3 - th * 0.3 * k, top = bottom - th * (k === 2 ? 0.4 : 0.55), half = (tw / 2) * (1 - 0.26 * k);
            x.beginPath(); x.moveTo(tx - half, bottom); x.lineTo(tx, top); x.lineTo(tx + half, bottom); x.closePath(); x.fill();
          }
          tx += tw * rand(0.45, 0.95);
        }
      });
      this.vig = vignette(w, h, this.dpr, 0.6);
    }
    addLog() {
      if (this.logs.length >= 5) {
        const old = this.logs.reduce((a, b) => (a.burn > b.burn ? a : b));
        old.fast = true;
      }
      this.added += 1;
      const side = this.added % 2 ? 1 : -1;
      this.logs.push(this.makeLog({ x: rand(-24, 24), y: rand(-20, -8), a: side * rand(0.16, 0.55), len: rand(138, 170), th: rand(22, 29) }));
      this.cool = 4;
    }
    land() {
      for (let i = 0; i < 34; i++) this.spawnSpark(true);
      this.flare = 1;
    }
    tap() { this.addLog(); }
    action(name) { if (name === 'add-log') this.addLog(); }
    spawnFlame(burning) {
      const s = this.s;
      let x = this.cx + rand(-30, 30) * s, y = this.by - rand(2, 14) * s, power = 0.7;
      if (burning.length && Math.random() < 0.8) {
        const L = pick(burning);
        const u = rand(-0.36, 0.36) * L.len * s;
        x = this.cx + L.x * s + Math.cos(L.a) * u;
        y = this.by + L.y * s + Math.sin(L.a) * u - L.th * s * 0.35;
        power = L.ignite * (1 - 0.6 * smooth(0.5, 1, L.burn));
      }
      const I = this.intensity;
      this.flames.push({
        x, y,
        vx: rand(-14, 14) * s,
        vy: -rand(40, 100) * s,
        life: 0,
        max: rand(0.55, 1.1) * (0.75 + 0.45 * I) * (0.6 + 0.4 * power),
        size: rand(14, 28) * s * (0.55 + 0.5 * I) * (0.5 + 0.5 * power),
        seed: rand(0, TAU),
      });
    }
    spawnSpark(burst) {
      const s = this.s;
      this.sparks.push({
        x: this.cx + rand(-45, 45) * s,
        y: this.by - rand(burst ? 0 : 20, burst ? 30 : 90) * s,
        vx: rand(-30, 30) * s * (burst ? 2.2 : 1),
        vy: -rand(70, 170) * s * (burst ? 1.3 : 1),
        life: 0, max: rand(0.8, 2.4),
        r: rand(0.7, 1.6) * Math.max(0.8, s),
        seed: rand(0, TAU),
      });
    }
    step(dt) {
      const s = this.s;
      this.t += dt;
      const t = this.t;
      if (this.autoAdd) {
        this.autoTimer -= dt;
        if (this.autoTimer <= 0) { this.addLog(); this.autoTimer = this.autoAdd; }
      }
      let fuel = 0;
      for (const L of this.logs) {
        if (L.drop < 1) {
          L.drop = Math.min(1, L.drop + dt / 0.7);
          if (L.drop === 1) this.land(L);
          continue;
        }
        L.ignite = Math.min(1, L.ignite + dt / 3);
        L.burn += (dt / L.life) * (0.35 + 0.65 * L.ignite) * (L.fast ? 7 : 1);
        fuel += L.ignite * (1 - smooth(0.7, 1, L.burn)) * (L.len / 160);
      }
      this.logs = this.logs.filter((L) => L.burn < 1);
      this.cool -= dt;
      if (!this.autoAdd && this.cool <= 0 && (this.logs.length < 3 || fuel < 1.5)) this.addLog();
      this.flare = Math.max(0, this.flare - dt / 2.8);
      this.flicker = 0.86 + 0.07 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 13.1 + 1.3) + 0.03 * Math.sin(t * 23.7 + 2.1);
      this.intensity = clamp(fuel / 3.6 + this.flare * 0.22, 0.1, 1.25);

      const burning = this.logs.filter((L) => L.drop >= 1 && L.ignite > 0.05 && L.burn < 0.97);
      this.acc.flame += dt * (30 + 160 * this.intensity);
      while (this.acc.flame >= 1) { this.acc.flame -= 1; this.spawnFlame(burning); }
      this.acc.spark += dt * (1 + 5 * this.intensity);
      while (this.acc.spark >= 1) { this.acc.spark -= 1; this.spawnSpark(false); }
      this.acc.smoke += dt * 3;
      while (this.acc.smoke >= 1) {
        this.acc.smoke -= 1;
        this.smoke.push({ x: this.cx + rand(-20, 20) * s, y: this.by - (120 + 90 * this.intensity) * s, vx: rand(-6, 6) * s, vy: -rand(18, 30) * s, life: 0, max: rand(4, 7), r: rand(18, 30) * s });
      }

      const cx = this.cx;
      for (const p of this.flames) {
        p.life += dt;
        const k = p.life / p.max;
        p.vy -= 150 * s * dt;
        p.x += (p.vx + (cx - p.x) * 1.6 * k + Math.sin(t * 4.2 + p.y * 0.035 / s + p.seed * 0.3) * 26 * s * k) * dt;
        p.y += p.vy * dt;
      }
      this.flames = this.flames.filter((p) => p.life < p.max);
      for (const p of this.sparks) {
        p.life += dt;
        p.vx += Math.sin(t * 3 + p.seed) * 50 * s * dt;
        p.vy += 18 * s * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
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
        this.stat('intensity', this.intensity / 1.2);
        this.stat('logs', this.logs.filter((L) => L.drop >= 1).length);
      }
    }
    drawStones(ctx, front, I) {
      const { s, cx, by } = this;
      const rx = 132 * s, ry = 38 * s, cy = by + 10 * s;
      const list = this.stones.filter((st) => st.front === front).sort((a, b) => Math.sin(a.a) - Math.sin(b.a));
      for (const st of list) {
        const x = cx + Math.cos(st.a) * rx, y = cy + Math.sin(st.a) * ry;
        const sw = st.w * s, sh = st.h * s;
        const lit = clamp((front ? 0.3 : 0.85) * I * 0.6, 0, 1);
        const g = ctx.createLinearGradient(0, y - sh / 2, 0, y + sh / 2);
        g.addColorStop(0, rgb(mix([40 * st.tone, 36 * st.tone, 34 * st.tone], [196, 98, 46], lit)));
        g.addColorStop(1, 'rgb(14,12,11)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.ellipse(x, y, sw / 2, sh / 2, 0, 0, TAU); ctx.fill();
      }
    }
    drawLog(ctx, L, I) {
      const s = this.s;
      const d = L.drop < 1 ? easeOutBounce(L.drop) : 1;
      const len = L.len * s * (1 - 0.3 * smooth(0.55, 1, L.burn));
      const th = L.th * s * (1 - 0.35 * smooth(0.5, 1, L.burn));
      const char = clamp(L.burn * 1.6 + L.ignite * 0.25, 0, 1);
      ctx.save();
      ctx.translate(this.cx + L.x * s, this.by + L.y * s - (1 - d) * 260 * s);
      ctx.rotate(L.a + (1 - d) * 0.5 * (L.a < 0 ? -1 : 1));
      ctx.globalAlpha = 1 - smooth(0.85, 1, L.burn);
      const g = ctx.createLinearGradient(0, -th / 2, 0, th / 2);
      g.addColorStop(0, rgb(mix([122, 82, 50], [46, 33, 27], char)));
      g.addColorStop(1, rgb(mix([64, 40, 24], [16, 11, 9], char)));
      ctx.fillStyle = g;
      roundRect(ctx, -len / 2, -th / 2, len, th, th / 2);
      ctx.fill();
      // bark grain
      ctx.strokeStyle = `rgba(0,0,0,${0.22 + 0.2 * char})`;
      ctx.lineWidth = Math.max(0.6, 0.9 * s);
      for (let i = 0; i < 4; i++) {
        const yy = (-0.3 + i * 0.2) * th;
        ctx.beginPath();
        ctx.moveTo(-len * 0.42, yy);
        ctx.bezierCurveTo(-len * 0.1, yy + th * 0.06, len * 0.15, yy - th * 0.06, len * 0.4, yy);
        ctx.stroke();
      }
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
          const x0 = c.u * len, y0 = c.v * th;
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
        ctx.beginPath(); ctx.ellipse(ex, 0, th * 0.3, th * 0.47, 0, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(110,66,34,${0.7 * (1 - char)})`;
        ctx.lineWidth = Math.max(0.5, 0.8 * s);
        ctx.beginPath(); ctx.ellipse(ex, 0, th * 0.17, th * 0.27, 0, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
    draw(ctx) {
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
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      // ash bed
      ctx.fillStyle = '#110a07';
      ctx.beginPath(); ctx.ellipse(cx, by + 8 * s, 112 * s, 30 * s, 0, 0, TAU); ctx.fill();
      this.drawStones(ctx, false, I);
      // embers
      ctx.globalCompositeOperation = 'lighter';
      ctx.save();
      ctx.translate(cx, by + 6 * s); ctx.scale(1, 0.28);
      g = ctx.createRadialGradient(0, 0, 0, 0, 0, 105 * s);
      g.addColorStop(0, `rgba(255,120,36,${0.7 * I})`);
      g.addColorStop(0.55, `rgba(190,50,12,${0.35 * I})`);
      g.addColorStop(1, 'rgba(120,20,4,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, 105 * s, 0, TAU); ctx.fill();
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
      ctx.drawImage(this.sprites[1], cx - cr, by - 40 * s - cr * 1.1, cr * 2, cr * 2);
      for (const p of this.flames) {
        const k = p.life / p.max;
        const idx = k < 0.1 ? 0 : k < 0.4 ? 1 : k < 0.72 ? 2 : 3;
        const sz = p.size * (1.1 - 0.7 * k);
        ctx.globalAlpha = Math.pow(1 - k, 1.1) * 0.55 * smooth(0, 0.08, k);
        ctx.drawImage(this.sprites[idx], p.x - sz * 0.85, p.y - sz * 1.5, sz * 1.7, sz * 2.8);
      }
      for (const p of this.sparks) {
        const k = p.life / p.max;
        ctx.globalAlpha = (1 - k) * (0.55 + 0.45 * Math.sin(t * 22 + p.seed * 5));
        ctx.fillStyle = k < 0.35 ? '#ffe7b0' : '#ff9a4c';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - 0.5 * k), 0, TAU); ctx.fill();
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

  /* ---------- 비멍 : rain on a window ---------- */
  class Rain extends Scene {
    constructor(c) {
      super(c);
      this.intensity = this.num('intensity', 0.6);
      this.thunder = this.d.thunder === 'on';
      this.flash = 0; this.flashT = -1; this.nextFlash = rand(4, 9);
      this.sliders = []; this.trail = []; this.slideAcc = 0;
    }
    newStreak(initial) {
      const { w, h, s } = this;
      return { x: rand(-0.15, 1.05) * w, y: initial ? rand(-0.1, 1) * h : rand(-0.25, -0.02) * h, len: rand(16, 38) * s, v: rand(650, 1100) * s, a: rand(0.06, 0.24) };
    }
    layout() {
      const { w, h } = this;
      const s = this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.35);
      const colors = [[255, 176, 96], [255, 210, 140], [255, 150, 90], [130, 176, 255], [255, 128, 168], [210, 225, 255], [255, 90, 70]];
      const n = clamp(Math.round((w * h) / 6500), 18, 90);
      this.bokeh = Array.from({ length: n }, () => {
        const c = pick(colors), road = Math.random() < 0.25;
        return {
          x: rand(0, w), y: road ? rand(0.72, 0.86) * h : rand(0.3, 0.95) * h,
          r: rand(12, road ? 30 : 58) * s, img: disc(c[0], c[1], c[2]),
          a: rand(0.14, 0.4), p: rand(0, TAU), vx: road ? pick([-1, 1]) * rand(18, 40) * s : 0,
        };
      });
      this.streaks = Array.from({ length: 360 }, () => this.newStreak(true));
      this.bg = layer(w, h, this.dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#070c17'); g.addColorStop(0.55, '#111b2d'); g.addColorStop(1, '#1b2436');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.filter = `blur(${Math.round(10 * s)}px)`;
        x.fillStyle = 'rgba(3,6,12,0.75)';
        for (let bx = -20; bx < w;) {
          const bw = rand(50, 140) * s, bh = rand(0.25, 0.6) * h;
          x.fillRect(bx, h * 0.92 - bh, bw, bh + 0.1 * h);
          bx += bw + rand(6, 30) * s;
        }
        x.filter = 'none';
        g = x.createRadialGradient(w * 0.5, h * 1.05, 0, w * 0.5, h * 1.05, h * 0.7);
        g.addColorStop(0, 'rgba(255,160,90,0.16)'); g.addColorStop(1, 'rgba(255,160,90,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
      });
      this.glass = layer(w, h, this.dpr, (x) => {
        const count = Math.round((w * h) / 1500);
        for (let i = 0; i < count; i++) drawDrop(x, rand(0, w), rand(0, h), Math.pow(Math.random(), 2.2) * 3.2 * s + 0.6, 0.9);
      });
      this.vig = vignette(w, h, this.dpr, 0.5);
    }
    step(dt) {
      const { w, h, s } = this;
      const I = this.intensity;
      this.t += dt;
      const active = Math.round(40 + 320 * I);
      for (let i = 0; i < active; i++) {
        const st = this.streaks[i];
        const v = st.v * (0.75 + 0.45 * I);
        st.y += v * dt; st.x += v * 0.16 * dt;
        if (st.y - st.len > h) Object.assign(st, this.newStreak(false));
      }
      for (const b of this.bokeh) {
        if (!b.vx) continue;
        b.x += b.vx * dt;
        if (b.x < -b.r) b.x = w + b.r;
        if (b.x > w + b.r) b.x = -b.r;
      }
      this.slideAcc += dt * (0.3 + 1.8 * I) * (w / 390);
      while (this.slideAcc >= 1) {
        this.slideAcc -= 1;
        if (this.sliders.length < 40) this.sliders.push({ x: rand(0, w), y: rand(-0.05, 0.7) * h, r: rand(3.5, 7.5) * s, v: 0, wait: rand(0.2, 1.6), seed: rand(0, TAU), tr: 0 });
      }
      for (const d of this.sliders) {
        if (d.wait > 0) { d.wait -= dt; continue; }
        const go = Math.pow(0.5 + 0.5 * Math.sin(this.t * 1.1 + d.seed), 3);
        const target = (12 + 220 * go) * s * (d.r / (5 * s));
        d.v += (target - d.v) * Math.min(1, dt * 3);
        d.y += d.v * dt;
        d.x += Math.sin(this.t * 2.3 + d.seed) * 5 * s * dt;
        d.tr += d.v * dt;
        if (d.tr > 6 * s) {
          d.tr = 0;
          if (Math.random() < 0.7) this.trail.push({ x: d.x + rand(-1, 1) * s, y: d.y - d.r * 0.9, r: d.r * rand(0.2, 0.4), age: 0, max: rand(3, 8) });
        }
      }
      this.sliders = this.sliders.filter((d) => d.y < h + 20);
      for (const p of this.trail) p.age += dt;
      this.trail = this.trail.filter((p) => p.age < p.max);
      if (this.trail.length > 500) this.trail.splice(0, this.trail.length - 500);
      if (this.thunder) {
        this.nextFlash -= dt;
        if (this.nextFlash <= 0) { this.flashT = 0; this.nextFlash = rand(14, 28); }
      }
      if (this.flashT >= 0) {
        this.flashT += dt;
        const ft = this.flashT;
        this.flash = ft < 0.07 ? 1 : ft < 0.15 ? 0.15 : ft < 0.24 ? 0.75 : Math.max(0, 0.75 - (ft - 0.24) * 1.6);
        if (ft > 1) { this.flashT = -1; this.flash = 0; }
      }
    }
    draw(ctx) {
      const { w, h, s, t } = this;
      const I = this.intensity;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.bg, 0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of this.bokeh) {
        ctx.globalAlpha = clamp(b.a * (0.75 + 0.25 * Math.sin(t * 0.6 + b.p)) * (1 + this.flash * 0.6), 0, 1);
        ctx.drawImage(b.img, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2);
      }
      ctx.strokeStyle = 'rgb(190,210,240)';
      ctx.lineWidth = Math.max(0.7, 1.1 * s);
      ctx.lineCap = 'round';
      const active = Math.round(40 + 320 * I);
      for (let bucket = 0; bucket < 3; bucket++) {
        ctx.globalAlpha = (0.08 + bucket * 0.08) * (0.7 + 0.5 * I);
        ctx.beginPath();
        for (let i = bucket; i < active; i += 3) {
          const st = this.streaks[i];
          ctx.moveTo(st.x, st.y);
          ctx.lineTo(st.x - st.len * 0.16, st.y - st.len);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      if (this.flash > 0) {
        ctx.globalAlpha = this.flash * 0.22;
        ctx.fillStyle = '#c8d6ff';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(12,20,34,0.12)';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(this.glass, 0, 0, w, h);
      for (const p of this.trail) drawDrop(ctx, p.x, p.y, p.r, 1 - p.age / p.max);
      for (const d of this.sliders) drawDrop(ctx, d.x, d.y, d.r, 1);
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
    action(name, value) {
      if (name === 'rain') this.intensity = parseFloat(value);
      if (name === 'thunder') {
        this.thunder = !this.thunder;
        if (this.thunder) this.nextFlash = 0.8;
      }
    }
  }

  /* ---------- 물멍 A안 : aquarium ---------- */
  const FISH = {
    neon: { len: 24, h: 0.34, body: ['#d5e0ea', '#7f93a8'], belly: '#e8eef3', fin: 'rgba(220,235,245,0.35)', speed: 52 },
    gold: { len: 44, h: 0.5, body: ['#ffab45', '#ff6f24'], belly: '#ffd89c', fin: 'rgba(255,140,60,0.55)', speed: 38 },
    pearl: { len: 54, h: 0.5, body: ['#e9e3c9', '#a9a68e'], belly: '#f6f1df', fin: 'rgba(240,232,205,0.35)', speed: 30 },
  };
  class Aquarium extends Scene {
    constructor(c) {
      super(c);
      this.autoFeed = this.num('autoFeed', 0);
      this.feedTimer = this.autoFeed ? 1.2 : 0;
      this.food = []; this.bubbles = []; this.taps = []; this.fish = [];
      this.bubbleAcc = 0;
      this.caustic = glow(170, 255, 235, 0.4);
    }
    randPoint() {
      const b = this.box, s = this.s;
      return { x: rand(b.l + 30 * s, b.r - 30 * s), y: rand(b.t + 20 * s, b.b - 20 * s) };
    }
    layout() {
      const { w, h } = this;
      const s = this.s = clamp(Math.sqrt(w * h) / 573, 0.45, 1.25) * this.num('scale', 1);
      const sy = this.sandY = h - Math.min(96 * s, h * 0.2);
      this.box = { l: 24 * s, r: w - 24 * s, t: Math.max(44 * s, h * 0.1), b: sy - 24 * s };
      const sandAt = this.sandAt = (x) => sy + Math.sin(x * 0.012) * 7 * s + Math.sin(x * 0.031 + 1) * 4 * s;
      this.bg = layer(w, h, this.dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#1f8597'); g.addColorStop(0.3, '#105468'); g.addColorStop(0.7, '#0a3546'); g.addColorStop(1, '#06222c');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.fillStyle = 'rgba(6,52,58,0.55)';
        for (let i = 0; i < Math.round(w / 50); i++) {
          x.beginPath(); x.ellipse(rand(0, w), sy, rand(14, 34) * s, rand(60, 200) * s, 0, Math.PI, TAU); x.fill();
        }
        x.beginPath(); x.moveTo(0, h);
        for (let px = 0; px <= w + 10; px += 10) x.lineTo(px, sandAt(px));
        x.lineTo(w + 10, h); x.closePath();
        g = x.createLinearGradient(0, sy - 10 * s, 0, h);
        g.addColorStop(0, '#8f9a7e'); g.addColorStop(0.4, '#5d6a58'); g.addColorStop(1, '#2c3832');
        x.fillStyle = g; x.fill();
        for (let i = 0; i < Math.round(w / 5); i++) {
          const px = rand(0, w), py = sandAt(px) + rand(4, h - sy);
          x.fillStyle = pick(['#6f7768', '#8a8a74', '#4f5a52', '#9a957c']);
          x.beginPath(); x.ellipse(px, py, rand(1.5, 4) * s, rand(1, 2.6) * s, 0, 0, TAU); x.fill();
        }
        [[0.18, 1], [0.72, 0.8]].forEach(([fx, k]) => {
          const rx = w * fx, ry = sandAt(rx) + 6 * s, rw = 80 * s * k, rh = 56 * s * k;
          g = x.createLinearGradient(0, ry - rh, 0, ry);
          g.addColorStop(0, '#3d5f5e'); g.addColorStop(1, '#14272a');
          x.fillStyle = g;
          x.beginPath(); x.moveTo(rx - rw, ry);
          x.bezierCurveTo(rx - rw * 0.9, ry - rh * 0.8, rx - rw * 0.3, ry - rh * 1.1, rx + rw * 0.1, ry - rh);
          x.bezierCurveTo(rx + rw * 0.6, ry - rh * 0.95, rx + rw * 0.95, ry - rh * 0.5, rx + rw, ry);
          x.closePath(); x.fill();
        });
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
          this.plants.push({ x: px, base: sandAt(px) + 4 * s, h: Math.min(rand(110, 320) * s, (sy - this.box.t) * 0.85), bw: rand(7, 14) * s, color, p: rand(0, TAU), sp: rand(0.5, 0.9), front });
        }
      }
      this.rays = Array.from({ length: 5 }, () => ({ x: rand(0, w), w: rand(30, 90) * s, p: rand(0, TAU), a: rand(0.5, 1) }));
      this.stone = { x: w * 0.84, y: sandAt(w * 0.84) + 2 * s };
      if (!this.fish.length) this.spawnFish();
      else this.fish.forEach((f) => { f.x = clamp(f.x, this.box.l, this.box.r); f.y = clamp(f.y, this.box.t, this.box.b); f.target = this.randPoint(); });
      this.school = { x: w * 0.5, y: (this.box.t + this.box.b) / 2 };
      this.schoolT = this.randPoint();
      this.vig = vignette(w, h, this.dpr, 0.45);
    }
    spawnFish() {
      const add = (kind, extra) => {
        const p = this.randPoint();
        this.fish.push(Object.assign({ kind, x: p.x, y: p.y, vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1, phase: rand(0, TAU), size: rand(0.9, 1.1), depth: rand(0.65, 1), target: this.randPoint() }, extra));
      };
      for (let i = 0; i < 7; i++) add('neon', { ox: rand(-55, 55), oy: rand(-28, 28), depth: rand(0.75, 1) });
      add('gold', { depth: 1 });
      add('gold', { depth: 0.8 });
      add('pearl', { depth: 0.9 });
      this.fish.sort((a, b) => a.depth - b.depth);
    }
    tap(x, y) {
      const s = this.s;
      const yy = clamp(y, this.box.t, this.box.b - 40 * s);
      this.taps.push({ x, y: yy, age: 0 });
      for (let i = 0; i < 7; i++) this.food.push({ x: x + rand(-16, 16) * s, y: yy + rand(-8, 8) * s, vy: rand(16, 28) * s, p: rand(0, TAU), age: 0, settled: false, eaten: false });
    }
    action(name) {
      if (name === 'feed') this.tap(rand(0.3, 0.7) * this.w, this.box.t + 30 * this.s);
    }
    step(dt) {
      const s = this.s;
      this.t += dt;
      const t = this.t;
      if (this.autoFeed) {
        this.feedTimer -= dt;
        if (this.feedTimer <= 0) { this.feedTimer = this.autoFeed; this.tap(rand(0.3, 0.7) * this.w, rand(0.18, 0.3) * this.h); }
      }
      const sc = this.school, st = this.schoolT;
      const sdx = st.x - sc.x, sdy = st.y - sc.y, sd = Math.hypot(sdx, sdy);
      if (sd < 20 * s) this.schoolT = this.randPoint();
      else { sc.x += (sdx / sd) * 34 * s * dt; sc.y += (sdy / sd) * 20 * s * dt; }
      const food = this.food.filter((p) => !p.eaten);
      for (const f of this.fish) {
        const spec = FISH[f.kind];
        let tx, ty, speed = spec.speed * s, best = null, bd = 260 * s;
        for (const p of food) {
          const dd = Math.hypot(p.x - f.x, p.y - f.y);
          if (dd < bd) { bd = dd; best = p; }
        }
        if (best) { tx = best.x; ty = best.y; speed *= 2.2; }
        else if (f.kind === 'neon') { tx = sc.x + f.ox * s; ty = sc.y + f.oy * s; speed *= 1.2; }
        else {
          if (Math.hypot(f.target.x - f.x, f.target.y - f.y) < 26 * s) f.target = this.randPoint();
          tx = f.target.x; ty = f.target.y;
        }
        const dx = tx - f.x, dy = ty - f.y, dist = Math.hypot(dx, dy) || 1;
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
        }
      }
      for (const p of this.food) {
        p.age += dt;
        if (p.settled) continue;
        p.y += p.vy * dt;
        p.x += Math.sin(t * 2 + p.p) * 10 * s * dt;
        const floor = this.sandAt(p.x) - 2 * s;
        if (p.y >= floor) { p.y = floor; p.settled = true; }
      }
      this.food = this.food.filter((p) => !p.eaten && p.age < 22);
      this.bubbleAcc += dt * 5;
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
      if (this.statTimer <= 0) { this.statTimer = 0.5; this.stat('fish', this.fish.length); }
    }
    drawPlant(ctx, p) {
      const s = this.s, t = this.t, segs = 10, pts = [];
      for (let i = 0; i <= segs; i++) {
        const k = i / segs;
        const sway = (Math.sin(t * p.sp + p.p + k * 2.4) * 22 * k * k + Math.sin(t * 0.33 + p.p) * 8 * k) * s;
        pts.push([p.x + sway, p.base - k * p.h]);
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) {
        const half = (p.bw * (1 - (i / segs) * 0.9)) / 2;
        if (i) ctx.lineTo(pts[i][0] - half, pts[i][1]); else ctx.moveTo(pts[i][0] - half, pts[i][1]);
      }
      for (let i = segs; i >= 0; i--) {
        const half = (p.bw * (1 - (i / segs) * 0.9)) / 2;
        ctx.lineTo(pts[i][0] + half, pts[i][1]);
      }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(190,255,210,0.16)';
      ctx.lineWidth = Math.max(0.6, 0.9 * s);
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    drawFish(ctx, f) {
      const spec = FISH[f.kind], s = this.s;
      const L = spec.len * s * f.size * (0.75 + 0.25 * f.depth), H = L * spec.h;
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
      ctx.beginPath(); ctx.moveTo(L * 0.08, -H * 0.4); ctx.quadraticCurveTo(-L * 0.08, -H * 0.88, -L * 0.26, -H * 0.36); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(L * 0.02, H * 0.38); ctx.quadraticCurveTo(-L * 0.1, H * 0.7, -L * 0.22, H * 0.34); ctx.closePath(); ctx.fill();
      const g = ctx.createLinearGradient(0, -H / 2, 0, H / 2);
      g.addColorStop(0, spec.body[1]); g.addColorStop(0.5, spec.body[0]); g.addColorStop(1, spec.belly);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(L * 0.5, 0);
      ctx.bezierCurveTo(L * 0.42, -H * 0.64, -L * 0.18, -H * 0.62, -L * 0.4, -H * 0.06);
      ctx.lineTo(-L * 0.4, H * 0.06);
      ctx.bezierCurveTo(-L * 0.18, H * 0.6, L * 0.42, H * 0.64, L * 0.5, 0);
      ctx.closePath(); ctx.fill();
      ctx.save();
      ctx.clip();
      if (f.kind === 'neon') {
        ctx.fillStyle = '#ff3d55';
        ctx.beginPath(); ctx.ellipse(-L * 0.14, H * 0.2, L * 0.3, H * 0.24, 0, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#38d4ff'; ctx.lineWidth = H * 0.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(L * 0.3, -H * 0.1); ctx.lineTo(-L * 0.36, -H * 0.02); ctx.stroke();
      } else if (f.kind === 'pearl') {
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < 14; i++) {
          const u = ((i * 37) % 13) / 13, v = ((i * 17) % 7) / 7;
          ctx.beginPath(); ctx.arc((-0.3 + u * 0.6) * L, (-0.3 + v * 0.55) * H, 0.022 * L, 0, TAU); ctx.fill();
        }
      } else {
        ctx.fillStyle = 'rgba(255,240,200,0.28)';
        ctx.beginPath(); ctx.ellipse(L * 0.1, -H * 0.18, L * 0.28, H * 0.12, -0.1, 0, TAU); ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = '#f4f7f8'; ctx.beginPath(); ctx.arc(L * 0.3, -H * 0.1, L * 0.055, 0, TAU); ctx.fill();
      ctx.fillStyle = '#0b1114'; ctx.beginPath(); ctx.arc(L * 0.315, -H * 0.1, L * 0.032, 0, TAU); ctx.fill();
      ctx.restore();
    }
    draw(ctx) {
      const { w, h, s, t } = this;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.bg, 0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const r of this.rays) {
        const sway = Math.sin(t * 0.22 + r.p) * 36 * s;
        const a = (0.05 + 0.035 * Math.sin(t * 0.55 + r.p * 2)) * r.a;
        const g = ctx.createLinearGradient(0, 0, 0, this.sandY);
        g.addColorStop(0, `rgba(180,245,255,${a})`);
        g.addColorStop(1, 'rgba(180,245,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(r.x - r.w / 2, 0); ctx.lineTo(r.x + r.w / 2, 0);
        ctx.lineTo(r.x + r.w * 1.3 + sway + 50 * s, this.sandY);
        ctx.lineTo(r.x - r.w * 0.3 + sway + 50 * s, this.sandY);
        ctx.closePath(); ctx.fill();
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
        ctx.beginPath(); ctx.arc(p.x, p.y, 2.4 * s, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.lineWidth = Math.max(0.8, s);
      for (const b of this.bubbles) {
        ctx.strokeStyle = 'rgba(220,250,255,0.55)';
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        ctx.beginPath(); ctx.arc(b.x - b.r * 0.35, b.y - b.r * 0.35, b.r * 0.28, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      const sg = ctx.createLinearGradient(0, 0, 0, 40 * s);
      sg.addColorStop(0, 'rgba(200,250,255,0.22)');
      sg.addColorStop(1, 'rgba(200,250,255,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, w, 40 * s);
      ctx.strokeStyle = 'rgba(220,255,255,0.18)';
      ctx.lineWidth = 1.2 * s;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        const y = 10 * s + Math.sin(x * 0.03 + t * 1.6) * 2.5 * s + Math.sin(x * 0.011 - t) * 2 * s;
        if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
      for (const tp of this.taps) {
        const k = tp.age / 0.9;
        ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`;
        ctx.lineWidth = 2 * s;
        ctx.beginPath(); ctx.arc(tp.x, tp.y, (10 + 46 * k) * s, 0, TAU); ctx.stroke();
        ctx.fillStyle = `rgba(255,255,255,${0.28 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(tp.x, tp.y, 18 * s, 0, TAU); ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
  }

  /* ---------- 물멍 B안 : night sea ---------- */
  class Sea extends Scene {
    constructor(c) {
      super(c);
      this.size = this.num('wave', 1);
      this.splashes = [];
    }
    layout() {
      const { w, h } = this;
      const s = this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.35);
      const hz = this.hz = h * 0.36;
      const shore = this.shore = h * 0.6;
      const moon = this.moon = { x: w * 0.7, y: h * 0.14, r: 20 * s };
      this.bg = layer(w, h, this.dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, hz);
        g.addColorStop(0, '#050816'); g.addColorStop(1, '#1a2350');
        x.fillStyle = g; x.fillRect(0, 0, w, hz);
        for (let i = 0; i < Math.round((w * hz) / 1800); i++) {
          x.fillStyle = `rgba(230,236,255,${rand(0.15, 0.7)})`;
          const r = rand(0.4, 1.3);
          x.fillRect(rand(0, w), rand(0, hz * 0.9), r, r);
        }
        g = x.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, moon.r * 7);
        g.addColorStop(0, 'rgba(255,240,210,0.35)'); g.addColorStop(1, 'rgba(255,240,210,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, hz);
        x.fillStyle = '#fff3dc';
        x.beginPath(); x.arc(moon.x, moon.y, moon.r, 0, TAU); x.fill();
        x.fillStyle = 'rgba(200,190,170,0.25)';
        [[-0.3, -0.2, 0.25], [0.25, 0.15, 0.18], [0.05, 0.4, 0.12]].forEach(([dx, dy, r]) => {
          x.beginPath(); x.arc(moon.x + dx * moon.r, moon.y + dy * moon.r, r * moon.r, 0, TAU); x.fill();
        });
        g = x.createLinearGradient(0, hz, 0, shore);
        g.addColorStop(0, '#0d1638'); g.addColorStop(1, '#0a1230');
        x.fillStyle = g; x.fillRect(0, hz, w, shore - hz);
        g = x.createLinearGradient(0, shore, 0, h);
        g.addColorStop(0, '#4b4759'); g.addColorStop(0.45, '#35323f'); g.addColorStop(1, '#1b1a24');
        x.fillStyle = g; x.fillRect(0, shore, w, h - shore);
        x.fillStyle = 'rgba(160,180,255,0.12)';
        x.fillRect(0, hz - 1, w, 2);
      });
      this.rows = Array.from({ length: 10 }, (_, i) => {
        const k = i / 9;
        return { k, y: hz + (shore - hz) * Math.pow(k, 1.7), amp: (0.6 + 6 * k) * s, wl: (30 + 260 * k) * s, sp: (6 + 26 * k) * s, ph: rand(0, TAU) };
      });
      this.glints = Array.from({ length: 46 }, (_, i) => ({ k: i / 45, p: rand(0, TAU), o: rand(-1, 1) }));
      this.vig = vignette(w, h, this.dpr, 0.5);
    }
    step(dt) {
      this.t += dt;
      for (const sp of this.splashes) sp.age += dt;
      this.splashes = this.splashes.filter((sp) => sp.age < 1.6);
    }
    tap(x, y) { if (y > this.hz && y < this.shore) this.splashes.push({ x, y, age: 0 }); }
    action(name, value) { if (name === 'wave') this.size = parseFloat(value); }
    draw(ctx) {
      const { w, h, s, t, hz, shore, moon } = this;
      const A = this.size;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.bg, 0, 0, w, h);
      ctx.globalCompositeOperation = 'lighter';
      for (const gl of this.glints) {
        const y = hz + (shore - hz) * Math.pow(gl.k, 1.4) + 2 * s;
        const wid = (6 + 120 * gl.k) * s * (0.5 + 0.5 * Math.sin(t * 1.7 + gl.p));
        const a = (0.1 + 0.35 * (1 - gl.k)) * (0.4 + 0.6 * Math.abs(Math.sin(t * 2.3 + gl.p * 3)));
        ctx.fillStyle = `rgba(255,236,200,${a})`;
        ctx.fillRect(moon.x - wid / 2 + gl.o * (10 + 40 * gl.k) * s + Math.sin(t + gl.p) * 4 * s, y, wid, Math.max(1, (0.8 + 2.2 * gl.k) * s));
      }
      for (const r of this.rows) {
        ctx.strokeStyle = `rgba(150,175,235,${0.08 + 0.28 * r.k})`;
        ctx.lineWidth = Math.max(0.6, (0.5 + 1.6 * r.k) * s);
        ctx.beginPath();
        for (let x = 0; x <= w + 10; x += 10) {
          const y = r.y + Math.sin(((x + t * r.sp) / r.wl) * TAU + r.ph) * r.amp * A * 0.5 + Math.sin(((x * 0.6 - t * r.sp * 0.7) / r.wl) * TAU) * r.amp * A * 0.3;
          if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      // swash: fast run-up, slow retreat
      const T = 9;
      const ph = (t % T) / T;
      const run = ph < 0.3 ? 1 - Math.pow(1 - ph / 0.3, 2) : 1 - smooth(0, 1, (ph - 0.3) / 0.7);
      const reach = (h * 0.85 - shore) * (0.3 + 0.25 * A);
      const front = shore + run * reach;
      let g = ctx.createLinearGradient(0, shore, 0, shore + reach);
      g.addColorStop(0, 'rgba(10,10,22,0.45)'); g.addColorStop(1, 'rgba(10,10,22,0)');
      ctx.fillStyle = g; ctx.fillRect(0, shore, w, reach);
      const edge = (x) => front + (Math.sin(x * 0.018 + 1.3) * 7 + Math.sin(x * 0.047 + t * 0.6) * 3) * s;
      g = ctx.createLinearGradient(0, shore - 4 * s, 0, front);
      g.addColorStop(0, 'rgba(14,24,62,0.95)'); g.addColorStop(0.55, 'rgba(34,52,104,0.6)'); g.addColorStop(1, 'rgba(90,112,165,0.28)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, shore - 4 * s);
      for (let x = 0; x <= w + 10; x += 10) ctx.lineTo(x, edge(x));
      ctx.lineTo(w + 10, shore - 4 * s); ctx.closePath(); ctx.fill();
      const foamA = ph < 0.35 ? 0.85 : 0.85 * (1 - (ph - 0.35) / 0.65) + 0.15;
      // moonlight on the wet sheet
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 10; i++) {
        const y = shore + (front - shore) * (i / 10);
        const wid = (40 + 90 * (i / 10)) * s * (0.6 + 0.4 * Math.sin(t * 1.3 + i * 2.1));
        ctx.fillStyle = `rgba(255,236,200,${0.07 * (1 - i / 12)})`;
        ctx.fillRect(moon.x - wid / 2 + Math.sin(t * 0.8 + i) * 6 * s, y, wid, Math.max(1, 1.6 * s));
      }
      ctx.globalCompositeOperation = 'source-over';
      const foamLine = (alpha, width) => {
        ctx.strokeStyle = `rgba(235,242,255,${alpha})`;
        ctx.lineWidth = width;
        ctx.beginPath();
        for (let x = 0; x <= w + 10; x += 10) { const y = edge(x); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      };
      foamLine(foamA * 0.18, 8 * s);
      foamLine(foamA, 2 * s);
      ctx.fillStyle = `rgba(232,240,255,${foamA * 0.55})`;
      for (let i = 0; i < 70; i++) {
        const x = (i * 97.3 + Math.sin(i * 7.1) * 20) % w;
        const back = (2 + ((i * 13) % 11)) * s * (0.5 + run);
        ctx.beginPath(); ctx.arc(x, edge(x) - back, (0.6 + ((i * 7) % 3) * 0.4) * s, 0, TAU); ctx.fill();
      }
      const br = ph < 0.12 ? ph / 0.12 : 1 - smooth(0.12, 0.6, ph);
      ctx.strokeStyle = `rgba(220,232,255,${0.15 + 0.5 * br})`;
      ctx.lineWidth = (1.5 + 3 * br) * s;
      ctx.beginPath();
      for (let x = 0; x <= w + 10; x += 10) {
        const y = shore - 10 * s + Math.sin(x * 0.02 + t * 0.4) * 3 * s;
        if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
      for (const sp of this.splashes) {
        const k = sp.age / 1.6, depth = (sp.y - hz) / (shore - hz);
        for (let j = 0; j < 2; j++) {
          const r = (6 + 50 * k - j * 10) * s * (0.4 + depth);
          if (r <= 0) continue;
          ctx.strokeStyle = `rgba(210,225,255,${(1 - k) * 0.5})`;
          ctx.lineWidth = s;
          ctx.beginPath(); ctx.ellipse(sp.x, sp.y, r, r * 0.25, 0, 0, TAU); ctx.stroke();
        }
      }
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
  }

  /* ---------- 물멍 C안 : pond sparkles ---------- */
  class Pond extends Scene {
    constructor(c) {
      super(c);
      this.ripples = []; this.next = 0.4;
      this.drizzle = this.d.drizzle === 'on';
      this.leaves = null;
    }
    layout() {
      const { w, h } = this;
      const s = this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.35);
      this.bg = layer(w, h, this.dpr, (x) => {
        const g = x.createRadialGradient(w * 0.45, h * 0.3, 0, w * 0.45, h * 0.3, Math.hypot(w, h) * 0.75);
        g.addColorStop(0, '#1a6262'); g.addColorStop(0.45, '#0b3a3b'); g.addColorStop(1, '#041a1c');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        x.filter = `blur(${Math.round(30 * s)}px)`;
        x.fillStyle = 'rgba(0,10,12,0.45)';
        for (let i = 0; i < 5; i++) {
          x.beginPath(); x.ellipse(rand(0, w), rand(0, h), rand(60, 160) * s, rand(40, 120) * s, rand(0, 3), 0, TAU); x.fill();
        }
        x.filter = 'none';
      });
      const n = clamp(Math.round((w * h) / 260), 300, 3200);
      this.pts = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, h), p: rand(0, TAU), z: rand(0.6, 1.4) }));
      this.spark = glow(255, 240, 200, 0.2);
      if (!this.pads) {
        this.pads = [[0.74, 0.62, 34], [0.86, 0.7, 26], [0.66, 0.73, 22]].map(([fx, fy, r]) => ({ fx, fy, r, a: rand(0, TAU), p: rand(0, TAU) }));
      }
      if (!this.leaves) {
        this.leaves = ['#c98a2e', '#b65a2a', '#a8a84a'].map((color) => ({
          x: rand(0.15, 0.85) * w, y: rand(0.15, 0.85) * h, a: rand(0, TAU), va: rand(-0.08, 0.08),
          vx: rand(-5, 5) * s, vy: rand(-3, 3) * s, len: rand(24, 34) * s, color,
        }));
      }
      this.vig = vignette(w, h, this.dpr, 0.55);
    }
    addRipple(x, y, power) { this.ripples.push({ x, y, age: 0, max: 4.5, power }); }
    tap(x, y) { this.addRipple(x, y, 1.2); }
    action(name) {
      if (name === 'drizzle') { this.drizzle = !this.drizzle; this.next = 0; }
    }
    step(dt) {
      const { w, h, s } = this;
      this.t += dt;
      this.next -= dt;
      if (this.next <= 0) {
        this.addRipple(rand(0.1, 0.9) * w, rand(0.1, 0.9) * h, rand(0.6, 1));
        this.next = this.drizzle ? rand(0.15, 0.5) : rand(1.4, 3);
      }
      for (const r of this.ripples) r.age += dt;
      this.ripples = this.ripples.filter((r) => r.age < r.max);
      for (const L of this.leaves) {
        for (const r of this.ripples) {
          const dx = L.x - r.x, dy = L.y - r.y, d = Math.hypot(dx, dy) || 1, front = r.age * 42 * s;
          if (Math.abs(d - front) < 8 * s) { L.vx += (dx / d) * 60 * s * dt * r.power; L.vy += (dy / d) * 60 * s * dt * r.power; }
        }
        L.vx *= 1 - 0.3 * dt; L.vy *= 1 - 0.3 * dt;
        L.x += (L.vx + 3 * s) * dt;
        L.y += (L.vy + Math.sin(this.t * 0.2 + L.a) * 2 * s) * dt;
        L.a += L.va * dt;
        const m = 40 * s;
        if (L.x > w + m) L.x = -m;
        if (L.x < -m) L.x = w + m;
        if (L.y > h + m) L.y = -m;
        if (L.y < -m) L.y = h + m;
      }
    }
    drawPad(ctx, pd) {
      const s = this.s, r = pd.r * s;
      const x = pd.fx * this.w + Math.sin(this.t * 0.4 + pd.p) * 2 * s;
      const y = pd.fy * this.h + Math.cos(this.t * 0.33 + pd.p) * 2 * s;
      const a = pd.a + Math.sin(this.t * 0.15 + pd.p) * 0.05;
      ctx.fillStyle = 'rgba(0,10,12,0.35)';
      ctx.beginPath(); ctx.ellipse(x + 5 * s, y + 8 * s, r, r * 0.96, 0, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, '#4f9a5c'); g.addColorStop(1, '#25603d');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, a + 0.22, a + TAU - 0.22); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(160,220,160,0.22)';
      ctx.lineWidth = Math.max(0.6, 0.8 * s);
      ctx.beginPath();
      for (let i = 1; i < 8; i++) { const va = a + 0.22 + (i / 8) * (TAU - 0.44); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(va) * r * 0.9, y + Math.sin(va) * r * 0.9); }
      ctx.stroke();
    }
    leafPath(ctx, len) {
      ctx.beginPath();
      ctx.moveTo(-len * 0.5, 0);
      ctx.quadraticCurveTo(0, -len * 0.42, len * 0.5, 0);
      ctx.quadraticCurveTo(0, len * 0.42, -len * 0.5, 0);
      ctx.closePath();
    }
    draw(ctx) {
      const { w, h, s, t } = this;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.bg, 0, 0, w, h);
      for (const r of this.ripples) {
        const k = r.age / r.max;
        for (let j = 0; j < 3; j++) {
          const rad = (r.age * 42 - j * 11) * s;
          if (rad <= 0) continue;
          const a = (1 - k) * (0.38 - j * 0.1) * r.power;
          ctx.strokeStyle = `rgba(190,255,245,${a})`;
          ctx.lineWidth = Math.max(0.8, 1.6 * s);
          ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke();
          ctx.strokeStyle = `rgba(0,18,20,${a * 0.7})`;
          ctx.lineWidth = Math.max(0.8, 2 * s);
          ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(0, rad - 3 * s), 0, TAU); ctx.stroke();
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgb(255,248,220)';
      for (const p of this.pts) {
        const f = Math.sin(p.x * 0.028 / s + t * 0.6) + Math.sin(p.y * 0.041 / s - t * 0.5 + p.x * 0.01 / s) + 0.7 * Math.sin((p.x - p.y) * 0.019 / s + t * 0.9);
        let b = smooth(0.9, 2.3, f);
        if (b <= 0.01) continue;
        b *= 0.45 + 0.55 * Math.sin(t * 5 + p.p * 7);
        if (b <= 0.03) continue;
        const sz = (0.8 + 3 * b) * p.z * s;
        ctx.globalAlpha = Math.min(1, b * 1.1);
        ctx.fillRect(p.x - sz, p.y - 0.5, sz * 2, 1);
        ctx.fillRect(p.x - 0.5, p.y - sz * 0.6, 1, sz * 1.2);
        if (b > 0.55) {
          ctx.globalAlpha = b * 0.45;
          ctx.drawImage(this.spark, p.x - sz * 2, p.y - sz * 2, sz * 4, sz * 4);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (const pd of this.pads) this.drawPad(ctx, pd);
      for (const L of this.leaves) {
        ctx.save();
        ctx.translate(L.x + 6 * s, L.y + 9 * s); ctx.rotate(L.a);
        ctx.fillStyle = 'rgba(0,10,12,0.35)';
        this.leafPath(ctx, L.len); ctx.fill();
        ctx.restore();
        ctx.save();
        ctx.translate(L.x, L.y); ctx.rotate(L.a);
        ctx.fillStyle = L.color;
        this.leafPath(ctx, L.len); ctx.fill();
        ctx.strokeStyle = 'rgba(60,30,10,0.45)';
        ctx.lineWidth = Math.max(0.6, 0.9 * s);
        ctx.beginPath(); ctx.moveTo(-L.len * 0.62, 0); ctx.lineTo(L.len * 0.48, 0); ctx.stroke();
        ctx.restore();
      }
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
  }

  /* ---------- mounting & loop ---------- */
  const TYPES = { fire: Fire, rain: Rain, aquarium: Aquarium, sea: Sea, pond: Pond };
  const scenes = [];

  function fit(sc) {
    const c = sc.canvas;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return false;
    if (w === sc.w && h === sc.h) return true;
    const dpr = Math.min(window.devicePixelRatio || 1, w > 900 ? 1.25 : 2);
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    sc.resize(w, h, dpr);
    return true;
  }
  function ready(sc) {
    if (!fit(sc)) return false;
    if (!sc.warmed) {
      sc.warmed = true;
      for (let i = 0; i < 75; i++) sc.step(1 / 30);
    }
    return true;
  }
  function render(sc) {
    sc.ctx.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0);
    sc.draw(sc.ctx);
  }

  function mount() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((entries) => entries.forEach((e) => { e.target.__scene.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    const ro = 'ResizeObserver' in window
      ? new ResizeObserver((entries) => entries.forEach((e) => { const sc = e.target.__scene; if (ready(sc)) render(sc); }))
      : null;
    document.querySelectorAll('canvas[data-scene]').forEach((c) => {
      const T = TYPES[c.dataset.scene];
      if (!T) return;
      const sc = new T(c);
      c.__scene = sc;
      sc.visible = true;
      scenes.push(sc);
      if (ready(sc)) render(sc);
      if (io) io.observe(c);
      if (ro) ro.observe(c);
      c.addEventListener('pointerdown', (e) => {
        if (!sc.warmed) return;
        const r = c.getBoundingClientRect();
        sc.tap((e.clientX - r.left) * (sc.w / r.width), (e.clientY - r.top) * (sc.h / r.height));
      });
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-action]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-scene]');
      if (!c || !c.__scene || !c.__scene.warmed) return;
      c.__scene.action(b.dataset.action, b.dataset.value);
      if (b.parentElement && b.parentElement.classList.contains('seg')) {
        [...b.parentElement.children].forEach((x) => x.classList.toggle('on', x === b));
      }
      if (b.classList.contains('toggleable')) b.classList.toggle('on');
    });
  }

  let last = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    if (!last) { last = now; return; }
    const elapsed = (now - last) / 1000;
    if (elapsed < 1 / 31) return;
    last = now;
    const dt = Math.min(elapsed, 0.1);
    for (const sc of scenes) {
      if (!sc.visible || !sc.warmed) continue;
      sc.step(dt);
      render(sc);
    }
  }

  function start() {
    mount();
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
