import { audio } from './audio/engine';
import { anyLocked, isLocked, preloadAd } from './lib/ads';
import { keepAwake } from './lib/device';
import { save, settings } from './lib/settings';
import { timer } from './lib/timer';
import { showNewVersions } from './lib/update';
import { GROUPS, SNOW, groupOf, isSnow, isWater, routeOf, type GroupId, type SceneId, type WaterId } from './scenes/registry';
import { HomeView } from './views/home-view';
import { SceneView } from './views/scene-view';
import { offerUnlock, unlockOpen } from './views/unlock-sheet';
import type { View } from './views/view';

type Route = { view: 'home' } | { view: 'scene'; id: SceneId };

const WATER_IDS: readonly WaterId[] = ['aquarium', 'sea', 'pond'];
const GROUP_IDS = GROUPS.map((g) => g.id);

/** #/  ·  #/fire  ·  #/rain  ·  #/water (last used)  ·  #/water/aquarium|sea|pond  ·  #/sand  ·  #/star  ·  #/snow (last used)  ·  #/snow/clocktower|underfoot */
function parse(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (first === 'fire' || first === 'rain' || first === 'sand' || first === 'star') return { view: 'scene', id: first };
  if (first === 'water') {
    const sub = WATER_IDS.find((w) => w === second) ?? settings().water;
    return { view: 'scene', id: sub };
  }
  if (first === 'snow') {
    const sub = SNOW.find((s) => s.id === second)?.id ?? settings().snow;
    return { view: 'scene', id: sub };
  }
  return { view: 'home' };
}

export function startApp(root: HTMLElement) {
  let current: View | null = null;
  let currentKey = '';
  /** The scene on screen, or null on home (and before the first screen). */
  const hereScene = () => (currentKey === '' || currentKey === 'home' ? null : (currentKey as SceneId));

  const render = () => {
    let route = parse(location.hash);
    // Toss mini app: a locked 멍 reached without a tap on its link (a feature link from Toss, a shortcut key,
    // back/forward into yesterday's 멍) keeps the current screen, or home on arrival, with the unlock sheet on top
    let offer: GroupId | null = null;
    if (route.view === 'scene' && isLocked(groupOf(route.id))) {
      offer = groupOf(route.id);
      const here = hereScene();
      history.replaceState(null, '', here ? routeOf(here) : '#/');
      route = parse(location.hash);
    }
    if (route.view === 'scene') {
      const canonical = routeOf(route.id);
      if (location.hash !== canonical) history.replaceState(null, '', canonical);
      if (isWater(route.id)) save({ water: route.id });
      if (isSnow(route.id)) save({ snow: route.id });
    }
    const key = route.view === 'home' ? 'home' : route.id;
    if (key !== currentKey) show(route, key);
    if (offer) offerUnlock(root, offer, hereScene());
  };

  const show = (route: Route, key: string) => {
    currentKey = key;

    // let the old screen fade out underneath the new one
    if (current) {
      const old = current;
      old.destroy();
      old.el.classList.add('leaving');
      window.setTimeout(() => old.el.remove(), 700);
    }

    if (route.view === 'home') {
      audio.stop();
      timer.clear();
      keepAwake(false);
      document.title = 'mong · 멍때리기 좋은 곳';
      current = new HomeView(root);
    } else {
      current = new SceneView(root, route.id);
      document.title = `${current.el.querySelector('.tabs .on')?.textContent ?? 'mong'} · mong`;
    }
    // Toss mini app: have an ad ready before anyone asks for one
    if (anyLocked(GROUP_IDS)) preloadAd();
  };

  // The Toss mini app opens a feature link as a path (intoss://mong-time/fire → /fire); turn it into our hash route.
  if (!location.hash && parse(location.pathname).view === 'scene') {
    history.replaceState(null, '', `/#${location.pathname}`);
  }

  window.addEventListener('hashchange', render);
  // Toss mini app: a tap on a link to a locked 멍 (home cards, scene tabs, the landscape rail) opens the sheet instead
  root.addEventListener('click', (e) => {
    const link = (e.target as Element).closest?.('a[href^="#/"]');
    if (e.defaultPrevented || !link) return;
    const to = parse(link.getAttribute('href')!);
    if (to.view !== 'scene' || !isLocked(groupOf(to.id))) return;
    e.preventDefault();
    offerUnlock(root, groupOf(to.id), hereScene());
  });
  // any first touch or key press is enough to allow sound
  window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
  window.addEventListener('keydown', () => audio.unlock(), { capture: true });
  render();
  // a new version shows up by itself on the home screen, or in a scene whose sound has not been turned on yet,
  // but never while the unlock sheet or its ad is up
  showNewVersions(() => unlockOpen() || (currentKey !== 'home' && audio.ready));
}
