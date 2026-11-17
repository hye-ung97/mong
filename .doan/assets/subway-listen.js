/* 지하철멍 소리 후보 보드 전용: 층마다 고른 녹음을 같이 틀어 봐요. 코드(src)에는 없어요.
   - 후보 줄(.cand)의 data-layer · data-src · data-gain · data-start 를 읽어요.
   - data-gain 은 후보마다 다른 녹음 크기를 맞추는 값이에요 (분석해서 정했어요). 거기에 층 음량을 곱해요.
   - ‘창 너머로’를 켜면 불꽃과 사람들 소리를 낮게 걸러서 먹먹하게 들려요.
   - Freesound 미리듣기를 바로 불러와서 인터넷이 필요해요. */
(function () {
  const LAYERS = ['train', 'ring', 'fireworks', 'cabin', 'crowd'];
  const MUFFLED = { fireworks: true, crowd: true };
  const MUFFLE_HZ = 1100;

  function start() {
    const root = document.querySelector('[data-listen]');
    if (!root) return;
    const rows = [...root.querySelectorAll('.cand[data-layer]')];
    const playBtn = root.querySelector('[data-mix-play]');
    const glass = root.querySelector('[data-mix-glass]');
    const state = root.querySelector('[data-mix-state]');
    const vols = {};
    const picks = {};
    let ctx = null;
    let master = null;
    let playing = false;
    const live = {}; // layer → { el, src, gain, filter }

    const label = (row) => row.querySelector('.name b').textContent;
    const show = (layer) => {
      const r = root.querySelector(`.mix-row[data-mix-layer="${layer}"]`);
      if (!r) return;
      const row = picks[layer];
      r.querySelector('.mix-name').innerHTML = row
        ? `${row.querySelector('.no').firstChild.textContent.trim()}. ${row.dataset.short || label(row)}<small>${label(row)}</small>`
        : '고른 녹음이 없어요';
      r.classList.toggle('off', !row || vols[layer] === 0);
      r.querySelector('.mix-vol').textContent = vols[layer] === 0 ? '끔' : Math.round(vols[layer] * 100);
    };

    // 처음 고른 녹음: 줄에 in-mix 가 붙은 것
    for (const row of rows) if (row.classList.contains('in-mix')) picks[row.dataset.layer] = row;
    for (const r of root.querySelectorAll('.mix-row')) {
      const layer = r.dataset.mixLayer;
      const input = r.querySelector('input[type="range"]');
      vols[layer] = Number(input.value) / 100;
      input.addEventListener('input', () => {
        vols[layer] = Number(input.value) / 100;
        apply(layer);
        show(layer);
      });
      show(layer);
    }

    const level = (layer) => {
      const row = picks[layer];
      return row ? Number(row.dataset.gain || 1) * vols[layer] : 0;
    };
    const apply = (layer) => {
      const l = live[layer];
      if (!l || !ctx) return;
      l.gain.gain.setTargetAtTime(level(layer), ctx.currentTime, 0.08);
      if (l.filter) l.filter.frequency.setTargetAtTime(glass.checked ? MUFFLE_HZ : 18000, ctx.currentTime, 0.08);
    };

    const stopLayer = (layer) => {
      const l = live[layer];
      if (!l) return;
      l.el.pause();
      l.el.removeAttribute('src');
      l.el.load();
      delete live[layer];
    };
    const startLayer = (layer) => {
      stopLayer(layer);
      const row = picks[layer];
      if (!row || !ctx) return;
      const el = new Audio();
      el.crossOrigin = 'anonymous';
      el.loop = true;
      el.preload = 'auto';
      el.src = row.dataset.src;
      const at = Number(row.dataset.start || 0);
      if (at) el.addEventListener('loadedmetadata', () => { el.currentTime = at; }, { once: true });
      el.addEventListener('waiting', () => status());
      el.addEventListener('playing', () => status());
      el.addEventListener('error', () => status(`${label(row)} 녹음을 불러오지 못했어요`));
      const node = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = level(layer);
      let filter = null;
      if (MUFFLED[layer]) {
        filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.Q.value = 0.5;
        filter.frequency.value = glass.checked ? MUFFLE_HZ : 18000;
        node.connect(filter).connect(gain);
      } else {
        node.connect(gain);
      }
      gain.connect(master);
      live[layer] = { el, gain, filter };
      el.play().catch(() => status('재생을 시작하지 못했어요. 한 번 더 눌러 주세요'));
    };

    const status = (msg) => {
      if (msg) { state.textContent = msg; return; }
      if (!playing) { state.textContent = ''; return; }
      const loading = Object.values(live).filter((l) => l.el.readyState < 3).length;
      state.textContent = loading ? `불러오는 중… (${loading}개)` : '같이 듣는 중';
    };

    const setPlaying = (on) => {
      playing = on;
      playBtn.setAttribute('aria-pressed', String(on));
      playBtn.querySelector('span').textContent = on ? '멈추기' : '같이 듣기';
      if (on) {
        const C = window.AudioContext || window.webkitAudioContext;
        if (!ctx) {
          ctx = new C();
          // 층을 겹쳐도 찢어지지 않게 마지막에 리미터를 둬요
          const limit = ctx.createDynamicsCompressor();
          limit.threshold.value = -8;
          limit.knee.value = 4;
          limit.ratio.value = 12;
          limit.attack.value = 0.003;
          limit.release.value = 0.25;
          master = ctx.createGain();
          master.gain.value = 0.8;
          master.connect(limit).connect(ctx.destination);
        }
        if (ctx.state === 'suspended') ctx.resume();
        for (const a of rows.map((r) => r.querySelector('audio'))) a.pause();
        for (const layer of LAYERS) startLayer(layer);
      } else {
        for (const layer of LAYERS) stopLayer(layer);
      }
      status();
    };
    playBtn.addEventListener('click', () => setPlaying(!playing));
    glass.addEventListener('change', () => { for (const layer of LAYERS) apply(layer); });

    // 줄의 ‘같이 듣기에 넣기’
    for (const row of rows) {
      const btn = row.querySelector('.use');
      btn.addEventListener('click', () => {
        const layer = row.dataset.layer;
        if (picks[layer]) picks[layer].classList.remove('in-mix');
        picks[layer] = row;
        row.classList.add('in-mix');
        for (const r of rows) r.querySelector('.use').textContent = r.classList.contains('in-mix') ? '같이 듣는 중' : '같이 듣기에 넣기';
        show(layer);
        if (playing) startLayer(layer);
      });
      btn.textContent = row.classList.contains('in-mix') ? '같이 듣는 중' : '같이 듣기에 넣기';
      // 줄 하나를 틀면 다른 줄과 같이 듣기는 멈춰요
      row.querySelector('audio').addEventListener('play', (e) => {
        for (const r of rows) { const a = r.querySelector('audio'); if (a !== e.target) a.pause(); }
        if (playing) setPlaying(false);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
