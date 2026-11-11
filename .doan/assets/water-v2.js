/* mong — 물멍 · 어항 v2 시안용 장면 (Doan 보드 전용). 코드(src/scenes/aquarium.ts)에는 아직 없어요.
   지금 어항은 물속 한가운데에서 보는 그림이라 '어항'이 보이지 않아요. v2는 어두운 방에서
   불 켜진 어항을 옆에서 보는 자리예요: 수면과 그 위 공기층, 유리 모서리, 받침장이 보여요.
   <canvas data-aqua2> 하나가 장면 하나. 같은 .screen 안의 [data-aqua2-act] 버튼이 장면을 조작해요.
     data-light="day|moon"    조명 (기본 day)
     data-auto-feed="6"       n초마다 먹이를 줘요 (설명용) */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  const FISH = {
    neon: { len: 24, h: 0.34, body: ['#d5e0ea', '#7f93a8'], belly: '#e8eef3', fin: 'rgba(220,235,245,0.35)', speed: 52 },
    gold: { len: 44, h: 0.5, body: ['#ffab45', '#ff6f24'], belly: '#ffd89c', fin: 'rgba(255,140,60,0.55)', speed: 38 },
    pearl: { len: 54, h: 0.5, body: ['#e9e3c9', '#a9a68e'], belly: '#f6f1df', fin: 'rgba(240,232,205,0.35)', speed: 30 },
    cory: { len: 30, h: 0.46, body: ['#c2b292', '#6f6552'], belly: '#eee4cc', fin: 'rgba(214,200,170,0.4)', speed: 24 },
  };

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

  class Aqua2 {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.screen = canvas.closest('.screen');
      const d = canvas.dataset;
      this.moon = d.light === 'moon';
      this.night = this.moon ? 1 : 0;
      this.autoFeed = Number(d.autoFeed) || 0;
      this.nextFeed = 2;
      this.visible = true;
      this.t = 0;
      this.fish = [];
      this.food = [];
      this.bubbles = [];
      this.taps = [];
      this.ripples = [];
      this.bubbleAcc = 0;
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
      const s = (this.s = clamp(Math.sqrt(w * h) / 573, 0.45, 1.25));
      this.wide = w > 900;
      this.surfY = this.wide ? 138 : 164;           // 수면
      this.cabY = h - (this.wide ? 124 : 168);      // 받침장 윗면
      this.floorY = this.cabY - 9 * s;              // 어항 바닥 안쪽
      this.gl = 7 * s;                              // 옆 유리 두께
      const fl = this.floorY;
      const bump = (x, c0, sd) => Math.exp(-Math.pow((x / w - c0) / sd, 2));
      this.sandAt = (x) => fl - (40 + 40 * bump(x, 0.1, 0.2) + 30 * bump(x, 0.88, 0.16)) * s - Math.sin(x * 0.02) * 3 * s;
      this.box = { l: this.gl + 26 * s, r: w - this.gl - 26 * s, t: this.surfY + 30 * s, b: fl - 96 * s };
      this.build();
    }

    randPoint() {
      const b = this.box;
      return { x: rand(b.l, b.r), y: rand(b.t, b.b) };
    }
    sandPoint() {
      const x = rand(this.box.l, this.box.r);
      return { x, y: this.sandAt(x) - 9 * this.s };
    }

    /* ---------- 돌 · 유목 ---------- */
    rock(x, cx, base, rw, rh) {
      const n = 7, pts = [];
      for (let i = 0; i < n; i++) {
        const a = Math.PI + (i / (n - 1)) * Math.PI;
        const j = i === 0 || i === n - 1 ? 1 : rand(0.78, 1.12);
        pts.push([cx + Math.cos(a) * rw * j, base + Math.sin(a) * rh * j]);
      }
      const path = (list) => { x.beginPath(); list.forEach((p, i) => (i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]))); x.closePath(); };
      const g = x.createLinearGradient(0, base - rh, 0, base);
      g.addColorStop(0, '#8b9a9b'); g.addColorStop(0.5, '#4d5f63'); g.addColorStop(1, '#1b282c');
      x.fillStyle = g; path(pts); x.fill();
      const mid = [cx + rand(-0.15, 0.15) * rw, base - rh * 0.45];
      x.fillStyle = 'rgba(214,236,232,0.2)'; path([pts[1], pts[2], pts[3], mid]); x.fill();
      x.fillStyle = 'rgba(0,0,0,0.26)'; path([pts[4], pts[5], pts[6], mid]); x.fill();
      x.strokeStyle = 'rgba(0,0,0,0.3)'; x.lineWidth = Math.max(0.8, this.s);
      x.beginPath(); x.moveTo(pts[3][0], pts[3][1]); x.lineTo(mid[0], mid[1]); x.lineTo(pts[5][0], pts[5][1]); x.stroke();
    }

    branch(x, x0, y0, ang, len, wd, depth, moss) {
      const s = this.s, n = 12;
      let px = x0, py = y0, a = ang;
      const pts = [[px, py]];
      for (let i = 1; i <= n; i++) {
        a += rand(-0.16, 0.16) + (depth === 0 ? 0.035 : 0);
        px += Math.cos(a) * (len / n); py += Math.sin(a) * (len / n);
        pts.push([px, py]);
        if (depth < 2 && (i === 5 || i === 9) && Math.random() < 0.85) {
          this.branch(x, px, py, a + (i === 5 ? -1 : 1) * rand(0.5, 0.9), len * rand(0.35, 0.5), wd * (1 - i / n) * 0.75 + 2 * s, depth + 1, moss);
        }
      }
      x.lineCap = 'round';
      for (let i = 1; i <= n; i++) {
        const k = 1 - (i / n) * 0.85;
        x.strokeStyle = '#3b281f'; x.lineWidth = wd * k;
        x.beginPath(); x.moveTo(pts[i - 1][0], pts[i - 1][1]); x.lineTo(pts[i][0], pts[i][1]); x.stroke();
      }
      for (let i = 1; i <= n; i++) {
        const k = 1 - (i / n) * 0.85;
        x.strokeStyle = 'rgba(168,128,96,0.5)'; x.lineWidth = wd * k * 0.3;
        x.beginPath(); x.moveTo(pts[i - 1][0], pts[i - 1][1] - wd * k * 0.26); x.lineTo(pts[i][0], pts[i][1] - wd * k * 0.26); x.stroke();
        if (depth < 2 && Math.random() < 0.4) moss.push([pts[i][0], pts[i][1] - wd * k * 0.4, rand(4, 8) * s * (depth ? 0.7 : 1)]);
      }
    }

    build() {
      const { w, h, s, dpr, surfY, cabY, floorY, gl, sandAt } = this;
      /* 뒤 배경: 방 · 수면 위 공기층 · 물 · 모래 · 돌 · 유목 */
      this.bg = layer(w, h, dpr, (x) => {
        x.fillStyle = '#06080a'; x.fillRect(0, 0, w, h);
        let g = x.createLinearGradient(0, 0, 0, surfY);
        g.addColorStop(0, '#16292c'); g.addColorStop(1, '#0b181b');
        x.fillStyle = g; x.fillRect(0, 0, w, surfY);
        g = x.createLinearGradient(0, 0, 0, surfY * 0.8);           // 위 조명
        g.addColorStop(0, 'rgba(210,250,255,0.5)'); g.addColorStop(0.25, 'rgba(160,235,240,0.16)'); g.addColorStop(1, 'rgba(160,235,240,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, surfY);
        g = x.createLinearGradient(0, surfY, 0, floorY);
        g.addColorStop(0, '#2c9fa9'); g.addColorStop(0.22, '#14606f'); g.addColorStop(0.65, '#0a3645'); g.addColorStop(1, '#06212b');
        x.fillStyle = g; x.fillRect(0, surfY, w, floorY - surfY);
        g = x.createRadialGradient(w / 2, surfY, 0, w / 2, surfY, Math.max(w * 0.6, (floorY - surfY) * 0.9));
        g.addColorStop(0, 'rgba(150,240,235,0.22)'); g.addColorStop(1, 'rgba(150,240,235,0)');
        x.fillStyle = g; x.fillRect(0, surfY, w, floorY - surfY);
        for (const side of [0, 1]) {                                 // 뒤 모서리 어둠
          g = x.createLinearGradient(side ? w : 0, 0, side ? w - w * 0.3 : w * 0.3, 0);
          g.addColorStop(0, 'rgba(2,14,20,0.6)'); g.addColorStop(1, 'rgba(2,14,20,0)');
          x.fillStyle = g; x.fillRect(side ? w * 0.7 : 0, surfY, w * 0.3, floorY - surfY);
        }
        x.fillStyle = 'rgba(6,50,56,0.5)';                           // 멀리 흐린 수초
        for (let i = 0; i < Math.round(w / 46); i++) {
          x.beginPath(); x.ellipse(rand(0, w), floorY - 30 * s, rand(14, 30) * s, rand(70, 230) * s, 0, Math.PI, TAU); x.fill();
        }
        /* 모래 */
        x.beginPath(); x.moveTo(0, floorY);
        for (let px = 0; px <= w + 6; px += 6) x.lineTo(px, sandAt(px));
        x.lineTo(w + 6, floorY); x.closePath();
        g = x.createLinearGradient(0, floorY - 90 * s, 0, floorY);
        g.addColorStop(0, '#d8cba3'); g.addColorStop(0.45, '#a3966f'); g.addColorStop(1, '#4f4a38');
        x.fillStyle = g; x.fill();
        x.save(); x.clip();
        for (let i = 0; i < Math.round(w / 2.4); i++) {
          const px = rand(0, w), py = sandAt(px) + rand(2, 80) * s;
          x.fillStyle = pick(['rgba(255,246,214,0.5)', 'rgba(120,108,80,0.6)', 'rgba(70,66,52,0.5)', 'rgba(226,212,170,0.6)']);
          x.beginPath(); x.ellipse(px, py, rand(0.8, 2.6) * s, rand(0.6, 1.8) * s, 0, 0, TAU); x.fill();
        }
        g = x.createLinearGradient(0, floorY - 16 * s, 0, floorY);  // 바닥 쪽 그늘
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
        x.fillStyle = g; x.fillRect(0, floorY - 16 * s, w, 16 * s);
        x.restore();
        /* 돌 */
        const rx = w * 0.8;
        this.rock(x, rx - 44 * s, sandAt(rx - 44 * s) + 8 * s, 34 * s, 46 * s);
        this.rock(x, rx + 6 * s, sandAt(rx) + 10 * s, 52 * s, 86 * s);
        this.rock(x, rx + 58 * s, sandAt(rx + 58 * s) + 8 * s, 30 * s, 38 * s);
        this.rock(x, w * 0.36, sandAt(w * 0.36) + 6 * s, 22 * s, 20 * s);
        /* 유목과 이끼 */
        const moss = [];
        const wx = w * 0.07;
        this.branch(x, wx, sandAt(wx) + 6 * s, -0.62, Math.min(w * 0.56, 330 * s), 22 * s, 0, moss);
        for (const [mx, my, mr] of moss) {
          for (let i = 0; i < 5; i++) {
            x.fillStyle = pick(['#2f8f55', '#3aa767', '#256f47']);
            x.beginPath(); x.arc(mx + rand(-1, 1) * mr, my + rand(-0.5, 0.5) * mr, mr * rand(0.5, 0.9), 0, TAU); x.fill();
          }
          x.fillStyle = 'rgba(190,255,200,0.35)';
          x.beginPath(); x.arc(mx - mr * 0.3, my - mr * 0.4, mr * 0.3, 0, TAU); x.fill();
        }
        /* 바닥을 덮은 낮은 풀 */
        for (let px = gl; px < w - gl; px += rand(2.5, 5) * s) {
          const d = Math.abs(px / w - 0.52);
          if (d < 0.13 && Math.random() < 0.8) continue;             // 가운데 앞은 모래를 비워요
          const py = sandAt(px) + rand(0, 5) * s, bh = rand(5, 15) * s;
          x.strokeStyle = pick(['#3fae6a', '#2b8a55', '#58c07a', '#237048']);
          x.lineWidth = rand(1, 2) * s; x.lineCap = 'round';
          x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + rand(-3, 3) * s, py - bh * 0.6, px + rand(-5, 5) * s, py - bh); x.stroke();
        }
      });

      /* 앞 유리 · 바닥 테 · 받침장 */
      this.front = layer(w, h, dpr, (x) => {
        let g;
        x.save();
        x.beginPath(); x.rect(gl, 0, w - gl * 2, floorY); x.clip();
        x.globalCompositeOperation = 'lighter';                       // 유리에 비친 빛
        for (const [fx, fw, a] of [[0.16, 0.1, 0.035], [0.3, 0.035, 0.03], [0.74, 0.07, 0.022]]) {
          x.fillStyle = `rgba(220,245,255,${a})`;
          x.beginPath();
          x.moveTo(w * fx, 0); x.lineTo(w * (fx + fw), 0);
          x.lineTo(w * (fx + fw) - floorY * 0.34, floorY); x.lineTo(w * fx - floorY * 0.34, floorY);
          x.closePath(); x.fill();
        }
        x.restore();
        for (const side of [0, 1]) {                                  // 옆 유리 모서리
          const x0 = side ? w - gl : 0;
          g = x.createLinearGradient(x0, 0, x0 + gl, 0);
          const a = side ? [1, 0.5, 0] : [0, 0.5, 1];
          g.addColorStop(a[0], 'rgba(6,20,22,0.95)'); g.addColorStop(a[1], 'rgba(60,150,140,0.75)'); g.addColorStop(a[2], 'rgba(190,255,240,0.7)');
          x.fillStyle = g; x.fillRect(x0, 0, gl, floorY);
        }
        x.fillStyle = '#040607'; x.fillRect(0, floorY, w, cabY - floorY);
        x.fillStyle = 'rgba(150,240,225,0.28)'; x.fillRect(0, floorY, w, Math.max(1, s));
        g = x.createLinearGradient(0, cabY, 0, h);
        g.addColorStop(0, '#221a15'); g.addColorStop(0.12, '#17120f'); g.addColorStop(1, '#080606');
        x.fillStyle = g; x.fillRect(0, cabY, w, h - cabY);
        x.fillStyle = 'rgba(255,255,255,0.025)';
        for (let i = 0; i < 9; i++) x.fillRect(0, cabY + rand(14, h - cabY) , w, Math.max(1, s));
        g = x.createLinearGradient(0, cabY, 0, cabY + 70 * s);       // 어항 불빛이 받침장에 번져요
        g.addColorStop(0, 'rgba(90,220,205,0.2)'); g.addColorStop(1, 'rgba(90,220,205,0)');
        x.fillStyle = g; x.fillRect(0, cabY, w, 70 * s);
        x.fillStyle = 'rgba(170,250,235,0.3)'; x.fillRect(0, cabY, w, Math.max(1, s));
      });

      const vg = (this.vig = mk(w, h)).getContext('2d');
      const g = vg.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.34, w / 2, h * 0.45, Math.hypot(w, h) * 0.62);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.42)');
      vg.fillStyle = g; vg.fillRect(0, 0, w, h);

      /* 수초: 줄기풀(잎이 마주 나요)과 긴 잎 */
      this.stems = [];
      this.blades = [];
      const groups = this.wide
        ? [[0.035, 5, 0], [0.12, 4, 1], [0.6, 3, 0], [0.93, 4, 1], [0.975, 3, 0]]
        : [[0.05, 4, 0], [0.16, 3, 1], [0.95, 4, 1]];
      for (const [fx, count, red] of groups) {
        for (let i = 0; i < count; i++) {
          const px = w * fx + rand(-16, 16) * s;
          this.stems.push({ x: px, base: sandAt(px) + 3 * s, h: Math.min(rand(150, 300) * s, (floorY - surfY) * 0.72), p: rand(0, TAU), sp: rand(0.5, 0.9), red, leaf: rand(8, 11) * s });
        }
      }
      for (const fx of this.wide ? [0.02, 0.2, 0.5, 0.66, 0.99] : [0.01, 0.27, 0.99]) {
        for (let i = 0; i < 4; i++) {
          const px = w * fx + rand(-14, 14) * s;
          this.blades.push({ x: px, base: sandAt(px) + 4 * s, h: Math.min(rand(170, 380) * s, (floorY - surfY) * 0.9), bw: rand(6, 12) * s, color: pick(['#2f8c63', '#3aa275', '#24785a', '#2a6e4f']), p: rand(0, TAU), sp: rand(0.5, 0.9), front: fx < 0.03 || fx > 0.97 });
        }
      }
      this.rays = Array.from({ length: this.wide ? 7 : 5 }, () => ({ x: rand(0, w), w: rand(30, 90) * s, p: rand(0, TAU), a: rand(0.5, 1) }));
      this.stone = { x: w * 0.66, y: sandAt(w * 0.66) - 2 * s };
      this.snail = { x: w * 0.9, y: floorY - 150 * s, a: -2.2 };
      if (!this.fish.length) this.spawn();
      this.school = { x: w * 0.5, y: (this.box.t + this.box.b) / 2 };
      this.schoolT = this.randPoint();
    }

    spawn() {
      const add = (kind, extra = {}) => {
        const p = kind === 'cory' ? this.sandPoint() : this.randPoint();
        this.fish.push({ kind, x: p.x, y: p.y, vx: 0, vy: 0, dir: Math.random() < 0.5 ? -1 : 1, phase: rand(0, TAU), size: rand(0.9, 1.1), depth: rand(0.65, 1), target: p, rest: 0, ox: 0, oy: 0, ...extra });
      };
      for (let i = 0; i < 12; i++) add('neon', { ox: rand(-70, 70), oy: rand(-34, 34), depth: rand(0.75, 1) });
      add('gold', { depth: 1 });
      add('gold', { depth: 0.8 });
      add('pearl', { depth: 0.9 });
      add('cory', { depth: 1 });
      add('cory', { depth: 0.9 });
      this.fish.sort((a, b) => a.depth - b.depth);
    }

    /* ---------- 조작 ---------- */
    feed(x) {
      const s = this.s;
      const px = clamp(x ?? rand(0.3, 0.7) * this.w, this.box.l, this.box.r);
      this.ripples.push({ x: px, age: 0, big: 1 });
      for (let i = 0; i < 8; i++) {
        this.food.push({ x: px + rand(-18, 18) * s, y: this.surfY + 3 * s, vy: rand(16, 28) * s, p: rand(0, TAU), age: 0, float: rand(0.3, 1.4), settled: false, eaten: false });
      }
    }
    tap(x, y) {
      this.taps.push({ x, y, age: 0 });
      this.feed(x);
    }
    action(name) {
      if (name === 'feed') this.feed();
      if (name === 'light') this.moon = !this.moon;
      this.sync();
    }
    sync() {
      const sc = this.screen;
      if (!sc) return;
      sc.querySelectorAll('[data-aqua2-act="light"]').forEach((b) => b.classList.toggle('on', this.moon));
      sc.querySelectorAll('[data-stat="light"]').forEach((e) => { e.textContent = this.moon ? '달빛' : '낮'; });
      sc.querySelectorAll('[data-stat="fish"]').forEach((e) => { e.textContent = String(this.fish.length); });
    }

    step(dt) {
      const { s, surfY } = this;
      this.t += dt;
      const t = this.t;
      this.night += ((this.moon ? 1 : 0) - this.night) * Math.min(1, dt * 1.6);
      const calm = 1 - 0.45 * this.night;
      if (this.autoFeed) {
        this.nextFeed -= dt;
        if (this.nextFeed <= 0) { this.nextFeed = this.autoFeed; this.feed(rand(0.35, 0.65) * this.w); }
      }
      const sc = this.school, st = this.schoolT;
      const sdx = st.x - sc.x, sdy = st.y - sc.y, sd = Math.hypot(sdx, sdy);
      if (sd < 20 * s) this.schoolT = this.randPoint();
      else { sc.x += (sdx / sd) * 34 * s * calm * dt; sc.y += (sdy / sd) * 20 * s * calm * dt; }
      const food = this.food.filter((p) => !p.eaten);
      for (const f of this.fish) {
        const spec = FISH[f.kind];
        let tx, ty, speed = spec.speed * s * calm;
        let best = null, bd = (f.kind === 'cory' ? 150 : 300) * s;
        for (const p of food) {
          if (f.kind === 'cory' && !p.settled) continue;             // 바닥 물고기는 가라앉은 먹이만
          const dd = Math.hypot(p.x - f.x, p.y - f.y);
          if (dd < bd) { bd = dd; best = p; }
        }
        if (best) { tx = best.x; ty = best.y; speed *= 2.2; }
        else if (f.kind === 'neon') { tx = sc.x + f.ox * s; ty = sc.y + f.oy * s; speed *= 1.2; }
        else {
          if (f.rest > 0) f.rest -= dt;
          else if (Math.hypot(f.target.x - f.x, f.target.y - f.y) < 26 * s) {
            f.target = f.kind === 'cory' ? this.sandPoint() : this.randPoint();
            if (f.kind === 'cory') f.rest = rand(0.6, 2.6);
          }
          tx = f.target.x; ty = f.target.y;
          if (f.rest > 0) speed *= 0.08;
        }
        const dx = tx - f.x, dy = ty - f.y, dist = Math.hypot(dx, dy) || 1;
        const ease = f.kind === 'neon' && !best ? clamp(dist / (40 * s), 0.15, 1) : 1;
        const k = Math.min(1, dt * (best ? 2.6 : 1.1));
        f.vx += ((dx / dist) * speed * ease - f.vx) * k;
        f.vy += ((dy / dist) * speed * 0.55 * ease - f.vy) * k;
        f.x = clamp(f.x + f.vx * dt, this.box.l, this.box.r);
        f.y = clamp(f.y + f.vy * dt, surfY + 14 * s, this.sandAt(f.x) - 8 * s);
        f.phase += dt * (4 + Math.hypot(f.vx, f.vy) / (6 * s));
        if (Math.abs(f.vx) > 3 * s) f.dir += ((f.vx >= 0 ? 1 : -1) - f.dir) * Math.min(1, dt * 3.2);
        if (best && bd < spec.len * s * 0.45) {
          best.eaten = true;
          this.bubbles.push({ x: f.x + Math.sign(f.dir) * spec.len * s * 0.5, y: f.y, r: 1.6 * s, vy: -30 * s, p: rand(0, TAU) });
        }
      }
      for (const p of this.food) {
        p.age += dt;
        if (p.settled || p.age < p.float) continue;                  // 수면에 잠깐 떠 있다가 가라앉아요
        p.y += p.vy * dt;
        p.x += Math.sin(t * 2 + p.p) * 10 * s * dt;
        const floor = this.sandAt(p.x) - 2 * s;
        if (p.y >= floor) { p.y = floor; p.settled = true; }
      }
      this.food = this.food.filter((p) => !p.eaten && p.age < 26);
      this.bubbleAcc += dt * 6;
      while (this.bubbleAcc >= 1) {
        this.bubbleAcc -= 1;
        this.bubbles.push({ x: this.stone.x + rand(-4, 4) * s, y: this.stone.y, r: rand(1.4, 3.4) * s, vy: -rand(40, 70) * s, p: rand(0, TAU) });
      }
      for (const b of this.bubbles) {
        b.vy -= 12 * s * dt; b.y += b.vy * dt;
        b.x += Math.sin(t * 5 + b.p) * 14 * s * dt;
        b.r *= 1 + 0.05 * dt;
        if (b.y <= surfY + 3 * s && Math.random() < 0.3) this.ripples.push({ x: b.x, age: 0, big: 0 });
      }
      this.bubbles = this.bubbles.filter((b) => b.y > surfY + 3 * s);
      for (const r of this.ripples) r.age += dt;
      this.ripples = this.ripples.filter((r) => r.age < (r.big ? 1.6 : 0.8));
      for (const tp of this.taps) tp.age += dt;
      this.taps = this.taps.filter((tp) => tp.age < 0.9);
      /* 유리 위를 기어가는 달팽이 */
      const sn = this.snail;
      sn.a += Math.sin(t * 0.13) * 0.05 * dt;
      sn.x += Math.cos(sn.a) * 2.2 * s * dt; sn.y += Math.sin(sn.a) * 2.2 * s * dt;
      if (sn.x < this.w * 0.55 || sn.x > this.w - this.gl - 14 * s || sn.y < surfY + 60 * s || sn.y > this.floorY - 70 * s) sn.a += Math.PI * 0.6 * dt * 2;
    }

    drawBlade(ctx, p) {
      const s = this.s, t = this.t, segs = 10, pts = [];
      for (let i = 0; i <= segs; i++) {
        const k = i / segs;
        pts.push([p.x + (Math.sin(t * p.sp + p.p + k * 2.4) * 22 * k * k + Math.sin(t * 0.33 + p.p) * 8 * k) * s, p.base - k * p.h]);
      }
      ctx.fillStyle = p.color;
      ctx.beginPath();
      for (let i = 0; i <= segs; i++) { const half = (p.bw * (1 - (i / segs) * 0.9)) / 2; if (i) ctx.lineTo(pts[i][0] - half, pts[i][1]); else ctx.moveTo(pts[i][0] - half, pts[i][1]); }
      for (let i = segs; i >= 0; i--) { const half = (p.bw * (1 - (i / segs) * 0.9)) / 2; ctx.lineTo(pts[i][0] + half, pts[i][1]); }
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(190,255,210,0.16)'; ctx.lineWidth = Math.max(0.6, 0.9 * s);
      ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }

    drawStem(ctx, p) {
      const s = this.s, t = this.t;
      const n = Math.max(6, Math.round(p.h / (13 * s)));
      ctx.strokeStyle = '#2a6a48'; ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const k = i / n;
        const x = p.x + (Math.sin(t * p.sp + p.p + k * 2.2) * 16 * k * k + Math.sin(t * 0.3 + p.p) * 7 * k) * s;
        const y = p.base - k * p.h;
        pts.push([x, y]);
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.stroke();
      for (let i = 1; i <= n; i++) {
        const k = i / n;
        const [x, y] = pts[i];
        // 위로 갈수록 붉어지는 줄기풀은 초록 사이에서 포인트가 돼요
        ctx.fillStyle = p.red ? `rgb(${Math.round(60 + 150 * k * k)},${Math.round(150 - 60 * k * k)},${Math.round(90 - 20 * k)})` : `rgb(${Math.round(50 + 40 * k)},${Math.round(150 + 40 * k)},${Math.round(96 + 10 * k)})`;
        const L = p.leaf * (0.6 + 0.5 * Math.sin(k * Math.PI * 0.9 + 0.3));
        const tilt = 0.5 + 0.12 * Math.sin(t * 1.1 + i + p.p);
        for (const side of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(x + side * L * 0.55 * Math.cos(tilt), y - L * 0.55 * Math.sin(tilt), L * 0.6, L * 0.24, -side * tilt, 0, TAU);
          ctx.fill();
        }
      }
    }

    drawFish(ctx, f) {
      const spec = FISH[f.kind];
      const L = spec.len * this.s * f.size * (0.75 + 0.25 * f.depth);
      const H = L * spec.h;
      const wag = Math.sin(f.phase) * 0.22;
      const flip = (f.dir < 0 ? -1 : 1) * Math.max(0.12, Math.abs(f.dir));
      const pitch = clamp(Math.atan2(f.vy, Math.abs(f.vx) + 0.001), -0.4, 0.4);
      ctx.save();
      ctx.translate(f.x, f.y); ctx.scale(flip, 1); ctx.rotate(pitch);
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
      ctx.save(); ctx.clip();
      if (f.kind === 'neon') {
        ctx.fillStyle = '#ff3d55';
        ctx.beginPath(); ctx.ellipse(-L * 0.14, H * 0.2, L * 0.3, H * 0.24, 0, 0, TAU); ctx.fill();
        ctx.globalCompositeOperation = 'lighter';
        ctx.strokeStyle = '#38d4ff'; ctx.lineWidth = H * 0.2; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(L * 0.3, -H * 0.1); ctx.lineTo(-L * 0.36, -H * 0.02); ctx.stroke();
      } else if (f.kind === 'pearl' || f.kind === 'cory') {
        ctx.fillStyle = f.kind === 'pearl' ? 'rgba(255,255,255,0.55)' : 'rgba(40,34,26,0.5)';
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

    surf(x) {
      const { s, t } = this;
      return this.surfY + Math.sin(x * 0.03 + t * 1.6) * 2 * s + Math.sin(x * 0.011 - t) * 1.6 * s;
    }

    draw() {
      const { ctx, w, h, s, t, dpr, surfY, floorY, gl } = this;
      const N = this.night;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.drawImage(this.bg, 0, 0, w, h);
      ctx.save();
      ctx.beginPath(); ctx.rect(gl, 0, w - gl * 2, floorY); ctx.clip();
      /* 빛줄기 · 모래 위 물그림자 */
      ctx.globalCompositeOperation = 'lighter';
      for (const r of this.rays) {
        const sway = Math.sin(t * 0.22 + r.p) * 36 * s;
        const a = (0.06 + 0.04 * Math.sin(t * 0.55 + r.p * 2)) * r.a;
        const g = ctx.createLinearGradient(0, surfY, 0, floorY);
        g.addColorStop(0, `rgba(180,245,255,${a})`); g.addColorStop(1, 'rgba(180,245,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(r.x - r.w / 2, surfY); ctx.lineTo(r.x + r.w / 2, surfY);
        ctx.lineTo(r.x + r.w * 1.3 + sway + 50 * s, floorY); ctx.lineTo(r.x - r.w * 0.3 + sway + 50 * s, floorY);
        ctx.closePath(); ctx.fill();
      }
      const caustic = glow(190, 255, 235);
      const n = Math.round(w / (26 * s));
      for (let i = 0; i < n; i++) {
        const cx = (i / n) * w + Math.sin(t * 0.5 + i * 1.3) * 18 * s;
        const cy = this.sandAt(cx) + (10 + 8 * Math.sin(i * 2.1)) * s;
        ctx.globalAlpha = 0.12 + 0.09 * Math.sin(t * 1.4 + i * 2.3);
        ctx.drawImage(caustic, cx - 28 * s, cy - 7 * s, 56 * s, 14 * s);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      for (const p of this.blades) if (!p.front) this.drawBlade(ctx, p);
      for (const p of this.stems) this.drawStem(ctx, p);
      for (const f of this.fish) this.drawFish(ctx, f);
      for (const p of this.blades) if (p.front) this.drawBlade(ctx, p);
      ctx.fillStyle = '#d98a42';
      for (const p of this.food) {
        ctx.globalAlpha = p.settled ? clamp((26 - p.age) / 4, 0, 1) : 1;
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
      /* 수면: 아래에서 보면 거울처럼 밝아요 */
      ctx.globalCompositeOperation = 'lighter';
      const sg = ctx.createLinearGradient(0, surfY, 0, surfY + 46 * s);
      sg.addColorStop(0, 'rgba(200,250,255,0.3)'); sg.addColorStop(1, 'rgba(200,250,255,0)');
      ctx.fillStyle = sg;
      ctx.beginPath(); ctx.moveTo(0, surfY + 46 * s);
      for (let x = 0; x <= w + 8; x += 8) ctx.lineTo(x, this.surf(x));
      ctx.lineTo(w + 8, surfY + 46 * s); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(230,255,255,0.75)'; ctx.lineWidth = 1.6 * s;
      ctx.beginPath();
      for (let x = 0; x <= w + 8; x += 8) { const y = this.surf(x); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
      for (const r of this.ripples) {
        const life = r.big ? 1.6 : 0.8, k = r.age / life;
        const half = (r.big ? 10 + 70 * k : 4 + 18 * k) * s;
        ctx.strokeStyle = `rgba(235,255,255,${(r.big ? 0.8 : 0.5) * (1 - k)})`;
        ctx.lineWidth = (r.big ? 2.4 : 1.4) * s;
        ctx.beginPath();
        for (let x = r.x - half; x <= r.x + half; x += 6) { const y = this.surf(x) - 1.5 * s; if (x > r.x - half) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      /* 달팽이 */
      const sn = this.snail, sr = 7 * s;
      ctx.save();
      ctx.translate(sn.x, sn.y); ctx.rotate(sn.a);
      ctx.fillStyle = 'rgba(96,84,60,0.9)';
      ctx.beginPath(); ctx.ellipse(sr * 0.4, sr * 0.5, sr * 1.3, sr * 0.42, 0, 0, TAU); ctx.fill();
      const shg = ctx.createRadialGradient(-sr * 0.2, -sr * 0.3, sr * 0.1, 0, 0, sr);
      shg.addColorStop(0, '#d9b070'); shg.addColorStop(1, '#6b4526');
      ctx.fillStyle = shg; ctx.beginPath(); ctx.arc(0, 0, sr, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(60,34,16,0.7)'; ctx.lineWidth = Math.max(0.8, s);
      ctx.beginPath(); ctx.arc(0, 0, sr * 0.55, 0.4, TAU * 0.8); ctx.stroke();
      ctx.restore();
      ctx.restore();
      ctx.drawImage(this.front, 0, 0, w, h);
      /* 달빛 조명: 전체를 푸르게 가라앉히고, 네온테트라만 빛나요 */
      if (N > 0.01) {
        const m = (a, b) => Math.round(a + (b - a) * N);
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${m(255, 58)},${m(255, 88)},${m(255, 165)})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'lighter';
        const g = ctx.createLinearGradient(0, 0, 0, floorY);
        g.addColorStop(0, `rgba(90,130,255,${0.22 * N})`); g.addColorStop(0.5, `rgba(60,100,230,${0.06 * N})`); g.addColorStop(1, 'rgba(60,100,230,0)');
        ctx.fillStyle = g; ctx.fillRect(gl, 0, w - gl * 2, floorY);
        const ng = glow(70, 215, 255);
        for (const f of this.fish) {
          if (f.kind !== 'neon') continue;
          const L = FISH.neon.len * s * f.size;
          ctx.globalAlpha = 0.34 * N * (0.55 + 0.45 * f.depth);
          ctx.drawImage(ng, f.x - L * 0.62, f.y - L * 0.3, L * 1.24, L * 0.6);
        }
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
      }
      /* 유리를 톡 친 자리 */
      ctx.globalCompositeOperation = 'lighter';
      for (const tp of this.taps) {
        const k = tp.age / 0.9;
        ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - k)})`; ctx.lineWidth = 2 * s;
        ctx.beginPath(); ctx.arc(tp.x, tp.y, (10 + 46 * k) * s, 0, TAU); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
  }

  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__aqua2.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-aqua2]').forEach((c) => {
      const sc = new Aqua2(c);
      c.__aqua2 = sc;
      scenes.push(sc);
      for (let i = 0; i < 75; i++) sc.step(1 / 30);
      sc.draw();
      if (io) io.observe(c);
      c.addEventListener('pointerdown', (e) => {
        const r = c.getBoundingClientRect();
        sc.tap((e.clientX - r.left) * (sc.w / r.width), (e.clientY - r.top) * (sc.h / r.height));
      });
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-aqua2-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-aqua2]');
      if (c && c.__aqua2) c.__aqua2.action(b.dataset.aqua2Act);
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
