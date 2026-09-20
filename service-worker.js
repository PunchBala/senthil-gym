const CACHE_NAME = "senthil-gym-v8";
const ASSETS = ["./", "./index.html", "./manifest.json", "./icon.svg", "./backup.mjs", "./backup-schema.mjs", "./github-backup.mjs"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(key => key.startsWith("senthil-gym-") && key !== CACHE_NAME).map(key => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", event => {
  // Private backup responses must never enter the app's offline cache.
  if (new URL(event.request.url).origin !== self.location.origin || event.request.headers.has('Authorization')) return;
  if (event.request.method !== "GET") return;
  if (event.request.mode === "navigate" && new URL(event.request.url).origin === self.location.origin) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" }).then(response => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put("./index.html", copy)));
          return response;
        }
        return caches.match("./index.html").then(cached => cached || response);
      }).catch(() => caches.match("./index.html"))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).catch(() => caches.match("./index.html"))
    )
  );
});
