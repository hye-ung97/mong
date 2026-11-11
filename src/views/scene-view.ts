import { audio, layersOf } from '../audio/engine';
import { icon } from '../icons';
import { canFullscreen, isFullscreen, keepAwake, toggleFullscreen } from '../lib/device';
import { firstTime, save, setMix, settings } from '../lib/settings';
import { formatClock, timer } from '../lib/timer';
import { Aquarium } from '../scenes/aquarium';
import type { Scene } from '../scenes/base';
import { Fire, type WoodKind } from '../scenes/fire';
import { SceneHost } from '../scenes/host';
import { Pond } from '../scenes/pond';
import { Rain } from '../scenes/rain';
import {
  GROUPS, WATER, createScene, groupOf, groupRoute, isWater, routeOf, type GroupId, type SceneId,
} from '../scenes/registry';
import { Sea } from '../scenes/sea';
import { EQ, wordmark, type View } from './view';

const IDLE_AFTER = 4000; // ms without input before the UI fades away
const SLEEP_AFTER = 60_000; // ms after the timer ends before the scene dims and stops
const LONG_PRESS = 450;
const AUDIO_STATE_EVERY = 250;

interface Level { v: number; label: string }
const RAIN_LEVELS: readonly Level[] = [{ v: 0.25, label: '보슬비' }, { v: 0.6, label: '비' }, { v: 1, label: '장대비' }];
const WAVE_LEVELS: readonly Level[] = [{ v: 0.6, label: '잔잔' }, { v: 1, label: '보통' }, { v: 1.5, label: '높음' }];
const nearest = (levels: readonly Level[], v: number) =>
  levels.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));

const WOODS: readonly { id: WoodKind; label: string; desc: string }[] = [
  { id: 'oak', label: '참나무', desc: '오래 타요' },
  { id: 'pine', label: '소나무', desc: '타닥 소리가 커요' },
  { id: 'birch', label: '자작나무', desc: '불꽃이 밝아요' },
];

const TIMER_CHOICES = [15, 30, 60, 0] as const;
const timerLabel = (m: number) => (m === 0 ? '계속' : m === 60 ? '1시간' : `${m}분`);

interface KeyHint { keys?: string[]; text: string }
interface Copy {
  /** mobile status line, left */
  now: string;
  /** mobile status line, right */
  aside?: string;
  /** desktop, bottom-left */
  title: string;
  sub: string;
  /** mobile hint above the dock (비멍: on the glass), until the first tap */
  hint?: string;
  keys: KeyHint[];
  land: string;
}

const COPY: Record<SceneId, Copy> = {
  fire: {
    now: '타닥타닥 · 장작 <b data-bind="logs">3</b>개',
    aside: '<span class="meter">불 세기<span class="bar"><i data-bind="intensity"></i></span></span>',
    title: '장작 타는 소리',
    sub: '<span class="meter"><span>장작 <b data-bind="logs">3</b>개 · 불 세기</span><span class="bar"><i data-bind="intensity"></i></span></span>',
    hint: '불을 톡 치면 뒤적여요',
    keys: [{ keys: ['Space'], text: '고른 장작 넣기' }, { text: '불을 클릭하면 뒤적여요' }, { keys: ['M'], text: '소리' }],
    land: '불멍',
  },
  rain: {
    now: '빗소리 · 창가',
    aside: '천둥 <span data-bind="thunder">꺼짐</span>',
    title: '빗소리 · 창가',
    sub: '<span data-bind="rain">비</span> · 천둥 <span data-bind="thunder">꺼짐</span>',
    hint: '창을 문지르면 김이 닦여요',
    keys: [{ keys: ['↑', '↓'], text: '비 세기 · <kbd>T</kbd> 천둥' }, { text: '창을 끌면 김이 닦여요' }],
    land: '비멍',
  },
  aquarium: {
    now: '보글보글 · 물고기 <b data-bind="fish">10</b>마리',
    hint: '물속을 톡 치면 그 자리에 먹이가 떨어져요',
    title: '어항 · 보글보글',
    sub: '물고기 <b data-bind="fish">10</b>마리',
    keys: [{ text: '클릭한 자리에 먹이' }, { keys: ['Space'], text: '먹이 주기' }, { keys: ['M'], text: '소리' }],
    land: '물멍 · 어항',
  },
  sea: {
    now: '파도 소리 · 밤바다',
    aside: '파도 <span data-bind="wave">보통</span>',
    title: '밤바다 · 파도 소리',
    sub: '파도 <span data-bind="wave">보통</span>',
    keys: [{ keys: ['↑', '↓'], text: '파도 크기' }, { keys: ['←', '→'], text: '장면 바꾸기' }, { keys: ['M'], text: '소리' }],
    land: '물멍 · 바다',
  },
  pond: {
    now: '물방울 · 바람 소리',
    aside: '빗방울 <span data-bind="drizzle">꺼짐</span>',
    hint: '물을 톡 치면 물결이 퍼져요',
    title: '연못 · 물방울 소리',
    sub: '빗방울 <span data-bind="drizzle">꺼짐</span>',
    keys: [{ text: '클릭하면 물결' }, { keys: ['Space'], text: '빗방울' }, { keys: ['M'], text: '소리' }],
    land: '물멍 · 연못',
  },
};

