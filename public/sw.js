// Service worker of the Vex Store CRM PWA.
// 1. Serves /admin with a network-first strategy (always fresh CRM data).
// 2. Receives Web Push messages and shows them with vibration + sound tag so
//    the phone RINGS even when the app is closed.
const CACHE = "vex-crm-v1";

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Never cache the CRM app or APIs (always live data).
  if (url.pathname.startsWith("/api/") || url.pathname === "/admin" || url.pathname === "/admin.js" || url.pathname === "/manifest.webmanifest") {
    return; // default network handling
  }
  if (event.request.method !== "GET") return;
  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      const network = fetch(event.request)
        .then((response) => {
          if (response.ok && url.origin === self.location.origin) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })(),
  );
});

// Web Push: wake the phone. `sound` is emulated via vibration + requireInteraction
// (browsers do not allow custom notification sounds; vibration + long display
// achieves the "my phone notifies me" effect).
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "⚡ Vex Store", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "⚡ Vex Store";
  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag || "vex",
        renotify: true,
        requireInteraction: true,
        vibrate: [500, 150, 500, 150, 500],
        badge: "/icons/icon-192.png",
        icon: "/icons/icon-192.png",
        data: { url: data.url || "/admin" },
      });
      // Play a looping ringtone for a few seconds on platforms that allow it.
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) client.postMessage({ type: "play-ring" });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientsList) {
        if (client.url.includes("/admin")) return client.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
