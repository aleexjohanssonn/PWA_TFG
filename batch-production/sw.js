/* Scope and cache are exclusive to this version. Bump RELEASE for asset changes. */
const RELEASE = 'v1.2';
const CACHE_PREFIX = 'pwa-tfg-batch:' + self.registration.scope + ':';
const CACHE = CACHE_PREFIX + RELEASE;
const APP = ['./', './index.html', './styles.css', './core.js', './app.js', './manifest.json', './icon-192.png', './icon-512.png', './fonts/nunito-latin.woff2'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(APP)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(event.request);
    if (cached) return cached;
    try { return await fetch(event.request); }
    catch (error) { if (event.request.mode === 'navigate') return cache.match('./index.html'); throw error; }
  }));
});
