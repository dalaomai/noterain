/// <reference lib="webworker" />
import { cacheNames, clientsClaim } from 'workbox-core';
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  getCacheKeyForURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { SAMPLES_CACHE_NAME } from './constants/offline';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: { url: string; revision?: string | null }[];
};

// Activation waits for the user's update action; never refresh a practice session.
clientsClaim();
const assets = self.__WB_MANIFEST;
precacheAndRoute(assets);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html')));
registerRoute(
  /\/samples\/.*\.mp3$/,
  new CacheFirst({
    cacheName: SAMPLES_CACHE_NAME,
    plugins: [
      new ExpirationPlugin({ maxEntries: 500, maxAgeSeconds: 31536000 }),
    ],
  }),
);
registerRoute(
  /^https:\/\/tonejs\.github\.io\/.*\.mp3$/,
  new CacheFirst({
    cacheName: 'piano-samples',
    plugins: [
      new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 31536000 }),
    ],
  }),
);

let preparing: Promise<void> | null = null;
async function ensureApplicationAssets() {
  if (preparing) return preparing;
  preparing = (async () => {
    const cache = await caches.open(cacheNames.precache);
    // Verify the generated manifest, including lazy-loaded notation code.
    for (const asset of assets) {
      const key = getCacheKeyForURL(asset.url);
      if (!key) throw new Error(`Missing cache key: ${asset.url}`);
      if ((await cache.match(key))?.ok) continue;
      const response = await fetch(new URL(asset.url, self.location.href), {
        cache: 'reload',
      });
      if (!response.ok)
        throw new Error(`Cannot cache ${asset.url}: ${response.status}`);
      await cache.put(key, response);
    }
  })().finally(() => {
    preparing = null;
  });
  return preparing;
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
  } else if (event.data?.type === 'ENSURE_OFFLINE_ASSETS' && event.ports[0]) {
    event.waitUntil(
      ensureApplicationAssets().then(
        () => event.ports[0].postMessage({ ok: true, total: assets.length }),
        (error: unknown) =>
          event.ports[0].postMessage({ ok: false, error: String(error) }),
      ),
    );
  }
});
