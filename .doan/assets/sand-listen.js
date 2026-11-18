/* 모래멍 소리 후보 보드 전용: 층마다 고른 녹음을 같이 틀어 봐요. 코드(src)에는 없어요.
   subway-listen.js 를 바탕으로 했어요. 달라진 점
   - 층은 .mix-row[data-mix-layer] 에서 읽어요. data-kind="bed" 는 계속 되풀이, "shot" 은 한 번씩 틀어요.
   - 후보 줄(.cand)의 data-layer · data-src · data-gain · data-start · data-len 을 읽어요.
     data-gain 은 후보마다 다른 녹음 크기를 맞추는 값이에요 (미리듣기를 재서 정했어요). 거기에 층 음량을 곱해요.
     data-start · data-len 은 한 번씩 트는 소리를 녹음의 어느 구간에서 자를지예요.
   - 같은 .mix 안의 모래시계(canvas[data-hg], sand-hourglass.js)를 따라가요.
       흐르는 동안: 줄기가 들리고, 5~11초마다 사태 하나
       다 내려가면: 줄기가 잦아들고 끝 소리
       뒤집힐 때: 뒤집기 소리
     방 소리는 늘 깔려요.
   - Freesound 미리듣기를 바로 불러와서 인터넷이 필요해요. */
(function () {
  const rand = (a, b) => a + Math.random() * (b - a);

  function start() {
    const root = document.querySelector('[data-listen]');
    if (!root) return;
    const rows = [...root.querySelectorAll('.cand[data-layer]')];
    const playBtn = root.querySelector('[data-mix-play]');
    const state = root.querySelector('[data-mix-state]');
    const hgCanvas = root.querySelector('.mix canvas[data-hg]');
    const layers = {}; // layer → { kind, vol, row(mix-row) }
    for (const r of root.querySelectorAll('.mix-row[data-mix-layer]')) {
      layers[r.dataset.mixLayer] = { kind: r.dataset.kind || 'bed', vol: 0, el: r };
    }
    const picks = {};
    let ctx = null;
    let master = null;
    let playing = false;
    const live = {}; // bed layer → { el, gain, duck }
    const buffers = new Map(); // src → Promise<AudioBuffer>
    let hgState = '';
    let nextSlide = 0;

    const label = (row) => row.querySelector('.name b').textContent;
    const show = (layer) => {
      const L = layers[layer];
      const row = picks[layer];
      L.el.querySelector('.mix-name').innerHTML = row
        ? `${row.querySelector('.no').firstChild.textContent.trim()}. ${row.dataset.short || label(row)}<small>${label(row)}</small>`
        : '고른 녹음이 없어요';
      L.el.classList.toggle('off', !row || L.vol === 0);
      L.el.querySelector('.mix-vol').textContent = L.vol === 0 ? '끔' : Math.round(L.vol * 100);
    };

    for (const row of rows) if (row.classList.contains('in-mix')) picks[row.dataset.layer] = row;
    for (const layer of Object.keys(layers)) {
      const L = layers[layer];
      const input = L.el.querySelector('input[type="range"]');
      L.vol = Number(input.value) / 100;
      input.addEventListener('input', () => {
        L.vol = Number(input.value) / 100;
        apply(layer);
        show(layer);
      });
      const once = L.el.querySelector('[data-mix-once]');
      if (once) once.addEventListener('click', () => { if (!playing) setPlaying(true); shot(layer); });
      show(layer);
    }

    const level = (layer) => {
      const row = picks[layer];
      return row ? Number(row.dataset.gain || 1) * layers[layer].vol : 0;
    };
    const apply = (layer) => {
      const l = live[layer];
      if (!l || !ctx) return;
      l.gain.gain.setTargetAtTime(level(layer), ctx.currentTime, 0.08);
    };

    /* ---------- 계속 되풀이하는 층 (줄기 · 방) ---------- */
    const stopBed = (layer) => {
      const l = live[layer];
      if (!l) return;
      l.el.pause();
      l.el.removeAttribute('src');
      l.el.load();
      delete live[layer];
    };
    const startBed = (layer) => {
      stopBed(layer);
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
      const duck = ctx.createGain(); // 모래시계를 따라 줄기를 켜고 꺼요
      duck.gain.value = layer === 'stream' ? flowGain() : 1;
      node.connect(gain).connect(duck).connect(master);
      live[layer] = { el, gain, duck };
      el.play().catch(() => status('재생을 시작하지 못했어요. 한 번 더 눌러 주세요'));
    };

    /* ---------- 한 번씩 트는 층 (사태 · 뒤집기 · 끝) ---------- */
    const load = (src) => {
      if (!buffers.has(src)) {
        buffers.set(src, fetch(src, { mode: 'cors' })
          .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then((b) => ctx.decodeAudioData(b)));
      }
      return buffers.get(src);
    };
    const shot = (layer) => {
      const row = picks[layer];
      if (!row || !ctx || !playing || level(layer) === 0) return;
      load(row.dataset.src).then((buf) => {
        if (!playing) return;
        const from = Math.min(Number(row.dataset.start || 0), Math.max(0, buf.duration - 0.05));
        const len = Math.min(Number(row.dataset.len || buf.duration), buf.duration - from);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = layer === 'slide' ? rand(0.92, 1.08) : 1;
        const g = ctx.createGain();
        const t = ctx.currentTime + 0.02;
        const peak = level(layer) * (layer === 'slide' ? rand(0.6, 1) : 1);
        const fade = Math.min(0.4, len * 0.3);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(peak, t + 0.01);
        g.gain.setValueAtTime(peak, t + len - fade);
        g.gain.linearRampToValueAtTime(0, t + len);
        src.connect(g).connect(master);
        src.start(t, from, len + 0.05);
        flash(layer);
      }).catch(() => status(`${label(row)} 녹음을 불러오지 못했어요`));
    };
    const flash = (layer) => {
      const el = layers[layer].el;
      el.classList.remove('hit');
      void el.offsetWidth;
      el.classList.add('hit');
    };
    const preload = () => {
      for (const layer of Object.keys(layers)) if (layers[layer].kind === 'shot' && picks[layer]) load(picks[layer].dataset.src).catch(() => {});
    };

    /* ---------- 모래시계를 따라가요 ---------- */
    const flowGain = () => (hgState === 'run' ? 1 : 0);
    const follow = () => {
      requestAnimationFrame(follow);
      const hg = hgCanvas && hgCanvas.__hg;
      const s = hg ? hg.state : 'run';
      if (s !== hgState) {
        const was = hgState;
        hgState = s;
        if (playing && was) {
          if (s === 'rest') shot('end');
          if (s === 'flip') shot('flip');
        }
        if (live.stream && ctx) live.stream.duck.gain.setTargetAtTime(flowGain(), ctx.currentTime, s === 'run' ? 0.25 : 0.35);
        if (s === 'run' && ctx) nextSlide = ctx.currentTime + rand(3, 6);
      }
      if (playing && ctx && hgState === 'run' && ctx.currentTime >= nextSlide) {
        nextSlide = ctx.currentTime + rand(5, 11);
        shot('slide');
      }
    };
    requestAnimationFrame(follow);

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
        for (const layer of Object.keys(layers)) if (layers[layer].kind === 'bed') startBed(layer);
        preload();
        nextSlide = ctx.currentTime + rand(2, 4);
      } else {
        for (const layer of Object.keys(live)) stopBed(layer);
      }
      status();
    };
    playBtn.addEventListener('click', () => setPlaying(!playing));
    // 작은 모래시계 아래 ‘뒤집기’: 화면이 반으로 줄어 있어서 버튼은 화면 밖에 두고 직접 불러요
    const flipBtn = root.querySelector('[data-mini-flip]');
    if (flipBtn) flipBtn.addEventListener('click', () => { if (hgCanvas && hgCanvas.__hg) hgCanvas.__hg.action('flip'); });

    for (const row of rows) {
      const btn = row.querySelector('.use');
      btn.addEventListener('click', () => {
        const layer = row.dataset.layer;
        if (picks[layer]) picks[layer].classList.remove('in-mix');
        picks[layer] = row;
        row.classList.add('in-mix');
        for (const r of rows) r.querySelector('.use').textContent = r.classList.contains('in-mix') ? '같이 듣는 중' : '같이 듣기에 넣기';
        show(layer);
        if (!playing) return;
        if (layers[layer] && layers[layer].kind === 'bed') startBed(layer);
        else { load(row.dataset.src).catch(() => {}); shot(layer); }
      });
      btn.textContent = row.classList.contains('in-mix') ? '같이 듣는 중' : '같이 듣기에 넣기';
      row.querySelector('audio').addEventListener('play', (e) => {
        for (const r of rows) { const a = r.querySelector('audio'); if (a !== e.target) a.pause(); }
        if (playing) setPlaying(false);
      });
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
