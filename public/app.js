const els = {
  total: document.querySelector("#totalWatches"),
  inStock: document.querySelector("#inStockCount"),
  outStock: document.querySelector("#outStockCount"),
  lastScan: document.querySelector("#lastScan"),
  storeName: document.querySelector("#storeName"),
  watchList: document.querySelector("#watchList"),
  template: document.querySelector("#watchCardTemplate"),
  form: document.querySelector("#addWatchForm"),
  productUrl: document.querySelector("#productUrl"),
  formMessage: document.querySelector("#formMessage"),
  refresh: document.querySelector("#refreshButton"),
  checkAll: document.querySelector("#checkAllButton"),
  connection: document.querySelector("#connectionBadge"),
  toast: document.querySelector("#toast"),
  pushButton: document.querySelector("#pushButton"),
  pushStatus: document.querySelector("#pushStatus"),
  emailStatus: document.querySelector("#emailStatus"),
  testNotifications: document.querySelector("#testNotificationsButton")
};



function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

async function getPushSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.register("/sw.js");
  return registration.pushManager.getSubscription();
}

async function updatePushUi(configured) {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    els.pushStatus.textContent = "Push unsupported";
    els.pushButton.disabled = true;
    return;
  }

  if (!configured) {
    els.pushStatus.textContent = "Push not configured";
    els.pushButton.disabled = true;
    return;
  }

  const subscription = await getPushSubscription();
  const permission = Notification.permission;

  if (subscription) {
    els.pushStatus.textContent = "Browser push enabled";
    els.pushStatus.className = "badge good";
    els.pushButton.textContent = "Disable Browser Push";
  } else {
    els.pushStatus.textContent = permission === "denied" ? "Push permission blocked" : "Browser push disabled";
    els.pushStatus.className = "badge neutral";
    els.pushButton.textContent = "Enable Browser Push";
  }
}

