/* mong — 지하철멍 시안용 장면 (Doan 보드 전용). 코드(src/scenes)에는 아직 없어요.
   한강 철교를 건너는 지하철 안에서, 창밖으로 여의도 불꽃축제를 봐요. <canvas data-subway> 하나가 장면 하나.
     data-view="seat"    A안 · 맞은편 창: 앉아서 통로 건너편 창을 봐요
     data-view="door"    B안 · 문 앞: 서서 문 유리 두 장 너머로 봐요
     data-view="glass"   C안 · 창 가까이: 창에 비친 실내 너머로 봐요
     data-view="wide"    A안 데스크톱: 창 두 개
    data-wide           B안 · C안 데스크톱 (data-view="door" · "glass" 와 같이 써요). 앱(src/scenes/subway.ts)과 같은 식으로
                        탭 · 장면 칩 아래(122px)부터 독 위(704px)까지에 맞춰 문 · 창을 놓아요. 문 앞은 양옆 의자 · 창을 넣기 전 모습이에요
    data-wide="seats"   B안 데스크톱: 문 양옆에 긴 의자와 창이 있어요 (지금 앱과 같아요)
     data-view="card"    홈 카드 (창 위쪽 테두리와 손잡이만)
     data-view="bare"    창틀 없이 바깥만 (흐름 · 불꽃 세기 설명용)
     data-show="0.6"     불꽃 세기 0.3 드문드문 · 0.6 축제 · 1 피날레
     data-rush="demo"    축제에서 가끔 오는 피날레를 빨리 감아 보여 줘요 (24초마다 8초). 없으면 처음 1분 뒤, 그다음 3~5분마다 30초
     data-bridge="mix"   mix 철골 구간과 탁 트인 구간이 번갈아 · truss 철골만 · open 탁 트인 구간만
     data-auto           손가락이 저절로 창을 눌러요 (설명용, [data-sub-finger] 를 움직여요)
     data-seed="3"       빌딩 · 불꽃 배치를 고정해요
   같은 .screen 안의 [data-sub-act] 버튼이 장면을 조작해요.
   펑 소리는 시안에서만 쓰는 합성음이고, 누르거나 버튼을 눌러 올린 불꽃에서만 나요. 실제로는 녹음을 써요. */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (a) => a[(Math.random() * a.length) | 0];
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const mix = (a, b, t) => a + (b - a) * t;
  const rng = (seed) => { let s = (seed * 2654435761) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; };
  const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

  /* 불꽃 색. 실제 불꽃놀이에서 많이 보는 색만 골랐어요 */
  const COL = {
    gold: [255, 200, 112], silver: [236, 240, 255], red: [255, 86, 78], green: [104, 236, 146],
    blue: [104, 156, 255], violet: [190, 132, 255], orange: [255, 150, 70], pink: [255, 128, 186], cyan: [118, 226, 255],
  };
  const PALS = [['gold'], ['silver'], ['red', 'gold'], ['green'], ['blue', 'silver'], ['violet'], ['orange'], ['pink', 'violet'], ['cyan', 'blue'], ['red'], ['green', 'gold'], ['gold', 'silver']];

  /* 불꽃 세기 세 단계. gap 다음 불꽃까지(초), multi 한꺼번에 여러 발 올라갈 확률 */
  const SHOWS = [
    { v: 0.3, name: '드문드문', gap: [2.6, 4.6], multi: 0, types: { peony: 3, chrys: 2, willow: 3, ring: 1, palm: 1, glitter: 1 } },
    { v: 0.6, name: '축제', gap: [0.75, 1.7], multi: 0.28, types: { peony: 4, chrys: 3, willow: 2, ring: 2, palm: 2, glitter: 2 } },
    { v: 1, name: '피날레', gap: [0.16, 0.4], multi: 0.5, types: { peony: 4, chrys: 3, willow: 3, ring: 1, palm: 2, glitter: 3 } },
  ];
  const showOf = (v) => SHOWS.reduce((b, s) => (Math.abs(s.v - v) < Math.abs(b.v - v) ? s : b), SHOWS[1]);
  const pickType = (types) => {
    let sum = 0; for (const k in types) sum += types[k];
    let r = Math.random() * sum;
    for (const k in types) { r -= types[k]; if (r <= 0) return k; }
    return 'peony';
  };

  /* 빛 알갱이 하나 (가운데가 밝은 둥근 점). 색마다 한 번만 만들어 둬요 */
  const SPR = new Map();
  function sprite(c) {
    const key = c.join(',');
    let s = SPR.get(key);
    if (s) return s;
    s = mk(32, 32);
    const x = s.getContext('2d');
    const g = x.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.22, rgba(c, 1));
    g.addColorStop(0.5, rgba(c, 0.36));
    g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, 32, 32);
    SPR.set(key, s);
    return s;
  }
  const GLOW = new Map();
  function glow(c) {
    const key = c.map((v) => v | 0).join(',');
    let s = GLOW.get(key);
    if (s) return s;
    s = mk(48, 48);
    const x = s.getContext('2d');
    const g = x.createRadialGradient(24, 24, 0, 24, 24, 24);
    g.addColorStop(0, rgba(c, 0.55)); g.addColorStop(0.5, rgba(c, 0.18)); g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g; x.fillRect(0, 0, 48, 48);
    if (GLOW.size > 400) GLOW.clear();
    GLOW.set(key, s);
    return s;
  }
  let SMOKE = null;
  function smokeSprite() {
    if (SMOKE) return SMOKE;
    SMOKE = mk(64, 64);
    const x = SMOKE.getContext('2d');
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(150,150,170,0.9)'); g.addColorStop(0.55, 'rgba(120,120,140,0.45)'); g.addColorStop(1, 'rgba(110,110,130,0)');
    x.fillStyle = g; x.fillRect(0, 0, 64, 64);
    return SMOKE;
  }

  /* ---------------- 시안 소리 (합성음, 보드 전용) ---------------- */
  let AC = null;
  const audio = () => {
    if (AC) return AC;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    AC = new C();
    return AC;
  };
  /* 창 너머 먼 펑. 화면에서 터지는 순간에 들려요 (앱도 같아요) */
  function boom(delay, big) {
    const ac = AC;
    if (!ac || ac.state !== 'running') return;
    const t0 = ac.currentTime + delay;
    const len = 1.6;
    const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * len), ac.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const t = i / ac.sampleRate; d[i] = (Math.random() * 2 - 1) * Math.exp(-t * 3.2) * (t < 0.006 ? t / 0.006 : 1); }
    const src = ac.createBufferSource(); src.buffer = buf;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = big ? 260 : 200; lp.Q.value = 0.4;
    const g = ac.createGain(); g.gain.value = big ? 0.9 : 0.6;
    src.connect(lp).connect(g).connect(ac.destination);
    src.start(t0);
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(70, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.5);
    const og = ac.createGain(); og.gain.setValueAtTime(0, t0); og.gain.linearRampToValueAtTime(big ? 0.5 : 0.32, t0 + 0.01); og.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
    o.connect(og).connect(ac.destination); o.start(t0); o.stop(t0 + 0.8);
  }

  /* ---------------- 자리마다 창과 실내 ---------------- */
  /* 창 구멍(wins)과 바깥이 보이는 범위(V), 수평선 높이(hz), 손잡이 자리를 정해요 */
  function layoutOf(view, w, h, wide) {
    if (wide && view === 'door') return doorWide(w, h, wide === 'seats');
    if (wide && view === 'glass') return glassWide(w, h);
    if (view === 'seat') {
      return { wins: [{ x: 26, y: 178, w: 338, h: 330, r: 28 }], hz: 0.62,
        bar: 152, handles: [52, 124, 196, 268, 340].map((x) => ({ x, len: rand(58, 66) })) };
    }
    if (view === 'door') {
      /* 위에 장면 칩과 행선 안내판이 들어가게 문을 조금 내려요 */
      return { wins: [{ x: 56, y: 252, w: 120, h: 372, r: 18 }, { x: 214, y: 252, w: 120, h: 372, r: 18 }], hz: 0.5, bar: 0, handles: [] };
    }
    if (view === 'glass') {
      return { wins: [{ x: 12, y: -60, w: 366, h: 710, r: 34 }], vis: { x: 12, y: 0, w: 366, h: 650 }, hz: 0.6, bar: 0, handles: [] };
    }
    if (view === 'wide') {
      const hs = []; for (let x = 92; x < w - 60; x += 118) hs.push({ x, len: rand(58, 68) });
      return { wins: [{ x: 104, y: 176, w: 500, h: 322, r: 30 }, { x: 676, y: 176, w: 500, h: 322, r: 30 }], hz: 0.62, bar: 150, handles: hs };
    }
    if (view === 'card') {
      const k = h / 156;
      return { wins: [{ x: 0, y: 0, w, h, r: 0 }], hz: w > h * 1.8 ? 0.62 : 0.66, bar: 0, card: true,
        handles: (w > h * 1.8 ? [0.62, 0.74, 0.86] : [0.7, 0.88]).map((f) => ({ x: w * f, len: 18 * k })) };
    }
    return { wins: [{ x: 0, y: 0, w, h, r: 0 }], hz: 0.62, bar: 0, handles: [] };
  }

  /* 데스크톱 · 문 앞: 앱의 layoutOf('door') 와 같은 식. 문 너비는 문 높이의 0.62배라 넓은 화면에서는 가운데에만 놓여요 */
  const DESK_TOP = 122; /* 장면 칩 아래 (88 + 34) */
  const DESK_DOCK = 96; /* 독 위 (아래 32 + 독 64) */
  function doorWide(w, h, seats) {
    const k = clamp(h / 844, 0.55, 1.2);
    const top = DESK_TOP, bottom = h - DESK_DOCK;
    const ledTop = top + 12 * k, ledH = 34;
    const y0 = ledTop + ledH + 14 * k, y1 = h - 26 * k;
    const dw = Math.min(w - 68, Math.max(322, (y1 - y0) * 0.62));
    const x0 = (w - dw) / 2, x1 = x0 + dw, mid = w / 2;
    const outer = dw * 0.068, inner = dw * 0.059;
    const gy = y0 + 44 * k;
    const gb = Math.min(bottom - 40 * k, gy + (y1 - y0) * 0.62);
    const gh = Math.max(80, gb - gy);
    const gw = mid - inner - (x0 + outer);
    const L = {
      wins: [{ x: x0 + outer, y: gy, w: gw, h: gh, r: 18 }, { x: mid + inner, y: gy, w: gw, h: gh, r: 18 }],
      hz: 0.5, bar: 0, handles: [], k,
      door: { x0, x1, y0, y1 }, led: { x: mid - (dw - 80) / 2, y: ledTop, w: dw - 80, h: ledH },
    };
    if (!seats) return L;
    /* 문 양옆에 긴 의자와 창 (앱과 같은 식). 의자 끝 기둥은 한 자리(문 너비의 0.35배) 눈금에 맞춰 문에서 한 자리쯤 떨어져요.
       창 윗변은 문 유리 윗변과 같고, 아랫변은 등받이 위예요. 의자 밑은 문 아래와 같은 바닥선에 닿아요 */
    const seatW = Math.round(dw * 0.347);
    const reach = seatW * Math.ceil((mid - x0 + 50 * k) / seatW);
    const bayL = mid - reach, bayR = mid + reach;
    const wt = gy, wb = Math.round(gy + (y1 - gy) * 0.51);
    const m = clamp(w * 0.0375, 24, 64), ww = bayL - 24 * k - m;
    if (ww < 120 * k) return L;
    L.wins.unshift({ x: m, y: wt, w: ww, h: wb - wt, r: 26, side: true });
    L.wins.push({ x: w - m - ww, y: wt, w: ww, h: wb - wt, r: 26, side: true });
    L.hz = 0.5;
    L.bar = wt - 26;
    L.bench = { fl: y1, bayL, bayR, seatW };
    /* 손잡이: 의자 위로만, 창 너비에 맞춰 */
    const step = seatW * 0.92, cL = m + ww / 2;
    const n = Math.max(1, Math.floor((ww - 40 * k) / step) + 1);
    for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * step; L.handles.push({ x: cL + o, len: rand(58, 66) * k }, { x: w - cL - o, len: rand(58, 66) * k }); }
    return L;
  }
  /* 데스크톱 · 창가: 앱의 layoutOf('window') 와 같은 식. 유리가 화면 너비를 다 채워요 */
  function glassWide(w, h) {
    const k = clamp(h / 844, 0.55, 1.2);
    const sill = Math.min(h - DESK_DOCK - 28 * k, h - 194 * k);
    return { wins: [{ x: 12, y: -60, w: w - 24, h: sill + 60, r: 34 }], vis: { x: 12, y: 0, w: w - 24, h: sill }, hz: 0.6, bar: 0, handles: [], k };
  }

  const rr = (x, X, Y, W, H, R) => {
    R = Math.min(R, W / 2, H / 2);
    x.moveTo(X + R, Y); x.arcTo(X + W, Y, X + W, Y + H, R); x.arcTo(X + W, Y + H, X, Y + H, R); x.arcTo(X, Y + H, X, Y, R); x.arcTo(X, Y, X + W, Y, R); x.closePath();
  };
  const vgrad = (x, y0, y1, stops) => { const g = x.createLinearGradient(0, y0, 0, y1); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; };
  const hgrad = (x, x0, x1, stops) => { const g = x.createLinearGradient(x0, 0, x1, 0); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; };

  /* 앉은 자리 맞은편 벽: 천장 · 선반 · 창 · 등받이 · 좌석 · 바닥 (seat · wide 같이 써요) */
  function paintBench(x, w, h, L) {
    const win = L.wins;
    const top = win[0].y, bot = win[0].y + win[0].h;
    /* 천장 */
    x.fillStyle = vgrad(x, 0, top, [[0, '#1d2028'], [0.5, '#262a33'], [1, '#2c3039']]);
    x.fillRect(0, 0, w, top);
    /* 천장 조명 줄 */
    const ly = Math.max(18, top - 150);
    x.fillStyle = vgrad(x, ly - 18, ly + 26, [[0, 'rgba(240,244,250,0)'], [0.4, 'rgba(240,244,250,0.16)'], [0.5, 'rgba(250,252,255,0.85)'], [0.6, 'rgba(240,244,250,0.16)'], [1, 'rgba(240,244,250,0)']]);
    x.fillRect(0, ly - 18, w, 44);
    /* 선반 */
    const sy = top - 52;
    x.fillStyle = '#353a44'; x.fillRect(0, sy, w, 6);
    x.fillStyle = 'rgba(150,158,172,0.5)'; x.fillRect(0, sy, w, 1.5);
    x.strokeStyle = 'rgba(160,168,182,0.22)'; x.lineWidth = 1;
    for (let i = 0; i < w; i += 9) { x.beginPath(); x.moveTo(i, sy + 6); x.lineTo(i + 4, sy + 22); x.stroke(); }
    x.fillStyle = '#3c414c'; x.fillRect(0, sy + 22, w, 4);
    /* 창 둘레 벽 */
    x.fillStyle = vgrad(x, sy + 26, bot + 50, [[0, '#2b2f38'], [1, '#23262e']]);
    x.fillRect(0, sy + 26, w, bot + 50 - sy - 26);
    /* 창 고무 테두리 */
    for (const r of win) {
      x.save(); x.beginPath(); rr(x, r.x - 7, r.y - 7, r.w + 14, r.h + 14, r.r + 7); x.fillStyle = '#16181d'; x.fill(); x.restore();
      x.save(); x.beginPath(); rr(x, r.x - 7, r.y - 7, r.w + 14, r.h + 14, r.r + 7); x.strokeStyle = 'rgba(170,178,192,0.18)'; x.lineWidth = 1.5; x.stroke(); x.restore();
    }
    /* 창 아래 띠 */
    x.fillStyle = 'rgba(190,198,212,0.28)'; x.fillRect(0, bot + 20, w, 2);
    /* 등받이 */
    /* L.bench: 문 양옆 의자 (B안 데스크톱 제안). 의자 밑이 문 아래 바닥선(fl)에 닿게 늘려요 */
    const f = L.bench ? (L.bench.fl - bot) / 240 : 1;
    const sb = bot + 50 * f, sf = sb + 92 * f, ss = sf + 30 * f, sd = ss + 34 * f, fl = L.bench ? L.bench.fl : sd + 34;
    x.fillStyle = vgrad(x, sb, sf, [[0, '#2a3160'], [0.65, '#232a55'], [1, '#1c2247']]);
    x.beginPath(); rr(x, -20, sb, w + 40, sf - sb + 10, 18); x.fill();
    /* 자리 나눔 (한 자리 125px 쯤) */
    const seatW = L.bench ? L.bench.seatW : Math.round(win[0].w / 2.7);
    x.strokeStyle = 'rgba(8,10,26,0.55)'; x.lineWidth = 2;
    for (let i = (w / 2) % seatW; i < w; i += seatW) { x.beginPath(); x.moveTo(i, sb + 10); x.lineTo(i, sf + 2); x.stroke(); }
    x.strokeStyle = 'rgba(120,132,200,0.14)'; x.lineWidth = 1;
    for (let i = (w / 2) % seatW + 2; i < w; i += seatW) { x.beginPath(); x.moveTo(i, sb + 10); x.lineTo(i, sf + 2); x.stroke(); }
    /* 좌석 윗면 · 앞면 */
    x.fillStyle = vgrad(x, sf, ss, [[0, '#343c74'], [1, '#2a3166']]);
    x.fillRect(0, sf, w, ss - sf);
    x.fillStyle = vgrad(x, ss, sd, [[0, '#1d2350'], [1, '#141838']]);
    x.fillRect(0, ss, w, sd - ss);
    x.fillStyle = 'rgba(160,172,240,0.2)'; x.fillRect(0, ss, w, 1.5);
    /* 좌석 밑 난방기 */
    x.fillStyle = '#16181e'; x.fillRect(0, sd, w, fl - sd);
    x.strokeStyle = 'rgba(140,146,160,0.16)'; x.lineWidth = 1;
    for (let i = 4; i < w; i += 6) { x.beginPath(); x.moveTo(i, sd + 8); x.lineTo(i, fl - 8); x.stroke(); }
    /* 바닥 */
    x.fillStyle = vgrad(x, fl, h, [[0, '#2a2c31'], [1, '#383a40']]);
    x.fillRect(0, fl, w, h - fl);
    x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(0, fl, w, 3);
    /* 손잡이 봉 (기둥은 두지 않아요. 위 봉으로 충분해요) */
    if (L.bar) {
      x.fillStyle = vgrad(x, L.bar - 4, L.bar + 4, [[0, '#9aa1ad'], [0.4, '#e4e8ee'], [1, '#5c626d']]);
      x.fillRect(0, L.bar - 4, w, 8);
    }
  }

  /* B안 · 문: 문 위 벽 · 문짝 두 장 · 문 유리 · 노란 발판 */
  function paintDoor(x, w, h, L) {
    x.fillStyle = vgrad(x, 0, h, [[0, '#22252d'], [1, '#2a2d35']]);
    x.fillRect(0, 0, w, h);
    const ly = 22;
    x.fillStyle = vgrad(x, ly - 16, ly + 24, [[0, 'rgba(240,244,250,0)'], [0.5, 'rgba(250,252,255,0.8)'], [1, 'rgba(240,244,250,0)']]);
    x.fillRect(0, ly - 16, w, 40);
    /* 문 틀 (데스크톱은 L.door) */
    const D = L.door || { x0: 34, x1: w - 34, y0: 208, y1: h - 26 };
    const dx0 = D.x0, dx1 = D.x1, dy0 = D.y0, dy1 = D.y1;
    /* 제안: 문 양옆에 긴 의자와 창 */
    if (L.bench) paintDoorSides(x, w, h, L);
    /* 넓은 화면: 문 양옆은 판넬 벽이에요 (앱과 같아요) */
    else if (dx0 > 60) {
      x.fillStyle = 'rgba(255,255,255,0.035)';
      for (let px = dx0 - 150; px > 0; px -= 180) x.fillRect(px, 0, 1, h);
      for (let px = dx1 + 150; px < w; px += 180) x.fillRect(px, 0, 1, h);
    }
    x.fillStyle = '#15171c'; x.fillRect(dx0 - 10, dy0 - 10, dx1 - dx0 + 20, dy1 - dy0 + 10);
    /* 문짝 */
    const mid = w / 2;
    for (const [a, b] of [[dx0, mid - 2], [mid + 2, dx1]]) {
      x.fillStyle = hgrad(x, a, b, [[0, '#3c424b'], [0.5, '#4b525c'], [1, '#3a4049']]);
      x.fillRect(a, dy0, b - a, dy1 - dy0);
      x.fillStyle = 'rgba(255,255,255,0.06)'; x.fillRect(a, dy0, b - a, 2);
    }
    x.fillStyle = '#0d0e11'; x.fillRect(mid - 3, dy0, 6, dy1 - dy0);
    /* 유리 둘레 고무 */
    for (const r of L.wins) {
      if (r.side) continue;
      x.save(); x.beginPath(); rr(x, r.x - 6, r.y - 6, r.w + 12, r.h + 12, r.r + 6); x.fillStyle = '#121418'; x.fill(); x.restore();
    }
    /* 발판 */
    x.fillStyle = '#c9a227'; x.fillRect(dx0 - 10, dy1, dx1 - dx0 + 20, 8);
    x.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = dx0 - 6; i < dx1 + 10; i += 7) x.fillRect(i, dy1 + 2, 3, 4);
    x.fillStyle = vgrad(x, dy1 + 8, h, [[0, '#2a2c31'], [1, '#34363c']]);
    x.fillRect(0, dy1 + 8, w, h - dy1 - 8);
  }

  /* B안 데스크톱 · 문 양옆 (앱의 paintDoorSides 와 같아요): 맞은편 창(A안)과 같은 벽 · 창 · 긴 의자. 천장은 이어지고, 선반 아래로는 의자 쪽만 그려요 */
  function paintDoorSides(x, w, h, L) {
    const B = L.bench;
    const side = L.wins.filter((r) => r.side);
    const top = side[0].y, rack = top - 52;
    x.save();
    x.beginPath();
    x.rect(0, 0, w, rack);
    x.rect(0, rack, B.bayL, h - rack);
    x.rect(B.bayR, rack, w - B.bayR, h - rack);
    x.clip();
    paintBench(x, w, h, { wins: side, bar: 0, bench: B });
    x.restore();
    /* 손잡이 봉: 의자 위로만 */
    x.fillStyle = vgrad(x, L.bar - 4, L.bar + 4, [[0, '#9aa1ad'], [0.4, '#e4e8ee'], [1, '#5c626d']]);
    x.fillRect(0, L.bar - 4, B.bayL, 8);
    x.fillRect(B.bayR, L.bar - 4, w - B.bayR, 8);
    /* 의자 끝 칸막이 (옆에서 본 유리판이 얇은 띠로 보여요) */
    const bot = top + side[0].h;
    for (const px of [B.bayL, B.bayR]) {
      const dir = px < w / 2 ? -1 : 1;
      x.save(); x.beginPath(); rr(x, px + (dir < 0 ? -14 : 0), bot - 40, 14, B.fl - bot - 20, 7);
      x.fillStyle = 'rgba(150,170,190,0.16)'; x.fill();
      x.strokeStyle = 'rgba(210,218,230,0.35)'; x.lineWidth = 1.5; x.stroke(); x.restore();
    }
    /* 의자 끝 기둥: 손잡이 봉에서 바닥까지 */
    for (const px of [B.bayL, B.bayR]) {
      x.fillStyle = hgrad(x, px - 5, px + 5, [[0, '#5c626d'], [0.45, '#e8ecf2'], [1, '#6a707b']]);
      x.fillRect(px - 5, L.bar - 4, 10, B.fl - L.bar + 4);
    }
  }

  /* C안 · 창 가까이: 창이 화면을 거의 채우고, 아래로 창턱과 내가 앉은 등받이 */
  function paintGlass(x, w, h, L) {
    const r = L.wins[0];
    const bot = r.y + r.h;
    const k = L.k || 1;
    x.fillStyle = '#16181d'; x.fillRect(0, 0, w, h);
    x.fillStyle = hgrad(x, 0, 12, [[0, '#2b2f38'], [1, '#1a1c22']]); x.fillRect(0, 0, 12, h);
    x.fillStyle = hgrad(x, w - 12, w, [[0, '#1a1c22'], [1, '#2b2f38']]); x.fillRect(w - 12, 0, 12, h);
    x.fillStyle = vgrad(x, bot, bot + 26 * k, [[0, '#9aa1ad'], [0.25, '#e2e6ec'], [1, '#5c626d']]);
    x.fillRect(0, bot, w, 22 * k);
    x.fillStyle = vgrad(x, bot + 22 * k, bot + 60 * k, [[0, '#2b2f38'], [1, '#22252c']]);
    x.fillRect(0, bot + 22 * k, w, 38 * k);
    x.fillStyle = vgrad(x, bot + 60 * k, h, [[0, '#343c74'], [0.4, '#2a3160'], [1, '#1c2247']]);
    x.beginPath(); rr(x, -10, bot + 60 * k, w + 20, h, 22); x.fill();
    x.fillStyle = 'rgba(160,172,240,0.22)'; x.fillRect(0, bot + 66 * k, w, 1.5);
  }

  /* 유리에 비친 실내. 조명 줄, 손잡이, 맞은편 창틀이 옅게 겹쳐요 */
  function paintReflection(x, w, h, L, view) {
    const V = L.V;
    if (view === 'glass') {
      /* 내 뒤 실내가 원근으로 비쳐요: 천장 조명 두 줄이 한 점으로 모여요 */
      const vx = w * 0.62, vy = V.y + V.h * 0.36;
      const sc = clamp(V.h / 650, 0.6, 1.6); /* 폰(650)에서 1 */
      x.strokeStyle = 'rgba(235,242,255,0.85)'; x.lineCap = 'round';
      for (const [sx, sy, lw] of [[-40, -30, 16], [w + 60, -10, 14]]) {
        x.lineWidth = lw * sc; x.beginPath(); x.moveTo(sx, sy); x.lineTo(mix(sx, vx, 0.92), mix(sy, vy, 0.92)); x.stroke();
      }
      /* 맞은편 창들: 어두운 네모가 줄지어 작아져요 */
      x.fillStyle = 'rgba(0,0,0,0.6)';
      for (let i = 0; i < 5; i++) {
        const f = i / 5, f2 = (i + 0.8) / 5;
        const ax = mix(-60, vx, f), bx = mix(-60, vx, f2);
        const ay0 = mix(V.y + V.h * 0.12, vy - 6, f), ay1 = mix(V.y + V.h * 0.52, vy + 6, f);
        const by0 = mix(V.y + V.h * 0.12, vy - 6, f2), by1 = mix(V.y + V.h * 0.52, vy + 6, f2);
        x.beginPath(); x.moveTo(ax, ay0); x.lineTo(bx, by0); x.lineTo(bx, by1); x.lineTo(ax, ay1); x.closePath(); x.fill();
      }
      /* 손잡이 줄 */
      x.strokeStyle = 'rgba(225,230,240,0.7)';
      for (let i = 0; i < 7; i++) {
        const f = Math.pow(i / 7, 0.8);
        const hx = mix(w * 0.95, vx, f), hy = mix(V.y + V.h * 0.08, vy - 10, f), s = mix(1, 0.15, f) * sc;
        x.lineWidth = 4 * s; x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx, hy + 52 * s); x.stroke();
        x.beginPath(); x.ellipse(hx, hy + 52 * s + 11 * s, 9 * s, 11 * s, 0, 0, TAU); x.stroke();
      }
      /* 맞은편 등받이 */
      x.fillStyle = 'rgba(60,72,150,0.55)';
      x.beginPath(); x.moveTo(-20, V.y + V.h * 0.6); x.lineTo(vx, vy + 14); x.lineTo(vx, vy + 26); x.lineTo(-20, V.y + V.h * 0.84); x.closePath(); x.fill();
      /* 내 실루엣 (창에 비친 나) */
      x.fillStyle = 'rgba(10,12,20,0.55)';
      const cx = w * 0.3, cy = V.y + V.h * 0.66;
      x.beginPath(); x.ellipse(cx, cy, 38 * sc, 46 * sc, 0, 0, TAU); x.fill();
      x.beginPath(); x.moveTo(cx - 92 * sc, V.y + V.h + 10); x.quadraticCurveTo(cx - 80 * sc, cy + 58 * sc, cx, cy + 50 * sc); x.quadraticCurveTo(cx + 80 * sc, cy + 58 * sc, cx + 92 * sc, V.y + V.h + 10); x.closePath(); x.fill();
      return;
    }
    /* 앉은 자리 · 문: 조명 줄이 유리 위쪽에 옅게 */
    for (const r of L.wins) {
      const y = r.y + r.h * 0.13;
      x.fillStyle = vgrad(x, y - 10, y + 10, [[0, 'rgba(235,242,255,0)'], [0.5, 'rgba(235,242,255,0.75)'], [1, 'rgba(235,242,255,0)']]);
      x.fillRect(r.x, y - 10, r.w, 20);
      /* 비스듬한 유리 결 */
      x.fillStyle = 'rgba(255,255,255,0.18)';
      x.beginPath(); x.moveTo(r.x + r.w * 0.62, r.y); x.lineTo(r.x + r.w * 0.78, r.y); x.lineTo(r.x + r.w * 0.36, r.y + r.h); x.lineTo(r.x + r.w * 0.2, r.y + r.h); x.closePath(); x.fill();
    }
    if (view === 'door') {
      /* 내 뒤 좌석과 맞은편 창이 비쳐요 */
      for (const r of L.wins) {
        if (r.side) continue;
        x.fillStyle = 'rgba(60,72,150,0.45)'; x.fillRect(r.x, r.y + r.h * 0.7, r.w, r.h * 0.16);
        x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(r.x + 10, r.y + r.h * 0.3, r.w - 20, r.h * 0.34);
      }
    }
  }

  /* ---------------- 바깥: 여의도 쪽 강변 ---------------- */
  /* 빌딩 줄을 한 번 그려 두고 천천히 옆으로 흘려요 (끝과 끝이 이어져요) */
  function buildSkyline(S, PW, seed, dpr) {
    const R = rng(seed);
    const HT = Math.ceil(170 * S), HB = Math.ceil(40 * S);
    const c = mk(PW * dpr, (HT + HB) * dpr);
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    const base = HT; /* 수평선 */
    const tops = [];
    const towers = [];
    /* 낮은 아파트 · 건물. 오른쪽 끝을 넘는 건물은 왼쪽 끝에도 똑같이 그려서, 빌딩 줄이 이음매 없이 되풀이돼요 */
    let px = 0;
    while (px < PW) {
      const bw = (10 + R() * 26) * S;
      const bh = (14 + Math.pow(R(), 1.6) * 46) * S;
      towers.push({ x: px, w: bw, h: bh, kind: 'low' });
      px += bw + R() * 3 * S;
    }
    /* 여의도: 금빛 빌딩 하나, 쌍둥이 빌딩, 세 동짜리 빌딩 */
    const yx = PW * 0.32;
    towers.push({ x: yx + 120 * S, w: 22 * S, h: 98 * S, kind: 'tall' });
    towers.push({ x: yx + 146 * S, w: 16 * S, h: 76 * S, kind: 'tall' });
    towers.push({ x: yx + 166 * S, w: 14 * S, h: 62 * S, kind: 'tall' });
    towers.push({ x: yx + 230 * S, w: 20 * S, h: 132 * S, kind: 'twin' });
    towers.push({ x: yx + 256 * S, w: 20 * S, h: 118 * S, kind: 'twin' });
    towers.push({ x: yx + 300 * S, w: 18 * S, h: 70 * S, kind: 'tall' });
    towers.push({ x: yx + 330 * S, w: 26 * S, h: 54 * S, kind: 'tall' });
    towers.push({ x: yx + 30 * S, w: 24 * S, h: 116 * S, kind: 'gold' });
    for (let i = 0; i < 6; i++) towers.push({ x: yx - 90 * S + R() * 520 * S, w: (14 + R() * 14) * S, h: (40 + R() * 40) * S, kind: 'tall' });
    /* 빌딩마다 창 불빛 씨앗을 따로 둬요. 끝에서 한 번 더 그려도 불빛이 같아요 */
    for (const t of towers) t.seed = (R() * 4294967296) >>> 0;
    towers.sort((a, b) => (b.kind === 'low' ? 1 : 0) - (a.kind === 'low' ? 1 : 0));
    for (const t of towers) for (const X of t.x + t.w > PW ? [t.x, t.x - PW] : [t.x]) {
      const Y = base - t.h, Q = rng(t.seed);
      if (t.kind === 'gold') {
        /* 금빛 유리 빌딩. 위로 갈수록 살짝 좁아지고 꼭대기가 비스듬해요 */
        x.beginPath(); x.moveTo(X, base); x.lineTo(X, Y + 10 * S); x.lineTo(X + t.w * 0.8, Y); x.lineTo(X + t.w, Y + 4 * S); x.lineTo(X + t.w, base); x.closePath();
        x.fillStyle = vgrad(x, Y, base, [[0, '#c99a4a'], [0.4, '#8a6230'], [1, '#3a2814']]); x.fill();
        x.fillStyle = 'rgba(255,214,140,0.35)';
        for (let yy = Y + 14 * S; yy < base - 2; yy += 3 * S) x.fillRect(X + 1, yy, t.w - 2, 0.6 * S);
        x.fillStyle = 'rgba(255,236,190,0.55)'; x.fillRect(X + t.w * 0.66, Y + 8 * S, 1.2 * S, t.h - 10 * S);
        if (X === t.x) tops.push({ x: X + t.w * 0.8, y: Y - 1 });
        continue;
      }
      x.fillStyle = t.kind === 'low' ? '#0c1020' : '#0e1224';
      x.fillRect(X, Y, t.w, t.h);
      x.fillStyle = 'rgba(120,130,170,0.12)'; x.fillRect(X, Y, t.w, 1);
      if (t.kind === 'twin') {
        /* 꼭대기 붉은 테 */
        x.fillStyle = 'rgba(232,96,60,0.7)'; x.fillRect(X, Y, t.w, 3 * S); x.fillRect(X, Y, 1.6 * S, 16 * S); x.fillRect(X + t.w - 1.6 * S, Y, 1.6 * S, 16 * S);
      }
      /* 불 켜진 창 */
      const cw = 2.2 * S, ch = 2.6 * S;
      const lit = t.kind === 'low' ? 0.42 : 0.3;
      for (let yy = Y + 4 * S; yy < base - 3 * S; yy += ch + 1.6 * S) {
        for (let xx = X + 2 * S; xx < X + t.w - 2 * S; xx += cw + 1.8 * S) {
          if (Q() > lit) continue;
          const warm = Q() < 0.72;
          x.fillStyle = warm ? `rgba(255,${200 + Q() * 30 | 0},${130 + Q() * 40 | 0},${0.45 + Q() * 0.45})` : `rgba(200,224,255,${0.35 + Q() * 0.4})`;
          x.fillRect(xx, yy, cw, ch * 0.7);
        }
      }
      if (X === t.x && t.h > 70 * S) tops.push({ x: X + t.w / 2, y: Y - 1 });
    }
    /* 먼 다리: 수평선 바로 위로 가로등이 줄지어요. 간격을 그림 폭에 맞춰서 이음매에서도 고르게 놓여요 */
    const even = (step) => PW / Math.max(1, Math.round(PW / step));
    const by = base - 5 * S;
    x.fillStyle = '#0a0d1a'; x.fillRect(0, by, PW, 2.2 * S);
    for (let bx = 4, st = even(44 * S); bx < PW; bx += st) x.fillRect(bx, by, 3 * S, base - by + 2);
    for (let bx = 2, st = even(7 * S); bx < PW; bx += st) { x.fillStyle = `rgba(255,206,140,${0.55 + R() * 0.35})`; x.fillRect(bx, by - 1.4 * S, 1.3 * S, 1.3 * S); }
    /* 강둑 */
    x.fillStyle = '#080a14'; x.fillRect(0, base - 1, PW, 2 * S);
    return { c, HT, HB, tops, by };
  }

  /* 물에 비친 빌딩: 줄인 그림을 뒤집어 키우면 번져 보여요 */
  function buildReflection(sky, PW, dpr) {
    const small = mk(PW * dpr / 6, sky.HT * dpr / 6);
    const s = small.getContext('2d');
    s.drawImage(sky.c, 0, 0, PW * dpr, sky.HT * dpr, 0, 0, small.width, small.height);
    const c = mk(PW * dpr, sky.HT * dpr);
    const x = c.getContext('2d');
    x.imageSmoothingEnabled = true;
    x.translate(0, c.height); x.scale(1, -1);
    x.drawImage(small, 0, 0, c.width, c.height);
    return c;
  }

  /* ---------------- 장면 ---------------- */
  class Subway {
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
      this.view = d.view || 'seat';
      this.wide = d.wide === undefined ? false : (d.wide || true);
      this.show = showOf(Number(d.show) || 0.6);
      this.bridge = d.bridge || 'mix';
      this.auto = d.auto !== undefined;
      this.finger = this.screen ? this.screen.querySelector('[data-sub-finger]') : null;
      this.seed = Number(d.seed) || 7;
      this.t = 0;
      this.shots = 0;

      const { w, h } = this;
      const L = layoutOf(this.view, w, h, this.wide);
      const vis = L.vis || L.wins.reduce((a, r) => ({ x: Math.min(a.x, r.x), y: Math.min(a.y, r.y), x2: Math.max(a.x2, r.x + r.w), y2: Math.max(a.y2, r.y + r.h) }), { x: 1e9, y: 1e9, x2: -1e9, y2: -1e9 });
      L.V = L.vis ? L.vis : { x: vis.x, y: vis.y, w: vis.x2 - vis.x, h: vis.y2 - vis.y };
      this.L = L;
      const V = L.V;
      this.V = V;
      this.S = L.card ? clamp(h / 250, 0.4, 1.1) : clamp(Math.min(V.w / 340, V.h / 360), 0.3, 1.25);
      this.hy = V.y + V.h * L.hz;
      this.framed = !['card', 'bare'].includes(this.view);

      /* 빌딩 줄 · 물에 비친 빌딩 */
      this.PW = Math.ceil(Math.max(V.w * 2.6, 1200 * this.S));
      this.sky = buildSkyline(this.S * 0.8, this.PW, this.seed, this.dpr);
      this.refl = buildReflection(this.sky, this.PW, this.dpr);
      /* 처음엔 여의도 빌딩들이 창 가운데쯤 오게 */
      this.skyX = this.PW * 0.32 + 170 * this.S * 0.8 - V.x - V.w * 0.5;
      this.area = clamp(V.w / 360, 0.5, 3.2);
      this.cars = Array.from({ length: 8 }, () => ({ x: rand(0, this.PW), v: rand(9, 16) * this.S * (Math.random() < 0.5 ? -1 : 1) }));

      /* 실내 (창 구멍이 뚫린 그림), 불꽃 빛을 받는 정도, 유리에 비친 실내 */
      this.inside = null;
      if (this.framed) {
        const c = mk(w * this.dpr, h * this.dpr);
        const x = c.getContext('2d');
        x.scale(this.dpr, this.dpr);
        if (this.view === 'door') paintDoor(x, w, h, L);
        else if (this.view === 'glass') paintGlass(x, w, h, L);
        else paintBench(x, w, h, L);
        x.globalCompositeOperation = 'destination-out';
        x.fillStyle = '#000'; /* 구멍은 불투명한 색으로 뚫어야 끝까지 비어요 */
        x.beginPath(); for (const r of L.wins) rr(x, r.x, r.y, r.w, r.h, r.r); x.fill();
        this.inside = c;
        /* 창에서 가까운 곳일수록 불꽃 빛을 많이 받아요 */
        const lit = mk(c.width, c.height);
        const lx = lit.getContext('2d');
        lx.drawImage(c, 0, 0);
        lx.globalCompositeOperation = 'source-in';
        lx.scale(this.dpr, this.dpr);
        const cx = V.x + V.w / 2, cy = V.y + V.h * 0.45;
        const g = lx.createRadialGradient(cx, cy, Math.min(V.w, V.h) * 0.3, cx, cy, Math.max(w, h) * 0.75);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(1, 'rgba(255,255,255,0.12)');
        lx.fillStyle = g; lx.fillRect(0, 0, w, h);
        this.lit = lit;
        this.tint = mk(c.width, c.height);
        const rc = mk(c.width, c.height);
        const rx = rc.getContext('2d');
        rx.scale(this.dpr, this.dpr);
        paintReflection(rx, w, h, L, this.view);
        rx.globalCompositeOperation = 'destination-in';
        rx.fillStyle = '#000';
        rx.beginPath(); for (const r of L.wins) rr(rx, r.x, r.y, r.w, r.h, r.r); rx.fill();
        this.glassRefl = rc;
      }
      if (L.card) {
        /* 카드: 창 위쪽 테두리만 살짝 */
        this.cardTop = true;
      }
      this.handles = L.handles.map((hd) => ({ ...hd, a: rand(-0.05, 0.05), w: 0, ph: rand(0, TAU) }));

      /* 불꽃 */
      this.shells = [];
      this.parts = [];
      this.bursts = [];
      this.smoke = [];
      this.fwX = 0;
      this.next = rand(0.2, 0.8);
      /* 축제에서 가끔 오는 피날레: rushIn 초 뒤에 rushLeft 초 동안. rushK 는 0(축제)~1(피날레)로 4초에 걸쳐 차오르고 잦아들어요 */
      this.demoRush = d.rush === 'demo';
      this.rushIn = this.demoRush ? 10 : 60;
      this.rushLeft = 0;
      this.rushK = 0;
      this.flash = 0;
      this.flashC = [255, 220, 170];

      /* 다리 */
      this.near = 0;
      this.nearV = 300 * this.S;
      this.panel = 290 * this.S;
      this.joltT = 9;
      this.nextJoint = this.panel * 2.6;
      this.ripples = Array.from({ length: Math.round(46 * Math.max(1, V.w / 360)) }, () => ({ z: Math.random(), x: rand(0, 1) }));

      /* 손가락 (설명용) */
      this.autoT = 1.4;
      this.fingerAt = null;

      /* 처음 볼 때 이미 불꽃이 몇 개 떠 있게 */
      for (let i = 0; i < 120; i++) this.step(1 / 30, true);
      this.sync();
    }

    sync() {
      const sc = this.screen;
      if (!sc) return;
      sc.querySelectorAll('[data-sub-act="show"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === this.show.v));
      const rush = this.show === SHOWS[1] && this.rushLeft > 0;
      sc.querySelectorAll('[data-stat="show"]').forEach((e) => { e.textContent = rush ? '축제 · 피날레' : this.show.name; });
      sc.querySelectorAll('[data-stat="shots"]').forEach((e) => { e.textContent = `${this.shots}발`; });
    }

    action(act, value) {
      if (act === 'show') { this.show = showOf(Number(value)); this.next = Math.min(this.next, 0.3); this.sync(); }
      if (act === 'fire') {
        const V = this.V;
        this.launch(this.fwX + V.x + rand(0.2, 0.8) * V.w, this.hy - rand(0.45, 0.75) * (this.hy - V.y), true);
      }
    }

    /* 강 위 바지선에서 한 발 쏘아 올려요. tx, ty 는 터질 자리 (화면 좌표에 불꽃 층 이동을 더한 값) */
    launch(wx, ty, loud, type) {
      const S = this.S;
      const rise = clamp((this.hy - ty) / (260 * S), 0.7, 1.9);
      this.shells.push({ wx, y: this.hy + 1, y0: this.hy + 1, ty, t: 0, dur: rise, type: type || pickType(this.rushK > 0.5 ? SHOWS[2].types : this.show.types), pal: pick(PALS), loud });
    }

    burst(s) {
      const S = this.S;
      const big = s.type === 'willow' || s.type === 'palm' ? 1.15 : 1;
      const R = rand(50, 96) * S * big;
      const c1 = COL[s.pal[0]], c2 = COL[s.pal[1] || s.pal[0]];
      const x0 = s.wx, y0 = s.ty;
      const add = (o) => { if (this.parts.length < 2200) this.parts.push(o); };
      const n = { peony: 130, chrys: 100, willow: 80, ring: 72, palm: 12, glitter: 130 }[s.type] || 100;
      for (let i = 0; i < n; i++) {
        let dx, dy;
        if (s.type === 'ring') {
          const a = (i / n) * TAU, tilt = 0.55;
          dx = Math.cos(a); dy = Math.sin(a) * tilt;
        } else {
          const u = rand(-1, 1), a = rand(0, TAU), r = Math.sqrt(1 - u * u);
          dx = r * Math.cos(a); dy = u;
          if (s.type === 'palm') { const a2 = (i / n) * TAU + rand(-0.1, 0.1); dx = Math.cos(a2) * rand(0.85, 1); dy = Math.sin(a2) * rand(0.85, 1); }
        }
        const drag = s.type === 'willow' ? 2.6 : s.type === 'palm' ? 1.5 : 2.1;
        const v = R * drag * rand(0.9, 1.05);
        const life = s.type === 'willow' ? rand(2.8, 3.6) : s.type === 'palm' ? rand(1.8, 2.3) : s.type === 'glitter' ? rand(1.5, 2.2) : rand(1.3, 1.9);
        const c = s.type === 'willow' ? COL.gold : (i % 2 ? c2 : c1);
        add({ x: x0, y: y0, vx: dx * v, vy: dy * v, age: 0, life, c, drag, g: (s.type === 'willow' ? 42 : 26) * S,
          size: (s.type === 'palm' ? 8 : s.type === 'willow' ? 5 : 5.8) * S, trail: s.type === 'chrys' || s.type === 'willow' || s.type === 'palm' ? [] : null,
          tw: s.type === 'glitter' });
      }
      /* 가운데 섬광 */
      this.bursts.push({ wx: x0, y: y0, c: c1, age: 0, R, power: s.type === 'palm' ? 0.8 : 1 });
      this.smoke.push({ wx: x0 + rand(-10, 10) * S, y: y0 + rand(-8, 8) * S, r: R * rand(0.8, 1.1), age: 0, life: rand(16, 26), a: rand(0.05, 0.09) });
      if (this.smoke.length > 26) this.smoke.shift();
      this.shots++;
      if (s.loud) boom(0.01, s.type === 'willow' || s.type === 'palm');
    }

    step(dt, quiet) {
      this.t += dt;
      const S = this.S, V = this.V;
      /* 바깥이 흘러가요: 먼 빌딩은 아주 천천히, 불꽃 층은 조금 더 빨리 */
      this.near += this.nearV * dt;
      this.skyX += this.nearV * 0.009 * dt;
      this.fwX += this.nearV * 0.014 * dt;
      for (const c of this.cars) { c.x += c.v * dt; if (c.x < 0) c.x += this.PW; if (c.x > this.PW) c.x -= this.PW; }
      /* 레일 이음매: 덜컹 */
      if (this.near > this.nextJoint) { this.nextJoint += this.panel * 2.6; this.joltT = 0; for (const hd of this.handles) hd.w += rand(0.12, 0.22); }
      this.joltT += dt;

      /* 손잡이 흔들림 */
      for (const hd of this.handles) {
        const drive = 0.05 * Math.sin(this.t * 0.62 + hd.ph) + 0.03 * Math.sin(this.t * 1.7 + hd.ph * 2.3);
        hd.w += (-(9.8 / 0.42) * (hd.a - drive) - 0.9 * hd.w) * dt;
        hd.a += hd.w * dt;
      }

      /* 축제에서 가끔 오는 피날레. 드문드문에서는 오지 않아요 (잠들기 전에 깨우지 않게) */
      if (this.show === SHOWS[1]) {
        if (this.rushLeft > 0) {
          this.rushLeft -= dt;
          if (this.rushLeft <= 0) { this.rushLeft = 0; this.rushIn = this.demoRush ? 16 : rand(180, 300); this.sync(); }
        } else if ((this.rushIn -= dt) <= 0) { this.rushLeft = this.demoRush ? 8 : 30; this.sync(); }
      } else if (this.rushLeft > 0) { this.rushLeft = 0; this.sync(); }
      this.rushK = clamp(this.rushK + (this.rushLeft > 0 ? dt : -dt) / 4, 0, 1);

      /* 다음 불꽃 */
      this.next -= dt;
      if (this.next <= 0) {
        const k = this.show === SHOWS[1] ? this.rushK : 0;
        const multi = mix(this.show.multi, SHOWS[2].multi, k);
        const n = Math.random() < multi ? (Math.random() < 0.4 ? 3 : 2) : 1;
        const cx = rand(0.18, 0.82);
        for (let i = 0; i < n; i++) {
          const fx = clamp(cx + (n > 1 ? (i - (n - 1) / 2) * rand(0.16, 0.24) : 0), 0.08, 0.92);
          this.launch(this.fwX + V.x + fx * V.w, this.hy - rand(0.42, 0.8) * (this.hy - Math.max(V.y, 0)), false, n > 1 && i > 0 ? this.shells[this.shells.length - 1].type : undefined);
        }
        const g = this.show.gap, f = SHOWS[2].gap;
        this.next = rand(mix(g[0], f[0], k), mix(g[1], f[1], k)) / Math.pow(this.area, 0.7);
      }

      /* 손가락 (설명용) */
      if (this.auto && !quiet) this.stepFinger(dt);

      for (const s of this.shells) {
        s.t += dt;
        const k = clamp(s.t / s.dur, 0, 1);
        const e = 1 - Math.pow(1 - k, 2.2);
        s.y = mix(s.y0, s.ty, e);
        if (Math.random() < 0.8) this.parts.push({ x: s.wx + rand(-0.6, 0.6) * S, y: s.y, vx: rand(-6, 6) * S, vy: rand(4, 18) * S, age: 0, life: rand(0.3, 0.6), c: COL.gold, drag: 3, g: 10 * S, size: 2.2 * S, trail: null, tw: true, dim: 0.5 });
      }
      for (let i = this.shells.length - 1; i >= 0; i--) {
        const s = this.shells[i];
        if (s.t >= s.dur) { this.shells.splice(i, 1); this.burst(s); }
      }
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const p = this.parts[i];
        p.age += dt;
        if (p.age >= p.life) { this.parts.splice(i, 1); continue; }
        if (p.trail) { p.trail.push(p.x, p.y); if (p.trail.length > 16) p.trail.splice(0, 2); }
        const f = Math.exp(-p.drag * dt);
        p.vx *= f; p.vy = p.vy * f + p.g * dt;
        p.x += p.vx * dt; p.y += p.vy * dt;
      }
      let fl = 0, fc = [0, 0, 0];
      for (let i = this.bursts.length - 1; i >= 0; i--) {
        const b = this.bursts[i];
        b.age += dt;
        if (b.age > 3) { this.bursts.splice(i, 1); continue; }
        const k = b.power * (Math.exp(-b.age * 7) * 0.9 + Math.exp(-b.age * 1.3) * 0.25);
        fl += k; fc[0] += b.c[0] * k; fc[1] += b.c[1] * k; fc[2] += b.c[2] * k;
      }
      /* 실내를 물들이는 빛은 부드럽게 따라가요: 피날레에서도 번쩍이지 않게 (1초에 세 번 넘게 깜빡이지 않게) */
      this.flash += (Math.min(1, fl) - this.flash) * Math.min(1, dt * 5);
      if (fl > 0.001) this.flashC = [mix(fc[0] / fl, 255, 0.35), mix(fc[1] / fl, 255, 0.35), mix(fc[2] / fl, 255, 0.35)];
      for (let i = this.smoke.length - 1; i >= 0; i--) {
        const m = this.smoke[i];
        m.age += dt; m.wx += 3 * S * dt; m.y -= 0.6 * S * dt; m.r += 1.2 * S * dt;
        if (m.age > m.life) this.smoke.splice(i, 1);
      }
    }

    stepFinger(dt) {
      this.autoT -= dt;
      const f = this.finger;
      if (this.autoT <= 0) {
        const V = this.V;
        const x = V.x + rand(0.22, 0.78) * V.w;
        const y = Math.max(V.y, 0) + rand(0.16, 0.36) * (this.hy - Math.max(V.y, 0));
        this.fingerAt = { x, y, t: 0 };
        this.autoT = 3.4;
      }
      if (this.fingerAt) {
        const a = this.fingerAt;
        a.t += dt;
        if (f) {
          f.style.transform = `translate(${a.x}px, ${a.y}px) scale(${a.t < 0.25 ? 1.15 - a.t * 0.6 : 1})`;
          f.style.opacity = a.t < 0.9 ? '1' : String(clamp(1 - (a.t - 0.9) / 0.4, 0, 1));
        }
        if (!a.fired && a.t > 0.12) { a.fired = true; this.launch(this.fwX + a.x, a.y, false); }
        if (a.t > 1.4) this.fingerAt = null;
      }
    }

    pointer(x, y) {
      const ac = audio();
      if (ac && ac.state === 'suspended') ac.resume();
      const V = this.V;
      if (this.framed && !this.L.wins.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h)) return;
      const top = Math.max(V.y, 0) + 0.08 * (this.hy - Math.max(V.y, 0));
      const ty = y < this.hy - 24 * this.S ? Math.max(y, top) : this.hy - rand(0.5, 0.7) * (this.hy - Math.max(V.y, 0));
      this.launch(this.fwX + x, ty, true);
    }

    /* ---------- 그리기 ---------- */
    draw() {
      const { ctx: x, w, h, dpr, V, S } = this;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.globalCompositeOperation = 'source-over';
      x.globalAlpha = 1;
      const jolt = this.joltT < 0.5 ? Math.sin(this.joltT * 46) * Math.exp(-this.joltT * 10) * 1.1 * S : 0;
      const bob = Math.sin(this.t * 1.9) * 0.35 * S + jolt;
      x.save();
      x.translate(0, bob);
      this.drawSky(x);
      this.drawSkyline(x);
      this.drawSmoke(x);
      this.drawFire(x);
      this.drawWater(x);
      this.drawNear(x);
      x.restore();
      if (this.inside) {
        x.setTransform(1, 0, 0, 1, 0, 0);
        x.drawImage(this.inside, 0, 0);
        if (this.flash > 0.01) {
          const t = this.tint.getContext('2d');
          t.globalCompositeOperation = 'source-over';
          t.clearRect(0, 0, this.tint.width, this.tint.height);
          t.drawImage(this.lit, 0, 0);
          t.globalCompositeOperation = 'source-in';
          t.fillStyle = rgba(this.flashC, 1);
          t.fillRect(0, 0, this.tint.width, this.tint.height);
          x.globalCompositeOperation = 'lighter';
          x.globalAlpha = clamp(this.flash * 0.32, 0, 0.3);
          x.drawImage(this.tint, 0, 0);
          x.globalAlpha = 1;
          x.globalCompositeOperation = 'source-over';
        }
        x.globalCompositeOperation = 'screen';
        x.globalAlpha = this.view === 'glass' ? 0.17 : 0.1;
        x.drawImage(this.glassRefl, 0, 0);
        x.globalAlpha = 1;
        x.globalCompositeOperation = 'source-over';
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (this.cardTop) this.drawCardFrame(x);
      this.drawHandles(x);
    }

    drawSky(x) {
      const { w, V, hy, S } = this;
      const top = Math.min(0, V.y);
      x.fillStyle = vgrad(x, Math.max(V.y, 0), hy, [[0, '#04060f'], [0.5, '#0a0e22'], [0.82, '#1b1a33'], [0.94, '#3a2a3c'], [1, '#4c3236']]);
      x.fillRect(0, top - 20, w, hy - top + 20);
      /* 불꽃 빛에 하늘이 물들어요 */
      if (this.flash > 0.02) {
        x.globalCompositeOperation = 'lighter';
        for (const b of this.bursts) {
          const k = b.power * Math.exp(-b.age * 4.5);
          if (k < 0.02) continue;
          const bx = b.wx - this.fwX, R = b.R * 2.6;
          const g = x.createRadialGradient(bx, b.y, 0, bx, b.y, R);
          g.addColorStop(0, rgba(b.c, 0.13 * k)); g.addColorStop(1, rgba(b.c, 0));
          x.fillStyle = g; x.fillRect(bx - R, b.y - R, R * 2, R * 2);
        }
        x.globalCompositeOperation = 'source-over';
      }
    }

    drawSkyline(x) {
      const { sky, PW, hy, dpr, S } = this;
      const off = ((this.skyX % PW) + PW) % PW;
      const y0 = hy - sky.HT;
      for (let k = -1; k <= Math.ceil(this.w / PW) + 1; k++) {
        const X = k * PW - off;
        if (X > this.w || X + PW < 0) continue;
        x.drawImage(sky.c, 0, 0, sky.c.width, sky.HT * dpr, X, y0, PW, sky.HT);
      }
      /* 높은 빌딩 꼭대기 빨간 항공등 */
      const on = Math.sin(this.t * 3.2) > 0.2;
      if (on) {
        x.fillStyle = 'rgba(255,70,60,0.95)';
        for (const tp of sky.tops) {
          for (let k = -1; k <= 1; k++) {
            const X = tp.x - off + k * PW;
            if (X < -4 || X > this.w + 4) continue;
            x.fillRect(X - 1.2 * S, y0 + tp.y - 2 * S, 2.4 * S, 2.4 * S);
          }
        }
      }
      /* 먼 다리 위 차 불빛 */
      for (const c of this.cars) {
        for (let k = -1; k <= 1; k++) {
          const X = c.x - off + k * PW;
          if (X < -4 || X > this.w + 4) continue;
          x.fillStyle = c.v > 0 ? 'rgba(255,240,220,0.9)' : 'rgba(255,90,80,0.85)';
          x.fillRect(X, y0 + sky.by - 2.2 * S, 1.6 * S, 1.1 * S);
        }
      }
    }

    drawSmoke(x) {
      const sp = smokeSprite();
      const fl = this.flash;
      for (const m of this.smoke) {
        const a = m.a * Math.min(1, m.age * 2) * (1 - m.age / m.life);
        if (a <= 0.002) continue;
        const X = m.wx - this.fwX;
        x.globalAlpha = a;
        x.drawImage(sp, X - m.r, m.y - m.r * 0.8, m.r * 2, m.r * 1.6);
        if (fl > 0.05) {
          x.globalCompositeOperation = 'lighter';
          x.globalAlpha = a * fl * 2.2;
          x.drawImage(glow(this.flashC), X - m.r, m.y - m.r * 0.8, m.r * 2, m.r * 1.6);
          x.globalCompositeOperation = 'source-over';
        }
      }
      x.globalAlpha = 1;
    }

    drawFire(x) {
      const S = this.S;
      x.globalCompositeOperation = 'lighter';
      /* 올라가는 불꽃 */
      for (const s of this.shells) {
        const X = s.wx - this.fwX;
        x.globalAlpha = 0.9;
        x.drawImage(sprite(COL.gold), X - 4 * S, s.y - 4 * S, 8 * S, 8 * S);
      }
      /* 막 터진 불꽃 둘레가 은은하게 번져요 */
      for (const b of this.bursts) {
        const k = Math.exp(-b.age * 1.6) * b.power;
        if (k < 0.03) continue;
        const r = b.R * (1.25 + b.age * 0.2);
        x.globalAlpha = 0.5 * k;
        x.drawImage(glow(b.c), b.wx - this.fwX - r, b.y - r, r * 2, r * 2);
      }
      /* 터지는 순간 가운데 섬광 */
      for (const b of this.bursts) {
        if (b.age > 0.35) continue;
        const k = 1 - b.age / 0.35;
        const r = b.R * (0.35 + b.age * 1.2);
        x.globalAlpha = 0.85 * k * k * b.power;
        x.drawImage(sprite([255, 246, 228]), b.wx - this.fwX - r, b.y - r, r * 2, r * 2);
      }
      for (const p of this.parts) {
        const lf = p.age / p.life;
        let a = Math.pow(1 - lf, 1.4) * (p.dim || 1);
        if (p.tw && lf > 0.35) a *= Math.random() < 0.55 ? 1 : 0.15;
        if (lf > 0.78 && !p.tw) a *= 0.6 + Math.random() * 0.4;
        if (a < 0.02) continue;
        const X = p.x - this.fwX;
        if (p.trail && p.trail.length > 3) {
          x.globalAlpha = a * 0.5;
          x.strokeStyle = rgba(p.c, 1);
          x.lineWidth = p.size * 0.32;
          x.beginPath();
          x.moveTo(p.trail[0] - this.fwX, p.trail[1]);
          for (let j = 2; j < p.trail.length; j += 2) x.lineTo(p.trail[j] - this.fwX, p.trail[j + 1]);
          x.lineTo(X, p.y);
          x.stroke();
        }
        const s = p.size * (1 - lf * 0.4);
        x.globalAlpha = a;
        x.drawImage(sprite(p.c), X - s, p.y - s, s * 2, s * 2);
      }
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-over';
    }

    drawWater(x) {
      const { w, h, V, hy, S, dpr, PW } = this;
      const bot = Math.max(V.y + V.h, hy + 10) + 40;
      x.fillStyle = vgrad(x, hy, bot, [[0, '#141428'], [0.25, '#0b0d1c'], [1, '#04050b']]);
      x.fillRect(0, hy, w, bot - hy + 200);
      /* 물에 비친 빌딩 (가로 띠마다 조금씩 일렁여요) */
      const off = ((this.skyX % PW) + PW) % PW;
      const RH = this.sky.HT * 1.25;
      const band = 3 * S;
      for (let yy = 0; yy < RH; yy += band) {
        const dx = Math.sin(this.t * 1.4 + yy * 0.21) * 1.6 * S + Math.sin(this.t * 0.7 + yy * 0.05) * 1.2 * S;
        const a = 0.55 * Math.pow(1 - yy / RH, 1.3);
        if (a < 0.02) continue;
        x.globalAlpha = a;
        const sy = (yy / RH) * this.refl.height;
        const sh = Math.max(1, (band / RH) * this.refl.height);
        for (let k = -1; k <= Math.ceil(w / PW) + 1; k++) {
          const X = k * PW - off + dx;
          if (X > w || X + PW < 0) continue;
          x.drawImage(this.refl, 0, sy, this.refl.width, sh, X, hy + yy, PW, band + 0.5);
        }
      }
      x.globalAlpha = 1;
      /* 물에 비친 불꽃 */
      x.globalCompositeOperation = 'lighter';
      for (const b of this.bursts) {
        const k = b.power * (Math.exp(-b.age * 2.2) * 0.6 + 0.1 * Math.exp(-b.age * 0.6));
        if (k < 0.02) continue;
        const X = b.wx - this.fwX;
        const my = hy + (hy - b.y) * 0.5;
        const rw = b.R * 1.1, rh = b.R * 0.9;
        x.globalAlpha = 0.38 * k;
        x.drawImage(sprite(b.c), X - rw, my - rh, rw * 2, rh * 2);
      }
      for (let i = 0; i < this.parts.length; i += 3) {
        const p = this.parts[i];
        const lf = p.age / p.life;
        const a = Math.pow(1 - lf, 1.5) * 0.28 * (p.dim || 1);
        if (a < 0.03 || p.y > hy) continue;
        const my = hy + (hy - p.y) * 0.5;
        if (my > bot) continue;
        const X = p.x - this.fwX + Math.sin(this.t * 3 + my * 0.3) * 2 * S;
        x.globalAlpha = a;
        x.drawImage(sprite(p.c), X - p.size * 0.7, my - p.size * 2.2, p.size * 1.4, p.size * 4.4);
      }
      x.globalAlpha = 1;
      x.globalCompositeOperation = 'source-over';
      /* 다리 가까운 물결: 가까울수록 빨리 지나가요 */
      const span = bot - 40 - hy;
      const fc = this.flashC, fl = this.flash;
      for (const r of this.ripples) {
        const z = r.z;
        const yy = hy + span * Math.pow(z, 1.7);
        const sp = this.nearV * 0.16 * Math.pow(z, 2.2) + 2 * S;
        r.x -= (sp * (1 / 30)) / (V.w + 80);
        if (r.x < -0.1) { r.x += 1.2; r.z = Math.random(); }
        const X = V.x - 40 + r.x * (V.w + 80);
        const len = (5 + 34 * z * z) * S;
        const a = (0.05 + 0.12 * z) + fl * 0.25 * z;
        x.fillStyle = fl > 0.05 ? `rgba(${mix(150, fc[0], 0.6) | 0},${mix(160, fc[1], 0.6) | 0},${mix(200, fc[2], 0.6) | 0},${a})` : `rgba(150,160,200,${a})`;
        x.fillRect(X, yy, len, Math.max(0.8, 1.2 * z * S));
      }
    }

    /* 가까운 다리 철골 · 난간 · 전차선 기둥. 빠르게 지나가니 번지게 그려요 */
    drawNear(x) {
      const { V, S, panel, hy } = this;
      const fl = this.flash, fc = this.flashC;
      const lit = (base, k) => (fl > 0.03 ? `rgba(${mix(base[0], fc[0], fl * k) | 0},${mix(base[1], fc[1], fl * k) | 0},${mix(base[2], fc[2], fl * k) | 0},` : `rgba(${base[0]},${base[1]},${base[2]},`);
      const blur = this.nearV / 26;
      const top = Math.min(V.y, 0) - 60 * S, bot = V.y + V.h + 70 * S;
      const steel = lit([15, 17, 23], 0.16), rim = lit([90, 98, 116], 0.4);
      const truss = this.bridge === 'truss' ? true : this.bridge === 'open' ? false : null;
      const PER = 12; /* 철골 7칸 + 탁 트인 5칸 */
      const i0 = Math.floor((this.near - panel) / panel), i1 = Math.ceil((this.near + V.w + V.x + panel * 2) / panel);
      const sx = (i) => V.x + i * panel - this.near;
      const inTruss = (i) => (truss !== null ? truss : ((i % PER) + PER) % PER < 7);
      const mw = 26 * S;
      for (let i = i0; i <= i1; i++) {
        const X = sx(i);
        if (inTruss(i) && inTruss(i + 1)) {
          /* 사선 */
          const up = i % 2 === 0;
          const xa = X, xb = X + panel;
          const ya = up ? bot : top, yb = up ? top : bot;
          x.lineCap = 'butt';
          for (let k = 0; k < 4; k++) {
            const o = (k - 1.5) * blur * 0.32;
            x.strokeStyle = steel + (k === 1 || k === 2 ? 0.55 : 0.28) + ')';
            x.lineWidth = mw * 0.8;
            x.beginPath(); x.moveTo(xa + o, ya); x.lineTo(xb + o, yb); x.stroke();
          }
          x.strokeStyle = rim + '0.22)'; x.lineWidth = 1.5 * S;
          x.beginPath(); x.moveTo(xa - mw * 0.4, ya); x.lineTo(xb - mw * 0.4, yb); x.stroke();
        }
        if (inTruss(i)) {
          /* 세로 기둥 */
          const g = x.createLinearGradient(X - mw / 2 - blur, 0, X + mw / 2 + blur, 0);
          g.addColorStop(0, steel + '0)'); g.addColorStop(0.3, steel + '0.85)'); g.addColorStop(0.7, steel + '0.85)'); g.addColorStop(1, steel + '0)');
          x.fillStyle = g;
          x.fillRect(X - mw / 2 - blur, top, mw + blur * 2, bot - top);
          x.fillStyle = rim + '0.18)'; x.fillRect(X - mw / 2, top, 1.5 * S, bot - top);
        }
      }
      /* 철골 구간 위아래 가로 보 (문 · 창 가까이처럼 창이 높을 때 보여요) */
      const chordTop = V.y + 10 * S, chordBot = V.y + V.h - 12 * S;
      for (let i = i0; i <= i1; i++) {
        if (!inTruss(i) || !inTruss(i + 1)) continue;
        const X = sx(i);
        if (this.view === 'door' || this.view === 'glass') {
          x.fillStyle = steel + '0.7)'; x.fillRect(X, chordTop - 16 * S, panel, 14 * S);
        }
        x.fillStyle = steel + '0.75)'; x.fillRect(X, chordBot, panel, 40 * S);
      }
      /* 탁 트인 구간: 낮은 난간 · 가끔 전차선 기둥 */
      for (let i = i0; i <= i1; i++) {
        if (inTruss(i) && inTruss(i + 1)) continue;
        const X = sx(i);
        const ry = chordBot - 4 * S;
        x.fillStyle = steel + '0.7)'; x.fillRect(X, ry, panel, 4 * S);
        x.fillStyle = steel + '0.5)'; x.fillRect(X, ry + 18 * S, panel, 3 * S);
        for (let p = 0; p < panel; p += 36 * S) x.fillRect(X + p, ry, 3 * S + blur * 0.2, 40 * S);
        if (((i % 3) + 3) % 3 === 0) {
          const g = x.createLinearGradient(X - 8 * S - blur * 0.6, 0, X + 8 * S + blur * 0.6, 0);
          g.addColorStop(0, steel + '0)'); g.addColorStop(0.5, steel + '0.8)'); g.addColorStop(1, steel + '0)');
          x.fillStyle = g; x.fillRect(X - 8 * S - blur * 0.6, top, 16 * S + blur * 1.2, bot - top);
          x.fillRect(X, V.y + V.h * 0.06, 60 * S, 4 * S);
        }
      }
    }

    drawCardFrame(x) {
      const { w, h } = this;
      x.fillStyle = vgrad(x, 0, h * 0.12, [[0, 'rgba(26,28,34,0.95)'], [1, 'rgba(26,28,34,0)']]);
      x.fillRect(0, 0, w, h * 0.12);
    }

    drawHandles(x) {
      if (!this.handles.length) return;
      const S = this.view === 'card' ? (this.h / 156) * 0.55 : 1;
      const fl = this.flash, fc = this.flashC;
      const y0 = this.L.bar || -2;
      for (const hd of this.handles) {
        x.save();
        x.translate(hd.x, y0);
        x.rotate(hd.a);
        const len = hd.len;
        const base = [196, 200, 210];
        const c = fl > 0.03 ? [mix(base[0], fc[0], fl * 0.35), mix(base[1], fc[1], fl * 0.35), mix(base[2], fc[2], fl * 0.35)] : base;
        x.fillStyle = rgba([c[0] * 0.55, c[1] * 0.55, c[2] * 0.6], 0.95);
        x.fillRect(-3 * S, 0, 6 * S, len);
        x.fillStyle = rgba(c, 0.5); x.fillRect(-3 * S, 0, 1.5 * S, len);
        x.strokeStyle = rgba(c, 0.95); x.lineWidth = 4.2 * S;
        x.beginPath(); x.ellipse(0, len + 12 * S, 10 * S, 12 * S, 0, 0, TAU); x.stroke();
        x.strokeStyle = 'rgba(255,255,255,0.4)'; x.lineWidth = 1.2 * S;
        x.beginPath(); x.ellipse(0, len + 12 * S, 10 * S, 12 * S, 0, Math.PI * 1.1, Math.PI * 1.6); x.stroke();
        x.restore();
      }
    }
  }

  window.MongSubway = { Subway };

  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { if (e.target.__sub) e.target.__sub.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-subway]').forEach((c) => {
      const sc = new Subway(c);
      c.__sub = sc;
      scenes.push(sc);
      sc.draw();
      if (io) io.observe(c);
      c.addEventListener('pointerdown', (e) => {
        const r = c.getBoundingClientRect();
        sc.pointer((e.clientX - r.left) * (sc.w / r.width), (e.clientY - r.top) * (sc.h / r.height));
      });
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-sub-act]');
      if (!b) return;
      const ac = audio();
      if (ac && ac.state === 'suspended') ac.resume();
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-subway]');
      if (c && c.__sub) c.__sub.action(b.dataset.subAct, b.dataset.value);
    });
    let last = 0;
    let tick = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (!last) { last = now; return; }
      const elapsed = (now - last) / 1000;
      if (elapsed < 1 / 31) return;
      last = now;
      const dt = Math.min(elapsed, 0.05);
      tick++;
      for (const sc of scenes) {
        if (!sc.visible) continue;
        sc.step(dt);
        sc.draw();
        if (tick % 15 === 0) sc.sync();
      }
    };
    requestAnimationFrame(loop);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
