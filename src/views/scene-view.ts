import { audio, layersOf } from '../audio/engine';
import { icon } from '../icons';
import { canFullscreen, isFullscreen, keepAwake, toggleFullscreen } from '../lib/device';
import { firstTime, save, setMix, settings } from '../lib/settings';
import { formatClock, timer } from '../lib/timer';
import { Aquarium } from '../scenes/aquarium';
import type { Scene } from '../scenes/base';
import { Fire, type WoodKind } from '../scenes/fire';
import { SceneHost } from '../scenes/host';
import { Pond, SEASONS } from '../scenes/pond';
import { Rain } from '../scenes/rain';
import {
  GROUPS, WATER, createScene, groupOf, groupRoute, isWater, routeOf, type GroupId, type SceneId,
} from '../scenes/registry';
import { SAND_PALETTES, Sand, type SandPalette } from '../scenes/sand';
import { Sea } from '../scenes/sea';
import { STAR_PHASES, STAR_SEASONS, Star, type StarPhase } from '../scenes/star';
import { starLayersFor } from '../audio/sounds/star';
import { EQ, wordmark, type View } from './view';

const IDLE_AFTER = 4000; // ms without input before the UI fades away
const SLEEP_AFTER = 60_000; // ms after the timer ends before the scene dims and stops
const LONG_PRESS = 450;
const AUDIO_STATE_EVERY = 250;

interface Level { v: number; label: string }
const RAIN_LEVELS: readonly Level[] = [{ v: 0.25, label: '보슬비' }, { v: 0.6, label: '비' }, { v: 1, label: '장대비' }];
const WAVE_LEVELS: readonly Level[] = [{ v: 0.6, label: '잔잔' }, { v: 1, label: '보통' }, { v: 1.5, label: '높음' }];
const SAND_LEVELS: readonly Level[] = [{ v: 0.3, label: '솔솔' }, { v: 0.6, label: '보통' }, { v: 1, label: '콸콸' }];
const nearest = (levels: readonly Level[], v: number) =>
  levels.reduce((a, b) => (Math.abs(b.v - v) < Math.abs(a.v - v) ? b : a));

const WOODS: readonly { id: WoodKind; label: string; desc: string }[] = [
  { id: 'oak', label: '참나무', desc: '오래 타요' },
  { id: 'pine', label: '소나무', desc: '타닥 소리가 커요' },
  { id: 'birch', label: '자작나무', desc: '불꽃이 밝아요' },
];

const TIMER_CHOICES = [15, 30, 60, 0] as const;
const timerLabel = (m: number) => (m === 0 ? '계속' : m === 60 ? '1시간' : `${m}분`);

/**
 * What the settings button says beside its sliders icon on wide screens: 설정, or the time left while a timer runs.
 * Phones show the icon alone, with a dot while a timer runs.
 */