const GROUP_ORDER: readonly GroupId[] = ['fire', 'rain', 'water'];

/** A full-screen scene with its controls, sound, sleep timer and immersive mode. */
export class SceneView implements View {
  readonly el: HTMLElement;
  private readonly scene: Scene;
  private readonly host: SceneHost;
  private readonly copy: Copy;
  private readonly cleanups: (() => void)[] = [];
  private idle = false;
  private idleTimer = 0;
  private swallowClick = false;
  private longPressed = false;
  private dragging = false;
  private toastTimer = 0;
  private lastFeedToast = 0;
  private sleepTimer = 0;
  private pillTimer = 0;

  constructor(parent: HTMLElement, readonly id: SceneId) {
    this.copy = COPY[id];
    this.scene = createScene(id, 'full', settings());
    this.el = document.createElement('div');
    this.el.className = `view scene-view theme-${groupOf(id)}`;
    this.el.dataset.scene = id;
    this.el.innerHTML = this.template();
    parent.append(this.el);

    this.scene.hooks = {
      onStat: (key, value) => this.onStat(key, value),
      onEvent: (name, data) => audio.event(id, name, data),
    };
    this.host = new SceneHost(this.$<HTMLCanvasElement>('canvas.scene'), this.scene);

    this.listen(this.el, 'pointerdown', this.onPointerDownCapture, true);
    this.listen(this.el, 'click', this.onClickCapture, true);
    this.listen(this.el, 'click', this.onClick);
    this.listen(this.el, 'input', this.onInput);
    this.listen(this.el, 'change', this.onChange);
    this.listen(this.el, 'pointermove', this.onPointerMove);
    this.listen(this.host.canvas, 'pointerdown', this.onSceneTap);
    this.listen(window, 'keydown', this.onKey);
    this.listen(document, 'fullscreenchange', () => this.refreshFullscreen());
    if (this.fire) this.setupFire();
    if (this.rain) this.setupRain();

    const audioTimer = window.setInterval(() => audio.update(id, this.scene.audioState()), AUDIO_STATE_EVERY);
    this.cleanups.push(() => window.clearInterval(audioTimer));
    this.cleanups.push(audio.onChange(() => this.refreshSound()));
    this.cleanups.push(timer.subscribe(() => this.refreshTimer()));

    audio.play(id);
    audio.update(id, this.scene.audioState());
    keepAwake(true);
    this.refreshLabels();
    this.refreshSound();
    this.refreshTimer();
    this.refreshFullscreen();
    this.initRanges();
    this.armIdle();
  }

  /* ---------- typed scene access ---------- */
  private get fire() { return this.scene instanceof Fire ? this.scene : null; }
  private get rain() { return this.scene instanceof Rain ? this.scene : null; }
  private get aquarium() { return this.scene instanceof Aquarium ? this.scene : null; }
  private get sea() { return this.scene instanceof Sea ? this.scene : null; }
  private get pond() { return this.scene instanceof Pond ? this.scene : null; }

  private $<T extends Element = HTMLElement>(sel: string): T {
    const n = this.el.querySelector<T>(sel);
    if (!n) throw new Error(`missing ${sel}`);
    return n;
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: EventTarget, type: K | string, fn: (e: HTMLElementEventMap[K]) => void, capture = false,
  ) {
    const handler = fn as EventListener;
    target.addEventListener(type, handler, capture);
    this.cleanups.push(() => target.removeEventListener(type, handler, capture));
  }

