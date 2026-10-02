// On Route app shell service worker.
// Hand-rolled, no Workbox. The cache is populated progressively as the app
// loads: install seeds "/" and "/index.html", then the fetch handler caches
// same-origin assets (hashed JS/CSS bundles) on first fetch.

const SHELL_CACHE = "onrte-shell-v1";
const MAP_CACHE = "onrte-map-v1";
const CACHE_ALLOWLIST = [SHELL_CACHE, MAP_CACHE];
const SHELL_URL = "/index.html";

// Cross-origin hosts that serve map resources (style JSON, vector/raster
// tiles, DEM hillshades, glyphs, sprites and TileJSON). Any path on these
// hosts is a candidate for offline caching.
const MAP_HOSTS = [
  "tiles.openfreemap.org",
  "tiles.mapterhorn.com",
  "tile.ogis.app",
  "raw.githubusercontent.com",
];

// Decide whether a request URL points at a map resource. Matched by hostname
// so every path on the hosts above is covered, whatever the resource type.
const isMapResource = (url) => MAP_HOSTS.includes(url.hostname);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(["/", SHELL_URL]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !CACHE_ALLOWLIST.includes(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Handle messages from the app. Used to purge deleted regions' tiles from the
// map cache so storage is actually freed. Replies to the sender's port with
// the number of URLs successfully deleted.
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type !== "DELETE_URLS" || !Array.isArray(data.urls)) return;

  const port = event.ports && event.ports[0];
  event.waitUntil(
    caches
      .open(MAP_CACHE)
      .then((cache) =>
        Promise.allSettled(data.urls.map((url) => cache.delete(url))),
      )
      .then((results) => {
        const deleted = results.filter(
          (r) => r.status === "fulfilled" && r.value === true,
        ).length;
        if (port) port.postMessage({ type: "DELETE_URLS_DONE", deleted });
      })
      .catch(() => {
        if (port) port.postMessage({ type: "DELETE_URLS_DONE", deleted: 0 });
      }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only successful GET responses are cached; skip everything else.
  if (request.method !== "GET") return;

  const isNavigation = request.mode === "navigate";
  const isSameOrigin = new URL(request.url).origin === self.location.origin;

  // Navigation: network-first, falling back to the cached app shell offline.
  // A successful response also refreshes the cached shell so the latest
  // hashed asset references stay in sync after a deploy.
  if (isNavigation) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches
              .open(SHELL_CACHE)
              .then((cache) => cache.put(SHELL_URL, copy));
          }
          return response;
        })
        .catch(() => caches.match(SHELL_URL)),
    );
    return;
  }

  // Cross-origin map resources (tiles, glyphs, sprites, styles and
  // TileJSON): cache-first with a network fallback. As the user pans and
  // zooms online, each fetched resource is stored so it is available
  // offline. Glyphs arrive as many small per-range requests, sprites as a
  // couple of JSON/PNG pairs and tiles as PBF/WEBP/PNG — all plain GETs,
  // so a single hostname-keyed branch handles them all. Only successful
  // GET responses are stored; opaque or error responses are skipped.
  if (!isSameOrigin) {
    if (!isMapResource(new URL(request.url))) return;
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(MAP_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        });
      }),
    );
    return;
  }

  // Same-origin assets: cache-first with a network fallback, populating the
  // cache on first fetch.
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      });
    }),
  );
});
