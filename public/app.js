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
function cleanAvailability(value, statusValue) {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("instock") || statusValue === "in_stock") return "Available at selected store";
  if (raw.includes("outofstock") || statusValue === "out_of_stock") return "Currently unavailable at selected store";
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

function render(w) {
  const n = els.template.content.firstElementChild.cloneNode(true);
  const [label, cls] = status(w);
  const statusEl = n.querySelector(".status");
  statusEl.textContent = label;
  statusEl.className = `status ${cls}`;
  n.querySelector(".id").textContent = `Watch #${w.id}`;
  n.querySelector("h3").textContent = w.title || "Pending first successful check";
  n.querySelector(".price").textContent = w.price || "Price unavailable";
  n.querySelector(".category").textContent = w.category || "Pokémon";
  n.querySelector(".meta").textContent = [w.sku && `SKU: ${w.sku}`, w.storeName, w.source].filter(Boolean).join(" • ") || "Waiting for product details";
  const availability = n.querySelector(".availability");
  availability.textContent = cleanAvailability(w.availabilityText, w.status);
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
  n.querySelector(".check").onclick = async () => { const r = await api(`/api/watches/${w.id}/check`, { method: "POST", body: "{}" }); toast(r.pendingAgent ? "Queued for the home agent" : "Product checked"); load(); };
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

async function getSub() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const r = await navigator.serviceWorker.register("/sw.js");
  return r.pushManager.getSubscription();
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
  els.agentStatus.textContent = d.agent?.online ? "Online" : "Offline";
  els.agentStatus.className = d.agent?.online ? "online" : "offline";
  els.store.textContent = d.storeName;
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
els.checkAll.onclick = async () => { els.checkAll.disabled = true; try { const r = await api("/api/check-all", { method: "POST", body: "{}" }); toast(r.pendingAgent ? "Home agent will check shortly" : "All products checked"); load(); } finally { els.checkAll.disabled = false; } };
async function testChannel(channel, label) { const r = await api(`/api/notifications/test/${channel}`, { method: "POST", body: "{}" }); const result = r.notifications?.[channel]; toast(result === "sent" || typeof result === "number" ? `${label} test sent` : `${label}: ${result || "test completed"}`); }
els.testDiscord.onclick = () => testChannel("discord", "Discord");
els.testEmail.onclick = () => testChannel("email", "Email");
els.testPush.onclick = () => testChannel("push", "Browser push");
els.push.onclick = async () => { const current = await getSub(); if (current) { await api("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: current.endpoint }) }); await current.unsubscribe(); toast("Push disabled"); return load(); } if (await Notification.requestPermission() !== "granted") return toast("Permission not granted"); const { publicKey } = await api("/api/push/public-key"), reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(publicKey) }); await api("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) }); toast("Push enabled"); load(); };
[els.search, els.statusFilter, els.categoryFilter, els.sort].forEach(el => el.addEventListener(el.tagName === "INPUT" ? "input" : "change", renderGrid));
load(); setInterval(load, 30000);
