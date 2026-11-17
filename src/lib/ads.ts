/**
 * Banner ads inside the Toss mini app. Anywhere else (the website, an old Toss app) nothing is shown.
 * The SDK is loaded on demand so the website does not pay for it up front.
 */

/** The banner ad group from the console. For a test-only build use Toss's test banner, 'ait-ad-test-banner-id'. */
const BANNER_AD_GROUP_ID = 'ait.v2.live.db347322a59145e2';

type Ads = typeof import('@apps-in-toss/web-framework').TossAds;

let ready: Promise<Ads | null> | null = null;

/** Loads and initializes the ad SDK once. Resolves to null where ads are not supported. */
function ads(): Promise<Ads | null> {
  ready ??= import('@apps-in-toss/web-framework')
    .then(({ TossAds }) => {
      if (!TossAds.initialize.isSupported() || !TossAds.attachBanner.isSupported()) return null;
      return new Promise<Ads | null>((resolve) => {
        TossAds.initialize({
          callbacks: {
            onInitialized: () => resolve(TossAds),
            onInitializationFailed: () => resolve(null),
          },
        });
      });
    })
    .catch(() => null);
  return ready;
}

/**
 * Fills `slot` with a banner once one is available; the slot stays hidden until then and when there is no ad.
 * Returns a function that removes the banner.
 */
export function showBanner(slot: HTMLElement): () => void {
  let gone = false;
  let banner: { destroy: () => void } | null = null;
  slot.hidden = true;

  void ads().then((sdk) => {
    if (!sdk || gone) return;
    slot.hidden = false;
    const hide = () => { slot.hidden = true; };
    banner = sdk.attachBanner(BANNER_AD_GROUP_ID, slot, {
      theme: 'dark',
      callbacks: { onNoFill: hide, onAdFailedToRender: hide },
    });
  });

  return () => {
    gone = true;
    banner?.destroy();
    banner = null;
  };
}
