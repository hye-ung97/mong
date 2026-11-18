/* mong — 모래멍 v2 시안용 장면 (Doan 보드 전용). 코드(src/scenes)에는 아직 없어요.
   <canvas data-s2="refine|hourglass|frame|pendulum|bottle"> 하나가 장면 하나예요.
   같은 .screen 안의 [data-s2-act] 버튼이 장면을 조작하고, [data-s2-stat] 에 상태를 적어요.
     data-palette  색 묶음 desert 사막 · dusk 노을 · sea 바다 · ink 먹 · forest 숲
     data-speed    떨어지는 양 0.3 솔솔 · 0.6 보통 · 1 콸콸
     data-prefill  처음부터 이만큼 쌓인 채로 (0~1)
   쌓인 모래는 지금 sand.ts 처럼 칸마다 높이만 기억해요. 그릇 모양(모래시계, 병)은 칸마다 바닥(flo)과 천장(cei)으로 나타내요.
   그래서 알갱이가 구르는 규칙(land)과 구멍으로 빠지는 규칙(drain)은 다섯 장면이 같이 써요. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (x) => x * x * (3 - 2 * x);
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const bell = () => Math.random() + Math.random() + Math.random() - 1.5;

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  /* CSS px 로 그리는 고해상도 판 */
  function layer(w, h, dpr, paint) {
    const c = mk(w * dpr, h * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    paint(x);
    return c;
  }

  /* 색 묶음. 지금 앱의 노을 · 바다 · 숲은 채도를 조금 낮췄고, 사막 · 먹은 새로 넣었어요 */
  const PAL = {
    desert: { label: '사막', stops: [[240, 226, 196], [218, 180, 124], [192, 128, 84], [142, 94, 66], [88, 72, 64]] },
    dusk: { label: '노을', stops: [[244, 208, 146], [234, 152, 108], [204, 98, 116], [132, 88, 156], [64, 66, 120]] },
    sea: { label: '바다', stops: [[236, 232, 216], [152, 208, 198], [78, 154, 172], [48, 98, 146], [30, 54, 92]] },
    ink: { label: '먹', stops: [[238, 236, 228], [132, 132, 130], [30, 30, 34], [200, 198, 190], [66, 68, 74]] },
    forest: { label: '숲', stops: [[236, 226, 180], [182, 208, 118], [98, 162, 100], [54, 118, 102], [134, 94, 66]] },
  };
  const SPEED = [{ v: 0.3, label: '솔솔', fill: 420, spread: 2.5 }, { v: 0.6, label: '보통', fill: 200, spread: 5 }, { v: 1, label: '콸콸', fill: 90, spread: 9 }];
  const speedOf = (v) => SPEED.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));
  const COLOR_SECONDS = 7;
  const GRAVITY = 1500;

  /* ImageData 바이트는 R,G,B,A 라서 Uint32 로는 ABGR 이에요 */
  const pack = (r, g, b, a = 255) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  const css = (c, a = 1) => `rgba(${c & 255},${(c >>> 8) & 255},${(c >>> 16) & 255},${a})`;

  function colorAt(pal, phase, grain = true) {
    const st = (PAL[pal] || PAL.desert).stops;
    const n = st.length;
    const whole = Math.floor(phase);
    const i = ((whole % n) + n) % n;
    const f = ease(clamp((phase - whole - 0.3) / 0.4, 0, 1));
    const a = st[i], b = st[(i + 1) % n];
    const k = !grain ? 1 : Math.random() < 0.03 ? 1.2 : rand(0.86, 1.05); /* 알갱이마다 밝기가 조금씩 달라요 */
    return pack(
      clamp((a[0] + (b[0] - a[0]) * f) * k, 0, 255) | 0,
      clamp((a[1] + (b[1] - a[1]) * f) * k, 0, 255) | 0,
      clamp((a[2] + (b[2] - a[2]) * f) * k, 0, 255) | 0,
    );
  }

  /* 밝기를 곱해요. 1보다 크면 조금 하얘져요 */
  function shade(c, f) {
    let r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
    if (f > 1) {
      const t = (f - 1) * 70;
      r = r * f + t; g = g * f + t; b = b * f + t;
    } else { r *= f; g *= f; b *= f; }
    return pack(r > 255 ? 255 : r | 0, g > 255 ? 255 : g | 0, b > 255 ? 255 : b | 0, c >>> 24);
  }

  /* ================= 쌓인 모래 한 무더기 =================
     칸 c 에는 flo[c] 부터 cei[c] 바로 아래까지 모래가 들어가요. hts[c] 는 지금 높이(바닥에서 센 칸 수). */
  class Pile {
    constructor(cols, rows, flo, cei) {
      this.cols = cols;
      this.rows = rows;
      this.flo = flo || new Int32Array(cols);
      this.cei = cei || new Int32Array(cols).fill(rows);
      this.grid = new Uint32Array(cols * rows);
      this.hts = Int32Array.from(this.flo);
      this.count = 0;
      this.cap = 0;
      for (let c = 0; c < cols; c++) this.cap += Math.max(0, this.cei[c] - this.flo[c]);
      this.off = mk(cols, rows);
      this.octx = this.off.getContext('2d');
      this.img = this.octx.createImageData(cols, rows);
      this.view = new Uint32Array(this.img.data.buffer);
    }

    at(c, k) { return (this.rows - 1 - k) * this.cols + c; }

    clear() { this.grid.fill(0); this.hts.set(this.flo); this.count = 0; }

    /* 알갱이 하나가 c 칸에 내려앉아요. 옆이 낮으면 그쪽으로 굴러요(지금 sand.ts 와 같은 규칙). 칸이 꽉 찼으면 열린 옆 칸으로 가요. */
    land(c, col, dir) {
      const h = this.hts, cei = this.cei, last = this.cols - 1;
      c = clamp(c | 0, 0, last);
      for (let i = 0; i < 800; i++) {
        const hc = h[c];
        const full = hc >= cei[c];
        const l = c > 0 && h[c - 1] < cei[c - 1] ? h[c - 1] : 1e9;
        const r = c < last && h[c + 1] < cei[c + 1] ? h[c + 1] : 1e9;
        let canL, canR;
        if (full) {
          canL = l < 1e9; canR = r < 1e9;
          if (canL && canR) { canL = l <= r; canR = !canL; }
        } else {
          const l2 = c > 1 ? h[c - 2] : 1e9, r2 = c < last - 1 ? h[c + 2] : 1e9;
          canL = l < hc || (l <= hc && l2 < hc && Math.random() < 0.6);
          canR = r < hc || (r <= hc && r2 < hc && Math.random() < 0.6);
        }
        if (!canL && !canR) break;
        if (canL && canR) { if (!dir) dir = Math.random() < 0.5 ? -1 : 1; } else dir = canL ? -1 : 1;
        c += dir;
      }
      if (h[c] >= cei[c]) return false;
      this.grid[this.at(c, h[c])] = col;
      h[c]++;
      this.count++;
      return true;
    }

    move(from, to) {
      const at = this.at(from, this.hts[from] - 1);
      const col = this.grid[at];
      this.grid[at] = 0;
      this.hts[from]--;
      this.grid[this.at(to, this.hts[to])] = col;
      this.hts[to]++;
    }

    /* 비탈이 lim 칸보다 가파르면 위 알갱이가 낮은 쪽으로 미끄러져요 */
    relax(lim, passes) {
      const h = this.hts, flo = this.flo, cei = this.cei, n = this.cols;
      for (let p = 0; p < passes; p++) {
        let moved = false;
        for (let c = 0; c < n - 1; c++) {
          while (h[c] - h[c + 1] > lim && h[c] > flo[c] && h[c + 1] < cei[c + 1]) { this.move(c, c + 1); moved = true; }
        }
        for (let c = n - 1; c > 0; c--) {
          while (h[c] - h[c - 1] > lim && h[c] > flo[c] && h[c - 1] < cei[c - 1]) { this.move(c, c - 1); moved = true; }
        }
        if (!moved) break;
      }
    }

    /* a..b 칸 바닥의 구멍으로 n 알갱이씩 빠져요. 칸은 통째로 내려앉고, 빠진 알갱이 색을 out(c, col) 으로 넘겨요 */
    drain(a, b, n, out) {
      const g = this.grid, h = this.hts, flo = this.flo;
      for (let c = a; c <= b; c++) {
        const k = Math.min(n, h[c] - flo[c]);
        if (k <= 0) continue;
        for (let j = 0; j < k; j++) out(c, g[this.at(c, flo[c] + j)]);
        for (let q = flo[c]; q < h[c]; q++) g[this.at(c, q)] = q + k < h[c] ? g[this.at(c, q + k)] : 0;
        h[c] -= k;
        this.count -= k;
      }
    }

    /* a..b 칸에서 가장 높은 곳의 맨 위 알갱이부터 n 개를 걷어 내요. 겉면이 고르게 내려가서 색 띠가 한 겹씩 나와요 */
    skim(a, b, n, out) {
      const h = this.hts, flo = this.flo;
      for (let j = 0; j < n; j++) {
        let best = -1, bh = 0;
        for (let c = a; c <= b; c++) {
          const v = h[c] - flo[c];
          if (v > bh || (v === bh && v > 0 && Math.random() < 0.3)) { bh = v; best = c; }
        }
        if (best < 0) return;
        const at = this.at(best, h[best] - 1);
        out(best, this.grid[at]);
        this.grid[at] = 0;
        h[best]--;
        this.count--;
      }
    }

    /* 그릇을 뒤집을 때: 겉에 있던 알갱이부터 꺼내요(뒤집으면 그게 먼저 떨어지니까) */
    takeAll() {
      const out = [];
      let top = 0;
      for (let c = 0; c < this.cols; c++) if (this.hts[c] > top) top = this.hts[c];
      for (let k = top - 1; k >= 0; k--) {
        for (let c = 0; c < this.cols; c++) {
          if (k < this.flo[c] || k >= this.hts[c]) continue;
          const col = this.grid[this.at(c, k)];
          if (col) out.push(c, col);
        }
      }
      this.clear();
      return out;
    }

    pour(list, map) { for (let i = 0; i < list.length; i += 2) this.land(map(list[i]), list[i + 1], 0); }

    peakIn(a, b) {
      let m = 0;
      for (let c = Math.max(0, a); c <= Math.min(this.cols - 1, b); c++) if (this.hts[c] > m) m = this.hts[c];
      return m;
    }

    /* 빛: 왼쪽 위에서 와요. 맨 위 한 줄은 밝고, 빛을 향한 비탈은 밝게, 등진 비탈은 어둡게, 깊은 곳은 살짝 어둡게 */
    paint(light = 1) {
      const { cols, rows, grid: g, hts: h, flo, view } = this;
      view.fill(0);
      const last = cols - 1;
      for (let c = 0; c < cols; c++) {
        const top = h[c];
        if (top <= flo[c]) continue;
        const hl = c > 0 ? h[c - 1] : top;
        const hr = c < last ? h[c + 1] : top;
        const face = 1 + clamp(hr - hl, -5, 5) * 0.032 * light;
        const open = Math.min(hl, hr);
        for (let k = flo[c]; k < top; k++) {
          const d = top - 1 - k;
          let f;
          if (d === 0) f = face * (1 + 0.15 * light);
          else if (k >= open) f = face * (1 + 0.04 * light);
          else if (d < 4) f = 1;
          else f = 1 - Math.min(0.16, (d - 4) * 0.0018) * light;
          const i = (rows - 1 - k) * cols + c;
          view[i] = f === 1 ? g[i] : shade(g[i], f);
        }
      }
    }

    put() { this.octx.putImageData(this.img, 0, 0); }
  }

  /* 떨어지는 알갱이들 */
  class Fly {
    constructor(max) {
      this.max = max;
      this.x = new Float32Array(max); this.y = new Float32Array(max);
      this.vx = new Float32Array(max); this.vy = new Float32Array(max);
      this.c = new Uint32Array(max); this.k = new Float32Array(max);
      this.n = 0;
    }
    add(x, y, vx, vy, c, k = 0) {
      if (this.n >= this.max) return;
      const i = this.n++;
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.c[i] = c; this.k[i] = k;
    }
    kill(i) {
      const j = --this.n;
      this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.c[i] = this.c[j]; this.k[i] = this.k[j];
    }
  }

  /* 쌓인 모래 그림 위에 떨어지는 알갱이를 짧은 줄로 그려요 (pile 이 덮는 자리 안에서만) */
  function streaks(pile, fly, x0, y0, cell, alpha = 255) {
    const v = pile.view, cols = pile.cols, rows = pile.rows;
    for (let i = 0; i < fly.n; i++) {
      const c = Math.floor((fly.x[i] - x0) / cell);
      if (c < 0 || c >= cols) continue;
      const r1 = Math.floor((fly.y[i] - y0) / cell);
      const len = clamp(Math.round(fly.vy[i] / 60 / cell), 1, 7);
      const stop = rows - pile.hts[c];
      const col = alpha === 255 ? fly.c[i] : ((fly.c[i] & 0xffffff) | (alpha << 24)) >>> 0;
      for (let r = Math.max(0, r1 - len + 1); r <= r1 && r < stop; r++) v[r * cols + c] = col;
    }
  }

  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l + r, t);
    x.arcTo(l + w, t, l + w, t + h, r);
    x.arcTo(l + w, t + h, l, t + h, r);
    x.arcTo(l, t + h, l, t, r);
    x.arcTo(l, t, l + w, t, r);
    x.closePath();
  }

  /* ================= 공통 ================= */
  class Base {
    constructor(canvas) {
      const d = canvas.dataset;
      this.canvas = canvas;
      this.screen = canvas.closest('.screen');
      this.w = canvas.clientWidth || 390;
      this.h = canvas.clientHeight || 844;
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(this.w * this.dpr);
      canvas.height = Math.round(this.h * this.dpr);
      this.ctx = canvas.getContext('2d');
      this.visible = true;
      this.palette = PAL[d.palette] ? d.palette : 'desert';
      this.speed = speedOf(Number(d.speed) || 0.6);
      this.prefillTo = Number(d.prefill) || 0;
      this.t = rand(0, 100);
      this.phase = rand(0, 5);
      this.stats = {};
      this.toastEl = this.screen && this.screen.querySelector('[data-s2-toast]');
      this.toastT = 0;
    }
    color() { return colorAt(this.palette, this.phase); }
    stat(name, text) {
      if (!this.screen || this.stats[name] === text) return;
      this.stats[name] = text;
      this.screen.querySelectorAll(`[data-s2-stat="${name}"]`).forEach((e) => { e.textContent = text; });
    }
    toast(text, sec = 2.6) {
      if (!this.toastEl) return;
      this.toastEl.querySelector('span:last-child').textContent = text;
      this.toastEl.classList.add('show');
      this.toastT = sec;
    }
    tick(dt) {
      if (this.toastT > 0) {
        this.toastT -= dt;
        if (this.toastT <= 0 && this.toastEl) this.toastEl.classList.remove('show');
      }
    }
    action(name, value) {
      if (name === 'speed') this.speed = speedOf(Number(value));
      else if (name === 'palette' && PAL[value]) this.setPalette(value);
      else if (name === 'cycle') {
        const ids = Object.keys(PAL);
        this.setPalette(ids[(ids.indexOf(this.palette) + 1) % ids.length]);
      }
      else this.act(name, value);
      this.sync();
    }
    setPalette(p) { this.palette = p; }
    act() {}
    sync() {
      const sc = this.screen;
      if (!sc) return;
      sc.querySelectorAll('[data-s2-act="speed"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === this.speed.v));
      sc.querySelectorAll('[data-s2-act="palette"]').forEach((b) => b.classList.toggle('on', b.dataset.value === this.palette));
      sc.querySelectorAll('[data-s2-swatch]').forEach((e) => { e.className = `swatch pal2-${this.palette}`; });
      this.stat('palette', PAL[this.palette].label);
      this.stat('speed', this.speed.label);
    }
    pointer() {}
    begin() { this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); }
  }

  /* ================= A · 빛을 들이기 =================
     지금 장면 그대로(줄기가 흔들리며 쌓이고, 가득 차면 바닥 틈으로 빠져요).
     바뀌는 건 그리기: 나무 테 · 받침 · 레일에 매달린 깔때기 · 모래에 빛과 그늘 · 따뜻한 방. */
  class Refine extends Base {
    constructor(canvas) {
      super(canvas);
      const d = canvas.dataset;
      const { w, h } = this;
      this.cell = 2;
      this.side = 12;
      this.floorY = h - (Number(d.floor) || 132);
      this.railY = Number(d.rail) || 116;
      this.cols = Math.floor((w - this.side * 2) / this.cell);
      this.x0 = (w - this.cols * this.cell) / 2;
      this.rows = Math.floor((this.floorY - this.railY - 26) / this.cell);
      this.y0 = this.floorY - this.rows * this.cell;
      this.limit = this.rows - 10; /* 깔때기 아래 20px 까지 차면 가득 */
      this.pile = new Pile(this.cols, this.rows);
      this.fly = new Fly(9000);
      this.seed();
      this.nx = this.tx = this.autoX(this.t);
      this.nv = 0;
      this.hold = 0;
      this.dragging = false;
      this.acc = 0;
      this.state = 'pour';
      this.wait = 0;
      this.cur = colorAt(this.palette, this.phase, false);
      this.paintRoom();
      if (this.prefillTo) this.prefill(this.prefillTo);
      this.sync();
    }
    seed() { this.p1 = rand(0, TAU); this.p2 = rand(0, TAU); this.p3 = rand(0, TAU); }
    autoX(t) {
      const iw = this.cols * this.cell;
      return this.x0 + iw * clamp(0.5 + 0.3 * Math.sin(t * 0.053 + this.p3) + 0.14 * Math.sin(t * 0.31 + this.p1) + 0.05 * Math.sin(t * 1.13 + this.p2), 0.04, 0.96);
    }
    get rate() { return (this.cols * this.limit) / this.speed.fill; }
    slotHalf() { return Math.max(3, Math.round(this.cols * 0.025)); }
    prefill(frac) {
      const n = Math.floor(this.cols * this.limit * frac);
      const dt = 1 / this.rate;
      for (let i = 0; i < n; i++) {
        if ((i & 255) === 0 && this.pile.peakIn(0, this.cols) >= this.limit) break;
        this.t += dt;
        this.phase += dt / COLOR_SECONDS;
        const x = this.autoX(this.t) + bell() * this.speed.spread * 2;
        this.pile.land(Math.floor((x - this.x0) / this.cell), this.color(), 0);
      }
      this.nx = this.tx = this.autoX(this.t);
    }
    pointer(kind, x) {
      if (kind === 'down') { this.dragging = true; this.tx = x; }
      else if (kind === 'move' && this.dragging) this.tx = x;
      else if (kind === 'up' && this.dragging) { this.dragging = false; this.hold = 4; }
    }
    act(name) { if (name === 'empty' && this.state !== 'empty') this.startEmpty(); }
    startEmpty() {
      this.state = 'empty';
      this.emptyRate = Math.max(this.pile.count, 2000) / 7;
      this.emptyAcc = 0;
    }
    step(dt) {
      this.tick(dt);
      this.t += dt;
      this.phase += dt / COLOR_SECONDS;
      const { cell, pile } = this;
      const lo = this.x0 + 8, hi = this.x0 + this.cols * cell - 8;
      if (!this.dragging) {
        if (this.hold > 0) this.hold -= dt;
        else this.tx += (this.autoX(this.t) - this.tx) * Math.min(1, dt * 1.5);
      }
      const prev = this.nx;
      this.nx += (clamp(this.tx, lo, hi) - this.nx) * Math.min(1, dt * 9);
      this.nv = (this.nx - prev) / dt;
      this.cur = colorAt(this.palette, this.phase, false);

      if (this.state === 'pour') {
        this.acc += this.rate * dt;
        const sp = this.speed.spread;
        const y = this.railY + 25;
        while (this.acc >= 1) {
          this.acc -= 1;
          const sub = Math.random();
          const vy = rand(110, 190);
          this.fly.add(prev + (this.nx - prev) * sub + bell() * sp, y - sub * vy * dt, this.nv * 0.4 + rand(-8, 8), vy, this.color());
        }
        if (pile.peakIn(0, this.cols) >= this.limit) { this.state = 'full'; this.wait = 2; }
      } else if (this.state === 'full') {
        this.wait -= dt;
        if (this.wait <= 0) this.startEmpty();
      } else {
        const hw = this.slotHalf(), mid = this.cols >> 1;
        const a = mid - hw, b = mid + hw;
        this.emptyAcc += this.emptyRate * dt;
        const k = Math.floor(this.emptyAcc / (b - a + 1));
        if (k > 0) { this.emptyAcc -= k * (b - a + 1); pile.drain(a, b, k, () => {}); }
        let fed = false;
        for (let c = a; c <= b; c++) if (pile.hts[c] > 0) fed = true;
        pile.relax(fed ? 1 : 0, 5);
        if (pile.count <= 0) { pile.clear(); this.seed(); this.state = 'pour'; }
      }

      const f = this.fly, last = this.cols - 1;
      for (let i = 0; i < f.n; i++) {
        f.vy[i] += GRAVITY * dt;
        f.y[i] += f.vy[i] * dt;
        let x = f.x[i] + f.vx[i] * dt;
        if (x < this.x0) { x = this.x0; f.vx[i] = 0; } else if (x > this.x0 + this.cols * cell - 1) { x = this.x0 + this.cols * cell - 1; f.vx[i] = 0; }
        f.x[i] = x;
        const c = clamp(Math.floor((x - this.x0) / cell), 0, last);
        if (f.y[i] >= this.floorY - pile.hts[c] * cell) {
          if (this.state !== 'empty') pile.land(c, f.c[i], f.vx[i] > 12 ? 1 : f.vx[i] < -12 ? -1 : 0);
          f.kill(i);
          i--;
        }
      }
      this.stat('fill', `${Math.min(100, Math.round((pile.count / (this.cols * this.limit)) * 100))}%`);
    }
    paintRoom() {
      const { w, h, dpr, side, floorY, railY } = this;
      const top = railY - 30;
      this.room = layer(w, h, dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#1d1713'); g.addColorStop(1, '#0d0a08');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 액자 안 바탕판 */
        g = x.createLinearGradient(0, top, 0, floorY);
        g.addColorStop(0, '#261f1a'); g.addColorStop(1, '#14100e');
        x.fillStyle = g; x.fillRect(side, top, w - side * 2, floorY - top);
        /* 왼쪽 위 스탠드 불빛 */
        g = x.createRadialGradient(w * 0.1, top + 10, 0, w * 0.1, top + 10, h * 0.78);
        g.addColorStop(0, 'rgba(255,198,132,0.2)'); g.addColorStop(0.45, 'rgba(255,198,132,0.06)'); g.addColorStop(1, 'rgba(255,198,132,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 레일 */
        g = x.createLinearGradient(0, railY - 2, 0, railY + 2);
        g.addColorStop(0, 'rgba(255,240,220,0.4)'); g.addColorStop(1, 'rgba(70,52,36,0.7)');
        x.fillStyle = g; x.fillRect(side, railY - 1.5, w - side * 2, 3);
        /* 받침 */
        g = x.createLinearGradient(0, floorY, 0, h);
        g.addColorStop(0, '#3e2f24'); g.addColorStop(0.07, '#2b2019'); g.addColorStop(1, '#0e0a08');
        x.fillStyle = g; x.fillRect(0, floorY, w, h - floorY);
        x.fillStyle = 'rgba(255,228,196,0.26)'; x.fillRect(0, floorY, w, 1);
        const slot = this.slotHalf() * this.cell + 3;
        x.fillStyle = '#070505'; x.fillRect(w / 2 - slot, floorY, slot * 2, 3);
      });
      this.glass = layer(w, h, dpr, (x) => {
        /* 유리에 비친 빛: 비스듬한 띠 하나와 가는 줄 하나 */
        let g = x.createLinearGradient(0, top, w, top + w * 0.9);
        g.addColorStop(0.06, 'rgba(255,240,220,0)'); g.addColorStop(0.2, 'rgba(255,240,220,0.06)');
        g.addColorStop(0.28, 'rgba(255,240,220,0.012)'); g.addColorStop(0.34, 'rgba(255,240,220,0.045)'); g.addColorStop(0.4, 'rgba(255,240,220,0)');
        x.fillStyle = g; x.fillRect(side, top, w - side * 2, floorY - top);
        /* 테 옆 그림자 */
        g = x.createLinearGradient(side, 0, side + 24, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(side, top, 24, floorY - top);
        g = x.createLinearGradient(w - side, 0, w - side - 24, 0);
        g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(w - side - 24, top, 24, floorY - top);
        /* 나무 테 */
        const wood = (l, t, ww, hh, horiz, flip) => {
          const gg = horiz ? x.createLinearGradient(0, t, 0, t + hh) : flip ? x.createLinearGradient(l + ww, 0, l, 0) : x.createLinearGradient(l, 0, l + ww, 0);
          gg.addColorStop(0, '#22180f'); gg.addColorStop(0.55, '#4a3527'); gg.addColorStop(1, '#5e4532');
          x.fillStyle = gg; x.fillRect(l, t, ww, hh);
        };
        wood(0, top - 12, side, floorY - top + 12, false, false);
        wood(w - side, top - 12, side, floorY - top + 12, false, true);
        wood(0, top - 12, w, 12, true, false);
        x.fillStyle = 'rgba(255,230,200,0.18)';
        x.fillRect(side - 1, top, 1, floorY - top);
        x.fillRect(w - side, top, 1, floorY - top);
        x.fillRect(side, top - 1, w - side * 2, 1);
      });
    }
    drawSpout(ctx) {
      const x = this.nx, y = this.railY;
      /* 레일 위 작은 수레 */
      ctx.fillStyle = '#5b4a3a';
      roundRect(ctx, x - 10, y - 4, 20, 7, 3.5); ctx.fill();
      ctx.fillStyle = 'rgba(255,236,210,0.35)'; ctx.fillRect(x - 8, y - 4, 16, 1);
      /* 놋쇠 깔때기 */
      const g = ctx.createLinearGradient(x - 11, 0, x + 11, 0);
      g.addColorStop(0, '#6e5230'); g.addColorStop(0.32, '#e8c690'); g.addColorStop(0.55, '#a8814c'); g.addColorStop(1, '#4e3a20');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(x - 11, y + 3); ctx.lineTo(x + 11, y + 3); ctx.lineTo(x + 2.4, y + 18); ctx.lineTo(x + 2.4, y + 25);
      ctx.lineTo(x - 2.4, y + 25); ctx.lineTo(x - 2.4, y + 18); ctx.closePath(); ctx.fill();
      /* 입구에 담긴 지금 색 */
      ctx.fillStyle = css(this.cur);
      ctx.beginPath(); ctx.ellipse(x, y + 4.6, 9, 2, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,240,215,0.5)'; ctx.fillRect(x - 11, y + 3, 22, 0.8);
    }
    draw() {
      const { ctx, w, h, cell, pile } = this;
      this.begin();
      ctx.drawImage(this.room, 0, 0, w, h);
      pile.paint(1);
      streaks(pile, this.fly, this.x0, this.y0, cell);
      pile.put();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(pile.off, this.x0, this.y0, this.cols * cell, this.rows * cell);
      ctx.imageSmoothingEnabled = true;
      this.drawSpout(ctx);
      ctx.drawImage(this.glass, 0, 0, w, h);
    }
  }

  /* ================= B · 모래시계 =================
     위 칸에 색 띠가 겹겹이 있고, 가운데 목으로 빠져 아래에 원뿔로 쌓여요. 다 내려가면 뒤집혀요.
     끌면 모래시계가 살짝 기울어 줄기가 한쪽으로 휘어요. */
  class Hourglass extends Base {
    constructor(canvas) {
      super(canvas);
      const d = canvas.dataset;
      this.cell = 2;
      this.cx = this.w / 2;
      this.top = 152; this.bot = 676;
      this.neck = (this.top + this.bot) / 2;
      this.bh = this.neck - this.top;
      this.maxHalf = 110; this.neckHalf = 3;
      this.cols = Math.ceil((this.maxHalf * 2) / this.cell);
      this.rows = Math.ceil(this.bh / this.cell);
      this.x0 = this.cx - (this.cols * this.cell) / 2;
      const fu = new Int32Array(this.cols), cu = new Int32Array(this.cols);
      const fl = new Int32Array(this.cols), cl = new Int32Array(this.cols);
      for (let c = 0; c < this.cols; c++) {
        const dx = Math.abs(this.x0 + (c + 0.5) * this.cell - this.cx);
        let a = -1, b = -1, a2 = -1, b2 = -1;
        for (let k = 0; k < this.rows; k++) {
          const s = ((k + 0.5) * this.cell) / this.bh; /* 위 칸: 목에서 떨어진 정도 */
          if (dx <= this.half(s) - 2) { if (a < 0) a = k; b = k; }
          if (dx <= this.half(1 - s) - 2) { if (a2 < 0) a2 = k; b2 = k; } /* 아래 칸: 바닥에서 센 높이 */
        }
        fu[c] = a < 0 ? 0 : a; cu[c] = a < 0 ? 0 : b + 1;
        fl[c] = a2 < 0 ? 0 : a2; cl[c] = a2 < 0 ? 0 : b2 + 1;
      }
      this.up = new Pile(this.cols, this.rows, fu, cu);
      this.lo = new Pile(this.cols, this.rows, fl, cl);
      this.ha = -1; this.hb = -1; /* 목에 닿는 칸 */
      for (let c = 0; c < this.cols; c++) if (cu[c] > 0 && fu[c] === 0) { if (this.ha < 0) this.ha = c; this.hb = c; }
      this.fly = new Fly(3000);
      this.angle = 0; this.tilt = 0; this.tiltTo = 0; this.lift = 0;
      this.dragging = false;
      this.state = 'run'; this.wait = 0; this.flips = 0; this.acc = 0;
      this.mode = d.mode || 'loop';
      this.cycle = Number(d.cycle) || 40; /* 보드에서 한 번 다 내려가는 시간(초) */
      this.layers(this.up, 0.8);
      this.rate = this.up.count / this.cycle;
      if (this.prefillTo) this.fast(this.prefillTo);
      this.paintRoom();
      this.sync();
    }
    /* 유리 반폭. s: 목 0 → 마개 1 */
    half(s) {
      const b = Math.pow(Math.sin((Math.min(1, s / 0.8) * Math.PI) / 2), 1.25);
      const sh = s > 0.88 ? Math.sqrt(Math.max(0, 1 - ((s - 0.88) / 0.12) ** 2 * 0.2)) : 1;
      return this.neckHalf + (this.maxHalf - this.neckHalf) * b * sh;
    }
    layers(pile, frac) {
      const n = Math.floor(pile.cap * frac);
      const per = n / 6.5;
      for (let i = 0; i < n; i++) pile.land(Math.floor(Math.random() * pile.cols), colorAt(this.palette, this.phase + i / per), 0);
      this.phase += n / per;
    }
    /* 앞서 흘러내린 만큼 미리 옮겨 둬요 */
    fast(frac) {
      const n = Math.floor(this.up.count * frac);
      const mid = (this.ha + this.hb) / 2;
      let moved = 0, guard = 0;
      while (moved < n && this.up.count > 0 && guard++ < 400000) {
        let got = 0;
        this.up.drain(this.ha, this.hb, 1, (c, col) => { this.lo.land(Math.round(mid + bell() * 0.9), col, 0); got++; });
        moved += got;
        if (!got || (guard & 7) === 0) this.up.relax(got ? 1 : 0, 3);
      }
      this.up.relax(1, 60);
    }
    setPalette(p) {
      this.palette = p;
      this.up.clear(); this.lo.clear(); this.fly.n = 0;
      this.layers(this.up, 0.8);
      this.fast(0.3);
      this.state = 'run'; this.angle = 0;
    }
    pointer(kind, x) {
      if (kind === 'down') { this.dragging = true; this.sx = x; }
      else if (kind === 'move' && this.dragging) this.tiltTo = clamp((x - this.sx) / 240, -1, 1) * 0.16;
      else if (kind === 'up') this.dragging = false;
    }
    act(name, value) {
      if (name === 'mode') {
        this.mode = value;
        this.screen && this.screen.querySelectorAll('[data-s2-act="mode"]').forEach((b) => b.classList.toggle('on', b.dataset.value === value));
      } else if (name === 'flip' && (this.state === 'run' || this.state === 'rest')) this.startFlip();
    }
    startFlip() {
      const f = this.fly;
      for (let i = 0; i < f.n; i++) this.lo.land(clamp(Math.floor((f.x[i] - this.x0) / this.cell), 0, this.cols - 1), f.c[i], 0);
      f.n = 0;
      this.state = 'flip'; this.ft = 0; this.swapped = false;
    }
    /* 옆으로 누운 순간에 위아래를 맞바꿔요: 위 칸이 아래 칸으로, 아래 칸이 위 칸으로 */
    swap() {
      const map = (c) => this.cols - 1 - c;
      const a = this.lo.takeAll(), b = this.up.takeAll();
      this.up.pour(a, map);
      this.lo.pour(b, map);
      this.up.relax(1, 80);
      this.swapped = true;
    }
    step(dt) {
      this.tick(dt);
      this.t += dt;
      if (!this.dragging) this.tiltTo *= Math.max(0, 1 - dt * 2.2);
      this.tilt += (this.tiltTo - this.tilt) * Math.min(1, dt * 4);
      const up = this.up, lo = this.lo;
      if (this.state === 'run') {
        const nh = this.hb - this.ha + 1;
        this.acc += this.rate * dt;
        const k = Math.floor(this.acc / nh);
        if (k > 0) {
          this.acc -= k * nh;
          up.drain(this.ha, this.hb, k, (c, col) => {
            this.fly.add(this.x0 + (c + 0.5) * this.cell + rand(-0.5, 0.5), this.neck + rand(0, 4), 0, rand(30, 70), col);
          });
        }
        let fed = false;
        for (let c = this.ha; c <= this.hb; c++) if (up.hts[c] > up.flo[c]) fed = true;
        up.relax(fed ? 1 : 0, 4);
        if (up.count <= 0 && this.fly.n === 0) {
          up.clear();
          if (this.mode !== 'loop') this.toast(`${this.mode}분이 다 됐어요 · 앱에서는 여기서 멈춰요`, 3);
          this.state = 'rest';
          this.wait = this.mode === 'loop' ? 1.8 : 3.4;
        }
      } else if (this.state === 'rest') {
        this.wait -= dt;
        if (this.wait <= 0) this.startFlip();
      } else if (this.state === 'flip') {
        this.ft += dt;
        const p = clamp(this.ft / 1.8, 0, 1);
        if (!this.swapped && p >= 0.5) this.swap();
        const e = easeIO(p);
        this.angle = this.swapped ? Math.PI * e - Math.PI : Math.PI * e;
        this.lift = Math.sin(Math.PI * p);
        if (p >= 1) { this.angle = 0; this.lift = 0; this.state = 'run'; this.flips++; }
      }

      /* 떨어지는 알갱이: 모래시계 안에서 본 중력(기울면 옆으로도 끌려요) */
      const gx = GRAVITY * Math.sin(this.tilt), gy = GRAVITY * Math.cos(this.tilt);
      const f = this.fly, last = this.cols - 1;
      for (let i = 0; i < f.n; i++) {
        f.vx[i] += gx * dt; f.vy[i] += gy * dt;
        f.x[i] += f.vx[i] * dt; f.y[i] += f.vy[i] * dt;
        const c = clamp(Math.floor((f.x[i] - this.x0) / this.cell), 0, last);
        if (f.y[i] >= this.bot - lo.hts[c] * this.cell) {
          lo.land(c, f.c[i], f.vx[i] > 10 ? 1 : f.vx[i] < -10 ? -1 : 0);
          f.kill(i);
          i--;
        }
      }

      const label = this.mode === 'loop' ? '끝없이' : `${this.mode}분`;
      this.stat('mode', label);
      if (this.mode === 'loop') this.stat('aside', `뒤집기 ${this.flips}번`);
      else {
        const left = Math.max(0, Math.round(((up.count + this.fly.n) / this.rate) * ((Number(this.mode) * 60) / this.cycle)));
        this.stat('aside', `남은 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
      }
    }
    outline(x, inset = 0) {
      const { cx, top, bot, neck, bh } = this;
      const N = 140;
      x.beginPath();
      for (let i = 0; i <= N; i++) {
        const y = top + ((bot - top) * i) / N;
        x.lineTo(cx + this.half(Math.abs(y - neck) / bh) - inset, y);
      }
      for (let i = N; i >= 0; i--) {
        const y = top + ((bot - top) * i) / N;
        x.lineTo(cx - this.half(Math.abs(y - neck) / bh) + inset, y);
      }
      x.closePath();
    }
    paintRoom() {
      const { w, h, dpr, cx, top, bot } = this;
      const ty = bot + 20;
      this.room = layer(w, h, dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#1c1713'); g.addColorStop(0.7, '#130f0c'); g.addColorStop(1, '#0b0807');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 오른쪽 위 스탠드 불빛이 벽에 번져요 */
        g = x.createRadialGradient(w * 0.88, 110, 0, w * 0.88, 110, 560);
        g.addColorStop(0, 'rgba(255,190,120,0.22)'); g.addColorStop(0.42, 'rgba(255,190,120,0.06)'); g.addColorStop(1, 'rgba(255,190,120,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 탁자 */
        g = x.createLinearGradient(0, ty, 0, h);
        g.addColorStop(0, '#4c3727'); g.addColorStop(0.05, '#33241a'); g.addColorStop(1, '#0f0a07');
        x.fillStyle = g; x.fillRect(0, ty, w, h - ty);
        x.fillStyle = 'rgba(255,220,180,0.2)'; x.fillRect(0, ty, w, 1);
        /* 그림자 */
        x.save();
        x.translate(cx - 16, ty + 4); x.scale(1, 0.1);
        g = x.createRadialGradient(0, 0, 0, 0, 0, 190);
        g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(-200, -200, 400, 400);
        x.restore();
      });
      /* 뒤 기둥 (유리 너머로 흐릿하게) */
      this.back = layer(w, h, dpr, (x) => {
        const g = x.createLinearGradient(cx - 4, 0, cx + 4, 0);
        g.addColorStop(0, '#24180f'); g.addColorStop(0.5, '#4a3524'); g.addColorStop(1, '#24180f');
        x.globalAlpha = 0.55;
        x.fillStyle = g; x.fillRect(cx - 4, top, 8, bot - top);
        x.globalAlpha = 1;
        this.outline(x);
        x.fillStyle = 'rgba(255,236,214,0.035)'; x.fill();
      });
      /* 유리 앞면: 테두리와 빛 반사 */
      this.front = layer(w, h, dpr, (x) => {
        this.outline(x);
        x.lineWidth = 1.4; x.strokeStyle = 'rgba(255,236,214,0.26)'; x.stroke();
        const streak = (s0, s1, k, lw, a) => {
          for (const dir of [-1, 1]) {
            x.beginPath();
            for (let i = 0; i <= 30; i++) {
              const s = s0 + ((s1 - s0) * i) / 30;
              x.lineTo(cx + this.half(s) * k, this.neck + dir * s * this.bh);
            }
            x.lineWidth = lw; x.lineCap = 'round'; x.strokeStyle = `rgba(255,242,224,${a})`; x.stroke();
          }
        };
        streak(0.32, 0.82, 0.74, 6, 0.1);
        streak(0.4, 0.78, 0.8, 1.6, 0.32);
        streak(0.36, 0.7, -0.84, 2, 0.08);
      });
      /* 나무 마개와 기둥 */
      this.frame = layer(w, h, dpr, (x) => {
        const cw = 138, ch = 20;
        const cap = (y) => {
          const g = x.createLinearGradient(0, y, 0, y + ch);
          g.addColorStop(0, '#6a4c34'); g.addColorStop(0.3, '#4a3424'); g.addColorStop(1, '#24170e');
          x.fillStyle = g;
          roundRect(x, cx - cw, y, cw * 2, ch, 6); x.fill();
          x.fillStyle = 'rgba(255,226,190,0.22)'; x.fillRect(cx - cw + 6, y, cw * 2 - 12, 1);
          x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(cx - cw + 4, y + ch * 0.55, cw * 2 - 8, 1);
        };
        cap(top - ch);
        cap(bot);
        /* 유리가 마개에 닿는 놋쇠 고리 */
        for (const [y, s] of [[top, 1], [bot, 1]]) {
          const hw = this.half(s) + 3;
          const g = x.createLinearGradient(cx - hw, 0, cx + hw, 0);
          g.addColorStop(0, '#6e5230'); g.addColorStop(0.4, '#d8b67e'); g.addColorStop(1, '#5a4224');
          x.fillStyle = g;
          x.fillRect(cx - hw, y === top ? y : y - 4, hw * 2, 4);
        }
        for (const px of [cx - 126, cx + 126]) {
          const g = x.createLinearGradient(px - 5, 0, px + 5, 0);
          g.addColorStop(0, '#24170e'); g.addColorStop(0.45, '#8a6646'); g.addColorStop(1, '#2e1f14');
          x.fillStyle = g;
          x.fillRect(px - 4.5, top, 9, bot - top);
          for (const yy of [top + 26, this.neck, bot - 26]) {
            x.fillStyle = g;
            roundRect(x, px - 6.5, yy - 5, 13, 10, 5); x.fill();
            x.fillStyle = 'rgba(255,226,190,0.2)'; x.fillRect(px - 5, yy - 5, 10, 1);
          }
        }
      });
    }
    draw() {
      const { ctx, w, h, cell, up, lo, cx, neck } = this;
      this.begin();
      ctx.drawImage(this.room, 0, 0, w, h);
      ctx.save();
      const s = 1 - 0.34 * this.lift;
      ctx.translate(cx, neck - 40 * this.lift);
      ctx.rotate(this.angle + this.tilt);
      ctx.scale(s, s);
      ctx.translate(-cx, -neck);
      ctx.drawImage(this.back, 0, 0, w, h);
      up.paint(1);
      up.put();
      lo.paint(1);
      streaks(lo, this.fly, this.x0, this.bot - this.rows * cell, cell);
      lo.put();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(up.off, this.x0, neck - this.rows * cell, this.cols * cell, this.rows * cell);
      ctx.drawImage(lo.off, this.x0, this.bot - this.rows * cell, this.cols * cell, this.rows * cell);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.front, 0, 0, w, h);
      ctx.drawImage(this.frame, 0, 0, w, h);
      ctx.restore();
    }
  }

  /* ================= C · 모래 그림 액자 =================
     물이 든 유리 액자. 위 칸 모래가 칸막이 구멍 다섯 개로 천천히 내려앉아 겹겹이 산이 돼요.
     물속이라 줄기가 커튼처럼 흔들리고, 기포가 올라와요. 다 내려앉으면 뒤집어요. */
  class Frame extends Base {
    constructor(canvas) {
      super(canvas);
      const d = canvas.dataset;
      const { w } = this;
      this.cell = 2;
      this.fx0 = 20; this.fx1 = w - 20; this.fy0 = 124; this.fy1 = 644;
      this.bd = 10;
      this.cols = Math.floor((this.fx1 - this.fx0 - this.bd * 2) / this.cell);
      this.ix0 = (w - this.cols * this.cell) / 2;
      this.ix1 = this.ix0 + this.cols * this.cell;
      this.iy0 = this.fy0 + this.bd;
      this.resRows = 70;
      this.divY = this.iy0 + this.resRows * this.cell;
      this.divH = 6;
      this.mainTop = this.divY + this.divH;
      this.rows = Math.floor((this.fy1 - this.bd - this.mainTop) / this.cell);
      this.iy1 = this.mainTop + this.rows * this.cell;
      this.cx = w / 2; this.cy = (this.fy0 + this.fy1) / 2;
      this.res = new Pile(this.cols, this.resRows);
      this.main = new Pile(this.cols, this.rows);
      this.holes = [0.1, 0.29, 0.5, 0.71, 0.9].map((p) => Math.round(p * this.cols + rand(-3, 3)));
      /* 구멍마다 맡은 구역: 이웃 구멍과의 가운데까지 */
      this.catch = this.holes.map((c, k) => [
        k === 0 ? 0 : ((this.holes[k - 1] + c) >> 1) + 1,
        k === this.holes.length - 1 ? this.cols - 1 : (c + this.holes[k + 1]) >> 1,
      ]);
      this.hph = this.holes.map(() => rand(0, TAU));
      this.hacc = this.holes.map(() => 0);
      this.fly = new Fly(5000);
      this.bubbles = [];
      this.bubbleT = 0;
      this.rate = Number(d.rate) || 160; /* 알갱이/초 (보드). 실제 액자는 훨씬 느려요 */
      this.angle = 0; this.lift = 0; this.tilt = 0; this.tiltTo = 0;
      this.dragging = false;
      this.state = 'run'; this.flips = 0;
      this.fresh();
      this.paintRoom();
      this.sync();
    }
    /* 새 액자: 위 칸에 색 띠를 겹겹이 담고, 절반쯤은 앞서 내려앉은 풍경으로 */
    fresh() {
      this.res.clear(); this.main.clear(); this.fly.n = 0; this.bubbles.length = 0;
      const n = Math.floor(this.res.cap * 0.96);
      const per = n / 6;
      for (let i = 0; i < n; i++) this.res.land(Math.floor(Math.random() * this.cols), colorAt(this.palette, this.phase + i / per), 0);
      this.phase += n / per;
      this.fast(this.prefillTo || 0.5);
    }
    sway(k, t) { const p = this.hph[k]; return 26 * Math.sin(t * 0.19 + p) + 10 * Math.sin(t * 0.57 + p * 1.7); }
    holeX(k) { return this.ix0 + (this.holes[k] + 1) * this.cell; }
    fast(frac) {
      const n = Math.floor(this.res.count * frac);
      let moved = 0, guard = 0;
      const dt = 1 / 30;
      const per = Math.max(1, Math.round((this.rate / this.holes.length) * dt));
      while (moved < n && guard++ < 40000) {
        this.t += dt;
        for (let k = 0; k < this.holes.length; k++) {
          const [a, b] = this.catch[k];
          this.res.skim(a, b, per, (cc, col) => {
            const x = this.holeX(k) + this.sway(k, this.t) + bell() * 4;
            this.main.land(Math.floor((x - this.ix0) / this.cell), col, 0);
            moved++;
          });
        }
        if (this.res.count <= 0) break;
      }
    }
    setPalette(p) { this.palette = p; this.fresh(); this.state = 'run'; this.angle = 0; this.lift = 0; }
    pointer(kind, x) {
      if (kind === 'down') { this.dragging = true; this.sx = x; }
      else if (kind === 'move' && this.dragging) this.tiltTo = clamp((x - this.sx) / 260, -1, 1) * 0.12;
      else if (kind === 'up') this.dragging = false;
    }
    act(name) { if (name === 'flip' && this.state !== 'flip') this.startFlip(); }
    startFlip() {
      const f = this.fly;
      for (let i = 0; i < f.n; i++) this.main.land(clamp(Math.floor((f.x[i] - this.ix0) / this.cell), 0, this.cols - 1), f.c[i], 0);
      f.n = 0;
      this.bubbles.length = 0;
      this.state = 'flip'; this.ft = 0; this.swapped = false;
    }
    swap() {
      const map = (c) => this.cols - 1 - c;
      const a = this.main.takeAll(), b = this.res.takeAll();
      this.res.pour(a, map);
      this.main.pour(b, map);
      this.res.relax(1, 80);
      this.swapped = true;
    }
    step(dt) {
      this.tick(dt);
      this.t += dt;
      if (!this.dragging) this.tiltTo *= Math.max(0, 1 - dt * 2);
      this.tilt += (this.tiltTo - this.tilt) * Math.min(1, dt * 3);
      const { res, main, cell } = this;
      if (this.state === 'run') {
        for (let k = 0; k < this.holes.length; k++) {
          this.hacc[k] += (this.rate / this.holes.length) * dt;
          const m = Math.floor(this.hacc[k]);
          if (m <= 0) continue;
          this.hacc[k] -= m;
          const [a, b] = this.catch[k];
          res.skim(a, b, m, (cc, col) => {
            /* 무거운(어두운) 알갱이가 아주 조금 더 빨리 내려앉아요 */
            const lum = ((col & 255) + ((col >>> 8) & 255) + ((col >>> 16) & 255)) / 765;
            this.fly.add(this.holeX(k) + rand(-1.5, 1.5), this.mainTop + rand(0, 3), 0, rand(70, 78) + (1 - lum) * 8, col, k);
          });
        }
        res.relax(1, 2); /* 구역 사이 턱이 생기지 않게 */
        if (res.count <= 0 && this.fly.n === 0) { res.clear(); this.state = 'rest'; this.wait = 3; }
      } else if (this.state === 'rest') {
        this.wait -= dt;
        if (this.wait <= 0) this.startFlip();
      } else if (this.state === 'flip') {
        this.ft += dt;
        const p = clamp(this.ft / 2.2, 0, 1);
        if (!this.swapped && p >= 0.5) this.swap();
        const e = easeIO(p);
        this.angle = this.swapped ? Math.PI * e - Math.PI : Math.PI * e;
        this.lift = Math.sin(Math.PI * p);
        if (p >= 1) { this.angle = 0; this.lift = 0; this.state = 'run'; this.flips++; }
      }

      /* 물속에서 떨어지는 알갱이: 거의 같은 빠르기로, 줄기마다 천천히 흔들리며 */
      const f = this.fly, last = this.cols - 1;
      const push = Math.sin(this.tilt) * 90;
      for (let i = 0; i < f.n; i++) {
        f.y[i] += f.vy[i] * dt;
        const k = f.k[i] | 0;
        const depth = Math.min(1, (f.y[i] - this.mainTop) / 240);
        const target = this.holeX(k) + this.sway(k, this.t - (f.y[i] - this.mainTop) / 70) * depth + f.vx[i];
        f.x[i] += (target - f.x[i]) * Math.min(1, dt * 2.5) + rand(-0.35, 0.35);
        f.vx[i] += push * dt;
        if (f.x[i] < this.ix0) f.x[i] = this.ix0; else if (f.x[i] > this.ix1 - 1) f.x[i] = this.ix1 - 1;
        const c = clamp(Math.floor((f.x[i] - this.ix0) / cell), 0, last);
        if (f.y[i] >= this.iy1 - main.hts[c] * cell) {
          main.land(c, f.c[i], 0);
          f.kill(i);
          i--;
        }
      }

      /* 기포: 쌓인 모래에서 빠져나와 위로 올라가요 */
      this.bubbleT -= dt;
      if (this.state === 'run' && this.bubbleT <= 0) {
        this.bubbleT = rand(0.25, 0.9);
        const c = Math.floor(rand(0.05, 0.95) * this.cols);
        this.bubbles.push({ x: this.ix0 + c * cell, y: this.iy1 - main.hts[c] * cell - 2, r: rand(1.2, 3.6), ph: rand(0, TAU) });
      }
      for (let i = this.bubbles.length - 1; i >= 0; i--) {
        const b = this.bubbles[i];
        b.y -= (18 + b.r * 7) * dt;
        b.ph += dt * 3;
        if (b.y < this.mainTop + 4) this.bubbles.splice(i, 1);
      }
      this.stat('aside', `뒤집기 ${this.flips}번`);
    }
    paintRoom() {
      const { w, h, dpr, fx0, fx1, fy0, fy1, ix0, ix1, iy0 } = this;
      const iy1 = this.iy1;
      const desk = fy1 + 18;
      this.room = layer(w, h, dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#15171a'); g.addColorStop(1, '#0a0b0c');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        g = x.createRadialGradient(w * 0.15, fy0 + 40, 0, w * 0.15, fy0 + 40, 560);
        g.addColorStop(0, 'rgba(255,210,160,0.12)'); g.addColorStop(1, 'rgba(255,210,160,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 책상 */
        g = x.createLinearGradient(0, desk, 0, h);
        g.addColorStop(0, '#3a3029'); g.addColorStop(0.05, '#27201b'); g.addColorStop(1, '#0c0a09');
        x.fillStyle = g; x.fillRect(0, desk, w, h - desk);
        x.fillStyle = 'rgba(255,230,200,0.16)'; x.fillRect(0, desk, w, 1);
        /* 받침 두 개 */
        for (const px of [w * 0.24, w * 0.76]) {
          g = x.createLinearGradient(0, fy1 - 8, 0, desk);
          g.addColorStop(0, '#2c2d30'); g.addColorStop(1, '#141517');
          x.fillStyle = g;
          x.beginPath(); x.moveTo(px - 26, desk); x.quadraticCurveTo(px - 18, fy1 - 6, px, fy1 - 10); x.quadraticCurveTo(px + 18, fy1 - 6, px + 26, desk); x.closePath(); x.fill();
        }
        x.save(); x.translate(w / 2 + 8, desk + 3); x.scale(1, 0.06);
        g = x.createRadialGradient(0, 0, 0, 0, 0, 200);
        g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(-220, -220, 440, 440);
        x.restore();
      });
      /* 액자 안쪽: 뒤에서 비치는 물빛 */
      this.liquid = layer(w, h, dpr, (x) => {
        let g = x.createLinearGradient(0, iy0, 0, iy1);
        g.addColorStop(0, '#566e78'); g.addColorStop(0.45, '#3a4e57'); g.addColorStop(1, '#222f36');
        x.fillStyle = g; x.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
        g = x.createRadialGradient(ix0 + 80, iy0 + 120, 0, ix0 + 80, iy0 + 120, 420);
        g.addColorStop(0, 'rgba(255,236,210,0.14)'); g.addColorStop(1, 'rgba(255,236,210,0)');
        x.fillStyle = g; x.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
      });
      /* 칸막이(구멍 다섯) · 유리 반사 · 검은 테 */
      this.front = layer(w, h, dpr, (x) => {
        const holes = this.holes.map((c) => ix0 + c * this.cell).sort((a, b) => a - b);
        let from = ix0;
        const bar = (l, r) => {
          if (r <= l) return;
          x.fillStyle = '#1a1d1f'; x.fillRect(l, this.divY, r - l, this.divH);
          x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(l, this.divY, r - l, 1);
        };
        for (const hx of holes) { bar(from, hx); from = hx + this.cell * 2; }
        bar(from, ix1);
        let g = x.createLinearGradient(ix0, iy0, ix1, iy0 + (ix1 - ix0));
        g.addColorStop(0.1, 'rgba(255,255,255,0)'); g.addColorStop(0.24, 'rgba(255,255,255,0.07)'); g.addColorStop(0.32, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(ix0, iy0, ix1 - ix0, iy1 - iy0);
        g = x.createLinearGradient(fx0, fy0, fx1, fy1);
        g.addColorStop(0, '#3a3c40'); g.addColorStop(0.5, '#1c1d20'); g.addColorStop(1, '#0d0e10');
        x.fillStyle = g;
        x.beginPath();
        roundRect(x, fx0, fy0, fx1 - fx0, fy1 - fy0, 8);
        x.rect(ix1, iy0, -(ix1 - ix0), iy1 - iy0);
        x.fill('evenodd');
        x.strokeStyle = 'rgba(255,255,255,0.14)'; x.lineWidth = 1;
        roundRect(x, fx0 + 0.5, fy0 + 0.5, fx1 - fx0 - 1, fy1 - fy0 - 1, 8); x.stroke();
        x.strokeStyle = 'rgba(0,0,0,0.6)';
        x.strokeRect(ix0 - 0.5, iy0 - 0.5, ix1 - ix0 + 1, iy1 - iy0 + 1);
      });
    }
    draw() {
      const { ctx, w, h, cell, res, main, cx, cy } = this;
      this.begin();
      ctx.drawImage(this.room, 0, 0, w, h);
      ctx.save();
      const s = 1 - 0.36 * this.lift;
      ctx.translate(cx, cy - 30 * this.lift);
      ctx.rotate(this.angle + this.tilt);
      ctx.scale(s, s);
      ctx.translate(-cx, -cy);
      ctx.drawImage(this.liquid, 0, 0, w, h);
      res.paint(0.8);
      res.put();
      main.paint(0.8);
      streaks(main, this.fly, this.ix0, this.mainTop, cell, 200);
      main.put();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(res.off, this.ix0, this.divY - this.resRows * cell, this.cols * cell, this.resRows * cell);
      ctx.drawImage(main.off, this.ix0, this.mainTop, this.cols * cell, this.rows * cell);
      ctx.imageSmoothingEnabled = true;
      for (const b of this.bubbles) {
        const bx = b.x + Math.sin(b.ph) * 1.6;
        ctx.beginPath(); ctx.arc(bx, b.y, b.r, 0, TAU);
        ctx.strokeStyle = 'rgba(232,246,255,0.55)'; ctx.lineWidth = 0.9; ctx.stroke();
        ctx.fillStyle = 'rgba(232,246,255,0.12)'; ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.75)'; ctx.fillRect(bx - b.r * 0.45, b.y - b.r * 0.55, 1, 1);
      }
      ctx.drawImage(this.front, 0, 0, w, h);
      ctx.restore();
    }
  }

  /* ================= D · 모래 진자 =================
     위에서 내려다본 둥근 쟁반. 줄에 매달린 깔때기가 흔들리며 모래를 흘려 무늬를 그려요.
     쌓인 모래는 칸마다 높이(H)와 색으로 기억하고, 높이의 기울기로 빛과 그늘을 넣어요. */
  class Pendulum extends Base {
    constructor(canvas) {
      super(canvas);
      const { w } = this;
      this.cell = 2;
      this.cx = w / 2; this.cy = 412; this.R = 166;
      this.N = Math.ceil((this.R * 2) / this.cell) + 2;
      this.gx0 = this.cx - (this.N * this.cell) / 2;
      this.gy0 = this.cy - (this.N * this.cell) / 2;
      const N = this.N, NN = N * N;
      this.H = new Float32Array(NN);
      this.cr = new Float32Array(NN); this.cg = new Float32Array(NN); this.cb = new Float32Array(NN);
      this.mask = new Uint8Array(NN);
      this.noise = new Float32Array(NN);
      this.base = new Uint32Array(NN);
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i = y * N + x;
          const dx = this.gx0 + (x + 0.5) * this.cell - this.cx, dy = this.gy0 + (y + 0.5) * this.cell - this.cy;
          const d = Math.hypot(dx, dy);
          this.mask[i] = d < this.R - 2 ? 1 : 0;
          this.noise[i] = Math.random();
          /* 쟁반 바닥: 어두운 회갈색, 가장자리로 갈수록 조금 더 어둡게, 왼쪽 위가 살짝 밝게 */
          const v = 1 - 0.28 * (d / this.R) ** 2 + (-dx - dy) / this.R * 0.06 + rand(-0.025, 0.025);
          this.base[i] = pack(clamp(44 * v, 0, 255) | 0, clamp(39 * v, 0, 255) | 0, clamp(35 * v, 0, 255) | 0);
        }
      }
      this.off = mk(N, N);
      this.octx = this.off.getContext('2d');
      this.img = this.octx.createImageData(N, N);
      this.view = new Uint32Array(this.img.data.buffer);
      this.acc = 0;
      this.dragging = false;
      this.hand = [0, 0];
      this.vel = [0, 0];
      this.sweepX = -1;
      this.rounds = 1;
      this.push();
      this.prev = this.pos(this.osc.t);
      this.cur = colorAt(this.palette, this.phase, false);
      this.fast(Number(canvas.dataset.seconds) || 0); /* 처음부터 이만큼(초) 그린 채로 */
      this.paintRoom();
      this.sync();
    }
    get rate() { return 1250 * (this.speed.v / 0.6); }
    /* 새로 흔들기. from: 지금 자리(여기서 부드럽게 이어져요). edge: 손을 놓은 자리에서 시작 */
    push(al, A, B, edge = false, from = null) {
      const sign = () => (Math.random() < 0.5 ? -1 : 1);
      this.osc = {
        A: A ?? rand(120, 150), B: B ?? rand(0.22, 0.5) * (A ?? 135) * sign(), al: al ?? rand(0, Math.PI),
        w: TAU / rand(2.9, 3.4), eps: rand(0.01, 0.025) * sign(), prec: rand(0.06, 0.11) * sign(), tau: 36, t: 0,
        ph: edge ? 0 : -Math.PI / 2, ox: from ? from[0] : 0, oy: from ? from[1] : 0,
      };
    }
    pos(t) {
      const o = this.osc, d = Math.exp(-t / o.tau);
      const u = o.A * d * Math.cos(o.w * t + o.ph);
      const v = o.B * d * Math.sin(o.w * (1 + o.eps) * t);
      /* 흔들리는 방향이 천천히 돌아서(세차) 꽃잎 무늬가 생겨요 */
      const al = o.al + o.prec * t;
      const ca = Math.cos(al), sa = Math.sin(al);
      const k = Math.exp(-t * 2.5);
      return [u * ca - v * sa + o.ox * k, u * sa + v * ca + o.oy * k];
    }
    amp() { return Math.exp(-this.osc.t / this.osc.tau) * Math.max(Math.abs(this.osc.A), Math.abs(this.osc.B)); }
    deposit(px, py, col, amt) {
      const N = this.N;
      let gx = Math.floor((px + this.cx - this.gx0) / this.cell), gy = Math.floor((py + this.cy - this.gy0) / this.cell);
      if (gx < 1 || gy < 1 || gx >= N - 1 || gy >= N - 1) return;
      let i = gy * N + gx;
      if (!this.mask[i]) return;
      /* 너무 높아지면 옆으로 흘러내려요 */
      if (this.H[i] > 1.4) {
        const dir = [1, -1, N, -N][(Math.random() * 4) | 0];
        if (this.mask[i + dir] && this.H[i + dir] < this.H[i]) i += dir;
      }
      const h = this.H[i], nh = h + amt;
      this.cr[i] = (this.cr[i] * h + (col & 255) * amt) / nh;
      this.cg[i] = (this.cg[i] * h + ((col >>> 8) & 255) * amt) / nh;
      this.cb[i] = (this.cb[i] * h + ((col >>> 16) & 255) * amt) / nh;
      this.H[i] = nh;
    }
    trail(from, to, n) {
      for (let k = 0; k < n; k++) {
        const s = Math.random();
        this.deposit(from[0] + (to[0] - from[0]) * s + bell() * 2.2, from[1] + (to[1] - from[1]) * s + bell() * 2.2, this.color(), 0.05);
      }
    }
    fast(sec) {
      const dt = 1 / 60;
      for (let t = 0; t < sec; t += dt) {
        this.phase += dt / COLOR_SECONDS;
        this.osc.t += dt;
        const p = this.pos(this.osc.t);
        this.trail(this.prev, p, Math.round(this.rate * dt));
        this.prev = p;
        if (this.amp() < 16) this.push(undefined, undefined, undefined, false, p);
      }
    }
    pointer(kind, x, y) {
      const px = x - this.cx, py = y - this.cy;
      const lim = this.R - 22;
      const d = Math.hypot(px, py);
      const k = d > lim ? lim / d : 1;
      if (kind === 'down') { this.dragging = true; this.hand = [px * k, py * k]; this.vel = [0, 0]; }
      else if (kind === 'move' && this.dragging) {
        const nx = px * k, ny = py * k;
        this.vel = [this.vel[0] * 0.6 + (nx - this.hand[0]) * 0.4 * 30, this.vel[1] * 0.6 + (ny - this.hand[1]) * 0.4 * 30];
        this.hand = [nx, ny];
      } else if (kind === 'up' && this.dragging) {
        this.dragging = false;
        /* 놓은 자리에서, 손이 움직이던 쪽으로 흔들리기 시작해요 */
        const [hx, hy] = this.hand;
        const A = Math.max(30, Math.hypot(hx, hy));
        const al = Math.atan2(hy, hx);
        const perp = (-Math.sin(al) * this.vel[0] + Math.cos(al) * this.vel[1]);
        this.push(al, A, clamp(perp / (TAU / 3.1), -A * 0.8, A * 0.8), true);
        this.prev = this.pos(0);
      }
    }
    act(name) { if (name === 'sweep' && this.sweepX < 0) this.sweepX = 0; }
    sweep(dt) {
      const N = this.N, H = this.H;
      const speed = N / 2.6;
      const from = Math.floor(this.sweepX);
      this.sweepX += speed * dt;
      const to = Math.min(N, Math.floor(this.sweepX));
      for (let x = from; x < to; x++) {
        for (let y = 0; y < N; y++) {
          const i = y * N + x;
          const h = H[i];
          if (h <= 0) continue;
          /* 밀대 앞으로 밀려 모여요 */
          for (const [dx, wgt] of [[1, 0.55], [2, 0.3], [3, 0.15]]) {
            const tx = to + dx - 1;
            if (tx >= N) continue;
            const j = y * N + tx, a = h * wgt, hj = H[j], nh = hj + a;
            this.cr[j] = (this.cr[j] * hj + this.cr[i] * a) / nh;
            this.cg[j] = (this.cg[j] * hj + this.cg[i] * a) / nh;
            this.cb[j] = (this.cb[j] * hj + this.cb[i] * a) / nh;
            H[j] = Math.min(nh, 3.2);
          }
          H[i] = 0;
        }
      }
      if (this.sweepX >= N) { this.sweepX = -1; H.fill(0); this.rounds = 1; }
    }
    step(dt) {
      this.tick(dt);
      this.t += dt;
      this.phase += dt / COLOR_SECONDS;
      this.cur = colorAt(this.palette, this.phase, false);
      if (this.sweepX >= 0) this.sweep(dt);
      let p;
      if (this.dragging) p = this.hand;
      else {
        this.osc.t += dt;
        p = this.pos(this.osc.t);
        if (this.amp() < 16) {
          this.rounds++;
          if (this.rounds > 3 && this.sweepX < 0) this.sweepX = 0;
          this.push(undefined, undefined, undefined, false, p);
        }
      }
      this.acc += this.rate * dt;
      const n = Math.floor(this.acc);
      this.acc -= n;
      if (this.sweepX < 0) this.trail(this.prev, p, n);
      this.prev = p;
      this.fp = p;
      this.stat('aside', this.sweepX >= 0 ? '쓸어 내는 중' : `무늬 ${Math.min(this.rounds, 3)}번째`);
    }
    paintRoom() {
      const { w, h, dpr, cx, cy, R } = this;
      this.room = layer(w, h, dpr, (x) => {
        let g = x.createLinearGradient(0, 0, w, h);
        g.addColorStop(0, '#221d19'); g.addColorStop(1, '#0c0a09');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 나뭇결 */
        x.globalAlpha = 0.05;
        for (let i = 0; i < 60; i++) {
          x.strokeStyle = Math.random() < 0.5 ? '#000' : '#fff';
          x.lineWidth = rand(0.5, 2);
          const y = rand(0, h);
          x.beginPath(); x.moveTo(0, y); x.bezierCurveTo(w * 0.3, y + rand(-12, 12), w * 0.7, y + rand(-12, 12), w, y + rand(-8, 8)); x.stroke();
        }
        x.globalAlpha = 1;
        g = x.createRadialGradient(w * 0.15, 120, 0, w * 0.15, 120, 640);
        g.addColorStop(0, 'rgba(255,200,140,0.16)'); g.addColorStop(1, 'rgba(255,200,140,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 쟁반 그림자 */
        g = x.createRadialGradient(cx + 10, cy + 14, R, cx + 10, cy + 14, R + 30);
        g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
      });
      this.rim = layer(w, h, dpr, (x) => {
        /* 쟁반 안쪽 그림자: 테두리가 왼쪽 위 빛을 가려요 */
        x.save();
        x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.clip();
        x.beginPath(); x.arc(cx, cy, R + 40, 0, TAU); x.arc(cx + 6, cy + 8, R, 0, TAU, true);
        x.fillStyle = 'rgba(0,0,0,0.42)'; x.fill();
        x.restore();
        /* 테두리 */
        const g = x.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
        g.addColorStop(0, '#8a6a4c'); g.addColorStop(0.45, '#5a4230'); g.addColorStop(1, '#2a1d14');
        x.beginPath(); x.arc(cx, cy, R + 13, 0, TAU); x.arc(cx, cy, R, 0, TAU, true);
        x.fillStyle = g; x.fill();
        x.strokeStyle = 'rgba(255,228,196,0.3)'; x.lineWidth = 1;
        x.beginPath(); x.arc(cx, cy, R + 12.5, Math.PI * 0.9, Math.PI * 1.6); x.stroke();
        x.strokeStyle = 'rgba(0,0,0,0.5)';
        x.beginPath(); x.arc(cx, cy, R + 0.5, 0, TAU); x.stroke();
      });
    }
    draw() {
      const { ctx, w, h, N, H, view, cell, cx, cy } = this;
      this.begin();
      ctx.drawImage(this.room, 0, 0, w, h);
      for (let y = 1; y < N - 1; y++) {
        for (let x = 1; x < N - 1; x++) {
          const i = y * N + x;
          if (!this.mask[i]) { view[i] = 0; continue; }
          const hh = H[i];
          const cov = hh > 0 ? clamp(hh * 7 - this.noise[i], 0, 1) : 0;
          if (cov <= 0) { view[i] = this.base[i]; continue; }
          const L = clamp(1 + (-(H[i + 1] - H[i - 1]) - (H[i + N] - H[i - N])) * 1.15 + Math.min(hh, 1) * 0.06, 0.55, 1.4);
          const b = this.base[i];
          const br = b & 255, bg = (b >>> 8) & 255, bb = (b >>> 16) & 255;
          const r = br + (this.cr[i] * L - br) * cov, g = bg + (this.cg[i] * L - bg) * cov, bl = bb + (this.cb[i] * L - bb) * cov;
          view[i] = pack(clamp(r, 0, 255) | 0, clamp(g, 0, 255) | 0, clamp(bl, 0, 255) | 0);
        }
      }
      this.octx.putImageData(this.img, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.off, this.gx0, this.gy0, N * cell, N * cell);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.rim, 0, 0, w, h);
      if (this.sweepX >= 0) {
        const bx = this.gx0 + this.sweepX * cell;
        const half = Math.sqrt(Math.max(0, (this.R + 30) ** 2 - (bx - cx) ** 2));
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(bx + 5, cy - half + 8, 9, half * 2);
        const g = ctx.createLinearGradient(bx - 5, 0, bx + 6, 0);
        g.addColorStop(0, '#3a2a1c'); g.addColorStop(0.4, '#a07c56'); g.addColorStop(1, '#4a3424');
        ctx.fillStyle = g;
        roundRect(ctx, bx - 5, cy - half, 11, half * 2, 5); ctx.fill();
      }
      /* 깔때기: 줄은 위로 올라가 화면 밖 고리에 매달려요 */
      const [px, py] = this.fp || [0, 0];
      const fx = cx + px, fy = cy + py;
      ctx.strokeStyle = 'rgba(255,240,220,0.28)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(fx, fy - 6); ctx.lineTo(cx + px * 0.18, -40); ctx.stroke();
      let g = ctx.createRadialGradient(fx + 14, fy + 20, 0, fx + 14, fy + 20, 22);
      g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx + 14, fy + 20, 22, 0, TAU); ctx.fill();
      g = ctx.createRadialGradient(fx - 5, fy - 6, 1, fx, fy, 14);
      g.addColorStop(0, '#f4d9a8'); g.addColorStop(0.5, '#b08850'); g.addColorStop(1, '#5a4224');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(fx, fy, 13, 0, TAU); ctx.fill();
      ctx.fillStyle = css(this.cur); ctx.beginPath(); ctx.arc(fx, fy, 8, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(fx, fy, 2.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,215,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(fx, fy, 12.5, Math.PI * 1.05, Math.PI * 1.6); ctx.stroke();
    }
  }

  /* ================= E · 유리병 =================
     해 질 녘 창가의 유리병. 깔때기에 꽂은 대롱이 병 안을 오가며 색모래를 깔아요.
     다 차면 코르크를 막아 창턱으로 옮기고, 새 병이 와요. */
  class Bottle extends Base {
    constructor(canvas) {
      super(canvas);
      const { w } = this;
      this.cell = 2;
      this.cx = w / 2;
      this.sill = 604;
      this.botY = this.sill - 6;
      this.B = 86; this.r = 26;
      this.shY = 336; this.neckY = 288; this.n = 19; this.lipY = 258;
      this.cols = Math.ceil((this.B * 2) / this.cell);
      this.x0 = this.cx - (this.cols * this.cell) / 2;
      this.rows = Math.ceil((this.botY - this.neckY) / this.cell);
      this.top0 = this.botY - this.rows * this.cell;
      const flo = new Int32Array(this.cols), cei = new Int32Array(this.cols);
      for (let c = 0; c < this.cols; c++) {
        const dx = Math.abs(this.x0 + (c + 0.5) * this.cell - this.cx);
        let a = -1, b = -1;
        for (let k = 0; k < this.rows; k++) {
          if (dx <= this.half(this.botY - (k + 0.5) * this.cell) - 3) { if (a < 0) a = k; b = k; }
        }
        flo[c] = a < 0 ? 0 : a; cei[c] = a < 0 ? 0 : b + 1;
      }
      this.flo = flo; this.cei = cei;
      this.pile = new Pile(this.cols, this.rows, flo, cei);
      this.fullK = Math.floor((this.botY - this.shY - 2) / this.cell);
      this.fly = new Fly(4000);
      this.seed();
      this.tipX = this.tx = this.autoX(this.t);
      this.tipY = this.botY - 30;
      this.hold = 0; this.dragging = false; this.acc = 0;
      this.state = 'pour'; this.at = 0;
      this.slots = [26, 70, w - 70, w - 26];
      this.shelf = [];
      for (const p of (canvas.dataset.made || 'sea,dusk').split(',').filter(Boolean)) this.shelf.push(this.makeDone(p));
      this.cur = colorAt(this.palette, this.phase, false);
      if (this.prefillTo) this.prefill(this.pile, this.prefillTo, this.palette);
      this.paintRoom();
      this.sync();
    }
    half(y) {
      const { botY, r, B, shY, neckY, n } = this;
      if (y > botY) return 0;
      if (y > botY - r) { const dy = y - (botY - r); return B - r + Math.sqrt(Math.max(0, r * r - dy * dy)); }
      if (y >= shY) return B;
      if (y >= neckY) return n + (B - n) * Math.pow(Math.sin((((y - neckY) / (shY - neckY)) * Math.PI) / 2), 0.8);
      return n;
    }
    seed() { this.p1 = rand(0, TAU); this.p2 = rand(0, TAU); }
    autoX(t) { return this.cx + (this.B - 18) * clamp(0.72 * Math.sin(t * 0.23 + this.p1) + 0.28 * Math.sin(t * 0.71 + this.p2), -1, 1); }
    get rate() { return (this.pile.cap * 0.9) / (this.speed.fill * 0.32); }
    prefill(pile, frac, pal) {
      const n = Math.floor(pile.cap * frac);
      let t = rand(0, 100), ph = rand(0, 5);
      const p1 = rand(0, TAU), p2 = rand(0, TAU);
      const dt = 1 / this.rate;
      for (let i = 0; i < n; i++) {
        t += dt; ph += dt / 5;
        const x = this.cx + (this.B - 18) * clamp(0.72 * Math.sin(t * 0.23 + p1) + 0.28 * Math.sin(t * 0.71 + p2), -1, 1) + bell() * 4;
        pile.land(Math.floor((x - this.x0) / this.cell), colorAt(pal, ph), 0);
      }
      if (pile === this.pile) { this.phase = ph; }
    }
    makeDone(pal) {
      const p = new Pile(this.cols, this.rows, this.flo, this.cei);
      this.prefill(p, 0.86, pal);
      p.paint(0.7);
      p.put();
      const snap = mk(this.cols, this.rows);
      snap.getContext('2d').drawImage(p.off, 0, 0);
      return { snap, pal };
    }
    pointer(kind, x) {
      if (kind === 'down') { this.dragging = true; this.tx = x; }
      else if (kind === 'move' && this.dragging) this.tx = x;
      else if (kind === 'up' && this.dragging) { this.dragging = false; this.hold = 3; }
    }
    step(dt) {
      this.tick(dt);
      this.t += dt;
      this.phase += dt / 5;
      this.cur = colorAt(this.palette, this.phase, false);
      const { pile, cell } = this;
      if (!this.dragging) {
        if (this.hold > 0) this.hold -= dt;
        else this.tx += (this.autoX(this.t) - this.tx) * Math.min(1, dt * 1.2);
      }
      const prev = this.tipX;
      this.tipX += (clamp(this.tx, this.cx - this.B + 16, this.cx + this.B - 16) - this.tipX) * Math.min(1, dt * 5);
      const vx = (this.tipX - prev) / dt;
      const c = clamp(Math.floor((this.tipX - this.x0) / cell), 0, this.cols - 1);
      const surf = this.botY - pile.hts[c] * cell;
      this.tipY += (clamp(surf - 22, this.shY + 8, this.botY - 18) - this.tipY) * Math.min(1, dt * 3);

      if (this.state === 'pour') {
        this.acc += this.rate * dt;
        while (this.acc >= 1) {
          this.acc -= 1;
          this.fly.add(this.tipX + bell() * this.speed.spread * 0.5, this.tipY + rand(0, 3), vx * 0.25 + rand(-6, 6), rand(30, 60), this.color());
        }
        const mid = this.cols >> 1;
        if (pile.peakIn(mid - 24, mid + 24) >= this.fullK) { this.state = 'cork'; this.at = 0; }
      } else {
        this.at += dt;
        if (this.state === 'cork' && this.at > 1.1) {
          pile.paint(0.7); pile.put();
          const snap = mk(this.cols, this.rows);
          snap.getContext('2d').drawImage(pile.off, 0, 0);
          this.moving = { snap, pal: this.palette };
          if (this.shelf.length >= this.slots.length) this.shelf.shift();
          this.state = 'shelve'; this.at = 0;
        } else if (this.state === 'shelve' && this.at > 1.6) {
          this.shelf.push(this.moving);
          this.moving = null;
          pile.clear(); this.fly.n = 0; this.seed();
          this.state = 'new'; this.at = 0;
        } else if (this.state === 'new' && this.at > 0.9) this.state = 'pour';
      }

      const f = this.fly, last = this.cols - 1;
      for (let i = 0; i < f.n; i++) {
        f.vy[i] += GRAVITY * dt;
        f.y[i] += f.vy[i] * dt;
        f.x[i] += f.vx[i] * dt;
        const cc = clamp(Math.floor((f.x[i] - this.x0) / cell), 0, last);
        if (f.y[i] >= this.botY - pile.hts[cc] * cell) {
          if (this.state === 'pour' || this.state === 'cork') pile.land(cc, f.c[i], f.vx[i] > 12 ? 1 : f.vx[i] < -12 ? -1 : 0);
          f.kill(i);
          i--;
        }
      }
      this.stat('aside', `오늘 만든 병 ${this.shelf.length + (this.moving ? 1 : 0)}`);
    }
    /* 병 모양(바깥 유리). s: 크기, (ox, oy): 병 바닥 가운데 */
    path(x, s = 1, ox = this.cx, oy = this.sill) {
      const top = this.lipY, bot = this.botY, N = 70;
      const P = (dx, y) => [ox + dx * s, oy + (y - this.sill) * s];
      x.beginPath();
      for (let i = 0; i <= N; i++) { const y = top + ((bot - top) * i) / N; x.lineTo(...P(-(this.half(Math.min(y, bot - 0.01)) + 3), y)); }
      x.lineTo(...P(-(this.B - this.r), this.sill));
      x.lineTo(...P(this.B - this.r, this.sill));
      for (let i = N; i >= 0; i--) { const y = top + ((bot - top) * i) / N; x.lineTo(...P(this.half(Math.min(y, bot - 0.01)) + 3, y)); }
      x.closePath();
    }
    drawBottle(ctx, snap, s, ox, oy, cork, alpha = 1) {
      const { cell } = this;
      ctx.save();
      ctx.globalAlpha = alpha;
      this.path(ctx, s, ox, oy);
      ctx.fillStyle = 'rgba(255,236,220,0.06)'; ctx.fill();
      ctx.save();
      ctx.clip();
      ctx.imageSmoothingEnabled = s < 0.9;
      const sx = ox + (this.x0 - this.cx) * s, sy = oy + (this.top0 - this.sill) * s;
      ctx.drawImage(snap, sx, sy, this.cols * cell * s, this.rows * cell * s);
      ctx.imageSmoothingEnabled = true;
      ctx.restore();
      this.path(ctx, s, ox, oy);
      ctx.lineWidth = Math.max(0.8, 1.6 * s); ctx.strokeStyle = 'rgba(255,238,222,0.5)'; ctx.stroke();
      /* 창을 등진 유리: 왼쪽에 긴 반사 */
      ctx.strokeStyle = 'rgba(255,248,236,0.22)'; ctx.lineWidth = 6 * s; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(ox - this.B * 0.66 * s, oy + (this.shY + 30 - this.sill) * s); ctx.lineTo(ox - this.B * 0.66 * s, oy + (this.botY - 50 - this.sill) * s); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,248,236,0.5)'; ctx.lineWidth = 1.4 * s;
      ctx.beginPath(); ctx.moveTo(ox + this.B * 0.82 * s, oy + (this.shY + 40 - this.sill) * s); ctx.lineTo(ox + this.B * 0.82 * s, oy + (this.botY - 80 - this.sill) * s); ctx.stroke();
      /* 입구 테 */
      ctx.fillStyle = 'rgba(255,238,222,0.32)';
      ctx.fillRect(ox - (this.n + 6) * s, oy + (this.lipY - 4 - this.sill) * s, (this.n + 6) * 2 * s, 5 * s);
      if (cork > 0) {
        const cy = this.lipY - 18 + 22 * ease(Math.min(1, cork));
        const g = ctx.createLinearGradient(ox - this.n * s, 0, ox + this.n * s, 0);
        g.addColorStop(0, '#7a5634'); g.addColorStop(0.45, '#c79a68'); g.addColorStop(1, '#6a4a2c');
        ctx.fillStyle = g;
        roundRect(ctx, ox - (this.n - 2) * s, oy + (cy - this.sill) * s, (this.n - 2) * 2 * s, 24 * s, 3 * s); ctx.fill();
      }
      ctx.restore();
    }
    paintRoom() {
      const { w, h, dpr, sill } = this;
      const wx0 = 14, wx1 = w - 14, wy0 = 94, wy1 = sill - 30;
      this.room = layer(w, h, dpr, (x) => {
        x.fillStyle = '#1a1411'; x.fillRect(0, 0, w, h);
        /* 해 질 녘 하늘 */
        let g = x.createLinearGradient(0, wy0, 0, wy1);
        g.addColorStop(0, '#1a2140'); g.addColorStop(0.42, '#3b3a5f'); g.addColorStop(0.72, '#8c5a6c'); g.addColorStop(0.92, '#dc9566'); g.addColorStop(1, '#f0b276');
        x.fillStyle = g; x.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
        x.fillStyle = 'rgba(255,248,230,0.7)';
        for (const [sx, sy] of [[60, 140], [300, 168], [228, 122], [96, 210]]) x.fillRect(sx, sy, 1.4, 1.4);
        /* 먼 동네 */
        let bx = wx0;
        while (bx < wx1) {
          const bw = rand(14, 34), bh = rand(10, 48);
          x.fillStyle = '#231b2a'; x.fillRect(bx, wy1 - bh, bw, bh);
          x.fillStyle = 'rgba(255,214,150,0.75)';
          for (let k = 0; k < 3; k++) if (Math.random() < 0.45) x.fillRect(bx + rand(3, bw - 4), wy1 - rand(4, bh - 3), 2, 2);
          bx += bw + rand(0, 4);
        }
        /* 창틀 */
        x.strokeStyle = '#2b211b'; x.lineWidth = 10;
        x.strokeRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
        x.fillStyle = '#2b211b';
        x.fillRect(w / 2 - 4, wy0, 8, wy1 - wy0);
        x.fillRect(wx0, wy0 + (wy1 - wy0) * 0.42, wx1 - wx0, 7);
        /* 창턱 */
        g = x.createLinearGradient(0, sill, 0, sill + 24);
        g.addColorStop(0, '#7a5a40'); g.addColorStop(0.2, '#5a4130'); g.addColorStop(1, '#2e2018');
        x.fillStyle = g; x.fillRect(0, sill, w, 24);
        x.fillStyle = 'rgba(255,224,186,0.35)'; x.fillRect(0, sill, w, 1);
        g = x.createLinearGradient(0, sill + 24, 0, h);
        g.addColorStop(0, '#120d0b'); g.addColorStop(1, '#0a0807');
        x.fillStyle = g; x.fillRect(0, sill + 24, w, h - sill - 24);
        /* 창으로 들어온 노을빛이 창턱에 번져요 */
        g = x.createRadialGradient(w / 2, sill, 0, w / 2, sill, 240);
        g.addColorStop(0, 'rgba(255,170,110,0.18)'); g.addColorStop(1, 'rgba(255,170,110,0)');
        x.fillStyle = g; x.fillRect(0, sill - 60, w, 90);
      });
    }
    drawTube(ctx) {
      const { cx, lipY } = this;
      /* 대롱: 깔때기 아래에서 병 안의 모래 바로 위까지 */
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(255,240,226,0.32)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(cx, lipY - 10); ctx.lineTo(this.tipX, this.tipY); ctx.stroke();
      ctx.strokeStyle = css(this.cur, 0.9); ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.moveTo(cx, lipY - 10); ctx.lineTo(this.tipX, this.tipY); ctx.stroke();
      /* 유리 깔때기 */
      const top = lipY - 52, bot = lipY - 12;
      ctx.beginPath();
      ctx.moveTo(cx - 32, top); ctx.lineTo(cx + 32, top); ctx.lineTo(cx + 4, bot); ctx.lineTo(cx - 4, bot); ctx.closePath();
      ctx.fillStyle = 'rgba(255,240,226,0.08)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,240,226,0.5)'; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.fillStyle = css(this.cur);
      ctx.beginPath(); ctx.moveTo(cx - 17, top + 19); ctx.quadraticCurveTo(cx, top + 12, cx + 17, top + 19); ctx.lineTo(cx + 4, bot - 1); ctx.lineTo(cx - 4, bot - 1); ctx.closePath(); ctx.fill();
    }
    draw() {
      const { ctx, w, h, cell, pile } = this;
      this.begin();
      ctx.drawImage(this.room, 0, 0, w, h);
      const mini = 0.2;
      this.shelf.forEach((b, i) => this.drawBottle(ctx, b.snap, mini, this.slots[i], this.sill, 1));
      if (this.state === 'shelve' && this.moving) {
        const p = easeIO(Math.min(1, this.at / 1.6));
        const slot = this.slots[Math.min(this.shelf.length, this.slots.length - 1)];
        const s = 1 + (mini - 1) * p;
        const ox = this.cx + (slot - this.cx) * p;
        const oy = this.sill - Math.sin(Math.PI * p) * 60;
        this.drawBottle(ctx, this.moving.snap, s, ox, oy, 1);
        return;
      }
      pile.paint(0.7);
      streaks(pile, this.fly, this.x0, this.top0, cell);
      pile.put();
      const alpha = this.state === 'new' ? Math.min(1, this.at / 0.9) : 1;
      if (this.state === 'pour' || this.state === 'new') {
        ctx.globalAlpha = alpha;
        this.drawTube(ctx);
        ctx.globalAlpha = 1;
      }
      this.drawBottle(ctx, pile.off, 1, this.cx, this.sill, this.state === 'cork' ? this.at / 0.8 : 0, alpha);
    }
  }

  const KINDS = { refine: Refine, hourglass: Hourglass, frame: Frame, pendulum: Pendulum, bottle: Bottle };
  const scenes = [];
  /* ?warm=20 : 처음 그리기 전에 20초만큼 미리 움직여 둬요 (스크린샷 확인용) */
  const warm = Number(new URLSearchParams(location.search).get('warm')) || 0;
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__s2.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-s2]').forEach((c) => {
      const K = KINDS[c.dataset.s2];
      if (!K) return;
      const sc = new K(c);
      c.__s2 = sc;
      scenes.push(sc);
      for (let t = 0; t < warm; t += 1 / 30) sc.step(1 / 30);
      sc.draw();
      if (io) io.observe(c);
      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return [(e.clientX - r.left) * (sc.w / r.width), (e.clientY - r.top) * (sc.h / r.height)];
      };
      c.addEventListener('pointerdown', (e) => {
        if (c.setPointerCapture) { try { c.setPointerCapture(e.pointerId); } catch (_) { /* 캡처가 안 되는 환경은 그대로 둬요 */ } }
        sc.pointer('down', ...pos(e));
      });
      c.addEventListener('pointermove', (e) => sc.pointer('move', ...pos(e)));
      c.addEventListener('pointerup', (e) => sc.pointer('up', ...pos(e)));
      c.addEventListener('pointercancel', (e) => sc.pointer('up', ...pos(e)));
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-s2-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-s2]');
      if (c && c.__s2) c.__s2.action(b.dataset.s2Act, b.dataset.value);
    });
    let last = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (!last) { last = now; return; }
      const elapsed = (now - last) / 1000;
      if (elapsed < 1 / 31) return;
      last = now;
      const dt = Math.min(elapsed, 0.05);
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
