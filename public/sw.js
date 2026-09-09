// 현장 네트워크가 불안정해도 화면이 뜨도록 하는 서비스 워커.
// HTML 은 항상 최신을 먼저 받아오고(배포 즉시 반영), 정적 파일만 캐시를 먼저 쓴다.
const CACHE = 'bankqueue-v3';
const ASSETS = [
  '/chime.wav',
  '/silent.wav',
  '/icons/default-192.png',
  '/icons/default-512.png'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .catch(() => {})
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // 실시간 통신은 절대 가로채지 않는다.
  if (url.pathname.startsWith('/socket.io/')) return;

  const isHtml = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');

  if (isHtml) {
    // 최신 화면 우선, 네트워크가 끊기면 캐시된 화면으로
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('/hub.html')))
    );
    return;
  }

  // 소리 파일과 아이콘은 캐시 우선
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && (url.pathname.startsWith('/icons/') || url.pathname.endsWith('.wav'))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      });
    })
  );
});
