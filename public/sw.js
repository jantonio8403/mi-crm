const CACHE = 'agora-v4';

// Recursos estáticos que se cachean al instalar
const PRECACHE = [
  '/img/favicon.svg',
  '/img/icon-192.svg',
  '/img/icon-512.svg',
  '/manifest.json',
];

// ── Instalación: pre-cachear recursos estáticos ───────────────────
self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    })
  );
  self.skipWaiting();
});

// ── Activación: limpiar cachés viejas ─────────────────────────────
self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    })
  );
  self.clients.claim();
});

// ── Fetch: estrategia por tipo de recurso ─────────────────────────
self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);

  // Solo interceptar peticiones al mismo origen
  if (url.origin !== location.origin) return;

  // Archivos estáticos → cache-first
  if (/\.(css|js|svg|png|jpg|jpeg|webp|woff2?|ico)$/i.test(url.pathname)) {
    e.respondWith(cacheFirst(req));
    return;
  }

  // Páginas HTML → network-first, con fallback a caché
  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(req));
    return;
  }

  // Resto → network normal
});

function cacheFirst(req) {
  return caches.match(req).then(function (cached) {
    return cached || fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var clone = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, clone); });
      }
      return res;
    });
  });
}

function networkFirst(req) {
  return fetch(req)
    .then(function (res) {
      if (res && res.status === 200) {
        var clone = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, clone); });
      }
      return res;
    })
    .catch(function () {
      return caches.match(req).then(function (cached) {
        return cached || offlinePage();
      });
    });
}

function offlinePage() {
  return new Response(
    '<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Sin conexión — AGORA</title>' +
    '<style>body{font-family:Arial,sans-serif;display:flex;flex-direction:column;align-items:center;' +
    'justify-content:center;min-height:100vh;margin:0;background:#f9fafb;color:#111;text-align:center;padding:32px}' +
    '.ico{width:64px;height:64px;background:#1a7a4a;border-radius:16px;display:flex;align-items:center;' +
    'justify-content:center;font-size:36px;font-weight:900;color:#fff;margin:0 auto 20px}' +
    'h1{font-size:20px;font-weight:700;color:#0b3320;margin-bottom:8px}' +
    'p{font-size:14px;color:#6b7280;margin-bottom:24px}' +
    'button{padding:12px 24px;background:#1a7a4a;color:#fff;border:none;border-radius:8px;' +
    'font-size:15px;font-weight:700;cursor:pointer}</style></head><body>' +
    '<div class="ico">A</div>' +
    '<h1>Sin conexión</h1>' +
    '<p>Verifica tu conexión a internet e intenta de nuevo.</p>' +
    '<button onclick="location.reload()">Reintentar</button>' +
    '</body></html>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}
