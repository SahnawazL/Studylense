// StudyLens AI service worker. Pages come from the network first, so updates show
// at once, and from the saved copy when offline. Questions and the admin dashboard
// always go straight to the network.
const CACHE = 'studylens-v1';
const SHELL = ['/', '/icons.js', '/studylens-logo.svg', '/studylens-192.png', '/manifest.webmanifest'];
const LIBRARIES = ['cdnjs.cloudflare.com', 'cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function freshFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const reply = await fetch(request);
    if (reply.ok) cache.put('/', reply.clone());
    return reply;
  } catch {
    return (await cache.match('/')) || Response.error();
  }
}
async function savedFirst(request) {
  const cache = await caches.open(CACHE), saved = await cache.match(request);
  const refresh = fetch(request).then(reply => {
    if (reply.ok || reply.type === 'opaque') cache.put(request, reply.clone());
    return reply;
  }).catch(() => saved || Response.error());
  return saved || refresh;
}

self.addEventListener('fetch', event => {
  const { request } = event, url = new URL(request.url);
  if (request.method !== 'GET') return;
  const own = url.origin === self.location.origin;
  if (own && (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin') || url.pathname === '/sw.js')) return;
  if (own && request.mode === 'navigate') return event.respondWith(freshFirst(request));
  const firebase = url.hostname === 'www.gstatic.com' && url.pathname.startsWith('/firebasejs/');
  if (own || firebase || LIBRARIES.includes(url.hostname)) event.respondWith(savedFirst(request));
});
