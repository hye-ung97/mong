import { audio } from '../audio/engine';
import { icon, type IconName } from '../icons';
import { settings } from '../lib/settings';
import { SceneHost } from '../scenes/host';
import { createScene, groupRoute, type GroupId, type SceneId } from '../scenes/registry';
import { EQ, wordmark, type View } from './view';

interface Card { group: GroupId; scene: SceneId; title: string; sub: string; tag: string; tagIcon: IconName }

const CARDS: readonly Card[] = [
  { group: 'fire', scene: 'fire', title: '불멍', sub: '타닥타닥, 장작 타는 소리', tag: '장작 넣기', tagIcon: 'log' },
  { group: 'rain', scene: 'rain', title: '비멍', sub: '창가에 앉아 듣는 빗소리', tag: '비 세기 조절', tagIcon: 'rain' },
  { group: 'water', scene: 'aquarium', title: '물멍', sub: '어항 · 바다 · 연못', tag: '먹이 주기 · 물결', tagIcon: 'fish' },
  { group: 'sand', scene: 'sand', title: '모래멍', sub: '사르르, 색모래 쌓이는 소리', tag: '색모래 붓기', tagIcon: 'sand' },
  { group: 'star', scene: 'star', title: '별멍', sub: '풀밭에 누워 듣는 밤소리', tag: '별자리 · 별똥별', tagIcon: 'star' },
];

const canHover = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

/** 오늘은 어떤 멍? — five live previews; picking one is the gesture that starts the sound. */
export class HomeView implements View {
  readonly el: HTMLElement;
  private readonly hosts: SceneHost[] = [];
  private readonly cleanups: (() => void)[] = [];

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'view home-view';
    this.el.innerHTML = `
      <header class="home-head">
        ${wordmark()}
        <h1>오늘은 어떤 멍?</h1>
        <p>소리를 켜고, 아무 생각 없이 바라보세요.</p>
      </header>
      <nav class="cards" aria-label="장면 고르기">
        ${CARDS.map((c, i) => `
          <a class="card theme-${c.group}${c.group === 'star' ? ' wide' : ''}" href="${groupRoute(c.group)}" data-scene="${c.scene}" data-key="${i + 1}">
            <canvas class="scene" aria-hidden="true"></canvas>
            <span class="card-tag glass tag-default">${icon(c.tagIcon, 'sm')}${c.tag}</span>
            <span class="card-tag glass tag-preview">${EQ}소리 미리 듣는 중</span>
            <span class="card-info">
              <span><span class="card-title">${c.title}</span><span class="card-sub">${c.sub}</span></span>
              <span class="go glass" aria-hidden="true">${icon('arrow')}</span>
              <span class="enter" aria-hidden="true">들어가기${icon('arrow', 'sm')}</span>
            </span>
          </a>`).join('')}
      </nav>
      <footer class="home-foot">
        <span>${icon('headphones', 'sm')}이어폰을 끼면 더 좋아요</span>
        <span class="only-d"><kbd>1</kbd>–<kbd>5</kbd> 바로 들어가기</span>
      </footer>`;
    parent.append(this.el);

    const s = settings();
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
      const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].indexOf(k);
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
