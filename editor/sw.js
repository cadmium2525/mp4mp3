/* つなぐ：オフラインでも開けるようにアプリ本体をキャッシュ（ネット優先） */
const CACHE = 'tsunagu-v5';
const ASSETS = [
  './', 'index.html', 'css/editor.css', 'manifest.webmanifest',
  'js/app.js', 'js/player.js', 'js/timeline.js', 'js/store.js',
  'js/engine/project.js', 'js/engine/render.js', 'js/engine/media.js', 'js/engine/audio.js', 'js/engine/exporter.js', 'js/engine/fx.js', 'js/engine/cutout.js', 'js/engine/warp3d.js', 'js/engine/validate.js', 'js/engine/motionlib.js',
  'lib/motion-prompt/catalog.json', 'lib/motion-prompt/motion.js', 'lib/motion-prompt/camera.js', 'lib/motion-prompt/ui.js', 'lib/motion-prompt/lp.js', 'lib/motion-prompt/photo.js',
  'lib/mediabunny.min.mjs', '../js/mp4.js',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('tsunagu-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const font = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (url.origin !== location.origin && !font) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
