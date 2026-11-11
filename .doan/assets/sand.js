/* mong — 모래멍 시안용 장면 (Doan 보드 전용). 코드(src/scenes)에는 아직 없어요.
   위에서 색모래 줄기가 떨어져 쌓여요. 줄기는 천천히 좌우로 흔들리고(끌면 손을 따라오고),
   색은 시간에 따라 색 묶음 안에서 돌아요. 그래서 줄기가 지나간 길과 속도가 그대로 줄무늬로 남아요.
   쌓인 모래는 칸마다 높이만 기억해요(구멍이 없으니까). 알갱이는 내려앉을 때 낮은 쪽으로 굴러서 비탈이 생겨요.
   <canvas data-sand> 하나가 장면 하나. 같은 .screen 안의 [data-sand-act] 버튼이 장면을 조작해요.
     data-palette="sunset|ocean|forest|candy"  색 묶음 (기본 sunset)
     data-speed="0.6"          떨어지는 양 0.3 솔솔 · 0.6 보통 · 1 콸콸
     data-cell="2"             알갱이 한 칸 크기(px)
     data-floor="132"          바닥 받침 높이(px). 조작 버튼이 놓이는 자리
     data-top="110"            위쪽에 비워 둘 높이(px). 여기까지 차면 가득 찬 걸로 봐요
     data-prefill="0.3"        처음부터 이만큼 쌓인 채로 시작 (0~1)
     data-auto-drag="9"        n초마다 손가락이 줄기를 끌어요 (설명용, [data-sand-finger] 를 움직여요)
     data-demo-empty           비우는 모습을 되풀이해서 보여줘요 (설명용) */
