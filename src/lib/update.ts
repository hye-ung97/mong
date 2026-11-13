/* The service worker fetches a new version in the background and takes over as soon as it is ready
   (vite.config.ts). The page that is already open was drawn by the old code, though, so it has to
   reload to show the new one. It does so by itself, but never in the middle of 멍. */

const LEAVE_FADE = 1600; // ms: a scene's sound takes 1.4 s to fade out when the visitor goes home

/**
 * Reload once a new version has taken over, unless `busy()` says the visitor is in the middle of something.
 * A reload that had to wait is tried again every time the screen changes (going back home, for one).
 */
export function showNewVersions(busy: () => boolean) {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // No worker in charge of this page: a first visit (the worker about to take over is this same version),
  // a hard reload, or the dev server. Nothing newer can arrive without a visit that starts under a worker.
  if (!sw.controller) return;
  let ready = false;
  let reloading = false;
  const reloadIfFree = () => {
    if (!ready || reloading || busy()) return;
    reloading = true;
    location.reload();
  };
  sw.addEventListener('controllerchange', () => {
    ready = true;
    reloadIfFree();
  });
  window.addEventListener('hashchange', () => window.setTimeout(reloadIfFree, LEAVE_FADE));
}
