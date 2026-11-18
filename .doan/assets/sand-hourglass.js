/* mong — 모래멍 · 모래시계 디벨롭 시안 (Doan 보드 전용). 코드(src/scenes)에는 아직 없어요.
   <canvas data-hg> 하나가 모래시계 장면 하나예요. 같은 .screen 안의 [data-hg-act] 버튼이 조작하고 [data-hg-stat] 에 상태를 적어요.
     data-palette  desert 사막 · white 백사 · black 흑사 · rose 장밋빛 · dune 사구 · dusk 노을 · sea 바다
     data-mode     15 · 30 · loop
     data-cycle    보드에서 한 번 다 내려가는 시간(초)
     data-prefill  처음부터 이만큼 내려간 채로 (0~1)
     data-tray     open 이면 트레이(모래 색 · 설정)가 열린 채로 시작해요
     data-top      유리 윗면 y (기본 150, 데스크톱 120). 모래시계 크기는 폰과 같아요
     data-autoflip on 이면 15분 · 30분이 다 내려간 뒤 다시 뒤집어요(기본은 멈춰요, 앱과 같아요)

   v2 와 달라진 점
   - 알갱이 1px. 알갱이마다 '어느 띠 · 밝기 · 광물(검은 점 · 반짝이는 석영)'을 기억하고, 색은 그릴 때 색 묶음에서 찾아요.
     그래서 색을 바꿔도 쌓인 모양은 그대로이고, 0.7초 동안 새 색으로 번져요.
   - 빛: 둥근 유리 안의 모래라 가운데가 밝고 가장자리가 어두워요(원통 빛). 겉면은 오른쪽 위 스탠드 쪽을 향하면 밝고, 겉에서 깊어질수록 어두워요.
   - 아래 원뿔은 한 번에 고르게 쌓이지 않아요. 떨어진 자리에 잠깐 붙어 있다가 비탈이 가팔라지면 한 칸씩 흘러내려요(사태).
   - 줄기: 목에서는 촘촘한 한 줄, 내려갈수록 알갱이가 조금씩 벌어지고, 부딪친 알갱이 일부는 튀었다가 내려앉아요. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const bell = () => Math.random() + Math.random() + Math.random() - 1.5;

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
  function roundRect(x, l, t, w, h, r) {
    x.beginPath();
    x.moveTo(l + r, t);
    x.arcTo(l + w, t, l + w, t + h, r);
    x.arcTo(l + w, t + h, l, t + h, r);
    x.arcTo(l, t + h, l, t, r);
    x.arcTo(l, t, l + w, t, r);
    x.closePath();
  }

  /* ---------- 색 묶음 ----------
     bands: 위 칸에 처음 깔리는 다섯 띠. 한 가지 색 묶음은 띠끼리 거의 같아서 결만 살짝 보여요.
     speck: 검은 광물 알갱이, glint: 빛을 받으면 반짝이는 석영 알갱이 */
  const PAL = {
    desert: { label: '사막', group: 'one', bands: [[222, 194, 148], [212, 182, 136], [229, 203, 160], [206, 175, 130], [218, 190, 144]], speck: [92, 70, 54], glint: [255, 247, 228] },
    white: { label: '백사', group: 'one', bands: [[236, 231, 218], [227, 221, 206], [242, 238, 227], [222, 214, 199], [232, 227, 213]], speck: [118, 110, 102], glint: [255, 255, 255] },
    black: { label: '흑사', group: 'one', bands: [[64, 60, 58], [56, 53, 52], [72, 66, 62], [50, 48, 48], [66, 61, 59]], speck: [22, 20, 20], glint: [236, 232, 224], rim: [206, 198, 186] },
    rose: { label: '장밋빛', group: 'one', bands: [[226, 166, 156], [216, 154, 147], [233, 179, 168], [210, 148, 143], [223, 162, 153]], speck: [118, 68, 70], glint: [255, 238, 232] },
    dune: { label: '사구', group: 'band', bands: [[240, 226, 196], [218, 180, 124], [192, 128, 84], [142, 94, 66], [88, 72, 64]], speck: [52, 40, 34], glint: [255, 246, 226] },
    dusk: { label: '노을', group: 'band', bands: [[244, 208, 146], [234, 152, 108], [204, 98, 116], [132, 88, 156], [64, 66, 120]], speck: [40, 30, 46], glint: [255, 240, 220] },
    sea: { label: '바다', group: 'band', bands: [[236, 232, 216], [152, 208, 198], [78, 154, 172], [48, 98, 146], [30, 54, 92]], speck: [20, 30, 44], glint: [240, 252, 255] },
  };
  const JIT = 64;
  /* ImageData 바이트는 R,G,B,A 라서 Uint32 로는 ABGR 이에요 */
  const pack = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;

  /* 알갱이 = 띠(0~4) · 밝기(0~63) · 종류(0 보통 · 1 검은 점 · 2 석영). 0 은 빈칸이라 맨 위 비트를 늘 켜요 */
  const grain = (band) => {
    const r = Math.random();
    const kind = r < 0.045 ? 1 : r < 0.08 ? 2 : 0;
    const jit = clamp(Math.round(32 + bell() * 26), 0, JIT - 1);
    return ((1 << 24) | (kind << 16) | (jit << 8) | band) >>> 0;
  };
  const lutIndex = (g) => (((g & 255) * 3 + ((g >>> 16) & 255)) * JIT + ((g >>> 8) & 255));

  function buildLut(id) {
    const p = PAL[id];
    const lut = new Uint32Array(5 * 3 * JIT);
    for (let b = 0; b < 5; b++) {
      const base = p.bands[b];
      for (let kind = 0; kind < 3; kind++) {
        for (let j = 0; j < JIT; j++) {
          const t = j / (JIT - 1);
          let k = 0.8 + 0.3 * t;
          let r = base[0], g = base[1], bl = base[2];
          /* 밝은 알갱이는 살짝 노랗게, 어두운 알갱이는 살짝 붉게 (실제 모래의 석영 · 장석 차이) */
          r += (t - 0.5) * 6; g += (t - 0.5) * 8; bl += (t - 0.5) * 2;
          if (kind === 1) { const m = 0.72; r = r + (p.speck[0] - r) * m; g = g + (p.speck[1] - g) * m; bl = bl + (p.speck[2] - bl) * m; k = 0.85 + 0.25 * t; }
          if (kind === 2) { const m = 0.55; r = r + (p.glint[0] - r) * m; g = g + (p.glint[1] - g) * m; bl = bl + (p.glint[2] - bl) * m; k = 1; }
          lut[(b * 3 + kind) * JIT + j] = pack(clamp(r * k, 0, 255) | 0, clamp(g * k, 0, 255) | 0, clamp(bl * k, 0, 255) | 0);
        }
      }
    }
    return lut;
  }
  const LUTS = {};
  const lutOf = (id) => LUTS[id] || (LUTS[id] = buildLut(id));

  /* ================= 쌓인 모래 한 무더기 =================
     칸 c 에는 flo[c] 부터 cei[c] 바로 아래까지 모래가 들어가요. hts[c] 는 지금 높이(바닥에서 센 칸 수). */
  class Pile {
    constructor(cols, rows, flo, cei) {
      this.cols = cols;
      this.rows = rows;
      this.flo = flo;
      this.cei = cei;
      this.grid = new Uint32Array(cols * rows);
      this.hts = Int32Array.from(flo);
      this.snap = new Int32Array(cols);
      this.count = 0;
      this.cap = 0;
      for (let c = 0; c < cols; c++) this.cap += Math.max(0, cei[c] - flo[c]);
      this.off = mk(cols, rows);
      this.octx = this.off.getContext('2d');
      this.img = this.octx.createImageData(cols, rows);
      this.view = new Uint32Array(this.img.data.buffer);
      this.light = this.bakeLight();
    }

    at(c, k) { return (this.rows - 1 - k) * this.cols + c; }
    clear() { this.grid.fill(0); this.hts.set(this.flo); this.count = 0; }

    /* 둥근 유리 안이라 줄마다 가운데가 앞으로 나와 있어요. 오른쪽 앞에서 오는 빛으로 미리 구워 둬요 */
    bakeLight() {
      const { cols, rows, flo, cei } = this;
      const m = new Float32Array(cols * rows);
      for (let k = 0; k < rows; k++) {
        let L = -1, R = -1;
        for (let c = 0; c < cols; c++) if (k >= flo[c] && k < cei[c]) { if (L < 0) L = c; R = c; }
        if (L < 0) continue;
        const mid = (L + R + 1) / 2, half = Math.max(1, (R - L + 1) / 2);
        for (let c = L; c <= R; c++) {
          const u = clamp((c + 0.5 - mid) / half, -1, 1);
          const z = Math.sqrt(1 - u * u);
          const lam = Math.max(0, 0.42 * u + 0.9 * z);
          let f = 0.5 + 0.56 * lam;
          const edge = Math.min(c - L, R - c);
          if (edge < 2) f *= 0.82; /* 유리에 맞닿은 알갱이는 그늘져요 */
          if (u > 0.82) f *= 1.06; /* 오른쪽 유리 안쪽으로 비치는 빛 */
          m[(rows - 1 - k) * cols + c] = f;
        }
      }
      return m;
    }

    /* 알갱이가 c 칸에 내려앉아요. stick 확률로 그 자리에 잠깐 붙어 있고, 아니면 낮은 쪽으로 굴러요 */
    land(c, g, dir, stick = 0) {
      const h = this.hts, cei = this.cei, last = this.cols - 1;
      c = clamp(c | 0, 0, last);
      for (let i = 0; i < 900; i++) {
        const hc = h[c];
        const full = hc >= cei[c];
        if (!full && i === 0 && stick && Math.random() < stick) break;
        const l = c > 0 && h[c - 1] < cei[c - 1] ? h[c - 1] : 1e9;
        const r = c < last && h[c + 1] < cei[c + 1] ? h[c + 1] : 1e9;
        let canL, canR;
        if (full) {
          canL = l < 1e9; canR = r < 1e9;
          if (canL && canR) { canL = l <= r; canR = !canL; }
        } else {
          const l2 = c > 1 ? h[c - 2] : 1e9, r2 = c < last - 1 ? h[c + 2] : 1e9;
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
      return true;
    }

    move(from, to) {
      const a = this.at(from, this.hts[from] - 1);
      const g = this.grid[a];
      this.grid[a] = 0;
      this.hts[from]--;
      this.grid[this.at(to, this.hts[to])] = g;
      this.hts[to]++;
    }

    /* 한 번에 끝까지 미끄러져요 (안 보이는 정리용) */
    relax(lim, passes) {
      const h = this.hts, flo = this.flo, cei = this.cei, n = this.cols;
      for (let p = 0; p < passes; p++) {
        let moved = false;
        for (let c = 0; c < n - 1; c++) while (h[c] - h[c + 1] > lim && h[c] > flo[c] && h[c + 1] < cei[c + 1]) { this.move(c, c + 1); moved = true; }
        for (let c = n - 1; c > 0; c--) while (h[c] - h[c - 1] > lim && h[c] > flo[c] && h[c - 1] < cei[c - 1]) { this.move(c, c - 1); moved = true; }
        if (!moved) break;
      }
    }

    /* 한 걸음에 한 칸씩만 미끄러져요. 프레임마다 몇 번 부르면 비탈을 따라 모래가 흘러내리는 게 보여요.
       한 칸 차이(45°)만 보면 너무 가팔라서, 세 칸 옆보다 두 칸 넘게 높아도(약 34°, 마른 모래의 안식각) 미끄러져요 */
    slide(lim) {
      const h = this.hts, s = this.snap, flo = this.flo, cei = this.cei, n = this.cols;
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

    /* a..b 칸 바닥의 구멍으로 n 알갱이씩 빠져요 */
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

    takeAll() {
      const out = [];
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

    pour(list, map) { for (let i = 0; i < list.length; i += 2) this.land(map(list[i]), list[i + 1], 0); }

    /* lut: 지금 색, old/fade: 바뀌기 전 색과 남은 비율. glintT: 석영이 반짝이는 순간을 고르는 시계 */
    paint(lut, old, fade, glintT) {
      const { cols, rows, grid: g, hts: h, flo, view, light } = this;
      view.fill(0);
      const last = cols - 1;
      const fo = Math.round(fade * 256), fn = 256 - fo;
      for (let c = 0; c < cols; c++) {
        const top = h[c];
        if (top <= flo[c]) continue;
        const hl = c > 1 ? h[c - 2] : c > 0 ? h[c - 1] : top;
        const hr = c < last - 1 ? h[c + 2] : c < last ? h[c + 1] : top;
        /* 왼쪽이 높으면 겉면이 오른쪽(스탠드)을 봐요 */
        const face = 1 + clamp(hl - hr, -6, 6) * 0.03;
        const open = Math.min(c > 0 ? h[c - 1] : top, c < last ? h[c + 1] : top);
        for (let k = flo[c]; k < top; k++) {
          const i = (rows - 1 - k) * cols + c;
          const gr = g[i];
          const li = lutIndex(gr);
          let col = lut[li];
          if (fo) {
            const o = old[li];
            col = (((((col & 255) * fn + (o & 255) * fo) >> 8)) | (((((col >>> 8) & 255) * fn + ((o >>> 8) & 255) * fo) >> 8) << 8) | (((((col >>> 16) & 255) * fn + ((o >>> 16) & 255) * fo) >> 8) << 16)) >>> 0;
          }
          const d = top - 1 - k;
          let f;
          if (d === 0) f = face * 1.1;
          else if (k >= open) f = face * 1.04;
          else if (d < 3) f = face;
          else f = 1 - Math.min(0.2, (d - 3) * 0.014);
          f *= light[i];
          if (d < 2 && ((gr >>> 16) & 255) === 2) {
            /* 겉에 나온 석영이 가끔 반짝여요 */
            const ph = ((gr >>> 8) & 255) * 0.37 + c * 0.11;
            const s = Math.sin(glintT * 1.7 + ph * 9.1);
            if (s > 0.94) f *= 1 + (s - 0.94) * 9;
          }
          let r = (col & 255) * f, gg = ((col >>> 8) & 255) * f, b = ((col >>> 16) & 255) * f;
          if (f > 1.08) { const t = (f - 1.08) * 60; r += t; gg += t; b += t; }
          view[i] = ((255 << 24) | ((b > 255 ? 255 : b | 0) << 16) | ((gg > 255 ? 255 : gg | 0) << 8) | (r > 255 ? 255 : r | 0)) >>> 0;
        }
      }
    }

    put() { this.octx.putImageData(this.img, 0, 0); }
  }

  /* 떨어지는 알갱이. k: 0 처음 떨어지는 중 · 1 부딪쳐 튄 뒤 */
  class Fly {
    constructor(max) {
      this.max = max;
      this.x = new Float32Array(max); this.y = new Float32Array(max);
      this.vx = new Float32Array(max); this.vy = new Float32Array(max);
      this.g = new Uint32Array(max); this.k = new Uint8Array(max);
      this.n = 0;
    }
    add(x, y, vx, vy, g) {
      if (this.n >= this.max) return false;
      const i = this.n++;
      this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy; this.g[i] = g; this.k[i] = 0;
      return true;
    }
    kill(i) {
      const j = --this.n;
      this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.g[i] = this.g[j]; this.k[i] = this.k[j];
    }
  }

  const GRAVITY = 1150;

  /* ================= 모래시계 ================= */
  class Hourglass {
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
      this.stats = {};
      this.toastEl = this.screen && this.screen.querySelector('[data-hg-toast]');
      this.toastT = 0;
      this.t = rand(0, 100);

      this.palette = PAL[d.palette] ? d.palette : 'dusk';
      this.autoflip = d.autoflip === 'on';
      this.lut = lutOf(this.palette);
      this.oldLut = this.lut; this.fade = 0;

      this.cx = this.w / 2;
      this.top = Number(d.top) || 150; this.bot = this.top + 540; /* 데스크톱은 data-top 으로 높이만 옮겨요 */
      this.neck = (this.top + this.bot) / 2;
      this.bh = this.neck - this.top;
      this.maxHalf = 122; this.neckHalf = 3.4;
      this.cols = Math.ceil(this.maxHalf * 2);
      this.rows = Math.ceil(this.bh);
      this.x0 = this.cx - this.cols / 2;
      const fu = new Int32Array(this.cols), cu = new Int32Array(this.cols);
      const fl = new Int32Array(this.cols), cl = new Int32Array(this.cols);
      const wall = 2.2; /* 유리 두께 */
      for (let c = 0; c < this.cols; c++) {
        const dx = Math.abs(this.x0 + c + 0.5 - this.cx);
        let a = -1, b = -1, a2 = -1, b2 = -1;
        for (let k = 0; k < this.rows; k++) {
          const s = (k + 0.5) / this.bh;
          if (dx <= this.half(s) - wall) { if (a < 0) a = k; b = k; }
          if (dx <= this.half(1 - s) - wall) { if (a2 < 0) a2 = k; b2 = k; }
        }
        fu[c] = a < 0 ? 0 : a; cu[c] = a < 0 ? 0 : b + 1;
        fl[c] = a2 < 0 ? 0 : a2; cl[c] = a2 < 0 ? 0 : b2 + 1;
      }
      this.up = new Pile(this.cols, this.rows, fu, cu);
      this.lo = new Pile(this.cols, this.rows, fl, cl);
      this.ha = -1; this.hb = -1; /* 목에 닿는 칸 */
      for (let c = 0; c < this.cols; c++) if (cu[c] > 0 && fu[c] === 0) { if (this.ha < 0) this.ha = c; this.hb = c; }
      this.fly = new Fly(4000);

      this.angle = 0; this.tilt = 0; this.tiltTo = 0; this.lift = 0;
      this.dragging = false;
      this.state = 'run'; this.wait = 0; this.flips = 0; this.acc = 0; this.starve = 0;
      this.mode = d.mode || 'loop';
      this.cycle = Number(d.cycle) || 60;
      this.fill(this.up, 0.78);
      this.total = this.up.count;
      this.rate = this.total / this.cycle;
      const pre = Number(d.prefill) || 0;
      if (pre) this.fast(pre);
      this.paintRoom();
      if (d.tray === 'open') this.tray(true);
      this.sync();
    }

    /* 유리 반폭. s: 목 0 → 마개 1 */
    half(s) {
      const b = Math.pow(Math.sin((Math.min(1, s / 0.8) * Math.PI) / 2), 1.3);
      const sh = s > 0.86 ? Math.sqrt(Math.max(0, 1 - ((s - 0.86) / 0.14) ** 2 * 0.22)) : 1;
      return this.neckHalf + (this.maxHalf - this.neckHalf) * b * sh;
    }

    /* 위 칸에 띠 다섯 개를 겹겹이 깔아요 */
    fill(pile, frac) {
      const n = Math.floor(pile.cap * frac);
      const per = n / 6.5;
      for (let i = 0; i < n; i++) pile.land(Math.floor(Math.random() * pile.cols), grain(Math.floor(i / per) % 5), 0);
      pile.relax(1, 40);
    }

    /* 앞서 흘러내린 만큼 미리 옮겨 둬요 */
    fast(frac) {
      const n = Math.floor(this.up.count * frac);
      const mid = (this.ha + this.hb) / 2;
      let moved = 0, guard = 0;
      while (moved < n && this.up.count > 0 && guard++ < 600000) {
        let got = 0;
        this.up.drain(this.ha, this.hb, 1, (c, g) => { this.lo.land(Math.round(mid + bell() * 2.4), g, 0); got++; });
        moved += got;
        if (!got || (guard & 3) === 0) this.up.relax(got ? 1 : 0, 3);
      }
      this.up.relax(1, 80);
      for (let i = 0; i < 160; i++) { this.up.slide(1); this.lo.slide(1); }
    }

    stat(name, text) {
      if (!this.screen || this.stats[name] === text) return;
      this.stats[name] = text;
      this.screen.querySelectorAll(`[data-hg-stat="${name}"]`).forEach((e) => { e.textContent = text; });
    }
    toast(text, sec = 2.6) {
      if (!this.toastEl) return;
      this.toastEl.querySelector('span:last-child').textContent = text;
      this.toastEl.classList.add('show');
      this.toastT = sec;
    }
    tray(open) {
      if (!this.screen) return;
      const el = this.screen.querySelector('[data-hg-tray]');
      if (!el) return;
      const v = open === undefined ? !el.classList.contains('open') : open;
      el.classList.toggle('open', v);
      this.screen.querySelectorAll('[data-hg-act="tray"]').forEach((b) => b.classList.toggle('on', v));
    }
    sync() {
      const sc = this.screen;
      if (!sc) return;
      sc.querySelectorAll('[data-hg-act="palette"]').forEach((b) => b.classList.toggle('on', b.dataset.value === this.palette));
      sc.querySelectorAll('[data-hg-act="mode"]').forEach((b) => b.classList.toggle('on', b.dataset.value === this.mode));
      sc.querySelectorAll('[data-hg-act="autoflip"]').forEach((b) => { b.setAttribute('aria-checked', String(this.autoflip)); b.querySelector('.switch')?.classList.toggle('off', !this.autoflip); });
      sc.querySelectorAll('[data-hg-swatch]').forEach((e) => { e.className = `hg-chip hg-${this.palette}`; });
      this.stat('palette', PAL[this.palette].label);
    }

    action(name, value) {
      if (name === 'palette' && PAL[value] && value !== this.palette) {
        this.oldLut = this.lut;
        this.fade = 1;
        this.palette = value;
        this.lut = lutOf(value);
      } else if (name === 'tray') this.tray();
      else if (name === 'mode') this.mode = value;
      else if (name === 'autoflip') this.autoflip = !this.autoflip;
      else if (name === 'flip' && (this.state === 'run' || this.state === 'rest')) this.startFlip();
      this.sync();
    }

    pointer(kind, x) {
      if (kind === 'down') { this.dragging = true; this.sx = x; this.tray(false); }
      else if (kind === 'move' && this.dragging) this.tiltTo = clamp((x - this.sx) / 240, -1, 1) * 0.16;
      else if (kind === 'up') this.dragging = false;
    }

    startFlip() {
      const f = this.fly;
      for (let i = 0; i < f.n; i++) this.lo.land(Math.floor(f.x[i] - this.x0), f.g[i], 0);
      f.n = 0;
      this.state = 'flip'; this.ft = 0; this.swapped = false;
    }
    /* 옆으로 누운 순간에 위아래를 맞바꿔요 */
    swap() {
      const map = (c) => this.cols - 1 - c;
      const a = this.lo.takeAll(), b = this.up.takeAll();
      this.up.pour(a, map);
      this.lo.pour(b, map);
      this.up.relax(1, 120);
      this.lo.relax(1, 120);
      this.swapped = true;
    }

    step(dt) {
      if (this.toastT > 0) {
        this.toastT -= dt;
        if (this.toastT <= 0 && this.toastEl) this.toastEl.classList.remove('show');
      }
      this.t += dt;
      if (this.fade > 0) this.fade = Math.max(0, this.fade - dt / 0.7);
      if (!this.dragging) this.tiltTo *= Math.max(0, 1 - dt * 2.2);
      this.tilt += (this.tiltTo - this.tilt) * Math.min(1, dt * 4);
      const up = this.up, lo = this.lo, f = this.fly;

      if (this.state === 'run') {
        const nh = this.hb - this.ha + 1;
        this.acc += this.rate * dt;
        const k = Math.floor(this.acc / nh);
        if (k > 0) {
          this.acc -= k * nh;
          const mid = this.x0 + (this.ha + this.hb + 1) / 2;
          up.drain(this.ha, this.hb, k, (c, g) => {
            /* 목을 빠져나오는 순간: 가운데로 모이고, 아주 조금씩 옆으로 벌어져요 */
            const x = mid + (this.x0 + c + 0.5 - mid) * 0.5 + rand(-0.4, 0.4);
            f.add(x, this.neck + rand(-1, 3), bell() * 7, rand(25, 60), g);
          });
        }
        let fed = false;
        for (let c = this.ha; c <= this.hb; c++) if (up.hts[c] > up.flo[c]) fed = true;
        /* 위 칸: 목 위가 비면 둘레 모래가 한 칸씩 흘러들어 깔때기 모양으로 꺼져요 */
        for (let i = 0; i < 8; i++) up.slide(1);
        if (!fed) {
          this.starve += dt;
          up.relax(0, 2);
        } else this.starve = 0;
        if (up.count > 0 && this.starve > 1.2) {
          /* 유리 벽에 남은 몇 알갱이는 그냥 흘려보내요 */
          up.drain(0, this.cols - 1, 1, (c, g) => f.add(this.cx + bell(), this.neck, bell() * 6, rand(20, 50), g));
        }
        if (up.count <= 0 && f.n === 0) {
          up.clear();
          if (this.mode !== 'loop') this.toast(this.autoflip ? `${this.mode}분이 다 됐어요 · 다시 뒤집어요` : `${this.mode}분이 다 됐어요`, 3);
          this.state = 'rest';
          this.wait = this.mode === 'loop' ? 2.2 : 3.4;
        }
      } else if (this.state === 'rest') {
        this.wait -= dt;
        if (this.wait <= 0 && (this.mode === 'loop' || this.autoflip)) this.startFlip();
      } else if (this.state === 'flip') {
        this.ft += dt;
        const p = clamp(this.ft / 1.8, 0, 1);
        if (!this.swapped && p >= 0.5) this.swap();
        const e = easeIO(p);
        this.angle = this.swapped ? Math.PI * e - Math.PI : Math.PI * e;
        this.lift = Math.sin(Math.PI * p);
        if (p >= 1) { this.angle = 0; this.lift = 0; this.state = 'run'; this.flips++; }
      }

      /* 떨어지는 알갱이. 기울면 옆으로도 끌려요 */
      const gx = GRAVITY * Math.sin(this.tilt), gy = GRAVITY * Math.cos(this.tilt);
      const last = this.cols - 1, bot = this.bot;
      for (let i = 0; i < f.n; i++) {
        f.vx[i] += gx * dt; f.vy[i] += gy * dt;
        f.vx[i] *= 1 - dt * 0.6;
        f.x[i] += f.vx[i] * dt; f.y[i] += f.vy[i] * dt;
        let c = Math.floor(f.x[i] - this.x0);
        if (c < 0 || c > last || (lo.cei[c] === 0)) { f.x[i] = clamp(f.x[i], this.x0 + 1, this.x0 + last); c = clamp(c, 0, last); f.vx[i] *= -0.4; }
        const surf = bot - lo.hts[c];
        if (f.y[i] >= surf) {
          if (f.k[i] === 0 && f.vy[i] > 160 && Math.random() < 0.16) {
            /* 원뿔 꼭대기에 부딪쳐 튀어요 */
            f.k[i] = 1;
            f.y[i] = surf - 1;
            const side = Math.random() < 0.5 ? -1 : 1;
            f.vx[i] = side * rand(25, 85);
            f.vy[i] = -rand(25, 95);
            continue;
          }
          const dir = f.vx[i] > 12 ? 1 : f.vx[i] < -12 ? -1 : 0;
          lo.land(c, f.g[i], dir, f.k[i] ? 0.2 : 0.42);
          f.kill(i);
          i--;
        }
      }
      /* 아래 칸: 떨어진 자리에 붙어 있다가 비탈이 가팔라지면 한 칸씩 흘러내려요 */
      lo.slide(1); lo.slide(1);

      const label = this.mode === 'loop' ? '끝없이' : `${this.mode}분`;
      this.stat('mode', label);
      if (this.mode === 'loop') this.stat('aside', `뒤집기 ${this.flips}번`);
      else {
        const left = Math.max(0, Math.round(((up.count + f.n) / this.rate) * ((Number(this.mode) * 60) / this.cycle)));
        this.stat('aside', `남은 ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`);
      }
    }

    /* 떨어지는 알갱이를 아래 칸 그림 위에 찍어요. 빠를수록 꼬리가 길어요 */
    stamp() {
      const lo = this.lo, f = this.fly, v = lo.view, cols = lo.cols, rows = lo.rows;
      const y0 = this.bot - rows;
      const lut = this.lut;
      /* 어두운 모래(흑사)는 줄기가 배경에 묻혀서, 오른쪽 빛을 받는 쪽에 옅은 림을 한 픽셀 붙여요 */
      const rc = PAL[this.palette].rim;
      const rim = rc ? (((110 << 24) | (rc[2] << 16) | (rc[1] << 8) | rc[0]) >>> 0) : 0;
      for (let i = 0; i < f.n; i++) {
        const c = Math.floor(f.x[i] - this.x0);
        if (c < 0 || c >= cols) continue;
        const r1 = Math.floor(f.y[i] - y0);
        const stop = rows - lo.hts[c];
        const len = clamp(Math.round(Math.abs(f.vy[i]) / 150), 1, 4);
        const col = lut[lutIndex(f.g[i])];
        const dim = ((col & 0xfefefe) >>> 1) | 0xff000000; /* 꼬리는 반쯤 어둡게 */
        for (let j = 0; j < len; j++) {
          const r = r1 - j;
          if (r < 0 || r >= stop) continue;
          v[r * cols + c] = j === 0 ? col : ((dim & 0xffffff) | ((v[r * cols + c] ? 255 : 150) << 24)) >>> 0;
          if (rim && c + 1 < cols && !v[r * cols + c + 1]) v[r * cols + c + 1] = j === 0 ? rim : ((rim & 0xffffff) | (55 << 24)) >>> 0;
        }
      }
    }

    outline(x, inset = 0) {
      const { cx, top, bot, neck, bh } = this;
      const N = 180;
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
    side(x, dir, k, s0, s1, inset = 0) {
      x.beginPath();
      for (let i = 0; i <= 40; i++) {
        const s = s0 + ((s1 - s0) * i) / 40;
        x.lineTo(this.cx + (this.half(s) - inset) * k, this.neck + dir * s * this.bh);
      }
    }

    paintRoom() {
      const { w, h, dpr, cx, top, bot, neck } = this;
      const ty = bot + 22;
      this.room = layer(w, h, dpr, (x) => {
        let g = x.createLinearGradient(0, 0, 0, h);
        g.addColorStop(0, '#1d1814'); g.addColorStop(0.7, '#130f0c'); g.addColorStop(1, '#0a0806');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 오른쪽 위 스탠드 불빛이 벽에 번져요 */
        g = x.createRadialGradient(w * 0.9, 96, 0, w * 0.9, 96, 600);
        g.addColorStop(0, 'rgba(255,192,124,0.26)'); g.addColorStop(0.4, 'rgba(255,190,120,0.07)'); g.addColorStop(1, 'rgba(255,190,120,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, h);
        /* 벽의 아주 옅은 결 */
        x.globalAlpha = 0.035;
        for (let i = 0; i < 2600; i++) { x.fillStyle = Math.random() < 0.5 ? '#000' : '#fff'; x.fillRect(Math.random() * w, Math.random() * ty, 1, 1); }
        x.globalAlpha = 1;
        /* 탁자 */
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
        /* 그림자: 불빛 반대편(왼쪽)으로 길게 */
        x.save();
        x.translate(cx - 34, ty + 6); x.scale(1, 0.11);
        g = x.createRadialGradient(0, 0, 0, 0, 0, 210);
        g.addColorStop(0, 'rgba(0,0,0,0.65)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(-220, -220, 440, 440);
        x.restore();
      });
      /* 유리 뒤쪽: 안쪽이 살짝 흐리고, 뒤 기둥이 비쳐 보여요 */
      this.back = layer(w, h, dpr, (x) => {
        x.save();
        this.outline(x);
        x.clip();
        let g = x.createLinearGradient(cx - this.maxHalf, 0, cx + this.maxHalf, 0);
        g.addColorStop(0, 'rgba(255,236,214,0.02)'); g.addColorStop(0.7, 'rgba(255,236,214,0.045)'); g.addColorStop(1, 'rgba(255,220,180,0.08)');
        x.fillStyle = g; x.fillRect(0, top, w, bot - top);
        for (const px of [cx - 136, cx + 136]) {
          g = x.createLinearGradient(px - 5, 0, px + 5, 0);
          g.addColorStop(0, 'rgba(36,24,15,0)'); g.addColorStop(0.5, 'rgba(90,64,42,0.4)'); g.addColorStop(1, 'rgba(36,24,15,0)');
          x.fillStyle = g; x.fillRect(px - 5, top, 10, bot - top);
        }
        x.restore();
      });
      /* 유리 앞면: 두께 · 테두리 · 스탠드 쪽 반사 */
      this.front = layer(w, h, dpr, (x) => {
        this.outline(x);
        const g = x.createLinearGradient(cx - this.maxHalf, 0, cx + this.maxHalf, 0);
        g.addColorStop(0, 'rgba(255,236,214,0.16)'); g.addColorStop(0.5, 'rgba(255,236,214,0.1)'); g.addColorStop(1, 'rgba(255,226,190,0.42)');
        x.lineWidth = 1.3; x.strokeStyle = g; x.stroke();
        this.outline(x, 2.2);
        x.lineWidth = 0.8; x.strokeStyle = 'rgba(255,240,222,0.08)'; x.stroke();
        x.lineCap = 'round';
        for (const dir of [-1, 1]) {
          /* 오른쪽: 길고 넓은 반사 + 가는 하이라이트 */
          this.side(x, dir, 0.72, 0.3, 0.8); x.lineWidth = 9; x.strokeStyle = 'rgba(255,240,220,0.06)'; x.stroke();
          this.side(x, dir, 0.79, 0.36, 0.76); x.lineWidth = 1.8; x.strokeStyle = 'rgba(255,244,228,0.34)'; x.stroke();
          this.side(x, dir, 0.9, 0.5, 0.7); x.lineWidth = 3.4; x.strokeStyle = 'rgba(255,226,190,0.12)'; x.stroke();
          /* 왼쪽: 어두운 쪽이라 희미한 반사 한 줄 */
          this.side(x, dir, -0.84, 0.4, 0.68); x.lineWidth = 1.4; x.strokeStyle = 'rgba(255,240,222,0.09)'; x.stroke();
        }
        /* 목: 유리가 두꺼워 빛이 맺혀요 */
        let r = x.createRadialGradient(cx + 1.5, neck, 0, cx + 1.5, neck, 14);
        r.addColorStop(0, 'rgba(255,236,210,0.22)'); r.addColorStop(1, 'rgba(255,236,210,0)');
        x.fillStyle = r; x.fillRect(cx - 16, neck - 16, 32, 32);
        x.fillStyle = 'rgba(255,240,220,0.5)'; x.fillRect(cx + this.neckHalf - 0.6, neck - 6, 0.8, 12);
        /* 오른쪽 위 둥근 어깨의 반짝임 */
        for (const yy of [top + 26, bot - 30]) {
          r = x.createRadialGradient(cx + this.maxHalf * 0.62, yy, 0, cx + this.maxHalf * 0.62, yy, 22);
          r.addColorStop(0, 'rgba(255,240,220,0.16)'); r.addColorStop(1, 'rgba(255,240,220,0)');
          x.fillStyle = r; x.fillRect(cx + this.maxHalf * 0.62 - 24, yy - 24, 48, 48);
        }
      });
      /* 나무 마개와 기둥 */
      this.frame = layer(w, h, dpr, (x) => {
        const cw = 150, ch = 22;
        const grainLines = (y) => {
          x.save();
          roundRect(x, cx - cw, y, cw * 2, ch, 7); x.clip();
          x.globalAlpha = 0.12;
          for (let i = 0; i < 9; i++) {
            x.strokeStyle = i % 2 ? '#1a0f08' : '#a8805a';
            x.lineWidth = rand(0.4, 1);
            const yy = y + rand(3, ch - 3);
            x.beginPath(); x.moveTo(cx - cw, yy); x.bezierCurveTo(cx - 40, yy + rand(-2, 2), cx + 40, yy + rand(-2, 2), cx + cw, yy + rand(-1, 1)); x.stroke();
          }
          x.restore();
        };
        const cap = (y) => {
          let g = x.createLinearGradient(0, y, 0, y + ch);
          g.addColorStop(0, '#6e4f36'); g.addColorStop(0.3, '#4c3625'); g.addColorStop(1, '#22160d');
          x.fillStyle = g;
          roundRect(x, cx - cw, y, cw * 2, ch, 7); x.fill();
          g = x.createLinearGradient(cx - cw, 0, cx + cw, 0);
          g.addColorStop(0, 'rgba(0,0,0,0.3)'); g.addColorStop(0.6, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(255,200,150,0.12)');
          x.fillStyle = g; roundRect(x, cx - cw, y, cw * 2, ch, 7); x.fill();
          grainLines(y);
          x.fillStyle = 'rgba(255,226,190,0.26)'; x.fillRect(cx - cw + 7, y, cw * 2 - 14, 1);
          x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(cx - cw + 4, y + ch * 0.58, cw * 2 - 8, 1);
        };
        cap(top - ch);
        cap(bot);
        /* 유리가 마개에 닿는 놋쇠 고리 */
        for (const y of [top, bot - 5]) {
          const hw = this.half(1) + 4;
          const g = x.createLinearGradient(cx - hw, 0, cx + hw, 0);
          g.addColorStop(0, '#5a4224'); g.addColorStop(0.55, '#b8965e'); g.addColorStop(0.8, '#f0d49a'); g.addColorStop(1, '#6e5230');
          x.fillStyle = g;
          x.fillRect(cx - hw, y, hw * 2, 5);
          x.fillStyle = 'rgba(0,0,0,0.3)'; x.fillRect(cx - hw, y === top ? y + 4 : y, hw * 2, 1);
        }
        for (const px of [cx - 136, cx + 136]) {
          const g = x.createLinearGradient(px - 5, 0, px + 5, 0);
          const lit = px > cx;
          g.addColorStop(0, '#21150d'); g.addColorStop(lit ? 0.62 : 0.45, lit ? '#a37a54' : '#6e5038'); g.addColorStop(1, '#2a1c12');
          x.fillStyle = g;
          x.fillRect(px - 4.5, top, 9, bot - top);
          for (const yy of [top + 28, neck, bot - 28]) {
            x.fillStyle = g;
            roundRect(x, px - 7, yy - 6, 14, 12, 6); x.fill();
            x.fillStyle = 'rgba(255,226,190,0.22)'; x.fillRect(px - 5, yy - 6, 10, 1);
          }
        }
      });
    }

    draw() {
      const { ctx, w, h, up, lo, cx, neck, rows, cols } = this;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.room, 0, 0, w, h);
      ctx.save();
      const s = 1 - 0.32 * this.lift;
      ctx.translate(cx, neck - 40 * this.lift);
      ctx.rotate(this.angle + this.tilt);
      ctx.scale(s, s);
      ctx.translate(-cx, -neck);
      ctx.drawImage(this.back, 0, 0, w, h);
      const gt = this.t;
      up.paint(this.lut, this.oldLut, this.fade, gt);
      up.put();
      lo.paint(this.lut, this.oldLut, this.fade, gt);
      this.stamp();
      lo.put();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(up.off, this.x0, neck - rows, cols, rows);
      ctx.drawImage(lo.off, this.x0, this.bot - rows, cols, rows);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.front, 0, 0, w, h);
      ctx.drawImage(this.frame, 0, 0, w, h);
      ctx.restore();
    }
  }

  const scenes = [];
  /* ?warm=20 : 처음 그리기 전에 20초만큼 미리 움직여 둬요 (스크린샷 확인용) */
  const warm = Number(new URLSearchParams(location.search).get('warm')) || 0;
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__hg.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-hg]').forEach((c) => {
      const sc = new Hourglass(c);
      c.__hg = sc;
      scenes.push(sc);
      for (let t = 0; t < warm + 1.5; t += 1 / 30) sc.step(1 / 30);
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
      const b = e.target.closest('[data-hg-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-hg]');
      if (c && c.__hg) c.__hg.action(b.dataset.hgAct, b.dataset.value);
    });
    /* 데스크톱 화면만: 스페이스 키로 뒤집기. 보드에는 화면이 여럿이라 마우스를 마지막으로 올린 데스크톱 화면이 받아요 */
    let keyTarget = null;
    document.querySelectorAll('.screen.desk').forEach((screen) => {
      screen.addEventListener('pointerenter', () => { keyTarget = screen; });
    });
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || !keyTarget) return;
      if (e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
      const c = keyTarget.querySelector('canvas[data-hg]');
      if (!c || !c.__hg) return;
      e.preventDefault(); /* 스페이스로 보드가 스크롤되지 않게 */
      c.__hg.action('flip');
    });
    let last = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (!last) { last = now; return; }
      const elapsed = (now - last) / 1000;
      if (elapsed < 1 / 61) return;
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
