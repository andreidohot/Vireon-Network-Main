import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { StaleWhileRevalidate } from "workbox-strategies";

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/admin/index.html"), {
    denylist: [/^\/api\//, /^\/auth\//]
  })
);

registerRoute(
  ({ request, url }) => request.destination === "image" && url.pathname.startsWith("/admin/icons/"),
  new StaleWhileRevalidate({ cacheName: "vbos-admin-icons" })
);

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
