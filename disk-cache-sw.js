import { DISK_IMAGE } from "./disk-image.mjs";

const imageDirectory = new URL("./", DISK_IMAGE.url);
const cachePrefix = "w95-image:" + self.registration.scope + ":";
const cacheName = cachePrefix + "v1:" + imageDirectory.pathname;
const pending = new Map();
let writesEnabled = true;

self.addEventListener("install", event => {
  // No full-image prefetch: only chunks actually read by the guest are saved.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith(cachePrefix) && key !== cacheName)
        .map(key => caches.delete(key)));
    } catch (_) { /* Storage may be disabled; still take control and boot. */ }
    await self.clients.claim();
  })());
});

function isImageChunk(request) {
  if (request.method !== "GET" || request.mode === "navigate" || request.headers.has("Range")) return false;
  const url = new URL(request.url);
  if (url.origin !== imageDirectory.origin || url.search || !url.pathname.startsWith(imageDirectory.pathname)) return false;
  const match = /^(\d+)-(\d+)\.img$/.exec(url.pathname.slice(imageDirectory.pathname.length));
  if (!match) return false;
  const start = Number(match[1]), end = Number(match[2]);
  return Number.isSafeInteger(start) && start >= 0 && start % DISK_IMAGE.chunkSize === 0 &&
    end === start + DISK_IMAGE.chunkSize && end <= DISK_IMAGE.size;
}

async function loadChunk(request) {
  let cache;
  try {
    cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    if (cached) return cached;
  } catch (_) { /* CacheStorage is optional, not a boot dependency. */ }

  // A miss must not refill from an obsolete HTTP-cache entry.
  const response = await fetch(request, { cache: "no-store" });
  const type = response.headers.get("Content-Type") || "";
  if (cache && writesEnabled && response.status === 200 && !response.redirected &&
      response.url === request.url && !/text\/|json|xml/i.test(type)) {
    try {
      // Reject truncated parts and login/error documents, even with HTTP 200.
      const bytes = await response.clone().arrayBuffer();
      if (bytes.byteLength === DISK_IMAGE.chunkSize) await cache.put(request, response.clone());
    } catch (error) {
      // Keep readable cached chunks; never delete other applications' storage.
      writesEnabled = false;
      console.warn("Disk cache is full or unavailable; new chunks will use server downloads.", error);
    }
  }
  return response;
}

self.addEventListener("fetch", event => {
  if (!isImageChunk(event.request)) return;
  // Share simultaneous reads, but give each consumer its own response body.
  let operation = pending.get(event.request.url);
  if (!operation) {
    operation = loadChunk(event.request);
    pending.set(event.request.url, operation);
  }
  const response = operation.then(value => value.clone());
  event.respondWith(response);
  event.waitUntil(response.catch(() => {}).finally(() => {
    if (pending.get(event.request.url) === operation) pending.delete(event.request.url);
  }));
});