const sheetLabel = (on: boolean, left: number) => (on ? formatClock(left) : '설정');

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
    now: '보글보글 · 물고기 <b data-bind="fish">17</b>마리',
    aside: '조명 <span data-bind="light">낮</span>',
    hint: '수면 위를 톡 치면 먹이가 떨어져요',
    title: '어항 · 보글보글',
    sub: '물고기 <b data-bind="fish">17</b>마리 · 조명 <span data-bind="light">낮</span>',
    keys: [{ text: '수면 위를 클릭하면 먹이 · 유리는 톡톡' }, { keys: ['L'], text: '달빛 조명' }],
    land: '물멍 · 어항',
  },
  sea: {
    now: '파도 소리 · 밤바다',
    aside: '파도 <span data-bind="wave">보통</span>',
    hint: '모래를 톡 치면 발자국이 남아요',
    title: '밤바다 · 파도 소리',
    sub: '파도 <span data-bind="wave">보통</span>',
    keys: [{ text: '모래를 클릭하거나 끌면 발자국' }, { keys: ['↑', '↓'], text: '파도 크기' }],
    land: '물멍 · 바다',
  },
  pond: {
    now: '물방울 · 바람 소리',
    aside: '<span data-bind="season">가을</span> · 빗방울 <span data-bind="drizzle">꺼짐</span>',
    hint: '물을 톡 치면 물결이 퍼져요',
    title: '연못 · 물방울 소리',
    sub: '<span data-bind="season">가을</span> · 잉어 <b data-bind="koi">5</b>마리 · 빗방울 <span data-bind="drizzle">꺼짐</span>',
    keys: [{ text: '클릭하면 물결' }, { keys: ['Space'], text: '먹이' }, { keys: ['R'], text: '빗방울' }, { keys: ['S'], text: '계절' }],
    land: '물멍 · 연못',
  },
  sand: {
    now: '모래 소리 · <span data-bind="palette">노을</span>',
    aside: '채움 <span data-bind="fill">0</span>%',
    hint: '화면을 끌면 모래가 따라와요',
    title: '모래 소리',
    sub: '<span data-bind="speed">보통</span> · <span data-bind="palette">노을</span> · 채움 <span data-bind="fill">0</span>%',
    keys: [{ keys: ['↑', '↓'], text: '속도 · <kbd>E</kbd> 비우기' }, { text: '화면을 끌면 모래가 따라와요' }],
    land: '모래멍',
  },
  star: {
    now: '<span class="now-on"><span data-bind="star-sound">풀벌레 소리</span> · <span data-bind="star-when">여름 초저녁</span></span><span class="now-hush" data-bind="star-hush"></span>',
    aside: '별똥별 <b data-bind="meteors">0</b>개',
    hint: '밝은 별을 누르면 별자리를 알려 줘요',
    title: '<span class="now-on" data-bind="star-sound">풀벌레 소리</span><span class="now-hush">쉿, 숨죽였어요</span>',
    sub: '<span data-bind="star-when">여름 초저녁</span> · 별똥별 <b data-bind="meteors">0</b>개',
    keys: [{ keys: ['↑', '↓'], text: '밤 깊이 · <kbd>S</kbd> 계절 · <kbd>C</kbd> 별자리' }, { keys: ['Space'], text: '별똥별 · 밝은 별을 누르면 별자리' }],
    land: '별멍',
  },
};

/** 별멍: what sounds in each season, and what goes quiet when the grass is touched. */
const STAR_SOUND: Record<string, { now: string; hush: string }> = {
  spring: { now: '개구리 소리', hush: '쉿, 개구리가 숨죽였어요' },
  summer: { now: '풀벌레 소리', hush: '쉿, 풀벌레가 숨죽였어요' },
  autumn: { now: '귀뚜라미 소리', hush: '쉿, 귀뚜라미가 숨죽였어요' },
  winter: { now: '겨울바람 소리', hush: '' },
};

const GROUP_ORDER: readonly GroupId[] = ['fire', 'rain', 'water', 'sand', 'star'];

const swatch = (p: SandPalette, cls = '') => `<span class="swatch pal-${p} ${cls}" aria-hidden="true"></span>`;