  /* ---------- markup ---------- */
  private template() {
    const id = this.id;
    const group = groupOf(id);
    const c = this.copy;
    const tabs = GROUPS.map((g) => {
      const on = g.id === group;
      return `<a href="${groupRoute(g.id)}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${g.label}</a>`;
    }).join('');
    const sub = isWater(id)
      ? `<nav class="subscenes glass" aria-label="물멍 장면">${WATER.map((w) => {
        const on = w.id === id;
        return `<a href="${routeOf(w.id)}" class="${on ? 'on' : ''}"${on ? ' aria-current="page"' : ''}>${w.label}</a>`;
      }).join('')}</nav>`
      : '';
    const keys = c.keys.map((k) =>
      `<span>${(k.keys ?? []).map((key) => `<kbd>${key}</kbd>`).join('')}${k.keys ? ' ' : ''}${k.text}</span>`).join('');
    return `
      <canvas class="scene" aria-hidden="true"></canvas>
      <div class="chrome">
        <header class="topbar">
          <a class="icon-btn glass only-m" href="#/" aria-label="홈으로">${icon('home')}</a>
          <span class="only-d">${wordmark('a')}</span>
          <nav class="tabs glass" aria-label="장면">${tabs}</nav>
          <div class="top-right">
            <button class="icon-btn glass" data-act="mute" data-bind-mute aria-label="소리 끄기">${icon('volume')}</button>
            <button class="icon-btn glass only-d" data-act="fullscreen" aria-label="전체화면">${icon('max')}</button>
          </div>
        </header>
        ${sub}
        ${c.hint && this.rain ? `<div class="hint hint-glass glass only-m">${icon('hand', 'sm')}${c.hint}</div>` : ''}
        <div class="bottom">
          ${c.hint && !this.rain ? `<div class="hint glass only-m">${icon('hand', 'sm')}${c.hint}</div>` : ''}
          ${this.fire ? `<div class="hint hint-embers glass" role="status">${icon('log', 'sm')}장작을 넣으면 다시 타올라요</div>` : ''}
          <div class="m-status only-m"><span class="now">${EQ}${c.now}</span>${c.aside ? `<span class="aside">${c.aside}</span>` : ''}</div>
          <div class="dock glass">${this.dockHtml()}</div>
        </div>
        <div class="d-now only-d"><strong>${EQ}${c.title}</strong><span>${c.sub}</span></div>
        <div class="d-keys only-d">${keys}</div>
      </div>
      <div class="land-label"><a class="icon-btn" href="#/" aria-label="홈으로">${icon('home', 'sm')}</a>${EQ}${c.land}</div>
      <div class="rail glass">${this.railHtml()}</div>
      <div class="toast glass" role="status" aria-live="polite"></div>
      <button class="sound-pill glass" data-act="unlock">${icon('volume', 'sm')}탭해서 소리 켜기</button>
      <div class="imm" aria-hidden="true"><div class="imm-timer">${icon('timer', 'sm')}<span data-bind="clock"></span></div><div class="imm-hint"><i></i>화면을 톡 치면 메뉴가 나와요</div></div>
      <div class="scrim" data-act="close"></div>
      ${this.sheetHtml()}
      ${this.fire ? this.trayHtml() : ''}
      <div class="sleep"></div>
      ${this.endHtml()}`;
  }

  private seg(levels: readonly Level[], act: string, value: number, label: string) {
    const cur = nearest(levels, value);
    return `<div class="seg" role="radiogroup" aria-label="${label}">${levels.map((l) =>
      `<button role="radio" data-act="${act}" data-value="${l.v}" class="${l === cur ? 'on' : ''}" aria-checked="${l === cur}">${l.label}</button>`).join('')}</div>`;
  }

  private dockHtml() {
    const s = settings();
    let main = '';
    let extra = '';
    switch (this.id) {
      case 'fire':
        // phones: [chosen wood | 넣기]. Wide screens: all three woods; a click adds that wood and makes it the chosen one.
        main = `
          <div class="wood-split only-m">
            <button class="pick" data-act="tray" aria-haspopup="dialog" aria-expanded="false"></button>
            <button class="add" data-act="add-log" aria-label="장작 넣기">${icon('log')}넣기</button>
          </div>
          <div class="wood-chips only-d" role="group" aria-label="장작 넣기">${WOODS.map((w) =>
            `<button class="wood-chip" data-act="add-wood" data-wood="${w.id}"><span class="log-art mini ${w.id}"></span>${w.label}</button>`).join('')}</div>`;
        break;
      case 'aquarium':
        main = `<button class="primary" data-act="feed">${icon('food')}<span>먹이 주기</span><kbd class="only-d">Space</kbd></button>`;
        break;
      case 'pond':
        main = `<button class="primary" data-act="drizzle" aria-pressed="false">${icon('drop')}<span data-bind="drizzle-btn">빗방울 떨어뜨리기</span></button>`;
        break;
      case 'rain':
        main = this.seg(RAIN_LEVELS, 'rain', s.rain, '비 세기');
        extra = `<button class="dock-btn" data-act="thunder" aria-pressed="false" aria-label="천둥">${icon('zap')}<span class="only-d">천둥</span></button>`;
        break;
      case 'sea':
        main = this.seg(WAVE_LEVELS, 'wave', s.wave, '파도 크기');
        break;
    }
    return `
      <button class="dock-btn" data-act="sheet" aria-label="소리와 타이머">${icon('timer')}<span class="only-d" data-bind="timer">타이머</span></button>
      <span class="sep only-d"></span>
      ${main}
      ${extra}
      <span class="sep only-d"></span>
      <div class="vol only-d"><button class="vol-btn" data-act="mute" data-bind-mute aria-label="소리 끄기">${icon('volume')}</button><input class="range" type="range" min="0" max="100" data-act="volume" aria-label="음량"></div>
      ${this.id === 'rain' ? '' : `<button class="dock-btn only-m" data-act="sheet" aria-label="소리 섞기">${icon('sliders')}</button>`}`;
  }

