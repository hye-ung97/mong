import { audio } from '../audio/engine';
import { icon, type IconName } from '../icons';
import { isLocked } from '../lib/ads';
import { settings } from '../lib/settings';
import { SceneHost } from '../scenes/host';
import { createScene, groupRoute, type GroupId, type SceneId } from '../scenes/registry';
import { EQ, wordmark, type View } from './view';

export interface Card {
  group: GroupId; scene: SceneId; title: string; sub: string; tag: string; tagIcon: IconName;
  /** a card twice as wide (the last row) */
  wide?: boolean;
  /** says NEW until the visitor has been in once (the hint it waits for) */
  newUntil?: string;
}

export const CARDS: readonly Card[] = [
  { group: 'fire', scene: 'fire', title: '불멍', sub: '타닥타닥, 장작 타는 소리', tag: '장작 넣기', tagIcon: 'log' },
  { group: 'rain', scene: 'rain', title: '비멍', sub: '창가에 앉아 듣는 빗소리', tag: '비 세기 조절', tagIcon: 'rain' },
  { group: 'water', scene: 'aquarium', title: '물멍', sub: '어항 · 바다 · 연못', tag: '먹이 주기 · 물결', tagIcon: 'fish' },
  { group: 'sand', scene: 'sand', title: '모래멍', sub: '사르르, 색모래 쌓이는 소리', tag: '색모래 붓기', tagIcon: 'sand' },
  { group: 'star', scene: 'star', title: '별멍', sub: '풀밭에 누워 듣는 밤소리', tag: '별자리 · 별똥별', tagIcon: 'star' },
  { group: 'snow', scene: 'clocktower', title: '눈멍', sub: '뽀드득, 새 눈 밟는 소리', tag: '발자국 · 눈 쓸기', tagIcon: 'snow' },
  { group: 'subway', scene: 'seat', title: '지하철멍', sub: '덜컹덜컹, 한강 위 불꽃놀이', tag: '불꽃 올리기', tagIcon: 'spark', wide: true, newUntil: 'subway-visited' },
];

const canHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

/**
 * 오늘은 어떤 멍? — seven live previews; picking one is the gesture that starts the sound. Six are the same size and
 * 지하철멍's is twice as wide: phones have two columns with it across the bottom, wide screens four columns.
 */
export class HomeView implements View {
  readonly el: HTMLElement;
  private readonly hosts: SceneHost[] = [];
  private readonly cleanups: (() => void)[] = [];

  constructor(parent: HTMLElement) {
    const s = settings();
    this.el = document.createElement('div');
    this.el.className = 'view home-view';
    this.el.innerHTML = `
      <header class="home-head">
        ${wordmark()}
        <h1>오늘은 어떤 멍?</h1>
        <p>소리를 켜고, 아무 생각 없이 바라보세요.</p>
      </header>
      <nav class="cards" aria-label="장면 고르기">
        ${CARDS.map((c, i) => {
          // Toss mini app: a 멍 that opens after an ad says so where its tag usually is
          const locked = isLocked(c.group);
          const fresh = c.newUntil && !s.hints.includes(c.newUntil) ? '<span class="new-dot">NEW</span>' : '';
          return `
          <a class="card theme-${c.group}${c.wide ? ' wide' : ''}${locked ? ' locked' : ''}" href="${groupRoute(c.group)}" data-scene="${c.scene}" data-key="${i + 1}">
            <canvas class="scene" aria-hidden="true"></canvas>
            ${locked
              ? `<span class="card-tag glass tag-default lock">${icon('lock', 'sm')}광고 보고 열기</span>`
              : `<span class="card-tag glass tag-default">${icon(c.tagIcon, 'sm')}${c.tag}</span>`}
            <span class="card-tag glass tag-preview">${EQ}소리 미리 듣는 중</span>
            <span class="card-info">
              <span><span class="card-title">${c.title}${fresh}</span><span class="card-sub">${c.sub}</span></span>
              <span class="go glass" aria-hidden="true">${icon('arrow')}</span>
              <span class="enter" aria-hidden="true">들어가기${icon('arrow', 'sm')}</span>
            </span>
          </a>`;
        }).join('')}
      </nav>
      <footer class="home-foot">
        <span>${icon('headphones', 'sm')}이어폰을 끼면 더 좋아요</span>
        <span class="only-d"><kbd>1</kbd>–<kbd>${CARDS.length}</kbd> 바로 들어가기</span>
      </footer>`;
    parent.append(this.el);

    this.el.querySelectorAll<HTMLAnchorElement>('.card').forEach((card) => {
      const id = card.dataset.scene as SceneId;
      const canvas = card.querySelector('canvas')!;
      this.hosts.push(new SceneHost(canvas, createScene(id, 'card', s)));
      this.on(card, 'pointerdown', () => audio.unlock());
      this.on(card, 'mouseenter', () => {
        if (!canHover() || !audio.ready) return;
        audio.startPreview(id);
        card.classList.add('previewing');
      });
      this.on(card, 'mouseleave', () => {
        audio.stopPreview();
        card.classList.remove('previewing');
      });
    });
    this.on(window, 'keydown', (e: Event) => {
      const k = (e as KeyboardEvent).code;
      const n = CARDS.findIndex((_, i) => k === `Digit${i + 1}`);
      if (n < 0 || n >= CARDS.length) return;
      audio.unlock();
      location.hash = groupRoute(CARDS[n].group);
    });
  }

  private on(target: EventTarget, type: string, fn: (e: Event) => void) {
    target.addEventListener(type, fn);
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  destroy() {
    audio.stopPreview();
    for (const fn of this.cleanups) fn();
    for (const h of this.hosts) h.destroy();
  }
}
