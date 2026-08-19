const CACHE_NAME = '2048-game-v4';
const ASSETS = [
  './',
  './index.html',
  './js/ai-brain.js',
  './js/ai-trainer-worker.js',
  './manifest.json',
  './music_bgm/Our%20Song.mp3',
  './music_bgm/Fearless.mp3',
  './music_bgm/Speak%20now.mp3',
  './music_bgm/Red.mp3',
  './music_bgm/Clean.mp3',
  './music_bgm/Delicate.mp3',
  './music_bgm/Lover.mp3',
  './music_bgm/the%201.mp3',
  './music_bgm/evermore.mp3',
  './music_bgm/Midnight%20Rain.mp3',
  './music_bgm/Fortnight.mp3',
  './music_bgm/Opalite.mp3',
  './music_bgm/StockTune-Echoes%20Of%20Silent%20Joy_1787127499.mp3'
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
