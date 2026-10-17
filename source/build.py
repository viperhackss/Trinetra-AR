#!/usr/bin/env python3
"""Build Kite HUD Lab.

Outputs:
  kite-hud-lab.html  the claude.ai artifact page (three.js from the jsDelivr CDN)
  site/              the self-contained static site (GitHub Pages / Netlify): vendored three.js, assets,
                     web app manifest, icons and an offline service worker
  test/              same as site/ plus a debug hook for the headless tests
"""
import glob, hashlib, json, os, shutil, subprocess
K = os.path.dirname(os.path.abspath(__file__))
head = open(f'{K}/src/00_head.html').read()
js = ''.join(open(f).read() for f in sorted(glob.glob(f'{K}/src/js/*.js')))
CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/'
im = lambda core, addons: '<script type="importmap">{"imports":{"three":"%s","three/addons/":"%s"}}</script>\n' % (core, addons)
IM_CDN = im(CDN + 'build/three.module.js', CDN + 'examples/jsm/')
IM_LOCAL = im('./vendor/three.module.js', './vendor/jsm/')
open(f'{K}/kite-hud-lab.html', 'w').write(head + IM_CDN + '<script type="module">\n' + js + '</script>\n')

WRAP_TOP = ('<!doctype html>\n<html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
            '<meta name="theme-color" content="#090d10"><meta name="mobile-web-app-capable" content="yes">'
            '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">'
            '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="icon-192.png"><link rel="apple-touch-icon" href="icon-192.png">'
            '<style>html,body{margin:0;background:#090d10}[hidden]{display:none!important}</style></head><body>\n')
HOOK = 'window.__kite = { SkeletonUtils, rtDrone, droneQuad, droneCam, state, settings, player, renderer, scene, camera, rtScene, rtThermal, postMat, postScene, postCam, THREE, eyes: () => eyes, drone, D, MATES, KITES, perf, applyQuality, applySky, skyInfo, sun, setThermal, Q, SOLDIER: () => SOLDIER, setNight, setVision, toggleSetting, captureSatellite, sat, FOLD, resizeAll, GPU, dust };\n'
SW_REG = "<script>if ('serviceWorker' in navigator && location.protocol === 'https:') addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));</script>\n"
ADDONS = ['loaders/GLTFLoader.js', 'utils/BufferGeometryUtils.js', 'utils/SkeletonUtils.js', 'geometries/RoundedBoxGeometry.js', 'environments/RoomEnvironment.js', 'objects/Sky.js']
SRC3 = f'{K}/test/three-src'
MANIFEST = {
  'name': 'Trinetra AR', 'short_name': 'Trinetra', 'description': 'Helmet HUD simulator: compass ring, minimap, drone feed, vision modes, teammates and pings.',
  'start_url': './', 'scope': './', 'display': 'fullscreen', 'orientation': 'any', 'background_color': '#090d10', 'theme_color': '#090d10',
  'icons': [{'src': 'icon-192.png', 'sizes': '192x192', 'type': 'image/png'}, {'src': 'icon-512.png', 'sizes': '512x512', 'type': 'image/png'},
            {'src': 'icon-512-maskable.png', 'sizes': '512x512', 'type': 'image/png', 'purpose': 'maskable'}],
}
for d, hook, pwa in ((f'{K}/site', '', True), (f'{K}/test', HOOK, False)):
    os.makedirs(f'{d}/vendor/jsm', exist_ok=True)
    shutil.copy(f'{SRC3}/build/three.module.js', f'{d}/vendor/three.module.js')
    for a in ADDONS:
        os.makedirs(os.path.dirname(f'{d}/vendor/jsm/{a}'), exist_ok=True); shutil.copy(f'{SRC3}/examples/jsm/{a}', f'{d}/vendor/jsm/{a}')
    shutil.copy(f'{SRC3}/LICENSE', f'{d}/vendor/THREE-LICENSE.txt')
    shutil.rmtree(f'{d}/assets', ignore_errors=True); shutil.copytree(f'{K}/assets', f'{d}/assets')
    for f in glob.glob(f'{K}/pwa/*.png'): shutil.copy(f, d)
    page = WRAP_TOP + head + IM_LOCAL + '<script type="module">\n' + js + hook + '</script>\n' + (SW_REG if pwa else '') + '</body></html>\n'
    open(f'{d}/index.html', 'w').write(page)
    if pwa:
        open(f'{d}/manifest.webmanifest', 'w').write(json.dumps(MANIFEST, indent=2))
        files = ['./', './index.html', './manifest.webmanifest', './vendor/three.module.js'] + [f'./vendor/jsm/{a}' for a in ADDONS] + \
                [f'./assets/{os.path.basename(f)}' for f in sorted(glob.glob(f'{K}/assets/*'))] + ['./icon-192.png', './icon-512.png']
        ver = hashlib.sha1(page.encode()).hexdigest()[:10]
        sw = f"""// Offline cache for Trinetra AR. A new build changes the cache name, so phones pick up updates.
const CACHE = 'trinetra-{ver}';
const CORE = {json.dumps(files)};
self.addEventListener('install', (e) => {{ e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())); }});
self.addEventListener('activate', (e) => {{ e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); }});
self.addEventListener('fetch', (e) => {{
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {{
    e.respondWith(fetch(e.request).then((r) => {{ const cp = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return r; }}).catch(() => caches.match(e.request).then((r) => r || caches.match('./index.html'))));
    return;
  }}
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {{ const cp = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, cp)); return res; }})));
}});
"""
        open(f'{d}/sw.js', 'w').write(sw)
        open(f'{d}/.nojekyll', 'w').write('')
open(f'{K}/test/check.mjs', 'w').write(js)
r = subprocess.run(['node', '--check', f'{K}/test/check.mjs'], capture_output=True, text=True)
print('syntax ok' if r.returncode == 0 else r.stderr[:3000])
print(os.path.getsize(f'{K}/kite-hud-lab.html'), 'bytes')
