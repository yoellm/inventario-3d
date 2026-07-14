const CACHE_NAME = 'mundo-azul-shell-v20';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './logo.png',
  './app-icon.svg',
  './scanner.html',
  './gastos.html',
  './logs.html',
  './estadisticas.html',
  './stock.html',
  './novedades.html',
  './ventas-propias.html',
  './catalogo.html',
  './finanzas.css',
  './pages-modern.css',
  './analytics-modern.css',
  './operations-modern.css',
  './theme-dark.css',
  './catalogo.css',
  './index.js',
  './gastos.js',
  './scanner.js',
  './logs.js',
  './estadisticas.js',
  './stock.js',
  './novedades.js',
  './ventas-propias.js',
  './catalogo.js',
  './pwa-register.js',
  './firebase-config.js',
  './app-bootstrap.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then(cached => cached || caches.match('./index.html')))
  );
});
