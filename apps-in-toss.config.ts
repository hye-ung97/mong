import { defineConfig } from '@apps-in-toss/web-framework/config';

/** Packaging for the Toss mini app (`npm run build:ait` → mong-time.ait). `appName` must match the console. */
export default defineConfig({
  appName: 'mong-time',
  webBundleDir: 'dist',
  permissions: [],
  navigationBar: { theme: 'dark' },
  webView: {
    allowsInlineMediaPlayback: true,
    bounces: false,
    pullToRefreshEnabled: false,
  },
});