/** Tilt sensing exists (phones); iOS also wants to be asked from a tap. */
type OrientationCtor = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<'granted' | 'denied'> };
const canTilt = () => typeof DeviceOrientationEvent !== 'undefined' && matchMedia('(pointer: coarse)').matches;

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
    if (isWater(id)) this.setupWater();

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
    if (this.sea) this.setupSea();
    if (this.sand) this.setupSand();
    if (this.star) this.setupStar();

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
  private get sand() { return this.scene instanceof Sand ? this.scene : null; }
  private get star() { return this.scene instanceof Star ? this.scene : null; }

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
        ${c.hint && (this.rain || this.sand || this.star) ? `<div class="hint hint-glass glass only-m">${icon('hand', 'sm')}${c.hint}</div>` : ''}
        <div class="bottom">
          ${c.hint && !this.rain && !this.sand && !this.star ? `<div class="hint glass only-m">${icon('hand', 'sm')}${c.hint}</div>` : ''}
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
      ${this.sand ? this.sandTrayHtml() : ''}
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
        extra = `<button class="dock-btn" data-act="moonlight" aria-pressed="false" aria-label="달빛 조명">${icon('moon')}<span class="only-d">달빛</span></button>`;
        break;
      case 'pond':
        main = `<button class="primary" data-act="feed">${icon('food')}<span>먹이 주기</span><kbd class="only-d">Space</kbd></button>`;
        extra = `<button class="dock-btn" data-act="drizzle" aria-pressed="false" aria-label="빗방울">${icon('drop')}<span class="only-d">빗방울</span></button>
          <button class="dock-btn" data-act="season" aria-label="계절 바꾸기">${icon('leaf')}<span class="only-d" data-bind="season">가을</span></button>`;
        break;
      case 'rain':
        main = this.seg(RAIN_LEVELS, 'rain', s.rain, '비 세기');
        extra = `<button class="dock-btn" data-act="thunder" aria-pressed="false" aria-label="천둥">${icon('zap')}<span class="only-d">천둥</span></button>`;
        break;
      case 'sea':
        main = this.seg(WAVE_LEVELS, 'wave', s.wave, '파도 크기');
        break;
      case 'sand':
        // phones: the colour button shows the chosen set and opens the tray. Wide screens: the four sets and 비우기 are on the dock.
        main = this.seg(SAND_LEVELS, 'sand-speed', s.sandSpeed, '모래 속도');
        extra = `
          <button class="dock-btn only-m" data-act="tray" aria-haspopup="dialog" aria-label="색 고르기"><span data-bind-swatch>${swatch(s.sandPalette)}</span></button>
          <div class="pal-chips only-d" role="radiogroup" aria-label="색 고르기">${SAND_PALETTES.map((p) =>
            `<button role="radio" data-act="palette" data-value="${p.id}" aria-label="${p.label}" title="${p.label}">${swatch(p.id)}</button>`).join('')}</div>
          <button class="dock-btn only-d" data-act="sand-empty">${icon('sand')}<span>비우기</span></button>`;
        break;
      case 'star':
        // the lit time shows a pin while it is held; fireflies only in summer
        main = `<div class="seg star-seg" role="group" aria-label="밤 깊이">${STAR_PHASES.map((p) =>
          `<button data-act="star-phase" data-value="${p.id}">${p.label}${icon('pin', 'pin')}</button>`).join('')}</div>`;
        extra = `
          <button class="dock-btn star-flies" data-act="fireflies" aria-pressed="false" aria-label="반딧불이">${icon('firefly')}<span class="only-d">반딧불이</span></button>
          <button class="dock-btn only-d" data-act="star-guide" aria-pressed="false" aria-label="별자리 알려 주기">${icon('star')}<span>별자리</span></button>
          <button class="dock-btn" data-act="season" aria-label="계절 바꾸기">${icon('leaf')}<span class="only-d" data-bind="star-season">여름</span></button>`;
        break;
    }
    return `
      <button class="dock-btn" data-act="sheet" aria-label="설정">${icon('sliders')}<span class="only-d" data-bind="timer"></span></button>
      <span class="sep only-d"></span>
      ${main}
      ${extra}
      <span class="sep only-d"></span>
      <div class="vol only-d"><button class="vol-btn" data-act="mute" data-bind-mute aria-label="소리 끄기">${icon('volume')}</button><input class="range" type="range" min="0" max="100" data-act="volume" aria-label="음량"></div>`;
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
      pond: { act: 'feed', icon: 'food', label: '먹이 주기' },
      sand: { act: 'sand-cycle', icon: 'sand', label: '모래 속도 바꾸기' },
      star: { act: 'meteor', icon: 'star', label: '별똥별' },
    } as const;
    const m = main[this.id];
    return `
      <div class="rail-group">${tabs}</div>
      <button class="rail-main" data-act="${m.act}" aria-label="${m.label}">${icon(m.icon)}</button>
      <div class="rail-group">
        <button class="icon-btn" data-act="sheet" aria-label="설정">${icon('sliders')}</button>
        <button class="icon-btn" data-act="mute" data-bind-mute aria-label="소리 끄기">${icon('volume')}</button>
      </div>`;
  }

  private sheetHtml() {
    const s = settings();
    const mix = s.mix[this.id] ?? {};
    const rows = layersOf(this.id).map((l) => {
      const v = Math.round((mix[l.id] ?? l.def) * 100);
      return `<label class="mix-row" data-layer-row="${l.id}">${icon(l.icon, 'sm')}<span>${l.label}</span><input class="range" type="range" min="0" max="100" value="${v}" data-act="mix" data-layer="${l.id}" aria-label="${l.label} 크기"><span class="val">${v}</span></label>`;
    }).join('');
    const tend = this.fire
      ? `<label class="switch-row"><span><b>장작 알아서 넣기</b><small>불이 약해지면 장작을 하나씩 넣어요</small></span><input class="switch" type="checkbox" data-act="auto-tend" ${s.autoTend ? 'checked' : ''}></label>`
      : this.sand
        ? `<label class="switch-row"><span><b>가득 차면 저절로 비우기</b><small>끄면 가득 찼을 때 모래가 멈춰요</small></span><input class="switch" type="checkbox" data-act="auto-empty" ${s.sandAutoEmpty ? 'checked' : ''}></label>`
        : this.star
          ? `<h4>화면</h4><label class="switch-row"><span><b>별자리 알려 주기</b><small>가끔 별자리 하나를 이어 이름을 보여 줘요</small></span><input class="switch" type="checkbox" data-act="star-guide" ${s.starGuide ? 'checked' : ''}></label>`
          : '';
    return `
      <div class="sheet glass-strong" role="dialog" aria-modal="true" aria-label="설정">
        <div class="grab"></div>
        <div class="sheet-head"><h3>설정</h3><button class="icon-btn" data-act="close" aria-label="닫기">${icon('x')}</button></div>
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

  private sandTrayHtml() {
    const s = settings();
    const tilt = canTilt()
      ? `<label class="switch-row"><span><b>폰 기울여 방향 바꾸기</b><small>기울인 쪽으로 모래 줄기가 휘어요</small></span><input class="switch" type="checkbox" data-act="sand-tilt" ${s.sandTilt ? 'checked' : ''}></label>`
      : '';
    return `
      <div class="tray pal-tray glass-strong" role="dialog" aria-label="색 고르기">
        <div class="grab"></div>
        <div class="tray-head"><h4>색 고르기</h4><span>지금부터 떨어지는 모래가 바뀌어요</span></div>
        <div class="pals" role="radiogroup" aria-label="색 묶음">${SAND_PALETTES.map((p) =>
          `<button class="pal-pick" role="radio" data-act="palette" data-value="${p.id}">${swatch(p.id, 'big')}<b>${p.label}</b></button>`).join('')}</div>
        <label class="switch-row"><span><b>가득 차면 저절로 비우기</b><small>끄면 가득 찼을 때 모래가 멈춰요</small></span><input class="switch" type="checkbox" data-act="auto-empty" ${s.sandAutoEmpty ? 'checked' : ''}></label>
        ${tilt}
        <button class="tray-go" data-act="sand-empty">${icon('sand')}지금 비우기</button>
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
    else if (key === 'phase' || key === 'hold' || key === 'season') this.refreshLabels();
    else if (key === 'hush') this.el.classList.toggle('is-hush', value > 0);
    else if (key === 'full') this.toast(value ? '가득 찼어요. 비우고 다시 쌓을게요' : '가득 찼어요. 비우기를 누르면 다시 쌓여요');
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
    if (this.aquarium) {
      const on = this.aquarium.moon;
      this.bind('light', on ? '달빛' : '낮');
      this.el.querySelectorAll('[data-act="moonlight"]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
    }
    if (this.sea) {
      this.bind('wave', nearest(WAVE_LEVELS, this.sea.size).label);
      this.syncSeg('wave', this.sea.size, WAVE_LEVELS);
    }
    if (this.sand) {
      const pal = this.sand.palette;
      this.bind('speed', nearest(SAND_LEVELS, this.sand.speed).label);
      this.bind('palette', SAND_PALETTES.find((p) => p.id === pal)?.label ?? '');
      this.syncSeg('sand-speed', this.sand.speed, SAND_LEVELS);
      this.el.querySelectorAll<HTMLElement>('[data-act="palette"]').forEach((b) => {
        const on = b.dataset.value === pal;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(on));
      });
      this.el.querySelectorAll<HTMLElement>('[data-bind-swatch]').forEach((n) => { n.innerHTML = swatch(pal); });
    }
    if (this.star) {
      const st = this.star;
      const season = SEASONS.find((x) => x.id === st.season)?.label ?? '';
      const phase = STAR_PHASES.find((p) => p.id === st.phase)?.label ?? '';
      this.el.dataset.season = st.season;
      this.bind('star-season', season);
      this.bind('star-when', `${season} ${phase}`);
      this.bind('star-sound', STAR_SOUND[st.season].now);
      this.bind('star-hush', STAR_SOUND[st.season].hush);
      this.el.querySelectorAll<HTMLElement>('[data-act="star-phase"]').forEach((b) => {
        const on = b.dataset.value === st.phase;
        b.classList.toggle('on', on);
        b.classList.toggle('held', on && st.hold);
        b.setAttribute('aria-pressed', String(on));
        b.setAttribute('aria-label', on ? `${b.textContent} (${st.hold ? '머무는 중, 누르면 다시 흘러가요' : '누르면 여기 머물러요'})` : `${b.textContent}로`);
      });
      this.el.querySelectorAll('[data-act="fireflies"]').forEach((b) => b.setAttribute('aria-pressed', String(st.fireflies)));
      this.el.querySelectorAll('button[data-act="star-guide"]').forEach((b) => b.setAttribute('aria-pressed', String(st.guideOn)));
      this.el.querySelectorAll<HTMLInputElement>('input[data-act="star-guide"]').forEach((b) => { b.checked = st.guideOn; });
      // the sound sheet shows only the layers heard in this season
      const heard = new Set(starLayersFor(STAR_SEASONS.indexOf(st.season)).map((l) => l.id));
      this.el.querySelectorAll<HTMLElement>('[data-layer-row]').forEach((r) => { r.hidden = !heard.has(r.dataset.layerRow!); });
    }
    if (this.pond) {
      const on = this.pond.drizzle;
      this.bind('drizzle', on ? '켜짐' : '꺼짐');
      this.bind('season', SEASONS.find((x) => x.id === this.pond!.season)?.label ?? '');
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
    const mins = Math.max(1, Math.ceil(left / 60_000));
    this.bind('timer', sheetLabel(on, left));
    this.bind('clock', on ? formatClock(left) : '');
    this.el.classList.toggle('has-timer', on);
    // phones show only the icon and a dot, so the button's name carries the time left
    this.el.querySelectorAll('[data-act="sheet"]').forEach((b) =>
      b.setAttribute('aria-label', on ? `설정, 타이머 ${mins}분 남음` : '설정'));
    this.bind('timer-sub', on
      ? `${mins}분 남았어요. 끝나기 전에 소리가 천천히 작아져요.`
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
    } else if (this.rain || this.sea || this.sand) return; // 비멍 wipes the glass, 바다 walks the sand, 모래멍 pulls the stream: each with its own drag handlers
    else if (this.aquarium) {
      const what = this.aquarium.poke(x, y);
      if (what === 'feed') {
        this.feedToast();
        this.el.classList.add('hint-done');
      } else if (what === 'knock' && firstTime('glass-knock')) this.toast('유리를 치면 물고기가 놀라요 · 먹이는 수면 위에서');
      return;
    } else this.scene.tap(x, y);
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

  /* ---------- 물멍: a seat by the water ---------- */
  private setupWater() {
    const scene = this.aquarium ?? this.sea ?? this.pond;
    if (!scene) return;
    // the controls rest on the cabinet / the dry sand / the bank's stones, and the tabs float above the water
    const place = () => {
      const view = this.el.getBoundingClientRect();
      const tops = ['.m-status', '.dock']
        .map((sel) => this.$(sel).getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.top);
      const bottoms = ['.subscenes', '.topbar']
        .map((sel) => this.$(sel).getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.bottom);
      scene.setEdges(
        bottoms.length ? Math.max(...bottoms) - view.top : null,
        tops.length ? Math.min(...tops) - view.top : null,
      );
    };
    place();
    this.listen(window, 'resize', place);
  }

  /* ---------- 바다: footprints on the sand ---------- */
  private setupSea() {
    const sea = this.sea!;
    const canvas = this.host.canvas;
    this.listen(canvas, 'pointerdown', (e: PointerEvent) => {
      if (this.blocking) return;
      canvas.setPointerCapture(e.pointerId);
      if (sea.walkStart(...this.host.toScene(e.clientX, e.clientY))) this.el.classList.add('hint-done');
    });
    this.listen(canvas, 'pointermove', (e: PointerEvent) => {
      if (sea.walkMove(...this.host.toScene(e.clientX, e.clientY))) this.armIdle();
    });
    for (const type of ['pointerup', 'pointercancel']) this.listen(canvas, type, () => sea.walkEnd());
  }

  /* ---------- 별멍: the grass under the controls ---------- */
  private setupStar() {
    const star = this.star!;
    // the grass reaches up to just below the controls
    const place = () => {
      const view = this.el.getBoundingClientRect();
      const tops = ['.m-status', '.dock']
        .map((sel) => this.$(sel).getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.top);
      star.setFloor(tops.length ? Math.min(...tops) - view.top : null);
    };
    place();
    this.listen(window, 'resize', place);
  }

  /** Tap the lit time again to stay there; another time jumps there. */
  private choosePhase(phase: StarPhase) {
    const st = this.star;
    if (!st) return;
    const what = st.choose(phase);
    const label = STAR_PHASES.find((p) => p.id === st.phase)?.label ?? '';
    if (what === 'hold') this.toast(`${label}에 머물러요`);
    else if (what === 'flow') this.toast(st.pos < 2 ? '다시 흘러가요' : '새벽이 밝았어요');
    save({ starPhase: phase, starHold: st.hold });
    this.refreshLabels();
  }

  private stepPhase(dir: 1 | -1) {
    const st = this.star;
    if (!st) return;
    const i = STAR_PHASES.findIndex((p) => p.id === st.phase);
    const next = STAR_PHASES[Math.max(0, Math.min(STAR_PHASES.length - 1, i + dir))];
    if (next.id !== st.phase) this.choosePhase(next.id);
  }

  private toggleFireflies() {
    const st = this.star;
    if (!st) return;
    st.setFireflies(!st.fireflies);
    save({ starFireflies: st.fireflies });
    this.refreshLabels();
    this.toast(st.fireflies ? '반딧불이가 날아요' : '반딧불이가 들어갔어요');
  }

  private setGuide(on: boolean) {
    const st = this.star;
    if (!st) return;
    st.setGuide(on);
    save({ starGuide: on });
    this.refreshLabels();
    this.toast(on ? '별자리를 알려 줄게요' : '별자리 알려 주기를 껐어요');
  }

  /* ---------- 모래멍: the frame, the stream under the hand, tilt ---------- */
  private setupSand() {
    const sand = this.sand!;
    const canvas = this.host.canvas;
    // the sand rests on the stand just above the controls and counts as full when it reaches the tabs
    const place = () => {
      const view = this.el.getBoundingClientRect();
      const tops = ['.m-status', '.dock']
        .map((sel) => this.$(sel).getBoundingClientRect())
        .filter((r) => r.height > 0)
        .map((r) => r.top);
      const top = this.$('.topbar').getBoundingClientRect();
      sand.setEdges(
        top.height > 0 ? top.bottom - view.top + 10 : null,
        tops.length ? Math.min(...tops) - view.top - 10 : null,
      );
    };
    place();
    this.listen(window, 'resize', place);
    this.listen(canvas, 'pointerdown', (e: PointerEvent) => {
      if (this.blocking) return;
      canvas.setPointerCapture(e.pointerId);
      sand.dragStart(this.host.toScene(e.clientX, e.clientY)[0]);
      this.el.classList.add('hint-done');
    });
    this.listen(canvas, 'pointermove', (e: PointerEvent) => {
      if (sand.dragMove(this.host.toScene(e.clientX, e.clientY)[0])) this.armIdle();
    });
    for (const type of ['pointerup', 'pointercancel']) this.listen(canvas, type, () => sand.dragEnd());
    // left-right lean of the phone, whichever way it is held
    this.listen(window, 'deviceorientation', (e: Event) => {
      if (!settings().sandTilt) return;
      const o = e as DeviceOrientationEvent;
      const angle = screen.orientation?.angle ?? 0;
      const lean = angle === 90 ? o.beta : angle === 270 ? -(o.beta ?? 0) : o.gamma;
      sand.setTilt((lean ?? 0) / 30);
    });
  }

  private setSandSpeed(v: number) {
    this.sand?.setSpeed(v);
    save({ sandSpeed: v });
    this.refreshLabels();
    this.toast(nearest(SAND_LEVELS, v).label);
  }

  private setPalette(id: SandPalette) {
    if (!this.sand || !SAND_PALETTES.some((p) => p.id === id)) return;
    this.sand.setPalette(id);
    save({ sandPalette: id });
    this.refreshLabels();
  }

  private emptySand() {
    this.sand?.empty();
    this.closeAll();
  }

  /** iOS only hands out tilt after asking from a tap; elsewhere it just works. */
  private async setTilt(on: boolean, box: HTMLInputElement) {
    if (on) {
      const ask = (DeviceOrientationEvent as OrientationCtor).requestPermission;
      if (ask) {
        const ok = await ask.call(DeviceOrientationEvent).then((r) => r === 'granted', () => false);
        if (!ok) {
          box.checked = false;
          this.toast('기울기 권한이 없어서 켤 수 없어요');
          return;
        }
      }
    } else this.sand?.setTilt(0);
    save({ sandTilt: on });
  }

  private feedToast() {
    if (Date.now() - this.lastFeedToast < 10_000) return;
    this.lastFeedToast = Date.now();
    this.toast('물고기들이 먹이를 먹으러 와요');
  }

  private primary() {
    if (this.fire) {
      this.addLog(settings().wood);
      // the dock shows the woods itself; only the landscape rail still picks one with a long press
      const rail = this.el.querySelector('.rail-main')?.getClientRects().length;
      if (rail && firstTime('wood-tray')) this.toast('버튼을 꾹 누르면 장작을 고를 수 있어요');
    } else if (this.aquarium) {
      this.aquarium.feed();
      this.feedToast();
      this.el.classList.add('hint-done');
    } else if (this.star) {
      this.star.meteor();
      this.el.classList.add('hint-done');
    } else if (this.pond) {
      this.pond.feed();
      if (Date.now() - this.lastFeedToast > 10_000) {
        this.lastFeedToast = Date.now();
        this.toast('잉어들이 먹이를 먹으러 와요');
      }
    }
  }

  private toggleDrizzle() {
    if (!this.pond) return;
    this.pond.setDrizzle(!this.pond.drizzle);
    save({ drizzle: this.pond.drizzle });
    this.refreshLabels();
    this.toast(this.pond.drizzle ? '빗방울이 떨어져요' : '빗방울이 그쳤어요');
  }

  private nextSeason() {
    if (this.star) {
      const st = this.star;
      const next = STAR_SEASONS[(STAR_SEASONS.indexOf(st.season) + 1) % STAR_SEASONS.length];
      st.setSeason(next);
      save({ starSeason: next });
      // the scene dims and comes back in the new season; the labels follow when it does (the 'season' stat)
      this.toast(`${SEASONS.find((x) => x.id === next)?.label ?? ''} 밤하늘`);
      return;
    }
    if (!this.pond) return;
    const i = SEASONS.findIndex((x) => x.id === this.pond!.season);
    const next = SEASONS[(i + 1) % SEASONS.length];
    this.pond.setSeason(next.id);
    save({ season: next.id });
    this.refreshLabels();
    this.toast(`연못의 ${next.label}`);
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
    } else if (this.sand) {
      const i = SAND_LEVELS.indexOf(nearest(SAND_LEVELS, this.sand.speed));
      const next = SAND_LEVELS[Math.max(0, Math.min(SAND_LEVELS.length - 1, i + dir))];
      this.setSandSpeed(next.v);
    }
  }

  private cycleLevel() {
    if (this.rain) {
      const i = RAIN_LEVELS.indexOf(nearest(RAIN_LEVELS, this.rain.intensity));
      this.setRain(RAIN_LEVELS[(i + 1) % RAIN_LEVELS.length].v);
    } else if (this.sea) {
      const i = WAVE_LEVELS.indexOf(nearest(WAVE_LEVELS, this.sea.size));
      this.setWave(WAVE_LEVELS[(i + 1) % WAVE_LEVELS.length].v);
    } else if (this.sand) {
      const i = SAND_LEVELS.indexOf(nearest(SAND_LEVELS, this.sand.speed));
      this.setSandSpeed(SAND_LEVELS[(i + 1) % SAND_LEVELS.length].v);
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

  private toggleMoon() {
    if (!this.aquarium) return;
    const on = !this.aquarium.moon;
    this.aquarium.setMoon(on);
    save({ moonlight: on });
    this.refreshLabels();
    this.toast(on ? '달빛 조명 · 물고기들이 느려져요' : '낮 조명');
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
        this.primary();
        break;
      case 'drizzle':
        this.toggleDrizzle();
        break;
      case 'star-phase':
        this.choosePhase(t.dataset.value as StarPhase);
        break;
      case 'fireflies':
        this.toggleFireflies();
        break;
      case 'star-guide':
        if (t.tagName === 'BUTTON') this.setGuide(!this.star?.guideOn);
        break;
      case 'meteor':
        this.primary();
        break;
      case 'season':
        this.nextSeason();
        break;
      case 'tray':
        this.open('tray-open');
        break;
      case 'add-wood': {
        const kind = t.dataset.wood as WoodKind;
        save({ wood: kind });
        this.refreshWood();
        this.addLog(kind);
        break;
      }
      case 'rain':
        this.setRain(Number(t.dataset.value));
        break;
      case 'wave':
        this.setWave(Number(t.dataset.value));
        break;
      case 'sand-speed':
        this.setSandSpeed(Number(t.dataset.value));
        break;
      case 'palette':
        this.setPalette(t.dataset.value as SandPalette);
        break;
      case 'sand-empty':
        this.emptySand();
        break;
      case 'rain-cycle':
      case 'wave-cycle':
      case 'sand-cycle':
        this.cycleLevel();
        break;
      case 'thunder':
        this.toggleThunder();
        break;
      case 'moonlight':
        this.toggleMoon();
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
    } else if (t.dataset.act === 'auto-empty' && this.sand) {
      this.sand.autoEmpty = t.checked;
      save({ sandAutoEmpty: t.checked });
      // the same switch is in the tray and in the sheet
      this.el.querySelectorAll<HTMLInputElement>('[data-act="auto-empty"]').forEach((b) => { b.checked = t.checked; });
    } else if (t.dataset.act === 'sand-tilt') void this.setTilt(t.checked, t);
    else if (t.dataset.act === 'star-guide') this.setGuide(t.checked);
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
        if (this.rain || this.sea || this.sand) {
          e.preventDefault();
          this.stepLevel(e.code === 'ArrowUp' ? 1 : -1);
        } else if (this.star) {
          e.preventDefault();
          this.stepPhase(e.code === 'ArrowUp' ? 1 : -1);
        }
        break;
      case 'KeyE':
        this.emptySand();
        break;
      case 'KeyT':
        this.toggleThunder();
        break;
      case 'KeyR':
        this.toggleDrizzle();
        break;
      case 'KeyS':
        this.nextSeason();
        break;
      case 'KeyL':
        this.toggleMoon();
        break;
      case 'KeyC':
        if (this.star) this.setGuide(!this.star.guideOn);
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
    this.sand?.setTaper(true);
    this.star?.setTaper(true);
  }

  private extend() {
    window.clearTimeout(this.sleepTimer);
    this.el.classList.remove('end-open', 'is-asleep');
    this.host.paused = false;
    this.sand?.setTaper(false);
    this.star?.setTaper(false);
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

  /** Put a log on the fire, or say so when the pit has no room for it. */
  private addLog(kind: WoodKind, atX?: number) {
    if (this.fire?.addLogByHand(kind, atX) === false) this.toast('장작이 가득해요 · 조금 타면 더 넣을 수 있어요');
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
        this.addLog(kind);
        this.closeAll();
        return;
      }
      const [x, y] = this.host.toScene(ev.clientX, ev.clientY);
      if (fire.isNearFire(x, y)) {
        this.addLog(kind, x);
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
