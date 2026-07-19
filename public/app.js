const $ = s => document.querySelector(s);
const els = {
  watching: $("#watching"), watchingTop: $("#watchingTop"), inStock: $("#inStock"), outStock: $("#outStock"), devices: $("#devices"),
  agentStatus: $("#agentStatus"), store: $("#store"), grid: $("#grid"), template: $("#card"),
  form: $("#addForm"), url: $("#url"), message: $("#message"), refresh: $("#refresh"), checkAll: $("#checkAll"),
  push: $("#push"), badges: $("#serviceBadges"), toast: $("#toast"), search: $("#search"),
  statusFilter: $("#statusFilter"), categoryFilter: $("#categoryFilter"), sort: $("#sort"),
  testDiscord: $("#testDiscord"), testEmail: $("#testEmail"), testPush: $("#testPush")
};
let dashboard = null;

const api = async (url, opt = {}) => {
  const r = await fetch(url, { headers: { "content-type": "application/json" }, ...opt });
  const d = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) throw Error(d.error || `Request failed ${r.status}`);
  return d;
};

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => els.toast.classList.remove("show"), 3600);
}
function badge(text, ok) { return `<span class="badge ${ok ? "good" : "neutral"}">${text}</span>`; }
function status(w) {
  if (!w.enabled) return ["Paused", "neutral"];
  if (w.status === "in_stock") return ["In Stock", "good"];
  if (w.status === "out_of_stock") return ["Out of Stock", "bad"];
  return ["Unknown", "neutral"];
}
function when(value) { return value ? new Date(value).toLocaleString() : "Never"; }
function retailerName(w) { return w.retailer || (/target\.com/i.test(w.url || "") ? "Target" : "Micro Center"); }
function cleanAvailability(value, statusValue, retailer) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("instock") || statusValue === "in_stock") return retailer === "Target" ? (value || "Available for shipping or pickup") : "Available at selected store";
  if (raw.includes("outofstock") || statusValue === "out_of_stock") return retailer === "Target" ? "Currently unavailable" : "Currently unavailable at selected store";
  return value ? String(value).replace(/^https?:\/\/schema\.org\//i, "").replace(/([a-z])([A-Z])/g, "$1 $2") : "Availability details unavailable";
}
function historyHtml(items = []) {
  if (!items.length) return `<p class="history-empty">No status changes recorded yet.</p>`;
  return [...items].reverse().slice(0, 8).map(item => {
    const label = item.status === "in_stock" ? "In Stock" : item.status === "out_of_stock" ? "Out of Stock" : "Unknown";
    const cls = item.status === "in_stock" ? "good-dot" : item.status === "out_of_stock" ? "bad-dot" : "neutral-dot";
    return `<div class="history-item"><span class="history-dot ${cls}"></span><span>${label}${item.price ? ` • ${item.price}` : ""}</span><time>${when(item.at)}</time></div>`;
  }).join("");
}

function checkStateLabel(w) {
  const state = w.checkState?.status;
  if (state === "queued") return ["Queued…", "queued"];
  if (state === "checking") return ["Checking…", "checking"];
  if (state === "failed") return ["Check Failed", "failed"];
  return ["Check Now", ""];
}

