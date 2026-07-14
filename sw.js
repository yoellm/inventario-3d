const CACHE_PREFIX = 'mundo-azul-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v23`;
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './styles.css',
  './logo.png',
  './app-icon.svg',
  './app-icon-192.png',
  './app-icon-512.png',
  './app-icon-maskable-512.png',
  './apple-touch-icon.png',
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
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

async function networkFirst(request, fallbackUrl = '') {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (fallbackUrl) {
      const fallback = await cache.match(fallbackUrl);
      if (fallback) return fallback;
    }
    throw error;
  }
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, './offline.html'));
    return;
  }

  event.respondWith(networkFirst(request));
});
