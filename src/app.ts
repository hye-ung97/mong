import { audio } from './audio/engine';
import { keepAwake } from './lib/device';
import { save, settings } from './lib/settings';
import { timer } from './lib/timer';
import { isWater, routeOf, type SceneId, type WaterId } from './scenes/registry';
import { HomeView } from './views/home-view';
import { SceneView } from './views/scene-view';
import type { View } from './views/view';

type Route = { view: 'home' } | { view: 'scene'; id: SceneId };

const WATER_IDS: readonly WaterId[] = ['aquarium', 'sea', 'pond'];

/** #/  ·  #/fire  ·  #/rain  ·  #/water (last used)  ·  #/water/aquarium|sea|pond */
function parse(hash: string): Route {
  const [first, second] = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (first === 'fire' || first === 'rain') return { view: 'scene', id: first };
  if (first === 'water') {
    const sub = WATER_IDS.find((w) => w === second) ?? settings().water;
    return { view: 'scene', id: sub };
  }
  return { view: 'home' };
}

export function startApp(root: HTMLElement) {
  let current: View | null = null;
  let currentKey = '';

  const render = () => {
    const route = parse(location.hash);
    if (route.view === 'scene') {
      const canonical = routeOf(route.id);
      if (location.hash !== canonical) history.replaceState(null, '', canonical);
      if (isWater(route.id)) save({ water: route.id });
    }
    const key = route.view === 'home' ? 'home' : route.id;
    if (key === currentKey) return;
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
  };

  window.addEventListener('hashchange', render);
  // any first touch or key press is enough to allow sound
  window.addEventListener('pointerdown', () => audio.unlock(), { capture: true });
  window.addEventListener('keydown', () => audio.unlock(), { capture: true });
  render();
}
