// service-worker.js
const CACHE_VERSION = 'v1.0';
const CACHE_NAME    = `migry-${CACHE_VERSION}`;

// Обязательные файлы — без них приложение не запустится
const REQUIRED = [
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './analytics.js',
  './import.js',
  './manifest.json',
];

// Необязательные — кэшируем по возможности, не блокируем установку
const OPTIONAL = [
  'https://fonts.googleapis.com/css2?family=Manrope:wght@300;400;500;600;700;800&display=swap',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
  './icons/migry-192.png',
  './icons/migry-512.png',
  './icons/favicon.ico',
];

// ── INSTALL ──────────────────────────────────────────────────────────────────
// Кэшируем обязательные файлы, опциональные — по возможности
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      // Обязательные
      await cache.addAll(REQUIRED);

      // Опциональные — не блокируем установку при ошибке
      await Promise.allSettled(
        OPTIONAL.map(url =>
          fetch(url)
            .then(r => (r.ok ? cache.put(url, r) : null))
            .catch(() => null)
        )
      );

      // Сразу активируемся без ожидания закрытия старых вкладок
      return self.skipWaiting();
    })
  );
});

// ── ACTIVATE ─────────────────────────────────────────────────────────────────
// Удаляем все старые кэши migry-*, захватываем открытые вкладки
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names =>
        Promise.all(
          names
            .filter(n => n.startsWith('migry-') && n !== CACHE_NAME)
            .map(n => caches.delete(n))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── FETCH — Stale-While-Revalidate ───────────────────────────────────────────
// 1. Отдаём из кэша мгновенно (офлайн работает)
// 2. Параллельно фоново обновляем кэш из сети
// 3. При следующем запуске пользователь видит свежую версию
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Пропускаем chrome-extension и прочий нерелевантный трафик
  const url = new URL(event.request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      const cached = await cache.match(event.request);

      // Фоновое обновление кэша
      const updateCache = fetch(event.request)
        .then(res => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            cache.put(event.request, res.clone());
          }
          return res;
        })
        .catch(() => null);

      if (cached) {
        // Есть кэш — отдаём мгновенно, обновляем в фоне
        event.waitUntil(updateCache);
        return cached;
      }

      // Кэша нет — ждём сеть
      const fresh = await updateCache;
      if (fresh) return fresh;

      // Полный офлайн и нет кэша — возвращаем index.html как fallback
      if (event.request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        return fallback || new Response('Нет соединения', { status: 503 });
      }
    })
  );
});

// ── MESSAGE — ручной skipWaiting из UI при обновлении ───────────────────────
self.addEventListener('message', event => {
  if (event.data?.action === 'skipWaiting') {
    self.skipWaiting();
  }
});