import type { GroupId } from '../scenes/registry';
import { save, settings } from './settings';

/**
 * Rewarded ads inside the Toss mini app: 불멍 is always open, and every other 멍 opens for the rest of the day
 * once the visitor has watched one ad to the end.
 *
 * Only inside Toss. The website, the installed web app and Toss apps too old for full-screen ads have no ads at
 * all: nothing is locked there and the ad SDK is never loaded.
 */

/** Toss's test ad group for rewarded ads. Before release, swap in the rewarded ad group id from the console. */
const REWARDED_AD_GROUP_ID = 'ait-ad-test-rewarded-id';

/** The 멍 that never needs an ad. */
export const FREE_GROUP: GroupId = 'fire';

/** How long the button waits for an ad that has not loaded yet before letting the visitor in anyway. */
const WAIT_MS = 5000;

/**
 * True inside a Toss app that can show full-screen ads. The Toss app hands the page its capabilities before any
 * script runs, and the SDK's own `isSupported()` reads the same two flags, so this is known on the first screen
 * without loading the SDK. On the website the flags are missing (the SDK's check would throw there).
 */
export function rewardsOn(): boolean {
  try {
    const c = (window as { __appsInTossConstants?: Record<string, unknown> }).__appsInTossConstants;
    return Boolean(c?.isLoadFullScreenAdSupported && c?.isShowFullScreenAdSupported);
  } catch {
    return false;
  }
}

/** Local date, e.g. 2026-11-17: an unlock lasts until midnight on this phone. */
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whether this 멍 needs an ad before it opens. Always false outside Toss. */
export function isLocked(group: GroupId): boolean {
  return group !== FREE_GROUP && rewardsOn() && settings().unlocked[group] !== today();
}

/** Opens this 멍 until midnight. */
export function unlock(group: GroupId) {
  save({ unlocked: { ...settings().unlocked, [group]: today() } });
}

export const anyLocked = (groups: readonly GroupId[]) => groups.some(isLocked);

/* ---------- the ad itself ---------- */

type Sdk = Pick<typeof import('@apps-in-toss/web-framework'), 'loadFullScreenAd' | 'showFullScreenAd'>;

let sdkReady: Promise<Sdk | null> | null = null;

/** Loads the SDK once, only inside Toss. Null where full-screen ads cannot be shown after all. */
function sdk(): Promise<Sdk | null> {
  if (!rewardsOn()) return Promise.resolve(null);
  sdkReady ??= import('@apps-in-toss/web-framework')
    .then((m) => (m.loadFullScreenAd.isSupported() && m.showFullScreenAd.isSupported() ? m : null))
    .catch(() => null);
  return sdkReady;
}

/** One ad at a time: Toss keeps a single preloaded ad per ad group. */
let state: 'idle' | 'loading' | 'ready' = 'idle';
/** Ends the load subscription. Kept until the loaded ad has been shown, in case ending it drops the ad. */
let endLoad: (() => void) | null = null;
const settled = new Set<() => void>();

function setState(next: typeof state) {
  state = next;
  if (next === 'loading') return;
  for (const fn of [...settled]) fn();
}

/** Starts loading an ad in the background, so the button can show it right away. Does nothing outside Toss. */
export function preloadAd() {
  if (state !== 'idle' || !rewardsOn()) return;
  state = 'loading';
  void sdk().then((m) => {
    if (!m) return setState('idle');
    let over = false;
    const done = (ok: boolean) => {
      if (over) return;
      over = true;
      if (!ok) {
        endLoad?.();
        endLoad = null;
      }
      setState(ok ? 'ready' : 'idle');
    };
    try {
      const stop = m.loadFullScreenAd({
        options: { adGroupId: REWARDED_AD_GROUP_ID },
        onEvent: (e) => { if (e.type === 'loaded') done(true); },
        onError: () => done(false),
      });
      if (over && state !== 'ready') stop();
      else endLoad = stop;
    } catch {
      done(false);
    }
  });
}

/** True once an ad is loaded; false if loading failed or took longer than `ms`. */
function whenReady(ms: number): Promise<boolean> {
  if (state === 'ready') return Promise.resolve(true);
  preloadAd();
  if (state !== 'loading') return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = () => {
      settled.delete(finish);
      window.clearTimeout(timer);
      resolve(state === 'ready');
    };
    const timer = window.setTimeout(finish, ms);
    settled.add(finish);
  });
}

export const adReady = () => state === 'ready';

/**
 * - `rewarded`: watched to the end (Toss sent `userEarnedReward`). The only result that earns the reward.
 * - `closed`: closed before the end.
 * - `unavailable`: no ad to show (none in stock, offline, ad tracking off on iOS, the SDK refused).
 */
export type AdResult = 'rewarded' | 'closed' | 'unavailable';

/**
 * Shows a rewarded ad, waiting up to 5 seconds for one that is still loading.
 * `onShow` runs just before the ad covers the app, to pause the app's sound; the caller resumes it afterwards.
 */
export async function watchAd(onShow: () => void): Promise<AdResult> {
  const m = await sdk();
  if (!m || !(await whenReady(WAIT_MS))) return 'unavailable';

  // this ad is used up: the next one starts loading as soon as this one is over
  state = 'idle';
  const loadSub = endLoad;
  endLoad = null;

  return new Promise<AdResult>((resolve) => {
    let earned = false;
    let over = false;
    let stop: (() => void) | null = null;
    // Some Android Toss app versions never send `dismissed`. A touch on the page means the ad is gone.
    const touchedPage = () => finish(earned ? 'rewarded' : 'closed');
    const finish = (result: AdResult) => {
      if (over) return;
      over = true;
      window.removeEventListener('pointerdown', touchedPage, true);
      stop?.();
      loadSub?.();
      resolve(result);
      preloadAd();
    };
    onShow();
    try {
      stop = m.showFullScreenAd({
        options: { adGroupId: REWARDED_AD_GROUP_ID },
        onEvent: (e) => {
          switch (e.type) {
            case 'show':
              window.addEventListener('pointerdown', touchedPage, true);
              break;
            case 'userEarnedReward':
              earned = true;
              break;
            case 'dismissed':
              finish(earned ? 'rewarded' : 'closed');
              break;
            case 'failedToShow':
              finish(earned ? 'rewarded' : 'unavailable');
              break;
          }
        },
        onError: () => finish(earned ? 'rewarded' : 'unavailable'),
      });
      if (over) stop();
    } catch {
      finish('unavailable');
    }
  });
}
