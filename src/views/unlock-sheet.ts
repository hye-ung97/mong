import { audio } from '../audio/engine';
import { icon } from '../icons';
import { adReady, FREE_GROUP, preloadAd, unlock, watchAd } from '../lib/ads';
import { settings } from '../lib/settings';
import { SceneHost } from '../scenes/host';
import { createScene, GROUPS, groupOf, groupRoute, type GroupId, type SceneId } from '../scenes/registry';
import { CARDS } from './home-view';
import { EQ } from './view';

/** A line the next scene shows once it opens (set when a 멍 was just opened). */
let arrival: string | null = null;

export function takeArrivalNote() {
  const note = arrival;
  arrival = null;
  return note;
}

let open: UnlockSheet | null = null;

/** True while the sheet is up (or its ad is playing): not a moment to reload for a new version. */
export const unlockOpen = () => open !== null;

/**
 * Toss mini app: the sheet that opens a locked 멍 with a rewarded ad. It floats over whatever is on screen
 * (home or a scene), so 다음에 leaves everything as it was. Watching to the end opens the 멍 until midnight and
 * goes straight in; no ad to show opens it anyway; closing the ad early keeps it locked.
 */
export function offerUnlock(root: HTMLElement, group: GroupId, here: SceneId | null) {
  if (open?.group === group) return;
  open?.close();
  open = new UnlockSheet(root, group, here);
}

class UnlockSheet {
  private readonly el: HTMLElement;
  private readonly host: SceneHost;
  private readonly cleanups: (() => void)[] = [];
  private busy = false;
  private closed = false;

  constructor(root: HTMLElement, readonly group: GroupId, here: SceneId | null) {
    const label = GROUPS.find((g) => g.id === group)!.label;
    const card = CARDS.find((c) => c.group === group)!;
    const s = settings();
    const scene: SceneId = group === 'water' ? s.water : group === 'snow' ? s.snow : group === 'subway' ? s.subway : card.scene;
    const inFire = here !== null && groupOf(here) === FREE_GROUP;

    this.el = document.createElement('div');
    this.el.className = `unlock theme-${group}`;
    this.el.innerHTML = `
      <div class="scrim" data-act="close"></div>
      <div class="sheet glass-strong unlock-sheet" role="dialog" aria-modal="true" aria-labelledby="unlock-title">
        <div class="grab"></div>
        <div class="unlock-thumb">
          <canvas class="scene" aria-hidden="true"></canvas>
          <span class="label">${EQ}${card.sub}</span>
        </div>
        <div class="sheet-head">
          <h3 id="unlock-title">${label} 열기</h3>
          <button class="icon-btn" data-act="close" aria-label="닫기">${icon('x')}</button>
        </div>
        <p class="sub">짧은 광고를 끝까지 보면 ${label}이 열려요.</p>
        <p class="unlock-note" role="status" hidden>${icon('info')}광고를 끝까지 봐야 ${label}이 열려요</p>
        <ul class="unlock-facts">
          <li>${icon('timer')}<span><b>오늘 밤 12시까지</b> 열려 있어요</span></li>
          <li>${icon('mute')}<span>광고가 나오는 동안 소리는 잠시 멈춰요</span></li>
          ${inFire ? '' : `<li>${icon('flame')}<span>불멍은 광고 없이 언제든 볼 수 있어요</span></li>`}
        </ul>
        <button class="btn-block unlock-go" data-act="watch"></button>
        <button class="btn-ghost" data-act="close">다음에</button>
      </div>`;
    root.append(this.el);
    this.setButton('ready', '광고 보고 열기');

    this.host = new SceneHost(this.el.querySelector('canvas')!, createScene(scene, 'card', s));
    this.on(this.el, 'click', (e) => {
      const act = (e.target as Element).closest<HTMLElement>('[data-act]')?.dataset.act;
      if (act === 'close' && !this.busy) this.close();
      else if (act === 'watch') void this.watch(label);
    });
    // the scene underneath keeps its own shortcuts to itself while the sheet is up
    this.on(window, 'keydown', (e) => {
      e.stopImmediatePropagation();
      if ((e as KeyboardEvent).key === 'Escape' && !this.busy) this.close();
    }, true);
    // the Android back button (or any other move) takes the sheet away with it
    this.on(window, 'hashchange', () => this.close());

    preloadAd();
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.add('sheet-open')));
  }

  private on(target: EventTarget, type: string, fn: (e: Event) => void, capture = false) {
    target.addEventListener(type, fn, capture);
    this.cleanups.push(() => target.removeEventListener(type, fn, capture));
  }

  private setButton(look: 'ready' | 'waiting', text: string) {
    const b = this.el.querySelector<HTMLButtonElement>('[data-act="watch"]')!;
    b.classList.toggle('waiting', look === 'waiting');
    b.innerHTML = look === 'waiting' ? `<span class="spin" aria-hidden="true"></span>${text}` : `${icon('play')}${text}`;
  }

  private async watch(label: string) {
    if (this.busy) return;
    this.busy = true;
    audio.unlock(); // this tap is the gesture that lets the 멍's sound start afterwards
    if (!adReady()) this.setButton('waiting', '광고 불러오는 중');
    // Toss asks apps to go quiet while an ad plays
    const result = await watchAd(() => audio.suspend());
    audio.resume();
    if (open !== this) return; // closed while waiting (a move elsewhere)

    if (result === 'closed') {
      this.busy = false;
      this.el.querySelector<HTMLElement>('.unlock-note')!.hidden = false;
      this.setButton('ready', '광고 다시 보기');
      return;
    }
    // watched to the end, or there was no ad to show: either way the visitor goes in
    unlock(this.group);
    arrival = result === 'rewarded' ? `${label}이 열렸어요 · 오늘 밤 12시까지` : '지금은 광고가 없어서 그냥 열었어요';
    this.close();
    location.hash = groupRoute(this.group);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    if (open === this) open = null;
    for (const fn of this.cleanups) fn();
    this.host.destroy();
    this.el.classList.remove('sheet-open');
    this.el.style.pointerEvents = 'none';
    window.setTimeout(() => this.el.remove(), 450);
  }
}
