// coi.js — 정적 호스팅(GitHub Pages 등)에서 COOP/COEP 헤더를 서비스워커로 주입해
// SharedArrayBuffer(= WASM 멀티스레드)를 쓸 수 있게 한다. 페이지와 서비스워커 양쪽에서 같은 파일을 쓴다.
// 켜기/끄기는 localStorage 'coi' 값으로 정한다. 켜면 첫 등록 후 한 번 새로고침된다.
/* eslint-disable no-restricted-globals */
if (typeof window === 'undefined') {
  self.addEventListener('install', () => self.skipWaiting());
  self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
  self.addEventListener('message', (e) => { if (e.data && e.data.type === 'deregister') self.registration.unregister().then(() => self.clients.matchAll()).then(cs => cs.forEach(c => c.navigate(c.url))); });
  self.addEventListener('fetch', (e) => {
    const r = e.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    e.respondWith(fetch(r).then((res) => {
      if (res.status === 0) return res; // opaque
      const h = new Headers(res.headers);
      h.set('Cross-Origin-Embedder-Policy', 'require-corp');
      h.set('Cross-Origin-Opener-Policy', 'same-origin');
      h.set('Cross-Origin-Resource-Policy', 'cross-origin');
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
    }).catch((err) => new Response(String(err), { status: 502 })));
  });
} else {
  (async () => {
    const want = localStorage.getItem('coi') === 'on';
    if (!('serviceWorker' in navigator)) { window.COI = { supported: false }; return; }
    const reg = await navigator.serviceWorker.getRegistration();
    window.COI = { supported: true, registered: !!reg, isolated: !!window.crossOriginIsolated };
    if (want && !reg) {
      const n = await navigator.serviceWorker.register('coi.js');
      n.addEventListener('updatefound', () => { const w = n.installing; w && w.addEventListener('statechange', () => { if (w.state === 'activated') location.reload(); }); });
      if (n.active) location.reload();
    } else if (!want && reg) {
      await reg.unregister(); location.reload();
    }
  })();
}