  private railHtml() {
    const group = groupOf(this.id);
    const tabs = GROUPS.map((g) =>
      `<a class="icon-btn ${g.id === group ? 'cur' : ''}" href="${groupRoute(g.id)}" aria-label="${g.label}">${icon(g.icon)}</a>`).join('');
    const main = {
      fire: { act: 'add-log', icon: 'log', label: '장작 넣기' },
      rain: { act: 'rain-cycle', icon: 'rain', label: '비 세기 바꾸기' },
      aquarium: { act: 'feed', icon: 'food', label: '먹이 주기' },
      sea: { act: 'wave-cycle', icon: 'waves', label: '파도 크기 바꾸기' },
      pond: { act: 'drizzle', icon: 'drop', label: '빗방울' },
    } as const;
    const m = main[this.id];
    return `
      <div class="rail-group">${tabs}</div>
      <button class="rail-main" data-act="${m.act}" aria-label="${m.label}">${icon(m.icon)}</button>
      <div class="rail-group">
        <button class="icon-btn" data-act="sheet" aria-label="소리와 타이머">${icon('timer')}</button>
        <button class="icon-btn" data-act="mute" data-bind-mute aria-label="소리 끄기">${icon('volume')}</button>
      </div>`;
  }

  private sheetHtml() {
    const s = settings();
    const mix = s.mix[this.id] ?? {};
    const rows = layersOf(this.id).map((l) => {
      const v = Math.round((mix[l.id] ?? l.def) * 100);
      return `<label class="mix-row">${icon(l.icon, 'sm')}<span>${l.label}</span><input class="range" type="range" min="0" max="100" value="${v}" data-act="mix" data-layer="${l.id}" aria-label="${l.label} 크기"><span class="val">${v}</span></label>`;
    }).join('');
    const tend = this.fire
      ? `<label class="switch-row"><span><b>장작 알아서 넣기</b><small>불이 약해지면 장작을 하나씩 넣어요</small></span><input class="switch" type="checkbox" data-act="auto-tend" ${s.autoTend ? 'checked' : ''}></label>`
      : '';
    return `
      <div class="sheet glass-strong" role="dialog" aria-modal="true" aria-label="소리와 타이머">
        <div class="grab"></div>
        <div class="sheet-head"><h3>소리와 타이머</h3><button class="icon-btn" data-act="close" aria-label="닫기">${icon('x')}</button></div>
        <p class="sub" data-bind="timer-sub"></p>
        <h4>타이머</h4>
        <div class="chips" role="radiogroup" aria-label="타이머">${TIMER_CHOICES.map((m) =>
          `<button role="radio" data-act="timer" data-value="${m}">${timerLabel(m)}</button>`).join('')}</div>
        <h4>소리 섞기</h4>
        <div class="mix">${rows}</div>
        ${tend}
        <button class="btn-block" data-act="close">완료</button>
      </div>`;
  }

  private trayHtml() {
    const s = settings();
    return `
      <div class="drop-zone" aria-hidden="true"></div>
      <div class="drop-label" aria-hidden="true">여기에 놓으면 불에 들어가요</div>
      <div class="drag-ghost" aria-hidden="true"><span class="log-art big"></span></div>
      <div class="tray glass-strong" role="dialog" aria-label="장작 고르기">
        <div class="grab"></div>
        <div class="tray-head"><h4>장작 고르기</h4><span>끌어서 넣거나, 눌러서 바로 넣어요</span></div>
        <div class="woods">${WOODS.map((w) =>
          `<button class="wood ${s.wood === w.id ? 'on' : ''}" data-wood="${w.id}"><span class="log-art ${w.id}"></span><b>${w.label}</b><span>${w.desc}</span></button>`).join('')}</div>
      </div>`;
  }

  private endHtml() {
    return `
      <div class="end-card glass-strong" role="dialog" aria-label="타이머 종료">
        <div class="moon">${icon('moon', 'lg')}</div>
        <h3 data-bind="end-title">멍때렸어요</h3>
        <p>소리가 천천히 작아지고 있어요.<br>조금 더 있을까요?</p>
        <button class="primary" data-act="extend">10분 더 있을래요</button>
        <button class="btn-ghost" data-act="finish">그만 볼래요</button>
      </div>`;
  }

  /* ---------- binding ---------- */
  private bind(key: string, value: string | number) {
    this.el.querySelectorAll<HTMLElement>(`[data-bind="${key}"]`).forEach((n) => {
      n.textContent = String(value);
    });
  }

