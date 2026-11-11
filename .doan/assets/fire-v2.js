/* mong — 불멍 v2 시안용 장면 (Doan 보드 전용, 아직 src/ 에 없음).
   기존 불멍은 빛 번짐 입자를 겹쳐 그려요. v2는 낮은 해상도의 '열 지도'를 만들어
   불꽃 색으로 바꿔 그려서, 불길이 혀처럼 갈라지고 떨어져 나가요.
   <canvas data-fire2> 하나가 장면 하나. 같은 .screen 안의 [data-fire2-act] 버튼이 장면을 조작해요.
     data-state="blaze|embers"   시작 상태
     data-hold                   장작이 타들어가지 않게 고정 (상태를 보여주는 화면용)
     data-auto-add="8"           n초마다 장작을 넣어요 (data-woods="oak,pine,birch" 순서)
     data-auto-poke="6"          n초마다 불을 뒤적여요
     data-fy, data-scale         불 위치(세로 비율) · 크기 */
(() => {
  'use strict';

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => {
    const t = clamp((x - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  const easeOutBounce = (x) => {
    const n = 7.5625, d = 2.75;
    if (x < 1 / d) return n * x * x;
    if (x < 2 / d) return n * (x -= 1.5 / d) * x + 0.75;
    if (x < 2.5 / d) return n * (x -= 2.25 / d) * x + 0.9375;
    return n * (x -= 2.625 / d) * x + 0.984375;
  };

  /* ---------- tileable noise ---------- */
  const NS = 256;
  const NOISE = (() => {
    const out = new Float32Array(NS * NS);
    let amp = 1, total = 0;
    for (const period of [4, 8, 16, 32]) {
      const g = new Float32Array(period * period);
      for (let i = 0; i < g.length; i++) g[i] = Math.random();
      const cell = NS / period;
      for (let y = 0; y < NS; y++) {
        const gy = y / cell, y0 = Math.floor(gy), ty = gy - y0;
        const sy = ty * ty * (3 - 2 * ty);
        const r0 = (y0 % period) * period, r1 = ((y0 + 1) % period) * period;
        for (let x = 0; x < NS; x++) {
          const gx = x / cell, x0 = Math.floor(gx), tx = gx - x0;
          const sx = tx * tx * (3 - 2 * tx);
          const c0 = x0 % period, c1 = (x0 + 1) % period;
          const top = g[r0 + c0] + (g[r0 + c1] - g[r0 + c0]) * sx;
          const bot = g[r1 + c0] + (g[r1 + c1] - g[r1 + c0]) * sx;
          out[y * NS + x] += amp * (top + (bot - top) * sy);
        }
      }
      total += amp;
      amp *= 0.5;
    }
    for (let i = 0; i < out.length; i++) out[i] = clamp((out[i] / total - 0.5) * 1.9 + 0.5, 0, 1);
    return out;
  })();
  function ns(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const x0 = xi & 255, x1 = (xi + 1) & 255;
    const y0 = (yi & 255) << 8, y1 = ((yi + 1) & 255) << 8;
    const a = NOISE[y0 + x0], b = NOISE[y0 + x1], c = NOISE[y1 + x0], d = NOISE[y1 + x1];
    const top = a + (b - a) * fx;
    return top + (c + (d - c) * fx - top) * fy;
  }

  /* ---------- flame colour ramp ---------- */
  const LUT = (() => {
    const stops = [
      [0.0, 50, 6, 2, 0],
      [0.12, 90, 12, 4, 0],
      [0.22, 176, 34, 8, 0.42],
      [0.38, 246, 84, 16, 0.74],
      [0.56, 255, 138, 34, 0.86],
      [0.76, 255, 196, 84, 0.92],
      [1.0, 255, 236, 180, 0.96],
    ];
    const out = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) {
      const v = i / 255;
      let k = 0;
      while (k < stops.length - 2 && v > stops[k + 1][0]) k++;
      const a = stops[k], b = stops[k + 1];
      const t = clamp((v - a[0]) / (b[0] - a[0]), 0, 1);
      out[i * 4] = a[1] + (b[1] - a[1]) * t;
      out[i * 4 + 1] = a[2] + (b[2] - a[2]) * t;
      out[i * 4 + 2] = a[3] + (b[3] - a[3]) * t;
      out[i * 4 + 3] = (a[4] + (b[4] - a[4]) * t) * 255;
    }
    return out;
  })();

  /* ---------- sprites ---------- */
  function glow(r, g, b, mid = 0.45) {
    const S = 64, c = document.createElement('canvas');
    c.width = c.height = S;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, `rgba(${r},${g},${b},1)`);
    gr.addColorStop(mid, `rgba(${r},${g},${b},0.5)`);
    gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = gr;
    x.fillRect(0, 0, S, S);
    return c;
  }
  const EMBER = glow(255, 120, 36, 0.3);
  const EMBER_HOT = glow(255, 190, 90, 0.25);
  const SMOKE = glow(132, 124, 118, 0.5);

  function layer(w, h, dpr, paint) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * dpr));
    c.height = Math.max(1, Math.round(h * dpr));
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    paint(x);
    return c;
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
  function blob(ctx, x, y, rx, ry, verts, rot) {
    const n = verts.length;
    const pt = (i) => {
      const a = (i / n) * TAU + rot;
      return [x + Math.cos(a) * rx * verts[i % n], y + Math.sin(a) * ry * verts[i % n]];
    };
    ctx.beginPath();
    let [px, py] = pt(0);
    let [qx, qy] = pt(1);
    ctx.moveTo((px + qx) / 2, (py + qy) / 2);
    for (let i = 1; i <= n; i++) {
      [px, py] = pt(i);
      [qx, qy] = pt(i + 1);
      ctx.quadraticCurveTo(px, py, (px + qx) / 2, (py + qy) / 2);
    }
    ctx.closePath();
  }

  /* ---------- wood ---------- */
  const WOOD = {
    oak: { life: 1.5, bark: [[116, 80, 52], [56, 37, 24]], sparks: 1, bright: 1, tall: 1, turb: 0.85 },
    pine: { life: 0.9, bark: [[152, 86, 48], [78, 40, 22]], sparks: 2.3, bright: 1.04, tall: 1.1, turb: 1.3 },
    birch: { life: 0.8, bark: [[234, 228, 214], [160, 152, 138]], sparks: 0.9, bright: 1.25, tall: 1.2, turb: 1 },
  };

  /* bark texture for one log, drawn once (unit: log px at scale 1, ×2 for sharpness) */
  function barkTexture(kind, len, th) {
    const K = 2;
    const c = document.createElement('canvas');
    c.width = Math.ceil(len * K);
    c.height = Math.ceil(th * K);
    const x = c.getContext('2d');
    x.scale(K, K);
    const [hi, lo] = WOOD[kind].bark;
    const g = x.createLinearGradient(0, 0, 0, th);
    g.addColorStop(0, rgb(mix(hi, [255, 236, 210], 0.12)));
    g.addColorStop(0.3, rgb(hi));
    g.addColorStop(1, rgb(lo));
    x.fillStyle = g;
    x.fillRect(0, 0, len, th);
    if (kind === 'birch') {
      // lenticels run around the trunk; a few dark "eyes"
      x.strokeStyle = 'rgba(40,32,26,0.7)';
      for (let i = 0; i < 46; i++) {
        const px = rand(4, len - 12), py = rand(2, th - 2);
        x.lineWidth = rand(0.6, 1.5);
        x.beginPath();
        x.moveTo(px, py);
        x.lineTo(px + rand(-0.6, 0.6), py + rand(2.5, 7));
        x.stroke();
      }
      x.fillStyle = 'rgba(34,26,22,0.8)';
      for (let i = 0; i < 3; i++) {
        x.beginPath();
        x.ellipse(rand(16, len - 30), rand(th * 0.3, th * 0.75), rand(4, 8), rand(1.6, 3), rand(-0.2, 0.2), 0, TAU);
        x.fill();
      }
      x.fillStyle = 'rgba(198,150,100,0.35)';
      for (let i = 0; i < 4; i++) x.fillRect(rand(0, len - 30), rand(0, th), rand(10, 26), rand(1, 2.4));
    } else if (kind === 'pine') {
      // reddish plates split by dark furrows
      x.strokeStyle = 'rgba(30,14,8,0.55)';
      x.lineWidth = 1.1;
      for (let row = 0; row < 4; row++) {
        const y0 = (row + 0.5) * (th / 4) + rand(-1.5, 1.5);
        x.beginPath();
        x.moveTo(0, y0);
        for (let px = 0; px <= len; px += 9) x.lineTo(px, y0 + rand(-1.6, 1.6));
        x.stroke();
        for (let px = rand(4, 16); px < len; px += rand(12, 24)) {
          x.beginPath();
          x.moveTo(px, y0);
          x.lineTo(px + rand(-2, 2), y0 + th / 4);
          x.stroke();
        }
      }
      x.fillStyle = 'rgba(214,128,70,0.22)';
      for (let i = 0; i < 26; i++) x.fillRect(rand(0, len), rand(0, th * 0.6), rand(4, 10), rand(1, 2.5));
    } else {
      // oak: long wavy grooves
      for (let i = 0; i < 16; i++) {
        const y0 = rand(1, th - 1);
        let px = rand(-10, len * 0.6);
        const end = px + rand(26, 90);
        x.strokeStyle = i % 4 === 0 ? 'rgba(170,124,84,0.3)' : 'rgba(20,12,7,0.5)';
        x.lineWidth = rand(0.7, 1.6);
        x.beginPath();
        x.moveTo(px, y0);
        for (; px < end; px += 8) x.lineTo(px, y0 + rand(-1.1, 1.1));
        x.stroke();
      }
      x.fillStyle = 'rgba(20,12,7,0.55)';
      x.beginPath();
      x.ellipse(rand(30, len - 50), rand(th * 0.35, th * 0.7), 5, 2.6, 0, 0, TAU);
      x.fill();
    }
    // round it off: darker underside
    const sh = x.createLinearGradient(0, 0, 0, th);
    sh.addColorStop(0, 'rgba(0,0,0,0)');
    sh.addColorStop(0.55, 'rgba(0,0,0,0.12)');
    sh.addColorStop(1, 'rgba(0,0,0,0.62)');
    x.fillStyle = sh;
    x.fillRect(0, 0, len, th);
    return c;
  }

  const MAX_LOGS = 5;
  const DROP_TIME = 0.7;
  const STAGES = [[0.72, '활활'], [0.4, '타닥타닥'], [0.16, '은은하게'], [0, '잔불']];

  class Fire2 {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.screen = canvas.closest('.screen');
      const d = (this.d = canvas.dataset);
      this.t = rand(0, 40);
      this.w = 0; this.h = 0; this.dpr = 1; this.s = 1;
      this.state = d.state || 'blaze';
      this.hold = 'hold' in d;
      this.autoTend = !this.hold && d.tend !== 'off';
      this.autoAdd = parseFloat(d.autoAdd) || 0;
      this.autoPoke = parseFloat(d.autoPoke) || 0;
      this.woods = (d.woods || 'oak').split(',');
      this.demoClock = 0; this.demoN = 0;
      this.logs = []; this.sparks = []; this.smoke = [];
      this.flare = 0; this.cool = 0; this.sinceAdd = 0; this.added = 0;
      this.intensity = 0.6; this.coal = this.state === 'embers' ? 1 : 0.6;
      this.wind = 0; this.kick = 0;
      this.acc = { spark: 0, smoke: 0 };
      this.statTimer = 0;
      const start = this.state === 'embers'
        ? [[-34, -6, -0.3, 150, 26, 0.93, 'oak'], [40, -8, 0.38, 150, 26, 0.9, 'oak'], [2, 6, 0.04, 176, 28, 0.95, 'oak']]
        : [[-38, -13, -0.44, 158, 27, 0.3, 'oak'], [38, -13, 0.44, 158, 27, 0.22, 'oak'], [0, 5, 0.05, 184, 29, 0.12, 'oak']];
      const kinds = (d.kinds || '').split(',').filter((k) => WOOD[k]);
      start.forEach(([x, y, a, len, th, burn, kind], i) => {
        this.logs.push(this.makeLog({ x, y, a, len, th, burn, kind: kinds[i] || kind, ignite: 1, drop: 1 }));
      });
      this.coals = Array.from({ length: 54 }, () => {
        const a = rand(0, TAU), r = Math.sqrt(Math.random());
        return {
          x: Math.cos(a) * r, y: Math.sin(a) * r, r: rand(5, 12), rot: rand(0, TAU), seed: rand(0, 200),
          verts: Array.from({ length: 7 }, () => rand(0.7, 1.15)),
        };
      }).sort((p, q) => p.y - q.y);
    }

    num(key, fallback) {
      const v = parseFloat(this.d[key]);
      return Number.isFinite(v) ? v : fallback;
    }

    makeLog(o) {
      const L = {
        burn: 0, ignite: 0, drop: 0, fast: false,
        life: rand(85, 125) * WOOD[o.kind].life,
        cracks: Array.from({ length: 13 }, () => ({
          u: rand(-0.4, 0.32), v: rand(-0.32, 0.34), l: rand(0.04, 0.13), a: rand(-0.7, 0.7), p: rand(0, TAU),
        })),
        ash: Array.from({ length: 16 }, () => ({ u: rand(-0.42, 0.36), v: rand(-0.4, 0.1), r: rand(1.5, 4.5) })),
        ...o,
      };
      L.tex = barkTexture(L.kind, L.len, L.th);
      return L;
    }

    resize(w, h, dpr) {
      this.w = w; this.h = h; this.dpr = dpr;
      this.layout();
    }

    layout() {
      const { w, h, dpr } = this;
      const wide = w > 900;
      const landscape = w > h && h < 520;
      this.fy = this.num('fy', landscape ? 0.74 : wide ? 0.69 : 0.635);
      const s = (this.s = clamp(Math.min(w / 390, h / 640), 0.3, 2) * this.num('scale', wide ? 1 : 1.1));
      const cx = (this.cx = w * this.num('fx', 0.5));
      const by = (this.by = h * this.fy);
      const hz = (this.horizon = by - (landscape ? 150 : 215) * s);

      /* flame heat field */
      const cell = Math.max(1.6, 2.3 * s);
      const cols = Math.round((400 * s) / cell), rows = Math.round((430 * s) / cell);
      const fc = document.createElement('canvas');
      fc.width = cols; fc.height = rows;
      const fctx = fc.getContext('2d');
      const bc = document.createElement('canvas');
      bc.width = Math.ceil(cols / 5); bc.height = Math.ceil(rows / 5);
      this.field = {
        cols, rows, cell, canvas: fc, ctx: fctx, img: fctx.createImageData(cols, rows),
        bloom: bc, bctx: bc.getContext('2d'),
        heat: new Float32Array(cols), hgt: new Float32Array(cols), base: new Float32Array(cols),
        x0: cx - (cols * cell) / 2, y1: by + 16 * s,
      };

      /* stones around the pit */
      const N = 13;
      this.stones = Array.from({ length: N }, (_, i) => {
        const a = (i / N) * TAU + rand(-0.08, 0.08) + 0.12;
        return {
          a, w: rand(40, 58), h: rand(24, 34), tone: rand(0.8, 1.15), rot: rand(0, TAU),
          verts: Array.from({ length: 9 }, () => rand(0.84, 1.1)), front: Math.sin(a) > 0.08,
        };
      });

      /* forest: one list of trees, drawn on both the lit layer and (as a hole) the sky layer */
      const trees = [];
      for (let tx = -20; tx < w + 30;) {
        const near = Math.abs(tx - cx) < 120 * s;
        const th = rand(120, 250) * s * (near ? 0.62 : 1);
        const tw = th * rand(0.3, 0.4);
        trees.push({ x: tx, th, tw, lean: rand(-0.03, 0.03) });
        tx += tw * rand(0.4, 0.8);
      }
      const forest = (x, lit) => {
        // far ridge
        x.fillStyle = lit ? '#15110f' : '#000';
        x.beginPath();
        x.moveTo(-10, hz + 4);
        for (let px = -10; px <= w + 20; px += 16) {
          x.lineTo(px, hz - (40 + 20 * Math.sin(px * 0.006 + 1) + 9 * Math.sin(px * 0.023)) * s);
        }
        x.lineTo(w + 20, hz + 4);
        x.closePath();
        x.fill();
        for (const tr of trees) {
          const side = tr.x < cx ? 1 : -1; // which side faces the fire
          for (let k = 0; k < 5; k++) {
            const bottom = hz + 4 - tr.th * 0.19 * k;
            const top = bottom - tr.th * (k === 4 ? 0.3 : 0.36);
            const half = (tr.tw / 2) * (1 - 0.17 * k);
            const tipX = tr.x + tr.lean * tr.th;
            x.fillStyle = lit ? '#0d0b09' : '#000';
            x.beginPath();
            x.moveTo(tr.x - half, bottom);
            x.lineTo(tipX, top);
            x.lineTo(tr.x + half, bottom);
            x.closePath();
            x.fill();
            if (lit) {
              // the half that faces the fire catches a little warm light
              x.fillStyle = 'rgba(150,84,40,0.5)';
              x.beginPath();
              x.moveTo(tr.x + side * half, bottom);
              x.lineTo(tipX, top);
              x.lineTo(tr.x + side * half * 0.25, bottom);
              x.closePath();
              x.fill();
            }
          }
        }
      };

      this.lit = layer(w, h, dpr, (x) => {
        // ground as if fully lit; the per-frame light mask darkens it
        const g = x.createLinearGradient(0, hz, 0, h);
        g.addColorStop(0, '#3a2819');
        g.addColorStop(1, '#5a3d25');
        x.fillStyle = g;
        x.fillRect(0, hz, w, h - hz);
        const depth = (y) => 0.35 + 1.1 * clamp((y - hz) / (h - hz), 0, 1); // things get bigger toward the viewer
        for (let i = 0; i < 2600; i++) {
          const y = hz + Math.pow(Math.random(), 0.8) * (h - hz), k = depth(y);
          x.fillStyle = Math.random() < 0.5 ? 'rgba(20,12,6,0.4)' : 'rgba(190,140,92,0.3)';
          x.fillRect(rand(0, w), y, rand(1, 2.6) * k * s, rand(0.6, 1.3) * k * s);
        }
        for (let i = 0; i < 90; i++) {
          const y = hz + 10 * s + Math.random() * (h - hz), k = depth(y), px = rand(0, w);
          const pg = x.createLinearGradient(0, y - 3 * k * s, 0, y + 3 * k * s);
          pg.addColorStop(0, 'rgba(186,160,136,0.9)');
          pg.addColorStop(1, 'rgba(50,38,30,0.9)');
          x.fillStyle = pg;
          x.beginPath();
          x.ellipse(px, y, rand(2.5, 7) * k * s, rand(1.4, 3.4) * k * s, rand(-0.3, 0.3), 0, TAU);
          x.fill();
        }
        x.lineCap = 'round';
        for (let i = 0; i < 26; i++) {
          const y = hz + 20 * s + Math.random() * (h - hz), k = depth(y), px = rand(0, w), a = rand(-0.5, 0.5);
          x.strokeStyle = 'rgba(46,28,16,0.8)';
          x.lineWidth = rand(1, 2.2) * k * s;
          x.beginPath();
          x.moveTo(px, y);
          x.lineTo(px + Math.cos(a) * rand(10, 30) * k * s, y + Math.sin(a) * 6 * k * s);
          x.stroke();
        }
        // grass tufts, thicker away from the pit
        for (let i = 0; i < 150; i++) {
          const y = hz + Math.random() * (h - hz), k = depth(y), px = rand(-10, w + 10);
          if (Math.hypot((px - cx) / (215 * s), (y - by) / (95 * s)) < 1) continue;
          for (let b = 0; b < 6; b++) {
            const lean = rand(-0.5, 0.5), bl = rand(8, 20) * k * s;
            x.strokeStyle = Math.random() < 0.5 ? 'rgba(118,98,48,0.85)' : 'rgba(54,52,26,0.9)';
            x.lineWidth = rand(0.8, 1.6) * k * s;
            x.beginPath();
            x.moveTo(px + b * 1.5 * k, y);
            x.quadraticCurveTo(px + b * 1.5 * k + lean * bl * 0.4, y - bl * 0.6, px + b * 1.5 * k + lean * bl, y - bl);
            x.stroke();
          }
        }
        const far = x.createLinearGradient(0, hz, 0, hz + 120 * s);
        far.addColorStop(0, 'rgba(6,5,5,0.92)');
        far.addColorStop(1, 'rgba(6,5,5,0)');
        x.fillStyle = far;
        x.fillRect(0, hz, w, 120 * s);
        forest(x, true);
      });

      this.sky = layer(w, h, dpr, (x) => {
        const top = hz + 2;
        const g = x.createLinearGradient(0, 0, 0, top);
        g.addColorStop(0, '#03050b');
        g.addColorStop(0.6, '#0a0f1d');
        g.addColorStop(1, '#131726');
        x.fillStyle = g;
        x.fillRect(0, 0, w, top);
        // a faint band of milky way
        x.save();
        x.translate(w * 0.62, top * 0.3);
        x.rotate(-0.5);
        const mw = x.createLinearGradient(0, -90 * s, 0, 90 * s);
        mw.addColorStop(0, 'rgba(150,170,230,0)');
        mw.addColorStop(0.5, 'rgba(150,170,230,0.07)');
        mw.addColorStop(1, 'rgba(150,170,230,0)');
        x.fillStyle = mw;
        x.fillRect(-w, -90 * s, w * 2, 180 * s);
        x.restore();
        for (let i = 0; i < 230; i++) {
          x.globalAlpha = rand(0.15, 0.75) * (Math.random() < 0.1 ? 1.3 : 0.8);
          x.fillStyle = Math.random() < 0.2 ? '#ffe9cf' : '#e6ecff';
          const r = rand(0.4, 1.3);
          x.fillRect(rand(0, w), Math.pow(Math.random(), 1.3) * top, r, r);
        }
        x.globalAlpha = 1;
        x.globalCompositeOperation = 'destination-out';
        forest(x, false);
      });
      this.twinkles = Array.from({ length: 16 }, () => ({
        x: rand(0, w), y: rand(0, Math.max(10, hz - 250 * s)) * 0.9, r: rand(1, 1.8), p: rand(0, TAU), sp: rand(0.6, 2.2),
      }));

      this.vig = layer(w, h, dpr, (x) => {
        const g = x.createRadialGradient(w / 2, h * 0.56, Math.min(w, h) * 0.34, w / 2, h * 0.56, Math.hypot(w, h) * 0.62);
        g.addColorStop(0, 'rgba(0,0,0,0)');
        g.addColorStop(1, 'rgba(0,0,0,0.62)');
        x.fillStyle = g;
        x.fillRect(0, 0, w, h);
      });
    }

    /* ---------- interaction ---------- */
    isNearFire(x, y) {
      const s = this.s;
      return Math.hypot((x - this.cx) / (170 * s), (y - (this.by - 60 * s)) / (170 * s)) < 1;
    }
    tap(x, y) {
      if (this.isNearFire(x, y)) this.poke();
    }
    action(name, value) {
      if (name === 'add') {
        this.sinceAdd = 0;
        this.addLog(WOOD[value] ? value : 'oak');
      } else if (name === 'poke') {
        this.poke();
      }
    }
    addLog(kind) {
      if (this.logs.length >= MAX_LOGS) {
        this.logs.reduce((a, b) => (a.burn > b.burn ? a : b)).fast = true;
      }
      this.added += 1;
      const side = this.added % 2 ? 1 : -1;
      this.logs.push(this.makeLog({
        x: rand(-26, 26), y: rand(-24, -10), a: side * rand(0.14, 0.52), len: rand(140, 172), th: rand(23, 29), kind,
      }));
      this.cool = 4;
    }
    /** 뒤적이기: stir the fire. Sparks fly, the coals wake up, the flames jump for a moment. */
    poke() {
      const n = Math.round(46 * (0.5 + this.coal));
      for (let i = 0; i < n; i++) this.spawnSpark(true);
      this.flare = Math.max(this.flare, 0.9);
      this.kick = 1;
      this.coal = Math.min(1, this.coal + 0.25);
      for (const L of this.logs) {
        if (L.drop < 1) continue;
        L.jolt = rand(-0.05, 0.05);
        if (!this.hold) L.burn = Math.min(0.99, L.burn + 0.015);
      }
    }
    land(L) {
      const n = Math.round(36 * WOOD[L.kind].sparks);
      for (let i = 0; i < n; i++) this.spawnSpark(true);
      this.flare = Math.max(this.flare, WOOD[L.kind].bright * 0.8);
      this.kick = 0.6;
    }
    spawnSpark(burst) {
      const s = this.s;
      const x = this.cx + rand(-50, 50) * s, y = this.by - rand(burst ? 0 : 30, burst ? 40 : 130) * s;
      this.sparks.push({
        x, y, px: x, py: y,
        vx: rand(-34, 34) * s * (burst ? 2.4 : 1) + this.wind * 30 * s,
        vy: -rand(80, 190) * s * (burst ? 1.45 : 1),
        life: 0, max: rand(0.9, 2.8), r: rand(0.7, 1.7) * Math.max(0.8, s), seed: rand(0, TAU),
      });
    }

    /* ---------- simulation ---------- */
    step(dt) {
      const s = this.s;
      this.t += dt;
      const t = this.t;

      let fuel = 0, bright = 0, tall = 0, turb = 0, sparks = 0, wsum = 0;
      for (const L of this.logs) {
        if (L.drop < 1) {
          L.drop = Math.min(1, L.drop + dt / DROP_TIME);
          if (L.drop === 1) this.land(L);
          continue;
        }
        L.ignite = Math.min(1, L.ignite + dt / 3.5);
        if (!this.hold) {
          const dB = (dt / L.life) * (0.35 + 0.65 * L.ignite) * (L.fast ? 7 : 1);
          L.burn += dB;
          this.coal = Math.min(1, this.coal + dB * 0.5);
        }
        L.power = L.ignite * (1 - smooth(0.5, 1, L.burn));
        const W = WOOD[L.kind];
        fuel += L.power * (L.len / 160);
        bright += W.bright * L.power; tall += W.tall * L.power; turb += W.turb * L.power; sparks += W.sparks * L.power;
        wsum += L.power;
        if (L.jolt) L.jolt *= Math.pow(0.02, dt);
      }
      this.logs = this.logs.filter((L) => L.burn < 1);
      this.mood = wsum > 0.01
        ? { bright: bright / wsum, tall: tall / wsum, turb: turb / wsum, sparks: sparks / wsum }
        : { bright: 1, tall: 1, turb: 1, sparks: 1 };
      if (!this.hold) this.coal = Math.max(0.12, this.coal - dt / 420);

      this.cool -= dt;
      this.sinceAdd += dt;
      if (this.autoTend && this.cool <= 0 && this.sinceAdd > 20 && (this.logs.length < 2 || fuel < 1.3)) {
        this.addLog(this.woods[this.demoN++ % this.woods.length]);
      }
      if (this.autoAdd || this.autoPoke) {
        this.demoClock += dt;
        const every = this.autoAdd || this.autoPoke;
        if (this.demoClock >= every) {
          this.demoClock = 0;
          if (this.autoAdd) this.addLog(this.woods[this.demoN++ % this.woods.length]);
          else this.poke();
        }
      }

      this.flare = Math.max(0, this.flare - dt / 2.6);
      this.kick = Math.max(0, this.kick - dt / 1.4);
      this.wind = 0.5 * Math.sin(t * 0.13) + 0.32 * Math.sin(t * 0.31 + 1.7) + 0.18 * Math.sin(t * 0.83 + 0.4);
      this.fuel = fuel;
      this.intensity = clamp(fuel / 3.3 + this.flare * 0.2, 0.03, 1.25);
      // the light everything else is lit by: follows the flames, with a living flicker
      const fl = 0.8 + 0.4 * ns(t * 26, 11.5) + 0.12 * (ns(t * 90, 71.3) - 0.5);
      this.light = clamp((this.intensity * 0.92 + this.coal * 0.16) * fl, 0, 1.3);

      this.acc.spark += dt * (0.8 + 5.5 * this.intensity) * this.mood.sparks;
      while (this.acc.spark >= 1) {
        this.acc.spark -= 1;
        this.spawnSpark(false);
      }
      this.acc.smoke += dt * (2 + 2 * this.intensity);
      while (this.acc.smoke >= 1) {
        this.acc.smoke -= 1;
        this.smoke.push({
          x: this.cx + rand(-26, 26) * s, y: this.by - (70 + 150 * this.intensity) * s,
          vx: rand(-6, 6) * s, vy: -rand(20, 36) * s, life: 0, max: rand(4, 7.5), r: rand(20, 34) * s,
        });
      }
      for (const p of this.sparks) {
        p.life += dt;
        p.px = p.x; p.py = p.y;
        p.vx += (Math.sin(t * 3 + p.seed) * 60 + this.wind * 26) * s * dt;
        p.vy += 22 * s * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      this.sparks = this.sparks.filter((p) => p.life < p.max);
      for (const p of this.smoke) {
        p.life += dt;
        p.x += (p.vx + this.wind * 16 * s + Math.sin(t * 0.5 + p.y * 0.01) * 6 * s) * dt;
        p.y += p.vy * dt;
        p.r += 8 * s * dt;
      }
      this.smoke = this.smoke.filter((p) => p.life < p.max);

      this.statTimer -= dt;
      if (this.statTimer <= 0) {
        this.statTimer = 0.3;
        const lvl = clamp(this.intensity / 1.15, 0, 1);
        this.stat('intensity', lvl);
        this.stat('logs', this.logs.filter((L) => L.drop >= 1 && L.burn < 0.8).length);
        this.stat('stage', STAGES.find(([min]) => lvl >= min)[1]);
      }
    }
    stat(key, value) {
      if (!this.screen) return;
      this.screen.querySelectorAll(`[data-stat="${key}"]`).forEach((el) => {
        if (el.dataset.statMode === 'width') el.style.width = `${Math.round(value * 100)}%`;
        else if (el.textContent !== String(value)) el.textContent = value;
      });
    }

    /* ---------- flames ---------- */
    renderFlames() {
      const F = this.field, { cols, rows, cell, heat, hgt, base } = F;
      const s = this.s, t = this.t, m = this.mood;
      const cxc = (this.cx - F.x0) / cell;
      heat.fill(0);
      for (const L of this.logs) {
        if (L.drop < 1 || !(L.power > 0.01)) continue;
        const lx = (this.cx + L.x * s - F.x0) / cell;
        const hl = Math.max(14 * s, Math.abs(Math.cos(L.a)) * L.len * s * 0.44) / cell;
        const p = L.power * WOOD[L.kind].bright;
        const a = Math.max(0, Math.floor(lx - hl)), b = Math.min(cols - 1, Math.ceil(lx + hl));
        for (let i = a; i <= b; i++) {
          const u = (i - lx) / hl;
          if (u > -1 && u < 1) heat[i] += p * (1 - u * u) * 0.7;
        }
      }
      const core = Math.min(1, this.fuel / 2.2) * 0.55 + this.flare * 0.3;
      const cw = (54 * s) / cell;
      const maxH = rows * 0.56 * m.tall;
      for (let i = 0; i < cols; i++) {
        const u = (i - cxc) / cw;
        let hN = heat[i] + core * Math.exp(-u * u);
        // a few tongues of flame keep licking out of the coals even when the logs are spent
        hN += this.coal * 0.1 * smooth(0.56, 0.82, ns(i * cell * 0.16 / s + 40, t * 3)) * Math.exp(-u * u * 0.4);
        hN = Math.min(hN, 1.5);
        heat[i] = 0.36 + 0.36 * hN;
        hgt[i] = maxH * Math.pow(hN / 1.5, 0.72) * (0.45 + 0.95 * smooth(0.18, 0.92, ns(i * cell * 0.3 / s + 9, t * 10)));
        base[i] = (12 * s * Math.min(1, hN)) / cell;
      }
      const data = F.img.data;
      const fs = cell / s; // noise is sampled in scene units so every size looks alike
      const rise = t * 150, rise2 = t * 250;
      const warp = (34 * m.turb) / fs, lean = this.wind * 0.13, conv = 0.32;
      const a1 = 1.05 * m.turb, a2 = 0.6 * m.turb;
      let o = 0;
      for (let j = 0; j < rows; j++) {
        const yUp = rows - 1 - j;
        const yn = yUp / rows;
        const ny1 = j * fs * 0.42 + rise, ny2 = j * fs * 1.05 + rise2;
        const bend = lean * yn * yn * rows + 0.5;
        for (let i = 0; i < cols; i++, o += 4) {
          const n1 = ns(i * fs * 0.62 + 31.7, ny1);
          const cf = i + (n1 - 0.5) * warp * (0.5 + yn * 2) - bend + (i - cxc) * conv * yn;
          const ci = Math.floor(cf);
          if (ci < 0 || ci >= cols - 1) { data[o + 3] = 0; continue; }
          const fr = cf - ci;
          const H = hgt[ci] + (hgt[ci + 1] - hgt[ci]) * fr;
          const up = yUp - base[ci];
          const k = H > 1 ? up / H : 2;
          if (up < -3 || k > 1.5) { data[o + 3] = 0; continue; }
          const n2 = ns(i * fs * 1.5 + 77.1, ny2);
          const kk = k < 0 ? 0 : k;
          // the noise tears the flame more the higher it gets, then lets go of it
          const tear = kk < 0.9 ? 1 : 1 - (kk - 0.9) / 0.6;
          let v = (heat[ci] + (heat[ci + 1] - heat[ci]) * fr) * (1 - kk)
            + ((n1 - 0.5) * a1 * (0.12 + kk) + (n2 - 0.5) * a2 * (0.2 + kk)) * tear;
          if (kk > 0.9) v *= tear;
          v *= 0.12 + 0.88 * smooth(-3, 0.22 * H + 2, up); // thin at the very root so the wood shows through
          const q = (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0) << 2;
          data[o] = LUT[q];
          data[o + 1] = LUT[q + 1];
          data[o + 2] = LUT[q + 2];
          data[o + 3] = LUT[q + 3];
        }
      }
      F.ctx.putImageData(F.img, 0, 0);
      F.bctx.globalCompositeOperation = 'copy';
      F.bctx.drawImage(F.canvas, 0, 0, F.bloom.width, F.bloom.height);
    }

    /* ---------- drawing ---------- */
    drawStones(ctx, front) {
      const { s, cx, by } = this;
      const rx = 150 * s, ry = 46 * s, cy = by + 8 * s;
      const L = clamp(this.light, 0, 1.1);
      const list = this.stones.filter((st) => st.front === front).sort((a, b) => Math.sin(a.a) - Math.sin(b.a));
      for (const st of list) {
        const x = cx + Math.cos(st.a) * rx, y = cy + Math.sin(st.a) * ry;
        const sw = (st.w * s) / 2, sh = (st.h * s) / 2;
        // light comes from the fire: find the edge of the stone that faces it
        let dx = cx - x, dy = by - 26 * s - y;
        const dl = Math.hypot(dx, dy) || 1;
        dx /= dl; dy /= dl;
        const g = ctx.createLinearGradient(x + dx * sw, y + dy * sh, x - dx * sw * 0.7, y - dy * sh * 0.9);
        const litC = mix([52 * st.tone, 46 * st.tone, 44 * st.tone], [255, 150, 70], clamp(L * (front ? 0.78 : 0.9), 0, 1));
        const midC = mix([34 * st.tone, 30 * st.tone, 29 * st.tone], [150, 70, 34], clamp(L * (front ? 0.2 : 0.55), 0, 1));
        g.addColorStop(0, rgb(litC));
        g.addColorStop(front ? 0.3 : 0.6, rgb(midC));
        g.addColorStop(1, 'rgb(10,9,9)');
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.beginPath();
        ctx.ellipse(x, y + sh * 0.75, sw * 1.05, sh * 0.42, 0, 0, TAU);
        ctx.fill();
        ctx.fillStyle = g;
        blob(ctx, x, y, sw, sh, st.verts, st.rot);
        ctx.fill();
      }
    }

    drawLog(ctx, L) {
      const s = this.s, light = clamp(this.light, 0, 1.2);
      const d = L.drop < 1 ? easeOutBounce(L.drop) : 1;
      const len = L.len * s * (1 - 0.3 * smooth(0.55, 1, L.burn));
      const th = L.th * s * (1 - 0.35 * smooth(0.5, 1, L.burn));
      const char = clamp(L.burn * 1.5 + L.ignite * 0.18, 0, 1);
      ctx.save();
      ctx.translate(this.cx + L.x * s, this.by + L.y * s - (1 - d) * 280 * s);
      ctx.rotate(L.a + (1 - d) * 0.5 * (L.a < 0 ? -1 : 1) + (L.jolt || 0) * this.kick);
      ctx.globalAlpha = 1 - smooth(0.88, 1, L.burn);
      // cut end, seen a little from the side
      const ex = len / 2 - th * 0.16;
      roundRect(ctx, -len / 2, -th / 2, len, th, th / 2);
      ctx.save();
      ctx.clip();
      ctx.drawImage(L.tex, -len / 2, -th / 2, len, th);
      // it chars from the middle of the fire outward
      const mid = clamp(0.5 - (L.x * Math.cos(L.a)) / L.len, 0.2, 0.8);
      const cg = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
      const ca = (dist) => clamp(char * 1.5 - dist * 1.1 * (1 - char), 0, 0.97);
      cg.addColorStop(0, `rgba(17,12,10,${ca(mid)})`);
      cg.addColorStop(mid, `rgba(17,12,10,${ca(0)})`);
      cg.addColorStop(1, `rgba(17,12,10,${ca(1 - mid)})`);
      ctx.fillStyle = cg;
      ctx.fillRect(-len / 2, -th / 2, len, th);
      // darkness away from the fire
      ctx.fillStyle = `rgba(0,0,0,${0.62 - 0.5 * clamp(light, 0, 1)})`;
      ctx.fillRect(-len / 2, -th / 2, len, th);
      // ash settles on what has burnt
      const ashA = smooth(0.45, 0.9, L.burn);
      if (ashA > 0.01) {
        ctx.fillStyle = `rgba(170,162,154,${0.3 * ashA})`;
        for (const a of L.ash) {
          ctx.beginPath();
          ctx.ellipse(a.u * len, a.v * th, a.r * s * 1.3, a.r * s * 0.45, 0, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalCompositeOperation = 'lighter';
      // firelight along the top
      const rim = ctx.createLinearGradient(0, -th / 2, 0, th * 0.2);
      rim.addColorStop(0, `rgba(255,150,64,${0.5 * light * (0.3 + 0.7 * L.ignite)})`);
      rim.addColorStop(1, 'rgba(255,140,60,0)');
      ctx.fillStyle = rim;
      ctx.fillRect(-len / 2, -th / 2, len, th);
      // the char glows from inside
      const glowA = L.ignite * smooth(0.04, 0.5, L.burn + 0.08) * (0.55 + 0.45 * this.coal);
      if (glowA > 0.01) {
        const pulse = 0.55 + 0.45 * ns(this.t * 9 + L.len, L.th * 3.1);
        const eg = ctx.createRadialGradient((mid - 0.5) * len, th * 0.1, 0, (mid - 0.5) * len, th * 0.1, len * 0.42);
        eg.addColorStop(0, `rgba(255,84,20,${0.5 * glowA * pulse})`);
        eg.addColorStop(0.6, `rgba(200,36,8,${0.2 * glowA * pulse})`);
        eg.addColorStop(1, 'rgba(160,20,4,0)');
        ctx.fillStyle = eg;
        ctx.fillRect(-len / 2, -th / 2, len, th);
        ctx.lineCap = 'round';
        ctx.lineWidth = Math.max(0.7, 1.15 * s);
        for (const c of L.cracks) {
          const fl = smooth(0.25, 0.9, ns(this.t * 12 + c.p * 40, c.p * 9));
          ctx.strokeStyle = `rgba(255,${(96 + 100 * fl) | 0},${(24 + 40 * fl) | 0},${glowA * (0.25 + 0.75 * fl)})`;
          const x0 = c.u * len, y0 = c.v * th;
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.lineTo(x0 + Math.cos(c.a) * c.l * len, y0 + Math.sin(c.a) * c.l * len * 0.3);
          ctx.stroke();
        }
      }
      ctx.restore();
      if (char < 0.9) {
        ctx.fillStyle = rgb(mix(mix([206, 160, 106], [58, 40, 28], char), [20, 14, 10], 0.55 - 0.5 * clamp(light, 0, 1)));
        ctx.beginPath();
        ctx.ellipse(ex, 0, th * 0.3, th * 0.48, 0, 0, TAU);
        ctx.fill();
        ctx.strokeStyle = `rgba(96,58,30,${0.7 * (1 - char)})`;
        ctx.lineWidth = Math.max(0.5, 0.8 * s);
        for (const r of [0.34, 0.18]) {
          ctx.beginPath();
          ctx.ellipse(ex, 0, th * r * 0.62, th * r, 0, 0, TAU);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    draw(ctx) {
      const { w, h, s, cx, by, t } = this;
      const L = this.light, Lc = clamp(L, 0, 1);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.lit, 0, 0, w, h);

      /* long shadows the stones throw outward */
      for (const st of this.stones) {
        const x = cx + Math.cos(st.a) * 150 * s, y = by + 8 * s + Math.sin(st.a) * 46 * s;
        const far = 1.75 + 0.2 * ns(t * 20, st.a * 30);
        const x2 = cx + Math.cos(st.a) * 150 * s * far, y2 = by + 8 * s + Math.sin(st.a) * 46 * s * far;
        const nx = -Math.sin(st.a), ny = Math.cos(st.a) * 0.3, hw = st.w * s * 0.42;
        const sg = ctx.createLinearGradient(x, y, x2, y2);
        sg.addColorStop(0, `rgba(0,0,0,${0.36 * Lc})`);
        sg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.moveTo(x + nx * hw, y + ny * hw);
        ctx.lineTo(x2 + nx * hw * 1.8, y2 + ny * hw * 1.8);
        ctx.lineTo(x2 - nx * hw * 1.8, y2 - ny * hw * 1.8);
        ctx.lineTo(x - nx * hw, y - ny * hw);
        ctx.closePath();
        ctx.fill();
      }

      /* light mask: the ground and trees were painted fully lit, this is the dark of the night */
      ctx.save();
      ctx.translate(cx, by - 6 * s);
      ctx.scale(1, 0.5);
      const R = 500 * s * (0.86 + 0.14 * Lc);
      const g = ctx.createRadialGradient(0, 0, 60 * s, 0, 0, R);
      const p = Math.pow(Lc, 0.7);
      g.addColorStop(0, `rgba(3,2,2,${1 - 0.88 * p})`);
      g.addColorStop(0.2, `rgba(3,2,2,${1 - 0.6 * p})`);
      g.addColorStop(0.45, `rgba(3,2,2,${1 - 0.26 * p})`);
      g.addColorStop(0.75, `rgba(3,2,2,${1 - 0.07 * p})`);
      g.addColorStop(1, 'rgba(3,2,2,0.975)');
      ctx.fillStyle = g;
      ctx.fillRect(-w, -h * 2.2, w * 2, h * 4.4);
      ctx.restore();

      ctx.drawImage(this.sky, 0, 0, w, h);
      ctx.fillStyle = '#eef2ff';
      for (const st of this.twinkles) {
        ctx.globalAlpha = 0.25 + 0.6 * (0.5 + 0.5 * Math.sin(t * st.sp + st.p));
        ctx.fillRect(st.x, st.y, st.r, st.r);
      }
      ctx.globalAlpha = 1;

      /* warm haze in the air around the fire */
      ctx.globalCompositeOperation = 'lighter';
      const hr = (300 + 80 * Lc) * s;
      let hg = ctx.createRadialGradient(cx, by - 60 * s, 0, cx, by - 60 * s, hr * 1.5);
      hg.addColorStop(0, `rgba(255,120,40,${0.2 * L})`);
      hg.addColorStop(0.4, `rgba(255,86,26,${0.07 * L})`);
      hg.addColorStop(1, 'rgba(255,80,20,0)');
      ctx.fillStyle = hg;
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';

      /* pit: ash, back stones, coals */
      ctx.fillStyle = '#0d0907';
      ctx.beginPath();
      ctx.ellipse(cx, by + 8 * s, 128 * s, 36 * s, 0, 0, TAU);
      ctx.fill();
      this.drawStones(ctx, false);
      const coal = this.coal;
      for (const c of this.coals) {
        const x = cx + c.x * 104 * s, y = by + 8 * s + c.y * 25 * s, r = c.r * s;
        ctx.fillStyle = '#17100d';
        blob(ctx, x, y, r, r * 0.62, c.verts, c.rot);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.save();
      ctx.translate(cx, by + 6 * s);
      ctx.scale(1, 0.3);
      const bed = clamp(0.25 + 0.75 * coal, 0, 1) * (0.55 + 0.45 * Lc);
      hg = ctx.createRadialGradient(0, 0, 0, 0, 0, 118 * s);
      hg.addColorStop(0, `rgba(255,112,32,${0.62 * bed})`);
      hg.addColorStop(0.55, `rgba(200,46,10,${0.34 * bed})`);
      hg.addColorStop(1, 'rgba(120,20,4,0)');
      ctx.fillStyle = hg;
      ctx.beginPath();
      ctx.arc(0, 0, 118 * s, 0, TAU);
      ctx.fill();
      ctx.restore();
      for (const c of this.coals) {
        // each coal breathes on its own slow rhythm
        const breath = smooth(0.25, 0.85, ns(c.seed, t * 5 + c.seed * 3)) * (0.3 + 0.7 * coal) + this.kick * 0.4;
        if (breath < 0.03) continue;
        const x = cx + c.x * 104 * s, y = by + 8 * s + c.y * 25 * s, r = c.r * s * 1.7;
        ctx.globalAlpha = clamp(breath, 0, 1);
        ctx.drawImage(breath > 0.7 ? EMBER_HOT : EMBER, x - r, y - r * 0.62, r * 2, r * 1.24);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      for (const lg of this.logs) this.drawLog(ctx, lg);

      /* flames */
      this.renderFlames();
      const F = this.field;
      const fw = F.cols * F.cell, fh = F.rows * F.cell, fx0 = F.x0, fy0 = F.y1 - fh;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.3;
      ctx.drawImage(F.bloom, fx0 - fw * 0.04, fy0 - fh * 0.04, fw * 1.08, fh * 1.08);
      ctx.globalAlpha = 1;
      ctx.drawImage(F.canvas, fx0, fy0, fw, fh);

      /* sparks, with a short tail */
      ctx.lineCap = 'round';
      for (const sp of this.sparks) {
        const k = sp.life / sp.max;
        ctx.globalAlpha = (1 - k) * (0.5 + 0.5 * Math.sin(t * 24 + sp.seed * 5));
        ctx.strokeStyle = k < 0.3 ? '#ffe9b8' : k < 0.7 ? '#ffa24e' : '#e0541c';
        ctx.lineWidth = sp.r * 1.35 * (1 - 0.5 * k);
        ctx.beginPath();
        ctx.moveTo(sp.px - (sp.x - sp.px) * 0.2, sp.py - (sp.y - sp.py) * 0.2);
        ctx.lineTo(sp.x, sp.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      this.drawStones(ctx, true);

      for (const sm of this.smoke) {
        const k = sm.life / sm.max;
        ctx.globalAlpha = 0.085 * Math.sin(k * Math.PI);
        ctx.drawImage(SMOKE, sm.x - sm.r, sm.y - sm.r, sm.r * 2, sm.r * 2);
      }
      ctx.globalAlpha = 1;
      ctx.drawImage(this.vig, 0, 0, w, h);
    }
  }

  /* ---------- mounting & loop ---------- */
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
      for (let i = 0; i < 90; i++) sc.step(1 / 30);
    }
    return true;
  }
  function render(sc) {
    sc.ctx.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0);
    sc.draw(sc.ctx);
  }
  function mount() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__fire2.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    const ro = 'ResizeObserver' in window
      ? new ResizeObserver((es) => es.forEach((e) => { const sc = e.target.__fire2; if (ready(sc)) render(sc); }))
      : null;
    document.querySelectorAll('canvas[data-fire2]').forEach((c) => {
      const sc = new Fire2(c);
      c.__fire2 = sc;
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
      const b = e.target.closest('[data-fire2-act]');
      if (!b) return;
      const screen = b.closest('.screen');
      const c = screen && screen.querySelector('canvas[data-fire2]');
      if (!c || !c.__fire2 || !c.__fire2.warmed) return;
      let wood = b.dataset.wood;
      if (b.dataset.fire2Act === 'add') {
        if (wood) {
          // choosing a wood also makes it the one the main button throws in
          screen.dataset.wood = wood;
          screen.querySelectorAll('[data-wood]').forEach((x) => x.classList.toggle('on', x.dataset.wood === wood));
          screen.querySelectorAll('[data-wood-art]').forEach((x) => { x.className = `log-art mini ${wood}`; });
          screen.querySelectorAll('[data-wood-name]').forEach((x) => { x.textContent = b.dataset.label || x.textContent; });
        } else {
          wood = screen.dataset.wood || 'oak';
        }
      }
      c.__fire2.action(b.dataset.fire2Act, wood);
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
