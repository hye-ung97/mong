/* mong — 물멍 · 바다 v2 / 연못 v2 시안용 장면 (Doan 보드 전용). 코드(src/scenes/sea.ts, pond.ts)에는 아직 없어요.
   바다: 모래사장에 앉아서 보는 밤바다. 알갱이가 보이는 모래, 젖은 모래, 발자국(파도가 닿으면 지워져요).
   연못: 연못가 돌에 앉아서 내려다보는 연못. 잉어, 수련, 소금쟁이, 단풍 가지.
     <canvas data-sea2 data-wave="1" data-auto-walk="7">     n초마다 발자국이 한 줄 생겨요 (설명용)
     <canvas data-pond2 data-drizzle="1" data-auto-tap="5">  n초마다 물을 톡 쳐요 (설명용)
   같은 .screen 안의 [data-shore-act="wave|drizzle"] 버튼이 장면을 조작해요. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, k) => a + (b - a) * k;
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const smooth = (a, b, v) => { const k = clamp((v - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
  const wrap = (a) => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function layer(w, h, dpr, paint) {
    const c = mk(w * dpr, h * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    paint(x);
    return c;
  }
  const sprites = new Map();
  const glow = (r, g, b) => {
    const key = `${r},${g},${b}`;
    if (sprites.has(key)) return sprites.get(key);
    const S = 64, c = mk(S, S), x = c.getContext('2d');
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(0.4, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
    sprites.set(key, c);
    return c;
  };
  /* 부드러운 얼룩 (ctx.filter 없이) */
  const soft = (x, sprite, cx, cy, rx, ry, a) => { x.globalAlpha = a; x.drawImage(sprite, cx - rx, cy - ry, rx * 2, ry * 2); x.globalAlpha = 1; };

  const TBL = new Float32Array(65536);
  for (let i = 0; i < TBL.length; i++) TBL[i] = Math.random();
  const vnoise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    const a = TBL[((xi & 255) << 8) | (yi & 255)], b = TBL[(((xi + 1) & 255) << 8) | (yi & 255)];
    const c = TBL[((xi & 255) << 8) | ((yi + 1) & 255)], d = TBL[(((xi + 1) & 255) << 8) | ((yi + 1) & 255)];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };

  class Base {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.screen = canvas.closest('.screen');
      this.visible = true;
      this.t = 0;
      this.init(canvas.dataset);
      this.resize();
      this.sync();
    }
    resize() {
      const c = this.c;
      const w = (this.w = c.clientWidth || 390);
      const h = (this.h = c.clientHeight || 844);
      const dpr = (this.dpr = Math.min(window.devicePixelRatio || 1, w > 900 ? 1.25 : 2));
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
      this.s = clamp(Math.sqrt(w * h) / 573, 0.45, 1.25);
      this.wide = w > 900;
      this.build();
    }
    vignette(strength) {
      const { w, h } = this;
      const vg = (this.vig = mk(w, h)).getContext('2d');
      const g = vg.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.34, w / 2, h * 0.45, Math.hypot(w, h) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${strength})`);
      vg.fillStyle = g; vg.fillRect(0, 0, w, h);
    }
    down() {} move() {} up() {} action() {} sync() {}
  }

  /* =====================================================================
     바다 v2
     ===================================================================== */
  const PERIOD = 9;
  const WAVES = [[0.6, '잔잔'], [1, '보통'], [1.5, '높음']];

  class Sea2 extends Base {
    init(d) {
      this.size = Number(d.wave) || 1;
      this.autoWalk = Number(d.autoWalk) || 0;
      this.nextWalk = 1.5;
      this.queue = [];
      this.qT = 0;
      this.feet = [];
      this.splashes = [];
      this.left = false;
      this.last = null;
      this.drag = null;
      this.seeded = false;
    }

    pk(y) { return 0.35 + 0.65 * clamp((y - this.shore) / (this.h - this.shore), 0, 1); }

    build() {
      const { w, h, s, dpr, wide } = this;
      const hz = (this.hz = h * (wide ? 0.3 : 0.27));
      const shore = (this.shore = h * (wide ? 0.5 : 0.44));
      const moon = (this.moon = { x: w * 0.72, y: hz * (wide ? 0.52 : 0.81), r: 17 * s });
      this.lamp = { x: w * (wide ? 0.2 : 0.16), y: h - (wide ? 215 : 262) };
      this.sandal = { x: w * (wide ? 0.7 : 0.8), y: h - (wide ? 225 : 268) };
      this.wet = new Float32Array(Math.ceil(w / 8) + 2).fill(shore + h * 0.1);
      this.phase();

      this.bg = layer(w, h, dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, hz);
        g.addColorStop(0, '#050816'); g.addColorStop(1, '#1b2452');
        x.fillStyle = g; x.fillRect(0, 0, w, hz);
        for (let i = 0; i < Math.round((w * hz) / 1500); i++) {
          x.fillStyle = `rgba(230,236,255,${rand(0.15, 0.7)})`;
          const r = rand(0.4, 1.3);
          x.fillRect(rand(0, w), rand(0, hz * 0.92), r, r);
        }
        g = x.createRadialGradient(moon.x, moon.y, 0, moon.x, moon.y, moon.r * 7);
        g.addColorStop(0, 'rgba(255,240,210,0.35)'); g.addColorStop(1, 'rgba(255,240,210,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, hz);
        x.fillStyle = '#fff3dc'; x.beginPath(); x.arc(moon.x, moon.y, moon.r, 0, TAU); x.fill();
        x.fillStyle = 'rgba(200,190,170,0.25)';
        for (const [dx, dy, r] of [[-0.3, -0.2, 0.25], [0.25, 0.15, 0.18], [0.05, 0.4, 0.12]]) {
          x.beginPath(); x.arc(moon.x + dx * moon.r, moon.y + dy * moon.r, r * moon.r, 0, TAU); x.fill();
        }
        /* 바다 */
        g = x.createLinearGradient(0, hz, 0, shore);
        g.addColorStop(0, '#0f1a42'); g.addColorStop(1, '#0a1230');
        x.fillStyle = g; x.fillRect(0, hz, w, shore - hz + 2);
        x.fillStyle = 'rgba(160,180,255,0.14)'; x.fillRect(0, hz - 1, w, 2);
        /* 멀리 곶과 등대, 고깃배 불빛 */
        x.fillStyle = '#070b1c';
        x.beginPath(); x.moveTo(0, hz + 1);
        x.lineTo(0, hz - 15 * s); x.quadraticCurveTo(w * 0.1, hz - 20 * s, w * 0.2, hz - 7 * s); x.quadraticCurveTo(w * 0.27, hz - 2 * s, w * 0.32, hz + 1);
        x.closePath(); x.fill();
        this.light = { x: w * 0.085, y: hz - 30 * s };
        x.fillRect(this.light.x - 1.6 * s, this.light.y, 3.2 * s, 14 * s);
        x.fillRect(this.light.x - 2.6 * s, this.light.y - 2 * s, 5.2 * s, 2.4 * s);
        for (const fx of wide ? [0.4, 0.47, 0.93] : [0.42, 0.53]) {
          const bx = w * fx, by = hz - 1.5 * s;
          soft(x, glow(255, 232, 190), bx, by, 7 * s, 7 * s, 0.6);
          x.fillStyle = '#fff1d0'; x.fillRect(bx - s, by - s, 2 * s, 2 * s);
          x.fillStyle = 'rgba(255,232,190,0.3)'; x.fillRect(bx - 0.6 * s, hz + 1, 1.2 * s, 9 * s);
        }
        this.sand(x);
        this.props(x);
      });
      this.rows = Array.from({ length: 10 }, (_, i) => {
        const k = i / 9;
        return { k, y: hz + (shore - hz) * Math.pow(k, 1.7), amp: (0.6 + 6 * k) * s, wl: (30 + 260 * k) * s, sp: (6 + 26 * k) * s, ph: rand(0, TAU) };
      });
      this.glints = Array.from({ length: 46 }, (_, i) => ({ k: i / 45, p: rand(0, TAU), o: rand(-1, 1) }));
      this.vignette(0.5);
      if (!this.seeded) {
        this.seeded = true;
        const sd = this.sandal;
        this.trail(sd.x - 40 * s, sd.y - 16 * s, w * (wide ? 0.56 : 0.5), shore + h * 0.03).forEach((p) => this.stepAt(p.x, p.y, p.ang));
        if (wide) this.trail(w * 0.36, h - 190, w * 0.3, shore + h * 0.04).forEach((p) => this.stepAt(p.x, p.y, p.ang));
      }
    }

    /* 모래: 한 알 한 알 찍어요. 멀수록 곱고 가까울수록 굵어요. 바람결 무늬와 등불의 따뜻한 빛도 같이 구워요 */
    sand(x) {
      const { w, h, s, dpr, hz, shore, lamp } = this;
      const W = Math.round(w * dpr), H = Math.round(h * dpr);
      const y0 = Math.max(0, Math.floor((shore - 8 * s) * dpr));
      const img = x.createImageData(W, H - y0), D = img.data;
      const R = (this.wide ? 150 : 105) * s;
      let o = 0;
      for (let py = y0; py < H; py++) {
        const yy = py / dpr, k = (yy - hz) / (h - hz), z = 1 / k;
        const dT = clamp((yy - shore) / (h - shore), 0, 1);
        const br = lerp(140, 106, dT), bgc = lerp(128, 95, dT), bb = lerp(108, 80, dT);
        const ga = 0.07 + 0.2 * k;
        for (let px = 0; px < W; px++) {
          const xx = px / dpr, u = (xx - w / 2) / k / s;
          const m1 = vnoise(u * 0.012 + 40, z * 6), m2 = vnoise(u * 0.05 + 9, z * 30 + 3);
          const rip = Math.sin(z * 110 + (vnoise(u * 0.006, z * 3) - 0.5) * 9 + u * 0.004);
          const dx = xx - lamp.x, dy = (yy - lamp.y) / 0.45;
          const I = Math.exp(-(dx * dx + dy * dy) / (R * R));
          let b = 1 + (m1 - 0.5) * 0.24 + (m2 - 0.5) * 0.12 + rip * 0.035 * (1 + 1.2 * I) + (Math.random() - 0.5) * ga;
          const r0 = Math.random();
          if (r0 < 0.004 * k) b += 0.4;                              // 반짝이는 알갱이
          else if (r0 < 0.012 * k) b -= 0.22;                        // 어두운 알갱이
          D[o] = (br * (1 + I * 0.5) + 52 * I) * b;
          D[o + 1] = (bgc * (1 + I * 0.3) + 22 * I) * b;
          D[o + 2] = (bb * (1 + I * 0.05)) * b;
          D[o + 3] = 255;
          o += 4;
        }
      }
      x.putImageData(img, 0, y0);
    }

    /* 모래 위 물건들: 조약돌 · 조개 · 불가사리 · 등불 · 벗어둔 슬리퍼 */
    props(x) {
      const { w, h, s, shore, lamp, sandal } = this;
      const dryTop = shore + h * 0.13;
      for (let i = 0; i < Math.round(w / 26); i++) {
        const px = rand(0, w), py = rand(dryTop, h - 20), r = rand(1.6, 4.2) * s * this.pk(py);
        if (Math.hypot(px - lamp.x, py - lamp.y) < 40 * s || Math.hypot(px - sandal.x, py - sandal.y) < 50 * s) continue;
        x.fillStyle = 'rgba(20,14,8,0.4)';
        x.beginPath(); x.ellipse(px + r * 0.25, py + r * 0.35, r * 1.05, r * 0.55, 0, 0, TAU); x.fill();
        const g = x.createLinearGradient(0, py - r * 0.6, 0, py + r * 0.6);
        const tone = pick([['#b9b3a8', '#5a554d'], ['#8d8f96', '#3d3f47'], ['#c9b79a', '#6b5a44']]);
        g.addColorStop(0, tone[0]); g.addColorStop(1, tone[1]);
        x.fillStyle = g;
        x.beginPath(); x.ellipse(px, py, r, r * 0.6, rand(-0.3, 0.3), 0, TAU); x.fill();
      }
      const shells = this.wide ? [[0.31, 0.2], [0.44, 0.5], [0.62, 0.3], [0.84, 0.42], [0.9, 0.2], [0.1, 0.36]] : [[0.36, 0.18], [0.6, 0.42], [0.9, 0.12], [0.44, 0.6]];
      for (const [fx, fy] of shells) {
        const px = w * fx, py = dryTop + (h - 200 - dryTop) * fy, r = 7.5 * s * this.pk(py);
        x.save(); x.translate(px, py); x.scale(1, 0.72); x.rotate(rand(-0.9, 0.9));
        x.fillStyle = 'rgba(20,14,8,0.4)';
        x.beginPath(); x.ellipse(r * 0.2, r * 0.3, r, r * 0.6, 0, 0, TAU); x.fill();
        x.fillStyle = pick(['#eadbc8', '#e9c9c0', '#f1e6d4']);
        x.beginPath(); x.ellipse(0, 0, r, r * 0.8, 0, Math.PI, TAU); x.lineTo(0, r * 0.5); x.closePath(); x.fill();
        x.strokeStyle = 'rgba(132,96,78,0.55)'; x.lineWidth = Math.max(0.5, 0.7 * s);
        x.beginPath();
        for (let i = 1; i < 7; i++) { const a = Math.PI + (i / 7) * Math.PI; x.moveTo(0, r * 0.5); x.lineTo(Math.cos(a) * r * 0.94, Math.sin(a) * r * 0.76); }
        x.stroke();
        x.restore();
      }
      {                                                              // 불가사리
        const px = w * (this.wide ? 0.44 : 0.34), py = dryTop + (this.wide ? 110 : 60) * s, r = 10 * s * this.pk(py);
        x.save(); x.translate(px, py); x.scale(1, 0.62); x.rotate(0.4);
        for (const [ox, oy, col] of [[r * 0.15, r * 0.3, 'rgba(20,14,8,0.4)'], [0, 0, '#d6805a']]) {
          x.fillStyle = col; x.beginPath();
          for (let i = 0; i < 10; i++) { const a = (i / 10) * TAU - Math.PI / 2, rr = i % 2 ? r * 0.4 : r; x.lineTo(ox + Math.cos(a) * rr, oy + Math.sin(a) * rr); }
          x.closePath(); x.fill();
        }
        x.fillStyle = 'rgba(255,214,180,0.6)';
        for (let i = 0; i < 5; i++) { const a = (i / 5) * TAU - Math.PI / 2; x.beginPath(); x.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.07, 0, TAU); x.fill(); }
        x.restore();
      }
      {                                                              // 슬리퍼
        const L = 46 * s * this.pk(sandal.y);
        for (const [ox, oy, ang] of [[0, 0, -0.5], [L * 0.62, L * 0.2, -0.15]]) {
          x.save(); x.translate(sandal.x + ox, sandal.y + oy); x.scale(1, 0.62); x.rotate(ang);
          x.fillStyle = 'rgba(16,10,6,0.45)'; x.beginPath(); x.ellipse(L * 0.06, L * 0.12, L * 0.24, L * 0.52, 0, 0, TAU); x.fill();
          x.fillStyle = '#c9584e'; x.beginPath(); x.ellipse(0, 0, L * 0.22, L * 0.5, 0, 0, TAU); x.fill();
          x.fillStyle = '#e07a6c'; x.beginPath(); x.ellipse(0, -L * 0.02, L * 0.17, L * 0.43, 0, 0, TAU); x.fill();
          x.strokeStyle = '#f3ebdc'; x.lineWidth = L * 0.07; x.lineCap = 'round';
          x.beginPath(); x.moveTo(-L * 0.19, L * 0.02); x.lineTo(0, -L * 0.24); x.lineTo(L * 0.19, L * 0.02); x.stroke();
          x.restore();
        }
      }
      {                                                              // 등불
        const H = 50 * s * this.pk(lamp.y), lx = lamp.x, ly = lamp.y;
        x.fillStyle = 'rgba(16,10,6,0.5)'; x.beginPath(); x.ellipse(lx, ly, H * 0.34, H * 0.1, 0, 0, TAU); x.fill();
        x.fillStyle = '#17181c'; x.fillRect(lx - H * 0.24, ly - H * 0.14, H * 0.48, H * 0.14);
        const g = x.createRadialGradient(lx, ly - H * 0.4, 0, lx, ly - H * 0.4, H * 0.34);
        g.addColorStop(0, '#fff3c8'); g.addColorStop(0.5, '#ffc063'); g.addColorStop(1, '#d9781f');
        x.fillStyle = g; x.fillRect(lx - H * 0.2, ly - H * 0.66, H * 0.4, H * 0.52);
        x.strokeStyle = 'rgba(30,20,10,0.6)'; x.lineWidth = Math.max(1, 1.2 * s);
        x.beginPath(); x.moveTo(lx - H * 0.07, ly - H * 0.66); x.lineTo(lx - H * 0.07, ly - H * 0.14); x.moveTo(lx + H * 0.07, ly - H * 0.66); x.lineTo(lx + H * 0.07, ly - H * 0.14); x.stroke();
        x.fillStyle = '#1d1e23';
        x.beginPath(); x.moveTo(lx - H * 0.26, ly - H * 0.66); x.lineTo(lx + H * 0.26, ly - H * 0.66); x.lineTo(lx + H * 0.14, ly - H * 0.8); x.lineTo(lx - H * 0.14, ly - H * 0.8); x.closePath(); x.fill();
        x.strokeStyle = '#2a2b31'; x.lineWidth = Math.max(1, 1.6 * s);
        x.beginPath(); x.arc(lx, ly - H * 0.8, H * 0.2, Math.PI, TAU); x.stroke();
        this.lampH = H;
      }
    }

    /* 걸어간 길: 시작점에서 끝점까지 발 디딜 자리 */
    trail(x0, y0, x1, y1) {
      const out = [], ang = Math.atan2(y1 - y0, x1 - x0);
      let x = x0, y = y0;
      for (let i = 0; i < 40 && y > y1; i++) {
        out.push({ x, y, ang: ang + rand(-0.07, 0.07) });
        const st = 42 * this.s * this.pk(y);
        x += Math.cos(ang) * st; y += Math.sin(ang) * st;
      }
      return out;
    }

    stepAt(x, y, ang) {
      const { s, t } = this, L = this.last;
      if (ang == null) {
        const d = L ? Math.hypot(x - L.x, y - L.y) : 0;
        ang = L && t - L.t < 2.5 && d > 8 * s && d < 150 * s ? Math.atan2(y - L.y, x - L.x) : -Math.PI / 2 + rand(-0.25, 0.25);
      }
      this.left = !this.left;
      const side = this.left ? -1 : 1, off = 9 * s * this.pk(y);
      this.feet.push({ x: x - Math.sin(ang) * off * side, y: y + Math.cos(ang) * off * side, rot: ang + Math.PI / 2, inner: this.left ? 1 : -1, wash: 0 });
      if (this.feet.length > 70) this.feet.shift();
      this.last = { x, y, t };
    }

    down(x, y) {
      if (y < this.hz) return;
      if (y < this.edge(x) + 4) { this.splashes.push({ x, y, age: 0 }); return; }
      this.drag = { x, y };
      this.stepAt(x, y, null);
    }
    move(x, y) {
      const d = this.drag;
      if (!d || y < this.edge(x) + 4) return;
      if (Math.hypot(x - d.x, y - d.y) < 42 * this.s * this.pk(y)) return;
      this.stepAt(x, y, Math.atan2(y - d.y, x - d.x));
      this.drag = { x, y };
    }
    up() { this.drag = null; }

    action(name, value) {
      if (name === 'wave') this.size = Number(value) || 1;
      this.sync();
    }
    sync() {
      const sc = this.screen;
      if (!sc) return;
      const cur = WAVES.reduce((a, b) => (Math.abs(b[0] - this.size) < Math.abs(a[0] - this.size) ? b : a));
      sc.querySelectorAll('[data-shore-act="wave"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === cur[0]));
      sc.querySelectorAll('[data-stat="wave"]').forEach((e) => { e.textContent = cur[1]; });
    }

    phase() {
      const ph = (this.ph = (this.t % PERIOD) / PERIOD);
      this.widx = Math.floor(this.t / PERIOD);
      this.run = ph < 0.3 ? 1 - Math.pow(1 - ph / 0.3, 2) : 1 - smooth(0, 1, (ph - 0.3) / 0.7);
      this.reach = this.h * (0.05 + 0.065 * this.size);
      this.front = this.shore + this.run * this.reach;
    }
    edge(x) {
      const { s, t } = this;
      return this.front + (Math.sin(x * 0.018 + 1.3) * 7 + Math.sin(x * 0.047 + t * 0.6) * 3 + Math.sin(x * 0.008 + this.widx * 2.1) * 12) * s * (0.35 + 0.65 * this.run);
    }

    step(dt) {
      const { s, w, h, shore } = this;
      this.t += dt;
      this.phase();
      const wet = this.wet;
      for (let i = 0; i < wet.length; i++) {
        const e = this.edge(i * 8);
        wet[i] = e > wet[i] ? e : Math.max(shore, wet[i] - dt * 1.6 * s);   // 젖은 모래는 천천히 말라요
      }
      for (const f of this.feet) if (this.edge(f.x) > f.y - 3 * s) f.wash += dt * 2;   // 파도가 닿으면 지워져요
      this.feet = this.feet.filter((f) => f.wash < 1);
      for (const sp of this.splashes) sp.age += dt;
      this.splashes = this.splashes.filter((sp) => sp.age < 1.6);
      if (this.autoWalk) {
        this.nextWalk -= dt;
        if (this.nextWalk <= 0 && !this.queue.length) {
          this.nextWalk = this.autoWalk;
          const sx = rand(0.3, 0.7) * w;
          this.queue = this.trail(sx, h - (this.wide ? 190 : 225), sx + rand(-110, 110) * s, shore + this.reach * 0.75);
        }
        this.qT -= dt;
        if (this.queue.length && this.qT <= 0) {
          this.qT = 0.42;
          const p = this.queue.shift();
          this.stepAt(p.x, p.y, p.ang);
        }
      }
    }

    foot(ctx, L, inner) {
      const el = (cx, cy, rx, ry) => { ctx.moveTo(cx + rx, cy); ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU); };
      ctx.beginPath();
      el(0, L * 0.3, L * 0.13, L * 0.17);                             // 뒤꿈치
      el(-inner * L * 0.035, L * 0.06, L * 0.095, L * 0.2);           // 발날
      el(0, -L * 0.17, L * 0.18, L * 0.2);                            // 앞꿈치
      for (let i = 0; i < 5; i++) el(inner * (L * 0.15 - i * L * 0.08), -L * 0.44 + i * L * 0.042, L * (0.06 - i * 0.007), L * (0.06 - i * 0.007));
    }

    draw() {
      const { ctx, w, h, s, t, dpr, hz, shore, moon, ph, run } = this;
      const A = this.size;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.drawImage(this.bg, 0, 0, w, h);
      /* 달빛 길과 너울 */
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
      /* 등대 불빛 */
      const beam = Math.pow(Math.max(0, Math.sin((t * TAU) / 5)), 10);
      ctx.globalAlpha = 0.25 + 0.75 * beam;
      ctx.drawImage(glow(255, 240, 200), this.light.x - (5 + 16 * beam) * s, this.light.y - (5 + 16 * beam) * s, (10 + 32 * beam) * s, (10 + 32 * beam) * s);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      /* 젖은 모래: 어둡고 매끈해요 */
      const wet = this.wet;
      for (const [off, a] of [[0, 0.2], [-5 * s, 0.17], [-11 * s, 0.15]]) {
        ctx.fillStyle = `rgba(12,14,28,${a})`;
        ctx.beginPath(); ctx.moveTo(0, shore - 8 * s);
        for (let i = 0; i < wet.length; i++) ctx.lineTo(i * 8, wet[i] + off);
        ctx.lineTo(w + 8, shore - 8 * s); ctx.closePath(); ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      const wetY = wet[Math.min(wet.length - 1, Math.round(moon.x / 8))];
      for (let i = 0; i < 9; i++) {
        const y = shore + (wetY - 12 * s - shore) * (i / 9);
        const wid = (50 + 90 * (i / 9)) * s * (0.6 + 0.4 * Math.sin(t * 0.9 + i * 2.1));
        ctx.fillStyle = `rgba(255,236,200,${0.06 * (1 - i / 11)})`;
        ctx.fillRect(moon.x - wid / 2 + Math.sin(t * 0.6 + i) * 5 * s, y, wid, Math.max(1, 1.6 * s));
      }
      ctx.globalCompositeOperation = 'source-over';

      /* 발자국: 달빛 쪽 벽은 그늘, 반대쪽 가장자리는 밝아요 */
      for (const f of this.feet) {
        const pk = this.pk(f.y), L = 54 * s * pk, fy = 0.6 + 0.3 * clamp((f.y - shore) / (h - shore), 0, 1), a = 1 - f.wash;
        for (const [oy, col, sc] of [[1.7 * pk * s, `rgba(255,236,204,${0.22 * a})`, 1.07], [0, `rgba(40,28,16,${0.42 * a})`, 1], [-1.4 * pk * s, `rgba(8,5,2,${0.26 * a})`, 0.78]]) {
          ctx.save();
          ctx.translate(f.x, f.y + oy); ctx.scale(1, fy); ctx.rotate(f.rot); ctx.scale(sc, sc);
          ctx.fillStyle = col; this.foot(ctx, L, f.inner); ctx.fill();
          ctx.restore();
        }
      }

      /* 밀려온 물 */
      const front = this.front;
      let g = ctx.createLinearGradient(0, shore - 4 * s, 0, front + 8 * s);
      g.addColorStop(0, 'rgba(12,22,58,0.96)'); g.addColorStop(0.4, 'rgba(40,62,112,0.5)'); g.addColorStop(1, 'rgba(130,155,195,0.12)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(0, shore - 8 * s);
      for (let x = 0; x <= w + 10; x += 10) ctx.lineTo(x, this.edge(x));
      ctx.lineTo(w + 10, shore - 8 * s); ctx.closePath(); ctx.fill();
      /* 물이 빠진 자리에 남은 거품 */
      if (ph > 0.3) {
        const ra = 0.4 * (1 - smooth(0.3, 0.9, ph));
        ctx.fillStyle = `rgba(235,242,255,${ra})`;
        for (let i = 0; i < wet.length; i++) {
          if ((i * 7) % 5 === 0) continue;
          ctx.fillRect(i * 8 + ((i * 13) % 5), wet[i] - ((i * 11) % 4) * s, (1 + ((i * 3) % 3)) * s, Math.max(1, s));
        }
      }
      const foamA = ph < 0.35 ? 0.9 : 0.9 * (1 - (ph - 0.35) / 0.65) + 0.12;
      const line = (alpha, width, back) => {
        ctx.strokeStyle = `rgba(238,244,255,${alpha})`; ctx.lineWidth = width;
        ctx.beginPath();
        for (let x = 0; x <= w + 6; x += 6) {
          const y = this.edge(x) - (back ? back * (0.3 + 1.5 * vnoise(x * 0.02 + back, this.widx * 3.1 + t * 0.15)) * s * (0.4 + run) : 0);
          if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.stroke();
      };
      line(foamA * 0.16, 10 * s, 0);
      line(foamA * 0.22, 1.2 * s, 16);
      line(foamA * 0.35, 1.5 * s, 8);
      line(foamA, 2.6 * s, 0);
      ctx.fillStyle = `rgba(236,242,255,${foamA * 0.6})`;
      for (let i = 0; i < 90 * (w / 390); i++) {
        const x = (i * 97.3 + Math.sin(i * 7.1) * 20) % w;
        const back = (2 + ((i * 13) % 17)) * s * (0.5 + run);
        ctx.beginPath(); ctx.arc(x, this.edge(x) - back, (0.6 + ((i * 7) % 3) * 0.45) * s, 0, TAU); ctx.fill();
      }
      /* 바로 앞에서 부서지는 파도 */
      const q = smooth(0.7, 1, ph);
      const yb = shore - (8 + 40 * (1 - q)) * s;
      const ba = ph > 0.7 ? 0.12 + 0.68 * q : ph < 0.15 ? 0.8 * (1 - ph / 0.15) : 0.08;
      const crest = (dy) => { ctx.beginPath(); for (let x = 0; x <= w + 10; x += 10) { const y = (ph > 0.7 ? yb : shore - 8 * s) + dy + Math.sin(x * 0.02 + t * 0.4) * 3 * s; if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); } ctx.stroke(); };
      ctx.strokeStyle = `rgba(3,6,20,${0.55 * ba})`; ctx.lineWidth = 6 * s * A; crest(4 * s);
      ctx.strokeStyle = `rgba(226,236,255,${ba})`; ctx.lineWidth = (1.4 + 3.6 * ba) * s; crest(0);
      for (const sp of this.splashes) {
        const k = sp.age / 1.6, depth = clamp((sp.y - hz) / (shore - hz), 0.1, 1.4);
        for (let j = 0; j < 2; j++) {
          const r = (6 + 50 * k - j * 10) * s * (0.4 + depth);
          if (r <= 0) continue;
          ctx.strokeStyle = `rgba(210,225,255,${(1 - k) * 0.5})`; ctx.lineWidth = s;
          ctx.beginPath(); ctx.ellipse(sp.x, sp.y, r, r * 0.25, 0, 0, TAU); ctx.stroke();
        }
      }
      /* 등불이 일렁여요 */
      ctx.globalCompositeOperation = 'lighter';
      const H = this.lampH, fl = 0.5 + 0.12 * Math.sin(t * 7.3) + 0.08 * Math.sin(t * 13.1);
      ctx.globalAlpha = fl * 0.7;
      ctx.drawImage(glow(255, 170, 80), this.lamp.x - H * 1.5, this.lamp.y - H * 1.9, H * 3, H * 3);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
  }

  /* =====================================================================
     연못 v2
     ===================================================================== */
  const KOI = [
    { base: '#f3eee4', marks: ['#e0442a'] },                 // 홍백
    { base: '#f0902a', marks: ['#ffc56a'] },                 // 주황
    { base: '#f3eee4', marks: ['#e0442a', '#1d1d22'] },      // 삼색
    { base: '#f1cd58', marks: ['#fff0b8'] },                 // 황금
    { base: '#27272c', marks: ['#eee8dc'] },                 // 먹
    { base: '#f3eee4', marks: ['#f0902a'] },
    { base: '#e9572f', marks: ['#f3eee4'] },
  ];
  const PROFILE = [0.3, 0.74, 0.95, 1, 0.96, 0.86, 0.7, 0.5, 0.32, 0.18, 0.1];

  class Pond2 extends Base {
    init(d) {
      this.drizzle = d.drizzle === '1';
      this.autoTap = Number(d.autoTap) || 0;
      this.nextTap = 2;
      this.next = 0.4;
      this.ripples = [];
      this.koi = [];
      this.pads = null;
    }

    build() {
      const { w, h, s, dpr, wide } = this;
      const bankY = (this.bankY = h - (wide ? 150 : 208));
      const bankAt = (this.bankAt = (x) => bankY + (Math.sin(x * 0.013 + 0.6) * 10 + Math.sin(x * 0.034 + 2) * 5) * s);
      const dark = glow(0, 20, 18);

      this.bg = layer(w, h, dpr, (x) => {
        let g = x.createRadialGradient(w * 0.45, h * 0.32, 0, w * 0.45, h * 0.32, Math.hypot(w, h) * 0.75);
        g.addColorStop(0, '#2f8272'); g.addColorStop(0.5, '#12514d'); g.addColorStop(1, '#07302f');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        for (let i = 0; i < 6; i++) soft(x, dark, rand(0, w), rand(0, bankY), rand(90, 200) * s, rand(70, 150) * s, 0.4);
        /* 얕은 가장자리: 바닥 자갈이 비쳐요 */
        for (let i = 0; i < Math.round(w / 3.2); i++) {
          const px = rand(0, w), d = rand(0, 1), py = bankAt(px) - d * d * 120 * s;
          x.globalAlpha = (1 - d) * 0.5;
          x.fillStyle = pick(['#93a086', '#6f8270', '#a9a98c', '#587062', '#7d8a7c']);
          x.beginPath(); x.ellipse(px, py, rand(5, 13) * s, rand(4, 9) * s, rand(0, 3), 0, TAU); x.fill();
        }
        x.globalAlpha = 1;
        g = x.createLinearGradient(0, bankY - 130 * s, 0, bankY + 10 * s);
        g.addColorStop(0, 'rgba(150,196,150,0)'); g.addColorStop(1, 'rgba(150,196,150,0.24)');
        x.fillStyle = g; x.fillRect(0, bankY - 130 * s, w, 160 * s);
        /* 나뭇가지 그늘 */
        for (let i = 0; i < (wide ? 70 : 44); i++) {
          const k = Math.random();
          soft(x, dark, w * (1 - k * (wide ? 0.42 : 0.6)) + rand(-40, 40) * s, h * (0.03 + k * 0.2) + rand(-34, 50) * s, rand(16, 40) * s, rand(12, 30) * s, 0.42);
        }
      });

      /* 앞: 연못가 돌 · 이끼 · 풀, 위에서 드리운 단풍 가지 */
      this.front = layer(w, h, dpr, (x) => {
        let g;
        const edgePath = (off) => { x.beginPath(); x.moveTo(0, h); for (let px = 0; px <= w + 8; px += 8) x.lineTo(px, bankAt(px) + off); x.lineTo(w + 8, h); x.closePath(); };
        x.fillStyle = 'rgba(2,18,14,0.5)'; edgePath(-7 * s); x.fill();   // 돌 그늘이 물에 져요
        g = x.createLinearGradient(0, bankY, 0, h);
        g.addColorStop(0, '#1a2317'); g.addColorStop(1, '#0a0d09');
        x.fillStyle = g; edgePath(6 * s); x.fill();
        const stone = (cx, cy, rx, ry, tone, moss) => {
          const n = 10, pts = [];
          for (let i = 0; i < n; i++) { const a = (i / n) * TAU, j = rand(0.82, 1.1); pts.push([cx + Math.cos(a) * rx * j, cy + Math.sin(a) * ry * j]); }
          const path = (ox, oy) => {
            x.beginPath();
            x.moveTo((pts[n - 1][0] + pts[0][0]) / 2 + ox, (pts[n - 1][1] + pts[0][1]) / 2 + oy);
            for (let i = 0; i < n; i++) { const p = pts[i], q = pts[(i + 1) % n]; x.quadraticCurveTo(p[0] + ox, p[1] + oy, (p[0] + q[0]) / 2 + ox, (p[1] + q[1]) / 2 + oy); }
            x.closePath();
          };
          x.fillStyle = 'rgba(0,8,6,0.5)'; path(4 * s, 7 * s); x.fill();
          g = x.createLinearGradient(cx - rx, cy - ry, cx + rx * 0.6, cy + ry);
          g.addColorStop(0, tone[0]); g.addColorStop(1, tone[1]);
          x.fillStyle = g; path(0, 0); x.fill();
          x.save(); x.clip();
          soft(x, glow(255, 255, 240), cx - rx * 0.35, cy - ry * 0.4, rx * 0.7, ry * 0.6, 0.22);
          for (let i = 0; i < rx * ry * 0.03; i++) {
            x.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.14)';
            x.fillRect(cx + rand(-1, 1) * rx, cy + rand(-1, 1) * ry, rand(1, 2.4) * s, rand(1, 2) * s);
          }
          if (moss) for (let i = 0; i < 16; i++) {
            x.fillStyle = pick(['#4f8a42', '#3c7438', '#6aa04c', '#2f5f30']);
            x.beginPath(); x.arc(cx + rx * (0.25 + rand(-0.4, 0.5)), cy + ry * (0.3 + rand(-0.4, 0.5)), rand(4, 10) * s, 0, TAU); x.fill();
          }
          x.restore();
        };
        const tones = [['#b4b6aa', '#5a5e56'], ['#a39f90', '#4c4a43'], ['#929995', '#444b49'], ['#bdb6a2', '#63604f']];
        for (let row = 3; row >= 0; row--) {
          for (let px = -30 * s + row * 23 * s; px < w + 40 * s;) {
            const rx = rand(34, 60) * s * (1 + row * 0.12), ry = rand(22, 32) * s * (1 + row * 0.12);
            stone(px + rx, bankAt(px + rx) + (22 + row * 56) * s + rand(-6, 6) * s, rx, ry, pick(tones), Math.random() < 0.4);
            px += rx * 1.85;
          }
        }
        g = x.createLinearGradient(0, bankY + 30 * s, 0, h);          // 아래쪽은 버튼이 놓이는 자리라 어둡게
        g.addColorStop(0, 'rgba(4,8,6,0)'); g.addColorStop(0.45, 'rgba(4,8,6,0.5)'); g.addColorStop(1, 'rgba(4,8,6,0.78)');
        x.fillStyle = g; x.fillRect(0, bankY + 30 * s, w, h - bankY);
        /* 풀포기 */
        const tufts = wide ? [0.05, 0.21, 0.36, 0.55, 0.7, 0.86, 0.97] : [0.04, 0.3, 0.63, 0.93];
        for (const pass of [0, 1]) {
          for (const [ti, fx] of tufts.entries()) {
            const n = 13;
            for (let i = 0; i < n; i++) {
              const sx = Math.sin(ti * 91.7 + i * 17.3), sy = Math.sin(ti * 37.1 + i * 53.9);   // 두 번 그려도 같은 풀
              const bx = w * fx + sx * 16 * s, by = bankAt(bx) + (10 + sy * 6) * s;
              const len = (46 + 34 * Math.sin(i * 2.3 + ti)) * s, lean = sx * 0.6;
              const tx = bx + Math.sin(lean) * len + (pass ? 0 : 5 * s), ty = by - Math.cos(lean) * len * 0.9 + (pass ? 0 : 8 * s);
              x.strokeStyle = pass ? ['#5fae4c', '#3f8a3c', '#7cc05a', '#2f6f34'][i % 4] : 'rgba(0,14,10,0.3)';
              x.lineWidth = (1.6 + (i % 3) * 0.5) * s; x.lineCap = 'round';
              x.beginPath(); x.moveTo(bx + (pass ? 0 : 3 * s), by + (pass ? 0 : 4 * s)); x.quadraticCurveTo(bx + Math.sin(lean) * len * 0.2, by - len * 0.6, tx, ty); x.stroke();
            }
          }
        }
        /* 단풍 가지 */
        const bx0 = w + 10, by0 = -14 * s, bx1 = w * (wide ? 0.7 : 0.6), by1 = h * (wide ? 0.2 : 0.16);
        const leaves = [];
        const twig = (x0, y0, x1, y1, wd, depth) => {
          const mx = (x0 + x1) / 2 + rand(-18, 18) * s, my = (y0 + y1) / 2 + rand(-12, 12) * s;
          x.strokeStyle = '#3a2a22'; x.lineWidth = wd; x.lineCap = 'round';
          x.beginPath(); x.moveTo(x0, y0); x.quadraticCurveTo(mx, my, x1, y1); x.stroke();
          const n = depth ? 7 : 4;
          for (let i = 1; i <= n; i++) {
            const k = i / n, px = lerp(lerp(x0, mx, k), lerp(mx, x1, k), k), py = lerp(lerp(y0, my, k), lerp(my, y1, k), k);
            if (depth < 2 && k > 0.2 && (depth === 0 || Math.random() < 0.4)) twig(px, py, px + rand(-90, 20) * s, py + rand(20, 100) * s * (Math.random() < 0.5 ? 1 : -0.4), wd * 0.5, depth + 1);
            for (let j = 0; j < (depth ? 2 : 1); j++) leaves.push([px + rand(-16, 16) * s, py + rand(-14, 16) * s, rand(8, 14) * s, rand(0, TAU)]);
          }
        };
        twig(bx0, by0, bx1, by1, 7 * s, 0);
        const leaf = (lx, ly, r, a, col) => {
          x.save(); x.translate(lx, ly); x.rotate(a);
          x.fillStyle = col; x.beginPath();
          for (let i = 0; i < 14; i++) {
            const ang = (i / 14) * TAU, tip = i % 2 === 0, rr = tip ? r * (i === 0 ? 1.15 : i === 7 ? 0.5 : 0.95) : r * 0.36;
            x.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr);
          }
          x.closePath(); x.fill();
          x.restore();
        };
        for (const [lx, ly, r, a] of leaves) leaf(lx + 9 * s, ly + 14 * s, r, a, 'rgba(0,14,10,0.2)');
        for (const [lx, ly, r, a] of leaves) leaf(lx, ly, r, a, pick(['#c7452c', '#e0702e', '#e59a34', '#b8362a', '#d4572c', '#8fa040']));
      });

      const n = clamp(Math.round((w * h) / 420), 300, 2600);
      this.pts = Array.from({ length: n }, () => ({ x: rand(0, w), y: rand(0, bankY), p: rand(0, TAU), z: rand(0.6, 1.4) }));
      this.vignette(0.5);
      if (!this.pads) {
        const list = wide
          ? [[0.12, 0.3, 40, 1], [0.19, 0.2, 28, 0], [0.07, 0.48, 26, 0], [0.2, 0.44, 20, 0], [0.82, 0.66, 38, 0], [0.9, 0.52, 28, 1], [0.74, 0.76, 24, 0], [0.5, 0.2, 22, 0]]
          : [[0.2, 0.33, 36, 1], [0.37, 0.27, 24, 0], [0.1, 0.45, 24, 0], [0.76, 0.7, 34, 0], [0.9, 0.8, 24, 1], [0.64, 0.82, 20, 0], [0.86, 0.58, 17, 0]];
        this.pads = list.map(([fx, fy, r, flower]) => ({ fx, fy, r, flower, a: rand(0, TAU), p: rand(0, TAU) }));
        this.leaves = ['#c98a2e', '#b65a2a', '#d4572c', '#a8a84a', '#e0702e'].slice(0, wide ? 5 : 3).map((color) => ({
          x: rand(0.15, 0.85) * w, y: rand(0.3, 0.8) * bankY, a: rand(0, TAU), va: rand(-0.08, 0.08), vx: rand(-5, 5) * s, vy: rand(-3, 3) * s, len: rand(20, 28) * s, color,
        }));
        this.striders = [0, 1].map(() => ({ x: rand(0.2, 0.8) * w, y: rand(0.3, 0.8) * bankY, a: rand(0, TAU), rest: rand(0.5, 2), hop: 0 }));
        for (let i = 0; i < (wide ? 7 : 5); i++) {
          const spec = KOI[i % KOI.length];
          this.koi.push({
            x: rand(0.2, 0.8) * w, y: rand(0.3, 0.75) * bankY, a: rand(0, TAU), turn: 0, vis: 0, boost: 0, flee: null, phase: rand(0, TAU),
            len: rand(78, 112) * s, base: rand(16, 26) * s, spec,
            marks: Array.from({ length: 3 + Math.floor(rand(0, 3)) }, () => ({ i: 1 + Math.floor(rand(0, 7)), off: rand(-0.7, 0.7), r: rand(0.07, 0.13), c: pick(spec.marks) })),
          });
        }
      }
    }

    ripple(x, y, power) { this.ripples.push({ x, y, age: 0, max: 4.5 * Math.min(1, power + 0.3), power }); }

    down(x, y) {
      if (y > this.bankAt(x)) return;
      this.ripple(x, y, 1.2);
      for (const f of this.koi) {                                   // 가까운 잉어는 놀라서 달아나요
        const d = Math.hypot(f.x - x, f.y - y);
        if (d < 170 * this.s) { f.flee = Math.atan2(f.y - y, f.x - x) + rand(-0.4, 0.4); f.boost = 1; }
      }
    }
    action(name) {
      if (name === 'drizzle') { this.drizzle = !this.drizzle; this.next = 0; }
      this.sync();
    }
    sync() {
      const sc = this.screen;
      if (!sc) return;
      sc.querySelectorAll('[data-shore-act="drizzle"]').forEach((b) => {
        b.classList.toggle('on', this.drizzle);
        const label = b.querySelector('[data-label]');
        if (label) label.textContent = this.drizzle ? '빗방울 그치기' : '빗방울 떨어뜨리기';
      });
      sc.querySelectorAll('[data-stat="drizzle"]').forEach((e) => { e.textContent = this.drizzle ? '켜짐' : '꺼짐'; });
      sc.querySelectorAll('[data-stat="koi"]').forEach((e) => { e.textContent = String(this.koi.length); });
    }

    step(dt) {
      const { w, s, bankY } = this;
      this.t += dt;
      const t = this.t;
      this.next -= dt;
      if (this.next <= 0) {
        const x = rand(0.05, 0.95) * w;
        this.ripple(x, rand(0.05, 0.95) * this.bankAt(x), this.drizzle ? rand(0.35, 0.75) : rand(0.5, 0.9));
        this.next = this.drizzle ? rand(0.1, 0.35) : rand(1.6, 3.2);
      }
      if (this.autoTap) {
        this.nextTap -= dt;
        if (this.nextTap <= 0) { this.nextTap = this.autoTap; const f = pick(this.koi); this.down(clamp(f.x + rand(-50, 50) * s, 30, w - 30), clamp(f.y + rand(-50, 50) * s, 120, bankY - 40)); }
      }
      for (const r of this.ripples) r.age += dt;
      this.ripples = this.ripples.filter((r) => r.age < r.max);
      const m = 60 * s, cx = w / 2, cy = bankY * 0.52;
      for (const f of this.koi) {
        f.turn += rand(-1, 1) * dt * 1.4;
        f.turn *= 1 - 0.6 * dt;
        let steer = f.turn;
        const out = f.x < m || f.x > w - m || f.y < m * 1.3 || f.y > this.bankAt(f.x) - 70 * s;
        if (out) steer += wrap(Math.atan2(cy - f.y, cx - f.x) - f.a) * 1.4;
        if (f.flee != null) {
          steer += wrap(f.flee - f.a) * 7;
          if (f.boost < 0.5) f.flee = null;
        }
        f.boost *= Math.exp(-dt * 1.3);
        f.a += steer * dt;
        f.vis += (steer - f.vis) * Math.min(1, dt * 4);
        const speed = f.base * (1 + f.boost * 6);
        f.x += Math.cos(f.a) * speed * dt; f.y += Math.sin(f.a) * speed * dt;
        f.phase += dt * (2.2 + speed / (9 * s));
      }
      for (const L of this.leaves) {
        for (const r of this.ripples) {
          const dx = L.x - r.x, dy = L.y - r.y, d = Math.hypot(dx, dy) || 1;
          if (Math.abs(d - r.age * 42 * s) < 8 * s) { L.vx += (dx / d) * 60 * s * dt * r.power; L.vy += (dy / d) * 60 * s * dt * r.power; }
        }
        L.vx *= 1 - 0.3 * dt; L.vy *= 1 - 0.3 * dt;
        L.x += (L.vx + 3 * s) * dt; L.y += (L.vy + Math.sin(t * 0.2 + L.a) * 2 * s) * dt; L.a += L.va * dt;
        if (L.x > w + 40 * s) L.x = -40 * s;
        L.y = clamp(L.y, 40 * s, bankY - 40 * s);
      }
      for (const st of this.striders) {
        st.rest -= dt;
        if (st.rest <= 0) {
          st.rest = rand(0.7, 2.4); st.hop = 0.22;
          st.a += rand(-1.2, 1.2);
          if (st.x < m || st.x > w - m || st.y < m * 2 || st.y > bankY - m * 1.5) st.a = Math.atan2(cy - st.y, cx - st.x);
          this.ripples.push({ x: st.x, y: st.y, age: 0, max: 1.1, power: 0.3 });
        }
        if (st.hop > 0) { st.hop -= dt; st.x += Math.cos(st.a) * 120 * s * dt; st.y += Math.sin(st.a) * 120 * s * dt; }
      }
    }

    drawKoi(ctx, f, shadow) {
      const L = f.len, n = PROFILE.length - 1, W = L * 0.135;
      const dx = Math.cos(f.a), dy = Math.sin(f.a), nx = -dy, ny = dx;
      const hx = f.x + dx * L * 0.5, hy = f.y + dy * L * 0.5;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const k = i / n, d = k * L;
        const lat = Math.sin(f.phase - i * 0.55) * L * 0.075 * Math.pow(k, 1.2) - f.vis * L * 0.22 * k * k;
        pts.push([hx - dx * d + nx * lat, hy - dy * d + ny * lat]);
      }
      const body = () => {
        ctx.beginPath();
        for (let i = 0; i <= n; i++) { const p = pts[i], wd = PROFILE[i] * W; if (i) ctx.lineTo(p[0] + nx * wd, p[1] + ny * wd); else ctx.moveTo(p[0] + nx * wd, p[1] + ny * wd); }
        for (let i = n; i >= 0; i--) { const p = pts[i], wd = PROFILE[i] * W; ctx.lineTo(p[0] - nx * wd, p[1] - ny * wd); }
        ctx.closePath();
      };
      const tail = pts[n], pre = pts[n - 1];
      const tx = tail[0] - pre[0], ty = tail[1] - pre[1], tl = Math.hypot(tx, ty) || 1;
      const fins = () => {
        ctx.beginPath();                                             // 꼬리
        ctx.moveTo(tail[0], tail[1]);
        ctx.quadraticCurveTo(tail[0] + (tx / tl) * L * 0.1 + nx * L * 0.04, tail[1] + (ty / tl) * L * 0.1 + ny * L * 0.04, tail[0] + (tx / tl) * L * 0.2 + nx * L * 0.12, tail[1] + (ty / tl) * L * 0.2 + ny * L * 0.12);
        ctx.lineTo(tail[0] + (tx / tl) * L * 0.13, tail[1] + (ty / tl) * L * 0.13);
        ctx.lineTo(tail[0] + (tx / tl) * L * 0.2 - nx * L * 0.12, tail[1] + (ty / tl) * L * 0.2 - ny * L * 0.12);
        ctx.quadraticCurveTo(tail[0] + (tx / tl) * L * 0.1 - nx * L * 0.04, tail[1] + (ty / tl) * L * 0.1 - ny * L * 0.04, tail[0], tail[1]);
        ctx.fill();
        for (const side of [-1, 1]) {                                // 가슴지느러미
          const p = pts[3], flap = 0.95 + 0.2 * Math.sin(f.phase * 0.7 + side);
          ctx.beginPath();
          ctx.ellipse(p[0] + nx * side * (W + L * 0.05) - dx * L * 0.03, p[1] + ny * side * (W + L * 0.05) - dy * L * 0.03, L * 0.1, L * 0.042, f.a + side * (Math.PI - flap), 0, TAU);
          ctx.fill();
        }
      };
      if (shadow) { ctx.fillStyle = 'rgba(0,16,14,0.3)'; body(); ctx.fill(); fins(); return; }
      ctx.fillStyle = f.spec.base; ctx.globalAlpha = 0.6; fins(); ctx.globalAlpha = 1;
      body(); ctx.fill();
      ctx.save(); ctx.clip();
      for (const mkk of f.marks) {
        const p = pts[mkk.i];
        ctx.fillStyle = mkk.c;
        ctx.beginPath(); ctx.ellipse(p[0] + nx * mkk.off * W, p[1] + ny * mkk.off * W, mkk.r * L * 1.3, mkk.r * L, f.a, 0, TAU); ctx.fill();
      }
      ctx.strokeStyle = 'rgba(255,255,255,0.22)'; ctx.lineWidth = W * 0.2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pts[2][0], pts[2][1]); for (let i = 3; i <= 7; i++) ctx.lineTo(pts[i][0], pts[i][1]); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = 'rgba(10,12,14,0.8)';
      for (const side of [-1, 1]) { ctx.beginPath(); ctx.arc(pts[1][0] + nx * side * W * 0.62, pts[1][1] + ny * side * W * 0.62, L * 0.014, 0, TAU); ctx.fill(); }
    }

    padPos(pd) {
      const { s, t } = this;
      let x = pd.fx * this.w + Math.sin(t * 0.4 + pd.p) * 2 * s, y = pd.fy * this.bankY + Math.cos(t * 0.33 + pd.p) * 2 * s;
      for (const r of this.ripples) {                                // 물결이 지나가면 살짝 밀려요
        const dx = x - r.x, dy = y - r.y, d = Math.hypot(dx, dy) || 1, off = d - r.age * 42 * s;
        if (Math.abs(off) < 16 * s) { const k = (1 - Math.abs(off) / (16 * s)) * 3.5 * s * r.power * (1 - r.age / r.max); x += (dx / d) * k; y += (dy / d) * k; }
      }
      return [x, y];
    }

    drawPad(ctx, pd) {
      const s = this.s, r = pd.r * s, [x, y] = this.padPos(pd);
      const a = pd.a + Math.sin(this.t * 0.15 + pd.p) * 0.05;
      ctx.fillStyle = 'rgba(0,14,12,0.35)';
      ctx.beginPath(); ctx.ellipse(x + 5 * s, y + 8 * s, r, r * 0.96, 0, 0, TAU); ctx.fill();
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
      g.addColorStop(0, '#5aa862'); g.addColorStop(1, '#27663f');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, a + 0.22, a + TAU - 0.22); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(170,230,170,0.24)'; ctx.lineWidth = Math.max(0.6, 0.8 * s);
      ctx.beginPath();
      for (let i = 1; i < 8; i++) { const va = a + 0.22 + (i / 8) * (TAU - 0.44); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(va) * r * 0.9, y + Math.sin(va) * r * 0.9); }
      ctx.stroke();
      if (!pd.flower) return;
      const fx = x + r * 0.5, fy = y - r * 0.55, R = r * 0.62;       // 수련
      ctx.fillStyle = 'rgba(0,14,12,0.3)'; ctx.beginPath(); ctx.arc(fx + 4 * s, fy + 7 * s, R * 0.9, 0, TAU); ctx.fill();
      for (const [count, rad, col, rot] of [[9, R, '#f3b6c8', 0], [7, R * 0.72, '#f9d6e0', 0.4], [5, R * 0.45, '#fff2f5', 0.2]]) {
        ctx.fillStyle = col;
        for (let i = 0; i < count; i++) {
          const pa = (i / count) * TAU + rot + pd.p;
          ctx.beginPath(); ctx.ellipse(fx + Math.cos(pa) * rad * 0.5, fy + Math.sin(pa) * rad * 0.5, rad * 0.52, rad * 0.21, pa, 0, TAU); ctx.fill();
        }
      }
      ctx.fillStyle = '#f0c12e'; ctx.beginPath(); ctx.arc(fx, fy, R * 0.16, 0, TAU); ctx.fill();
    }

    draw() {
      const { ctx, w, h, s, t, dpr, bankY } = this;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.drawImage(this.bg, 0, 0, w, h);
      /* 잉어: 바닥 그림자 먼저 */
      ctx.save(); ctx.translate(9 * s, 15 * s);
      for (const f of this.koi) this.drawKoi(ctx, f, true);
      ctx.restore();
      for (const f of this.koi) this.drawKoi(ctx, f, false);
      ctx.fillStyle = 'rgba(16,84,74,0.2)'; ctx.fillRect(0, 0, w, bankY + 30 * s);   // 물빛이 한 겹 덮여요
      for (const r of this.ripples) {
        const k = r.age / r.max;
        for (let j = 0; j < 3; j++) {
          const rad = (r.age * 42 - j * 11) * s;
          if (rad <= 0) continue;
          const a = (1 - k) * (0.4 - j * 0.1) * r.power;
          ctx.strokeStyle = `rgba(200,255,245,${a})`; ctx.lineWidth = Math.max(0.8, 1.6 * s);
          ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, TAU); ctx.stroke();
          ctx.strokeStyle = `rgba(0,22,20,${a * 0.7})`; ctx.lineWidth = Math.max(0.8, 2 * s);
          ctx.beginPath(); ctx.arc(r.x, r.y, Math.max(0, rad - 3 * s), 0, TAU); ctx.stroke();
        }
      }
      /* 윤슬 */
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgb(255,248,220)';
      const dim = this.drizzle ? 0.35 : 1, spark = glow(255, 240, 200);
      for (const p of this.pts) {
        const f = Math.sin((p.x * 0.028) / s + t * 0.6) + Math.sin((p.y * 0.041) / s - t * 0.5 + (p.x * 0.01) / s) + 0.7 * Math.sin(((p.x - p.y) * 0.019) / s + t * 0.9);
        let b = smooth(1.1, 2.4, f);
        if (b <= 0.01) continue;
        b *= (0.45 + 0.55 * Math.sin(t * 5 + p.p * 7)) * dim;
        if (b <= 0.03) continue;
        const sz = (0.8 + 3 * b) * p.z * s;
        ctx.globalAlpha = Math.min(1, b * 1.1);
        ctx.fillRect(p.x - sz, p.y - 0.5, sz * 2, 1);
        ctx.fillRect(p.x - 0.5, p.y - sz * 0.6, 1, sz * 1.2);
        if (b > 0.55) { ctx.globalAlpha = b * 0.2; ctx.drawImage(spark, p.x - sz * 2, p.y - sz * 2, sz * 4, sz * 4); }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (const pd of this.pads) this.drawPad(ctx, pd);
      for (const L of this.leaves) {
        for (const [ox, oy, col] of [[6 * s, 9 * s, 'rgba(0,14,12,0.35)'], [0, 0, L.color]]) {
          ctx.save(); ctx.translate(L.x + ox, L.y + oy); ctx.rotate(L.a);
          ctx.fillStyle = col;
          ctx.beginPath(); ctx.moveTo(-L.len * 0.5, 0); ctx.quadraticCurveTo(0, -L.len * 0.42, L.len * 0.5, 0); ctx.quadraticCurveTo(0, L.len * 0.42, -L.len * 0.5, 0); ctx.fill();
          ctx.restore();
        }
      }
      /* 소금쟁이 */
      for (const st of this.striders) {
        ctx.save(); ctx.translate(st.x, st.y); ctx.rotate(st.a);
        ctx.fillStyle = 'rgba(0,14,12,0.35)';
        for (const [lx, ly] of [[7, -8], [7, 8], [-8, -7], [-8, 7]]) { ctx.beginPath(); ctx.ellipse(lx * s + 3 * s, ly * s + 5 * s, 2.6 * s, 1.6 * s, 0, 0, TAU); ctx.fill(); }
        ctx.strokeStyle = 'rgba(20,24,20,0.85)'; ctx.lineWidth = Math.max(0.7, 0.8 * s);
        ctx.beginPath();
        for (const [lx, ly] of [[7, -8], [7, 8], [-8, -7], [-8, 7]]) { ctx.moveTo(0, 0); ctx.lineTo(lx * s, ly * s); }
        ctx.stroke();
        ctx.lineWidth = 2 * s; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-4 * s, 0); ctx.lineTo(4 * s, 0); ctx.stroke();
        ctx.restore();
      }
      ctx.drawImage(this.front, 0, 0, w, h);
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
  }

  /* ===================================================================== */
  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__shore.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    const mount = (sel, Cls) => document.querySelectorAll(sel).forEach((c) => {
      const sc = new Cls(c);
      c.__shore = sc;
      scenes.push(sc);
      for (let i = 0; i < 75; i++) sc.step(1 / 30);
      sc.draw();
      if (io) io.observe(c);
      const at = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * (sc.w / r.width), (e.clientY - r.top) * (sc.h / r.height)]; };
      c.addEventListener('pointerdown', (e) => { try { c.setPointerCapture(e.pointerId); } catch (_) { /* 없어도 돼요 */ } sc.down(...at(e)); });
      c.addEventListener('pointermove', (e) => { if (e.buttons || e.pointerType === 'touch') sc.move(...at(e)); });
      c.addEventListener('pointerup', () => sc.up());
      c.addEventListener('pointercancel', () => sc.up());
    });
    mount('canvas[data-sea2]', Sea2);
    mount('canvas[data-pond2]', Pond2);
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-shore-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-sea2], canvas[data-pond2]');
      if (c && c.__shore) c.__shore.action(b.dataset.shoreAct, b.dataset.value);
    });
    let last = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (!last) { last = now; return; }
      const elapsed = (now - last) / 1000;
      if (elapsed < 1 / 31) return;
      last = now;
      const dt = Math.min(elapsed, 0.1);
      for (const sc of scenes) {
        if (!sc.visible) continue;
        sc.step(dt);
        sc.draw();
      }
    };
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
