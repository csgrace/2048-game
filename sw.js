const CACHE_NAME = '2048-game-v6';
// Keep installation light on mobile; album tracks load only when a user plays them.
const ASSETS = [
  './',
  './index.html',
  './js/ai-brain.js',
  './js/ai-trainer-worker.js',
  './manifest.json'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Media controls request byte ranges for duration, seeking, and playback.
  // Cached full-file responses cannot satisfy those partial-content requests.
  if (event.request.headers.has('range')) {
    event.respondWith(fetch(event.request));
    return;
  }
  
  event.respondWith(
    caches.match(event.request).then(cached => {
      const fetched = fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(() => cached);
      
      return cached || fetched;
    })
  );
});
