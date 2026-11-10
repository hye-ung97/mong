/* Screen wake lock and fullscreen — both optional; quietly do nothing where unsupported. */

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire() {
  if (!wanted || sentinel || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    sentinel = null; // denied (battery saver, iframe...) — the screen may sleep
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void acquire();
});

/** Keep the screen on while a scene is showing. */
export function keepAwake(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else if (sentinel) {
    void sentinel.release();
    sentinel = null;
  }
}

export const canFullscreen = () => Boolean(document.fullscreenEnabled);
export const isFullscreen = () => Boolean(document.fullscreenElement);

export function toggleFullscreen() {
  if (!canFullscreen()) return;
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}
