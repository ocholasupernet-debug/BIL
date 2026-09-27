const CACHE_PREFIX = "ocholasupernet-shell-";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    let cachedHtmlAsAsset = false;
    try {
      for (const name of await caches.keys()) {
        if (!name.startsWith(CACHE_PREFIX)) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          if (!new URL(request.url).pathname.startsWith("/assets/")) continue;
          const response = await cache.match(request);
          if (response && (!response.ok || /text\/html/i.test(response.headers.get("content-type") || ""))) {
            cachedHtmlAsAsset = true;
            break;
          }
        }
        await caches.delete(name);
      }
    } catch {
      // A denied cache operation must not prevent the network-only worker from taking over.
    }
    await self.clients.claim();

    // A prior worker could permanently cache HTML under a missing JS asset URL.
    // Reload only affected browsers after removing that poisoned cache.
    if (cachedHtmlAsAsset) {
      const windows = await self.clients.matchAll({ type: "window" });
      await Promise.all(windows.map(async (client) => {
        try { await client.navigate(client.url); } catch { /* The tab may have closed. */ }
      }));
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate"
      || new URL(request.url).origin !== self.location.origin) return;

  // Documents and hashed JS/CSS must never be served from an obsolete app shell.
  event.respondWith(fetch(request).catch(() => new Response(
    '<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1">'
      + '<title>Offline | OcholaSupernet</title><body style="font:16px system-ui;padding:2rem">'
      + '<h1>You are offline</h1><p>Reconnect to the internet and reload this page.</p></body></html>',
    { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
  )));
});