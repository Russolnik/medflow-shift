const CACHE = 'medflow-shell-v33';
const SHELL = ['./index.html', './styles.css', './app.js', './manifest.webmanifest', './icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async path => {
      try {
        const response = await fetch(path, { cache: 'reload' });
        if (response.ok) await cache.put(path, response);
      } catch (_) {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      const cached = await caches.match('./index.html');
      if (cached?.ok) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok) await (await caches.open(CACHE)).put('./index.html', response.clone());
        return response;
      } catch (_) {
        return cached || new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>MedFlow</title><body style="background:#080b0f;color:#e8eef0;font:16px system-ui;padding:24px"><h1>MedFlow</h1><p>Нет соединения и офлайн-копия ещё не установлена. Открой приложение один раз при интернете.</p></body>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      }
    })());
    return;
  }
  event.respondWith(caches.match(event.request, { ignoreSearch: true }).then(cached => cached || fetch(event.request).then(response => {
    if (response.ok) caches.open(CACHE).then(cache => cache.put(event.request, response.clone()));
    return response;
  }).catch(() => new Response('', { status: 503 }))));
});