  private onStat(key: string, value: number) {
    if (key === 'intensity') {
      this.el.querySelectorAll<HTMLElement>('[data-bind="intensity"]').forEach((n) => {
        n.style.width = `${Math.round(value * 100)}%`;
      });
    } else if (key === 'embers') this.el.classList.toggle('is-embers', value > 0);
    else this.bind(key, value);
  }

  private refreshLabels() {
    if (this.rain) {
      const on = settings().thunder;
      this.bind('rain', nearest(RAIN_LEVELS, this.rain.intensity).label);
      this.bind('thunder', on ? '켜짐' : '꺼짐');
      this.el.querySelectorAll('[data-act="thunder"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
      this.syncSeg('rain', this.rain.intensity, RAIN_LEVELS);
    }
    if (this.sea) {
      this.bind('wave', nearest(WAVE_LEVELS, this.sea.size).label);
      this.syncSeg('wave', this.sea.size, WAVE_LEVELS);
    }
    if (this.pond) {
      const on = this.pond.drizzle;
      this.bind('drizzle', on ? '켜짐' : '꺼짐');
      this.bind('drizzle-btn', on ? '빗방울 그치기' : '빗방울 떨어뜨리기');
      this.el.querySelectorAll('[data-act="drizzle"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    }
  }

  private syncSeg(act: string, value: number, levels: readonly Level[]) {
    const cur = nearest(levels, value);
    this.el.querySelectorAll<HTMLButtonElement>(`.seg [data-act="${act}"]`).forEach((b) => {
      const on = Number(b.dataset.value) === cur.v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
  }

  private refreshSound() {
    const s = settings();
    const silent = s.muted || s.volume === 0;
    this.el.querySelectorAll('[data-bind-mute]').forEach((b) => {
      b.innerHTML = icon(silent ? 'mute' : 'volume');
      b.setAttribute('aria-label', silent ? '소리 켜기' : '소리 끄기');
    });
    const vol = this.el.querySelector<HTMLInputElement>('input[data-act="volume"]');
    if (vol) this.setRange(vol, s.muted ? 0 : s.volume * 100);
    // ask for a tap only if we still can't play after a moment
    window.clearTimeout(this.pillTimer);
    if (audio.ready) this.el.classList.remove('needs-tap');
    else this.pillTimer = window.setTimeout(() => this.el.classList.toggle('needs-tap', !audio.ready), 600);
  }

  private refreshTimer() {
    const on = timer.phase !== 'off';
    const left = timer.remaining;
    this.bind('timer', on ? formatClock(left) : '타이머');
    this.bind('clock', on ? formatClock(left) : '');
    this.el.classList.toggle('has-timer', on);
    this.bind('timer-sub', on
      ? `${Math.max(1, Math.ceil(left / 60_000))}분 남았어요. 끝나기 전에 소리가 천천히 작아져요.`
      : '타이머가 끝나면 소리가 3분 동안 천천히 작아져요.');
    this.el.querySelectorAll<HTMLButtonElement>('[data-act="timer"]').forEach((b) => {
      const sel = Number(b.dataset.value) === (on ? timer.minutes : 0);
      b.classList.toggle('on', sel);
      b.setAttribute('aria-checked', String(sel));
    });
    if (timer.phase === 'ended' && !this.el.classList.contains('end-open')) this.openEnd();
  }

  private refreshFullscreen() {
    const btn = this.el.querySelector<HTMLElement>('[data-act="fullscreen"]');
    if (!btn) return;
    btn.hidden = !canFullscreen();
    btn.innerHTML = icon(isFullscreen() ? 'min' : 'max');
    btn.setAttribute('aria-label', isFullscreen() ? '전체화면 끝내기' : '전체화면');
  }

  private setRange(input: HTMLInputElement, value: number) {
    input.value = String(Math.round(value));
    input.style.setProperty('--v', `${input.value}%`);
  }

  private initRanges() {
    this.el.querySelectorAll<HTMLInputElement>('input.range').forEach((r) => r.style.setProperty('--v', `${r.value}%`));
  }

  private toast(text: string) {
    const t = this.$('.toast');
    t.innerHTML = `<span class="dot"></span>${text}`;
    t.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t.classList.remove('show'), 3200);
  }

  /* ---------- immersive mode ---------- */
  private get blocking() {
    const c = this.el.classList;
    return c.contains('sheet-open') || c.contains('tray-open') || c.contains('end-open') || this.dragging;
  }

  private armIdle() {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      if (this.blocking) this.armIdle();
      else this.setIdle(true);
    }, IDLE_AFTER);
  }

  private setIdle(on: boolean) {
    this.idle = on;
    this.el.classList.toggle('is-idle', on);
  }

  private readonly onPointerDownCapture = (e: PointerEvent) => {
    audio.unlock();
    this.swallowClick = false;
    if (this.idle) {
      // the first touch only brings the menu back
      this.setIdle(false);
      this.swallowClick = true;
      e.stopPropagation();
      window.setTimeout(() => { this.swallowClick = false; }, 700);
    }
    this.armIdle();
  };

  private readonly onClickCapture = (e: MouseEvent) => {
    if (!this.swallowClick) return;
    this.swallowClick = false;
    e.stopPropagation();
    e.preventDefault();
  };

  private readonly onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    if (this.idle) this.setIdle(false);
    this.armIdle();
  };

  /* ---------- actions ---------- */
  private readonly onSceneTap = (e: PointerEvent) => {
    if (this.blocking) return;
    const [x, y] = this.host.toScene(e.clientX, e.clientY);
    if (this.fire) {
      // 불멍: a tap on the fire stirs it; logs go in with the dock button or by dragging
      if (!this.fire.pokeAt(x, y)) return;
    } else if (this.rain) return; // 비멍 wipes the glass with its own drag handlers
    else this.scene.tap(x, y);
    if (this.aquarium) this.feedToast();
    this.el.classList.add('hint-done');
  };

  /* ---------- 비멍: the window ---------- */
  private setupRain() {
    const rain = this.rain!;
    const canvas = this.host.canvas;
    // the sill ends just above the controls that rest on it
    const place = () => {
      const tops = ['.m-status', '.dock']
        .map((sel) => this.$(sel).getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.top);
      rain.setFloor(tops.length ? Math.min(...tops) - this.el.getBoundingClientRect().top : null);
    };
    place();
    this.listen(window, 'resize', place);
    // dragging on the glass wipes the mist
    this.listen(canvas, 'pointerdown', (e: PointerEvent) => {
      if (this.blocking) return;
      canvas.setPointerCapture(e.pointerId);
      rain.wipeStart(...this.host.toScene(e.clientX, e.clientY));
      this.el.classList.add('hint-done');
    });
    this.listen(canvas, 'pointermove', (e: PointerEvent) => {
      if (rain.wipeMove(...this.host.toScene(e.clientX, e.clientY))) this.armIdle();
    });
    for (const type of ['pointerup', 'pointercancel']) this.listen(canvas, type, () => rain.wipeEnd());
  }

  private feedToast() {
    if (Date.now() - this.lastFeedToast < 10_000) return;
    this.lastFeedToast = Date.now();
    this.toast('물고기들이 먹이를 먹으러 와요');
  }

  private primary() {
    if (this.fire) {
      this.fire.addLogByHand(settings().wood);
      // the dock shows the woods itself; only the landscape rail still picks one with a long press
      const rail = this.el.querySelector('.rail-main')?.getClientRects().length;
      if (rail && firstTime('wood-tray')) this.toast('버튼을 꾹 누르면 장작을 고를 수 있어요');
    } else if (this.aquarium) {
      this.aquarium.feed();
      this.feedToast();
      this.el.classList.add('hint-done');
    } else if (this.pond) {
      this.pond.setDrizzle(!this.pond.drizzle);
      save({ drizzle: this.pond.drizzle });
      this.refreshLabels();
    }
  }

  private stepLevel(dir: 1 | -1) {
    if (this.rain) {
      const i = RAIN_LEVELS.indexOf(nearest(RAIN_LEVELS, this.rain.intensity));
      const next = RAIN_LEVELS[Math.max(0, Math.min(RAIN_LEVELS.length - 1, i + dir))];
      this.setRain(next.v);
    } else if (this.sea) {
      const i = WAVE_LEVELS.indexOf(nearest(WAVE_LEVELS, this.sea.size));
      const next = WAVE_LEVELS[Math.max(0, Math.min(WAVE_LEVELS.length - 1, i + dir))];
      this.setWave(next.v);
    }
  }

  private cycleLevel() {
    if (this.rain) {
      const i = RAIN_LEVELS.indexOf(nearest(RAIN_LEVELS, this.rain.intensity));
      this.setRain(RAIN_LEVELS[(i + 1) % RAIN_LEVELS.length].v);
    } else if (this.sea) {
      const i = WAVE_LEVELS.indexOf(nearest(WAVE_LEVELS, this.sea.size));
      this.setWave(WAVE_LEVELS[(i + 1) % WAVE_LEVELS.length].v);
    }
  }

  private setRain(v: number) {
    this.rain?.setIntensity(v);
    save({ rain: v });
    this.refreshLabels();
    this.toast(nearest(RAIN_LEVELS, v).label);
  }

  private setWave(v: number) {
    this.sea?.setSize(v);
    save({ wave: v });
    this.refreshLabels();
    this.toast(`파도 ${nearest(WAVE_LEVELS, v).label}`);
  }

  private toggleThunder() {
    if (!this.rain) return;
    const on = !settings().thunder;
    this.rain.setThunder(on);
    save({ thunder: on });
    this.refreshLabels();
    this.toast(on ? '천둥 켜짐 · 가끔 번쩍여요' : '천둥 꺼짐');
  }

  private toggleMute() {
    const s = settings();
    if (s.volume === 0) save({ volume: 0.6, muted: false });
    else save({ muted: !s.muted });
    audio.refreshVolume();
  }

  private readonly onClick = (e: MouseEvent) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!t || !this.el.contains(t)) return;
    switch (t.dataset.act) {
      case 'add-log':
        if (this.longPressed) this.longPressed = false;
        else this.primary();
        break;
      case 'feed':
      case 'drizzle':
        this.primary();
        break;
      case 'tray':
        this.open('tray-open');
        break;
      case 'add-wood': {
        const kind = t.dataset.wood as WoodKind;
        save({ wood: kind });
        this.refreshWood();
        this.fire?.addLogByHand(kind);
        break;
      }
      case 'rain':
        this.setRain(Number(t.dataset.value));
        break;
      case 'wave':
        this.setWave(Number(t.dataset.value));
        break;
      case 'rain-cycle':
      case 'wave-cycle':
        this.cycleLevel();
        break;
      case 'thunder':
        this.toggleThunder();
        break;
      case 'sheet':
        this.open('sheet-open');
        break;
      case 'close':
        this.closeAll();
        break;
      case 'mute':
        this.toggleMute();
        break;
      case 'fullscreen':
        toggleFullscreen();
        break;
      case 'timer': {
        const m = Number(t.dataset.value);
        timer.start(m);
        save({ timer: m });
        break;
      }
      case 'extend':
        this.extend();
        break;
      case 'finish':
        timer.clear();
        location.hash = '#/';
        break;
      case 'unlock':
        audio.unlock();
        break;
    }
  };

  private readonly onInput = (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.type !== 'range') return;
    t.style.setProperty('--v', `${t.value}%`);
    const v = Number(t.value) / 100;
    if (t.dataset.act === 'volume') {
      save({ volume: v, muted: false });
      audio.refreshVolume();
    } else if (t.dataset.act === 'mix' && t.dataset.layer) {
      setMix(this.id, t.dataset.layer, v);
      audio.setLayer(this.id, t.dataset.layer, v);
      const val = t.parentElement?.querySelector('.val');
      if (val) val.textContent = t.value;
    }
  };

  private readonly onChange = (e: Event) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.act === 'auto-tend' && this.fire) {
      this.fire.autoTend = t.checked;
      save({ autoTend: t.checked });
    }
  };

  private readonly onKey = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (e.code !== 'Escape' && (target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey)) return;
    this.armIdle();
    if (this.idle) this.setIdle(false);
    // e.code, not e.key: works the same with a Korean keyboard layout
    switch (e.code) {
      case 'Space':
        if (target.tagName === 'BUTTON' || target.tagName === 'A') return;
        e.preventDefault();
        this.primary();
        break;
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault();
        const i = GROUP_ORDER.indexOf(groupOf(this.id));
        const next = GROUP_ORDER[(i + (e.code === 'ArrowRight' ? 1 : GROUP_ORDER.length - 1)) % GROUP_ORDER.length];
        location.hash = groupRoute(next);
        break;
      }
      case 'ArrowUp':
      case 'ArrowDown':
        if (this.rain || this.sea) {
          e.preventDefault();
          this.stepLevel(e.code === 'ArrowUp' ? 1 : -1);
        }
        break;
      case 'KeyT':
        this.toggleThunder();
        break;
      case 'KeyM':
        this.toggleMute();
        break;
      case 'KeyF':
        toggleFullscreen();
        break;
      case 'Escape':
        this.closeAll();
        break;
    }
  };

  /* ---------- sheets ---------- */
  private open(cls: 'sheet-open' | 'tray-open') {
    this.closeAll();
    this.el.classList.add(cls);
    if (cls === 'tray-open') {
      this.fire?.setLift(true);
      this.placeDropZone();
      this.el.querySelector('.wood-split .pick')?.setAttribute('aria-expanded', 'true');
    }
  }

  private closeAll() {
    this.el.classList.remove('sheet-open', 'tray-open');
    this.fire?.setLift(false);
    this.el.querySelector('.wood-split .pick')?.setAttribute('aria-expanded', 'false');
    this.armIdle();
  }

  private openEnd() {
    this.closeAll();
    this.setIdle(false);
    this.bind('end-title', `${timer.elapsedMinutes}분 동안 멍때렸어요`);
    this.el.classList.add('end-open');
    window.clearTimeout(this.sleepTimer);
    this.sleepTimer = window.setTimeout(() => {
      this.el.classList.add('is-asleep');
      this.host.paused = true;
      audio.suspend();
    }, SLEEP_AFTER);
  }

  private extend() {
    window.clearTimeout(this.sleepTimer);
    this.el.classList.remove('end-open', 'is-asleep');
    this.host.paused = false;
    audio.resume();
    timer.extend(10);
    this.armIdle();
  }

  /* ---------- 불멍: chosen wood on the dock, wood tray, drag a log onto the fire ---------- */
  private setupFire() {
    this.refreshWood();
    let press = 0;
    this.el.querySelectorAll<HTMLElement>('[data-act="add-log"]').forEach((btn) => {
      if (btn.closest('.wood-split')) return; // its left half opens the tray, so no long press
      this.listen(btn, 'pointerdown', () => {
        this.longPressed = false;
        window.clearTimeout(press);
        press = window.setTimeout(() => {
          this.longPressed = true;
          this.open('tray-open');
        }, LONG_PRESS);
      });
      for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
        this.listen(btn, type, () => window.clearTimeout(press));
      }
      this.listen(btn, 'contextmenu', (e: Event) => e.preventDefault());
    });
    this.el.querySelectorAll<HTMLElement>('.wood').forEach((w) => {
      this.listen(w, 'pointerdown', (e: PointerEvent) => this.dragWood(e, w));
    });
    this.listen(window, 'resize', () => this.placeDropZone());
  }

  /** Show the chosen wood on the dock (split button, chips) and in the tray. */
  private refreshWood() {
    const wood = WOODS.find((w) => w.id === settings().wood) ?? WOODS[0];
    this.el.querySelectorAll<HTMLElement>('[data-wood]').forEach((w) => {
      const on = w.dataset.wood === wood.id;
      w.classList.toggle('on', on);
      if (on) w.setAttribute('aria-current', 'true');
      else w.removeAttribute('aria-current');
    });
    const pick = this.el.querySelector<HTMLElement>('.wood-split .pick');
    if (!pick) return;
    pick.innerHTML = `<span class="log-art mini ${wood.id}"></span><span>${wood.label}</span>${icon('chev')}`;
    pick.setAttribute('aria-label', `장작 고르기 (지금 ${wood.label})`);
  }

  private placeDropZone() {
    const fire = this.fire;
    if (!fire) return;
    this.host.sync();
    const { x, y, s } = fire.firePoint;
    const rect = this.host.canvas.getBoundingClientRect();
    const view = this.el.getBoundingClientRect();
    const k = fire.w ? rect.width / fire.w : 1;
    const px = rect.left - view.left + x * k;
    const py = rect.top - view.top + y * k;
    const zone = this.$('.drop-zone');
    zone.style.width = `${290 * s}px`;
    zone.style.height = `${100 * s}px`;
    zone.style.left = `${px - 145 * s}px`;
    zone.style.top = `${py - 50 * s}px`;
    const label = this.$('.drop-label');
    label.style.left = `${px}px`;
    label.style.top = `${py + 66 * s}px`;
  }

  private dragWood(e: PointerEvent, el: HTMLElement) {
    const fire = this.fire;
    if (!fire) return;
    const kind = (el.dataset.wood ?? 'oak') as WoodKind;
    el.setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const view = this.el.getBoundingClientRect();
    const ghost = this.$('.drag-ghost');
    ghost.querySelector('.log-art')!.className = `log-art big ${kind}`;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) {
        moved = true;
        this.dragging = true;
        this.placeDropZone();
        this.el.classList.add('dragging');
        el.classList.add('lifted');
      }
      if (!moved) return;
      ghost.style.transform = `translate(${ev.clientX - view.left}px, ${ev.clientY - view.top}px) translate(-50%, -50%) rotate(-16deg)`;
      const [x, y] = this.host.toScene(ev.clientX, ev.clientY);
      this.el.classList.toggle('over-fire', fire.isNearFire(x, y));
    };
    const finish = (ev: PointerEvent, cancelled: boolean) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', cancel);
      this.dragging = false;
      this.el.classList.remove('dragging', 'over-fire');
      el.classList.remove('lifted');
      if (cancelled) return;
      save({ wood: kind });
      this.refreshWood();
      if (!moved) {
        fire.addLogByHand(kind);
        this.closeAll();
        return;
      }
      const [x, y] = this.host.toScene(ev.clientX, ev.clientY);
      if (fire.isNearFire(x, y)) {
        fire.addLogByHand(kind, x);
        this.closeAll();
      }
    };
    const up = (ev: PointerEvent) => finish(ev, false);
    const cancel = (ev: PointerEvent) => finish(ev, true);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', cancel);
  }

  destroy() {
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.toastTimer);
    window.clearTimeout(this.sleepTimer);
    window.clearTimeout(this.pillTimer);
    for (const fn of this.cleanups) fn();
    this.host.destroy();
    if (this.el.classList.contains('is-asleep')) audio.resume();
  }
}
