const CACHE_VERSION = "vbos-admin-7.36.7";
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const CORE_ASSETS = [
  "/admin/",
  "/admin/index.html",
  "/admin/manifest.webmanifest",
  "/admin/icons/icon-192.png",
  "/admin/icons/icon-512.png",
  "/admin/icons/maskable-512.png",
  "/admin/icons/vbos-icon.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    await cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: "reload" })));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith("vbos-admin-") && ![CACHE_VERSION, RUNTIME_CACHE].includes(key))
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || request.method !== "GET") return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/") || url.pathname.startsWith("/payment-links/")) return;

  if (request.mode === "navigate" && url.pathname.startsWith("/admin")) {
    event.respondWith(networkFirst(request, "/admin/index.html"));
    return;
  }

  if (url.pathname.startsWith("/admin/assets/") || url.pathname.startsWith("/admin/icons/") || url.pathname === "/admin/manifest.webmanifest") {
    event.respondWith(cacheFirst(request));
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, fallbackUrl) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(request)) || (await caches.match(fallbackUrl));
  }
}

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {
      title: "Vireon Alert",
      body: event.data?.text() ?? "New Vireon community event."
    };
  }

  const title = payload.title ?? "Vireon Alert";
  const options = {
    body: payload.body ?? "Open the Vireon admin dashboard for details.",
    icon: "/admin/icons/icon-192.png",
    badge: "/admin/icons/icon-192.png",
    data: {
      url: payload.url ?? "/admin/#overview"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? "/admin/#overview", self.location.origin);

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === url.origin);
    if (existing) {
      await existing.focus();
      existing.navigate(url.href);
      return;
    }

    await clients.openWindow(url.href);
  })());
});
