/* mong — 눈멍 시안용 장면 (Doan 보드 전용). 코드(src/scenes)에는 아직 없어요.
   삿포로의 겨울밤을 세 가지 자리에서 그려요. <canvas data-snow> 하나가 장면 하나.
     data-view="foot"    A안 · 발밑: 가로등 아래 새 눈을 내려다봐요. 누른 자리에 발자국이 찍혀요
     data-view="walk"    (보드에서 뺐어요) 이전 B안 · 걷는 길. 다시 볼 때를 위해 코드만 남겨 뒀어요
     data-view="street"  C안 · 시계탑 앞: 옆에서 본 거리. 누르면 발자국, 끌면 눈을 쓸어요
     data-fall="0.6"     눈 세기 0.3 가루눈 · 0.6 눈 · 1 함박눈
     data-trail="7"      처음부터 발자국이 이만큼 찍힌 채로 시작
     data-auto="1"       손가락이 저절로 밟거나 쓸어요 (설명용, [data-snow-finger] 를 움직여요)
     data-cover="14"     발자국이 새 눈에 덮이는 시간(초)을 정해요 (설명용. 없으면 눈 세기를 따라요)
   같은 .screen 안의 [data-snow-act] 버튼이 장면을 조작해요.
   밟는 소리는 시안에서만 쓰는 합성음이에요. 실제로는 녹음을 써요. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (x) => x * x * (3 - 2 * x);
  const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

  /* B안 부츠 크기 (k=1 기준). L 발끝에서 바짓단까지, hw 발볼 반폭, cw 바짓단 반폭 */
  const BOOT = { L: 84, hw: 25, cw: 30 };

  /* B안 걸음. S 한 걸음 길이 m, swing 발이 떠 있는 시간, period 한 걸음 시간(초), lift 발이 들리는 높이 m */
  const GAIT = { S: 0.66, swing: 0.5, period: 0.63, lift: 0.1 };
  /* B안 공간감 시안 (data-depth). 발도 길과 같은 카메라로 그려서 디딘 발이 눈 위에서 미끄러지지 않아요.
     pitch 내려다보는 각도(rad), horizon 지평선 높이(화면 높이 비율), zOff 눈에서 발까지 앞쪽 거리 m,
     boost 발·다리를 실제보다 크게 그리는 배율 (실제 크기면 폰 화면에서 너무 작아요) */
  const DEPTHS = {
    base: { pitch: 0, horizon: 0.4, zOff: 1.16, boost: 2.26 },
    pave: { pitch: 0, horizon: 0.4, zOff: 1.16, boost: 2.26 },
    light: { pitch: 0, horizon: 0.4, zOff: 1.16, boost: 2.26 },
    deep: { pitch: 0, horizon: 0.4, zOff: 1.16, boost: 2.26 },
    down: { pitch: 0.56, horizon: 0.2, zOff: 0.22, boost: 1.75 },
  };
  const P2 = (sc, X, Z) => sc.proj(X, 0, Z);
  const FOOT_HALF = 0.11; /* 두 발 사이 반 m */
  const FOOT_LEN = 0.185; /* 바짓단에서 발끝까지 m */
  const hash2 = (a, b) => { let v = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };

  const FALLS = [
    { v: 0.3, label: '가루눈', n: 60, cover: 150 },
    { v: 0.6, label: '눈', n: 130, cover: 80 },
    { v: 1, label: '함박눈', n: 240, cover: 40 },
  ];
  const fallOf = (v) => FALLS.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }
  function rr(x, px, py, w, h, r) {
    x.moveTo(px + r, py);
    x.arcTo(px + w, py, px + w, py + h, r);
    x.arcTo(px + w, py + h, px, py + h, r);
    x.arcTo(px, py + h, px, py, r);
    x.arcTo(px, py, px + w, py, r);
    x.closePath();
  }

  /* ---------- 소리 (시안용 합성) ---------- */
  let ac = null;
  function audio() {
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      ac = new C();
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function out(a, node, pan) {
    if (a.createStereoPanner) {
      const p = a.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      node.connect(p);
      p.connect(a.destination);
    } else node.connect(a.destination);
  }
  /* 뽀드득: 눈 알갱이가 눌리며 걸렸다 미끄러지기를 되풀이해요. 짧은 터짐이 조금씩 빨라졌다 느려지며 이어져요 */
  function crunch(pan) {
    const a = audio();
    if (!a) return;
    const sr = a.sampleRate;
    const n = Math.floor(sr * rand(0.3, 0.4));
    const buf = a.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    const f0 = rand(46, 60), f1 = rand(96, 126);
    const decay = Math.exp(-1 / (sr * 0.0034));
    let next = 0, g = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      if (i >= next) {
        g = rand(0.55, 1);
        const f = f0 + (f1 - f0) * Math.sin(Math.PI * Math.min(1, t * 1.15));
        next = i + (sr / f) * rand(0.72, 1.28);
      }
      g *= decay;
      const hump = Math.sin(Math.PI * t * 2 - 0.5);
      const env = Math.min(1, t / 0.04) * Math.pow(1 - t, 1.3) * (0.65 + 0.35 * hump * hump);
      d[i] = (Math.random() * 2 - 1) * (g * 0.9 + 0.07) * env;
    }
    const src = a.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rand(0.92, 1.08);
    const hp = a.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420;
    const pk = a.createBiquadFilter(); pk.type = 'peaking'; pk.frequency.value = rand(1500, 2100); pk.Q.value = 1.1; pk.gain.value = 9;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6200;
    const gain = a.createGain(); gain.gain.value = 0.7;
    src.connect(hp); hp.connect(pk); pk.connect(lp); lp.connect(gain);
    out(a, gain, pan);
    src.start();
    /* 발이 닿는 낮은 '툭' */
    const o = a.createOscillator();
    const og = a.createGain();
    const t0 = a.currentTime;
    o.frequency.setValueAtTime(96, t0);
    o.frequency.exponentialRampToValueAtTime(48, t0 + 0.08);
    og.gain.setValueAtTime(0.22, t0);
    og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.1);
    o.connect(og);
    out(a, og, pan);
    o.start(t0);
    o.stop(t0 + 0.12);
  }
  /* 사락: 눈을 쓸 때 */
  function swish(pan) {
    const a = audio();
    if (!a) return;
    const sr = a.sampleRate;
    const n = Math.floor(sr * 0.26);
    const buf = a.createBuffer(1, n, sr);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * t) * Math.sin(Math.PI * t);
    }
    const src = a.createBufferSource(); src.buffer = buf;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = rand(2600, 3600); bp.Q.value = 0.7;
    const gain = a.createGain(); gain.gain.value = 0.2;
    src.connect(bp); bp.connect(gain);
    out(a, gain, pan);
    src.start();
  }

  /* ---------- 함께 쓰는 그림 ---------- */
  function vignette(w, h, dpr, strength) {
    const c = mk(w * dpr, h * dpr), x = c.getContext('2d');
    x.scale(dpr, dpr);
    const g = x.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.78);
    g.addColorStop(0, 'rgba(6,10,26,0)');
    g.addColorStop(1, `rgba(6,10,26,${strength})`);
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
    return c;
  }
  /* 잎 진 나무. lights 를 켜면 가지에 일루미네이션 전구가 달려요 */
  function treeSprite(seed, lights) {
    const W = 280, H = 340, S = 2;
    const c = mk(W * S, H * S), x = c.getContext('2d');
    x.scale(S, S);
    x.lineCap = 'round';
    const r = rng(seed);
    const pts = [];
    const branch = (px, py, ang, len, wd, depth) => {
      const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
      x.strokeStyle = '#17151d';
      x.lineWidth = wd;
      x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
      if (Math.abs(Math.cos(ang)) > 0.35 && wd > 0.9) {
        x.strokeStyle = 'rgba(232,240,252,0.9)';
        x.lineWidth = Math.max(0.9, wd * 0.45);
        x.beginPath(); x.moveTo(px, py - wd * 0.42); x.lineTo(ex, ey - wd * 0.42); x.stroke();
      }
      const n = Math.ceil(len / 13);
      for (let i = 1; i <= n; i++) pts.push([px + ((ex - px) * i) / n, py + ((ey - py) * i) / n, depth]);
      if (depth <= 0) return;
      const k = depth > 3 ? 2 : r() < 0.55 ? 2 : 3;
      for (let i = 0; i < k; i++) {
        const spread = (i - (k - 1) / 2) * (0.5 + r() * 0.35) + (r() - 0.5) * 0.3;
        branch(ex, ey, ang + spread, len * (0.64 + r() * 0.14), wd * 0.62, depth - 1);
      }
    };
    branch(W / 2, H, -Math.PI / 2 + (r() - 0.5) * 0.08, H * 0.3, 9, 5);
    if (lights) {
      x.shadowColor = 'rgba(255,196,112,0.95)';
      x.shadowBlur = 7;
      x.fillStyle = '#fff1cc';
      for (const p of pts) {
        if (p[2] > 3 || r() > 0.5) continue;
        x.beginPath(); x.arc(p[0], p[1], 1.25, 0, TAU); x.fill();
      }
      x.shadowBlur = 0;
    }
    return c;
  }
  function towerBlock(x, r, x0, x1, baseY, minH, maxH) {
    let px = x0;
    while (px < x1) {
      const bw = 22 + r() * 34, bh = minH + r() * (maxH - minH);
      const tone = 18 + Math.floor(r() * 14);
      x.fillStyle = `rgb(${tone},${tone + 6},${tone + 26})`;
      x.fillRect(px, baseY - bh, bw, bh + 2);
      x.fillStyle = 'rgba(232,240,252,0.5)';
      x.fillRect(px, baseY - bh - 1.5, bw, 2);
      for (let wy = baseY - bh + 6; wy < baseY - 6; wy += 7) {
        for (let wx = px + 4; wx < px + bw - 4; wx += 6) {
          if (r() < 0.36) {
            x.fillStyle = r() < 0.75 ? 'rgba(255,205,130,0.75)' : 'rgba(200,225,255,0.6)';
            x.fillRect(wx, wy, 2.6, 3.4);
          }
        }
      }
      px += bw + 1 + r() * 3;
    }
  }
  function solePath(x) {
    x.beginPath();
    rr(x, -11, -27, 22, 33, 11);
    rr(x, -9, 9, 18, 17, 8);
  }
  /* 발자국. p.sq 는 비스듬히 본 바닥에서 위아래로 눌린 정도 */
  function drawPrint(x, p) {
    const a = 1 - Math.pow(clamp(p.age, 0, 1), 1.6);
    if (a <= 0) return;
    const k = ease(clamp(p.life / 0.16, 0, 1));
    const s = p.sc;
    const place = (dy) => {
      x.save();
      x.translate(p.x, p.y + dy);
      x.scale(1, p.sq);
      x.rotate(p.ang + Math.PI / 2);
      x.scale(s, s);
    };
    place(2.8 * s);
    solePath(x);
    x.fillStyle = `rgba(255,255,255,${0.72 * a * k})`;
    x.fill();
    x.restore();
    place(0);
    solePath(x);
    x.fillStyle = `rgba(52,70,116,${0.62 * a * k})`;
    x.fill();
    x.clip();
    x.strokeStyle = `rgba(226,236,252,${0.17 * a * k})`;
    x.lineWidth = 1.7;
    x.beginPath();
    for (let y = -23; y <= 24; y += 5) { x.moveTo(-12, y); x.lineTo(12, y - 2); }
    x.stroke();
    x.fillStyle = `rgba(16,24,60,${0.3 * a * k})`;
    x.fillRect(-12, -29, 24, 7);
    x.fillRect(-12, 8, 24, 5);
    x.restore();
    for (const c of p.cr) {
      x.fillStyle = `rgba(60,78,122,${0.3 * a * k})`;
      x.beginPath(); x.arc(p.x + c[0], p.y + c[1] * p.sq + 1.4, c[2], 0, TAU); x.fill();
      x.fillStyle = `rgba(255,255,255,${0.9 * a * k})`;
      x.beginPath(); x.arc(p.x + c[0], p.y + c[1] * p.sq, c[2], 0, TAU); x.fill();
    }
  }

  class Snow {
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
      this.view = d.view || 'foot';
      this.fall = fallOf(Number(d.fall) || 0.6);
      this.coverFixed = d.cover !== undefined ? Number(d.cover) : 0;
      this.auto = d.auto !== undefined;
      this.finger = this.screen ? this.screen.querySelector('[data-snow-finger]') : null;
      this.t = 0;
      this.steps = 0;
      this.side = 1;
      this.prints = [];
      this.puffs = [];
      this.last = null;
      this.down = false;
      this.flush = false;
      this.vig = vignette(this.w, this.h, this.dpr, this.view === 'foot' ? 0.82 : 0.6);
      this[`${this.view}Init`]();
      this.flakes = [];
      this.fillFlakes();
      const trail = Number(d.trail) || 0;
      if (trail) this.seedTrail(trail);
      this.sync();
    }

    get cover() { return this.coverFixed || this.fall.cover; }

    fillFlakes() {
      const want = Math.round(this.fall.n * (this.w * this.h) / (390 * 844));
      while (this.flakes.length < want) this.flakes.push(this.newFlake(true));
      this.flakes.length = want;
    }
    newFlake(anywhere) {
      const { w, h } = this;
      if (this.view === 'foot') return { x: rand(-20, w + 20), y: rand(-20, h + 20), t: anywhere ? Math.random() : 0, dur: rand(1.6, 3.2) };
      const z = Math.pow(Math.random(), 1.6) * 0.85 + 0.15;
      return { x: rand(-20, w + 20), y: anywhere ? rand(-10, h) : -10, z, ph: rand(0, TAU) };
    }

    sync() {
      const sc = this.screen;
      if (!sc) return;
      sc.querySelectorAll('[data-snow-act="fall"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === this.fall.v));
      sc.querySelectorAll('[data-stat="fall"]').forEach((e) => { e.textContent = this.fall.label; });
      sc.querySelectorAll('[data-stat="steps"]').forEach((e) => { e.textContent = `${this.steps}걸음`; });
    }
    action(name, value) {
      if (name === 'fall') { this.fall = fallOf(Number(value)); this.fillFlakes(); }
      if (name === 'fresh') this.flush = true;
      this.sync();
    }
    moveFinger(x, y, on) {
      if (!this.finger) return;
      this.finger.style.opacity = on ? '1' : '0';
      if (on) this.finger.style.transform = `translate(${x}px, ${y}px)`;
    }
    puff(x, y, n, spread, up) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), v = rand(20, 70) * spread;
        this.puffs.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * (up ? 0.5 : 1) - (up ? rand(20, 60) : 0), t: 0, dur: rand(0.35, 0.7), r: rand(1.2, 3) });
      }
    }
    addPrint(x, y, sc, sq, sound) {
      let ang = this.last ? this.last.ang : -Math.PI / 2;
      if (this.last) {
        const dx = x - this.last.x, dy = (y - this.last.y) / sq;
        const dist = Math.hypot(dx, dy);
        if (dist > 8 && dist < 230 * sc && this.t - this.last.t < 3) ang = Math.atan2(dy, dx);
      }
      this.side = -this.side;
      const off = 12 * sc * this.side;
      const px = x + Math.cos(ang + Math.PI / 2) * off, py = y + Math.sin(ang + Math.PI / 2) * off * sq;
      const cr = [];
      for (let i = 0; i < 9; i++) {
        const a = rand(0, TAU), rad = rand(26, 40) * sc;
        cr.push([Math.cos(a) * rad * 0.7, Math.sin(a) * rad, rand(0.8, 2.1) * sc]);
      }
      this.prints.push({ x: px, y: py, ang, side: this.side, life: 0, age: 0, sc, sq, cr });
      if (this.prints.length > 70) this.prints.shift();
      this.last = { x, y, ang, t: this.t };
      this.steps++;
      this.puff(px, py, 9, sc, false);
      if (sound) crunch((x / this.w - 0.5) * 1.3);
      this.sync();
    }
    seedTrail(n) {
      const wk = this.walker();
      for (let i = 0; i < n; i++) {
        this.walk(wk);
        const p = this.prints[this.prints.length - 1];
        if (p) { p.life = 1; p.age = clamp(0.78 - (i / n) * 0.8, 0, 1); }
      }
      this.puffs.length = 0;
      this.wk = wk;
    }
    walker() {
      const b = this.bounds();
      return { x: rand(b.x0 + 30, b.x1 - 30), y: (b.y0 + b.y1) / 2 + rand(-20, 60), ang: rand(-2.2, -0.9), b };
    }
    walk(wk) {
      const b = wk.b;
      wk.ang += rand(-0.42, 0.42);
      const tx = (b.x0 + b.x1) / 2, ty = (b.y0 + b.y1) / 2;
      if (wk.x < b.x0 || wk.x > b.x1 || wk.y < b.y0 || wk.y > b.y1) {
        const want = Math.atan2(ty - wk.y, tx - wk.x);
        let df = want - wk.ang;
        while (df > Math.PI) df -= TAU;
        while (df < -Math.PI) df += TAU;
        wk.ang += df * 0.9;
      }
      const sc = this.scaleAt(wk.y), sq = this.view === 'street' ? 0.5 : 1;
      wk.x += Math.cos(wk.ang) * 64 * sc;
      wk.y += Math.sin(wk.ang) * 64 * sc * sq;
      this.addPrint(wk.x, wk.y, sc, sq, false);
    }
    bounds() {
      const { w, h } = this;
      if (this.view === 'street') return { x0: 46, x1: w - 46, y0: this.gy + 46, y1: h - 150 };
      return { x0: 64, x1: w - 64, y0: 390, y1: h - 220 };
    }
    scaleAt(y) {
      if (this.view === 'street') return 0.5 + 0.75 * clamp((y - this.gy) / (this.h - this.gy), 0, 1);
      return 1.5 * (this.w > 600 ? 1.15 : 1);
    }

    pointer(type, x, y) {
      if (type === 'down') { this.down = true; this.userT = this.t; }
      if (type === 'up') this.down = false;
      this[`${this.view}Pointer`](type, x, y);
    }

    step(dt) {
      this.t += dt;
      const cover = this.flush ? 1.1 : this.cover;
      for (const p of this.prints) { p.life += dt; p.age += dt / cover; }
      this.prints = this.prints.filter((p) => p.age < 1);
      if (this.flush && !this.prints.length && !(this.sweeps && this.sweeps.length)) this.flush = false;
      for (const p of this.puffs) { p.t += dt / p.dur; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy = p.vy * 0.94 + 60 * dt; }
      this.puffs = this.puffs.filter((p) => p.t < 1);
      const { w, h } = this;
      const sp = 0.6 + this.fall.v * 0.7;
      if (this.view === 'foot') {
        for (const f of this.flakes) {
          f.t += dt / f.dur;
          f.x += 9 * dt * (1.3 - f.t);
          f.y += 16 * dt * (1.3 - f.t);
          if (f.t >= 1) Object.assign(f, this.newFlake(false));
        }
      } else {
        for (const f of this.flakes) {
          f.y += (26 + f.z * 80) * sp * dt;
          f.x += (Math.sin(this.t * (0.6 + f.z) + f.ph) * 14 - 10 * f.z) * dt;
          if (f.y > h + 6) { Object.assign(f, this.newFlake(false)); }
          if (f.x < -24) f.x = w + 20;
        }
      }
      this[`${this.view}Step`](dt);
    }
    drawFlakes() {
      const x = this.ctx;
      x.fillStyle = '#fff';
      if (this.view === 'foot') {
        for (const f of this.flakes) {
          const r = 5.2 * (1 - f.t) + 0.9;
          x.globalAlpha = Math.min(1, f.t * 4) * (0.16 + 0.62 * f.t);
          x.beginPath(); x.arc(f.x, f.y, r, 0, TAU); x.fill();
        }
      } else {
        for (const f of this.flakes) {
          x.globalAlpha = 0.3 + f.z * 0.65;
          x.beginPath(); x.arc(f.x, f.y, 0.6 + f.z * 2.3, 0, TAU); x.fill();
        }
      }
      x.globalAlpha = 1;
    }
    drawPuffs() {
      const x = this.ctx;
      for (const p of this.puffs) {
        x.globalAlpha = (1 - p.t) * 0.85;
        x.fillStyle = '#fff';
        x.beginPath(); x.arc(p.x, p.y, p.r * (1 + p.t), 0, TAU); x.fill();
      }
      x.globalAlpha = 1;
    }
    draw() {
      const x = this.ctx;
      x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this[`${this.view}Draw`](x);
      x.drawImage(this.vig, 0, 0, this.w, this.h);
    }

    /* ================= A안 · 발밑 ================= */
    footInit() {
      const { w, h, dpr } = this;
      const c = mk(w * dpr, h * dpr), x = c.getContext('2d');
      x.scale(dpr, dpr);
      const r = rng(11);
      let g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#aebcd8'); g.addColorStop(1, '#9fafd0');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      /* 주황 가로등 빛 */
      const lx = w * 0.42, ly = h * 0.5;
      g = x.createRadialGradient(lx, ly, 0, lx, ly, h * 0.6);
      g.addColorStop(0, 'rgba(255,222,176,0.9)'); g.addColorStop(0.45, 'rgba(255,208,150,0.42)'); g.addColorStop(1, 'rgba(255,200,140,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      /* 눈이 고르지 않게 쌓인 결 */
      for (let i = 0; i < 26; i++) {
        const bx = r() * w, by = r() * h, br = 50 + r() * 110;
        g = x.createRadialGradient(bx, by - br * 0.2, 0, bx, by, br);
        const light = r() < 0.55;
        g.addColorStop(0, light ? 'rgba(255,255,255,0.13)' : 'rgba(64,84,132,0.1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = g; x.fillRect(bx - br, by - br, br * 2, br * 2);
      }
      for (let i = 0; i < 9000 * (w * h) / (390 * 844); i++) {
        x.fillStyle = r() < 0.6 ? 'rgba(255,255,255,0.1)' : 'rgba(58,78,128,0.07)';
        x.fillRect(r() * w, r() * h, 1 + r() * 1.4, 1 + r() * 1.4);
      }
      /* 시계탑이 새겨진 맨홀 뚜껑. 뚜껑 위는 눈이 녹아 있어요 */
      const mx = w > 600 ? w - 170 : w - 58, my = w > 600 ? 300 : 268, mr = 76; /* 넓은 화면에서는 뚜껑이 다 보이게 */
      g = x.createRadialGradient(mx, my, mr - 6, mx, my, mr + 20);
      g.addColorStop(0, 'rgba(84,100,140,0.7)'); g.addColorStop(1, 'rgba(84,100,140,0)');
      x.fillStyle = g; x.beginPath(); x.arc(mx, my, mr + 20, 0, TAU); x.fill();
      g = x.createRadialGradient(mx - 20, my - 24, 4, mx, my, mr);
      g.addColorStop(0, '#565a66'); g.addColorStop(1, '#262830');
      x.fillStyle = g; x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
      x.strokeStyle = 'rgba(255,236,206,0.2)'; x.lineWidth = 2;
      x.beginPath(); x.arc(mx, my, mr - 6, 0, TAU); x.stroke();
      x.beginPath(); x.arc(mx, my, mr - 25, 0, TAU); x.stroke();
      x.lineWidth = 1.6;
      x.beginPath();
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * TAU;
        x.moveTo(mx + Math.cos(a) * (mr - 22), my + Math.sin(a) * (mr - 22));
        x.lineTo(mx + Math.cos(a) * (mr - 9), my + Math.sin(a) * (mr - 9));
      }
      x.stroke();
      x.strokeStyle = 'rgba(255,236,206,0.34)'; x.lineWidth = 2; x.lineJoin = 'round';
      x.beginPath();
      x.rect(mx - 30, my + 8, 60, 24);
      x.moveTo(mx - 34, my + 8); x.lineTo(mx - 22, my - 4); x.lineTo(mx + 22, my - 4); x.lineTo(mx + 34, my + 8);
      x.rect(mx - 10, my - 26, 20, 22);
      x.moveTo(mx - 13, my - 26); x.lineTo(mx, my - 40); x.lineTo(mx + 13, my - 26);
      x.moveTo(mx + 5, my - 15); x.arc(mx, my - 15, 5, 0, TAU);
      for (let i = -2; i <= 2; i++) { if (i) { x.moveTo(mx + i * 11, my + 14); x.lineTo(mx + i * 11, my + 26); } }
      x.stroke();
      for (let i = 0; i < 54; i++) {
        const a = r() * TAU, rad = mr - 3 + r() * 20, br = 5 + r() * 11;
        x.fillStyle = r() < 0.5 ? 'rgba(190,202,226,0.97)' : 'rgba(204,214,234,0.97)';
        x.beginPath(); x.ellipse(mx + Math.cos(a) * rad, my + Math.sin(a) * rad, br * 1.5, br * (0.6 + r() * 0.4), a + Math.PI / 2, 0, TAU); x.fill();
      }
      this.hole = { x: mx, y: my, r: mr + 16 };
      this.bg = c;
      this.glints = [];
      for (let i = 0; i < 46; i++) this.glints.push([r() * w, r() * h, r() * TAU, 0.6 + r() * 1.6]);
      if (this.auto) this.wk = this.walker();
      this.autoT = 0.6;
    }
    footPointer(type, x, y) {
      const sc = this.scaleAt(y);
      if (Math.hypot(x - this.hole.x, y - this.hole.y) < this.hole.r) return;
      if (type === 'down') this.addPrint(x, y, sc, 1, true);
      if (type === 'move' && this.down && this.last && Math.hypot(x - this.last.x, y - this.last.y) > 62 * sc) this.addPrint(x, y, sc, 1, true);
    }
    footStep(dt) {
      if (!this.auto) return;
      if (this.userT !== undefined && this.t - this.userT < 5) { this.moveFinger(0, 0, false); return; }
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.walk(this.wk);
        this.autoT = 0.66;
      }
      this.moveFinger(this.wk.x, this.wk.y, true);
    }
    footDraw(x) {
      const { w, h } = this;
      x.drawImage(this.bg, 0, 0, w, h);
      for (const g of this.glints) {
        const a = Math.pow(Math.max(0, Math.sin(this.t * g[3] + g[2])), 8);
        if (a < 0.03) continue;
        x.fillStyle = `rgba(255,255,255,${a})`;
        x.fillRect(g[0] - 0.5, g[1] - 3, 1, 6);
        x.fillRect(g[0] - 3, g[1] - 0.5, 6, 1);
      }
      for (const p of this.prints) drawPrint(x, p);
      this.drawPuffs();
      this.drawFlakes();
    }

    /* ================= B안 · 걷는 길 ================= */
    walkInit() {
      const { w, h, dpr } = this;
      this.depthId = DEPTHS[this.canvas.dataset.depth] ? this.canvas.dataset.depth : 'base';
      const D = (this.dcfg = DEPTHS[this.depthId]);
      this.y0 = Math.round(h * D.horizon);
      this.f = 300 * (w > 600 ? 1.5 : 1);
      this.H = 1.55;
      this.cp = Math.cos(D.pitch); this.sp = Math.sin(D.pitch);
      this.cy = this.y0 + this.f * Math.tan(D.pitch);
      this.zNear = D.pitch > 0 ? -0.15 : 0.9; /* 화면 맨 아래에 닿는 땅 */
      this.holes = [];
      this.cam = 0; /* 몸(엉덩이)이 길을 따라 온 거리 m */
      this.camX = 0; /* 몸이 디딘 발 쪽으로 실린 만큼 m */
      this.hb = 0; /* 머리 높이 0~1 */
      this.ft = [{ side: -1, z: 0, since: 9 }, { side: 1, z: 0, since: 9 }]; /* 두 발이 디딘 자리 m */
      this.mv = null; /* 지금 내딛는 걸음 */
      this.queue = 0;
      this.lead = 1;
      this.voice = false;
      const cx = w / 2, y0 = this.y0;
      const c = mk(w * dpr, (y0 + 40) * dpr), x = c.getContext('2d');
      x.scale(dpr, dpr);
      const r = rng(23);
      let g = x.createLinearGradient(0, 0, 0, y0);
      g.addColorStop(0, '#050918'); g.addColorStop(0.5, '#111a3a'); g.addColorStop(0.86, '#2b2c54'); g.addColorStop(1, '#5a455a');
      x.fillStyle = g; x.fillRect(0, 0, w, y0 + 40);
      g = x.createRadialGradient(cx, y0, 0, cx, y0, w * 0.9);
      g.addColorStop(0, 'rgba(255,176,124,0.34)'); g.addColorStop(1, 'rgba(255,176,124,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, y0 + 40);
      towerBlock(x, r, -10, cx - 44, y0 + 2, 34, 118);
      towerBlock(x, r, cx + 44, w + 10, y0 + 2, 34, 118);
      /* 삿포로 TV탑 */
      const th = Math.min(h * 0.285, 250), by = y0 + 2, top = by - th;
      const ts = Math.min(1, (y0 - 64) / th); /* 지평선이 높으면 탑을 작게 */
      x.save();
      x.translate(cx, by); x.scale(ts, ts); x.translate(-cx, -by);
      const leg = (t) => 3 + 27 * Math.pow(1 - t, 1.25); /* 높이 t(0 바닥~1)에서 탑 반폭 */
      const deckT = 0.62;
      x.save();
      x.shadowColor = 'rgba(255,90,70,0.6)'; x.shadowBlur = 8;
      x.strokeStyle = '#d8493d'; x.lineWidth = 2.2; x.lineJoin = 'round';
      for (const s of [-1, 1]) {
        x.beginPath();
        for (let i = 0; i <= 20; i++) { const t = (i / 20) * 0.9; const px = cx + s * leg(t), py = by - th * t; if (i) x.lineTo(px, py); else x.moveTo(px, py); }
        x.lineTo(cx, top);
        x.stroke();
      }
      x.shadowBlur = 0;
      x.lineWidth = 1.1;
      x.beginPath();
      const seg = 9;
      for (let i = 0; i < seg; i++) {
        const t0 = (i / seg) * 0.88, t1 = ((i + 1) / seg) * 0.88;
        const a0 = leg(t0), a1 = leg(t1), y0s = by - th * t0, y1s = by - th * t1;
        x.moveTo(cx - a1, y1s); x.lineTo(cx + a1, y1s);
        x.moveTo(cx - a0, y0s); x.lineTo(cx + a1, y1s);
        x.moveTo(cx + a0, y0s); x.lineTo(cx - a1, y1s);
      }
      x.stroke();
      x.restore();
      const dy = by - th * deckT;
      x.fillStyle = '#1f3a34'; x.fillRect(cx - 14, dy - 13, 28, 13);
      x.fillStyle = 'rgba(255,224,160,0.95)';
      for (let i = 0; i < 6; i++) x.fillRect(cx - 12 + i * 4.2, dy - 9, 2.6, 4);
      x.fillStyle = 'rgba(232,240,252,0.8)'; x.fillRect(cx - 15, dy - 15, 30, 2.2);
      this.clock = { x: cx, y: by - th * 0.44, w: 34, h: 15 };
      x.fillStyle = '#0d0706'; x.fillRect(cx - 17, this.clock.y - 7.5, 34, 15);
      x.fillStyle = 'rgba(255,226,180,0.95)';
      for (const s of [-1, 1]) for (let i = 0; i <= 16; i++) { const t = (i / 16) * 0.86; x.beginPath(); x.arc(cx + s * leg(t), by - th * t, 0.9, 0, TAU); x.fill(); }
      x.restore();
      this.clock = { x: cx, y: by - (by - this.clock.y) * ts, s: ts };
      this.bg = c;
      this.trees = [treeSprite(3, true), treeSprite(8, true), treeSprite(14, true), treeSprite(21, false)];
      this.marks = [];
      for (let i = 0; i < 90; i++) this.marks.push([(r() - 0.5) * 3.3, r() * 40, r() < 0.5, 0.14 + r() * 0.3]);
      /* 시안마다 땅에 붙은 것들 (길을 따라 되풀이해요) */
      this.grain = [];
      for (let i = 0; i < 520; i++) this.grain.push([(r() - 0.5) * 3.5, r() * 10, 0.004 + r() * 0.008, r() < 0.62]);
      this.glints = [];
      for (let i = 0; i < 150; i++) this.glints.push([(r() - 0.5) * 3.4, r() * 12, r() * TAU, 0.7 + r() * 1.8]);
      this.drifts = [];
      for (let i = 0; i < 46; i++) this.drifts.push([(r() - 0.5) * 3.3, r() * 24, 0.25 + r() * 0.55]);
      this.autoT = 1;
    }
    /* 눈높이 카메라. X 옆(m), Y 높이(m), Z 앞(m) → [화면 x, 화면 y, 1m 의 px] */
    proj(X, Y, Z) {
      const dy = this.H + 0.03 * this.hb - Y;
      const depth = Math.max(0.05, Z * this.cp + dy * this.sp), up = Z * this.sp - dy * this.cp;
      const sc = this.f / depth;
      return [this.w / 2 + (X - this.camX) * sc, this.cy - up * sc, sc];
    }
    /* 땅 위의 타원 (반지름 rX 옆, rZ 앞뒤) → [x, y, rx, ry] */
    gEll(X, Z, rX, rZ) {
      const c = this.proj(X, 0, Z), n = this.proj(X, 0, Z - 0.05), fz = this.proj(X, 0, Z + 0.05);
      return [c[0], c[1], rX * c[2], Math.max(0.5, rZ * (n[1] - fz[1]) * 10)];
    }
    /* ---- 걷기 ----
       몸(this.cam)은 멈추지 않고 앞으로 나아가요. 디딘 발은 땅에 붙어 있어서 몸이 지나가면 화면 아래로 사라지고,
       뒷발은 화면 아래에서 들려 올라와 앞에 내려앉아요. 한 번만 누르면 한 걸음 내딛고 뒷발을 옆에 모아 서요. */
    stepForward(sound) {
      this.queue = Math.min(this.queue + 1, 2);
      this.voice = sound;
      if (!this.mv) this.nextMove();
    }
    nextMove() {
      const [A, B] = this.ft, S = GAIT.S;
      const front = A.z > B.z + 0.01 ? A : B.z > A.z + 0.01 ? B : null;
      const mk = (f, g, kind, z1, c1) => ({
        f, g, kind, z0: f.z, z1, c0: this.cam, c1, t: 0,
        dur: kind === 'close' ? GAIT.swing * 0.86 : GAIT.swing, P: GAIT.period,
        lift: kind === 'close' ? GAIT.lift * 0.6 : GAIT.lift,
        landed: false, count: kind !== 'close', sound: this.voice,
      });
      this.mv = null;
      if (this.queue > 0) {
        this.queue--;
        if (front) {
          const f = front === A ? B : A;
          this.mv = mk(f, front, 'walk', front.z + S, front.z + S / 2);
        } else {
          const f = this.ft[this.lead > 0 ? 1 : 0], g = f === A ? B : A;
          this.lead = -this.lead;
          this.mv = mk(f, g, 'start', g.z + S, g.z + S / 2);
        }
      } else if (front) {
        this.mv = mk(front === A ? B : A, front, 'close', front.z, front.z);
      }
      /* 깊은 눈: 발을 빼면 그 자리에 구멍이 남아요 */
      if (this.mv && this.depthId === 'deep') {
        this.holes.push({ X: this.mv.f.side * FOOT_HALF * this.dcfg.boost, z: this.mv.f.z, age: 0 });
        if (this.holes.length > 14) this.holes.shift();
      }
    }
    bootScale() { return this.w > 600 ? 1.5 : 1; }
    /* 발 하나의 자세. 길과 같은 카메라로 그려요. 디딘 발은 땅에 붙어서 몸이 지나가면 아래로 사라져요 */
    footPose(F) {
      const mv = this.mv, side = F.side, D = this.dcfg;
      let z = F.z, hgt = 0, fl = 1, planted = true;
      if (mv && mv.f === F && !mv.landed) {
        const u = clamp(mv.t / mv.dur, 0, 1);
        z = mv.z0 + (mv.z1 - mv.z0) * ease(u);
        hgt = mv.lift * Math.sin(Math.PI * Math.pow(u, 0.8));
        /* 뒤꿈치가 들리면 짧아 보이고, 내딛기 직전 발끝이 들리면 길어 보여요 */
        fl = 1 - 0.24 * Math.sin(Math.PI * clamp(u / 0.5, 0, 1)) + 0.1 * clamp((u - 0.55) / 0.45, 0, 1);
        planted = false;
      } else {
        fl = 1 + 0.1 * clamp(1 - F.since / 0.12, 0, 1); /* 뒤꿈치부터 닿고 발바닥이 내려앉아요 */
        const b = z - this.cam;
        if (b < -0.1) fl *= 1 - 0.22 * clamp((-0.1 - b) / 0.23, 0, 1); /* 몸이 지나가면 뒤꿈치가 들려요 */
      }
      const Z = z - this.cam + D.zOff, X = side * FOOT_HALF * D.boost, Y = hgt * D.boost * 0.8;
      const A = this.proj(X, Y, Z), T = this.proj(X, Y, Z + FOOT_LEN * D.boost), G = this.proj(X, 0, Z);
      const k = A[2] * D.boost * 0.0022;
      return {
        x: A[0], y: A[1], k,
        fl: fl * clamp((A[1] - T[1]) / (BOOT.L * k), 0.55, 1.4),
        rise: G[1] - A[1], lift: hgt / GAIT.lift, planted, depth: Z,
        rot: Math.atan2(T[0] - A[0], A[1] - T[1]) + side * 0.05,
      };
    }
    walkPointer(type) {
      if (type === 'down') this.stepForward(true);
    }
    walkStep(dt) {
      for (const F of this.ft) F.since += dt;
      const mv = this.mv;
      if (mv) {
        mv.t += dt;
        const v = clamp(mv.t / mv.P, 0, 1);
        /* 출발은 천천히 빨라지고, 멈출 땐 천천히 서요. 걷는 동안은 같은 빠르기 */
        const e = mv.kind === 'start' ? v * v : mv.kind === 'close' ? 1 - (1 - v) * (1 - v) : v;
        this.cam = mv.c0 + (mv.c1 - mv.c0) * e;
        /* 머리는 디딘 발 위를 지날 때 가장 높고, 몸은 디딘 발 쪽으로 살짝 실려요 */
        const amp = mv.kind === 'walk' ? 1 : 0.55, sv = Math.sin(Math.PI * v);
        this.hb = amp * sv * sv;
        this.camX = mv.g.side * 0.02 * amp * sv;
        if (!mv.landed && mv.t >= mv.dur) {
          mv.landed = true;
          mv.f.z = mv.z1;
          mv.f.since = 0;
          if (mv.count) { this.steps++; this.sync(); }
          if (mv.sound) crunch(mv.f.side * 0.45);
          const p = this.footPose(mv.f);
          const toe = this.bootPt(p, mv.f.side, -0.1 * BOOT.hw, -BOOT.L);
          this.puff(toe[0], toe[1] + 4 * p.k, 14, p.k, true);
        }
        if (mv.t >= mv.P) {
          this.cam = mv.c1;
          this.hb = 0; this.camX = 0;
          if (this.down && this.queue < 1) { this.queue = 1; this.voice = true; }
          this.nextMove();
        }
      }
      if (!this.auto) return;
      if (this.userT !== undefined && this.t - this.userT < 5) { this.moveFinger(0, 0, false); return; }
      const busy = this.queue > 0 || (this.mv && this.mv.kind !== 'close');
      if (!this.mv) {
        this.autoT -= dt;
        if (this.autoT <= 0) { this.queue = 7; this.voice = false; this.autoT = 2.2; this.nextMove(); }
      }
      this.moveFinger(this.w / 2, this.h * 0.5, busy);
    }
    walkDraw(x) {
      const { w, h, y0, cam } = this;
      const P = (X, Y, Z) => this.proj(X, Y, Z), zN = this.zNear, id = this.depthId;
      x.fillStyle = '#050918'; x.fillRect(0, 0, w, h);
      x.drawImage(this.bg, 0, 0, w, y0 + 40);
      /* TV탑 전광 시계 */
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      x.font = `700 ${(10.5 * this.clock.s).toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillStyle = '#ffb04a';
      x.shadowColor = 'rgba(255,150,40,0.9)'; x.shadowBlur = 5;
      x.fillText(hhmm, this.clock.x, this.clock.y + 0.5);
      x.shadowBlur = 0;
      /* 눈길. 머리가 오르내리거나 몸이 옆으로 실리면 가까운 땅만 움직이고 먼 풍경은 그대로예요 */
      const gy = y0;
      let g = x.createLinearGradient(0, gy, 0, h);
      g.addColorStop(0, '#56628c'); g.addColorStop(0.14, '#8695bb'); g.addColorStop(0.5, '#c6d1e8'); g.addColorStop(1, '#eef3fb');
      x.fillStyle = g; x.fillRect(0, gy, w, h - gy);
      g = x.createLinearGradient(0, gy, 0, gy + 30);
      g.addColorStop(0, 'rgba(255,190,140,0.4)'); g.addColorStop(1, 'rgba(255,190,140,0)');
      x.fillStyle = g; x.fillRect(0, gy, w, 30);
      for (const s of [-1, 1]) {
        const a = P(s * 1.75, 0, 70), b = P(s * 1.75, 0, zN);
        x.fillStyle = 'rgba(44,58,104,0.3)';
        x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.lineTo(s < 0 ? -60 : w + 60, h + 60); x.lineTo(s < 0 ? -60 : w + 60, gy); x.closePath(); x.fill();
        x.strokeStyle = 'rgba(255,255,255,0.4)'; x.lineWidth = 2;
        x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
      }
      if (id === 'pave') this.drawPave(x);
      if (id === 'deep') this.drawDrifts(x);
      if (id === 'deep' || id === 'down') this.drawGrain(x);
      /* 가로등 빛이 눈 위에 떨어진 자리 */
      const lampK0 = Math.ceil((cam + 1) / 8);
      for (let k = lampK0 + 7; k >= lampK0; k--) {
        const Z = k * 8 + 2 - cam;
        if (Z < 3) continue;
        for (const s of [-1, 1]) {
          const e = this.gEll(s * 1.25, Z, 1.7, 1.7);
          x.save(); x.translate(e[0], e[1]); x.scale(1, Math.min(0.8, e[3] / e[2]));
          g = x.createRadialGradient(0, 0, 0, 0, 0, e[2]);
          g.addColorStop(0, `rgba(255,206,140,${id === 'light' ? 0.62 : 0.5})`); g.addColorStop(1, 'rgba(255,206,140,0)');
          x.fillStyle = g; x.beginPath(); x.arc(0, 0, e[2], 0, TAU); x.fill();
          x.restore();
        }
      }
      if (id !== 'pave' && id !== 'deep') {
        for (const m of this.marks) {
          const Z = ((((m[1] - cam) % 40) + 40) % 40) + zN + 0.05;
          const e = this.gEll(m[0], Z, m[3], m[3] * 0.6);
          x.fillStyle = m[2] ? 'rgba(255,255,255,0.14)' : 'rgba(62,82,134,0.1)';
          x.globalAlpha = clamp(1.2 - Z / 30, 0, 1);
          x.beginPath(); x.ellipse(e[0], e[1], e[2], e[3], 0, 0, TAU); x.fill();
        }
        x.globalAlpha = 1;
      }
      /* 먼저 지나간 사람의 발자국. 새 눈에 반쯤 덮였어요 */
      const pitch = 0.72, base = Math.floor(cam / pitch);
      for (let j = 34; j >= -2; j--) {
        const Z = j * pitch - (cam - base * pitch) + 0.5;
        if (Z < zN + 0.1) continue;
        const sd = (j + base) % 2 ? 1 : -1, fade = clamp(1.1 - Z / 20, 0, 1);
        const e = this.gEll(0.95 + sd * 0.13, Z, 0.075, 0.15);
        x.fillStyle = `rgba(56,74,122,${0.34 * fade})`;
        x.beginPath(); x.ellipse(e[0], e[1], e[2], e[3], 0, 0, TAU); x.fill();
        x.fillStyle = `rgba(255,255,255,${0.4 * fade})`;
        x.beginPath(); x.ellipse(e[0], e[1] + e[3] * 0.9, e[2], Math.max(0.5, e[3] * 0.25), 0, 0, TAU); x.fill();
      }
      if (id === 'deep') { this.drawHoles(x); this.drawBanks(x); }
      /* 나무 · 가로등: 먼 것부터 */
      const k0 = Math.ceil((cam + 1.2) / 4);
      for (let k = k0 + 16; k >= k0; k--) {
        const Z = k * 4 - cam;
        const fade = clamp((66 - Z) / 22, 0, 1);
        if ((k & 1) === 0) {
          for (const s of [-1, 1]) {
            const Zl = Z + 2;
            const a = P(s * 2.05, 0, Zl), b = P(s * 2.05, 3.5, Zl), sl = b[2];
            x.globalAlpha = fade;
            x.strokeStyle = '#191b28'; x.lineWidth = Math.max(1, 0.07 * sl);
            x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.stroke();
            g = x.createRadialGradient(b[0], b[1], 0, b[0], b[1], 1.1 * sl);
            g.addColorStop(0, 'rgba(255,224,170,0.95)'); g.addColorStop(0.18, 'rgba(255,200,130,0.5)'); g.addColorStop(1, 'rgba(255,200,130,0)');
            x.fillStyle = g; x.beginPath(); x.arc(b[0], b[1], 1.1 * sl, 0, TAU); x.fill();
            x.fillStyle = '#fff6df'; x.beginPath(); x.arc(b[0], b[1], Math.max(1.2, 0.13 * sl), 0, TAU); x.fill();
          }
        }
        for (const s of [-1, 1]) {
          const sp = this.trees[(((k * 7 + (s > 0 ? 3 : 0)) % 4) + 4) % 4];
          const p = P(s * 2.75, 0, Z);
          const th = 5.4 * p[2], tw = (th * 280) / 340;
          if (p[0] + tw / 2 < -10 || p[0] - tw / 2 > w + 10) continue;
          x.globalAlpha = fade;
          x.drawImage(sp, p[0] - tw / 2, p[1] - th, tw, th);
        }
      }
      x.globalAlpha = 1;
      if (id === 'light') this.drawGlints(x);
      /* 내 다리와 부츠. 먼 발부터 그려요 */
      const legs = this.ft.map((F) => [F.side, this.footPose(F)]).sort((a, b) => b[1].depth - a[1].depth);
      if (id === 'light') this.drawLegShadows(x, legs);
      for (const [s, p] of legs) if (p.y - BOOT.L * p.k * p.fl < h + 10) this.drawLeg(x, p, s);
      this.drawFlakes();
      this.drawPuffs();
    }
    /* 공간감 1 · 보도블록: 얇은 눈 아래로 돌 줄눈이 비쳐요. 사람이 많이 다닌 가운데가 더 드러나요 */
    drawPave(x) {
      const P = (X, Y, Z) => this.proj(X, Y, Z);
      const cam = this.cam, zN = this.zNear, rowL = 0.42, brick = 0.62;
      const n0 = Math.floor((cam + zN) / rowL) - 1;
      for (let n = n0 + 64; n >= n0; n--) {
        const Z = n * rowL - cam, Z2 = Z + rowL;
        if (Z2 < zN) continue;
        const fade = clamp(1.3 - Z / 20, 0, 1);
        if (fade <= 0) continue;
        const off = n & 1 ? brick / 2 : 0;
        for (let i = -1; i * brick - 1.75 - off < 1.75; i++) {
          const X = i * brick - 1.75 - off, xa = Math.max(X, -1.75), xb = Math.min(X + brick, 1.75);
          if (xb <= xa) continue;
          const hs = hash2(n, i), trod = clamp(1 - Math.abs((xa + xb) / 2) / 1.2, 0, 1);
          const a = (0.03 + 0.2 * trod * trod) * (hs > 0.42 ? 1 : 0.35) * fade;
          const gp = 0.03;
          const q = [P(xa + gp, 0, Z + gp), P(xb - gp, 0, Z + gp), P(xb - gp, 0, Z2 - gp), P(xa + gp, 0, Z2 - gp)];
          x.fillStyle = `rgba(78,82,108,${a})`;
          x.beginPath(); x.moveTo(q[0][0], q[0][1]); for (let j = 1; j < 4; j++) x.lineTo(q[j][0], q[j][1]); x.closePath(); x.fill();
          if (X > -1.75) {
            const p1 = P(X, 0, Z), p2 = P(X, 0, Z2);
            x.strokeStyle = `rgba(46,56,92,${(0.12 + 0.3 * trod) * fade})`; x.lineWidth = clamp(0.014 * p1[2], 0.5, 3);
            x.beginPath(); x.moveTo(p1[0], p1[1]); x.lineTo(p2[0], p2[1]); x.stroke();
          }
        }
        const l = P(-1.75, 0, Z), r2 = P(1.75, 0, Z), c = P(0, 0, Z);
        const lg = x.createLinearGradient(l[0], 0, r2[0], 0);
        lg.addColorStop(0, `rgba(46,56,92,${0.1 * fade})`); lg.addColorStop(0.5, `rgba(46,56,92,${0.4 * fade})`); lg.addColorStop(1, `rgba(46,56,92,${0.1 * fade})`);
        x.strokeStyle = lg; x.lineWidth = clamp(0.016 * c[2], 0.5, 3.4);
        x.beginPath(); x.moveTo(l[0], l[1]); x.lineTo(r2[0], r2[1]); x.stroke();
      }
    }
    /* 눈 결: 가까울수록 굵게 보여요 */
    drawGrain(x) {
      const cam = this.cam, zN = this.zNear;
      for (const gr of this.grain) {
        const Z = ((((gr[1] - cam) % 10) + 10) % 10) + zN;
        if (Z > 8) continue;
        const p = this.proj(gr[0], 0, Z), r = clamp(gr[2] * p[2], 0.4, 3);
        x.fillStyle = gr[3] ? `rgba(255,255,255,${0.42 * clamp(1.2 - Z / 8, 0, 1)})` : `rgba(70,90,140,${0.2 * clamp(1.2 - Z / 8, 0, 1)})`;
        x.beginPath(); x.ellipse(p[0], p[1], r, r * 0.6, 0, 0, TAU); x.fill();
      }
    }
    /* 공간감 2 · 가로등 그림자: 눈 결이 반짝이고 */
    drawGlints(x) {
      const cam = this.cam, zN = this.zNear;
      for (const gl of this.glints) {
        const Z = ((((gl[1] - cam) % 12) + 12) % 12) + zN;
        if (Z > 9) continue;
        const a = Math.pow(Math.max(0, Math.sin(this.t * gl[3] + gl[2])), 12) * clamp(1.3 - Z / 9, 0, 1);
        if (a < 0.04) continue;
        const p = this.proj(gl[0], 0, Z), sz = clamp(0.03 * p[2], 1.5, 7);
        x.fillStyle = `rgba(255,250,236,${a})`;
        x.fillRect(p[0] - 0.6, p[1] - sz, 1.2, sz * 2);
        x.fillRect(p[0] - sz, p[1] - 0.6, sz * 2, 1.2);
      }
    }
    /* 공간감 2 · 가로등 그림자: 가까운 가로등마다 다리 그림자가 길게 늘어져요. 지나간 가로등은 그림자를 앞으로 드리워요 */
    drawLegShadows(x, legs) {
      const D = this.dcfg, cam = this.cam, zMin = this.zNear - 0.35;
      const lamps = [];
      const m0 = Math.floor((cam - 12) / 8);
      for (let m = m0; m < m0 + 5; m++) for (const s of [-1, 1]) lamps.push([s * 2.05, m * 8 + 2 - cam]);
      for (const [side, p] of legs) {
        const fz = p.depth, fx = side * FOOT_HALF * D.boost;
        for (const [lx, lz] of lamps) {
          let ux = fx - lx, uz = fz - lz;
          const d = Math.hypot(ux, uz);
          if (d > 9) continue;
          ux /= d; uz /= d;
          let len = clamp(d * 1.05, 0.6, 4.2);
          if (uz < 0) len = Math.min(len, (fz - zMin) / -uz);
          if (len < 0.2) continue;
          const a = 0.34 * Math.pow(clamp(2.4 / d, 0, 1), 1.5);
          if (a < 0.03) continue;
          const nx = -uz, nz = ux, ex = fx + ux * len, ez = fz + uz * len;
          const s0 = this.proj(fx, 0, fz), s1 = this.proj(ex, 0, ez);
          for (const [w0, w1, aa] of [[0.075, 0.1, 0.45], [0.042, 0.055, 1]]) {
            const b0 = w0 * D.boost, b1 = w1 * D.boost;
            const q = [P2(this, fx + nx * b0, fz + nz * b0), P2(this, fx - nx * b0, fz - nz * b0), P2(this, ex - nx * b1, ez - nz * b1), P2(this, ex + nx * b1, ez + nz * b1)];
            const lg = x.createLinearGradient(s0[0], s0[1], s1[0], s1[1]);
            lg.addColorStop(0, `rgba(26,34,78,${a * aa})`); lg.addColorStop(0.55, `rgba(26,34,78,${a * aa * 0.5})`); lg.addColorStop(1, 'rgba(26,34,78,0)');
            x.fillStyle = lg;
            x.beginPath(); x.moveTo(q[0][0], q[0][1]); for (let j = 1; j < 4; j++) x.lineTo(q[j][0], q[j][1]); x.closePath(); x.fill();
          }
        }
      }
    }
    /* 공간감 3 · 깊은 눈: 바람이 만든 눈 물결. 가까울수록 굵고 또렷해요 */
    drawDrifts(x) {
      const cam = this.cam, zN = this.zNear;
      x.lineCap = 'round';
      for (const d of this.drifts) {
        const Z = ((((d[1] - cam) % 24) + 24) % 24) + zN;
        if (Z > 22) continue;
        const fade = clamp(1.25 - Z / 20, 0, 1), wd = d[2] * 1.3, bend = (d[2] - 0.5) * 0.5;
        const ridge = (dz, dy) => {
          const a = this.proj(d[0] - wd, 0, Z + dz), b = this.proj(d[0] - wd * 0.3, dy, Z + dz + bend), c = this.proj(d[0] + wd * 0.35, dy, Z + dz - bend), e = this.proj(d[0] + wd, 0, Z + dz + bend * 0.4);
          x.beginPath(); x.moveTo(a[0], a[1]); x.bezierCurveTo(b[0], b[1], c[0], c[1], e[0], e[1]);
          return b[2];
        };
        let sc = ridge(-0.06, 0);
        x.strokeStyle = `rgba(84,102,156,${0.13 * fade})`; x.lineWidth = clamp(0.09 * sc, 0.8, 14); x.stroke();
        sc = ridge(0, 0.03);
        x.strokeStyle = `rgba(255,255,255,${0.28 * fade})`; x.lineWidth = clamp(0.03 * sc, 0.5, 5); x.stroke();
      }
    }
    /* 공간감 3 · 깊은 눈: 길 가장자리로 치워 쌓은 눈 언덕 */
    drawBanks(x) {
      const zN = this.zNear, cam = this.cam, n = 26;
      for (const s of [-1, 1]) {
        const inner = [], top = [], outer = [];
        for (let i = 0; i <= n; i++) {
          const Z = zN + (40 - zN) * Math.pow(i / n, 2), wz = Z + cam;
          const ht = 0.34 + 0.08 * Math.sin(wz * 1.3) + 0.05 * Math.sin(wz * 3.1 + 1);
          inner.push(this.proj(s * 1.7, 0, Z)); top.push(this.proj(s * 1.92, ht, Z)); outer.push(this.proj(s * 2.4, ht * 0.6, Z));
        }
        const path = (A, B) => { x.beginPath(); x.moveTo(A[0][0], A[0][1]); for (const p of A) x.lineTo(p[0], p[1]); for (let i = B.length - 1; i >= 0; i--) x.lineTo(B[i][0], B[i][1]); x.closePath(); };
        path(inner, top); x.fillStyle = 'rgba(138,154,200,0.92)'; x.fill();
        path(top, outer); x.fillStyle = 'rgba(222,230,246,0.95)'; x.fill();
        x.strokeStyle = 'rgba(255,255,255,0.75)'; x.lineWidth = 1.6;
        x.beginPath(); x.moveTo(top[0][0], top[0][1]); for (const p of top) x.lineTo(p[0], p[1]); x.stroke();
      }
    }
    /* 공간감 3 · 깊은 눈: 발을 뺀 자리의 구멍. 새 눈에 천천히 메워져요 */
    drawHoles(x) {
      const D = this.dcfg;
      for (const ho of this.holes) {
        ho.age = this.t - (ho.t0 === undefined ? (ho.t0 = this.t) : ho.t0);
        const a = clamp(1 - ho.age / this.cover, 0, 1);
        if (a <= 0) continue;
        const Z = ho.z - this.cam + D.zOff + FOOT_LEN * D.boost * 0.45;
        if (Z < this.zNear - 0.3) continue;
        const e = this.gEll(ho.X, Z, 0.06 * D.boost, FOOT_LEN * D.boost * 0.6);
        x.fillStyle = `rgba(96,114,170,${0.45 * a})`;
        x.beginPath(); x.ellipse(e[0], e[1], e[2], e[3], 0, 0, TAU); x.fill();
        x.fillStyle = `rgba(66,84,140,${0.4 * a})`;
        x.beginPath(); x.ellipse(e[0], e[1] - e[3] * 0.25, e[2] * 0.82, e[3] * 0.62, 0, 0, TAU); x.fill();
        x.strokeStyle = `rgba(255,255,255,${0.75 * a})`; x.lineWidth = Math.max(1, e[2] * 0.12);
        x.beginPath(); x.ellipse(e[0], e[1], e[2] * 1.08, e[3] * 1.08, 0, Math.PI * 1.05, Math.PI * 1.95); x.stroke();
      }
    }
    /* 부츠의 로컬 좌표(발끝이 -y, 바짓단이 0, +x 가 바깥쪽)를 화면 좌표로 */
    bootPt(p, side, lx, ly) {
      const ax = side * lx * p.k, ay = ly * p.k * p.fl, c = Math.cos(p.rot), sn = Math.sin(p.rot);
      return [p.x + c * ax - sn * ay, p.y + sn * ax + c * ay];
    }
    /* 걸으며 내려다본 내 다리 하나: 눈 위 그림자 → 부츠 → 디딘 자리의 눈 턱 → 바지 */
    drawLeg(x, p, side) {
      const { w, h, dpr } = this;
      const { L, hw, cw } = BOOT;
      const bs = this.bootScale(), k = p.k;
      const lerp = (a, b, t) => a + (b - a) * t;

      /* 눈 위 그림자. 발이 들려도 그림자는 땅에 남고 옅어져요 */
      const gy = p.y + p.rise;
      x.save();
      x.translate(p.x - side * 3 * k, gy - L * 0.4 * k);
      x.scale(1, (L * 0.6) / (hw * 1.5));
      let g = x.createRadialGradient(0, 0, 0, 0, 0, hw * 1.5 * k);
      g.addColorStop(0, `rgba(28,38,80,${0.44 - 0.26 * p.lift})`);
      g.addColorStop(0.62, `rgba(28,38,80,${0.2 - 0.12 * p.lift})`);
      g.addColorStop(1, 'rgba(28,38,80,0)');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, hw * 1.5 * k, 0, TAU); x.fill();
      x.restore();

      /* 부츠 (위에서 본 발등). 엄지 쪽은 곧고 새끼발가락 쪽은 둥글어요 */
      x.save();
      x.translate(p.x, p.y); x.rotate(p.rot); x.scale(side * k, k * p.fl);
      const outline = (gr) => {
        x.beginPath();
        x.moveTo(-hw * 0.9 - gr, 14);
        x.bezierCurveTo(-hw * 0.86 - gr, -L * 0.3, -hw * 0.96 - gr, -L * 0.48, -hw * 0.95 - gr, -L * 0.64);
        x.bezierCurveTo(-hw * 0.93 - gr, -L * 0.88 - gr, -hw * 0.6, -L - gr, -hw * 0.12, -L - gr);
        x.bezierCurveTo(hw * 0.45, -L - gr, hw * 1.03 + gr, -L * 0.86 - gr, hw * 1.03 + gr, -L * 0.62);
        x.bezierCurveTo(hw * 1.03 + gr, -L * 0.46, hw * 0.88 + gr, -L * 0.3, hw * 0.93 + gr, 14);
        x.closePath();
      };
      const deep = this.depthId === 'deep' && p.planted;
      if (deep) {
        /* 깊은 눈: 발이 눈에 빠져서 밑창은 안 보이고, 발보다 조금 큰 구멍이 파여요 */
        const pg = x.createLinearGradient(0, -L - 9, 0, -L * 0.35);
        pg.addColorStop(0, 'rgba(58,74,132,0.7)'); pg.addColorStop(0.55, 'rgba(84,102,160,0.4)'); pg.addColorStop(1, 'rgba(96,114,170,0)');
        x.save();
        x.shadowColor = 'rgba(70,88,146,0.5)'; x.shadowBlur = 6 * k * dpr;
        outline(7); x.fillStyle = pg; x.fill();
        x.restore();
      } else {
        /* 밑창이 눈에 닿은 자리의 어두운 테두리. 들린 발은 옅어요 */
        x.save();
        x.shadowColor = `rgba(22,30,66,${0.6 * (1 - p.lift)})`; x.shadowBlur = 8 * k * dpr; x.shadowOffsetY = 2.5 * k * dpr;
        outline(3.4); x.fillStyle = '#16100c'; x.fill(); /* 밑창 */
        x.restore();
        outline(1.5); x.fillStyle = '#3a2619'; x.fill(); /* 밑창 둘레 */
      }
      outline(0);
      g = x.createRadialGradient(hw * 0.12, -L * 0.76, 2, hw * 0.05, -L * 0.58, L * 0.86);
      g.addColorStop(0, '#a87652'); g.addColorStop(0.36, '#7b523a'); g.addColorStop(1, '#3a2519');
      x.fillStyle = g; x.fill();
      x.save();
      x.clip();
      x.lineWidth = 7; x.strokeStyle = 'rgba(22,12,8,0.42)'; outline(0); x.stroke();
      if (deep) {
        /* 깊은 눈: 부츠 아래쪽 가장자리에 눈이 묻어 있어요 */
        x.lineWidth = 6; x.strokeStyle = 'rgba(236,242,252,0.55)'; outline(0); x.stroke();
      }
      if (this.depthId === 'light') {
        /* 가로등 빛이 앞코 가장자리에 걸려요 */
        const rg = x.createLinearGradient(0, -L, 0, -L * 0.2);
        rg.addColorStop(0, 'rgba(255,206,150,0.75)'); rg.addColorStop(1, 'rgba(255,206,150,0)');
        x.lineWidth = 5; x.strokeStyle = rg; outline(0); x.stroke();
      }
      /* 앞코 덧댄 가죽의 이음매와 바늘땀 */
      x.lineWidth = 1.6; x.strokeStyle = 'rgba(32,18,11,0.7)';
      x.beginPath(); x.moveTo(-hw * 1.1, -L * 0.52); x.quadraticCurveTo(-hw * 0.05, -L * 0.76, hw * 1.1, -L * 0.52); x.stroke();
      x.setLineDash([2.2, 2.6]); x.lineWidth = 1; x.strokeStyle = 'rgba(236,206,164,0.42)';
      x.beginPath(); x.moveTo(-hw * 1.1, -L * 0.555); x.quadraticCurveTo(-hw * 0.05, -L * 0.795, hw * 1.1, -L * 0.555); x.stroke();
      x.setLineDash([]);
      x.restore();
      x.fillStyle = 'rgba(255,228,196,0.2)';
      x.beginPath(); x.ellipse(hw * 0.3, -L * 0.82, hw * 0.34, L * 0.06, -0.5, 0, TAU); x.fill();
      /* 혀와 끈 */
      x.fillStyle = '#4a3122';
      x.beginPath();
      x.moveTo(-hw * 0.42, 14); x.lineTo(-hw * 0.33, -L * 0.48);
      x.quadraticCurveTo(-hw * 0.02, -L * 0.55, hw * 0.33, -L * 0.48); x.lineTo(hw * 0.42, 14);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(20,12,8,0.6)'; x.lineWidth = 1.4;
      x.beginPath(); x.moveTo(-hw * 0.42, 14); x.lineTo(-hw * 0.33, -L * 0.48); x.moveTo(hw * 0.42, 14); x.lineTo(hw * 0.33, -L * 0.48); x.stroke();
      const rows = [-0.44, -0.33, -0.22, -0.11, 0].map((v) => v * L);
      const eye = (i) => hw * (0.3 + 0.03 * i);
      x.lineCap = 'round';
      for (const [col, lw, dy] of [['rgba(20,12,8,0.55)', 3.4, 1.2], ['#e9dcc0', 2, 0]]) {
        x.strokeStyle = col; x.lineWidth = lw;
        x.beginPath();
        x.moveTo(-eye(0), rows[0] + dy); x.lineTo(eye(0), rows[0] + dy);
        for (let i = 0; i < rows.length - 1; i++) {
          x.moveTo(-eye(i), rows[i] + dy); x.lineTo(eye(i + 1), rows[i + 1] + dy);
          x.moveTo(eye(i), rows[i] + dy); x.lineTo(-eye(i + 1), rows[i + 1] + dy);
        }
        x.stroke();
      }
      x.fillStyle = 'rgba(214,190,140,0.9)';
      for (let i = 0; i < rows.length; i++) for (const ex of [-eye(i), eye(i)]) { x.beginPath(); x.arc(ex, rows[i], 1.5, 0, TAU); x.fill(); }
      /* 앞코에 붙은 눈 */
      const r = rng(side > 0 ? 5 : 9);
      x.fillStyle = 'rgba(255,255,255,0.92)';
      for (let i = 0; i < 10; i++) {
        const a = Math.PI * (1.12 + r() * 0.76), rad = 0.74 + r() * 0.2;
        x.beginPath();
        x.ellipse(-hw * 0.05 + Math.cos(a) * hw * rad, -L * 0.62 + Math.sin(a) * L * 0.37 * rad, 1 + r() * 2.2, 0.8 + r() * 1.3, a, 0, TAU);
        x.fill();
      }
      /* 디딘 발 앞코 둘레로 밀려난 눈 부스러기 */
      if (p.planted && !deep) {
        const rj = rng(side > 0 ? 31 : 37);
        for (let i = 0; i < 9; i++) {
          const a = Math.PI * (1.08 + rj() * 0.84), j = rj();
          const px = -hw * 0.06 + Math.cos(a) * (hw * 1.06 + 4 + j * 5), py = -L * 0.6 + Math.sin(a) * (L * 0.42 + 4 + j * 5);
          x.fillStyle = 'rgba(120,138,190,0.32)';
          x.beginPath(); x.ellipse(px, py + 1.1, 1.5 + j * 1.3, 1.1 + j * 0.9, a + Math.PI / 2, 0, TAU); x.fill();
          x.fillStyle = 'rgba(250,252,255,0.9)';
          x.beginPath(); x.ellipse(px, py, 1.3 + j * 1.2, 1 + j * 0.8, a + Math.PI / 2, 0, TAU); x.fill();
        }
      }
      x.restore();

      /* 바지. 바짓단에서 화면 아래(엉덩이 쪽)로 갈수록 가까워서 넓어져요 */
      const cOut = this.bootPt(p, side, cw, 6), cIn = this.bootPt(p, side, -cw, 6), hem = this.bootPt(p, side, 0, -32);
      const baseY = Math.max(h + 30 * bs, cOut[1] + 50 * bs), bx = w / 2 + side * 72 * bs;
      const bIn = bx - side * 64 * bs, bOut = bx + side * 64 * bs;
      const outerEdge = () => x.bezierCurveTo(lerp(cOut[0], bOut, 0.8) + side * 4 * bs, lerp(cOut[1], baseY, 0.6), lerp(cOut[0], bOut, 0.2) + side * 6 * k, lerp(cOut[1], baseY, 0.16), cOut[0], cOut[1]);
      const legPath = () => {
        x.beginPath();
        x.moveTo(cOut[0], cOut[1]);
        x.quadraticCurveTo(hem[0], hem[1], cIn[0], cIn[1]);
        x.bezierCurveTo(lerp(cIn[0], bIn, 0.12), lerp(cIn[1], baseY, 0.45), lerp(cIn[0], bIn, 0.55), lerp(cIn[1], baseY, 0.8), bIn, baseY);
        x.lineTo(bOut, baseY);
        outerEdge();
        x.closePath();
      };
      /* 바짓단 그림자가 부츠와 눈 위로 떨어져요 */
      x.save();
      x.shadowColor = 'rgba(10,8,22,0.55)'; x.shadowBlur = 10 * k * dpr; x.shadowOffsetY = -3 * k * dpr;
      legPath(); x.fillStyle = '#232b49'; x.fill();
      x.restore();
      g = x.createLinearGradient(lerp(cIn[0], bIn, 0.5), 0, lerp(cOut[0], bOut, 0.5), 0);
      g.addColorStop(0, '#11162a'); g.addColorStop(0.36, '#212944'); g.addColorStop(0.8, '#343f68'); g.addColorStop(1, '#475381');
      legPath(); x.fillStyle = g; x.fill();
      const cy = (cIn[1] + cOut[1]) / 2;
      g = x.createLinearGradient(0, cy, 0, baseY);
      g.addColorStop(0, 'rgba(130,150,210,0.12)'); g.addColorStop(0.3, 'rgba(8,12,28,0)'); g.addColorStop(1, 'rgba(8,12,28,0.5)');
      x.fillStyle = g; x.fill();
      x.save();
      x.clip();
      /* 바짓단 위로 접힌 주름. 한쪽씩 어긋나게 짧게 */
      for (const [t, u0, u1, a] of [[0.06, 0.08, 0.62, 0.42], [0.13, 0.4, 0.94, 0.3], [0.22, 0.12, 0.5, 0.18]]) {
        const yI = lerp(cIn[1], baseY, t), yO = lerp(cOut[1], baseY, t);
        const xI = lerp(cIn[0], bIn, t * 0.7), xO = lerp(cOut[0], bOut, t * 0.7);
        const xa = lerp(xI, xO, u0), xb = lerp(xI, xO, u1), ya = lerp(yI, yO, u0), yb = lerp(yI, yO, u1);
        const bend = (xb - xa) * 0.16 * side;
        x.strokeStyle = `rgba(6,8,20,${a})`; x.lineWidth = 2.4 * k;
        x.beginPath(); x.moveTo(xa, ya); x.quadraticCurveTo((xa + xb) / 2, (ya + yb) / 2 - Math.abs(bend), xb, yb); x.stroke();
        x.strokeStyle = `rgba(160,178,236,${a * 0.38})`; x.lineWidth = 1.3 * k;
        x.beginPath(); x.moveTo(xa, ya - 2.4 * k); x.quadraticCurveTo((xa + xb) / 2, (ya + yb) / 2 - Math.abs(bend) - 2.4 * k, xb, yb - 2.4 * k); x.stroke();
      }
      /* 다림질 선과 가로등 빛이 닿는 바깥 가장자리 */
      const cr = this.bootPt(p, side, cw * 0.3, -6);
      x.strokeStyle = 'rgba(140,160,224,0.1)'; x.lineWidth = 4 * k;
      x.beginPath(); x.moveTo(cr[0], cr[1]); x.quadraticCurveTo(lerp(cr[0], lerp(bIn, bOut, 0.62), 0.4), lerp(cr[1], baseY, 0.5), lerp(bIn, bOut, 0.62), baseY); x.stroke();
      x.strokeStyle = 'rgba(255,212,168,0.24)'; x.lineWidth = 3.2 * bs;
      x.beginPath(); x.moveTo(bOut, baseY); x.bezierCurveTo(lerp(cOut[0], bOut, 0.2) + side * 6 * k, lerp(cOut[1], baseY, 0.16), lerp(cOut[0], bOut, 0.8) + side * 4 * bs, lerp(cOut[1], baseY, 0.6), cOut[0], cOut[1]);
      x.stroke();
      /* 바지에 앉은 눈 */
      const rs = rng(side > 0 ? 13 : 17);
      x.fillStyle = 'rgba(255,255,255,0.7)';
      for (let i = 0; i < 4; i++) {
        const t = 0.04 + rs() * 0.24, u = 0.2 + rs() * 0.6;
        const px = lerp(lerp(cIn[0], bIn, t), lerp(cOut[0], bOut, t), u), py = lerp(lerp(cIn[1], baseY, t), lerp(cOut[1], baseY, t), u);
        x.beginPath(); x.arc(px, py, (0.7 + rs()) * k, 0, TAU); x.fill();
      }
      x.restore();
      /* 바짓단 테두리 */
      x.strokeStyle = 'rgba(6,8,20,0.5)'; x.lineWidth = 2 * k;
      const h2 = this.bootPt(p, side, 0, -28), o2 = this.bootPt(p, side, cw - 1, 9.5), i2 = this.bootPt(p, side, -cw + 1, 9.5);
      x.beginPath(); x.moveTo(o2[0], o2[1]); x.quadraticCurveTo(h2[0], h2[1], i2[0], i2[1]); x.stroke();
      x.strokeStyle = 'rgba(176,192,240,0.5)'; x.lineWidth = 1.6 * k;
      x.beginPath(); x.moveTo(cOut[0], cOut[1]); x.quadraticCurveTo(hem[0], hem[1], cIn[0], cIn[1]); x.stroke();
    }

    /* ================= C안 · 시계탑 앞 ================= */
    streetInit() {
      const { w, h, dpr } = this;
      /* 홈 카드(data-card)는 작아서 땅을 아래로 내리고 건물을 작게, 글자가 놓이는 왼쪽 아래를 비우려고 살짝 오른쪽에 둬요 */
      const card = this.canvas.dataset.card !== undefined;
      const gy = (this.gy = Math.round(h * (card ? 0.74 : w > 600 ? 0.63 : 0.57))); /* 넓은 화면은 땅을 조금 내려서 시계탑이 위쪽 탭 · 장면 전환 아래에 들어가요 */
      const u = card
        ? Math.min((gy - 14) / 305, w / 290)
        : clamp(Math.min(w / 390, (gy - 158) / 305), 0.8, 1.5); /* 넓은 화면에서 건물이 커지는 정도. 탑 꼭대기가 장면 전환(위에서 ~150px) 아래에 오게 */
      const cx = card ? clamp(w * 0.75, 135 * u + 4, w - 135 * u - 4) : w / 2; /* 카드 왼쪽 위 태그와 겹치지 않게 오른쪽으로 */
      const c = mk(w * dpr, h * dpr), x = c.getContext('2d');
      x.scale(dpr, dpr);
      const r = rng(41);
      let g = x.createLinearGradient(0, 0, 0, gy);
      g.addColorStop(0, '#050918'); g.addColorStop(0.55, '#121b3b'); g.addColorStop(1, '#3a3458');
      x.fillStyle = g; x.fillRect(0, 0, w, gy + 4);
      g = x.createRadialGradient(cx, gy, 0, cx, gy, w * 0.9);
      g.addColorStop(0, 'rgba(255,178,124,0.3)'); g.addColorStop(1, 'rgba(255,178,124,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, gy + 4);
      /* 시계탑은 높은 빌딩에 둘러싸여 있어요 */
      towerBlock(x, r, -10, w + 10, gy + 2, 150 * u, 300 * u);
      x.fillStyle = 'rgba(8,12,30,0.42)'; x.fillRect(0, 0, w, gy + 4);

      x.save();
      x.translate(cx, gy);
      x.scale(u, u);
      const wall = (px, py, ww, hh) => {
        const wg = x.createLinearGradient(0, py, 0, py + hh);
        wg.addColorStop(0, '#9aa6c2'); wg.addColorStop(1, '#c9cfdd');
        x.fillStyle = wg; x.fillRect(px, py, ww, hh);
        x.strokeStyle = 'rgba(30,40,80,0.13)'; x.lineWidth = 1;
        x.beginPath();
        for (let yy = py + 4; yy < py + hh; yy += 5) { x.moveTo(px, yy); x.lineTo(px + ww, yy); }
        x.stroke();
      };
      const win = (px, py, ww, hh) => {
        x.save();
        x.shadowColor = 'rgba(255,190,110,0.9)'; x.shadowBlur = 14;
        x.fillStyle = '#ffd08a';
        x.beginPath(); x.moveTo(px, py + hh); x.lineTo(px, py + ww / 2); x.arc(px + ww / 2, py + ww / 2, ww / 2, Math.PI, 0); x.lineTo(px + ww, py + hh); x.closePath(); x.fill();
        x.restore();
        x.strokeStyle = 'rgba(70,40,30,0.7)'; x.lineWidth = 1.2;
        x.beginPath(); x.moveTo(px + ww / 2, py + 2); x.lineTo(px + ww / 2, py + hh); x.moveTo(px, py + hh * 0.55); x.lineTo(px + ww, py + hh * 0.55); x.stroke();
      };
      const snowCap = (pts) => {
        x.fillStyle = '#e9effa';
        x.beginPath(); x.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
        x.closePath(); x.fill();
      };
      /* 본채 */
      wall(-135, -92, 270, 92);
      x.fillStyle = '#6a2c2e';
      x.beginPath(); x.moveTo(-146, -92); x.lineTo(146, -92); x.lineTo(118, -132); x.lineTo(-118, -132); x.closePath(); x.fill();
      snowCap([[-141, -98], [141, -98], [118, -136], [-118, -136]]);
      x.fillStyle = 'rgba(160,178,214,0.5)'; x.fillRect(-141, -99, 282, 3);
      for (const px of [-118, -84, -50, 30, 64, 98]) win(px, -76, 20, 46);
      /* 현관 */
      wall(-24, -62, 48, 62);
      x.fillStyle = '#6a2c2e'; x.beginPath(); x.moveTo(-30, -62); x.lineTo(30, -62); x.lineTo(0, -84); x.closePath(); x.fill();
      snowCap([[-30, -64], [30, -64], [0, -88]]);
      x.fillStyle = '#35221e'; x.beginPath(); rr(x, -11, -44, 22, 44, 3); x.fill();
      x.fillStyle = 'rgba(255,208,138,0.9)'; x.fillRect(-8, -40, 16, 12);
      /* 탑 */
      wall(-31, -246, 62, 114);
      x.fillStyle = 'rgba(30,40,80,0.18)'; x.fillRect(-31, -246, 8, 114);
      x.fillStyle = '#35221e';
      x.fillRect(-9, -162, 18, 22);
      x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 1;
      x.beginPath(); for (let yy = -158; yy < -142; yy += 4) { x.moveTo(-8, yy); x.lineTo(8, yy); } x.stroke();
      x.fillStyle = '#6a2c2e'; x.beginPath(); x.moveTo(-40, -246); x.lineTo(40, -246); x.lineTo(0, -292); x.closePath(); x.fill();
      snowCap([[-40, -249], [40, -249], [0, -296]]);
      x.strokeStyle = '#2a2430'; x.lineWidth = 1.6;
      x.beginPath(); x.moveTo(0, -294); x.lineTo(0, -312); x.stroke();
      /* 붉은 별 */
      x.fillStyle = '#d2463f';
      x.beginPath();
      for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rad = i % 2 ? 2.6 : 6.2; x.lineTo(Math.cos(a) * rad, -232 + Math.sin(a) * rad); }
      x.closePath(); x.fill();
      /* 시계 */
      x.save();
      x.shadowColor = 'rgba(255,214,150,0.95)'; x.shadowBlur = 18;
      x.fillStyle = '#fff3d8'; x.beginPath(); x.arc(0, -198, 21, 0, TAU); x.fill();
      x.restore();
      x.strokeStyle = '#2a2430'; x.lineWidth = 2.4; x.beginPath(); x.arc(0, -198, 21, 0, TAU); x.stroke();
      x.lineWidth = 1.3;
      x.beginPath();
      for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; x.moveTo(Math.cos(a) * 16, -198 + Math.sin(a) * 16); x.lineTo(Math.cos(a) * 19, -198 + Math.sin(a) * 19); }
      x.stroke();
      x.restore();
      this.face = { x: cx, y: gy - 198 * u, r: 21 * u };

      /* 앞마당 눈 */
      g = x.createLinearGradient(0, gy, 0, h);
      g.addColorStop(0, '#aab7d6'); g.addColorStop(0.22, '#dfe7f6'); g.addColorStop(0.62, '#e9effa'); g.addColorStop(1, '#b4c1de');
      x.fillStyle = g; x.fillRect(0, gy, w, h - gy);
      g = x.createLinearGradient(0, gy, 0, gy + 26);
      g.addColorStop(0, 'rgba(40,52,96,0.4)'); g.addColorStop(1, 'rgba(40,52,96,0)');
      x.fillStyle = g; x.fillRect(0, gy, w, 26);
      const lamps = [cx - 168 * u, cx + 168 * u];
      for (const lx of lamps) {
        x.save(); x.translate(lx, gy + 34); x.scale(1, 0.3);
        g = x.createRadialGradient(0, 0, 0, 0, 0, 150 * u);
        g.addColorStop(0, 'rgba(255,204,138,0.6)'); g.addColorStop(1, 'rgba(255,204,138,0)');
        x.fillStyle = g; x.beginPath(); x.arc(0, 0, 150 * u, 0, TAU); x.fill();
        x.restore();
      }
      for (let i = 0; i < 5000 * (w * (h - gy)) / (390 * 360); i++) {
        x.fillStyle = r() < 0.6 ? 'rgba(255,255,255,0.12)' : 'rgba(58,78,128,0.07)';
        x.fillRect(r() * w, gy + r() * (h - gy), 1 + r() * 1.4, 1 + r());
      }
      /* 나무 · 가로등 */
      const tr = [treeSprite(52, false), treeSprite(77, false)];
      [[cx - 196 * u, 0], [cx + 200 * u, 1]].forEach(([tx, i]) => {
        const th = 250 * u, tw = (th * 280) / 340;
        x.drawImage(tr[i], tx - tw / 2, gy + 10 - th, tw, th);
      });
      for (const lx of lamps) {
        x.strokeStyle = '#171927'; x.lineWidth = 3 * u; x.lineCap = 'round';
        x.beginPath(); x.moveTo(lx, gy + 12); x.lineTo(lx, gy - 128 * u); x.stroke();
        g = x.createRadialGradient(lx, gy - 132 * u, 0, lx, gy - 132 * u, 62 * u);
        g.addColorStop(0, 'rgba(255,226,172,0.95)'); g.addColorStop(0.16, 'rgba(255,202,132,0.5)'); g.addColorStop(1, 'rgba(255,202,132,0)');
        x.fillStyle = g; x.beginPath(); x.arc(lx, gy - 132 * u, 62 * u, 0, TAU); x.fill();
        x.fillStyle = '#fff6df'; x.beginPath(); x.arc(lx, gy - 132 * u, 6 * u, 0, TAU); x.fill();
        x.fillStyle = '#e9effa'; x.beginPath(); x.ellipse(lx, gy - 139 * u, 8 * u, 3.4 * u, 0, 0, TAU); x.fill();
      }
      this.bg = c;

      /* 눈 아래 붉은 벽돌 보도. 쓸면 드러나요 */
      const b = mk(w * dpr, h * dpr), bx = b.getContext('2d');
      bx.scale(dpr, dpr);
      bx.fillStyle = '#2a1614'; bx.fillRect(0, gy, w, h - gy);
      let yy = gy, row = 0;
      while (yy < h) {
        const t = (yy - gy) / (h - gy);
        const bh = 5 + t * 15, bw = bh * 2.5;
        for (let px = -(row % 2) * bw * 0.5 - r() * 2; px < w; px += bw) {
          const tone = r();
          bx.fillStyle = tone < 0.34 ? '#7c3a31' : tone < 0.68 ? '#8f4a3a' : '#6a312c';
          bx.fillRect(px + 1, yy + 1, bw - 2, bh - 2);
        }
        yy += bh; row++;
      }
      g = bx.createLinearGradient(0, gy, 0, h);
      g.addColorStop(0, 'rgba(10,14,40,0.5)'); g.addColorStop(0.5, 'rgba(10,14,40,0.12)'); g.addColorStop(1, 'rgba(10,14,40,0.4)');
      bx.fillStyle = g; bx.fillRect(0, gy, w, h - gy);
      for (const lx of lamps) {
        bx.save(); bx.translate(lx, gy + 34); bx.scale(1, 0.3);
        g = bx.createRadialGradient(0, 0, 0, 0, 0, 150 * u);
        g.addColorStop(0, 'rgba(255,190,120,0.35)'); g.addColorStop(1, 'rgba(255,190,120,0)');
        bx.fillStyle = g; bx.beginPath(); bx.arc(0, 0, 150 * u, 0, TAU); bx.fill();
        bx.restore();
      }
      this.brick = b;
      this.mask = mk(w / 2, h / 2);
      this.tmp = mk(w / 2, h / 2);
      const br = mk(64, 64), brx = br.getContext('2d');
      g = brx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.55, 'rgba(255,255,255,0.85)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      brx.fillStyle = g; brx.fillRect(0, 0, 64, 64);
      this.brush = br;
      this.sweeps = [];
      this.sweeping = false;
      this.swishT = 0;
      this.autoT = 0;
    }
    sweepTo(x, y, sound) {
      const y1 = Math.max(y, this.gy + 16);
      const lp = this.lastSweep;
      const dx = lp ? x - lp.x : 0, dy = lp ? y1 - lp.y : 0;
      const dist = Math.hypot(dx, dy);
      const n = lp ? Math.max(1, Math.ceil(dist / 9)) : 1;
      for (let i = 1; i <= n; i++) {
        const px = lp ? lp.x + (dx * i) / n : x, py = lp ? lp.y + (dy * i) / n : y1;
        this.sweeps.push({ x: px, y: py, age: 0, r: 30 * this.scaleAt(py) });
      }
      if (this.sweeps.length > 520) this.sweeps.splice(0, this.sweeps.length - 520);
      if (dist > 3) {
        const sc = this.scaleAt(y1);
        for (let i = 0; i < 2; i++) {
          this.puffs.push({ x: x + rand(-8, 8), y: y1 + rand(-4, 4), vx: (dx / dist) * rand(60, 150) * sc + rand(-20, 20), vy: (dy / dist) * rand(30, 70) * sc - rand(10, 50), t: 0, dur: rand(0.35, 0.7), r: rand(1.2, 3) * sc });
        }
        if (sound && this.t - this.swishT > 0.17) { this.swishT = this.t; swish((x / this.w - 0.5) * 1.3); }
      }
      this.lastSweep = { x, y: y1 };
    }
    streetPointer(type, x, y) {
      if (type === 'down') { this.start = { x, y }; this.sweeping = false; this.lastSweep = null; }
      if (type === 'move' && this.down && this.start) {
        if (!this.sweeping && Math.hypot(x - this.start.x, y - this.start.y) > 14) { this.sweeping = true; this.sweepTo(this.start.x, this.start.y, false); }
        if (this.sweeping) this.sweepTo(x, y, true);
      }
      if (type === 'up' && this.start) {
        if (!this.sweeping && this.start.y > this.gy + 18) this.addPrint(this.start.x, this.start.y, this.scaleAt(this.start.y), 0.5, true);
        this.start = null;
        this.sweeping = false;
      }
    }
    streetStep(dt) {
      const cover = this.flush ? 1.1 : this.cover * 1.6;
      for (const s of this.sweeps) s.age += dt / cover;
      if (this.sweeps.length && this.sweeps[0].age >= 1) this.sweeps = this.sweeps.filter((s) => s.age < 1);
      if (!this.auto) return;
      if (this.userT !== undefined && this.t - this.userT < 5) { this.moveFinger(0, 0, false); return; }
      this.autoT += dt;
      const { w, h, gy } = this;
      const cyc = this.autoT % 9;
      if (cyc < 6.4) {
        const k = cyc / 6.4;
        const fx = w / 2 + Math.sin(k * Math.PI * 5) * w * 0.33;
        const fy = gy + 64 + k * (h - gy - 250);
        if (cyc < dt * 1.5) this.lastSweep = null;
        this.sweepTo(fx, fy, false);
        this.moveFinger(fx, fy, true);
      } else this.moveFinger(0, 0, false);
    }
    streetDraw(x) {
      const { w, h } = this;
      x.drawImage(this.bg, 0, 0, w, h);
      /* 시곗바늘은 지금 시각 */
      const now = new Date();
      const f = this.face;
      const ha = ((now.getHours() % 12) + now.getMinutes() / 60) / 12 * TAU - Math.PI / 2;
      const ma = (now.getMinutes() / 60) * TAU - Math.PI / 2;
      x.strokeStyle = '#2a2430'; x.lineCap = 'round';
      x.lineWidth = f.r * 0.13; x.beginPath(); x.moveTo(f.x, f.y); x.lineTo(f.x + Math.cos(ha) * f.r * 0.5, f.y + Math.sin(ha) * f.r * 0.5); x.stroke();
      x.lineWidth = f.r * 0.09; x.beginPath(); x.moveTo(f.x, f.y); x.lineTo(f.x + Math.cos(ma) * f.r * 0.76, f.y + Math.sin(ma) * f.r * 0.76); x.stroke();
      /* 쓸어낸 자리 */
      if (this.sweeps.length) {
        const m = this.mask.getContext('2d'), t = this.tmp.getContext('2d');
        const mw = this.mask.width, mh = this.mask.height, kx = mw / w, ky = mh / h;
        m.clearRect(0, 0, mw, mh);
        for (const s of this.sweeps) {
          m.globalAlpha = clamp((1 - s.age) * 1.6, 0, 1) * 0.5;
          const rx = s.r * kx, ry = s.r * 0.5 * ky;
          m.drawImage(this.brush, s.x * kx - rx, s.y * ky - ry, rx * 2, ry * 2);
        }
        m.globalAlpha = 1;
        t.globalCompositeOperation = 'source-over';
        t.clearRect(0, 0, mw, mh);
        t.drawImage(this.mask, 0, 0);
        t.globalCompositeOperation = 'source-in';
        t.drawImage(this.brick, 0, 0, mw, mh);
        x.globalAlpha = 0.5;
        x.drawImage(this.mask, 0, -3, w, h);
        x.globalAlpha = 1;
        x.drawImage(this.tmp, 0, 0, w, h);
      }
      for (const p of this.prints) drawPrint(x, p);
      this.drawPuffs();
      this.drawFlakes();
    }
  }

  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__snow.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-snow]').forEach((c) => {
      const sc = new Snow(c);
      c.__snow = sc;
      scenes.push(sc);
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
      const b = e.target.closest('[data-snow-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-snow]');
      if (c && c.__snow) c.__snow.action(b.dataset.snowAct, b.dataset.value);
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
