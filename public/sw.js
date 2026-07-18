self.addEventListener("push", event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Restock Alert", body: event.data?.text() || "" };
  }

  const options = {
    body: data.body || "A watched product changed status.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    image: data.image || undefined,
    tag: data.tag || "restock-alert",
    renotify: true,
    requireInteraction: data.status === "in_stock",
    data: { url: data.url || "/" },
    actions: [
      { action: "open", title: "Open Product" }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || "Restock Alert", options)
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(clients.openWindow(url));
});
