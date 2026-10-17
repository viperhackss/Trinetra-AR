// Offline cache for Trinetra AR. A new build changes the cache name, so phones pick up updates.
const CACHE = 'trinetra-6aa36d6ad1';
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./vendor/three.module.js", "./vendor/jsm/loaders/GLTFLoader.js", "./vendor/jsm/utils/BufferGeometryUtils.js", "./vendor/jsm/utils/SkeletonUtils.js", "./vendor/jsm/geometries/RoundedBoxGeometry.js", "./vendor/jsm/environments/RoomEnvironment.js", "./vendor/jsm/objects/Sky.js", "./assets/grass_dry.jpg", "./assets/grass_normal.jpg", "./assets/sky_night_exp.png", "./assets/sky_night_rgb.png", "./assets/soldier.gltf.json", "./icon-192.png", "./icon-512.png"];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).then((r) => { const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return res; })));
});
