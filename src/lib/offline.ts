/* Once mong is installed as an app, quietly keep every recording so all scenes have sound offline.
   Plain browser visitors are left alone: they only keep what they have actually played. */

/** Must match the runtime cache name in vite.config.ts — the service worker serves sounds from it. */
const CACHE = 'mong-sounds';

let started = false;

function installed() {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

async function download() {
  if (started || !('caches' in window) || !('serviceWorker' in navigator) || !navigator.onLine) return;
  // without a service worker (dev server) nothing would ever read this cache
  if (!(await navigator.serviceWorker.getRegistration())) return;
  const conn = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (conn?.saveData) return;
  started = true;
  try {
    const cache = await caches.open(CACHE);
    // one at a time, so it never competes with the scene that is playing
    for (const file of __SOUND_FILES__) {
      const url = new URL(import.meta.env.BASE_URL + file, location.href).href;
      if (await cache.match(url)) continue;
      const res = await fetch(url);
      if (res.ok) await cache.put(url, res);
    }
  } catch {
    started = false; // offline or storage full — try again next launch
  }
}

export function keepSoundsOffline() {
  if (installed()) setTimeout(() => void download(), 5000);
  window.addEventListener('appinstalled', () => void download());
}
