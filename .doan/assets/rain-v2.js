/* mong — 비멍 v2 시안용 장면 (Doan 보드 전용). 코드(src/scenes/rain.ts)에는 아직 없어요.
   지금 비멍은 흐린 빛 동그라미 위에 빗방울을 얹어요. v2는 창밖 도시를 한 번 또렷하게 그린 뒤
   '맑은 유리로 본 모습'과 '김 서린 유리로 본 모습' 두 장을 만들고, 김 서림 마스크로 섞어요.
   빗방울은 또렷한 도시를 거꾸로 비춰서 작은 렌즈처럼 보여요.
   <canvas data-rain2> 하나가 장면 하나. 같은 .screen 안의 [data-rain2-act] 버튼이 장면을 조작해요.
     data-frame="sill|none"     창틀 · 창턱을 그릴지 (기본 sill)
     data-intensity="0.6"       비 세기 0~1
     data-fog="0.55"            김 서림 정도 0~1
     data-thunder="on"          천둥 켜짐,  data-thunder-every="6" n초마다 번개 (설명용)
     data-auto-wipe="12"        n초마다 손가락이 창을 닦아요 (설명용, [data-wipe-finger] 를 움직여요)
     data-prewipe               처음부터 한 번 닦인 채로 시작
     data-hold-fog              닦은 자리가 다시 서리지 않게 고정 */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const ease = (x) => x * x * (3 - 2 * x);

  const LEVELS = [{ v: 0.25, label: '보슬비' }, { v: 0.6, label: '비' }, { v: 1, label: '장대비' }];
  const WIN = ['255,206,140', '255,176,96', '255,224,180', '190,214,255', '255,150,100'];
  const NEON = [[255, 93, 143], [79, 224, 208], [255, 170, 70]];
  const BOKEH = [[255, 176, 96], [255, 210, 140], [255, 150, 90], [130, 176, 255], [255, 128, 168], [210, 225, 255]];

  function mk(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  const HAS_FILTER = (() => {
    const x = mk(1, 1).getContext('2d');
    return !!x && 'filter' in x;
  })();

  /* 흐리게 한 복사본. ctx.filter 가 없는 브라우저에서는 줄였다 늘려서 흐려요. */
  function blurred(src, w, h, radius) {
    const out = mk(w, h);
    const x = out.getContext('2d');
    if (HAS_FILTER) {
      const m = radius * 2;
      x.filter = `blur(${radius}px)`;
      x.drawImage(src, -m, -m, w + m * 2, h + m * 2);
      x.filter = 'none';
      return out;
    }
    let cur = src, cw = w, ch = h;
    const target = Math.max(1, radius * 0.8);
    let f = 1;
    while (f < target) {
      f *= 2;
      const nw = Math.max(2, Math.round(w / f)), nh = Math.max(2, Math.round(h / f));
      const n = mk(nw, nh);
      const nx = n.getContext('2d');
      nx.imageSmoothingQuality = 'high';
      nx.drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
      cur = n; cw = nw; ch = nh;
    }
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, cw, ch, 0, 0, w, h);
    return out;
  }

  const sprites = new Map();
  function sprite(key, S, paint) {
    if (sprites.has(key)) return sprites.get(key);
    const c = mk(S, S);
    paint(c.getContext('2d'), S);
    sprites.set(key, c);
    return c;
  }
  const glow = (r, g, b) => sprite(`g${r},${g},${b}`, 64, (x, S) => {
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(0.4, `rgba(${r},${g},${b},0.45)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
  });
  const disc = (r, g, b) => sprite(`d${r},${g},${b}`, 64, (x, S) => {
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(0.76, `rgba(${r},${g},${b},0.42)`);
    gr.addColorStop(0.9, `rgba(${r},${g},${b},0.62)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr; x.fillRect(0, 0, S, S);
  });
  /* 빗방울 테두리 · 반짝임. 방울 반지름은 스프라이트의 0.86배 */
  const SHADE_K = 0.86;
  const shade = () => sprite('shade', 96, (x, S) => {
    const c = S / 2, R = c * SHADE_K;
    x.save();
    x.beginPath(); x.arc(c, c, R, 0, TAU); x.clip();
    let g = x.createRadialGradient(c, c, R * 0.5, c, c, R);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.78, 'rgba(0,0,0,0.16)');
    g.addColorStop(1, 'rgba(0,0,0,0.62)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    g = x.createLinearGradient(0, c - R, 0, c + R * 0.1);
    g.addColorStop(0, 'rgba(0,0,0,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, S, S);
    x.strokeStyle = 'rgba(226,238,255,0.62)';
    x.lineWidth = R * 0.13;
    x.lineCap = 'round';
    x.beginPath(); x.arc(c, c, R * 0.82, Math.PI * 0.2, Math.PI * 0.8); x.stroke();
    x.restore();
    x.fillStyle = 'rgba(255,255,255,0.85)';
    x.beginPath(); x.ellipse(c - R * 0.32, c - R * 0.4, R * 0.17, R * 0.1, -0.6, 0, TAU); x.fill();
  });

  class Rain2 {
    constructor(canvas) {
      this.c = canvas;
      this.ctx = canvas.getContext('2d');
      this.screen = canvas.closest('.screen');
      const d = canvas.dataset;
      this.intensity = d.intensity !== undefined ? Number(d.intensity) : 0.6;
      this.thunder = d.thunder === 'on';
      this.thunderEvery = Number(d.thunderEvery) || 0;
      this.frame = d.frame || 'sill';
      this.fogAmt = d.fog !== undefined ? Number(d.fog) : 0.55;
      this.autoWipe = Number(d.autoWipe) || 0;
      this.prewipe = d.prewipe !== undefined;
      this.holdFog = d.holdFog !== undefined;
      this.finger = this.screen ? this.screen.querySelector('[data-wipe-finger]') : null;
      this.visible = true;
      this.t = 0;
      this.flash = 0;
      this.flashT = -1;
      this.nextFlash = this.thunderEvery ? 1.5 : 3;
      this.bolt = null;
      this.wipeT = -1;
      this.nextWipe = 2.5;
      this.wipeLast = null;
      this.fogAcc = 0;
      this.evapAcc = 0;
      this.hitAcc = 0;
      this.slideAcc = 0;
      this.carAcc = 1;
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
      this.s = clamp(Math.sqrt(w * h) / 573, 0.5, 1.35);
      this.area = clamp((w * h) / (390 * 844), 1, 3);
      this.wide = w > 900;
      this.sill = this.frame === 'sill';
      this.H = this.sill ? h - (this.wide ? 150 : 168) : h;
      this.ledge = (this.wide ? 26 : 22) * this.s;
      this.build();
    }

    /* ---------- 창밖 도시 ---------- */
    genCity() {
      const { w, H, s } = this;
      const far = [], mid = [];
      for (let bx = -20 * s; bx < w;) {
        const bw = rand(28, 72) * s;
        far.push({ x: bx, w: bw, top: H * 0.78 - rand(0.12, 0.4) * H });
        bx += bw + rand(0, 10) * s;
      }
      for (let bx = -30 * s; bx < w;) {
        const bw = rand(64, 132) * s, bh = rand(0.2, 0.52) * H;
        const b = { x: bx, w: bw, top: H * 0.84 - bh, h: bh, wins: [], tank: Math.random() < 0.35 };
        const cw = 14 * s, ch = 19 * s;
        const cols = Math.floor((bw - 8 * s) / cw), rows = Math.floor((bh - 16 * s) / ch);
        const ox = bx + (bw - cols * cw) / 2 + 3.5 * s;
        const lit = rand(0.12, 0.42);
        for (let r = 0; r < rows; r++) {
          for (let c2 = 0; c2 < cols; c2++) {
            if (Math.random() < lit) b.wins.push({ x: ox + c2 * cw, y: b.top + 10 * s + r * ch, c: pick(WIN) });
          }
        }
        mid.push(b);
        bx += bw + rand(4, 28) * s;
      }
      const lamps = [];
      const ln = this.wide ? 4 : 2;
      for (let i = 0; i < ln; i++) lamps.push({ x: (w * (i + 0.5 + rand(-0.12, 0.12))) / ln, y: H * 0.7 });
      const neons = [];
      const tall = mid.filter((b) => b.h > H * 0.3 && b.x > 0 && b.x + b.w < w);
      for (let i = 0; i < (this.wide ? 3 : 2) && tall.length; i++) {
        const b = tall.splice(Math.floor(Math.random() * tall.length), 1)[0];
        neons.push({ x: b.x + b.w * rand(0.62, 0.8), y: b.top + rand(24, 60) * s, w: 7 * s, h: rand(34, 52) * s, c: NEON[i % NEON.length] });
      }
      const tower = far.reduce((a, b) => (b.top < a.top ? b : a), far[0]);
      this.beacon = { x: tower.x + tower.w / 2, y: tower.top - 22 * s };
      this.city = { far, mid, lamps, neons, tower };
    }

    paintCity(x, flashing) {
      const { w, h, H, s } = this;
      const { far, mid, lamps, neons, tower } = this.city;
      let g = x.createLinearGradient(0, 0, 0, H * 0.84);
      if (flashing) {
        g.addColorStop(0, '#7e92c8'); g.addColorStop(1, '#c9d4f2');
      } else {
        g.addColorStop(0, '#070b16'); g.addColorStop(0.5, '#101a30'); g.addColorStop(1, '#222b45');
      }
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      if (!flashing) {
        g = x.createRadialGradient(w * 0.5, H * 0.84, 0, w * 0.5, H * 0.84, Math.max(w * 0.7, H * 0.55));
        g.addColorStop(0, 'rgba(255,150,90,0.24)'); g.addColorStop(1, 'rgba(255,150,90,0)');
        x.fillStyle = g; x.fillRect(0, 0, w, H);
        for (let i = 0; i < 9; i++) {
          const cx = rand(0, w), cy = rand(0, H * 0.4), r = rand(60, 150) * s;
          g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, 'rgba(70,86,120,0.2)'); g.addColorStop(1, 'rgba(70,86,120,0)');
          x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
      }
      x.fillStyle = flashing ? 'rgb(58,70,104)' : 'rgb(22,31,51)';
      for (const b of far) x.fillRect(b.x, b.top, b.w + 1, H - b.top);
      x.fillRect(tower.x + tower.w / 2 - s, tower.top - 22 * s, 2 * s, 22 * s);
      if (!flashing) {
        for (const b of far) {
          for (let wy = b.top + 6 * s; wy < H * 0.76; wy += 9 * s) {
            for (let wx = b.x + 4 * s; wx < b.x + b.w - 4 * s; wx += 7 * s) {
              if (Math.random() < 0.1) { x.fillStyle = `rgba(${pick(WIN)},0.5)`; x.fillRect(wx, wy, 2.4 * s, 3.4 * s); }
            }
          }
        }
      }
      x.fillStyle = flashing ? 'rgb(10,13,23)' : 'rgb(9,13,23)';
      for (const b of mid) {
        x.fillRect(b.x, b.top, b.w, H - b.top);
        if (b.tank) x.fillRect(b.x + b.w * 0.2, b.top - 9 * s, 20 * s, 9 * s);
      }
      /* 도로 */
      g = x.createLinearGradient(0, H * 0.84, 0, H);
      if (flashing) { g.addColorStop(0, 'rgb(40,50,74)'); g.addColorStop(1, 'rgb(20,26,40)'); }
      else { g.addColorStop(0, '#0d121d'); g.addColorStop(1, '#04060a'); }
      x.fillStyle = g; x.fillRect(0, H * 0.84, w, h - H * 0.84);
      if (flashing) return;
      for (const b of mid) {
        for (const wn of b.wins) {
          x.fillStyle = `rgba(${wn.c},0.16)`; x.fillRect(wn.x - 3 * s, wn.y - 3 * s, 13 * s, 16 * s);
          x.fillStyle = `rgba(${wn.c},0.92)`; x.fillRect(wn.x, wn.y, 7 * s, 10 * s);
        }
      }
      /* 젖은 도로에 비친 빛: 짧은 가로 줄을 겹쳐서 번진 느낌으로 */
      const smear = (cx, rgbStr, width, a) => {
        for (let y = H * 0.855; y < H + 12 * s; y += 3.2 * s) {
          const k = 1 - (y - H * 0.855) / (H * 0.16);
          if (k <= 0) break;
          x.fillStyle = `rgba(${rgbStr},${a * k * rand(0.4, 1)})`;
          const ww = width * rand(0.5, 1.5);
          x.fillRect(cx - ww / 2 + rand(-2, 2) * s, y, ww, 2 * s);
        }
      };
      for (const n of neons) {
        const [r, gg, b] = n.c;
        g = x.createRadialGradient(n.x, n.y + n.h / 2, 0, n.x, n.y + n.h / 2, 46 * s);
        g.addColorStop(0, `rgba(${r},${gg},${b},0.42)`); g.addColorStop(1, `rgba(${r},${gg},${b},0)`);
        x.fillStyle = g; x.fillRect(n.x - 50 * s, n.y - 30 * s, 100 * s, n.h + 60 * s);
        x.fillStyle = `rgb(${r},${gg},${b})`; x.fillRect(n.x - n.w / 2, n.y, n.w, n.h);
        smear(n.x, `${r},${gg},${b}`, 12 * s, 0.3);
      }
      for (const l of lamps) {
        x.fillStyle = 'rgb(4,6,10)';
        x.fillRect(l.x - 1.5 * s, l.y, 3 * s, H * 0.86 - l.y);
        x.fillRect(l.x - 9 * s, l.y - 2 * s, 12 * s, 3 * s);
        const hx = l.x - 8 * s, hy = l.y + 2 * s;
        g = x.createLinearGradient(0, hy, 0, H * 0.88);
        g.addColorStop(0, 'rgba(255,196,120,0.2)'); g.addColorStop(1, 'rgba(255,196,120,0)');
        x.fillStyle = g;
        x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx - 46 * s, H * 0.88); x.lineTo(hx + 46 * s, H * 0.88); x.closePath(); x.fill();
        g = x.createRadialGradient(hx, hy, 0, hx, hy, 62 * s);
        g.addColorStop(0, 'rgba(255,214,150,0.95)'); g.addColorStop(0.12, 'rgba(255,190,110,0.5)'); g.addColorStop(1, 'rgba(255,190,110,0)');
        x.fillStyle = g; x.fillRect(hx - 62 * s, hy - 62 * s, 124 * s, 124 * s);
        smear(hx, '255,196,120', 18 * s, 0.4);
      }
    }

    /* ---------- 창틀 · 창턱 · 소품 ---------- */
    mullions() {
      return this.wide ? [this.w * 0.27, this.w * 0.73] : [this.w * 0.5];
    }

    paintFrame(x) {
      const { w, h, H, s, wide, ledge } = this;
      const ft = (wide ? 15 : 9) * s, mw = (wide ? 11 : 8) * s;
      let g;
      /* 유리 가장자리 그늘 */
      const shadeEdge = (x0, y0, x1, y1, rx, ry, rw, rh) => {
        g = x.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(rx, ry, rw, rh);
      };
      shadeEdge(ft, 0, ft + 16 * s, 0, ft, 0, 16 * s, H);
      shadeEdge(w - ft, 0, w - ft - 16 * s, 0, w - ft - 16 * s, 0, 16 * s, H);
      shadeEdge(0, H, 0, H - 34 * s, 0, H - 34 * s, w, 34 * s);
      shadeEdge(0, ft, 0, ft + 20 * s, 0, ft, w, 20 * s);
      for (const mx of this.mullions()) {
        shadeEdge(mx - mw / 2, 0, mx - mw / 2 - 10 * s, 0, mx - mw / 2 - 10 * s, 0, 10 * s, H);
        shadeEdge(mx + mw / 2, 0, mx + mw / 2 + 10 * s, 0, mx + mw / 2, 0, 10 * s, H);
      }
      /* 틀 */
      const post = (px, pw) => {
        g = x.createLinearGradient(px, 0, px + pw, 0);
        g.addColorStop(0, '#0b0908'); g.addColorStop(0.55, '#1c1511'); g.addColorStop(1, '#0d0a09');
        x.fillStyle = g; x.fillRect(px, 0, pw, H);
        x.fillStyle = 'rgba(255,188,124,0.2)'; x.fillRect(px + pw - Math.max(1, s), 0, Math.max(1, s), H);
      };
      post(0, ft); post(w - ft, ft);
      for (const mx of this.mullions()) post(mx - mw / 2, mw);
      x.fillStyle = '#0c0a08'; x.fillRect(0, 0, w, ft);
      /* 창턱 윗면 */
      g = x.createLinearGradient(0, H, 0, H + ledge);
      g.addColorStop(0, '#3d2c20'); g.addColorStop(1, '#22180f');
      x.fillStyle = g; x.fillRect(0, H, w, ledge);
      g = x.createRadialGradient(w * 0.78, H + ledge / 2, 0, w * 0.78, H + ledge / 2, w * 0.5);
      g.addColorStop(0, 'rgba(255,176,104,0.3)'); g.addColorStop(1, 'rgba(255,176,104,0)');
      x.fillStyle = g; x.fillRect(0, H, w, ledge);
      g = x.createLinearGradient(0, H, 0, H + ledge * 0.6);
      g.addColorStop(0, 'rgba(150,180,230,0.16)'); g.addColorStop(1, 'rgba(150,180,230,0)');
      x.fillStyle = g; x.fillRect(0, H, w, ledge);
      x.fillStyle = 'rgba(255,214,160,0.3)'; x.fillRect(0, H + ledge - Math.max(1, s), w, Math.max(1, s));
      /* 창턱 아래 벽 */
      g = x.createLinearGradient(0, H + ledge, 0, h);
      g.addColorStop(0, '#16110e'); g.addColorStop(1, '#080606');
      x.fillStyle = g; x.fillRect(0, H + ledge, w, h - H - ledge);
      g = x.createLinearGradient(0, H + ledge, 0, H + ledge + 18 * s);
      g.addColorStop(0, 'rgba(0,0,0,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, H + ledge, w, 18 * s);

      /* 머그컵 */
      const base = H + ledge * 0.6;
      const mx = wide ? w * 0.135 : w * 0.21, mwid = 34 * s, mh = 38 * s;
      x.fillStyle = 'rgba(0,0,0,0.45)';
      x.beginPath(); x.ellipse(mx - 6 * s, base, mwid * 0.75, 4 * s, 0, 0, TAU); x.fill();
      x.strokeStyle = '#1a130f'; x.lineWidth = 5 * s;
      x.beginPath(); x.arc(mx - mwid / 2 - 1 * s, base - mh * 0.52, 9 * s, Math.PI * 0.5, Math.PI * 1.5); x.stroke();
      g = x.createLinearGradient(mx - mwid / 2, 0, mx + mwid / 2, 0);
      g.addColorStop(0, '#0e0b09'); g.addColorStop(0.7, '#2c2018'); g.addColorStop(1, '#5a3f2b');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(mx - mwid / 2, base - mh);
      x.lineTo(mx + mwid / 2, base - mh);
      x.lineTo(mx + mwid / 2 - 3 * s, base - 4 * s);
      x.quadraticCurveTo(mx + mwid / 2 - 3 * s, base, mx + mwid / 2 - 8 * s, base);
      x.lineTo(mx - mwid / 2 + 8 * s, base);
      x.quadraticCurveTo(mx - mwid / 2 + 3 * s, base, mx - mwid / 2 + 3 * s, base - 4 * s);
      x.closePath(); x.fill();
      x.fillStyle = '#3a2a1e';
      x.beginPath(); x.ellipse(mx, base - mh, mwid / 2, 4.5 * s, 0, 0, TAU); x.fill();
      x.fillStyle = '#090706';
      x.beginPath(); x.ellipse(mx, base - mh + 0.6 * s, mwid / 2 - 3 * s, 3 * s, 0, 0, TAU); x.fill();
      this.mug = { x: mx, y: base - mh - 2 * s };

      /* 화분 */
      const px = wide ? w * 0.9 : w * 0.8, pw = 40 * s, ph = 32 * s;
      x.fillStyle = 'rgba(0,0,0,0.45)';
      x.beginPath(); x.ellipse(px - 8 * s, base, pw * 0.7, 4 * s, 0, 0, TAU); x.fill();
      const leaves = [];
      for (let i = 0; i < 11; i++) leaves.push({ a: rand(-0.75, 0.75), L: rand(54, 118) * s, o: rand(-10, 10) * s });
      leaves.sort((a, b) => Math.abs(b.a) - Math.abs(a.a));
      for (const lf of leaves) {
        const bx = px + lf.o, by = base - ph + 2 * s;
        const tx = bx + Math.sin(lf.a) * lf.L * 1.05, ty = by - Math.cos(lf.a) * lf.L;
        const nx = Math.cos(lf.a), ny = Math.sin(lf.a);
        const wd = lf.L * 0.09 + 3 * s;
        const mxx = (bx + tx) / 2 + Math.sin(lf.a) * lf.L * 0.12, myy = (by + ty) / 2 - lf.L * 0.1;
        g = x.createLinearGradient(bx - wd, 0, bx + wd + Math.abs(tx - bx), 0);
        g.addColorStop(0, 'rgb(8,14,11)'); g.addColorStop(1, 'rgb(26,38,26)');
        x.fillStyle = g;
        x.beginPath();
        x.moveTo(bx - nx * 2 * s, by);
        x.quadraticCurveTo(mxx - nx * wd, myy - ny * wd, tx, ty);
        x.quadraticCurveTo(mxx + nx * wd, myy + ny * wd, bx + nx * 2 * s, by);
        x.closePath(); x.fill();
        x.strokeStyle = 'rgba(214,176,120,0.2)'; x.lineWidth = Math.max(1, s);
        x.beginPath(); x.moveTo(bx + nx * 2 * s, by); x.quadraticCurveTo(mxx + nx * wd, myy + ny * wd, tx, ty); x.stroke();
      }
      g = x.createLinearGradient(px - pw / 2, 0, px + pw / 2, 0);
      g.addColorStop(0, '#17100c'); g.addColorStop(0.65, '#3d291c'); g.addColorStop(1, '#74492f');
      x.fillStyle = g;
      x.beginPath();
      x.moveTo(px - pw / 2, base - ph); x.lineTo(px + pw / 2, base - ph);
      x.lineTo(px + pw / 2 - 6 * s, base); x.lineTo(px - pw / 2 + 6 * s, base);
      x.closePath(); x.fill();
      x.fillRect(px - pw / 2 - 2 * s, base - ph - 4 * s, pw + 4 * s, 7 * s);
    }

    /* ---------- 레이어 만들기 ---------- */
    build() {
      const { w, h, H, s, dpr } = this;
      this.genCity();
      const sharp = mk(w, h);
      this.paintCity(sharp.getContext('2d'), false);
      this.clear = blurred(sharp, w, h, 1.5 * s);

      const foggy = blurred(sharp, w, h, 15 * s);
      let x = foggy.getContext('2d');
      x.globalCompositeOperation = 'lighter';
      const n = clamp(Math.round((w * H) / 9000), 14, 90);
      for (let i = 0; i < n; i++) {
        const c = pick(BOKEH), r = rand(12, 46) * s;
        x.globalAlpha = rand(0.08, 0.26);
        x.drawImage(disc(c[0], c[1], c[2]), rand(0, w) - r, rand(0.42, 0.96) * H - r, r * 2, r * 2);
      }
      x.globalCompositeOperation = 'source-over';
      x.globalAlpha = 1;
      x.fillStyle = 'rgba(168,188,218,0.27)';
      x.fillRect(0, 0, w, h);
      this.foggy = foggy;

      const fl = mk(w, h);
      this.paintCity(fl.getContext('2d'), true);
      this.flashBg = blurred(fl, w, h, 2.6 * s);

      /* 방울 안에 비칠 그림: 또렷한 도시를 뒤집고 조금 밝게 */
      const ref = mk(w / 2, h / 2);
      x = ref.getContext('2d');
      x.translate(ref.width, ref.height); x.rotate(Math.PI);
      x.drawImage(sharp, 0, 0, ref.width, ref.height);
      x.globalCompositeOperation = 'lighter'; x.globalAlpha = 0.8;
      x.drawImage(sharp, 0, 0, ref.width, ref.height);
      this.ref = ref;

      /* 김 서림 */
      const F = this.fogAmt;
      const fb = mk(w, h);
      x = fb.getContext('2d');
      let g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `rgba(255,255,255,${0.3 * F})`);
      g.addColorStop(0.5, `rgba(255,255,255,${0.55 * F})`);
      g.addColorStop(1, `rgba(255,255,255,${Math.min(1, 1.02 * F)})`);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.globalCompositeOperation = 'destination-out';
      const holes = this.sill ? this.panes() : [{ x: 0, w }];
      for (const p of holes) {
        const cx = p.x + p.w / 2, cy = H * 0.3, r = Math.max(p.w * 0.62, H * 0.3);
        g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, 'rgba(0,0,0,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      for (let i = 0; i < 14 * this.area; i++) {
        const cx = rand(0, w), cy = rand(0, H), r = rand(40, 120) * s;
        g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
        g.addColorStop(0, `rgba(0,0,0,${rand(0.05, 0.2)})`); g.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      this.fogBase = fb;
      this.mask = mk(w, h);
      this.mx = this.mask.getContext('2d');
      this.mx.drawImage(fb, 0, 0);
      this.fogComp = mk(w, h);
      this.fx = this.fogComp.getContext('2d');

      /* 유리에 맺힌 방울 */
      this.glass = mk(w * dpr, h * dpr);
      this.gx = this.glass.getContext('2d');
      this.gx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const count = Math.round((60 + 300 * this.intensity) * this.area);
      for (let i = 0; i < count; i++) this.hit(rand(0.25, 1));

      if (this.sill) {
        this.frameLayer = mk(w * dpr, h * dpr);
        x = this.frameLayer.getContext('2d');
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.paintFrame(x);
      }
      this.vig = mk(w, h);
      x = this.vig.getContext('2d');
      g = x.createRadialGradient(w / 2, h * 0.45, Math.min(w, h) * 0.3, w / 2, h * 0.45, Math.max(w, h) * 0.78);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, `rgba(0,0,0,${this.sill ? 0.36 : 0.56})`);
      x.fillStyle = g; x.fillRect(0, 0, w, h);

      this.streaks = Array.from({ length: Math.round(360 * this.area) }, () => this.newStreak(true));
      this.sliders = [];
      this.cars = [];
      if (this.prewipe) this.strokePath(1);
    }

    panes() {
      const { w, s, wide } = this;
      const ft = (wide ? 15 : 9) * s;
      const xs = [ft, ...this.mullions(), w - ft];
      const out = [];
      for (let i = 0; i < xs.length - 1; i++) out.push({ x: xs[i], w: xs[i + 1] - xs[i] });
      return out;
    }

    newStreak(initial) {
      const { w, H, s } = this;
      return {
        x: rand(-0.15, 1.05) * w,
        y: initial ? rand(-0.1, 1) * H : rand(-0.25, -0.02) * H,
        len: rand(16, 38) * s,
        v: rand(650, 1100) * s,
      };
    }

    /* ---------- 빗방울 ---------- */
    drop(ctx, x, y, rx, ry, alpha) {
      const r = Math.max(rx, ry);
      ctx.globalAlpha = alpha;
      if (r < 2.1) {
        ctx.fillStyle = 'rgba(6,10,18,0.5)';
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(214,230,255,0.62)';
        ctx.beginPath(); ctx.arc(x - r * 0.15, y + r * 0.32, r * 0.5, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        return;
      }
      const { w, h, ref } = this;
      const k = ref.width / w;
      const span = Math.min(r * 13, w * 0.9, h * 0.9);
      const sx = clamp(w - x - span / 2, 0, w - span), sy = clamp(h - y - span / 2, 0, h - span);
      ctx.save();
      ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, TAU); ctx.clip();
      ctx.drawImage(ref, sx * k, sy * k, span * k, span * k, x - rx, y - ry, rx * 2, ry * 2);
      ctx.restore();
      ctx.drawImage(shade(), x - rx / SHADE_K, y - ry / SHADE_K, (rx * 2) / SHADE_K, (ry * 2) / SHADE_K);
      ctx.globalAlpha = 1;
    }

    /* 유리에 새 방울이 맺혀요 */
    hit(alpha = 1) {
      const { w, H, s } = this;
      const r = (Math.pow(Math.random(), 2.6) * 4.4 + 0.7) * s;
      this.drop(this.gx, rand(0, w), rand(0, H), r, r * rand(0.92, 1.1), alpha);
    }

    /* ---------- 김 닦기 ---------- */
    wipe(x0, y0, x1, y1) {
      const m = this.mx, wd = 46 * this.s;
      m.globalCompositeOperation = 'destination-out';
      m.lineCap = 'round';
      m.strokeStyle = '#000';
      for (const [k, a] of [[1.3, 0.22], [1, 0.5], [0.72, 1]]) {
        m.globalAlpha = a; m.lineWidth = wd * k;
        m.beginPath(); m.moveTo(x0, y0); m.lineTo(x1 + 0.01, y1 + 0.01); m.stroke();
      }
      m.globalAlpha = 1;
      m.globalCompositeOperation = 'source-over';
    }

    /* 설명용 손가락이 지나가는 길. p: 0~1 */
    pathAt(p) {
      const { H } = this;
      const pane = this.sill ? this.panes()[this.wide ? 1 : 0] : { x: this.w * 0.08, w: this.w * 0.84 };
      const pad = Math.min(46 * this.s, pane.w * 0.24);
      const x0 = pane.x + pad, x1 = pane.x + pane.w - pad;
      const rows = 4, seg = Math.min(rows - 1e-6, p * rows), i = Math.floor(seg), f = ease(seg - i);
      const fx = i % 2 === 0 ? f : 1 - f;
      return { x: x0 + (x1 - x0) * fx, y: H * (0.44 + 0.085 * (i + f)) };
    }

    strokePath(to) {
      let prev = this.pathAt(0);
      for (let p = 0.01; p <= to + 1e-6; p += 0.01) {
        const cur = this.pathAt(p);
        this.wipe(prev.x, prev.y, cur.x, cur.y);
        prev = cur;
      }
    }

    refog() {
      const m = this.mx, k = 0.03;
      m.globalCompositeOperation = 'destination-out';
      m.fillStyle = `rgba(0,0,0,${k})`;
      m.fillRect(0, 0, this.w, this.h);
      m.globalCompositeOperation = 'lighter';
      m.globalAlpha = k;
      m.drawImage(this.fogBase, 0, 0);
      m.globalAlpha = 1;
      m.globalCompositeOperation = 'source-over';
    }

    pointer(type, x, y) {
      if (type === 'down') { this.wipeLast = { x, y }; this.wipe(x, y, x, y); }
      else if (type === 'move' && this.wipeLast) { this.wipe(this.wipeLast.x, this.wipeLast.y, x, y); this.wipeLast = { x, y }; }
      else if (type === 'up') this.wipeLast = null;
    }

    /* ---------- 조작 ---------- */
    action(name, value) {
      if (name === 'rain') this.intensity = clamp(Number(value), 0, 1);
      if (name === 'thunder') {
        this.thunder = !this.thunder;
        if (this.thunder) this.nextFlash = 1.2;
      }
      this.sync();
    }

    sync() {
      const sc = this.screen;
      if (!sc) return;
      const lv = LEVELS.reduce((a, b) => (Math.abs(b.v - this.intensity) < Math.abs(a.v - this.intensity) ? b : a));
      sc.querySelectorAll('[data-rain2-act="rain"]').forEach((b) => b.classList.toggle('on', Number(b.dataset.value) === lv.v));
      sc.querySelectorAll('[data-rain2-act="thunder"]').forEach((b) => b.classList.toggle('on', this.thunder));
      sc.querySelectorAll('[data-stat="rain"]').forEach((e) => { e.textContent = lv.label; });
      sc.querySelectorAll('[data-stat="thunder"]').forEach((e) => { e.textContent = this.thunder ? '켜짐' : '꺼짐'; });
    }

    activeStreaks() {
      return Math.min(this.streaks.length, Math.round((40 + 320 * this.intensity) * this.area));
    }

    step(dt) {
      const { w, H, s } = this;
      const I = this.intensity;
      this.t += dt;
      const active = this.activeStreaks();
      for (let i = 0; i < active; i++) {
        const st = this.streaks[i];
        const v = st.v * (0.75 + 0.45 * I);
        st.y += v * dt; st.x += v * 0.16 * dt;
        if (st.y - st.len > H) Object.assign(st, this.newStreak(false));
      }
      /* 차 */
      this.carAcc -= dt;
      if (this.carAcc <= 0 && this.cars.length < 4) {
        const dir = pick([-1, 1]);
        this.cars.push({ x: dir > 0 ? -30 * s : w + 30 * s, v: dir * rand(50, 110) * s, y: H * (dir > 0 ? 0.925 : 0.895), head: Math.random() < 0.5 });
        this.carAcc = rand(2, 6);
      }
      for (const c of this.cars) c.x += c.v * dt;
      this.cars = this.cars.filter((c) => c.x > -60 * s && c.x < w + 60 * s);
      /* 새 방울 · 마르는 방울 */
      this.hitAcc += dt * (1.5 + 7 * I) * this.area;
      while (this.hitAcc >= 1) { this.hitAcc -= 1; this.hit(); }
      this.evapAcc += dt;
      if (this.evapAcc > 3) {
        this.evapAcc = 0;
        const g = this.gx;
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = 'rgba(0,0,0,0.06)';
        g.fillRect(0, 0, w, this.h);
        g.globalCompositeOperation = 'source-over';
      }
      /* 흘러내리는 방울 */
      this.slideAcc += dt * (0.3 + 1.8 * I) * (w / 390);
      while (this.slideAcc >= 1) {
        this.slideAcc -= 1;
        if (this.sliders.length < 24 * this.area) {
          this.sliders.push({ x: rand(0, w), y: rand(-0.05, 0.7) * H, r: rand(3.6, 7.6) * s, v: 0, wait: rand(0.2, 1.6), seed: rand(0, TAU), tr: 0 });
        }
      }
      const g = this.gx;
      for (const d of this.sliders) {
        if (d.wait > 0) { d.wait -= dt; continue; }
        const go = Math.pow(0.5 + 0.5 * Math.sin(this.t * 1.1 + d.seed), 3);
        const target = (12 + 220 * go) * s * (d.r / (5 * s));
        d.v += (target - d.v) * Math.min(1, dt * 3);
        d.y += d.v * dt;
        d.x += Math.sin(this.t * 2.3 + d.seed) * 5 * s * dt;
        g.globalCompositeOperation = 'destination-out';
        g.fillStyle = '#000';
        g.beginPath(); g.arc(d.x, d.y, d.r * 1.15, 0, TAU); g.fill();
        g.globalCompositeOperation = 'source-over';
        d.tr += d.v * dt;
        if (d.tr > 7 * s) {
          d.tr = 0;
          if (Math.random() < 0.7) {
            const br = d.r * rand(0.2, 0.42);
            this.drop(g, d.x + rand(-1, 1) * s, d.y - d.r * 1.25 - br, br, br * 1.1, 1);
          }
        }
      }
      this.sliders = this.sliders.filter((d) => d.y < H + 20);
      /* 김 */
      if (!this.holdFog) {
        this.fogAcc += dt;
        if (this.fogAcc > 0.5) { this.fogAcc = 0; this.refog(); }
      }
      if (this.autoWipe) {
        if (this.wipeT < 0) {
          this.nextWipe -= dt;
          if (this.nextWipe <= 0) { this.wipeT = 0; this.wipeLast2 = this.pathAt(0); }
        } else {
          this.wipeT += dt / 2.6;
          const cur = this.pathAt(Math.min(1, this.wipeT));
          this.wipe(this.wipeLast2.x, this.wipeLast2.y, cur.x, cur.y);
          this.wipeLast2 = cur;
          if (this.finger) {
            this.finger.style.opacity = this.wipeT > 0.94 ? '0' : '1';
            this.finger.style.transform = `translate(${cur.x}px, ${cur.y}px)`;
          }
          if (this.wipeT >= 1) { this.wipeT = -1; this.nextWipe = this.autoWipe; }
        }
      }
      /* 번개 */
      if (this.thunder) {
        this.nextFlash -= dt;
        if (this.nextFlash <= 0) {
          this.flashT = 0;
          this.nextFlash = this.thunderEvery || rand(20, 40);
          const bx = rand(0.2, 0.8) * w;
          const pts = [[bx, -10]];
          for (let i = 1; i <= 9; i++) pts.push([bx + rand(-16, 16) * s * i * 0.35 + i * rand(-3, 3) * s, (H * 0.3 * i) / 9]);
          this.bolt = pts;
        }
      }
      if (this.flashT >= 0) {
        this.flashT += dt;
        const ft = this.flashT;
        this.flash = ft < 0.07 ? 1 : ft < 0.15 ? 0.15 : ft < 0.24 ? 0.75 : Math.max(0, 0.75 - (ft - 0.24) * 1.6);
        if (ft > 1) { this.flashT = -1; this.flash = 0; }
      }
    }

    draw() {
      const { ctx, w, h, H, s, t, dpr } = this;
      const I = this.intensity;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.drawImage(this.clear, 0, 0, w, h);
      if (this.flash > 0) {
        ctx.globalAlpha = this.flash * 0.85;
        ctx.drawImage(this.flashBg, 0, 0, w, h);
        if (this.bolt && this.flashT < 0.24) {
          ctx.strokeStyle = '#fff'; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
          for (const [lw, a] of [[10 * s, 0.16], [2.2 * s, 1]]) {
            ctx.globalAlpha = this.flash * a; ctx.lineWidth = lw;
            ctx.beginPath();
            this.bolt.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'lighter';
      const blink = Math.pow(0.5 + 0.5 * Math.sin(t * 2.6), 6);
      ctx.globalAlpha = 0.25 + 0.75 * blink;
      ctx.drawImage(glow(255, 60, 50), this.beacon.x - 9 * s, this.beacon.y - 9 * s, 18 * s, 18 * s);
      for (const c of this.cars) {
        const sp = c.head ? glow(255, 238, 205) : glow(255, 56, 46);
        const r = (c.head ? 11 : 8) * s;
        for (const o of [-6, 6]) {
          ctx.globalAlpha = 0.9;
          ctx.drawImage(sp, c.x + o * s - r, c.y - r, r * 2, r * 2);
          ctx.globalAlpha = 0.26;
          ctx.drawImage(sp, c.x + o * s - r * 0.8, c.y + 2 * s, r * 1.6, 52 * s);
        }
      }
      ctx.strokeStyle = 'rgb(190,210,240)';
      ctx.lineWidth = Math.max(0.7, 1.1 * s);
      ctx.lineCap = 'round';
      const active = this.activeStreaks();
      for (let bucket = 0; bucket < 3; bucket++) {
        ctx.globalAlpha = (0.07 + bucket * 0.07) * (0.7 + 0.5 * I) * (1 + this.flash);
        ctx.beginPath();
        for (let i = bucket; i < active; i += 3) {
          const st = this.streaks[i];
          ctx.moveTo(st.x, st.y); ctx.lineTo(st.x - st.len * 0.16, st.y - st.len);
        }
        ctx.stroke();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      /* 김 서린 유리 */
      const f = this.fx;
      f.globalCompositeOperation = 'copy';
      f.drawImage(this.foggy, 0, 0);
      f.globalCompositeOperation = 'destination-in';
      f.drawImage(this.mask, 0, 0);
      ctx.drawImage(this.fogComp, 0, 0, w, h);
      if (this.flash > 0) {
        ctx.globalAlpha = this.flash * 0.2;
        ctx.fillStyle = '#c8d6ff';
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = 'rgba(10,18,32,0.1)';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(this.glass, 0, 0, w, h);
      for (const d of this.sliders) {
        const sp = clamp(d.v / (200 * s), 0, 1);
        this.drop(ctx, d.x, d.y, d.r * (1 - 0.14 * sp), d.r * (1 + 0.45 * sp), 1);
      }
      if (this.sill) {
        /* 유리에 비친 방 안 스탠드 불빛 */
        ctx.globalCompositeOperation = 'lighter';
        const lx = w * (this.wide ? 0.84 : 0.8), ly = H * 0.2;
        ctx.globalAlpha = 0.11 + 0.01 * Math.sin(t * 0.7);
        ctx.drawImage(glow(255, 178, 108), lx - 150 * s, ly - 150 * s, 300 * s, 300 * s);
        ctx.globalAlpha = 0.1;
        ctx.drawImage(glow(255, 214, 160), lx - 26 * s, ly - 26 * s, 52 * s, 52 * s);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(this.frameLayer, 0, 0, w, h);
        /* 머그컵 김 */
        ctx.globalCompositeOperation = 'lighter';
        ctx.lineCap = 'round';
        for (let i = 0; i < 3; i++) {
          const life = (t * 0.22 + i / 3) % 1;
          ctx.strokeStyle = `rgba(255,236,214,${0.1 * Math.sin(life * Math.PI)})`;
          ctx.lineWidth = (4 + 5 * life) * s;
          ctx.beginPath();
          for (let k = 0; k <= 10; k++) {
            const p = k / 10;
            const yy = this.mug.y - (8 + 52 * life) * s * p - 20 * s * life;
            const xx = this.mug.x + (i - 1) * 5 * s + Math.sin(t * 0.9 + p * 4 + i * 2.1) * 7 * s * p;
            if (k) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
          }
          ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
  }

  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__rain2.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-rain2]').forEach((c) => {
      const sc = new Rain2(c);
      c.__rain2 = sc;
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
      c.addEventListener('pointerup', () => sc.pointer('up'));
      c.addEventListener('pointercancel', () => sc.pointer('up'));
    });
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-rain2-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-rain2]');
      if (c && c.__rain2) c.__rain2.action(b.dataset.rain2Act, b.dataset.value);
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
