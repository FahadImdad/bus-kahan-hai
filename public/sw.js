// Bus Kahan Hai? — minimal service worker.
// Its main job is to make the app installable (PWA) and provide a basic
// offline fallback for the app shell. Live bus data always comes from network.
const CACHE = "bkh-shell-v2";
const SHELL = ["/manifest.webmanifest", "/brand/icon-192.png", "/brand/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  // Never cache the live transit API or cross-origin requests — always network.
  if (url.pathname.startsWith("/api/") || url.origin !== self.location.origin) return;
  // Always prefer the deployed version. Mixing cached JavaScript from an old
  // deployment with new HTML can leave a completely blank application.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put("/", copy)).catch(() => {});
        return response;
      }).catch(() => caches.match("/"))
    );
    return;
  }
  // Assets are network-first so every deployment stays internally consistent.
  event.respondWith(
    fetch(request).then((res) => {
      if (!res.ok) return res;
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => {});
      return res;
    }).catch(() => caches.match(request))
  );
});
