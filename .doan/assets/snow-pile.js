/* mong — 눈멍 · 눈더미 시안 (Doan 보드 전용). 코드(src/scenes/clocktower.ts)에 옮겼어요. 빨리 감기 · 딱지 · 손가락은 보드에만 있어요.
   snow.js 의 시계탑 장면을 이어받아서, 눈이 내리는 동안 정해진 자리에 눈더미가 쌓이게 해요.
   <canvas data-snowpile> 하나가 장면 하나.
     data-pile="0.6"   눈더미가 쌓인 정도 0~1 (멈춘 단계를 보여 줄 때)
     data-ff="12"      빨리 감기 배수. 있으면 빈 앞마당에서 시작해서 PILE 시간표대로 쌓여요 (없으면 멈춰 있어요)
     data-loop         다 쌓이면 잠깐 뒤 처음으로 돌아가요 (설명용)
     data-loop="68"    보드 시계로 이 초마다 다 같이 처음으로 돌아가요. 나란히 놓은 화면끼리 맞춰 볼 때 써요
   새 눈 버튼은 발자국 · 쓴 자리와 함께 눈더미도 가라앉혀 빈 앞마당으로 돌려요. 그다음 처음처럼 다시 쌓여요.
   멈춘 단계 화면은 12배 빨리 감기로 원래 단계까지 다시 쌓이고 멈춰요 (보드 설명용)
     data-fall · data-trail · data-auto · data-cover 는 snow.js 와 같아요
   눈더미 안을 밟으면 벽돌이 아니라 눌린 눈이 보여요. 끌어도 눈더미 안은 눌린 눈 골이 파여요. */