async function togglePush() {
  els.pushButton.disabled = true;
  try {
    const existing = await getPushSubscription();

    if (existing) {
      await api("/api/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint: existing.endpoint })
      });
      await existing.unsubscribe();
      showToast("Browser push disabled.");
      await updatePushUi(true);
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notification permission was not granted.");

    const { publicKey } = await api("/api/push/public-key");
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await api("/api/push/subscribe", {
      method: "POST",
      body: JSON.stringify(subscription)
    });

    showToast("Browser push enabled.");
    await updatePushUi(true);
  } catch (error) {
    showToast(error.message);
  } finally {
    els.pushButton.disabled = false;
  }
}

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function formatDate(value) {
  if (!value) return "Never checked";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

function statusPresentation(watch) {
  if (!watch.enabled) return { label: "Paused", className: "paused" };
  if (watch.lastStatus === "in_stock") return { label: "In Stock", className: "good" };
  if (watch.lastStatus === "out_of_stock") return { label: "Out of Stock", className: "bad" };
  return { label: "Unknown", className: "neutral" };
}

function renderWatch(watch) {
  const card = els.template.content.firstElementChild.cloneNode(true);
  const image = card.querySelector(".product-image");
  const placeholder = card.querySelector(".product-placeholder");
  const status = statusPresentation(watch);
  const pill = card.querySelector(".status-pill");

  pill.textContent = status.label;
  pill.className = `status-pill ${status.className}`;
  card.querySelector(".watch-id").textContent = `#${watch.id}`;
  card.querySelector(".product-title").textContent = watch.title || "Pending first check";
  card.querySelector(".price").textContent = watch.lastPrice || "Price unknown";
  card.querySelector(".sku").textContent = watch.sku ? `SKU ${watch.sku}` : "";
  card.querySelector(".checked-time").textContent = `Last checked: ${formatDate(watch.lastCheckedAt)}`;

  const link = card.querySelector(".product-link");
  link.href = watch.url;

  if (watch.image) {
    image.src = watch.image;
    image.alt = watch.title || "Product image";
    image.style.display = "block";
    placeholder.style.display = "none";
  }

  const checkButton = card.querySelector(".check-button");
  checkButton.addEventListener("click", async () => {
    checkButton.disabled = true;
    checkButton.textContent = "Checking…";
    try {
      await api(`/api/watches/${watch.id}/check`, { method: "POST", body: "{}" });
      showToast("Product checked.");
      await loadDashboard();
    } catch (error) {
      showToast(error.message);
    } finally {
      checkButton.disabled = false;
      checkButton.textContent = "Check Now";
    }
  });

  const toggleButton = card.querySelector(".toggle-button");
  toggleButton.textContent = watch.enabled ? "Pause" : "Resume";
  toggleButton.addEventListener("click", async () => {
    toggleButton.disabled = true;
    try {
      await api(`/api/watches/${watch.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !watch.enabled })
      });
      showToast(watch.enabled ? "Watch paused." : "Watch resumed.");
      await loadDashboard();
    } catch (error) {
      showToast(error.message);
    }
  });

  card.querySelector(".remove-button").addEventListener("click", async () => {
    if (!confirm(`Remove "${watch.title || watch.url}"?`)) return;
    try {
      await api(`/api/watches/${watch.id}`, { method: "DELETE" });
      showToast("Watch removed.");
      await loadDashboard();
    } catch (error) {
      showToast(error.message);
    }
  });

  return card;
}

async function loadDashboard() {
  try {
    const data = await api("/api/dashboard");
    const watches = data.watches || [];

    els.connection.textContent = data.discordReady ? "Discord Connected" : "Discord Offline";
    els.connection.className = `badge ${data.discordReady ? "good" : "neutral"}`;
    els.total.textContent = watches.length;
    els.inStock.textContent = watches.filter(w => w.enabled && w.lastStatus === "in_stock").length;
    els.outStock.textContent = watches.filter(w => w.enabled && w.lastStatus === "out_of_stock").length;
    els.storeName.textContent = data.storeName;
    els.lastScan.textContent = data.lastScanAt ? formatDate(data.lastScanAt) : "Never";
    els.emailStatus.textContent = data.notifications?.emailEnabled ? "Email alerts enabled" : "Email alerts disabled";
    els.emailStatus.className = `badge ${data.notifications?.emailEnabled ? "good" : "neutral"}`;
    await updatePushUi(Boolean(data.notifications?.pushConfigured));

    els.watchList.innerHTML = "";
    if (!watches.length) {
      els.watchList.innerHTML = '<div class="empty-state">No products are being watched yet.</div>';
      return;
    }
    watches.forEach(watch => els.watchList.appendChild(renderWatch(watch)));
  } catch (error) {
    els.connection.textContent = "Connection Error";
    els.connection.className = "badge neutral";
    els.watchList.innerHTML = `<div class="empty-state">${error.message}</div>`;
  }
}

els.form.addEventListener("submit", async event => {
  event.preventDefault();
  const url = els.productUrl.value.trim();
  els.formMessage.textContent = "Adding and checking product…";

  try {
    const data = await api("/api/watches", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    els.productUrl.value = "";
    els.formMessage.textContent = data.created ? "Product added." : "That product is already being watched.";
    showToast(els.formMessage.textContent);
    await loadDashboard();
  } catch (error) {
    els.formMessage.textContent = error.message;
  }
});

els.refresh.addEventListener("click", loadDashboard);

els.checkAll.addEventListener("click", async () => {
  els.checkAll.disabled = true;
  els.checkAll.textContent = "Checking…";
  try {
    const data = await api("/api/check-all", { method: "POST", body: "{}" });
    showToast(`Checked ${data.checked} product${data.checked === 1 ? "" : "s"}.`);
    await loadDashboard();
  } catch (error) {
    showToast(error.message);
  } finally {
    els.checkAll.disabled = false;
    els.checkAll.textContent = "Check All Now";
  }
});

loadDashboard();
setInterval(loadDashboard, 30000);


els.pushButton.addEventListener("click", togglePush);

els.testNotifications.addEventListener("click", async () => {
  els.testNotifications.disabled = true;
  els.testNotifications.textContent = "Sending…";
  try {
    await api("/api/notifications/test", { method: "POST", body: "{}" });
    showToast("Test notifications sent.");
  } catch (error) {
    showToast(error.message);
  } finally {
    els.testNotifications.disabled = false;
    els.testNotifications.textContent = "Send Test Alert";
  }
});
