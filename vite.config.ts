import { readdirSync } from 'node:fs';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Every recording, e.g. "sounds/fire/bed.m4a" — the installed app downloads these in the background (src/lib/offline.ts). */
const soundFiles = readdirSync('public/sounds', { recursive: true, encoding: 'utf8' })
  .filter((f) => /\.(m4a|mp3)$/.test(f))
  .map((f) => `sounds/${f.replaceAll('\\', '/')}`)
  .sort();

export default defineConfig({
  define: { __SOUND_FILES__: JSON.stringify(soundFiles) },
  plugins: [
    VitePWA({
      // A new version installs in the background and takes over on the next visit,
      // so nobody gets reloaded in the middle of 멍.
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'mong · 멍때리기 좋은 곳',
        short_name: 'mong',
        description: '불멍, 비멍, 물멍. 소리를 켜고 아무 생각 없이 바라보는 곳.',
        lang: 'ko',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'any',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell is precached. Recordings (19MB) are not: each one is kept the first time it plays,
        // and the installed app fetches the rest in the background (src/lib/offline.ts).
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.includes('/sounds/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'mong-sounds',
              expiration: { maxEntries: 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            // Pretendard stylesheet + font subsets
            urlPattern: ({ url }) => url.origin === 'https://cdn.jsdelivr.net',
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'mong-fonts',
              expiration: { maxEntries: 120 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
});