(() => {
  'use strict';
  const M = window.MongSnow;
  if (!M) return;
  const { Snow, mk, rand, clamp, ease, rng, TAU, solePath, drawPrint } = M;

  /* 눈 세기마다 쌓이는 시간 (실제 초, 제안). start 가 지나야 눈더미가 생기기 시작하고, full 에 끝까지 쌓여요.
     그 전까지는 앞마당에 얕은 눈만 있어요. 보드는 data-ff 배로 빨리 감아서 보여 줘요 */
  const PILE = {
    0.3: { start: 120, full: 720 }, /* 가루눈 · 2분 뒤 시작, 12분에 끝 */
    0.6: { start: 60, full: 360 }, /* 눈 · 1분 뒤 시작, 6분에 끝 */
    1: { start: 30, full: 180 }, /* 함박눈 · 30초 뒤 시작, 3분에 끝 */
  };
  const STAGES = [
    [0.04, '아직 안 쌓였어요'],
    [0.4, '조금 쌓였어요'],
    [0.8, '소복이 쌓였어요'],
    [1, '수북이 쌓였어요'],
    [2, '다 쌓였어요'],
  ];
  const stageOf = (a) => STAGES.find((s) => a < s[0])[1];
  /* 실제 시간을 "1분 10초째" 처럼. 빨리 감기라서 10초 단위로 끊어요 */
  const clockText = (sec) => {
    const t = Math.floor(sec / 10) * 10, m = Math.floor(t / 60), s = t % 60;
    return `${m ? `${m}분` : ''}${m && s ? ' ' : ''}${s || !m ? `${s}초` : ''}째`;
  };

  class PileSnow extends Snow {
    streetInit() {
      super.streetInit();
      const { w, h, gy, dpr } = this;
      const d = this.canvas.dataset;
      this.ff = Number(d.ff) || 0;
      /* 빨리 감기 화면은 늘 빈 앞마당에서 시작해요 */
      this.amt = this.ff ? 0 : d.pile !== undefined ? clamp(Number(d.pile), 0, 1) : 0;
      /* 어디까지 쌓이나. 멈춘 단계 화면은 새 눈 뒤에 원래 단계까지만 다시 쌓여요 */
      this.target = this.ff ? 1 : this.amt;
      this.loop = d.loop !== undefined;
      this.period = Number(d.loop) || 0;
      this.cycle = 0;
      this.clearing = false;
      this.regrow = false;
      this.tag = this.screen ? this.screen.querySelector('.pile-tag') : null;
      this.tagHTML = this.tag ? this.tag.innerHTML : '';
      this.resetPile();
      /* snow.js 의 시계탑과 같은 배율 · 가운데 */
      const u = (this.u = clamp(Math.min(w / 390, (gy - 158) / 305), 0.8, 1.5));
      const cx = (this.cx = w / 2);
      const wide = w > 600, G = h - gy;
      this.lampXs = [cx - 168 * u, cx + 168 * u];
      /* 앞마당 눈더미. fx · fy 는 앞마당 안에서의 자리, delay 는 쌓이기 시작하는 때 */
      const yard = (fx, fy, rx, hh, delay, s) => {
        const y = gy + G * fy, sc = this.scaleAt(y) * (wide ? 1.35 : 1);
        return { x: w * fx, y, rx: rx * sc, hh: hh * sc, delay, s, big: true };
      };
      this.mounds = [
        yard(0.16, 0.42, 96, 60, 0.08, 1.1),
        yard(0.8, 0.3, 84, 50, 0.2, 2.7),
        ...(wide ? [yard(0.6, 0.52, 80, 46, 0.3, 4.2), yard(0.35, 0.26, 62, 34, 0.15, 5.5)] : []),
        /* 가로등 · 나무 밑동 */
        ...this.lampXs.map((lx, i) => ({ x: lx, y: gy + 17, rx: 36 * u, hh: 22 * u, delay: 0.03, s: 3 + i })),
        { x: cx - 196 * u, y: gy + 13, rx: 30 * u, hh: 16 * u, delay: 0.1, s: 6.1 },
        { x: cx + 200 * u, y: gy + 13, rx: 30 * u, hh: 16 * u, delay: 0.1, s: 7.4 },
      ].sort((a, b) => a.y - b.y);
      this.pileLayer = mk(w * dpr, h * dpr);
      this.pileMask = mk(this.mask.width, this.mask.height);
      this.tA = mk(this.mask.width, this.mask.height);
      this.tB = mk(this.mask.width, this.mask.height);
      /* 눌린 눈 결 */
      const pk = mk(64, 64), px = pk.getContext('2d'), r = rng(9);
      px.fillStyle = '#ccd7ee'; px.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 90; i++) {
        px.fillStyle = r() < 0.5 ? 'rgba(112,134,188,0.22)' : 'rgba(255,255,255,0.3)';
        px.beginPath(); px.ellipse(r() * 64, r() * 64, 1 + r() * 3, 0.6 + r() * 1.4, 0, 0, TAU); px.fill();
      }
      this.packed = this.tB.getContext('2d').createPattern(pk, 'repeat');
      this.renderPiles();
    }

    /* ---------- 눈더미 모양 ---------- */
    /* 처음엔 작고 낮게 비치다가 옆으로 퍼지고, 그다음 높아져요 */
    geo(m) {
      const a = clamp((this.amt - m.delay) / (1 - m.delay), 0, 1), sp = 0.2 + 0.8 * Math.pow(a, 0.55);
      return { a, rx: m.rx * sp, ry: m.rx * 0.2 * sp, H: m.hh * Math.pow(a, 0.9), fade: clamp(a / 0.12, 0, 1) };
    }
    prof(m, t) {
      return Math.pow(Math.max(0, 1 - t * t), 0.75) * (1 + 0.13 * Math.sin(t * 3.1 + m.s) + 0.07 * Math.sin(t * 7.3 + m.s * 2.3));
    }
    topAt(m, g, t) { return m.y - g.ry * 0.35 * Math.sqrt(Math.max(0, 1 - t * t)) - g.H * this.prof(m, t); }
    botAt(m, g, t) { return m.y + g.ry * Math.sqrt(Math.max(0, 1 - t * t)); }
    moundPath(c, m, g, topOnly) {
      const N = 30;
      c.beginPath();
      for (let i = 0; i <= N; i++) { const t = -1 + (2 * i) / N; c.lineTo(m.x + t * g.rx, this.topAt(m, g, t)); }
      if (topOnly) return;
      for (let i = N; i >= 0; i--) { const t = -1 + (2 * i) / N; c.lineTo(m.x + t * g.rx, this.botAt(m, g, t)); }
      c.closePath();
    }
    /* 건물 벽 아래로 길게 쌓이는 눈. 현관 앞은 덜 쌓여요 */
    get bankA() { return Math.pow(clamp(this.amt / 0.9, 0, 1), 0.8); }
    bankTop(px) {
      const { gy, u, cx } = this;
      const door = 0.45 + 0.55 * Math.min(1, Math.abs(px - cx) / (60 * u));
      return gy + 10 - this.bankA * u * door * (9 + 15 * (0.5 + 0.5 * Math.sin(px * 0.019 + 1.3)) * (0.65 + 0.35 * Math.sin(px * 0.063 + 0.4)));
    }
    /* 아랫단도 얇게 시작해서 퍼져요. 처음부터 띠가 보이지 않게 */
    bankBot(px) { return this.gy + 10 + Math.min(1, this.bankA * 2.5) * (6 + 5 * Math.sin(px * 0.045)); }
    bankPath(c) {
      const { w } = this;
      c.beginPath();
      for (let px = -4; px <= w + 4; px += 6) c.lineTo(px, this.bankTop(px));
      for (let px = w + 4; px >= -4; px -= 12) c.lineTo(px, this.bankBot(px));
      c.closePath();
    }
    /* (x, y) 가 눈더미 안이면 그 깊이 0~1, 아니면 0 */
    depthAt(x, y) {
      let best = 0;
      if (this.bankA > 0.03) {
        const top = this.bankTop(x), bot = this.bankBot(x);
        if (y > top + 1 && y < bot) best = 0.45 * this.bankA;
      }
      for (const m of this.mounds) {
        const g = this.geo(m);
        if (g.a < 0.03) continue;
        const t = (x - m.x) / g.rx;
        if (Math.abs(t) >= 1) continue;
        const top = this.topAt(m, g, t), bot = this.botAt(m, g, t);
        if (y <= top + 1 || y >= bot) continue;
        const v = g.a * Math.sqrt(1 - t * t) * Math.min(1, (y - top) / 6, (bot - y) / 5 + 0.35);
        if (v > best) best = v;
      }
      return clamp(best, 0, 1);
    }
    drawMound(c, m, g) {
      const { cx } = this;
      c.save();
      c.translate(m.x + g.rx * 0.1, m.y + g.ry * 0.55);
      c.scale(1, 0.3);
      let gr = c.createRadialGradient(0, 0, g.rx * 0.3, 0, 0, g.rx * 1.25);
      gr.addColorStop(0, 'rgba(44,58,108,0.34)'); gr.addColorStop(1, 'rgba(44,58,108,0)');
      c.fillStyle = gr; c.beginPath(); c.arc(0, 0, g.rx * 1.25, 0, TAU); c.fill();
      c.restore();
      const top = m.y - g.H - g.ry * 0.35, bot = m.y + g.ry;
      this.moundPath(c, m, g);
      gr = c.createLinearGradient(0, top, 0, bot);
      gr.addColorStop(0, '#f7faff'); gr.addColorStop(0.55, '#e4ebf8'); gr.addColorStop(1, '#bdcbe7');
      c.fillStyle = gr; c.fill();
      c.save();
      c.clip();
      /* 시계탑 불빛에서 먼 쪽이 그늘져요 */
      const far = m.x < cx ? -1 : 1;
      gr = c.createLinearGradient(m.x - far * g.rx * 0.2, 0, m.x + far * g.rx, 0);
      gr.addColorStop(0, 'rgba(70,92,156,0)'); gr.addColorStop(1, 'rgba(70,92,156,0.3)');
      c.fillStyle = gr; c.fillRect(m.x - g.rx, top - 2, g.rx * 2, bot - top + 4);
      const r = rng(Math.round(m.s * 1000));
      for (let i = 0; i < 26; i++) {
        const t = r() * 2 - 1, yy = this.topAt(m, g, t) + r() * (this.botAt(m, g, t) - this.topAt(m, g, t));
        c.fillStyle = r() < 0.6 ? 'rgba(255,255,255,0.5)' : 'rgba(84,104,160,0.12)';
        c.fillRect(m.x + t * g.rx, yy, 1 + r() * 1.6, 1 + r());
      }
      c.restore();
      this.moundPath(c, m, g, true);
      c.strokeStyle = 'rgba(255,255,255,0.85)'; c.lineWidth = 1.6; c.lineJoin = 'round';
      c.stroke();
    }
    renderPiles() {
      const { w, h, gy, u, dpr } = this;
      const L = this.pileLayer.getContext('2d'), K = this.pileMask.getContext('2d');
      L.setTransform(dpr, 0, 0, dpr, 0, 0);
      L.globalCompositeOperation = 'source-over';
      L.clearRect(0, 0, w, h);
      K.setTransform(this.pileMask.width / w, 0, 0, this.pileMask.height / h, 0, 0);
      K.clearRect(0, 0, w, h);
      K.fillStyle = '#fff';
      this.drawnAmt = this.amt;
      if (this.amt < 0.005) return;
      if (this.bankA > 0.01) {
        this.bankPath(L);
        const gr = L.createLinearGradient(0, gy - 20 * u, 0, gy + 21);
        gr.addColorStop(0, '#f1f5fd'); gr.addColorStop(0.6, '#dbe3f4'); gr.addColorStop(1, '#bfcbe6');
        L.globalAlpha = clamp(this.bankA / 0.15, 0, 1);
        L.fillStyle = gr; L.fill();
        L.globalAlpha = 1;
        this.bankPath(K); K.fill();
      }
      for (const m of this.mounds) {
        const g = this.geo(m);
        if (g.a < 0.01) continue;
        L.globalAlpha = g.fade;
        this.drawMound(L, m, g);
        L.globalAlpha = 1;
        this.moundPath(K, m, g); K.fill();
      }
      /* 가로등 빛이 닿는 눈더미는 따뜻한 색 */
      L.globalCompositeOperation = 'source-atop';
      for (const lx of this.lampXs) {
        L.save(); L.translate(lx, gy + 34); L.scale(1, 0.3);
        const gr = L.createRadialGradient(0, 0, 0, 0, 0, 150 * u);
        gr.addColorStop(0, 'rgba(255,204,138,0.5)'); gr.addColorStop(1, 'rgba(255,204,138,0)');
        L.fillStyle = gr; L.beginPath(); L.arc(0, 0, 150 * u, 0, TAU); L.fill();
        L.restore();
      }
      L.globalCompositeOperation = 'source-over';
    }
    /* 지붕과 가로등 갓 위의 눈도 같이 두꺼워져요 */
    drawCaps(x) {
      const a = this.amt;
      if (a < 0.005) return;
      const { cx, gy, u } = this, th = 7 * a;
      x.save();
      x.translate(cx, gy); x.scale(u, u);
      x.fillStyle = '#eef3fc';
      x.beginPath();
      x.moveTo(-121, -134); x.quadraticCurveTo(-121, -136 - th, -110, -136 - th);
      x.lineTo(110, -136 - th); x.quadraticCurveTo(121, -136 - th, 121, -134);
      x.closePath(); x.fill();
      x.beginPath(); x.moveTo(-40 - th * 0.4, -248); x.lineTo(40 + th * 0.4, -248); x.lineTo(0, -296 - th * 1.3); x.closePath(); x.fill();
      x.beginPath(); x.moveTo(-30 - th * 0.3, -63); x.lineTo(30 + th * 0.3, -63); x.lineTo(0, -88 - th * 0.8); x.closePath(); x.fill();
      x.restore();
      x.fillStyle = '#eef3fc';
      for (const lx of this.lampXs) {
        x.beginPath(); x.ellipse(lx, gy - (139 + 2.2 * a) * u, (8 + a) * u, (3.4 + 3.6 * a) * u, 0, 0, TAU); x.fill();
      }
    }

    /* ---------- 밟기 ---------- */
    addPrint(x, y, sc, sq, sound) {
      super.addPrint(x, y, sc, sq, sound);
      const p = this.prints[this.prints.length - 1];
      if (!p || !this.mounds) return;
      const dep = this.depthAt(p.x, p.y);
      if (dep > 0.06) {
        p.deep = true;
        p.d = (2.5 + 4 * dep) * sc;
        for (const c of p.cr) c[2] *= 1.7;
        this.puff(p.x, p.y, 8, sc * 1.2, true);
      }
    }
    /* 눈더미 안의 깊은 발자국. 구멍 위쪽으로 안쪽 벽이, 아래쪽으로 눌린 눈 바닥이 보여요. 벽돌은 안 보여요 */
    drawDeep(x, p) {
      const a = 1 - Math.pow(clamp(p.age, 0, 1), 1.6);
      if (a <= 0) return;
      const k = ease(clamp(p.life / 0.2, 0, 1)), s = p.sc, d = p.d * k, dpr = this.dpr;
      const place = (dy) => {
        x.setTransform(dpr, 0, 0, dpr, 0, 0);
        x.translate(p.x, p.y + dy);
        x.scale(1, p.sq);
        x.rotate(p.ang + Math.PI / 2);
        x.scale(s, s);
      };
      x.save();
      place(2.6 * s);
      solePath(x);
      x.fillStyle = `rgba(255,255,255,${0.95 * a * k})`;
      x.fill();
      place(0);
      solePath(x);
      x.fillStyle = `rgba(118,136,186,${0.95 * a * k})`;
      x.fill();
      x.clip();
      place(d);
      solePath(x);
      x.fillStyle = `rgba(206,217,239,${a * k})`;
      x.fill();
      x.save();
      x.clip();
      x.strokeStyle = `rgba(120,140,192,${0.55 * a * k})`;
      x.lineWidth = 1.8;
      x.beginPath();
      for (let y = -23; y <= 24; y += 5) { x.moveTo(-12, y); x.lineTo(12, y - 2); }
      x.stroke();
      x.restore();
      /* 벽 바로 아래 바닥에 지는 그늘 */
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      const top = p.y - 14 * s + d;
      const g = x.createLinearGradient(0, top, 0, top + 9 * s);
      g.addColorStop(0, `rgba(70,90,150,${0.28 * a * k})`); g.addColorStop(1, 'rgba(70,90,150,0)');
      x.fillStyle = g;
      x.fillRect(p.x - 40 * s, top - 30 * s, 80 * s, 46 * s);
      x.restore();
      for (const c of p.cr) {
        x.fillStyle = `rgba(60,78,122,${0.3 * a * k})`;
        x.beginPath(); x.arc(p.x + c[0], p.y + c[1] * p.sq + 1.6, c[2], 0, TAU); x.fill();
        x.fillStyle = `rgba(255,255,255,${0.95 * a * k})`;
        x.beginPath(); x.arc(p.x + c[0], p.y + c[1] * p.sq, c[2], 0, TAU); x.fill();
      }
    }

    sync() {
      super.sync();
      if (!this.screen || this.amt === undefined) return;
      this.stage = stageOf(this.amt);
      this.clockShown = clockText(this.clock);
      this.screen.querySelectorAll('[data-stat="pile"]').forEach((e) => { e.textContent = this.stage; });
      this.screen.querySelectorAll('[data-stat="clock"]').forEach((e) => { e.textContent = this.clockShown; });
    }

    /* 빈 앞마당으로 돌아가요. clock 은 눈이 내린 실제 시간(초), wait 는 눈더미가 생기기 전까지 0~1 */
    resetPile() {
      if (this.ff) this.amt = 0;
      this.clock = 0;
      this.wait = 0;
      this.holdT = 0;
      this.melting = false;
    }
    /* 새 눈: 발자국 · 쓴 자리(snow.js)와 같이 눈더미도 1초 남짓 만에 가라앉아요 */
    action(name, value) {
      if (name === 'fresh') {
        this.clearing = true;
        this.clearFrom = Math.max(this.amt, 0.01);
        if (!this.ff) {
          /* 멈춘 단계 화면: 빨리 감기로 원래 단계까지 다시 쌓여요. 그동안 딱지가 지금 상태를 보여 줘요 */
          this.ff = 12;
          this.regrow = true;
          if (this.tag) this.tag.innerHTML = '<i>새 눈 · 빨리 감기</i> · <span data-stat="clock"></span> · <span data-stat="pile"></span>';
        }
      }
      super.action(name, value);
    }

    /* 눈더미 자라기. 화면이 안 보일 때도 돌아서, 나란히 놓은 화면끼리 시계가 어긋나지 않아요 */
    tick(dt, boardT) {
      if (!this.ff) return;
      if (this.period) {
        const n = Math.floor(boardT / this.period);
        if (n !== this.cycle) { this.cycle = n; this.clearing = false; this.resetPile(); }
        else if (boardT % this.period > this.period - 1.4) this.melting = true;
      }
      if (this.clearing) {
        this.amt = Math.max(0, this.amt - (dt / 1.1) * this.clearFrom);
        if (this.amt === 0) { this.clearing = false; this.resetPile(); }
      } else if (this.melting) {
        this.amt = Math.max(0, this.amt - dt / 1.2);
        if (!this.period && this.amt === 0) this.resetPile();
      } else if (this.amt < this.target) {
        const P = PILE[this.fall.v], real = dt * this.ff;
        this.clock += real;
        if (this.wait < 1) this.wait = Math.min(1, this.wait + real / P.start);
        else this.amt = Math.min(this.target, this.amt + real / (P.full - P.start));
      } else if (this.regrow) {
        /* 원래 단계까지 다 쌓이면 멈추고 딱지도 원래대로 */
        this.regrow = false;
        this.ff = 0;
        if (this.tag) this.tag.innerHTML = this.tagHTML;
      } else if (this.loop && !this.period) {
        this.holdT += dt;
        if (this.holdT > 6) this.melting = true;
      }
      if (stageOf(this.amt) !== this.stage || clockText(this.clock) !== this.clockShown) this.sync();
    }

    streetStep(dt) {
      const cover = this.flush ? 1.1 : this.cover * 1.6;
      for (const s of this.sweeps) s.age += dt / cover;
      if (this.sweeps.length && this.sweeps[0].age >= 1) this.sweeps = this.sweeps.filter((s) => s.age < 1);
      if (!this.auto) return;
      if (this.userT !== undefined && this.t - this.userT < 5) { this.moveFinger(0, 0, false); return; }
      /* 설명용 손가락: 얕은 눈에서 눈더미 안으로 걸어 들어간 다음, 앞마당을 가로질러 쓸어요 */
      this.autoT += dt;
      const { w, h, gy } = this;
      const cyc = this.autoT % 12, prev = cyc - dt;
      const m = this.mounds.find((q) => q.big && q.x < w / 2), g = this.geo(m);
      if (cyc < 4.6) {
        const x0 = w * 0.47, y0 = m.y + 36, x1 = m.x - g.rx * 0.1, y1 = m.y - g.H * 0.5;
        const f = clamp((cyc - 0.3) / 3.6, 0, 1);
        this.moveFinger(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, true);
        for (let i = 0; i < 5; i++) {
          const tt = 0.6 + i * 0.8;
          if (prev < tt && cyc >= tt) {
            const px = x0 + ((x1 - x0) * i) / 4, py = y0 + ((y1 - y0) * i) / 4;
            this.addPrint(px, py, this.scaleAt(py), 0.5, false);
          }
        }
      } else if (cyc < 10.2) {
        const k = (cyc - 4.6) / 5.6;
        const fx = w / 2 + Math.sin(k * Math.PI * 3) * w * 0.36;
        const fy = gy + 70 + k * Math.max(40, h - gy - 270);
        if (prev < 4.6) this.lastSweep = null;
        this.sweepTo(fx, fy, false);
        this.moveFinger(fx, fy, true);
      } else this.moveFinger(0, 0, false);
    }

    streetDraw(x) {
      const { w, h } = this;
      if (this.amt !== this.drawnAmt && (Math.abs(this.amt - this.drawnAmt) > 0.004 || this.amt === 0 || this.amt === this.target)) this.renderPiles();
      x.drawImage(this.bg, 0, 0, w, h);
      this.drawCaps(x);
      /* 시곗바늘은 지금 시각 */
      const now = new Date(), f = this.face;
      const ha = ((now.getHours() % 12) + now.getMinutes() / 60) / 12 * TAU - Math.PI / 2;
      const ma = (now.getMinutes() / 60) * TAU - Math.PI / 2;
      x.strokeStyle = '#2a2430'; x.lineCap = 'round';
      x.lineWidth = f.r * 0.13; x.beginPath(); x.moveTo(f.x, f.y); x.lineTo(f.x + Math.cos(ha) * f.r * 0.5, f.y + Math.sin(ha) * f.r * 0.5); x.stroke();
      x.lineWidth = f.r * 0.09; x.beginPath(); x.moveTo(f.x, f.y); x.lineTo(f.x + Math.cos(ma) * f.r * 0.76, f.y + Math.sin(ma) * f.r * 0.76); x.stroke();
      const mw = this.mask.width, mh = this.mask.height, kx = mw / w, ky = mh / h;
      const swept = this.sweeps.length > 0, piled = this.drawnAmt >= 0.005;
      /* 얕은 눈을 쓴 자리: 붉은 벽돌이 드러나요 (지금 코드와 같아요) */
      if (swept) {
        const m = this.mask.getContext('2d'), t = this.tmp.getContext('2d');
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
      for (const p of this.prints) if (!p.deep) drawPrint(x, p);
      /* 눈더미가 벽돌과 얕은 발자국을 덮어요 */
      if (piled) x.drawImage(this.pileLayer, 0, 0, w, h);
      /* 눈더미 안을 쓴 자리: 벽돌 대신 눌린 눈 골 */
      if (swept && piled) {
        const A = this.tA.getContext('2d'), B = this.tB.getContext('2d'), dy = Math.max(2, Math.round(7 * ky));
        A.globalCompositeOperation = 'source-over';
        A.clearRect(0, 0, mw, mh);
        A.drawImage(this.mask, 0, 0);
        A.globalCompositeOperation = 'destination-in';
        A.drawImage(this.pileMask, 0, 0);
        B.globalCompositeOperation = 'source-over';
        B.clearRect(0, 0, mw, mh);
        B.drawImage(this.tA, 0, dy);
        B.globalCompositeOperation = 'destination-in';
        B.drawImage(this.tA, 0, 0);
        B.globalCompositeOperation = 'source-in';
        B.fillStyle = this.packed; B.fillRect(0, 0, mw, mh);
        A.globalCompositeOperation = 'source-in';
        A.fillStyle = '#8496c4'; A.fillRect(0, 0, mw, mh);
        x.drawImage(this.tA, 0, 0, w, h);
        x.drawImage(this.tB, 0, 0, w, h);
      }
      for (const p of this.prints) if (p.deep) this.drawDeep(x, p);
      x.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawPuffs();
      this.drawFlakes();
    }
  }

  const scenes = [];
  function start() {
    const io = 'IntersectionObserver' in window
      ? new IntersectionObserver((es) => es.forEach((e) => { e.target.__snow.visible = e.isIntersecting; }), { rootMargin: '200px' })
      : null;
    document.querySelectorAll('canvas[data-snowpile]').forEach((c) => {
      c.dataset.view = 'street';
      const sc = new PileSnow(c);
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
      const c = screen && screen.querySelector('canvas[data-snowpile]');
      if (c && c.__snow) c.__snow.action(b.dataset.snowAct, b.dataset.value);
    });
    let last = 0, boardT = 0;
    const loop = (now) => {
      requestAnimationFrame(loop);
      if (!last) { last = now; return; }
      const elapsed = (now - last) / 1000;
      if (elapsed < 1 / 31) return;
      last = now;
      const dt = Math.min(elapsed, 0.05);
      boardT += dt;
      for (const sc of scenes) {
        sc.tick(dt, boardT);
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
