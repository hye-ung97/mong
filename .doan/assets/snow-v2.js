/* mong — 눈멍 v2 시안용 장면 (Doan 보드 전용). 코드(src/scenes)에는 아직 없어요.
   <canvas data-snow2> 하나가 장면 하나.
     data-view="tree"     A안 · 비에이 언덕의 나무 한 그루. 누르면 발자국, 끌면 걸어가요. 나무를 누르면 가지의 눈이 떨어져요
     data-view="globe"    B안 · 스노우글로브. 끌어서 흔들면 눈이 날렸다가 천천히 가라앉아요
     data-view="onsen"    C안 · 눈 내리는 노천탕. 물을 누르면 물결, 끌면 손으로 저어요
     data-view="crystal"  D안 · 장갑 위 눈 결정. 장갑을 누르면 눈송이를 받아 결정이 크게 보여요
     data-sky="dusk"      (tree) dusk 해 질 녘 · moon 달밤 · dawn 푸른 새벽 · now 지금 시각 따라 (skyAt, 앱 기본값)
     data-tree="oak"      (tree) oak 잎 진 나무 · spruce 가문비나무
     data-fall="0.6"      눈 세기 0.3 가루눈 · 0.6 눈 · 1 함박눈
     data-trail="6"       (tree) 처음부터 발자국이 이만큼 찍힌 채로 시작
     data-auto="walk"     손가락이 저절로 움직여요 (설명용). tree: walk 걸어가기 · shake 나무 털기. 나머지 장면은 값 없이
     data-cover="14"      발자국이 새 눈에 덮이는 시간(초) (설명용. 없으면 눈 세기를 따라요)
     data-card            홈 카드용으로 작게 그려요
   같은 .screen 안의 [data-snow2-act] 버튼이 장면을 조작해요.
   소리는 시안용 합성음이에요. 기차 · 바람처럼 저절로 나는 소리는 마지막으로 누른 화면에서만 나요. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (x) => x * x * (3 - 2 * x);
  const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };

  const FALLS = [
    { v: 0.3, label: '가루눈', n: 60, cover: 150 },
    { v: 0.6, label: '눈', n: 130, cover: 80 },
    { v: 1, label: '함박눈', n: 240, cover: 40 },
  ];
  const fallOf = (v) => FALLS.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));

  /* 지금 시각(0~23시) → 비에이 하늘. data-sky="now" 일 때 써요.
     한낮의 하얀 눈벌판은 너무 밝아서 글자가 안 읽혀요. 낮에는 해 질 녘 하늘을 그대로 써요. */
  function skyAt(hour) {
    if (hour >= 5 && hour < 8) return 'dawn';
    if (hour >= 8 && hour < 19) return 'dusk';
    return 'moon';
  }

  /* 비에이 하늘 세 가지. 'r,g,b' 문자열은 투명도를 붙여 쓰는 색이에요 */
  const SKIES = {
    dusk: {
      sky: [[0, '#151b45'], [0.4, '#40407e'], [0.68, '#9579b0'], [0.86, '#efa9b7'], [1, '#ffd0b0']],
      glow: [0.26, 'rgba(255,196,176,0.55)'],
      stars: 0, moon: false,
      mount: '#9089bd', mountTop: '242,214,230', mist: '238,204,224',
      far: ['#c3b0d8', '#d6c2e0'], mid: ['#cdb8de', '#e3cee6'], line: '112,88,152',
      field: ['#f3e2f1', '#d6c1e3', '#a490c4'], light: 'rgba(255,222,230,0.4)', shade: 'rgba(70,52,116,0.24)', lightFrom: 0,
      rim: 'rgba(255,238,244,0.95)',
      trunk: '#2c2240', snow: '#fbeaf2',
      ps: '96,72,140', pd: '44,26,78', pc: '120,92,156',
      flake: '#fff6fa', fog: '226,196,222', train: '#2b2440', win: '#ffd9a6',
    },
    moon: {
      sky: [[0, '#03061a'], [0.5, '#0a1434'], [0.84, '#1b2852'], [1, '#2c3a68']],
      glow: [0.78, 'rgba(130,150,210,0.16)'],
      stars: 150, moon: true,
      mount: '#27325c', mountTop: '162,178,218', mist: '84,104,156',
      far: ['#5a6ca2', '#6a7cb2'], mid: ['#7083b8', '#8697c8'], line: '24,32,72',
      field: ['#c6d3f0', '#9eaed8', '#6b7cb0'], light: 'rgba(220,232,255,0.3)', shade: 'rgba(14,22,56,0.32)', lightFrom: 0,
      rim: 'rgba(236,244,255,0.85)',
      trunk: '#0c0f24', snow: '#e2eafc',
      ps: '40,56,106', pd: '14,20,54', pc: '62,78,128',
      flake: '#ffffff', fog: '110,130,180', train: '#101426', win: '#ffd28e',
    },
    dawn: {
      sky: [[0, '#0b1544'], [0.45, '#22377a'], [0.78, '#4c66a8'], [0.93, '#9aaad2'], [1, '#f2c6a6']],
      glow: [0.8, 'rgba(255,204,176,0.34)'],
      stars: 40, moon: false,
      mount: '#3d5292', mountTop: '184,198,234', mist: '150,170,215',
      far: ['#6e85c0', '#8095cb'], mid: ['#8399ce', '#9bafdb'], line: '34,50,104',
      field: ['#c4d2f2', '#9db1e0', '#6c84c0'], light: 'rgba(255,226,210,0.24)', shade: 'rgba(20,34,90,0.28)', lightFrom: 1,
      rim: 'rgba(244,240,250,0.9)',
      trunk: '#121a40', snow: '#d6e0f7',
      ps: '44,62,120', pd: '18,28,70', pc: '66,84,140',
      flake: '#ffffff', fog: '150,170,215', train: '#141c3c', win: '#ffd6a0',
    },
  };

  /* 눈 결정 네 가지. 온도는 나카야 다이어그램을 아주 단순하게 줄인 값이에요 */
  const KINDS = {
    dendrite: { label: '나뭇가지 모양', temp: '-15℃ 안팎' },
    stellar: { label: '별 모양', temp: '-13℃ 안팎' },
    sector: { label: '부채 모양', temp: '-17℃ 안팎' },
    plate: { label: '육각판', temp: '-20℃ 안팎' },
  };

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
  function grad(x, x0, y0, x1, y1, stops) {
    const g = x.createLinearGradient(x0, y0, x1, y1);
    for (const [o, c] of stops) g.addColorStop(o, c);
    return g;
  }
  function softSprite(rgb) {
    const c = mk(128, 128), x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, `rgba(${rgb},1)`); g.addColorStop(0.45, `rgba(${rgb},0.55)`); g.addColorStop(1, `rgba(${rgb},0)`);
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    return c;
  }
  function hex(x, r) {
    x.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i * TAU) / 6;
      if (i) x.lineTo(Math.cos(a) * r, Math.sin(a) * r); else x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    x.closePath();
  }

  /* ---------- 소리 (시안용 합성) ---------- */
  let ac = null;
  let active = null; /* 마지막으로 누른 장면. 저절로 나는 소리는 이 장면에서만 */
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
  function noise(a, sec) {
    const n = Math.max(1, Math.floor(a.sampleRate * sec));
    const b = a.createBuffer(1, n, a.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  /* 뽀드득 (snow.js 와 같은 합성) */
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
  }
  /* 푸스스: 가지에 쌓인 눈이 쏟아지고, 눈덩이가 툭툭 떨어져요 */
  function poof(pan) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime;
    const src = a.createBufferSource(); src.buffer = noise(a, 1.4);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2600, t0); lp.frequency.exponentialRampToValueAtTime(420, t0 + 1.2);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.3);
    src.connect(lp); lp.connect(g); out(a, g, pan); src.start(t0);
    for (let i = 0; i < 3; i++) {
      const o = a.createOscillator(), og = a.createGain(), ts = t0 + 0.32 + i * rand(0.12, 0.26);
      o.frequency.setValueAtTime(rand(70, 96), ts); o.frequency.exponentialRampToValueAtTime(40, ts + 0.12);
      og.gain.setValueAtTime(0.0001, ts); og.gain.exponentialRampToValueAtTime(0.12, ts + 0.01); og.gain.exponentialRampToValueAtTime(0.001, ts + 0.16);
      o.connect(og); out(a, og, pan + rand(-0.2, 0.2)); o.start(ts); o.stop(ts + 0.2);
    }
  }
  /* 찰랑: 글로브 속 물 */
  function slosh(pan, mag) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime;
    const src = a.createBufferSource(); src.buffer = noise(a, 0.5);
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.4;
    bp.frequency.setValueAtTime(rand(520, 820), t0); bp.frequency.exponentialRampToValueAtTime(rand(240, 340), t0 + 0.42);
    const g = a.createGain(), v = clamp(mag / 20, 0.2, 1) * 0.34;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(v, t0 + 0.06); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.46);
    src.connect(bp); bp.connect(g); out(a, g, pan); src.start(t0);
  }
  /* 퐁: 물을 건드릴 때 */
  function plop(pan, big) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime;
    const o = a.createOscillator(), og = a.createGain();
    o.frequency.setValueAtTime(big ? 340 : 640, t0); o.frequency.exponentialRampToValueAtTime(big ? 880 : 1300, t0 + 0.07);
    og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(big ? 0.16 : 0.08, t0 + 0.008); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
    o.connect(og); out(a, og, pan); o.start(t0); o.stop(t0 + 0.15);
    const src = a.createBufferSource(); src.buffer = noise(a, 0.35);
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1300;
    const g = a.createGain(); g.gain.setValueAtTime(big ? 0.12 : 0.05, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.32);
    src.connect(lp); lp.connect(g); out(a, g, pan); src.start(t0);
  }
  /* 팅: 눈 결정을 받을 때 */
  function ting(pan) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime;
    [2637, 3520, 5274].forEach((f, i) => {
      const o = a.createOscillator(), g = a.createGain();
      o.frequency.value = f * rand(0.99, 1.01);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.05 / (i + 1), t0 + 0.005); g.gain.exponentialRampToValueAtTime(0.0005, t0 + 1.5 - i * 0.35);
      o.connect(g); out(a, g, pan); o.start(t0); o.stop(t0 + 1.6);
    });
  }
  /* 먼 기차: 덜컹덜컹 하며 왼쪽에서 오른쪽(또는 반대)으로 지나가요 */
  function rumble(dur, dir) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime, sr = a.sampleRate;
    const buf = noise(a, dur), d = buf.getChannelData(0);
    for (let tt = 0.3, i = 0; tt < dur; tt += i % 2 ? 0.22 : 0.62, i++) {
      const i0 = Math.floor(tt * sr);
      for (let j = 0; j < sr * 0.03 && i0 + j < d.length; j++) d[i0 + j] += (Math.random() * 2 - 1) * 3 * Math.exp(-j / (sr * 0.006));
    }
    const src = a.createBufferSource(); src.buffer = buf;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 240;
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.16, t0 + dur * 0.5); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    src.connect(lp); lp.connect(g);
    if (a.createStereoPanner) {
      const p = a.createStereoPanner();
      p.pan.setValueAtTime(-0.8 * dir, t0); p.pan.linearRampToValueAtTime(0.8 * dir, t0 + dur);
      g.connect(p); p.connect(a.destination);
    } else g.connect(a.destination);
    src.start(t0); src.stop(t0 + dur);
  }
  /* 바람 한 줄기: 들판을 쓸고 지나가요 */
  function whoosh(dur) {
    const a = audio();
    if (!a) return;
    const t0 = a.currentTime;
    const src = a.createBufferSource(); src.buffer = noise(a, dur);
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.7;
    bp.frequency.setValueAtTime(380, t0); bp.frequency.linearRampToValueAtTime(980, t0 + dur * 0.5); bp.frequency.linearRampToValueAtTime(360, t0 + dur);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(0.12, t0 + dur * 0.45); g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp); bp.connect(g); out(a, g, -0.2); src.start(t0); src.stop(t0 + dur);
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

  /* 잎 진 나무 한 그루. 가지(bare)와 가지 위 눈(snow)을 따로 그려서, 털면 눈만 옅어져요.
     pts 는 눈이 얹힌 자리 (털면 여기서 눈이 떨어져요) */
  function oakSprite(seed, P) {
    const W = 360, H = 340, S = 2;
    const bare = mk(W * S, H * S), snow = mk(W * S, H * S);
    const bx = bare.getContext('2d'), sx = snow.getContext('2d');
    bx.scale(S, S); sx.scale(S, S);
    bx.lineCap = sx.lineCap = 'round';
    bx.strokeStyle = P.trunk; sx.strokeStyle = P.snow;
    const r = rng(seed);
    const pts = [];
    const cx = W / 2;
    const crown = { x: cx, y: H * 0.43, rx: W * 0.49, ry: H * 0.41 };
    const seg = (px, py, ang, len, wd, depth) => {
      let ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
      const ox = (ex - crown.x) / crown.rx, oy = (ey - crown.y) / crown.ry;
      if (ox * ox + oy * oy > 1.12 && depth < 6) {
        ang += (-Math.PI / 2 - ang) * 0.3;
        len *= 0.62;
        ex = px + Math.cos(ang) * len; ey = py + Math.sin(ang) * len;
      }
      const bend = (r() - 0.5) * len * 0.14;
      const mx = (px + ex) / 2 + Math.sin(ang) * bend, my = (py + ey) / 2 - Math.cos(ang) * bend;
      bx.lineWidth = wd;
      bx.beginPath(); bx.moveTo(px, py); bx.quadraticCurveTo(mx, my, ex, ey); bx.stroke();
      const flat = Math.abs(Math.cos(ang));
      if (flat > 0.28 && wd > 0.7) {
        const off = wd * 0.45;
        sx.lineWidth = Math.max(0.8, wd * (0.32 + flat * 0.3));
        sx.beginPath(); sx.moveTo(px, py - off); sx.quadraticCurveTo(mx, my - off, ex, ey - off); sx.stroke();
        if (depth <= 4) pts.push([(px + ex) / 2, (py + ey) / 2 - off]);
      }
      if (depth <= 0) return;
      const k = depth >= 5 ? 2 + (r() < 0.5 ? 1 : 0) : r() < 0.6 ? 2 : 3;
      for (let i = 0; i < k; i++) {
        let a = ang + (i - (k - 1) / 2) * (0.42 + r() * 0.3) + (r() - 0.5) * 0.35;
        a += (-Math.PI / 2 - a) * 0.08;
        seg(ex, ey, a, len * (0.7 + r() * 0.12), Math.max(0.5, wd * 0.64), depth - 1);
      }
    };
    /* 줄기: 밑동이 넓게 퍼져요 */
    const trunkTop = H * 0.7;
    bx.fillStyle = P.trunk;
    bx.beginPath();
    bx.moveTo(cx - 10, H);
    bx.quadraticCurveTo(cx - 5, H * 0.86, cx - 4.6, trunkTop);
    bx.lineTo(cx + 4.6, trunkTop);
    bx.quadraticCurveTo(cx + 6, H * 0.86, cx + 11, H);
    bx.closePath(); bx.fill();
    /* 큰 가지 넷이 옆으로 넓게 퍼져서 둥근 우산 모양이 돼요 */
    [-Math.PI / 2 - 0.86, -Math.PI / 2 - 0.3, -Math.PI / 2 + 0.24, -Math.PI / 2 + 0.8].forEach((a, i) => {
      seg(cx + (i - 1.5) * 1.8, trunkTop + 2, a + (r() - 0.5) * 0.12, H * (0.17 + r() * 0.04), 6.5, 6);
    });
    return { bare, snow, pts, W, H, crownY: crown.y / H };
  }

  /* 가문비나무 (크리스마스트리 모양). 처진 가지마다 눈이 울퉁불퉁 두툼하게 얹혀요 */
  function spruceSprite(seed, P) {
    const W = 240, H = 360, S = 2;
    const bare = mk(W * S, H * S), snow = mk(W * S, H * S);
    const bx = bare.getContext('2d'), sx = snow.getContext('2d');
    bx.scale(S, S); sx.scale(S, S);
    const r = rng(seed);
    const pts = [];
    const cx = W / 2, top = 6, bot = H * 0.84;
    bx.fillStyle = P.trunk;
    bx.fillRect(cx - 4.5, bot - 10, 9, H - bot + 10);
    const N = 12, tiers = [];
    for (let i = 0; i < N; i++) {
      const t = (i + 1) / N;
      tiers.push({ y: top + t * (bot - top), hw: W * 0.44 * Math.pow(t, 0.95) * (0.86 + r() * 0.24) + 5 });
    }
    /* 몸통: 층마다 가지 끝이 삐죽 나온 원뿔 */
    bx.beginPath(); bx.moveTo(cx, top);
    tiers.forEach((tr, i) => {
      const py = i ? tiers[i - 1].y : top;
      bx.lineTo(cx - tr.hw * 0.5, (py + tr.y) / 2 + 3);
      bx.lineTo(cx - tr.hw * 0.8, tr.y);
      bx.lineTo(cx - tr.hw, tr.y + 6);
    });
    bx.lineTo(cx, bot + 4);
    for (let i = N - 1; i >= 0; i--) {
      const tr = tiers[i], py = i ? tiers[i - 1].y : top;
      bx.lineTo(cx + tr.hw, tr.y + 6);
      bx.lineTo(cx + tr.hw * 0.8, tr.y);
      bx.lineTo(cx + tr.hw * 0.5, (py + tr.y) / 2 + 3);
    }
    bx.closePath(); bx.fill();
    /* 눈: 줄기 가까이에서 가지 끝까지 처지며 이어지는 덩어리들. 군데군데 비어요 */
    sx.fillStyle = P.snow;
    sx.beginPath(); sx.ellipse(cx, top + 6, 4, 5, 0, 0, TAU); sx.fill();
    tiers.forEach((tr, i) => {
      const py = i ? tiers[i - 1].y : top;
      const y0 = (py + tr.y) / 2 + 1, y1 = tr.y + 3;
      for (const side of [-1, 1]) {
        for (let s = 0.08; s <= 1; s += 0.07 + r() * 0.05) {
          if (r() < 0.14) continue;
          const ex = cx + side * (0.12 + 0.86 * s) * tr.hw, ey = y0 + (y1 - y0) * Math.pow(s, 1.3) - 1.5;
          const rx = (2.6 + 4.2 * (1 - s * 0.6)) * (0.7 + r() * 0.6) * (0.6 + tr.hw / (W * 0.44) * 0.6);
          sx.beginPath(); sx.ellipse(ex, ey, rx, rx * 0.55, side * 0.25 * s, 0, TAU); sx.fill();
          if (r() < 0.4) pts.push([ex, ey]);
        }
      }
    });
    return { bare, snow, pts, W, H, crownY: 0.5 };
  }

  function solePath(x) {
    x.beginPath();
    rr(x, -11, -27, 22, 33, 11);
    rr(x, -9, 9, 18, 17, 8);
  }
  /* 발자국. p.sq 는 비스듬히 본 바닥에서 위아래로 눌린 정도, P 는 하늘마다 다른 그늘 색 */
  function drawPrint(x, p, P) {
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
    x.fillStyle = `rgba(255,255,255,${0.6 * a * k})`;
    x.fill();
    x.restore();
    place(0);
    solePath(x);
    x.fillStyle = `rgba(${P.ps},${0.6 * a * k})`;
    x.fill();
    x.clip();
    x.strokeStyle = `rgba(255,255,255,${0.15 * a * k})`;
    x.lineWidth = 1.7;
    x.beginPath();
    for (let y = -23; y <= 24; y += 5) { x.moveTo(-12, y); x.lineTo(12, y - 2); }
    x.stroke();
    x.fillStyle = `rgba(${P.pd},${0.3 * a * k})`;
    x.fillRect(-12, -29, 24, 7);
    x.fillRect(-12, 8, 24, 5);
    x.restore();
    for (const c of p.cr) {
      x.fillStyle = `rgba(${P.pc},${0.3 * a * k})`;
      x.beginPath(); x.arc(p.x + c[0], p.y + c[1] * p.sq + 1.4, c[2], 0, TAU); x.fill();
      x.fillStyle = `rgba(255,255,255,${0.88 * a * k})`;
      x.beginPath(); x.arc(p.x + c[0], p.y + c[1] * p.sq, c[2], 0, TAU); x.fill();
    }
  }

  /* 눈 결정 하나의 생김새 (팔 길이 1 기준) */
  function pickKind(v) {
    const wts = v <= 0.3
      ? [['plate', 4], ['sector', 3], ['stellar', 2], ['dendrite', 1]]
      : v >= 1
        ? [['dendrite', 6], ['stellar', 2], ['sector', 1], ['plate', 1]]
        : [['dendrite', 3], ['stellar', 3], ['sector', 2], ['plate', 2]];
    let s = Math.random() * wts.reduce((a, b) => a + b[1], 0);
    for (const [id, wt] of wts) { s -= wt; if (s < 0) return id; }
    return 'stellar';
  }
  function makeCrystal(kind, r) {
    const c = { kind, core: 0.12, arm: 1, side: [], tip: 0, fan: null, inner: 0 };
    if (kind === 'plate') {
      c.core = 0.9; c.inner = 0.5 + r() * 0.15; c.arm = 0;
    } else if (kind === 'sector') {
      c.core = 0.24 + r() * 0.08;
      c.fan = { w0: 0.06, w1: 0.2 + r() * 0.08 };
    } else if (kind === 'stellar') {
      c.core = 0.16 + r() * 0.06;
      const n = 2 + (r() < 0.5 ? 1 : 0);
      for (let i = 0; i < n; i++) c.side.push([0.38 + i * 0.2 + r() * 0.06, 0.16 + r() * 0.12, false]);
      c.tip = 0.08 + r() * 0.04;
    } else {
      const n = 7 + Math.floor(r() * 4);
      for (let i = 0; i < n; i++) {
        const s = 0.2 + (i / n) * 0.74 + r() * 0.03;
        c.side.push([s, (0.1 + 0.28 * Math.sin(Math.PI * Math.min(1, s * 1.05))) * (0.65 + r() * 0.5), r() < 0.55]);
      }
    }
    return c;
  }
  /* g 자라는 정도 0~1, m 녹는 정도 0~1 */
  function drawCrystal(x, px, py, S, c, g, m, rot, t) {
    const sz = S * (1 - 0.5 * m);
    const al = 1 - m;
    if (al > 0.02) {
      x.save();
      x.translate(px, py);
      x.rotate(rot);
      x.lineCap = 'round'; x.lineJoin = 'round';
      x.shadowColor = 'rgba(160,200,255,0.9)'; x.shadowBlur = 10;
      const edge = `rgba(238,247,255,${al})`, fill = `rgba(200,224,255,${0.17 * al})`, ridge = `rgba(150,190,240,${0.55 * al})`;
      const G = Math.min(1, g * 1.1);
      const core = c.core * sz * Math.min(1, g * (c.kind === 'plate' ? 1.1 : 2.2));
      hex(x, core); x.fillStyle = fill; x.fill(); x.strokeStyle = edge; x.lineWidth = Math.max(1, sz * 0.02); x.stroke();
      if (c.inner) { hex(x, core * c.inner); x.strokeStyle = ridge; x.lineWidth = 1; x.stroke(); }
      for (let i = 0; i < 6; i++) {
        x.save();
        x.rotate((i * TAU) / 6);
        if (c.kind === 'plate') {
          x.strokeStyle = ridge; x.lineWidth = 0.9;
          x.beginPath(); x.moveTo(core * c.inner, 0); x.lineTo(core * 0.97, 0); x.stroke();
          x.restore();
          continue;
        }
        const L = c.arm * sz * G;
        if (c.fan && L > core) {
          const w0 = c.fan.w0 * sz, w1 = c.fan.w1 * sz * (L / sz);
          x.beginPath(); x.moveTo(core * 0.9, -w0); x.lineTo(L, -w1); x.lineTo(L + w1 * 0.45, 0); x.lineTo(L, w1); x.lineTo(core * 0.9, w0); x.closePath();
          x.fillStyle = fill; x.fill(); x.strokeStyle = edge; x.lineWidth = Math.max(1, sz * 0.016); x.stroke();
          x.strokeStyle = ridge; x.lineWidth = 0.8;
          x.beginPath();
          for (let j = 1; j < 4; j++) {
            const s = core + ((L - core) * j) / 4, wj = w0 + ((w1 - w0) * j) / 4;
            x.moveTo(s, -wj * 0.9); x.lineTo(s + (L - core) * 0.12, 0); x.lineTo(s, wj * 0.9);
          }
          x.stroke();
        }
        x.strokeStyle = edge; x.lineWidth = Math.max(1.2, sz * 0.034);
        x.beginPath(); x.moveTo(core * 0.8, 0); x.lineTo(L, 0); x.stroke();
        for (const sd of c.side) {
          const s = sd[0] * sz;
          if (s > L) continue;
          const len = sd[1] * sz * clamp((L - s) / (0.3 * sz), 0, 1);
          const dx = Math.cos(Math.PI / 3) * len, dy = Math.sin(Math.PI / 3) * len;
          x.lineWidth = Math.max(0.8, sz * 0.022);
          x.beginPath(); x.moveTo(s, 0); x.lineTo(s + dx, -dy); x.moveTo(s, 0); x.lineTo(s + dx, dy); x.stroke();
          if (sd[2] && len > sz * 0.12) {
            x.lineWidth = Math.max(0.6, sz * 0.012);
            x.beginPath();
            for (const q of [0.45, 0.75]) {
              const qx = s + dx * q, qy = dy * q, ql = len * 0.28;
              x.moveTo(qx, -qy); x.lineTo(qx + ql, -qy); x.moveTo(qx, qy); x.lineTo(qx + ql, qy);
            }
            x.stroke();
          }
        }
        if (c.tip && L > sz * 0.9) {
          x.save(); x.translate(L, 0); hex(x, c.tip * sz); x.fillStyle = fill; x.fill(); x.strokeStyle = edge; x.lineWidth = 1; x.stroke(); x.restore();
        }
        x.shadowBlur = 0;
        x.strokeStyle = ridge; x.lineWidth = 0.8;
        x.beginPath(); x.moveTo(0, 0); x.lineTo(L * 0.96, 0); x.stroke();
        x.shadowBlur = 10;
        x.restore();
      }
      /* 반짝 */
      if (g >= 1 && m < 0.3) {
        x.shadowBlur = 0;
        for (let i = 0; i < 2; i++) {
          const a = Math.pow(Math.max(0, Math.sin(t * 2.2 + i * 2.4)), 6) * al;
          if (a < 0.05) continue;
          const an = (i * 3 + 1) * (TAU / 6), d = sz * (c.kind === 'plate' ? 0.82 : 0.96);
          const gx = Math.cos(an) * d, gy = Math.sin(an) * d, gl = 7 + 5 * a;
          x.strokeStyle = `rgba(255,255,255,${a})`; x.lineWidth = 1.2;
          x.beginPath(); x.moveTo(gx - gl, gy); x.lineTo(gx + gl, gy); x.moveTo(gx, gy - gl); x.lineTo(gx, gy + gl); x.stroke();
        }
      }
      x.restore();
    }
    if (m > 0) {
      const da = m < 0.6 ? m / 0.6 : 1 - (m - 0.6) / 0.4;
      const dr = S * 0.1 * (0.4 + m * 0.6);
      x.fillStyle = `rgba(180,210,250,${0.24 * da})`;
      x.beginPath(); x.arc(px, py, dr, 0, TAU); x.fill();
      x.strokeStyle = `rgba(230,242,255,${0.55 * da})`; x.lineWidth = 1;
      x.stroke();
      x.fillStyle = `rgba(255,255,255,${0.8 * da})`;
      x.beginPath(); x.arc(px - dr * 0.35, py - dr * 0.35, dr * 0.22, 0, TAU); x.fill();
    }
  }

  class Snow2 {
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
      this.view = d.view || 'tree';
      this.card = d.card !== undefined;
      this.wide = this.w > 600;
      this.fall = fallOf(Number(d.fall) || 0.6);
      this.coverFixed = d.cover !== undefined ? Number(d.cover) : 0;
      this.auto = d.auto !== undefined ? d.auto || 'on' : '';
      this.finger = this.screen ? this.screen.querySelector('[data-snow2-finger]') : null;
      this.t = 0;
      this.steps = 0;
      this.count = 0;
      this.side = 1;
      this.prints = [];
      this.puffs = [];
      this.last = null;
      this.down = false;
      this.flush = false;
      this.wind = 0;
      this.autoT = 0;
      this.k = 1;
      this.vig = vignette(this.w, this.h, this.dpr, this.card ? 0.4 : 0.55);
      this[`${this.view}Init`]();
      this.flakes = [];
      this.fillFlakes();
      const trail = Number(d.trail) || 0;
      if (trail && this.view === 'tree') this.seedTrail(trail);
      this.sync();
    }

    get cover() { return this.coverFixed || this.fall.cover; }
    ambient() { return active === this && ac && ac.state === 'running'; }

    fillFlakes() {
      const per = { tree: 1, onsen: 0.9, crystal: 0.55, globe: 0 }[this.view];
      const want = Math.round(this.fall.n * per * (this.w * this.h) / (390 * 844));
      while (this.flakes.length < want) this.flakes.push(this.newFlake(true));
      this.flakes.length = want;
    }
    newFlake(anywhere) {
      const { w, h } = this;
      const z = Math.pow(Math.random(), 1.6) * 0.85 + 0.15;
      const f = { x: rand(-20, w + 20), y: anywhere ? rand(-10, h) : -10, z, ph: rand(0, TAU) };
      if (this.view === 'onsen') f.land = this.wt + Math.pow(z, 1.25) * (this.wb - this.wt) * 1.08;
      if (this.view === 'crystal' && z > 0.5) f.land = rand(h * 0.34, h - 40);
      if (f.land !== undefined && anywhere && f.y > f.land) f.y = rand(-10, f.land);
      return f;
    }

    sync() {
      const sc = this.screen;
      if (!sc) return;
      sc.querySelectorAll('[data-snow2-act="fall"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === this.fall.v));
      sc.querySelectorAll('[data-snow2-act="sky"]').forEach((b) => b.classList.toggle('on', b.dataset.value === (this.canvas.dataset.sky || 'now')));
      sc.querySelectorAll('[data-snow2-act="lamp"]').forEach((b) => b.classList.toggle('on', !!this.lampOn));
      sc.querySelectorAll('[data-stat="fall"]').forEach((e) => { e.textContent = this.fall.label; });
      sc.querySelectorAll('[data-stat="steps"]').forEach((e) => { e.textContent = `${this.steps}걸음`; });
      sc.querySelectorAll('[data-stat="count"]').forEach((e) => { e.textContent = this.view === 'globe' ? `${this.count}번` : `${this.count}개`; });
    }
    action(name, value) {
      if (name === 'fall') { this.fall = fallOf(Number(value)); this.fillFlakes(); if (this.view === 'globe') this.globeFill(); }
      if (name === 'fresh') { this.flush = true; this.load = 1; }
      if (name === 'shake') this.globeShake(1, true);
      if (name === 'lamp') this.lampOn = !this.lampOn;
      /* 설정 시트의 하늘 고르기 · now 지금 시각 따라 · dusk · moon · dawn 고정 */
      if (name === 'sky' && this.view === 'tree') { this.canvas.dataset.sky = value; this.treeInit(); }
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
        this.puffs.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * (up ? 0.5 : 1) - (up ? rand(20, 60) * spread : 0), t: 0, dur: rand(0.35, 0.7), r: rand(1.2, 3) * Math.max(0.5, spread) });
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
      this.prints.push({ x: px, y: py, ang, life: 0, age: 0, sc, sq, cr });
      if (this.prints.length > 70) this.prints.shift();
      this.last = { x, y, ang, t: this.t };
      this.steps++;
      this.puff(px, py, 9, sc, false);
      if (sound) crunch((x / this.w - 0.5) * 1.3);
      this.sync();
    }

    pointer(type, x, y) {
      if (type === 'down') { this.down = true; this.userT = this.t; active = this; }
      if (type === 'up') this.down = false;
      this[`${this.view}Pointer`](type, x, y);
    }
    autoPaused() {
      if (this.userT !== undefined && this.t - this.userT < 5) { this.moveFinger(0, 0, false); return true; }
      return false;
    }

    step(dt) {
      this.t += dt;
      const cover = this.flush ? 1.1 : this.cover;
      for (const p of this.prints) { p.life += dt; p.age += dt / cover; }
      this.prints = this.prints.filter((p) => p.age < 1);
      if (this.flush && !this.prints.length) this.flush = false;
      for (const p of this.puffs) { p.t += dt / p.dur; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.94; p.vy = p.vy * 0.94 + 60 * dt; }
      this.puffs = this.puffs.filter((p) => p.t < 1);
      const { w, h } = this;
      const sp = (0.6 + this.fall.v * 0.7) * (this.view === 'crystal' ? 0.55 : 1);
      for (const f of this.flakes) {
        f.y += (26 + f.z * 80) * sp * dt;
        f.x += (Math.sin(this.t * (0.6 + f.z) + f.ph) * 14 - 10 * f.z + this.wind * (90 + 150 * f.z)) * dt;
        if (f.land !== undefined && f.y >= f.land) { this.land(f); Object.assign(f, this.newFlake(false)); continue; }
        if (f.y > h + 6) Object.assign(f, this.newFlake(false));
        if (f.x < -24) f.x = w + 20;
        if (f.x > w + 24) f.x = -20;
      }
      this[`${this.view}Step`](dt);
    }
    land(f) {
      if (this.view === 'onsen' && f.land < this.wb - 2) this.ripple(f.x, f.land, 0.01 + f.z * 0.03, 0.4);
      if (this.view === 'crystal' && this.hit.isPointInPath(this.mitt, f.x, f.land)) {
        this.landed.push({ x: f.x, y: f.land, r: 1.6 + f.z * 2.6, rot: rand(0, TAU), t: 0, dur: rand(8, 16) });
        if (this.landed.length > 90) this.landed.shift();
      }
    }
    drawFlakes() {
      const x = this.ctx;
      x.fillStyle = (this.pal && this.pal.flake) || '#fff';
      const big = this.view === 'crystal' ? 1.35 : 1;
      for (const f of this.flakes) {
        x.globalAlpha = 0.3 + f.z * 0.65;
        x.beginPath(); x.arc(f.x, f.y, (0.6 + f.z * 2.3) * big * (this.card ? 0.7 : 1), 0, TAU); x.fill();
      }
      x.globalAlpha = 1;
    }
    drawPuffs() {
      const x = this.ctx;
      x.fillStyle = '#fff';
      for (const p of this.puffs) {
        x.globalAlpha = (1 - p.t) * 0.85;
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

    /* ================= A안 · 비에이 언덕의 나무 한 그루 ================= */
    treeInit() {
      const { w, h, dpr, card, wide } = this;
      const d = this.canvas.dataset;
      const key = !d.sky || d.sky === 'now' ? skyAt(new Date().getHours()) : d.sky;
      const P = (this.pal = SKIES[key] || SKIES.dusk);
      const k = (this.k = card ? 0.5 : wide ? 1.1 : 1);
      /* 나무는 화면 가운데보다 조금 오른쪽. 넓은 화면은 땅을 조금 내려서 나무가 탭 · 장면 전환 아래에 들어가요 */
      const ty = Math.round(h * (card ? 0.66 : wide ? 0.6 : 0.585));
      const tx = (this.tx = Math.round(card ? w * 0.7 : w * (wide ? 0.63 : 0.6)));
      const G = card ? h * 0.12 : h * 0.075; /* 지평선에서 나무 밑동까지 */
      const hz = (this.hz = ty - G);
      const D = card ? h * 0.1 : h * 0.085, S = w * (card ? 0.55 : wide ? 0.36 : 0.44);
      const crest = (this.crest = (xx) => ty + D * (1 - Math.exp(-(((xx - tx) / S) ** 2))) + 3 * k * Math.sin(xx * 0.013 + 1));
      const tb = (this.tb = crest(tx));
      this.trainY = hz + G * 0.72;
      this.treeKind = d.tree === 'spruce' ? 'spruce' : 'oak';
      const spr = (this.spr = this.treeKind === 'spruce' ? spruceSprite(7, P) : oakSprite(3, P));
      this.TH = (card ? h * 0.56 : wide ? 330 : clamp(258 * (w / 390), 220, 300)) * (this.treeKind === 'spruce' ? 0.92 : 1);
      this.TW = (this.TH * spr.W) / spr.H;
      const r = rng(23);

      /* ---- 먼 곳: 하늘, 산줄기, 언덕 두 겹 ---- */
      const far = mk(w * dpr, h * dpr), x = far.getContext('2d');
      x.scale(dpr, dpr);
      x.fillStyle = grad(x, 0, 0, 0, hz + G * 0.6, P.sky);
      x.fillRect(0, 0, w, h);
      let g = x.createRadialGradient(w * P.glow[0], hz, 0, w * P.glow[0], hz, Math.max(w, h) * 0.75);
      g.addColorStop(0, P.glow[1]); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, hz + G);
      const ns = Math.round((P.stars * (w * hz)) / (390 * 430));
      for (let i = 0; i < ns; i++) {
        const sx = r() * w, sy = r() * (hz - 30 * k), b = r();
        x.fillStyle = `rgba(255,255,255,${(0.25 + b * 0.6) * (1 - (sy / hz) * 0.6)})`;
        x.beginPath(); x.arc(sx, sy, 0.4 + b * b * 1.1, 0, TAU); x.fill();
      }
      if (P.moon) {
        const mx = w * (wide ? 0.2 : 0.17), my = h * (wide ? 0.22 : 0.235), mr = 15 * k;
        g = x.createRadialGradient(mx, my, 0, mx, my, mr * 7);
        g.addColorStop(0, 'rgba(220,230,255,0.32)'); g.addColorStop(0.25, 'rgba(200,215,255,0.1)'); g.addColorStop(1, 'rgba(200,215,255,0)');
        x.fillStyle = g; x.fillRect(mx - mr * 7, my - mr * 7, mr * 14, mr * 14);
        x.fillStyle = '#f5f2e4'; x.beginPath(); x.arc(mx, my, mr, 0, TAU); x.fill();
        x.fillStyle = 'rgba(180,176,160,0.35)';
        [[-0.3, -0.2, 0.32], [0.25, 0.15, 0.25], [-0.05, 0.38, 0.18]].forEach(([a, b, c]) => { x.beginPath(); x.arc(mx + a * mr, my + b * mr, c * mr, 0, TAU); x.fill(); });
      }
      /* 먼 산줄기. 왼쪽이 조금 높고, 빛을 받는 비탈은 밝고 반대쪽 비탈은 그늘이에요 */
      const peaks = [[w * 0.15, 56 * k, 70 * k], [w * 0.33, 36 * k, 52 * k]];
      for (let i = 0; i < 6; i++) peaks.push([r() * w * 1.2 - w * 0.1, (14 + r() * 30) * k, (36 + r() * 60) * k]);
      const massif = (xx) => {
        let m = 0;
        for (const [px, ph, pw] of peaks) m = Math.max(m, ph * Math.exp(-1.6 * Math.pow(Math.abs(xx - px) / pw, 1.35)));
        return m;
      };
      const ridge = (xx) => {
        const m = massif(xx);
        const rough = 2.4 * Math.sin(xx * 0.071 + 0.7) + 1.4 * Math.sin(xx * 0.163 + 2.1) + 0.7 * Math.sin(xx * 0.41);
        return hz - 6 * k - m - rough * k * (0.4 + m / (40 * k));
      };
      x.beginPath(); x.moveTo(0, hz + 20);
      for (let xx = 0; xx <= w; xx += 2) x.lineTo(xx, ridge(xx));
      x.lineTo(w, hz + 20); x.closePath();
      x.fillStyle = P.mount; x.fill();
      x.save(); x.clip();
      for (let xx = 0; xx <= w; xx += 2) {
        const top = ridge(xx), sl = massif(xx - 8) - massif(xx + 8);
        const lit = P.lightFrom ? sl > 0 : sl < 0;
        const a = ease(clamp(Math.abs(sl) / 14, 0, 1));
        const g2 = x.createLinearGradient(0, top, 0, Math.min(hz, top + 38 * k));
        const c = lit ? P.mountTop : P.line, a0 = lit ? 0.5 * a : 0.16 * a;
        g2.addColorStop(0, `rgba(${c},${a0})`); g2.addColorStop(1, `rgba(${c},0)`);
        x.fillStyle = g2;
        x.fillRect(xx, top, 2, hz - top + 2);
      }
      x.restore();
      g = x.createLinearGradient(0, hz - 24 * k, 0, hz + 6);
      g.addColorStop(0, `rgba(${P.mist},0)`); g.addColorStop(1, `rgba(${P.mist},0.85)`);
      x.fillStyle = g; x.fillRect(0, hz - 24 * k, w, 30 * k + 6);
      /* 언덕 두 겹과 방풍림 */
      const farY = (xx) => hz + G * 0.1 + G * 0.12 * Math.sin(xx * 0.011 + 1.3) + G * 0.06 * Math.sin(xx * 0.029);
      const midY = (xx) => hz + G * 0.3 + G * 0.1 * Math.sin(xx * 0.0085 + 2.3) + G * 0.05 * Math.sin(xx * 0.023 + 0.5);
      const hill = (fy, c0, c1) => {
        x.beginPath(); x.moveTo(0, h);
        for (let xx = 0; xx <= w; xx += 3) x.lineTo(xx, fy(xx));
        x.lineTo(w, h); x.closePath();
        x.fillStyle = grad(x, 0, fy(w / 2) - G * 0.1, 0, fy(w / 2) + G * 0.8, [[0, c0], [1, c1]]);
        x.fill();
        x.strokeStyle = P.rim; x.globalAlpha = 0.35; x.lineWidth = 1;
        x.beginPath();
        for (let xx = 0; xx <= w; xx += 3) { if (xx) x.lineTo(xx, fy(xx)); else x.moveTo(xx, fy(xx)); }
        x.stroke();
        x.globalAlpha = 1;
      };
      const trees = (fy, x0, x1, dy, tall, gap, alpha) => {
        for (let xx = x0; xx < x1; xx += gap * (0.8 + r() * 0.5)) {
          const by = fy(xx) + dy, th = tall * (0.7 + r() * 0.5);
          x.strokeStyle = `rgba(${P.line},${alpha})`; x.lineWidth = Math.max(0.6, tall * 0.1);
          x.beginPath(); x.moveTo(xx, by); x.lineTo(xx, by - th); x.stroke();
          x.fillStyle = `rgba(${P.line},${alpha * 0.75})`;
          x.beginPath(); x.ellipse(xx, by - th * 0.62, Math.max(0.7, tall * 0.17), th * 0.4, 0, 0, TAU); x.fill();
        }
      };
      hill(farY, P.far[0], P.far[1]);
      trees(farY, w * 0.04, w * 0.34, G * 0.05, 4 * k, 2.4 * k, 0.4);
      trees(farY, w * 0.56, w * 0.92, G * 0.08, 3.5 * k, 2.2 * k, 0.35);
      hill(midY, P.mid[0], P.mid[1]);
      x.strokeStyle = `rgba(${P.line},0.1)`; x.lineWidth = 0.8;
      for (let j = 0; j < 3; j++) {
        x.beginPath();
        for (let xx = 0; xx <= w; xx += 4) { const yy = midY(xx) + G * (0.12 + j * 0.1) + 2 * Math.sin(xx * 0.02 + j); if (xx) x.lineTo(xx, yy); else x.moveTo(xx, yy); }
        x.stroke();
      }
      trees(midY, -w * 0.02, w * 0.26, G * 0.06, 7 * k, 3 * k, 0.5);
      trees(midY, w * 0.74, w * 1.02, G * 0.1, 6 * k, 2.8 * k, 0.45);
      /* 들판 끝 작은 농가, 창에 불이 켜져 있어요 */
      const fx0 = w * 0.36, fy0 = midY(fx0) + G * 0.16;
      x.fillStyle = `rgba(${P.line},0.6)`;
      x.fillRect(fx0 - 6 * k, fy0 - 5 * k, 12 * k, 5 * k);
      x.beginPath(); x.moveTo(fx0 - 7.5 * k, fy0 - 5 * k); x.lineTo(fx0, fy0 - 10 * k); x.lineTo(fx0 + 7.5 * k, fy0 - 5 * k); x.closePath(); x.fill();
      x.fillStyle = P.snow; x.globalAlpha = 0.85;
      x.beginPath(); x.moveTo(fx0 - 7.5 * k, fy0 - 5.4 * k); x.lineTo(fx0, fy0 - 10.4 * k); x.lineTo(fx0 + 7.5 * k, fy0 - 5.4 * k); x.lineTo(fx0, fy0 - 8.6 * k); x.closePath(); x.fill();
      x.globalAlpha = 1;
      x.save(); x.shadowColor = 'rgba(255,200,130,0.9)'; x.shadowBlur = 5 * k; x.fillStyle = P.win;
      x.fillRect(fx0 - 3.5 * k, fy0 - 3.4 * k, 2 * k, 1.8 * k); x.restore();
      /* 기찻길 둑 */
      x.strokeStyle = `rgba(${P.line},0.2)`; x.lineWidth = 0.8;
      x.beginPath(); x.moveTo(0, this.trainY + 1); x.lineTo(w, this.trainY + 1); x.stroke();
      this.far = far;

      /* ---- 가까운 곳: 나무가 선 언덕과 밟을 수 있는 눈벌판 ---- */
      const near = mk(w * dpr, h * dpr), n = near.getContext('2d');
      n.scale(dpr, dpr);
      const nearPath = () => {
        n.beginPath(); n.moveTo(-2, h + 2);
        for (let xx = -2; xx <= w + 2; xx += 3) n.lineTo(xx, crest(xx));
        n.lineTo(w + 2, h + 2); n.closePath();
      };
      nearPath();
      n.fillStyle = grad(n, 0, tb, 0, h, [[0, P.field[0]], [0.35, P.field[1]], [1, P.field[2]]]);
      n.fill();
      n.save(); nearPath(); n.clip();
      g = n.createLinearGradient(P.lightFrom ? w : 0, 0, P.lightFrom ? 0 : w, 0);
      g.addColorStop(0, P.light); g.addColorStop(0.55, 'rgba(0,0,0,0)'); g.addColorStop(1, P.shade);
      n.fillStyle = g; n.fillRect(0, tb - 10, w, h);
      for (let i = 0; i < 12; i++) {
        const bx0 = r() * w, by0 = tb + 40 * k + r() * (h - tb), br = (60 + r() * 120) * k;
        g = n.createRadialGradient(bx0, by0, 0, bx0, by0, br);
        g.addColorStop(0, r() < 0.5 ? 'rgba(255,255,255,0.13)' : `rgba(${P.ps},0.1)`); g.addColorStop(1, 'rgba(0,0,0,0)');
        n.save(); n.translate(bx0, by0); n.scale(1, 0.35); n.translate(-bx0, -by0);
        n.fillStyle = g; n.fillRect(bx0 - br, by0 - br, br * 2, br * 2);
        n.restore();
      }
      /* 바람이 만든 눈결. 가까울수록 크고 또렷해요 */
      const nl = Math.round((170 * (w * (h - tb))) / (390 * 350));
      for (let i = 0; i < nl; i++) {
        const lx = r() * w, top = crest(lx) + 6, ly = top + Math.pow(r(), 0.8) * (h - top);
        const dep = clamp((ly - tb) / (h - tb), 0, 1);
        const len = (8 + r() * 26) * (0.3 + dep) * k;
        n.strokeStyle = r() < 0.55 ? `rgba(255,255,255,${0.16 + dep * 0.16})` : `rgba(${P.ps},${0.08 + dep * 0.1})`;
        n.lineWidth = 0.6 + dep * 1.1;
        n.beginPath(); n.moveTo(lx - len / 2, ly); n.quadraticCurveTo(lx, ly - len * 0.12, lx + len / 2, ly + len * 0.03); n.stroke();
      }
      for (let i = 0; i < (4000 * (w * (h - tb))) / (390 * 350); i++) {
        n.fillStyle = r() < 0.6 ? 'rgba(255,255,255,0.12)' : `rgba(${P.ps},0.06)`;
        n.fillRect(r() * w, tb + r() * (h - tb), 1 + r(), 1 + r());
      }
      n.restore();
      n.strokeStyle = P.rim; n.lineWidth = 1.2 * Math.max(k, 0.7); n.globalAlpha = 0.75;
      n.beginPath();
      for (let xx = -2; xx <= w + 2; xx += 3) { if (xx > -2) n.lineTo(xx, crest(xx)); else n.moveTo(xx, crest(xx)); }
      n.stroke(); n.globalAlpha = 1;
      g = n.createRadialGradient(0, 0, 0, 0, 0, 34 * k);
      g.addColorStop(0, `rgba(${P.ps},0.3)`); g.addColorStop(1, `rgba(${P.ps},0)`);
      n.save(); n.translate(tx, tb + 3); n.scale(1, 0.22); n.fillStyle = g; n.beginPath(); n.arc(0, 0, 34 * k, 0, TAU); n.fill(); n.restore();
      this.near = near;

      /* 달밤에는 나무 그림자가 눈 위로 길게 드리워요 */
      if (P.moon) {
        const sh = mk(spr.bare.width, spr.bare.height), s2 = sh.getContext('2d');
        s2.drawImage(spr.bare, 0, 0);
        s2.drawImage(spr.snow, 0, 0);
        s2.globalCompositeOperation = 'source-in';
        s2.fillStyle = `rgb(${P.pd})`; s2.fillRect(0, 0, sh.width, sh.height);
        this.shadow = sh;
      }

      this.load = 1; /* 가지에 쌓인 눈 0~1 */
      this.swayT = 9; this.swayA = 0;
      this.clumps = []; this.powder = []; this.drift = []; this.driftAcc = 0;
      this.train = null; this.trainNext = card ? 1e9 : rand(4, 10);
      this.gust = null; this.gustNext = card ? 1e9 : rand(12, 22);
      this.sq = 0.42;
      if (this.auto === 'walk') this.wk = this.treeWalker();
    }
    scaleAt(y) {
      const top = this.tb + 10, bot = this.h - (this.card ? 10 : 130);
      const t = clamp((y - top) / (bot - top), 0, 1);
      return (0.28 + 0.92 * t) * (this.card ? 0.45 : this.wide ? 1.1 : 1);
    }
    onTree(x, y) {
      const cy = this.tb - this.TH * (1 - this.spr.crownY), rx = this.TW * 0.48, ry = this.TH * 0.44;
      const dx = (x - this.tx) / rx, dy = (y - cy) / ry;
      return dx * dx + dy * dy < 1 || (Math.abs(x - this.tx) < 16 && y < this.tb + 4 && y > cy);
    }
    treePoint(p) {
      const { spr, TW, TH, tx, tb } = this;
      return [tx - TW / 2 + (p[0] / spr.W) * TW, tb + 3 - TH + (p[1] / spr.H) * TH];
    }
    shakeTree(sound) {
      this.swayT = 0;
      this.swayA = 0.03 + 0.03 * this.load;
      const pts = this.spr.pts, big = this.treeKind === 'spruce' ? 1.5 : 1;
      const n = Math.round(10 + 34 * this.load);
      for (let i = 0; i < n; i++) {
        const [lx, ly] = this.treePoint(pts[(Math.random() * pts.length) | 0]);
        this.clumps.push({ x: lx, y: ly, vx: rand(-14, 14), vy: rand(-20, 10), r: rand(1.2, 3.2) * this.k * big, t: 0 });
      }
      for (let i = 0; i < 70 * this.load + 20; i++) {
        const [lx, ly] = this.treePoint(pts[(Math.random() * pts.length) | 0]);
        this.powder.push({ x: lx + rand(-4, 4), y: ly, vx: rand(-12, 12), vy: rand(4, 26), t: 0, dur: rand(1.4, 2.8), r: rand(0.6, 1.6) * this.k });
      }
      this.load = Math.max(0.15, this.load - 0.42);
      if (sound) poof((this.tx / this.w - 0.5) * 1.1);
    }
    treePointer(type, x, y) {
      if (type === 'down') {
        this.walking = false;
        if (this.onTree(x, y)) { this.shakeTree(true); return; }
        if (y > this.crest(x) + 10) { this.addPrint(x, y, this.scaleAt(y), this.sq, true); this.walking = true; }
      }
      if (type === 'move' && this.down && this.walking && this.last) {
        const sc = this.scaleAt(y);
        if (y > this.crest(x) + 10 && Math.hypot(x - this.last.x, (y - this.last.y) / this.sq) > 58 * sc) this.addPrint(x, y, sc, this.sq, true);
      }
      if (type === 'up') this.walking = false;
    }
    treeWalker() {
      const { w, h, k } = this;
      return { x: rand(w * 0.22, w * 0.42), y: h - (this.wide ? 150 : 175), tx: this.tx + rand(-30, 26) * k, ty: this.tb + 22 * k, pause: 0 };
    }
    treeWalk(wk) {
      const sq = this.sq, sc = this.scaleAt(wk.y);
      const want = Math.atan2((wk.ty - wk.y) / sq, wk.tx - wk.x);
      wk.ang = wk.ang === undefined ? want : wk.ang + clamp(want - wk.ang, -0.32, 0.32) + rand(-0.14, 0.14);
      wk.x += Math.cos(wk.ang) * 60 * sc;
      wk.y += Math.sin(wk.ang) * 60 * sc * sq;
      this.addPrint(wk.x, wk.y, sc, sq, false);
      if (wk.y < wk.ty + 4) wk.pause = 2.4;
    }
    seedTrail(n) {
      const wk = this.treeWalker();
      wk.x = this.w * (this.wide ? 0.44 : 0.3);
      for (let i = 0; i < n && !wk.pause; i++) {
        this.treeWalk(wk);
        const p = this.prints[this.prints.length - 1];
        if (p) { p.life = 1; p.age = 0.05 + 0.6 * (1 - i / n); }
      }
      this.puffs.length = 0;
      this.last = null;
    }
    treeStep(dt) {
      const { w, k } = this;
      this.load = Math.min(1, this.load + (dt * this.fall.v) / 45);
      this.swayT += dt;
      for (const c of this.clumps) {
        c.t += dt; c.vy += 340 * dt; c.vx *= 0.98;
        c.x += (c.vx + this.wind * 60) * dt; c.y += c.vy * dt;
        if (c.y > this.crest(c.x) + 4 + c.r * 3) { this.puff(c.x, c.y, 3, 0.35 * k, true); c.dead = true; }
      }
      this.clumps = this.clumps.filter((c) => !c.dead && c.t < 4);
      for (const p of this.powder) { p.t += dt / p.dur; p.vy += 6 * dt; p.x += (p.vx + this.wind * 90) * dt; p.y += p.vy * dt; }
      this.powder = this.powder.filter((p) => p.t < 1);
      /* 바람 한 줄기: 언덕 위 눈가루가 옆으로 날리고 나무가 살짝 흔들려요 */
      if (!this.gust && this.t > this.gustNext) { this.gust = { t: 0, dur: rand(4.5, 6.5) }; if (this.ambient()) whoosh(this.gust.dur); }
      if (this.gust) {
        const gs = this.gust;
        gs.t += dt;
        const s = Math.sin(Math.PI * clamp(gs.t / gs.dur, 0, 1));
        this.wind = s * s;
        this.driftAcc += this.wind * 46 * dt * (w / 390);
        while (this.driftAcc >= 1) {
          this.driftAcc--;
          const dx = rand(-30, w), onCrest = Math.random() < 0.45;
          const dy = this.crest(dx) - (onCrest ? rand(0, 4) * k : -rand(12, 150) * k);
          this.drift.push({ x: dx, y: dy, vx: rand(130, 260) * k, vy: onCrest ? rand(-14, -2) : rand(-4, 2), len: rand(6, 20) * k, wd: rand(0.6, 1.4) * k, t: 0, dur: rand(0.6, 1.4) });
        }
        if (gs.t > gs.dur) { this.gust = null; this.wind = 0; this.gustNext = this.t + rand(22, 38); }
      }
      for (const p of this.drift) { p.t += dt / p.dur; p.x += p.vx * dt; p.y += p.vy * dt; }
      this.drift = this.drift.filter((p) => p.t < 1);
      /* 먼 기차 */
      if (!this.train && this.t > this.trainNext) {
        const dir = Math.random() < 0.5 ? 1 : -1, speed = 24 * k;
        this.train = { x: dir > 0 ? -50 * k : w + 50 * k, dir, speed };
        if (this.ambient()) rumble((w + 100 * k) / speed, dir);
      }
      if (this.train) {
        const T = this.train;
        T.x += T.dir * T.speed * dt;
        if (T.x < -70 * k || T.x > w + 70 * k) { this.train = null; this.trainNext = this.t + rand(45, 70); }
      }
      if (!this.auto || this.card || this.autoPaused()) return;
      this.autoT += dt;
      if (this.auto === 'shake') {
        const n = Math.floor(this.autoT / 4.2), cyc = this.autoT - n * 4.2;
        const fx = this.tx + this.TW * 0.14, fy = this.tb - this.TH * 0.62;
        this.moveFinger(fx, fy, cyc < 0.9);
        if (cyc > 0.3 && this.autoN !== n) { this.autoN = n; this.shakeTree(false); }
      }
      if (this.auto === 'walk') {
        const wk = this.wk;
        if (wk.pause > 0) {
          wk.pause -= dt;
          this.moveFinger(0, 0, false);
          if (wk.pause <= 0) { this.wk = this.treeWalker(); this.last = null; }
          return;
        }
        this.autoStep = (this.autoStep || 0) - dt;
        if (this.autoStep <= 0) { this.treeWalk(wk); this.autoStep = 0.58; }
        this.moveFinger(wk.x, wk.y, true);
      }
    }
    drawTrain(x) {
      const T = this.train, k = this.k, y = this.trainY, P = this.pal;
      for (let c = 0; c < 2; c++) {
        const cx = T.x - T.dir * c * 21 * k;
        const g = x.createRadialGradient(cx, y, 0, cx, y, 18 * k);
        g.addColorStop(0, 'rgba(255,214,160,0.26)'); g.addColorStop(1, 'rgba(255,214,160,0)');
        x.fillStyle = g; x.fillRect(cx - 18 * k, y - 18 * k, 36 * k, 36 * k);
        x.fillStyle = P.train; x.fillRect(cx - 10 * k, y - 5 * k, 20 * k, 5 * k);
        x.globalAlpha = 0.8; x.fillStyle = P.snow; x.fillRect(cx - 10 * k, y - 5.7 * k, 20 * k, 1 * k); x.globalAlpha = 1;
        x.fillStyle = P.win;
        for (let i = 0; i < 5; i++) x.fillRect(cx - 8 * k + i * 3.6 * k, y - 3.6 * k, 2 * k, 1.6 * k);
      }
      const hx = T.x + T.dir * 10.5 * k;
      const g = x.createRadialGradient(hx, y - 2 * k, 0, hx, y - 2 * k, 9 * k);
      g.addColorStop(0, 'rgba(255,246,220,0.9)'); g.addColorStop(1, 'rgba(255,246,220,0)');
      x.fillStyle = g; x.fillRect(hx - 9 * k, y - 11 * k, 18 * k, 18 * k);
    }
    treeDraw(x) {
      const { w, h, k } = this, P = this.pal;
      x.drawImage(this.far, 0, 0, w, h);
      if (this.train) this.drawTrain(x);
      /* 눈이 셀수록 먼 곳이 뿌옇게 가려져요 */
      if (this.fogV !== this.fall.v) {
        this.fogV = this.fall.v;
        const fa = this.fall.v >= 1 ? 0.3 : this.fall.v >= 0.6 ? 0.12 : 0.03;
        this.fogG = x.createLinearGradient(0, 0, 0, this.tb + 30 * k);
        this.fogG.addColorStop(0, `rgba(${P.fog},${fa * 0.45})`); this.fogG.addColorStop(1, `rgba(${P.fog},${fa})`);
      }
      x.fillStyle = this.fogG; x.fillRect(0, 0, w, h);
      x.drawImage(this.near, 0, 0, w, h);
      const sway = this.swayA * Math.exp(-this.swayT / 0.65) * Math.sin(this.swayT * 12) + this.wind * 0.02 * Math.sin(this.t * 2.6);
      if (this.shadow) {
        x.save();
        x.translate(this.tx, this.tb + 2);
        x.transform(1, 0.05, -0.8 + sway, -0.38, 0, 0);
        x.globalAlpha = 0.24;
        x.drawImage(this.shadow, -this.TW / 2, -this.TH, this.TW, this.TH);
        x.restore();
      }
      x.save();
      x.translate(this.tx, this.tb + 3);
      x.transform(1, 0, -sway, 1, 0, 0);
      x.drawImage(this.spr.bare, -this.TW / 2, -this.TH, this.TW, this.TH);
      x.globalAlpha = this.load;
      x.drawImage(this.spr.snow, -this.TW / 2, -this.TH, this.TW, this.TH);
      x.restore();
      for (const p of this.prints) drawPrint(x, p, P);
      x.fillStyle = P.snow;
      for (const c of this.clumps) { x.beginPath(); x.arc(c.x, c.y, c.r, 0, TAU); x.fill(); }
      for (const p of this.powder) { x.globalAlpha = Math.sin(Math.PI * p.t) * 0.7; x.beginPath(); x.arc(p.x, p.y, p.r, 0, TAU); x.fill(); }
      x.globalAlpha = 1;
      if (this.drift.length) {
        x.strokeStyle = '#fff'; x.lineCap = 'round';
        for (const p of this.drift) {
          x.globalAlpha = Math.sin(Math.PI * p.t) * 0.45;
          x.lineWidth = p.wd;
          x.beginPath(); x.moveTo(p.x - p.len, p.y - p.vy * 0.02); x.lineTo(p.x, p.y); x.stroke();
        }
        x.globalAlpha = 1;
      }
      this.drawPuffs();
      this.drawFlakes();
    }

    /* ================= B안 · 스노우글로브 ================= */
    globeInit() {
      const { w, h, dpr, wide } = this;
      const R = (this.R = wide ? 200 : Math.round(Math.min(w * 0.41, 164)));
      const cx = (this.gcx = w / 2), cy = (this.gcy = Math.round(h * (wide ? 0.46 : 0.45)));
      const r = rng(5);
      const tableY = cy + R * 1.06;
      /* 어둑한 방, 꼬마전구 불빛, 나무 탁자 */
      const bg = mk(w * dpr, h * dpr), x = bg.getContext('2d');
      x.scale(dpr, dpr);
      x.fillStyle = grad(x, 0, 0, 0, tableY, [[0, '#0d0a14'], [0.6, '#1c1320'], [1, '#2a1a1e']]);
      x.fillRect(0, 0, w, tableY + 2);
      for (let i = 0; i < (26 * w) / 390; i++) {
        const bx = r() * w, by = 30 + r() * tableY * 0.75, br = (10 + r() * 34) * (wide ? 1.2 : 1);
        const c = r() < 0.75 ? '255,190,120' : '170,190,255';
        const g = x.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, `rgba(${c},${0.1 + r() * 0.14})`); g.addColorStop(0.75, `rgba(${c},0.06)`); g.addColorStop(1, `rgba(${c},0)`);
        x.fillStyle = g; x.beginPath(); x.arc(bx, by, br, 0, TAU); x.fill();
      }
      let g = x.createRadialGradient(w * 0.86, tableY - R * 0.4, 0, w * 0.86, tableY - R * 0.4, Math.max(w, h) * 0.7);
      g.addColorStop(0, 'rgba(255,170,100,0.22)'); g.addColorStop(1, 'rgba(255,170,100,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = grad(x, 0, tableY, 0, h, [[0, '#4a2d1e'], [0.25, '#3a2216'], [1, '#170d08']]);
      x.fillRect(0, tableY, w, h - tableY);
      for (let i = 0; i < 70; i++) {
        const yy = tableY + Math.pow(r(), 1.4) * (h - tableY);
        x.strokeStyle = r() < 0.5 ? `rgba(20,10,4,${0.12 + r() * 0.12})` : `rgba(120,72,44,${0.1 + r() * 0.1})`;
        x.lineWidth = 0.6 + r();
        x.beginPath(); x.moveTo(-10, yy); x.bezierCurveTo(w * 0.3, yy + (r() - 0.5) * 6, w * 0.7, yy + (r() - 0.5) * 6, w + 10, yy + (r() - 0.5) * 4); x.stroke();
      }
      x.fillStyle = 'rgba(255,200,150,0.18)'; x.fillRect(0, tableY, w, 1.5);
      x.save(); x.translate(cx, cy + R * 1.24); x.scale(1, 0.18);
      g = x.createRadialGradient(0, 0, 0, 0, 0, R * 1.1);
      g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, R * 1.1, 0, TAU); x.fill(); x.restore();
      x.save(); x.translate(cx, cy + R * 1.4); x.scale(1, 0.2);
      g = x.createRadialGradient(0, 0, 0, 0, 0, R * 0.9);
      g.addColorStop(0, 'rgba(255,200,140,0.14)'); g.addColorStop(1, 'rgba(255,200,140,0)');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, R * 0.9, 0, TAU); x.fill(); x.restore();
      this.bg = bg;

      /* 글로브 속: 눈 덮인 언덕, 불 켜진 오두막, 나무 한 그루 */
      const D2 = R * 2;
      const inner = mk(D2 * dpr, D2 * dpr), ix = inner.getContext('2d');
      ix.scale(dpr, dpr); ix.translate(R, R);
      ix.fillStyle = grad(ix, 0, -R, 0, R, [[0, '#0b1438'], [0.6, '#1f2f63'], [1, '#3b4a80']]);
      ix.fillRect(-R, -R, D2, D2);
      for (let i = 0; i < 34; i++) {
        ix.fillStyle = `rgba(255,255,255,${0.3 + r() * 0.5})`;
        ix.beginPath(); ix.arc((r() - 0.5) * D2, -R + r() * R * 1.1, 0.5 + r() * 0.8, 0, TAU); ix.fill();
      }
      ix.fillStyle = '#f5f2e4'; ix.beginPath(); ix.arc(R * 0.42, -R * 0.5, R * 0.07, 0, TAU); ix.fill();
      const gIn = (this.gIn = (lx) => R * 0.42 - R * 0.2 * Math.exp(-(((lx + R * 0.1) / (R * 0.55)) ** 2)) - R * 0.06 * Math.exp(-(((lx - R * 0.45) / (R * 0.3)) ** 2)));
      ix.beginPath(); ix.moveTo(-R, R);
      for (let lx = -R; lx <= R; lx += 2) ix.lineTo(lx, gIn(lx));
      ix.lineTo(R, R); ix.closePath();
      ix.fillStyle = grad(ix, 0, R * 0.2, 0, R, [[0, '#eef3fd'], [0.4, '#c9d5ef'], [1, '#8d9cc8']]);
      ix.fill();
      const hx = -R * 0.2, hy = gIn(hx) + 3, hs = R / 160;
      g = ix.createRadialGradient(hx + 4 * hs, hy, 0, hx + 4 * hs, hy, 60 * hs);
      g.addColorStop(0, 'rgba(255,200,130,0.4)'); g.addColorStop(1, 'rgba(255,200,130,0)');
      ix.fillStyle = g; ix.fillRect(hx - 60 * hs, hy - 60 * hs, 120 * hs, 120 * hs);
      ix.fillStyle = '#5e3c2a'; ix.fillRect(hx - 24 * hs, hy - 22 * hs, 48 * hs, 22 * hs);
      ix.strokeStyle = 'rgba(30,14,8,0.45)'; ix.lineWidth = 1;
      ix.beginPath(); for (let yy = hy - 18 * hs; yy < hy; yy += 4.5 * hs) { ix.moveTo(hx - 24 * hs, yy); ix.lineTo(hx + 24 * hs, yy); } ix.stroke();
      ix.fillStyle = '#3b2a26'; ix.fillRect(hx + 12 * hs, hy - 50 * hs, 7 * hs, 16 * hs);
      ix.fillStyle = '#8a2f2c';
      ix.beginPath(); ix.moveTo(hx - 31 * hs, hy - 21 * hs); ix.lineTo(hx, hy - 44 * hs); ix.lineTo(hx + 31 * hs, hy - 21 * hs); ix.closePath(); ix.fill();
      ix.fillStyle = '#f4f7ff';
      ix.beginPath(); ix.moveTo(hx - 33 * hs, hy - 20 * hs); ix.lineTo(hx, hy - 47 * hs); ix.lineTo(hx + 33 * hs, hy - 20 * hs); ix.lineTo(hx + 27 * hs, hy - 23 * hs); ix.lineTo(hx, hy - 39 * hs); ix.lineTo(hx - 27 * hs, hy - 23 * hs); ix.closePath(); ix.fill();
      ix.fillRect(hx + 11 * hs, hy - 53 * hs, 9 * hs, 4 * hs);
      ix.save(); ix.shadowColor = 'rgba(255,190,110,0.95)'; ix.shadowBlur = 10 * hs; ix.fillStyle = '#ffd08a';
      ix.fillRect(hx - 15 * hs, hy - 15 * hs, 10 * hs, 8 * hs); ix.fillRect(hx + 6 * hs, hy - 15 * hs, 10 * hs, 8 * hs); ix.restore();
      ix.fillStyle = '#2a1a12'; ix.fillRect(hx - 3 * hs, hy - 13 * hs, 6 * hs, 13 * hs);
      const pal = { trunk: '#1f1a2c', snow: '#f4f7ff' };
      const oak = oakSprite(9, pal), sp = spruceSprite(3, pal);
      const oh = R * 0.62, ow = (oh * oak.W) / oak.H, ox = R * 0.42;
      ix.drawImage(oak.bare, ox - ow / 2, gIn(ox) + 3 - oh, ow, oh); ix.drawImage(oak.snow, ox - ow / 2, gIn(ox) + 3 - oh, ow, oh);
      [[-R * 0.66, R * 0.36], [-R * 0.54, R * 0.26]].forEach(([sx, s]) => {
        const sw = (s * sp.W) / sp.H;
        ix.drawImage(sp.bare, sx - sw / 2, gIn(sx) + 3 - s, sw, s); ix.drawImage(sp.snow, sx - sw / 2, gIn(sx) + 3 - s, sw, s);
      });
      this.inner = inner;

      /* 유리: 가장자리 그늘, 위 왼쪽 반사, 스탠드 불빛 반사 */
      const gl = mk(D2 * dpr, D2 * dpr), gx = gl.getContext('2d');
      gx.scale(dpr, dpr); gx.translate(R, R);
      g = gx.createRadialGradient(0, 0, R * 0.68, 0, 0, R);
      g.addColorStop(0, 'rgba(10,14,40,0)'); g.addColorStop(1, 'rgba(10,14,40,0.5)');
      gx.fillStyle = g; gx.beginPath(); gx.arc(0, 0, R, 0, TAU); gx.fill();
      gx.save(); gx.beginPath(); gx.arc(0, 0, R - 2, 0, TAU); gx.clip();
      g = gx.createLinearGradient(-R, -R, 0, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.3)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      gx.fillStyle = g;
      gx.beginPath(); gx.arc(0, 0, R * 0.93, Math.PI * 1.04, Math.PI * 1.62); gx.arc(-R * 0.09, -R * 0.09, R * 0.79, Math.PI * 1.62, Math.PI * 1.04, true); gx.closePath(); gx.fill();
      g = gx.createRadialGradient(R * 0.6, R * 0.05, 0, R * 0.6, R * 0.05, R * 0.5);
      g.addColorStop(0, 'rgba(255,190,120,0.18)'); g.addColorStop(1, 'rgba(255,190,120,0)');
      gx.fillStyle = g; gx.fillRect(-R, -R, D2, D2);
      gx.restore();
      gx.strokeStyle = 'rgba(255,255,255,0.24)'; gx.lineWidth = 1.5;
      gx.beginPath(); gx.arc(0, 0, R - 0.75, 0, TAU); gx.stroke();
      gx.fillStyle = 'rgba(255,255,255,0.85)';
      gx.beginPath(); gx.ellipse(-R * 0.42, -R * 0.56, R * 0.06, R * 0.028, -0.7, 0, TAU); gx.fill();
      this.glass = gl;

      /* 나무 받침과 놋쇠 띠 */
      const bw = R * 1.56, bh = R * 0.46;
      const base = mk(bw * dpr, (bh + 2) * dpr), bx = base.getContext('2d');
      bx.scale(dpr, dpr); bx.translate(bw / 2, 0);
      const top = R * 0.63, bot = R * 0.76;
      bx.beginPath(); bx.moveTo(-top, 0); bx.lineTo(top, 0); bx.lineTo(bot, bh); bx.lineTo(-bot, bh); bx.closePath();
      bx.fillStyle = grad(bx, -bot, 0, bot, 0, [[0, '#24130a'], [0.35, '#6b3f24'], [0.55, '#7d4a2a'], [1, '#24130a']]);
      bx.fill();
      const band = (y0, y1) => {
        const t0 = top + ((bot - top) * y0) / bh, t1 = top + ((bot - top) * y1) / bh;
        bx.beginPath(); bx.moveTo(-t0, y0); bx.lineTo(t0, y0); bx.lineTo(t1, y1); bx.lineTo(-t1, y1); bx.closePath();
        bx.fillStyle = grad(bx, -t1, 0, t1, 0, [[0, '#5a4220'], [0.4, '#e6c67e'], [0.6, '#f2dc9c'], [1, '#5a4220']]);
        bx.fill();
      };
      band(0, bh * 0.16);
      band(bh * 0.84, bh * 0.94);
      this.base = base; this.baseW = bw; this.baseH = bh + 2;

      this.goff = { x: 0, y: 0, vx: 0, vy: 0 };
      this.gp = [];
      this.globeFill();
    }
    globeFill() {
      const n = this.fall.v >= 1 ? 540 : this.fall.v >= 0.6 ? 320 : 170;
      while (this.gp.length < n) this.gp.push(this.globeFlake());
      this.gp.length = n;
    }
    globeFlake() {
      const R = this.R;
      let x0, y0;
      do { x0 = rand(-R, R); y0 = rand(-R, R); } while (x0 * x0 + y0 * y0 > (R - 6) ** 2 || y0 > this.gIn(x0) - 2);
      const m = rand(0.55, 1.45);
      return { x: x0, y: y0, vx: rand(-24, 24), vy: rand(-24, 12), m, r: (0.8 + m * 1.1) * (this.wide ? 1.15 : 1), a: rand(0.6, 1), ph: rand(0, TAU), rest: false, hgt: rand(0, 4) };
    }
    globeKick(dx, dy, sound) {
      const mag = Math.hypot(dx, dy);
      if (mag < 0.5) return;
      for (const p of this.gp) {
        if (p.rest && mag < 3) continue;
        if (p.rest) { p.rest = false; p.vy -= rand(30, 90); }
        p.vx += -dx * rand(2, 5) + rand(-12, 12);
        p.vy += -dy * rand(2, 5) + rand(-12, 12) - rand(0, 10);
        p.vx += -p.y * dx * 0.004; p.vy += p.x * dx * 0.004;
        const s = Math.hypot(p.vx, p.vy);
        if (s > 280) { p.vx *= 280 / s; p.vy *= 280 / s; }
      }
      if (sound && mag > 5 && this.t - (this.sloshT || 0) > 0.22) { this.sloshT = this.t; slosh((this.goff.x / 18) * 0.5, mag); }
    }
    globeShake(strength, sound) {
      this.goff.vx += 260 * strength * (Math.random() < 0.5 ? -1 : 1);
      for (const p of this.gp) {
        p.rest = false;
        const a = rand(0, TAU), v = rand(30, 160) * strength;
        p.vx += Math.cos(a) * v; p.vy += Math.sin(a) * v - rand(40, 110) * strength;
      }
      if (strength > 0.5) { this.count++; this.sync(); }
      if (sound) slosh(0, 14 * strength);
    }
    globePointer(type, x, y) {
      if (type === 'down') { this.dragging = true; this.gStart = { x, y, ox: this.goff.x, oy: this.goff.y }; this.gLast = { x, y }; this.gMoved = 0; }
      if (type === 'move' && this.down && this.gLast) {
        const dx = x - this.gLast.x, dy = y - this.gLast.y;
        this.gLast = { x, y };
        this.gMoved += Math.abs(dx) + Math.abs(dy);
        const o = this.goff;
        const nx = clamp(this.gStart.ox + (x - this.gStart.x) * 0.18, -18, 18), ny = clamp(this.gStart.oy + (y - this.gStart.y) * 0.12, -12, 12);
        o.vx = (nx - o.x) * 30; o.vy = (ny - o.y) * 30; o.x = nx; o.y = ny;
        this.globeKick(dx, dy, true);
      }
      if (type === 'up' && this.gLast) {
        this.dragging = false;
        if (this.gMoved < 8) this.globeShake(0.35, true);
        else { this.count++; this.sync(); }
        this.gLast = null;
      }
    }
    globeStep(dt) {
      const R = this.R, drag = Math.exp(-2.4 * dt);
      for (const p of this.gp) {
        if (p.rest) continue;
        p.vy += 30 * p.m * dt;
        p.vx += Math.sin(p.y * 0.035 + this.t * 0.9 + p.ph) * 10 * dt;
        p.vx *= drag; p.vy *= drag;
        p.x += p.vx * dt; p.y += p.vy * dt;
        const d = Math.hypot(p.x, p.y), lim = R - 5;
        if (d > lim) {
          const nx = p.x / d, ny = p.y / d;
          p.x = nx * lim; p.y = ny * lim;
          const vn = p.vx * nx + p.vy * ny;
          if (vn > 0) { p.vx -= 1.5 * vn * nx; p.vy -= 1.5 * vn * ny; }
        }
        const gy = this.gIn(p.x) - p.hgt;
        if (p.y >= gy) {
          p.y = gy;
          if (Math.abs(p.vy) < 40) { p.rest = true; p.vx = 0; p.vy = 0; } else p.vy *= -0.2;
        }
      }
      const o = this.goff;
      let driven = this.dragging;
      if (this.auto && !this.autoPaused()) {
        this.autoT += dt;
        const cyc = this.autoT % 13;
        if (cyc < 1.8) {
          driven = true;
          const fx = this.gcx + Math.sin((cyc / 1.8) * TAU * 2) * R * 0.45, fy = this.gcy + R * 0.15;
          const prev = this.autoFx === undefined ? fx : this.autoFx;
          this.autoFx = fx;
          o.x = (fx - this.gcx) * 0.06; o.vx = 0;
          this.globeKick((fx - prev) * 1.2, 0, false);
          this.moveFinger(fx + o.x, fy, true);
          if (cyc + dt >= 1.8) { this.count++; this.sync(); }
        } else { this.autoFx = undefined; this.moveFinger(0, 0, false); }
      }
      if (!driven) {
        o.vx += (-o.x * 160 - o.vx * 9) * dt; o.vy += (-o.y * 160 - o.vy * 9) * dt;
        o.x += o.vx * dt; o.y += o.vy * dt;
      }
    }
    globeDraw(x) {
      const { w, h, R } = this, o = this.goff;
      const cx = this.gcx + o.x, cy = this.gcy + o.y;
      x.drawImage(this.bg, 0, 0, w, h);
      x.save();
      x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.clip();
      x.drawImage(this.inner, cx - R, cy - R, R * 2, R * 2);
      x.fillStyle = '#fff';
      for (const p of this.gp) { x.globalAlpha = p.a; x.beginPath(); x.arc(cx + p.x, cy + p.y, p.r, 0, TAU); x.fill(); }
      x.globalAlpha = 1;
      x.restore();
      x.drawImage(this.glass, cx - R, cy - R, R * 2, R * 2);
      x.drawImage(this.base, cx - this.baseW / 2, cy + R * 0.8, this.baseW, this.baseH);
    }

    /* ================= C안 · 눈 내리는 노천탕 ================= */
    onsenInit() {
      const { w, h, dpr, wide } = this;
      const k = (this.k = wide ? 1.2 : 1);
      const wt = (this.wt = Math.round(h * 0.5)), wb = (this.wb = Math.round(h * (wide ? 0.86 : 0.84)));
      const r = rng(31);
      const bg = mk(w * dpr, h * dpr), x = bg.getContext('2d');
      x.scale(dpr, dpr);
      x.fillStyle = grad(x, 0, 0, 0, wt, [[0, '#03060e'], [0.55, '#0a1222'], [1, '#141e33']]);
      x.fillRect(0, 0, w, h);
      /* 눈 덮인 비탈과 소나무 */
      const slope = (xx) => h * 0.24 - (xx / w) * h * 0.06 + 10 * Math.sin(xx * 0.013 + 1);
      x.beginPath(); x.moveTo(0, wt); for (let xx = 0; xx <= w; xx += 4) x.lineTo(xx, slope(xx)); x.lineTo(w, wt); x.closePath();
      x.fillStyle = grad(x, 0, h * 0.2, 0, wt, [[0, '#2a364f'], [1, '#4c5c80']]); x.fill();
      const pines = [];
      for (let i = 0; i < Math.round((12 * w) / 390); i++) { const px = r() * w, sy = slope(px); pines.push([px, sy + 30 + r() * (wt - sy - 26), r()]); }
      pines.sort((a, b) => a[1] - b[1]);
      for (const [px, by, q] of pines) {
        const th = (70 + q * 90) * k * (0.6 + (0.5 * (by - h * 0.2)) / (wt - h * 0.2));
        x.fillStyle = '#0b121d'; x.fillRect(px - th * 0.02, by - th * 0.2, th * 0.04, th * 0.2);
        for (let i = 0; i < 7; i++) {
          const t = i / 6, y = by - th + th * 0.12 + t * th * 0.72, hw = th * 0.05 + th * 0.32 * t * (0.85 + r() * 0.3);
          x.fillStyle = '#0d1522';
          x.beginPath(); x.moveTo(px, y - th * 0.09); x.lineTo(px - hw, y + th * 0.05); x.lineTo(px + hw, y + th * 0.05); x.closePath(); x.fill();
          x.fillStyle = 'rgba(196,208,232,0.85)';
          x.beginPath(); x.moveTo(px, y - th * 0.09);
          x.quadraticCurveTo(px - hw * 0.5, y - th * 0.02, px - hw * 0.9, y + th * 0.035);
          x.quadraticCurveTo(px - hw * 0.4, y, px, y - th * 0.035);
          x.quadraticCurveTo(px + hw * 0.4, y, px + hw * 0.9, y + th * 0.035);
          x.quadraticCurveTo(px + hw * 0.5, y - th * 0.02, px, y - th * 0.09);
          x.fill();
        }
      }
      /* 물 */
      x.fillStyle = grad(x, 0, wt, 0, wb, [[0, '#14323c'], [0.35, '#0c2a33'], [1, '#051318']]);
      x.fillRect(0, wt, w, wb - wt);
      let g = x.createLinearGradient(0, wt, 0, wt + 46 * k);
      g.addColorStop(0, 'rgba(200,214,240,0.26)'); g.addColorStop(1, 'rgba(200,214,240,0)');
      x.fillStyle = g; x.fillRect(0, wt, w, 46 * k);
      /* 바위 */
      const rock = (cx, by, rw, rh, capH) => {
        const c = Math.min(0.5, (capH || rh * 0.5) / rh);
        x.fillStyle = grad(x, 0, by - rh, 0, by, [[0, '#3a3b45'], [1, '#15161c']]);
        x.beginPath(); x.moveTo(cx - rw, by);
        x.bezierCurveTo(cx - rw, by - rh * 0.7, cx - rw * 0.5, by - rh, cx, by - rh);
        x.bezierCurveTo(cx + rw * 0.55, by - rh, cx + rw, by - rh * 0.6, cx + rw, by);
        x.closePath(); x.fill();
        x.fillStyle = '#dfe6f4';
        const e = 1 - c * 1.1, sx0 = rw * (0.55 + c * 0.6);
        x.beginPath(); x.moveTo(cx - sx0, by - rh * e);
        x.bezierCurveTo(cx - rw * 0.62, by - rh * 1.0, cx + rw * 0.55, by - rh * 1.1, cx + sx0 * 1.04, by - rh * (e - 0.02));
        x.bezierCurveTo(cx + rw * 0.4, by - rh * (e + c * 0.25), cx - rw * 0.35, by - rh * (e + c * 0.2), cx - sx0, by - rh * e);
        x.fill();
        x.strokeStyle = 'rgba(110,130,180,0.4)'; x.lineWidth = 1;
        x.beginPath(); x.moveTo(cx - sx0 * 0.95, by - rh * (e - 0.01)); x.bezierCurveTo(cx - rw * 0.35, by - rh * (e + c * 0.1), cx + rw * 0.4, by - rh * (e + c * 0.14), cx + sx0, by - rh * (e - 0.03)); x.stroke();
      };
      for (let xx = -20; xx < w + 30;) { const rw = (22 + r() * 26) * k; rock(xx + rw, wt + 6, rw, (16 + r() * 22) * k); xx += rw * 1.6; }
      /* 눈 덮인 석등 (불은 매 장면 그려요) */
      const lx = w * (wide ? 0.78 : 0.8), lb = wt - 4 * k, s = k;
      rock(lx, wt + 8, 40 * k, 30 * k);
      x.fillStyle = '#2a2b33'; x.fillRect(lx - 6 * s, lb - 26 * s - 18 * s, 12 * s, 26 * s);
      x.fillStyle = '#34353e'; x.fillRect(lx - 13 * s, lb - 48 * s, 26 * s, 5 * s);
      x.fillRect(lx - 11 * s, lb - 68 * s, 22 * s, 20 * s);
      this.lwin = { x: lx - 6 * s, y: lb - 64 * s, w: 12 * s, h: 12 * s };
      x.fillStyle = '#1a1208'; x.fillRect(this.lwin.x, this.lwin.y, this.lwin.w, this.lwin.h);
      x.fillStyle = '#2e2f38';
      x.beginPath(); x.moveTo(lx - 26 * s, lb - 68 * s); x.quadraticCurveTo(lx, lb - 80 * s, lx + 26 * s, lb - 68 * s); x.lineTo(lx + 19 * s, lb - 75 * s); x.quadraticCurveTo(lx, lb - 88 * s, lx - 19 * s, lb - 75 * s); x.closePath(); x.fill();
      x.fillStyle = '#e4eaf6';
      x.beginPath(); x.ellipse(lx, lb - 79 * s, 24 * s, 10 * s, 0, Math.PI, 0); x.fill();
      x.beginPath(); x.ellipse(lx, lb - 47 * s, 14 * s, 3 * s, 0, Math.PI, 0); x.fill();
      x.fillStyle = '#2e2f38'; x.beginPath(); x.arc(lx, lb - 91 * s, 4 * s, 0, TAU); x.fill();
      x.fillStyle = '#e4eaf6'; x.beginPath(); x.ellipse(lx, lb - 94 * s, 5 * s, 2.4 * s, 0, Math.PI, 0); x.fill();
      this.lglow = { x: lx, y: lb - 58 * s };
      /* 대나무 물받이 */
      const sx1 = w * (wide ? 0.16 : 0.22), sy1 = wt - 30 * k;
      rock(w * 0.06, wt + 10, 46 * k, 40 * k);
      x.lineCap = 'round';
      x.strokeStyle = '#56622f'; x.lineWidth = 8 * k;
      x.beginPath(); x.moveTo(-10, wt - 48 * k); x.lineTo(sx1, sy1); x.stroke();
      x.strokeStyle = 'rgba(200,210,130,0.35)'; x.lineWidth = 2 * k;
      x.beginPath(); x.moveTo(-10, wt - 50.5 * k); x.lineTo(sx1, sy1 - 2.5 * k); x.stroke();
      x.strokeStyle = '#e4eaf6'; x.lineWidth = 3 * k;
      x.beginPath(); x.moveTo(-10, wt - 52.5 * k); x.lineTo(sx1 - 6 * k, sy1 - 4 * k); x.stroke();
      x.strokeStyle = 'rgba(30,36,14,0.6)'; x.lineWidth = 1.5 * k;
      for (const q of [0.3, 0.65]) { const qx = -10 + (sx1 + 10) * q, qy = wt - 48 * k + (sy1 - wt + 48 * k) * q; x.beginPath(); x.moveTo(qx, qy - 4 * k); x.lineTo(qx, qy + 4 * k); x.stroke(); }
      this.spout = { x: sx1 + 2 * k, y: sy1 + 1 * k, ly: wt + 30 * k };
      /* 가까운 바위와 나무 바가지 */
      for (let xx = -30; xx < w + 40;) { const rw = (28 + r() * 60) * k; rock(xx + rw, h + 20, rw, h - wb + 6 + r() * 46 * k, (14 + r() * 12) * k); xx += rw * (1.1 + r() * 0.6); }
      const ox = w * 0.2, oy = wb + 4 * k, ow = 22 * k, oh = 18 * k;
      x.fillStyle = '#7a5634';
      x.beginPath(); x.moveTo(ox - ow, oy - oh); x.lineTo(ox + ow, oy - oh); x.lineTo(ox + ow * 0.86, oy); x.lineTo(ox - ow * 0.86, oy); x.closePath(); x.fill();
      x.strokeStyle = '#33241a'; x.lineWidth = 2 * k;
      x.beginPath(); x.moveTo(ox - ow * 0.96, oy - oh * 0.72); x.lineTo(ox + ow * 0.96, oy - oh * 0.72); x.moveTo(ox - ow * 0.9, oy - oh * 0.25); x.lineTo(ox + ow * 0.9, oy - oh * 0.25); x.stroke();
      x.fillStyle = '#5b3f26'; x.beginPath(); x.ellipse(ox, oy - oh, ow, 4.5 * k, 0, 0, TAU); x.fill();
      x.fillStyle = '#e4eaf6'; x.beginPath(); x.ellipse(ox - ow * 0.2, oy - oh - 1.5 * k, ow * 0.6, 2.4 * k, 0, Math.PI, 0); x.fill();
      this.bg = bg;

      this.steamSpr = softSprite('232,238,248');
      this.steam = [];
      for (let i = 0; i < 58 * (w / 390); i++) this.steam.push(this.newSteam(true));
      this.ripples = [];
      this.sheen = [];
      for (let i = 0; i < 26; i++) this.sheen.push({ y: r(), x: r() * w, len: (14 + r() * 40) * k, sp: 0.3 + r() * 0.6 });
      this.lampOn = true; this.lamp = 1;
      this.spoutT = 0;
    }
    newSteam(anywhere) {
      const { w, wt, wb, k } = this;
      return { x: rand(-20, w + 20), y: rand(wt + 4, wb - 10), r: rand(50, 130) * k, vy: -rand(8, 18), vx: 0, t: anywhere ? Math.random() : 0, dur: rand(6, 10), a: rand(0.13, 0.24), ph: rand(0, TAU) };
    }
    ripple(x, y, s, wgt) {
      const per = 0.5 + (0.7 * (y - this.wt)) / (this.wb - this.wt);
      this.ripples.push({ x, y, t: 0, dur: 1.2 + s * 1.6, max: (8 + 76 * s) * this.k * per, wgt: wgt === undefined ? 1 : wgt, rings: s > 0.4 ? 3 : 1 });
      if (this.ripples.length > 90) this.ripples.shift();
    }
    pushSteam(x, y) {
      for (const s of this.steam) {
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < 130 * this.k && d > 1) s.vx += ((s.x - x) / d) * 26;
      }
    }
    onsenPointer(type, x, y) {
      const inWater = y > this.wt + 8 && y < this.wb - 4;
      const pan = (x / this.w - 0.5) * 1.2;
      if (type === 'down' && inWater) { this.ripple(x, y, 1); plop(pan, true); this.lastR = { x, y }; this.pushSteam(x, y); }
      if (type === 'move' && this.down && this.lastR && inWater && Math.hypot(x - this.lastR.x, y - this.lastR.y) > 18) {
        this.ripple(x, y, 0.45);
        this.lastR = { x, y };
        this.pushSteam(x, y);
        if (this.t - (this.plopT || 0) > 0.2) { this.plopT = this.t; plop(pan, false); }
      }
      if (type === 'up') this.lastR = null;
    }
    onsenStep(dt) {
      const { w, wt } = this;
      this.lamp += ((this.lampOn ? 1 : 0.1) - this.lamp) * Math.min(1, dt * 3);
      for (const s of this.steam) {
        s.t += dt / s.dur;
        s.y += s.vy * dt;
        s.x += (Math.sin(this.t * 0.3 + s.ph) * 6 + s.vx) * dt;
        s.vx *= 0.97;
        if (s.t >= 1 || s.y < wt - 260 * this.k) Object.assign(s, this.newSteam(false));
        if (s.x < -140) s.x = w + 100;
        if (s.x > w + 140) s.x = -100;
      }
      for (const rp of this.ripples) rp.t += dt / rp.dur;
      this.ripples = this.ripples.filter((rp) => rp.t < 1);
      this.spoutT -= dt;
      if (this.spoutT <= 0) { this.spoutT = rand(0.2, 0.4); this.ripple(this.spout.x + 7 * this.k + rand(-2, 2), this.spout.ly, 0.12, 0.7); }
      if (!this.auto || this.autoPaused()) return;
      this.autoT += dt;
      const n = Math.floor(this.autoT / 5.5), cyc = this.autoT - n * 5.5;
      if (this.autoN !== n) { this.autoN = n; this.autoPt = { x: rand(w * 0.3, w * 0.7), y: rand(this.wt + 60, this.wb - 50) }; }
      const p = this.autoPt;
      this.moveFinger(p.x, p.y, cyc > 0.2 && cyc < 1.1);
      if (cyc > 0.5 && this.autoHit !== n) { this.autoHit = n; this.ripple(p.x, p.y, 1); this.pushSteam(p.x, p.y); }
    }
    onsenDraw(x) {
      const { w, h, k } = this, L = this.lamp, lg = this.lglow, lw = this.lwin;
      x.drawImage(this.bg, 0, 0, w, h);
      if (L > 0.02) {
        const g = x.createRadialGradient(lg.x, lg.y, 0, lg.x, lg.y, 230 * k);
        g.addColorStop(0, `rgba(255,180,110,${0.38 * L})`); g.addColorStop(1, 'rgba(255,180,110,0)');
        x.fillStyle = g; x.fillRect(lg.x - 230 * k, lg.y - 230 * k, 460 * k, 460 * k);
        for (let i = 0; i < 18; i++) {
          const yy = this.wt + 8 * k + i * 11 * k;
          if (yy > this.wb) break;
          const hw = (4 + i * 1.7) * k * (0.75 + 0.35 * Math.sin(this.t * 1.8 + i * 1.3));
          x.fillStyle = `rgba(255,196,128,${0.34 * (1 - i / 18) * L})`;
          x.fillRect(lg.x - hw + Math.sin(this.t * 1.3 + i) * 3 * k, yy, hw * 2, 2.2 * k);
        }
      }
      x.save();
      x.shadowColor = 'rgba(255,190,110,0.95)'; x.shadowBlur = 16 * L;
      x.fillStyle = `rgba(255,214,150,${0.12 + 0.88 * L})`;
      x.fillRect(lw.x, lw.y, lw.w, lw.h);
      x.restore();
      x.strokeStyle = 'rgba(40,24,10,0.7)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(lw.x + lw.w / 2, lw.y); x.lineTo(lw.x + lw.w / 2, lw.y + lw.h); x.stroke();
      /* 물 위 반짝임 */
      for (const s of this.sheen) {
        const yy = this.wt + 10 + s.y * (this.wb - this.wt - 20);
        const xx = (s.x + this.t * 8 * s.sp) % (w + 60) - 30;
        x.fillStyle = `rgba(190,214,236,${0.05 + 0.04 * Math.sin(this.t * s.sp * 2 + s.x)})`;
        x.fillRect(xx, yy, s.len, 1.2);
      }
      /* 대나무 물줄기 */
      const sp = this.spout;
      x.strokeStyle = 'rgba(200,226,236,0.55)'; x.lineWidth = 2.4 * k; x.lineCap = 'round';
      x.beginPath(); x.moveTo(sp.x, sp.y); x.quadraticCurveTo(sp.x + 6 * k, sp.y + 4 * k, sp.x + 7 * k + Math.sin(this.t * 9) * 0.6, sp.ly); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,0.5)'; x.lineWidth = 0.8;
      x.beginPath(); x.moveTo(sp.x, sp.y); x.quadraticCurveTo(sp.x + 5 * k, sp.y + 4 * k, sp.x + 6 * k, sp.ly); x.stroke();
      /* 물결 */
      for (const rp of this.ripples) {
        for (let j = 0; j < rp.rings; j++) {
          const tt = rp.t - j * 0.14;
          if (tt <= 0) continue;
          const rad = rp.max * ease(Math.min(1, tt * 1.1));
          x.strokeStyle = `rgba(214,232,246,${(1 - tt) * 0.5 * rp.wgt})`;
          x.lineWidth = j ? 1 : 1.4;
          x.beginPath(); x.ellipse(rp.x, rp.y, rad, rad * 0.3, 0, 0, TAU); x.stroke();
        }
      }
      /* 김 */
      for (const s of this.steam) {
        x.globalAlpha = s.a * Math.sin(Math.PI * s.t);
        const rad = s.r * (1 + s.t * 0.6);
        x.drawImage(this.steamSpr, s.x - rad, s.y - rad * 0.8, rad * 2, rad * 1.6);
      }
      x.globalAlpha = 1;
      this.drawPuffs();
      this.drawFlakes();
    }

    /* ================= D안 · 장갑 위 눈 결정 ================= */
    crystalInit() {
      const { w, h, dpr, wide } = this;
      const r = rng(17);
      const bg = mk(w * dpr, h * dpr), x = bg.getContext('2d');
      x.scale(dpr, dpr);
      x.fillStyle = grad(x, 0, 0, 0, h, [[0, '#060918'], [0.5, '#0f1630'], [1, '#141a34']]);
      x.fillRect(0, 0, w, h);
      /* 흐릿한 거리 불빛 (위쪽에 작게) */
      for (let i = 0; i < (22 * (w * h)) / (390 * 844); i++) {
        const bx = r() * w, by = r() * h * 0.5, br = (7 + r() * 20) * (wide ? 1.2 : 1);
        const c = r() < 0.6 ? '255,196,130' : '150,186,255';
        const g = x.createRadialGradient(bx, by, br * 0.55, bx, by, br);
        g.addColorStop(0, `rgba(${c},${0.05 + r() * 0.08})`); g.addColorStop(0.88, `rgba(${c},${0.08 + r() * 0.07})`); g.addColorStop(1, `rgba(${c},0)`);
        x.fillStyle = g; x.beginPath(); x.arc(bx, by, br, 0, TAU); x.fill();
      }
      /* 장갑: 손바닥을 위로 펼친 짙은 남색 벙어리장갑. 엄지가 왼쪽, 손목엔 눈꽃 무늬 띠와 고무단.
         u, v 는 장갑 기준 좌표 (s 배), M 이 화면 좌표로 옮겨요 */
      const s = wide ? h * 0.62 : w * 0.92, mcx = wide ? w * 0.5 : w * 0.56, mcy = h * (wide ? 0.62 : 0.6), rot = wide ? -0.1 : -0.14;
      const cs = Math.cos(rot), sn = Math.sin(rot);
      const M = (u, v) => [mcx + (u * cs - v * sn) * s, mcy + (u * sn + v * cs) * s];
      const p = new Path2D();
      const bz = (a, b, c, d, e, f) => p.bezierCurveTo(...M(a, b), ...M(c, d), ...M(e, f));
      p.moveTo(...M(0.31, 0.9));
      p.lineTo(...M(0.31, 0.55));
      bz(0.36, 0.3, 0.38, 0.05, 0.36, -0.12);
      bz(0.33, -0.36, 0.17, -0.48, 0, -0.48);
      bz(-0.17, -0.48, -0.31, -0.38, -0.32, -0.16);
      bz(-0.33, -0.05, -0.33, 0.03, -0.33, 0.08);
      bz(-0.4, -0.02, -0.52, -0.08, -0.58, -0.02);
      bz(-0.64, 0.05, -0.58, 0.18, -0.48, 0.28);
      bz(-0.4, 0.36, -0.33, 0.44, -0.31, 0.55);
      p.lineTo(...M(-0.31, 0.9));
      p.closePath();
      this.mitt = p;
      this.hit = mk(1, 1).getContext('2d');
      let g = x.createRadialGradient(...M(-0.05, 0.05), 0, ...M(0, 0.1), s * 0.7);
      g.addColorStop(0, '#2e4072'); g.addColorStop(1, '#141c3c');
      x.fillStyle = g; x.fill(p);
      x.save(); x.clip(p);
      x.translate(mcx, mcy); x.rotate(rot);
      /* 메리야스 뜨기: 세로로 늘어선 V 코 */
      const sw = s * 0.024, sh = s * 0.026;
      for (let v = -0.52 * s, row = 0; v < 0.55 * s; v += sh, row++) {
        for (let u = -0.66 * s; u < 0.42 * s; u += sw) {
          const jx = (r() - 0.5) * 0.7, jy = (r() - 0.5) * 0.7;
          x.strokeStyle = 'rgba(4,8,24,0.34)'; x.lineWidth = 1.6;
          x.beginPath(); x.moveTo(u - sw * 0.42 + jx, v - sh * 0.36 + 1 + jy); x.lineTo(u + jx, v + sh * 0.4 + 1 + jy); x.lineTo(u + sw * 0.42 + jx, v - sh * 0.36 + 1 + jy); x.stroke();
          x.strokeStyle = `rgba(150,170,230,${0.14 + r() * 0.1})`; x.lineWidth = 1.1;
          x.beginPath(); x.moveTo(u - sw * 0.42 + jx, v - sh * 0.36 + jy); x.lineTo(u + jx, v + sh * 0.4 + jy); x.lineTo(u + sw * 0.42 + jx, v - sh * 0.36 + jy); x.stroke();
        }
      }
      /* 손목: 눈꽃 무늬 띠, 그 아래 고무단 */
      const b0 = 0.55 * s, b1 = 0.67 * s;
      x.fillStyle = '#1a2448'; x.fillRect(-0.4 * s, b0, 0.8 * s, 0.4 * s);
      x.fillStyle = 'rgba(226,216,198,0.88)';
      x.fillRect(-0.4 * s, b0 + 4, 0.8 * s, 2.5); x.fillRect(-0.4 * s, b1 - 6, 0.8 * s, 2.5);
      for (let u = -0.38 * s; u < 0.38 * s; u += 26) {
        const my = (b0 + b1) / 2;
        x.beginPath(); x.moveTo(u, my - 8); x.lineTo(u + 6, my); x.lineTo(u, my + 8); x.lineTo(u - 6, my); x.closePath(); x.fill();
        x.fillRect(u + 11, my - 1.5, 3, 3);
      }
      for (let u = -0.4 * s, i = 0; u < 0.4 * s; u += 5, i++) {
        x.fillStyle = i % 2 ? 'rgba(4,8,24,0.38)' : 'rgba(150,170,230,0.13)';
        x.fillRect(u, b1, 2.5, 0.3 * s);
      }
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      g = x.createRadialGradient(...M(-0.12, -0.2), 0, ...M(-0.12, -0.2), s * 0.6);
      g.addColorStop(0, 'rgba(255,255,255,0.07)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.restore();
      x.strokeStyle = 'rgba(160,180,230,0.22)'; x.lineWidth = 2; x.stroke(p);
      this.bg = bg;

      this.softSpr = softSprite('255,255,255');
      this.bokeh = [];
      for (let i = 0; i < 6; i++) this.bokeh.push({ x: rand(0, w), y: rand(0, h), r: rand(12, 26), vy: rand(8, 18), a: rand(0.05, 0.11), ph: rand(0, TAU) });
      this.caught = [];
      this.landed = [];
      this.S = wide ? 104 : 78;
    }
    inMitt(x, y) { return this.hit.isPointInPath(this.mitt, x, y); }
    catchAt(x, y, sound) {
      const S = this.S;
      x = clamp(x, S + 10, this.w - S - 10);
      y = clamp(y, this.h * 0.3 + S * 0.7, this.h - 160 - S * 0.5);
      if (this.caught.length >= 3) this.caught.shift();
      const kind = pickKind(this.fall.v);
      this.caught.push({ x, y, kind, c: makeCrystal(kind, rng((Math.random() * 1e9) | 0)), t: 0, rot: rand(0, TAU / 6), S: S * rand(0.85, 1.1) });
      this.count++;
      this.sync();
      if (sound) ting((x / this.w - 0.5) * 1.2);
    }
    crystalPointer(type, x, y) {
      if (type === 'down' && this.inMitt(x, y)) this.catchAt(x, y, true);
    }
    crystalStep(dt) {
      const { w, h } = this;
      for (const l of this.landed) l.t += dt / l.dur;
      this.landed = this.landed.filter((l) => l.t < 1);
      for (const c of this.caught) c.t += dt;
      this.caught = this.caught.filter((c) => c.t < 10);
      for (const b of this.bokeh) {
        b.y += b.vy * dt; b.x += Math.sin(this.t * 0.4 + b.ph) * 8 * dt;
        if (b.y > h + b.r) { b.y = -b.r; b.x = rand(0, w); }
      }
      if (!this.auto || this.autoPaused()) return;
      this.autoT += dt;
      const n = Math.floor(this.autoT / 5.5), cyc = this.autoT - n * 5.5;
      if (this.autoN !== n) {
        this.autoN = n;
        let px, py, tries = 0;
        do { px = rand(w * 0.25, w * 0.8); py = rand(h * 0.45, h * 0.72); tries++; } while (!this.inMitt(px, py) && tries < 20);
        this.autoPt = { x: px, y: py };
      }
      const p = this.autoPt;
      this.moveFinger(p.x, p.y, cyc > 0.1 && cyc < 0.9);
      if (cyc > 0.45 && this.autoHit !== n) { this.autoHit = n; this.catchAt(p.x, p.y, false); }
    }
    crystalDraw(x) {
      const { w, h } = this;
      x.drawImage(this.bg, 0, 0, w, h);
      x.strokeStyle = '#fff'; x.lineCap = 'round';
      for (const l of this.landed) {
        x.globalAlpha = (1 - l.t) * 0.85;
        x.lineWidth = 0.8;
        x.beginPath();
        for (let i = 0; i < 3; i++) {
          const an = l.rot + (i * Math.PI) / 3;
          x.moveTo(l.x - Math.cos(an) * l.r, l.y - Math.sin(an) * l.r);
          x.lineTo(l.x + Math.cos(an) * l.r, l.y + Math.sin(an) * l.r);
        }
        x.stroke();
      }
      x.globalAlpha = 1;
      this.drawFlakes();
      for (const b of this.bokeh) { x.globalAlpha = b.a; x.drawImage(this.softSpr, b.x - b.r, b.y - b.r, b.r * 2, b.r * 2); }
      x.globalAlpha = 1;
      for (const c of this.caught) {
        const g = c.t < 1.6 ? ease(c.t / 1.6) : 1;
        const m = c.t < 8 ? 0 : (c.t - 8) / 2;
        const halo = x.createRadialGradient(c.x, c.y, 0, c.x, c.y, c.S * 1.35);
        halo.addColorStop(0, `rgba(6,10,30,${0.42 * g * (1 - m)})`); halo.addColorStop(1, 'rgba(6,10,30,0)');
        x.fillStyle = halo; x.fillRect(c.x - c.S * 1.4, c.y - c.S * 1.4, c.S * 2.8, c.S * 2.8);
        drawCrystal(x, c.x, c.y, c.S, c.c, g, m, c.rot, this.t);
        /* 이름표 */
        const la = clamp((c.t - 0.9) / 0.5, 0, 1) * (1 - clamp((c.t - 7.4) / 0.6, 0, 1));
        if (la > 0.01) {
          const info = KINDS[c.kind];
          x.font = '600 12px "Pretendard Variable", Pretendard, -apple-system, sans-serif';
          const text = `${info.label} · ${info.temp}`;
          const tw = x.measureText(text).width + 22, th = 26;
          const lx = clamp(c.x - tw / 2, 10, w - tw - 10), ly = c.y - c.S - 30;
          x.globalAlpha = la;
          x.fillStyle = 'rgba(12,16,34,0.72)'; x.beginPath(); rr(x, lx, ly, tw, th, 13); x.fill();
          x.strokeStyle = 'rgba(255,255,255,0.14)'; x.lineWidth = 1; x.stroke();
          x.fillStyle = '#eef4ff'; x.textBaseline = 'middle'; x.fillText(text, lx + 11, ly + th / 2 + 0.5);
          x.globalAlpha = 1;
        }
      }
    }
  }

  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__snow2.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-snow2]').forEach((c) => {
      const sc = new Snow2(c);
      c.__snow2 = sc;
      scenes.push(sc);
      sc.draw();
      if (io) io.observe(c);
      const pos = (e) => {
        const r = c.getBoundingClientRect();
        return [(e.clientX - r.left) * (sc.w / r.width), (e.clientY - r.top) * (sc.h / r.height)];
      };
      c.addEventListener('pointerdown', (e) => {
        if (c.setPointerCapture) { try { c.setPointerCapture(e.pointerId); } catch (_) { /* 캡처가 안 되는 환경은 그대로 둬요 */ } }
        audio();
        sc.pointer('down', ...pos(e));
      });
      c.addEventListener('pointermove', (e) => sc.pointer('move', ...pos(e)));
      c.addEventListener('pointerup', (e) => sc.pointer('up', ...pos(e)));
      c.addEventListener('pointercancel', (e) => sc.pointer('up', ...pos(e)));
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-snow2-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-snow2]');
      if (c && c.__snow2) { active = c.__snow2; c.__snow2.action(b.dataset.snow2Act, b.dataset.value); }
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
