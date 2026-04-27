// Service Worker - daxigua 자산 인터셉트 → admin이 업로드한 이미지로 교체
const CACHE_NAME = 'swg-asset-overrides-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // res/raw-assets 폴더의 PNG/JPG만 가로챔
  if (/\/res\/raw-assets\/.*\.(png|jpg|jpeg)$/i.test(url.pathname)) {
    event.respondWith(handleAsset(event.request, url));
  }
});

async function handleAsset(request, url) {
  try {
    const cache = await caches.open(CACHE_NAME);
    // pathname 기준 매칭 (decode 일관성)
    const key = decodeURIComponent(url.pathname);
    const override = await cache.match(key);
    if (override) {
      // 새 응답으로 복제 (cocos2d가 헤더 일부 요구할 수 있음)
      const blob = await override.blob();
      return new Response(blob, {
        status: 200,
        headers: { 'Content-Type': blob.type || 'image/png', 'Cache-Control': 'no-cache' }
      });
    }
  } catch (e) {
    // 캐시 조회 실패 시 원본으로 폴백
  }
  return fetch(request);
}

// admin 페이지로부터 메시지 수신 (이미지 등록/삭제/전체삭제)
self.addEventListener('message', async (event) => {
  const data = event.data || {};
  const cache = await caches.open(CACHE_NAME);
  if (data.type === 'set' && data.path && data.dataUrl) {
    const blob = await (await fetch(data.dataUrl)).blob();
    await cache.put(data.path, new Response(blob, { headers: { 'Content-Type': blob.type || 'image/png' } }));
    event.ports[0]?.postMessage({ ok: true });
  } else if (data.type === 'delete' && data.path) {
    await cache.delete(data.path);
    event.ports[0]?.postMessage({ ok: true });
  } else if (data.type === 'reset') {
    await caches.delete(CACHE_NAME);
    event.ports[0]?.postMessage({ ok: true });
  } else if (data.type === 'list') {
    const keys = await cache.keys();
    event.ports[0]?.postMessage({ ok: true, paths: keys.map(r => new URL(r.url).pathname) });
  }
});