(() => {
  'use strict';

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (x) => x * x * (3 - 2 * x);

  const PALETTES = {
    sunset: { label: '노을', stops: [[255, 210, 122], [255, 154, 90], [240, 86, 122], [160, 75, 184], [61, 58, 140]] },
    ocean: { label: '바다', stops: [[242, 236, 216], [143, 224, 208], [53, 182, 201], [42, 111, 184], [28, 58, 122]] },
    forest: { label: '숲', stops: [[240, 230, 176], [183, 214, 106], [90, 168, 96], [47, 122, 106], [138, 90, 58]] },
    candy: { label: '사탕', stops: [[255, 126, 182], [255, 209, 102], [123, 224, 168], [108, 196, 255], [176, 140, 255]] },
  };
  const SPEEDS = [{ v: 0.3, label: '솔솔', fill: 420, spread: 2.5 }, { v: 0.6, label: '보통', fill: 200, spread: 5 }, { v: 1, label: '콸콸', fill: 90, spread: 9 }];
  const speedOf = (v) => SPEEDS.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));

  const GRAVITY = 1500;
  const COLOR_SECONDS = 7; /* 한 색이 이어지는 시간 */
  const MAX_FLY = 8000;

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  class Sand {
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

      this.cell = Number(d.cell) || 2;
      this.floor = d.floor !== undefined ? Number(d.floor) : 0;
      this.cols = Math.ceil(this.w / this.cell);
      this.rows = Math.ceil((this.h - this.floor) / this.cell);
      this.limit = this.rows - Math.round((d.top !== undefined ? Number(d.top) : 20) / this.cell);
      this.grid = new Uint32Array(this.cols * this.rows);
      this.hts = new Int32Array(this.cols);
      this.count = 0;
      this.off = mk(this.cols, this.rows);
      this.offCtx = this.off.getContext('2d');
      this.img = this.offCtx.createImageData(this.cols, this.rows);
      this.view = new Uint32Array(this.img.data.buffer);

      this.fx = new Float32Array(MAX_FLY); this.fy = new Float32Array(MAX_FLY);
      this.fvx = new Float32Array(MAX_FLY); this.fvy = new Float32Array(MAX_FLY);
      this.fc = new Uint32Array(MAX_FLY);
      this.fn = 0;

      this.palette = PALETTES[d.palette] ? d.palette : 'sunset';
      this.speed = speedOf(Number(d.speed) || 0.6);
      this.t = rand(0, 100);
      this.phase = rand(0, 5);
      this.seed();
      this.nx = this.autoX(this.t);
      this.nv = 0;
      this.hold = 0; /* 손을 뗀 뒤 저절로 흔들리기까지 남은 시간 */
      this.dragging = false;
      this.tx = this.nx;
      this.acc = 0;
      this.state = 'pour';
      this.wait = 0;
      this.autoDrag = Number(d.autoDrag) || 0;
      this.dragT = this.autoDrag ? this.autoDrag - 1.5 : 0;
      this.finger = this.screen && this.screen.querySelector('[data-sand-finger]');
      this.demoEmpty = d.demoEmpty !== undefined;
      this.prefillTo = Number(d.prefill) || 0;
      this.statFill = -1;

      this.paintBackdrop();
      if (this.prefillTo) this.prefill(this.prefillTo);
      if (this.demoEmpty) { this.state = 'full'; this.wait = 2.5; }
      this.syncUi();
    }

    seed() { this.p1 = rand(0, 6.28); this.p2 = rand(0, 6.28); this.p3 = rand(0, 6.28); }

    /* 손대지 않을 때 줄기가 가는 곳: 아주 느린 이동에 흔들림 둘을 겹쳐서 같은 길을 되풀이하지 않아요 */
    autoX(t) {
      return this.w * clamp(0.5 + 0.3 * Math.sin(t * 0.053 + this.p3) + 0.14 * Math.sin(t * 0.31 + this.p1) + 0.05 * Math.sin(t * 1.13 + this.p2), 0.03, 0.97);
    }

    get rate() { return (this.cols * this.limit) / this.speed.fill; }

    color(phase) {
      const st = PALETTES[this.palette].stops;
      const n = st.length;
      const i = Math.floor(phase) % n;
      const f = ease(clamp((phase - Math.floor(phase) - 0.3) / 0.4, 0, 1));
      const a = st[i], b = st[(i + 1) % n];
      const k = Math.random() < 0.03 ? 1.22 : rand(0.84, 1.06); /* 알갱이마다 밝기가 조금씩 달라요 */
      const r = clamp((a[0] + (b[0] - a[0]) * f) * k, 0, 255) | 0;
      const g = clamp((a[1] + (b[1] - a[1]) * f) * k, 0, 255) | 0;
      const bl = clamp((a[2] + (b[2] - a[2]) * f) * k, 0, 255) | 0;
      return (0xff000000 | (bl << 16) | (g << 8) | r) >>> 0;
    }

    /* 알갱이 하나가 c 칸에 내려앉아요. 옆이 낮으면 그쪽으로 굴러요. */
    land(c, col, dir) {
      const h = this.hts, last = this.cols - 1;
      c = clamp(c, 0, last);
      for (let i = 0; i < 600; i++) {
        const hc = h[c];
        const l = c > 0 ? h[c - 1] : 1e9, r = c < last ? h[c + 1] : 1e9;
        const l2 = c > 1 ? h[c - 2] : 1e9, r2 = c < last - 1 ? h[c + 2] : 1e9;
        const canL = l < hc || (l <= hc && l2 < hc && Math.random() < 0.6);
        const canR = r < hc || (r <= hc && r2 < hc && Math.random() < 0.6);
        if (!canL && !canR) break;
        if (canL && canR) { if (!dir) dir = Math.random() < 0.5 ? -1 : 1; } else dir = canL ? -1 : 1;
        c += dir;
      }
      if (h[c] >= this.rows) return;
      this.grid[(this.rows - 1 - h[c]) * this.cols + c] = col;
      h[c]++;
      this.count++;
    }

    prefill(frac) {
      const n = Math.floor(this.cols * this.limit * frac);
      const dt = 1 / this.rate;
      for (let i = 0; i < n && this.peak() < this.limit; i++) {
        this.t += dt;
        this.phase += dt / COLOR_SECONDS;
        const x = this.autoX(this.t) + (Math.random() + Math.random() + Math.random() - 1.5) * this.speed.spread * 2;
        this.land(Math.floor(x / this.cell), this.color(this.phase), 0);
      }
      this.nx = this.tx = this.autoX(this.t);
    }

    peak() {
      let m = 0;
      for (let i = 0; i < this.cols; i++) if (this.hts[i] > m) m = this.hts[i];
      return m;
    }

    action(name, value) {
      if (name === 'speed') this.speed = speedOf(Number(value));
      else if (name === 'palette' && PALETTES[value]) this.palette = value;
      else if (name === 'empty' && this.state !== 'empty') this.startEmpty();
      this.syncUi();
    }

    startEmpty() {
      this.state = 'empty';
      this.emptyRate = Math.max(this.count, 2000) / 7; /* 7초쯤 걸려서 다 빠져요 */
      this.emptyAcc = 0;
    }

    syncUi() {
      const sc = this.screen;
      if (!sc) return;
      sc.querySelectorAll('[data-sand-act="speed"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === this.speed.v));
      sc.querySelectorAll('[data-sand-act="palette"]').forEach((b) => b.classList.toggle('on', b.dataset.value === this.palette));
      sc.querySelectorAll('[data-stat="speed"]').forEach((e) => { e.textContent = this.speed.label; });
      sc.querySelectorAll('[data-stat="palette"]').forEach((e) => { e.textContent = PALETTES[this.palette].label; });
      sc.querySelectorAll('[data-sand-swatch]').forEach((e) => { e.className = `swatch pal-${this.palette}`; });
    }

    pointer(kind, x) {
      if (kind === 'down') { this.dragging = true; this.tx = x; }
      else if (kind === 'move' && this.dragging) this.tx = x;
      else if (kind === 'up') { this.dragging = false; this.hold = 4; }
    }

    step(dt) {
      this.t += dt;
      this.phase += dt / COLOR_SECONDS;
      const w = this.w, cell = this.cell;

      /* 줄기가 갈 곳 */
      let fingerOn = false;
      if (this.autoDrag && !this.dragging) {
        this.dragT += dt;
        const k = this.dragT - this.autoDrag;
        if (k > 0) {
          const D = 4.2;
          if (k < D) {
            fingerOn = true;
            const p = k / D;
            this.tx = w * (0.5 + 0.34 * Math.sin(p * Math.PI * 4) * Math.sin(p * Math.PI));
            this.fingerY = this.h * (0.3 + 0.06 * Math.sin(p * Math.PI * 2));
            this.hold = 2;
          } else this.dragT = 0;
        }
      }
      if (this.finger) {
        this.finger.style.opacity = fingerOn ? 1 : 0;
        if (fingerOn) this.finger.style.transform = `translate(${this.tx}px, ${this.fingerY}px)`;
      }
      if (!this.dragging && !fingerOn) {
        if (this.hold > 0) this.hold -= dt;
        else this.tx += (this.autoX(this.t) - this.tx) * Math.min(1, dt * 1.5);
      }
      const prev = this.nx;
      this.nx += (clamp(this.tx, 4, w - 4) - this.nx) * Math.min(1, dt * 9);
      this.nv = (this.nx - prev) / dt;

      /* 붓기 */
      if (this.state === 'pour') {
        this.acc += this.rate * dt;
        const sp = this.speed.spread;
        while (this.acc >= 1 && this.fn < MAX_FLY) {
          this.acc -= 1;
          const i = this.fn++;
          const sub = Math.random();
          this.fvy[i] = rand(160, 260);
          this.fvx[i] = this.nv * 0.4 + rand(-8, 8);
          this.fx[i] = prev + (this.nx - prev) * sub + (Math.random() + Math.random() + Math.random() - 1.5) * sp;
          this.fy[i] = -sub * this.fvy[i] * dt - 2;
          this.fc[i] = this.color(this.phase);
        }
        if (this.acc > 1) this.acc = 1;
        if (this.peak() >= this.limit) { this.state = 'full'; this.wait = 2; }
      } else if (this.state === 'full') {
        this.wait -= dt;
        if (this.wait <= 0) this.startEmpty();
      } else if (this.state === 'empty') {
        this.drain(dt);
        if (this.count <= 0) {
          this.count = 0;
          this.seed();
          if (this.demoEmpty) { this.prefill(this.prefillTo || 0.8); this.state = 'full'; this.wait = 3; }
          else this.state = 'pour';
        }
      }

      /* 떨어지는 알갱이 */
      const floorY = this.rows * cell, last = this.cols - 1;
      for (let i = 0; i < this.fn; i++) {
        this.fvy[i] += GRAVITY * dt;
        this.fy[i] += this.fvy[i] * dt;
        let x = this.fx[i] + this.fvx[i] * dt;
        if (x < 0) { x = 0; this.fvx[i] = 0; } else if (x > w - 1) { x = w - 1; this.fvx[i] = 0; }
        this.fx[i] = x;
        const c = clamp(Math.floor(x / cell), 0, last);
        if (this.fy[i] >= floorY - this.hts[c] * cell) {
          if (this.state !== 'empty') this.land(c, this.fc[i], this.fvx[i] > 12 ? 1 : this.fvx[i] < -12 ? -1 : 0);
          const j = --this.fn;
          this.fx[i] = this.fx[j]; this.fy[i] = this.fy[j]; this.fvx[i] = this.fvx[j]; this.fvy[i] = this.fvy[j]; this.fc[i] = this.fc[j];
          i--;
        }
      }

      const pct = Math.min(100, Math.round((this.count / (this.cols * this.limit)) * 100));
      if (pct !== this.statFill && this.screen) {
        this.statFill = pct;
        this.screen.querySelectorAll('[data-stat="fill"]').forEach((e) => { e.textContent = `${pct}%`; });
      }
    }

    /* 바닥 가운데 틈으로 모래가 빠져요. 틈 위 칸은 통째로 내려가고, 옆 칸 위쪽 알갱이가 흘러들어요. */
    drain(dt) {
      const cols = this.cols, rows = this.rows, g = this.grid, h = this.hts;
      const hw = Math.max(3, Math.round(cols * 0.025));
      const mid = cols >> 1, a = mid - hw, b = mid + hw;
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
      const move = (from, to) => {
        const col = g[(rows - h[from]) * cols + from];
        g[(rows - h[from]) * cols + from] = 0;
        h[from]--;
        g[(rows - 1 - h[to]) * cols + to] = col;
        h[to]++;
      };
      /* 틈에 모래가 있는 동안은 비탈을 지키며 흘러들고, 틈이 비면 남은 모래도 마저 밀려 들어와요 */
      let fed = false;
      for (let c = a; c <= b; c++) if (h[c] > 0) fed = true;
      const lim = fed ? 1 : 0;
      for (let pass = 0; pass < 5; pass++) {
        for (let c = mid; c > 0; c--) while (h[c - 1] - h[c] > lim) move(c - 1, c);
        for (let c = mid; c < cols - 1; c++) while (h[c + 1] - h[c] > lim) move(c + 1, c);
      }
    }

    paintBackdrop() {
      const { w, h } = this;
      const bg = mk(w, h);
      const x = bg.getContext('2d');
      const fy = h - this.floor;
      let gr = x.createLinearGradient(0, 0, 0, fy || h);
      gr.addColorStop(0, '#1b1826'); gr.addColorStop(1, '#0c0b12');
      x.fillStyle = gr; x.fillRect(0, 0, w, h);
      gr = x.createRadialGradient(w / 2, -h * 0.1, 0, w / 2, -h * 0.1, h * 0.8);
      gr.addColorStop(0, 'rgba(180,151,242,0.16)'); gr.addColorStop(1, 'rgba(180,151,242,0)');
      x.fillStyle = gr; x.fillRect(0, 0, w, h);
      if (this.floor) {
        /* 받침: 모래가 놓이는 선반. 조작 버튼이 이 위에 놓여요 */
        gr = x.createLinearGradient(0, fy, 0, h);
        gr.addColorStop(0, '#2a2533'); gr.addColorStop(0.12, '#17151d'); gr.addColorStop(1, '#0a090d');
        x.fillStyle = gr; x.fillRect(0, fy, w, this.floor);
        x.fillStyle = 'rgba(255,255,255,0.14)'; x.fillRect(0, fy, w, 1);
        const hw = Math.max(3, Math.round(this.cols * 0.025)) * this.cell + 3;
        x.fillStyle = '#050407'; x.fillRect(w / 2 - hw, fy, hw * 2, 3); /* 모래가 빠지는 틈 */
      }
      this.bg = bg;
      /* 유리 액자 느낌: 비스듬한 빛 한 줄 */
      const gl = mk(w, h);
      const y = gl.getContext('2d');
      gr = y.createLinearGradient(0, 0, w, w * 0.9);
      gr.addColorStop(0.1, 'rgba(255,255,255,0)'); gr.addColorStop(0.26, 'rgba(255,255,255,0.05)');
      gr.addColorStop(0.34, 'rgba(255,255,255,0.012)'); gr.addColorStop(0.5, 'rgba(255,255,255,0)');
      y.fillStyle = gr; y.fillRect(0, 0, w, fy || h);
      this.sheen = gl;
    }

    draw() {
      const { ctx, w, h, cols, rows, cell, view } = this;
      view.set(this.grid);
      const dt = 1 / 30;
      for (let i = 0; i < this.fn; i++) {
        const c = Math.floor(this.fx[i] / cell);
        if (c < 0 || c >= cols) continue;
        const r1 = Math.floor(this.fy[i] / cell);
        const len = clamp(Math.round((this.fvy[i] * dt * 0.5) / cell), 1, 7);
        const stop = rows - this.hts[c];
        for (let r = Math.max(0, r1 - len + 1); r <= r1 && r < stop; r++) view[r * cols + c] = this.fc[i];
      }
      this.offCtx.putImageData(this.img, 0, 0);
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.drawImage(this.bg, 0, 0, w, h);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(this.off, 0, 0, cols * cell, rows * cell);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.sheen, 0, 0, w, h);
    }
  }

  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__sand.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-sand]').forEach((c) => {
      const sc = new Sand(c);
      c.__sand = sc;
      scenes.push(sc);
      sc.draw();
      if (io) io.observe(c);
      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return (e.clientX - r.left) * (sc.w / r.width);
      };
      c.addEventListener('pointerdown', (e) => {
        if (c.setPointerCapture) { try { c.setPointerCapture(e.pointerId); } catch (_) { /* 캡처가 안 되는 환경은 그대로 둬요 */ } }
        sc.pointer('down', pos(e));
      });
      c.addEventListener('pointermove', (e) => sc.pointer('move', pos(e)));
      c.addEventListener('pointerup', () => sc.pointer('up'));
      c.addEventListener('pointercancel', () => sc.pointer('up'));
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sand-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-sand]');
      if (c && c.__sand) c.__sand.action(b.dataset.sandAct, b.dataset.value);
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
