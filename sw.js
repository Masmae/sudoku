// Offline support. Network-first for the app's own files (so updates arrive as soon
// as you're online), falling back to the cached copy when offline. Never touches
// other origins.
const CACHE = "sudoku-trainer-v1";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "icon.svg",
  "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
  "css/style.css",
  "data/bundled.json", "data/technique-bank.json",
  "js/app/main.js", "js/app/dom.js", "js/app/storage.js", "js/app/library.js", "js/app/worker.js",
  "js/app/game.js", "js/app/boardview.js", "js/app/content.js",
  "js/core/index.js", "js/core/geo.js", "js/core/board.js", "js/core/brute.js", "js/core/state.js",
  "js/core/technique.js", "js/core/techniques.js", "js/core/solver.js", "js/core/generator.js",
  "js/core/hint.js", "js/core/drill.js", "js/core/transform.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) ?? (await cache.match("index.html")) ?? Response.error();
    }
  })());
});
