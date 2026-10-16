/* かなでる：オフラインでも開けるようにアプリ本体をキャッシュ（ネット優先） */
const CACHE = 'kanaderu-v1';
const ASSETS = [
  './', 'index.html', 'css/daw.css', 'manifest.webmanifest',
  'js/app.js', 'js/ui.js', 'js/store.js', 'js/player.js', 'js/worker.js', 'js/mp3worker.js', 'js/templates.js',
  'js/arrange.js', 'js/roll.js', 'js/panels.js', 'js/mixer.js', 'js/scope.js', 'js/sfxstudio.js',
  'js/engine/dsp.js', 'js/engine/fx.js', 'js/engine/instruments.js', 'js/engine/presets.js', 'js/engine/levels.js', 'js/engine/sfx.js',
  'js/engine/song.js', 'js/engine/mix.js', 'js/engine/analyze.js', 'js/engine/viz.js', 'js/engine/wav.js', 'js/engine/validate.js',
  '../lib/lame.min.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kanaderu-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
