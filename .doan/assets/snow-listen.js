/* 눈멍 · 나무 소리 후보 보드 전용: 후보마다 추천 구간(또는 덩이 하나)만 틀고, 소리마다 하나씩 골라
   장면에서처럼 들어 봐요. 코드(src)에는 없어요.
   - 후보 줄(.cand)의 data-layer · data-src · data-gain · data-segs("시작-끝,시작-끝") · data-fade 를 읽어요.
   - data-gain 은 녹음마다 다른 크기를 맞추는 값이에요 (재서 정했어요).
   - 기차는 지나가는 동안 왼쪽에서 오른쪽으로 옮겨 가며 들려요. 바람은 앞뒤를 부드럽게 줄여요.
   - 고른 것은 이 브라우저에만 저장돼요 (localStorage).
   - Freesound 미리듣기를 바로 불러와서 인터넷이 필요해요. */
(function () {
  const KEY = 'doan-snow-sound-pick';
  const NAMES = { train: '먼 기차', wind: '바람 한 줄기', shake: '푸스스' };

  function start() {
    const rows = [...document.querySelectorAll('.cand[data-layer]')];
    if (!rows.length) return;
    const state = document.querySelector('[data-try-state]');
    const picked = document.querySelector('[data-try-picked]');
    let ctx = null;
    let master = null;
    let current = null; // { el, timer, btn }

    const segsOf = (row) => (row.dataset.segs || '').split(',').filter(Boolean).map((s) => s.split('-').map(Number));
    const label = (row) => row.querySelector('.name b').textContent;
    const say = (msg) => { if (state) state.textContent = msg || ''; };

    const audio = () => {
      if (!ctx) {
        const C = window.AudioContext || window.webkitAudioContext;
        ctx = new C();
        const limit = ctx.createDynamicsCompressor();
        limit.threshold.value = -8;
        limit.knee.value = 4;
        limit.ratio.value = 12;
        limit.attack.value = 0.003;
        limit.release.value = 0.25;
        master = ctx.createGain();
        master.gain.value = 0.85;
        master.connect(limit).connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    };

    const stop = () => {
      if (!current) return;
      clearTimeout(current.timer);
      current.el.pause();
      current.el.removeAttribute('src');
      current.el.load();
      if (current.btn) current.btn.classList.remove('on');
      current = null;
      say('');
    };

    // 한 구간을 틀어요: 앞뒤를 줄이고, 기차면 왼쪽 → 오른쪽으로
    const playSeg = (row, a, b, btn) => {
      stop();
      for (const r of rows) r.querySelector('audio').pause();
      const c = audio();
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      el.src = row.dataset.src;
      const node = c.createMediaElementSource(el);
      const gain = c.createGain();
      gain.gain.value = 0;
      const pan = c.createStereoPanner ? c.createStereoPanner() : null;
      node.connect(gain);
      if (pan) gain.connect(pan).connect(master);
      else gain.connect(master);
      const me = { el, timer: 0, btn };
      current = me;
      if (btn) btn.classList.add('on');
      say(`불러오는 중… ${label(row)}`);
      const len = b - a;
      const fade = Math.min(Number(row.dataset.fade || 0.05), len / 3);
      const level = Number(row.dataset.gain || 1);
      const go = () => {
        if (current !== me) return;
        el.play().then(() => {
          const t = c.currentTime;
          gain.gain.cancelScheduledValues(t);
          gain.gain.setValueAtTime(0, t);
          gain.gain.linearRampToValueAtTime(level, t + fade);
          gain.gain.setValueAtTime(level, t + len - fade);
          gain.gain.linearRampToValueAtTime(0, t + len);
          if (pan && row.dataset.layer === 'train') {
            pan.pan.setValueAtTime(-0.7, t);
            pan.pan.linearRampToValueAtTime(0.7, t + len);
          }
          say(`듣는 중 · ${NAMES[row.dataset.layer]} · ${label(row)} (${a}–${b}초)`);
          me.timer = setTimeout(() => { if (current === me) stop(); }, len * 1000 + 80);
        }).catch(() => say('재생을 시작하지 못했어요. 한 번 더 눌러 주세요'));
      };
      el.addEventListener('loadedmetadata', () => {
        if (a > 0) { el.addEventListener('seeked', go, { once: true }); el.currentTime = a; } else go();
      }, { once: true });
      el.addEventListener('error', () => say(`${label(row)} 녹음을 불러오지 못했어요`));
    };

    // 고른 것
    let picks = {};
    try { picks = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { picks = {}; }
    const rowOf = (layer) => rows.find((r) => r.dataset.layer === layer && r.dataset.doanId === picks[layer])
      || rows.find((r) => r.dataset.layer === layer && r.classList.contains('pick'));
    const showPicks = () => {
      for (const r of rows) {
        const on = rowOf(r.dataset.layer) === r;
        r.classList.toggle('in-mix', on);
        r.querySelector('.use').textContent = on ? '고른 소리' : '이걸로 고르기';
      }
      if (picked) {
        picked.innerHTML = Object.keys(NAMES).map((l) => {
          const r = rowOf(l);
          return `${NAMES[l]} <b>${r ? `${r.querySelector('.no').firstChild.textContent.trim()}. ${r.dataset.short || label(r)}` : '없음'}</b>`;
        }).join(' · ');
      }
    };

    for (const row of rows) {
      const box = row.querySelector('.segs');
      const segs = segsOf(row);
      const many = segs.length > 1;
      segs.forEach(([a, b], i) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'seg';
        btn.textContent = many ? `덩이 ${i + 1}` : `추천 구간 ${a}–${b}초`;
        btn.title = `${a}–${b}초`;
        btn.addEventListener('click', () => (current && current.btn === btn ? stop() : playSeg(row, a, b, btn)));
        box.appendChild(btn);
      });
      row.querySelector('.use').addEventListener('click', () => {
        picks[row.dataset.layer] = row.dataset.doanId;
        try { localStorage.setItem(KEY, JSON.stringify(picks)); } catch (e) { /* 저장 못 해도 이번엔 보여요 */ }
        showPicks();
      });
      row.querySelector('audio').addEventListener('play', stop);
    }
    showPicks();

    // 장면처럼 들어 보기
    for (const btn of document.querySelectorAll('[data-try]')) {
      btn.addEventListener('click', () => {
        const row = rowOf(btn.dataset.try);
        if (!row) return;
        const segs = segsOf(row);
        const [a, b] = segs[Math.floor(Math.random() * segs.length)];
        playSeg(row, a, b, null);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