function render(w) {
  const n = els.template.content.firstElementChild.cloneNode(true);
  const [label, cls] = status(w);
  const statusEl = n.querySelector(".status");
  statusEl.textContent = label;
  statusEl.className = `status ${cls}`;
  const retailer = retailerName(w);
  n.querySelector(".id").textContent = `${retailer.toUpperCase()} • Watch #${w.id}`;
  n.querySelector("h3").textContent = w.title || "Pending first successful check";
  n.querySelector(".price").textContent = w.price || "Price unavailable";
  n.querySelector(".category").textContent = w.category || "Pokémon";
  n.querySelector(".meta").textContent = [w.sku && `${retailer === "Target" ? "TCIN" : "SKU"}: ${w.sku}`, retailer, w.storeName, w.source].filter(Boolean).join(" • ") || "Waiting for product details";
  const availability = n.querySelector(".availability");
  availability.textContent = cleanAvailability(w.availabilityText, w.status, retailer);
  availability.className = `availability ${cls}`;
  n.querySelector(".checked").innerHTML = `<span>Last Checked</span><strong>${when(w.lastCheckedAt)}</strong>${w.lastError ? `<em>${w.lastError}</em>` : ""}`;
  n.querySelector(".alerted").innerHTML = `<span>Last Alert</span><strong>${when(w.lastAlertAt)}</strong><small>${Number(w.alertCount || 0)} alert${Number(w.alertCount || 0) === 1 ? "" : "s"}</small>`;
  n.querySelector(".alert-count").textContent = Number(w.alertCount || 0);
  n.querySelector(".monitor-state").textContent = w.enabled ? "Active" : "Paused";
  n.querySelector(".history-list").innerHTML = historyHtml(w.history);
  const a = n.querySelector(".product-link"); a.href = w.pageUrl || w.url;
  if (w.image) {
    const i = n.querySelector(".product-image");
    i.src = w.image; i.alt = w.title || "Product image"; i.style.display = "block";
    n.querySelector(".image-fallback").style.display = "none";
    i.onerror = () => { i.style.display = "none"; n.querySelector(".image-fallback").style.display = "block"; };
  }
  const checkButton = n.querySelector(".check");
  const [checkText, checkClass] = checkStateLabel(w);
  checkButton.textContent = checkText;
  checkButton.classList.toggle("queued", checkClass === "queued");
  checkButton.classList.toggle("checking", checkClass === "checking");
  checkButton.classList.toggle("failed", checkClass === "failed");
  checkButton.disabled = checkClass === "queued" || checkClass === "checking";
  checkButton.onclick = async () => {
    checkButton.disabled = true; checkButton.textContent = "Queuing…";
    try { const r = await api(`/api/watches/${w.id}/check`, { method: "POST", body: "{}" }); toast(r.pendingAgent ? "Check queued. Chrome will pick it up within about 30 seconds." : "Product checked"); await load(); }
    catch (error) { toast(error.message); checkButton.disabled = false; checkButton.textContent = "Check Now"; }
  };
  n.querySelector(".toggle").textContent = w.enabled ? "Pause" : "Resume";
  n.querySelector(".toggle").onclick = async () => { await api(`/api/watches/${w.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !w.enabled }) }); load(); };
  n.querySelector(".remove").onclick = async () => { if (confirm("Remove this watch?")) { await api(`/api/watches/${w.id}`, { method: "DELETE" }); load(); } };
  return n;
}

function filteredWatches() {
  if (!dashboard) return [];
  const q = els.search.value.trim().toLowerCase();
  let rows = dashboard.watches.filter(w => {
    const statusValue = !w.enabled ? "paused" : w.status;
    const text = `${w.title || ""} ${w.sku || ""}`.toLowerCase();
    return (!q || text.includes(q)) &&
      (els.statusFilter.value === "all" || statusValue === els.statusFilter.value) &&
      (els.categoryFilter.value === "all" || (w.category || "Pokémon") === els.categoryFilter.value);
  });
  rows.sort((a, b) => {
    if (els.sort.value === "name") return String(a.title || "").localeCompare(String(b.title || ""));
    if (els.sort.value === "alert") return new Date(b.lastAlertAt || 0) - new Date(a.lastAlertAt || 0);
    if (els.sort.value === "status") return String(a.status).localeCompare(String(b.status));
    return new Date(b.lastCheckedAt || 0) - new Date(a.lastCheckedAt || 0);
  });
  return rows;
}
function renderGrid() {
  els.grid.innerHTML = "";
  const rows = filteredWatches();
  if (!rows.length) els.grid.innerHTML = `<div class="empty-state">No products match the current filters.</div>`;
  rows.forEach(w => els.grid.appendChild(render(w)));
}

async function getRegistration() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("This browser does not support web push.");
  await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}
async function getSub() {
  try { const r = await getRegistration(); return r.pushManager.getSubscription(); }
  catch { return null; }
}
function key(s) { const p = "=".repeat((4 - s.length % 4) % 4), b = atob((s + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...b].map(c => c.charCodeAt(0))); }
async function pushUi(configured) {
  if (!configured) { els.push.disabled = true; els.push.textContent = "Push Not Configured"; return; }
  const s = await getSub(); els.push.disabled = false; els.push.textContent = s ? "Disable Browser Push" : "Enable Browser Push";
}

async function load() {
  const d = await api("/api/dashboard"); dashboard = d;
  els.watching.textContent = d.watches.length; if (els.watchingTop) els.watchingTop.textContent = d.watches.length;
  els.inStock.textContent = d.watches.filter(w => w.enabled && w.status === "in_stock").length;
  els.outStock.textContent = d.watches.filter(w => w.enabled && w.status === "out_of_stock").length;
  els.devices.textContent = d.subscriptions;
  els.agentStatus.textContent = d.agent?.online ? `Online${d.agent?.count ? ` (${d.agent.count})` : ""}` : "Offline";
  els.agentStatus.className = d.agent?.online ? "online" : "offline";
  els.store.textContent = [...new Set(d.watches.map(retailerName))].join(" + ") || "Micro Center + Target";
  els.badges.innerHTML = badge(`Agent ${d.agent?.online ? "Online" : "Offline"}`, d.agent?.online) + badge(`Push ${d.services.pushConfigured ? "Ready" : "Off"}`, d.services.pushConfigured) + badge(`Email ${d.services.emailConfigured ? "Ready" : "Off"}`, d.services.emailConfigured) + badge(`Discord ${d.services.discordConnected ? "Connected" : "Off"}`, d.services.discordConnected);
  const categories = [...new Set(d.watches.map(w => w.category || "Pokémon"))].sort();
  const current = els.categoryFilter.value;
  els.categoryFilter.innerHTML = `<option value="all">All categories</option>${categories.map(c => `<option value="${c}">${c}</option>`).join("")}`;
  if (categories.includes(current)) els.categoryFilter.value = current;
  renderGrid();
  await pushUi(d.services.pushConfigured);
}

els.form.onsubmit = async e => { e.preventDefault(); els.message.textContent = "Adding…"; try { await api("/api/watches", { method: "POST", body: JSON.stringify({ url: els.url.value }) }); els.url.value = ""; els.message.textContent = "Added. The home agent will check it shortly."; load(); } catch (err) { els.message.textContent = err.message; } };
els.refresh.onclick = load;
els.checkAll.onclick = async () => { els.checkAll.disabled = true; try { const r = await api("/api/check-all", { method: "POST", body: "{}" }); toast(r.pendingAgent ? `${r.queued || 0} product checks queued` : "All products checked"); load(); } finally { els.checkAll.disabled = false; } };
async function testChannel(channel, label) {
  try {
    const r = await api(`/api/notifications/test/${channel}`, { method: "POST", body: "{}" });
    const result = r.notifications?.[channel];
    if (channel === "push") {
      if (result && typeof result === "object" && result.sent > 0) return toast(`${label} test sent to ${result.sent} device${result.sent === 1 ? "" : "s"}`);
      return toast(`${label}: ${typeof result === "string" ? result : "No subscribed device received it"}`);
    }
    toast(result === "sent" ? `${label} test sent` : `${label}: ${result || "test completed"}`);
  } catch (error) { toast(`${label}: ${error.message}`); }
}
els.testDiscord.onclick = () => testChannel("discord", "Discord");
els.testEmail.onclick = () => testChannel("email", "Email");
els.testPush.onclick = () => testChannel("push", "Browser push");
els.push.onclick = async () => {
  try {
    const current = await getSub();
    if (current) {
      await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: current.endpoint }) });
      await current.unsubscribe();
      toast("Browser push disabled on this device");
      return load();
    }
    if (!("Notification" in window)) throw new Error("Notifications are not supported by this browser.");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error(`Notification permission is ${permission}. Allow notifications in the browser site settings.`);
    const { publicKey } = await api("/api/push/public-key");
    const reg = await getRegistration();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(publicKey) });
    await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
    await reg.showNotification("Browser Push Enabled", { body: "This device is now subscribed to restock alerts.", icon: "/icon-192.png", tag: "push-enabled" });
    toast("Browser push enabled and test notification displayed");
    load();
  } catch (error) { toast(`Push setup failed: ${error.message}`); }
};
[els.search, els.statusFilter, els.categoryFilter, els.sort].forEach(el => el.addEventListener(el.tagName === "INPUT" ? "input" : "change", renderGrid));
load(); setInterval(load, 5000);
