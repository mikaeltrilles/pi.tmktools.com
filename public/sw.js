/* ════════════════════════════════════════════════════════════════════════════
   Pi — Service worker (installation de l'application, fonctionnement hors ligne
   de la coquille, mises à jour proposées à l'utilisateur comme sur phi).
   Le contenu vivant (flux SSE, API, fichiers π) n'est jamais mis en cache.
   ════════════════════════════════════════════════════════════════════════════ */
const VERSION = 'pi-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const SHELL = [
  '/',
  '/index.html',
  '/status.html',
  '/styles.css',
  '/app.js',
  '/theme-init.js',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/fonts/space-grotesk-latin.woff2',
  '/fonts/jetbrains-mono-latin.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
];

/* Routes vivantes : toujours le réseau, jamais de cache. */
const LIVE = [
  /^\/stream-continuous/,
  /^\/continuous-state/,
  /^\/stats/,
  /^\/snapshots?\b/,
  /^\/complet/,
  /^\/digit/,
  /^\/digits-around/,
  /^\/search-chain/,
  /^\/refresh-file/,
  /^\/api\//,
  /^\/stored/,
  /^\/save/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL)),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
    ),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (LIVE.some((re) => re.test(url.pathname))) return; // réseau pur

  // Pages : réseau d'abord, coquille en cache en secours (hors ligne)
  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html'))),
    );
    return;
  }

  // Ressources statiques : cache d'abord, revalidation en arrière-plan
  event.respondWith(
    caches.match(request).then((hit) => {
      const refresh = fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(ASSET_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => hit);
      return hit || refresh;
    }),
  );
});
