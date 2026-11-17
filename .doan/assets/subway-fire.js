/* mong — 지하철멍 · 불꽃 버튼 반응 시안 (Doan 보드 전용). 코드(src)에는 아직 없어요.
   subway.js 다음에 불러요. .screen[data-fb="a|b|c"] 안의 [data-fb-fire] 버튼을 누르면 그 안의 방법대로 반응해요.
     a  버튼이 대답해요     눌림 · 아이콘이 퍼지며 돎 · 퍼지는 고리 · 올라가는 동안 차오르는 고리 · 터질 때 불꽃 색으로 빛남
     b  버튼에서 불꽃이 떠나요  버튼에서 불빛이 강까지 날아가고, 닿은 자리에서 불꽃이 올라가요
     c  내 불꽃만 다르게    창 가운데서 빨리 · 굵은 꼬리 · 저절로 오는 불꽃은 쉼 · 1.3배로 터짐 · ‘내 불꽃’을 따로 셈
   세 안 모두 누르면 버튼이 살짝 작아지고 초록으로 채워져요 (.down, 적어도 140ms).
   버튼에는 data-sub-act="wake" 도 달아서, subway.js 가 소리(AudioContext)를 깨우게 해요. */
(() => {
  'use strict';

  const rand = (a, b) => a + Math.random() * (b - a);
  /* subway.js 의 불꽃 색과 같아요 */
  const COL = {
    gold: [255, 200, 112], silver: [236, 240, 255], red: [255, 86, 78], green: [104, 236, 146],
    blue: [104, 156, 255], violet: [190, 132, 255], orange: [255, 150, 70], pink: [255, 128, 186], cyan: [118, 226, 255],
  };
  const reduced = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const restart = (el, cls) => { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); };
  const skyH = (sc) => sc.hy - Math.max(sc.V.y, 0);

  /* 버튼 가운데를 .screen 좌표(390×844 기준)로. 보드를 확대·축소해도 맞아요 */
  function centerIn(screen, el) {
    const sr = screen.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const k = screen.offsetWidth / sr.width;
    return { x: (r.left + r.width / 2 - sr.left) * k, y: (r.top + r.height / 2 - sr.top) * k };
  }

  /* 장면에 손대기: 내 불꽃(mine)은 머리가 밝고, 터질 때 알려 줘요. c 에서는 꼬리가 굵고 크게 터져요 */
  function hook(sc, variant) {
    const big = variant === 'c';
    const burst0 = sc.burst.bind(sc);
    sc.burst = (s) => {
      if (s.mine && big) {
        const S0 = sc.S;
        sc.S = S0 * 1.3;
        burst0(s);
        sc.S = S0;
        const b = sc.bursts[sc.bursts.length - 1];
        if (b) b.power = 1.4;
      } else burst0(s);
      if (s.onBurst) s.onBurst(s);
    };
    const step0 = sc.step.bind(sc);
    sc.step = (dt, quiet) => {
      step0(dt, quiet);
      const S = sc.S;
      for (const s of sc.shells) {
        if (!s.mine) continue;
        sc.parts.push({ x: s.wx, y: s.y, vx: 0, vy: 0, age: 0, life: 0.09, c: [255, 236, 200], drag: 0, g: 0, size: (big ? 7 : 5.5) * S, trail: null, tw: false, dim: 1 });
        if (big) {
          for (let i = 0; i < 2; i++) {
            sc.parts.push({ x: s.wx + rand(-1.2, 1.2) * S, y: s.y + rand(0, 6) * S, vx: rand(-8, 8) * S, vy: rand(10, 30) * S, age: 0, life: rand(0.4, 0.8), c: COL.gold, drag: 2.5, g: 10 * S, size: 3.2 * S, trail: null, tw: true, dim: 0.9 });
          }
        }
      }
    };
  }

  /* 화면 x 에서 한 발. 터질 높이 ty */
  function launchMine(sc, x, ty) {
    sc.launch(sc.fwX + x, ty, true);
    const s = sc.shells[sc.shells.length - 1];
    s.mine = true;
    return s;
  }

  /* ---------- A · 버튼이 대답해요 ---------- */
  function pressA(screen, sc, btn) {
    restart(btn, 'pop');
    if (!reduced()) {
      const r = document.createElement('span');
      r.className = 'fb-ripple';
      btn.appendChild(r);
      r.addEventListener('animationend', () => r.remove());
    }
    const V = sc.V;
    const s = launchMine(sc, V.x + rand(0.2, 0.8) * V.w, sc.hy - rand(0.45, 0.75) * skyH(sc));
    const svg = btn.querySelector('.fb-ring');
    const ring = svg && svg.querySelector('circle');
    if (ring && ring.animate) {
      if (btn._ring) btn._ring.cancel();
      svg.classList.add('on');
      btn._ring = ring.animate([{ strokeDashoffset: 176 }, { strokeDashoffset: 0 }], { duration: s.dur * 1000, easing: 'linear', fill: 'forwards' });
    }
    btn._last = s;
    s.onBurst = (sh) => {
      const c = COL[sh.pal[0]] || COL.gold;
      btn.style.setProperty('--fb-c', c.join(' '));
      restart(btn, 'glow');
      if (btn._last === sh && svg) svg.classList.remove('on');
    };
  }

  /* ---------- B · 버튼에서 불꽃이 떠나요 ---------- */
  function pressB(screen, sc, btn) {
    const V = sc.V;
    const from = centerIn(screen, btn);
    const to = { x: V.x + rand(0.35, 0.65) * V.w, y: sc.hy };
    const ty = sc.hy - rand(0.5, 0.72) * skyH(sc);
    const spark = document.createElement('i');
    spark.className = 'fb-spark';
    screen.appendChild(spark);
    const put = (el, x, y, k = 1) => { el.style.transform = `translate(${x}px, ${y}px) scale(${k})`; };

    if (reduced()) {
      /* 날아가지 않고, 강 위 그 자리에 불빛이 나타났다가 불꽃이 올라가요 */
      put(spark, to.x, to.y);
      spark.animate([{ opacity: 0 }, { opacity: 1, offset: 0.5 }, { opacity: 0 }], { duration: 300 }).onfinish = () => spark.remove();
      setTimeout(() => launchMine(sc, to.x, ty), 150);
      return;
    }

    const ghosts = Array.from({ length: 5 }, () => {
      const g = document.createElement('i');
      g.className = 'fb-spark ghost';
      g.style.opacity = '0';
      screen.appendChild(g);
      return g;
    });
    /* 위로 먼저 솟았다가 강 쪽으로 휘어요 */
    const ctrl = { x: from.x, y: to.y };
    const T = 380;
    const t0 = performance.now();
    const trail = [];
    const frame = (now) => {
      const t = Math.min(1, (now - t0) / T);
      const e = 1 - Math.pow(1 - t, 3);
      const u = 1 - e;
      const x = u * u * from.x + 2 * u * e * ctrl.x + e * e * to.x;
      const y = u * u * from.y + 2 * u * e * ctrl.y + e * e * to.y;
      put(spark, x, y);
      trail.unshift([x, y]);
      if (trail.length > 12) trail.length = 12;
      ghosts.forEach((g, i) => {
        const p = trail[Math.min((i + 1) * 2, trail.length - 1)];
        put(g, p[0], p[1], 1 - i * 0.15);
        g.style.opacity = String(0.55 - i * 0.1);
      });
      if (t < 1) { requestAnimationFrame(frame); return; }
      ghosts.forEach((g) => g.remove());
      launchMine(sc, to.x, ty);
      spark.animate(
        [{ transform: `translate(${to.x}px, ${to.y}px) scale(1)`, opacity: 1 }, { transform: `translate(${to.x}px, ${to.y}px) scale(2.2)`, opacity: 0 }],
        { duration: 220, easing: 'ease-out' },
      ).onfinish = () => spark.remove();
      spark.style.opacity = '0';
    };
    requestAnimationFrame(frame);
  }

  /* ---------- C · 내 불꽃만 다르게 ---------- */
  function pressC(screen, sc, btn) {
    const V = sc.V;
    const s = launchMine(sc, V.x + rand(0.4, 0.6) * V.w, sc.hy - rand(0.6, 0.75) * skyH(sc));
    s.dur *= 0.75;
    /* 내 불꽃이 올라가는 동안, 그리고 터진 뒤 0.9초까지 저절로 오는 불꽃은 쉬어요 */
    sc.next = Math.max(sc.next, s.dur + 0.9);
    s.onBurst = () => {
      screen._mine = (screen._mine || 0) + 1;
      const el = screen.querySelector('[data-fb-mine]');
      if (!el) return;
      el.textContent = String(screen._mine);
      restart(el, 'pop');
    };
  }

  const PRESS = { a: pressA, b: pressB, c: pressC };

  function wire(screen) {
    const variant = screen.dataset.fb;
    const canvas = screen.querySelector('canvas[data-subway]');
    const btn = screen.querySelector('[data-fb-fire]');
    const sc = canvas && canvas.__sub;
    if (!sc || !btn || !PRESS[variant]) return false;
    hook(sc, variant);
    let downAt = 0;
    let viaPointer = false;
    const release = () => {
      const wait = Math.max(0, 140 - (performance.now() - downAt));
      setTimeout(() => btn.classList.remove('down'), wait);
    };
    btn.addEventListener('pointerdown', () => { viaPointer = true; downAt = performance.now(); btn.classList.add('down'); });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('click', () => {
      /* 키보드(Enter · Space)로 눌러도 눌린 모습이 보여요 */
      if (!viaPointer) { downAt = performance.now(); btn.classList.add('down'); release(); }
      viaPointer = false;
      PRESS[variant](screen, sc, btn);
    });
    return true;
  }

  function start() {
    const pending = [...document.querySelectorAll('.screen[data-fb]')];
    let tries = 0;
    const tick = () => {
      for (let i = pending.length - 1; i >= 0; i--) if (wire(pending[i])) pending.splice(i, 1);
      if (pending.length && ++tries < 60) requestAnimationFrame(tick);
    };
    tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
