// Service worker: lets the installed web app start with no connection.
// Network first (so a new build is picked up straight away), falling back to the last copy saved on the device.
const CACHE = 'tdr-41';
const ASSETS = ["./", "index.html", "style.css", "js/ai.js", "js/campaign.js", "js/entities.js", "js/events.js", "js/game.js", "js/input.js", "js/modes.js", "js/online.js", "js/progress.js", "js/render.js", "js/sound.js", "js/tutorial.js", "js/utils.js", "js/war.js", "js/weapons.js", "js/world.js", "icons/icon-192.png", "icons/icon-512.png", "manifest.webmanifest"];
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(fetch(req).then((res) => { if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'))));
});
