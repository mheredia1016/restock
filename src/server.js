import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { addWatch, deleteWatch, readDb, saveSubscription, removeSubscription, updateWatch, queueWatchJobs, claimJobs, completeJob, heartbeatAgent, updateSettings, detectCategory } from "./store.js";
import { checkProduct, validateProductUrl } from "./microcenter.js";
import { notify, serviceStatus, startOptionalServices } from "./notifiers.js";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.disable("x-powered-by");
app.use(express.json({ limit: "250kb" }));

app.get("/health", (_req, res) => res.status(200).json({
  ok: true,
  service: "pokemon-restock-dashboard-v3-agent",
  uptime: Math.round(process.uptime()),
  checkerMode: config.checkerMode
}));

function requireAgent(req, res, next) {
  if (!config.agentApiKey) return res.status(503).json({ error: "AGENT_API_KEY is not configured" });
  const supplied = req.get("x-agent-key") || "";
  if (supplied !== config.agentApiKey) return res.status(401).json({ error: "Invalid agent key" });
  next();
}

async function applyAgentResult(watch, payload) {
  const checkedAt = payload.checkedAt || new Date().toISOString();
  if (payload.error) {
    await updateWatch(watch.id, {
      lastCheckedAt: checkedAt,
      lastError: String(payload.error).slice(0, 500),
      lastAgentAt: checkedAt
    });
    return { ok: false, error: payload.error };
  }

  const status = ["in_stock", "out_of_stock", "unknown"].includes(payload.status)
    ? payload.status
    : "unknown";
  const previousStatus = watch.status;
  const previousPrice = watch.price;
  const changed = watch.status !== "unknown" && status !== watch.status;
  const becameAvailable = status === "in_stock" && watch.status !== "in_stock";
  const priceChanged = Boolean(previousPrice && payload.price && previousPrice !== payload.price);

  const result = {
    title: payload.title || watch.title || `${payload.retailer || watch.retailer || "Retail"} Product`,
    url: watch.url,
    retailer: payload.retailer || watch.retailer || (/target\.com/i.test(watch.url) ? "Target" : "Micro Center"),
    storeName: payload.storeName || watch.storeName || config.storeName,
    status,
    price: payload.price || null,
    sku: payload.sku || null,
    image: payload.image || null,
    availabilityText: payload.availabilityText || null,
    source: payload.source || "home agent",
    pageUrl: payload.pageUrl || watch.url,
    httpStatus: payload.httpStatus || null,
    checkedAt
  };

  const history = Array.isArray(watch.history) ? watch.history.slice(-49) : [];
  if (changed || priceChanged || !history.length) history.push({ status: result.status, price: result.price, at: checkedAt });

  const patch = {
    title: result.title,
    retailer: result.retailer,
    status: result.status,
    price: result.price,
    sku: result.sku,
    image: result.image,
    availabilityText: result.availabilityText,
    source: result.source,
    pageUrl: result.pageUrl,
    httpStatus: result.httpStatus,
    lastCheckedAt: checkedAt,
    lastSuccessfulAt: (result.title && result.price && result.status !== "unknown") ? checkedAt : watch.lastSuccessfulAt,
    lastChangedAt: changed ? checkedAt : watch.lastChangedAt,
    lastError: null,
    lastAgentAt: checkedAt,
    history,
    category: payload.category || (watch.category && watch.category !== "General" ? watch.category : detectCategory(result.title, watch.url)),
    fulfillment: payload.fulfillment || watch.fulfillment || null,
    nearbyStores: Array.isArray(payload.nearbyStores) ? payload.nearbyStores.slice(0, 12) : (watch.nearbyStores || [])
  };

  if (changed || priceChanged) {
    const notifications = await notify({ ...result, category: payload.category || watch.category || detectCategory(result.title, watch.url) }, { previousStatus, previousPrice });
    patch.lastAlertAt = checkedAt;
    patch.alertCount = Number(watch.alertCount || 0) + 1;
    patch.lastNotifications = notifications;
  }
  await updateWatch(watch.id, patch);
  return { ok: true, result, changed, becameAvailable, priceChanged };
}

app.get("/api/agent/sync", requireAgent, async (req, res) => {
  const agentId = String(req.get("x-agent-id") || req.query.agentId || "anonymous-agent").slice(0, 100);
  await heartbeatAgent(agentId, { name: req.get("x-agent-name") || "Chrome Extension", version: req.get("x-agent-version") || "unknown", userAgent: req.get("user-agent") || "" });
  const db = await readDb();
  res.json({ settings: db.settings || { homeZip: "" }, watches: db.watches.filter(w => w.enabled).map(w => ({ id: w.id, url: w.url, retailer: w.retailer, storeName: w.storeName, title: w.title, category: w.category })) });
});

app.get("/api/agent/jobs", requireAgent, async (req, res) => {
  const agentId = String(req.get("x-agent-id") || req.query.agentId || "anonymous-agent").slice(0, 100);
  await heartbeatAgent(agentId, { name: req.get("x-agent-name") || "Chrome Extension", version: req.get("x-agent-version") || "unknown", userAgent: req.get("user-agent") || "" });
  const claimed = await claimJobs(agentId, 10);
  const db = await readDb();
  res.json({ storeName: config.storeName, intervalSeconds: config.intervalSeconds, jobs: claimed, watches: db.watches.filter(w => w.enabled).map(w => ({ id: w.id, url: w.url, retailer: w.retailer || (/target\.com/i.test(w.url) ? "Target" : "Micro Center"), storeName: w.storeName || config.storeName, title: w.title })) });
});

app.post("/api/agent/heartbeat", requireAgent, async (req, res) => {
  const agentId = String(req.get("x-agent-id") || req.body?.agentId || "anonymous-agent").slice(0, 100);
  const agent = await heartbeatAgent(agentId, req.body || {});
  res.json({ ok: true, agent });
});

app.post("/api/agent/results", requireAgent, async (req, res) => {
  const results = Array.isArray(req.body?.results) ? req.body.results : [req.body];
  const db = await readDb();
  const applied = [];

  for (const payload of results) {
    const watch = db.watches.find(w => w.id === payload?.watchId);
    if (!watch) {
      applied.push({ watchId: payload?.watchId, ok: false, error: "Watch not found" });
      continue;
    }
    try {
      const outcome = await applyAgentResult(watch, payload);
      await completeJob(payload?.jobId, { error: outcome.ok ? null : outcome.error });
      applied.push({ watchId: watch.id, jobId: payload?.jobId || null, ...outcome });
    } catch (error) {
      await completeJob(payload?.jobId, { error: error.message });
      applied.push({ watchId: watch.id, jobId: payload?.jobId || null, ok: false, error: error.message });
    }
  }

  res.json({ applied });
});

app.post("/api/agent/watches", requireAgent, async (req, res) => {
  try {
    const url = validateProductUrl(req.body?.url || "");
    const added = await addWatch(url);
    const patch = {};
    if (req.body?.title) patch.title = String(req.body.title).slice(0, 250);
    if (req.body?.category) patch.category = String(req.body.category).slice(0, 50);
    patch.retailer = /target\.com/i.test(url) ? "Target" : "Micro Center";
    if (patch.retailer === "Target") patch.storeName = "Target session location";
    const watch = Object.keys(patch).length ? await updateWatch(added.watch.id, patch) : added.watch;
    res.status(added.created ? 201 : 200).json({ created: added.created, watch });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

function auth(req, res, next) {
  if (!config.dashboardPassword) return next();
  const raw = req.headers.authorization || "";
  if (raw.startsWith("Basic ")) {
    const decoded = Buffer.from(raw.slice(6), "base64").toString();
    if (decoded.slice(decoded.indexOf(":") + 1) === config.dashboardPassword) return next();
  }
  res.set("WWW-Authenticate", 'Basic realm="Restock Dashboard"');
  return res.status(401).send("Authentication required");
}

app.use(auth);
app.use(express.static(path.join(root, "public")));

async function runCheck(watch, options = {}) {
  if (config.checkerMode === "agent" && !options.forceCloud) {
    return { ok: false, error: "Home agent mode is enabled. Run the checker from your home computer." };
  }
  try {
    const result = await checkProduct(watch.url, watch.storeName || config.storeName);
    const changed = watch.status !== "unknown" && result.status !== watch.status;
    const becameAvailable = result.status === "in_stock" && watch.status !== "in_stock";
    await updateWatch(watch.id, {
      title: result.title,
      status: result.status,
      price: result.price,
      sku: result.sku,
      image: result.image,
      lastCheckedAt: result.checkedAt,
      lastChangedAt: changed ? result.checkedAt : watch.lastChangedAt,
      lastError: null
    });
    if (options.test || becameAvailable) await notify(result, { test: options.test });
    return { ok: true, result, changed, becameAvailable };
  } catch (error) {
    await updateWatch(watch.id, { lastCheckedAt: new Date().toISOString(), lastError: error.message });
    return { ok: false, error: error.message };
  }
}

async function runAll() {
  const db = await readDb();
  const results = [];
  for (const watch of db.watches.filter(w => w.enabled)) results.push(await runCheck(watch));
  return results;
}

app.get("/api/dashboard", async (_req, res) => {
  const db = await readDb();
  const onlineAgents = (db.agents || []).filter(a => Date.now() - new Date(a.lastSeenAt || 0).getTime() < config.agentStaleMinutes * 60_000);
  const latestAgentAt = (db.agents || []).map(a => a.lastSeenAt).filter(Boolean).sort().at(-1) || db.watches.map(w => w.lastAgentAt).filter(Boolean).sort().at(-1) || null;
  const agentOnline = onlineAgents.length > 0 || (latestAgentAt ? Date.now() - new Date(latestAgentAt).getTime() < config.agentStaleMinutes * 60_000 : false);

  res.json({
    storeName: config.storeName,
    intervalSeconds: config.intervalSeconds,
    checkerMode: config.checkerMode,
    agent: { configured: Boolean(config.agentApiKey), online: agentOnline, lastSeenAt: latestAgentAt, count: onlineAgents.length, agents: onlineAgents },
    jobs: { queued: db.jobs.filter(j => j.status === "queued").length, checking: db.jobs.filter(j => j.status === "claimed").length },
    watches: db.watches,
    settings: db.settings || { homeZip: "" },
    subscriptions: db.subscriptions.length,
    services: serviceStatus()
  });
});

app.post("/api/watches", async (req, res) => {
  try {
    const url = validateProductUrl(req.body?.url || "");
    const added = await addWatch(url);
    const patch = {};
    if (typeof req.body?.title === "string" && req.body.title.trim()) patch.title = req.body.title.trim().slice(0, 250);
    if (typeof req.body?.category === "string" && req.body.category.trim()) patch.category = req.body.category.trim().slice(0, 50);
    if (Object.keys(patch).length) added.watch = await updateWatch(added.watch.id, patch);
    const checked = config.checkerMode === "agent"
      ? { ok: false, pendingAgent: true, jobs: await queueWatchJobs([added.watch.id], "dashboard-add") }
      : await runCheck(added.watch);
    res.status(added.created ? 201 : 200).json({ ...added, checked });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.patch("/api/watches/:id", async (req, res) => {
  const patch = {};
  if (typeof req.body?.enabled === "boolean") patch.enabled = req.body.enabled;
  if (typeof req.body?.category === "string") patch.category = req.body.category.slice(0, 50);
  if (!Object.keys(patch).length) return res.status(400).json({ error: "No valid fields supplied" });
  const watch = await updateWatch(req.params.id, patch);
  if (!watch) return res.status(404).json({ error: "Watch not found" });
  res.json({ watch });
});

app.delete("/api/watches/:id", async (req, res) => {
  const removed = await deleteWatch(req.params.id);
  if (!removed) return res.status(404).json({ error: "Watch not found" });
  res.json({ removed });
});

app.post("/api/watches/:id/check", async (req, res) => {
  const db = await readDb();
  const watch = db.watches.find(w => w.id === req.params.id);
  if (!watch) return res.status(404).json({ error: "Watch not found" });
  if (config.checkerMode === "agent") {
    const [job] = await queueWatchJobs([watch.id], "dashboard");
    return res.status(202).json({ ok: true, pendingAgent: true, queued: Boolean(job), job });
  }
  const result = await runCheck(watch);
  res.status(result.ok ? 200 : 502).json(result);
});

app.post("/api/check-all", async (_req, res) => {
  if (config.checkerMode === "agent") {
    const db = await readDb();
    const jobs = await queueWatchJobs(db.watches.filter(w => w.enabled).map(w => w.id), "dashboard-all");
    return res.status(202).json({ checked: 0, pendingAgent: true, queued: jobs.length, jobs });
  }
  const results = await runAll();
  res.json({ checked: results.length, successful: results.filter(r => r.ok).length, results });
});

app.patch("/api/settings", async (req, res) => {
  const patch = {};
  if (typeof req.body?.homeZip === "string") {
    const zip = req.body.homeZip.trim();
    if (zip && !/^\d{5}(?:-\d{4})?$/.test(zip)) return res.status(400).json({ error: "Enter a valid US ZIP code" });
    patch.homeZip = zip;
  }
  res.json({ settings: await updateSettings(patch) });
});

app.get("/api/push/public-key", (_req, res) => {
  if (!serviceStatus().pushConfigured) return res.status(503).json({ error: "Browser push is not configured" });
  res.json({ publicKey: config.vapidPublicKey });
});

app.post("/api/push/subscribe", async (req, res) => {
  if (!req.body?.endpoint) return res.status(400).json({ error: "Invalid subscription" });
  const count = await saveSubscription(req.body);
  res.status(201).json({ count });
});

app.post("/api/push/unsubscribe", async (req, res) => {
  await removeSubscription(req.body?.endpoint || "");
  res.json({ ok: true });
});

function testResultFromWatch(watch) {
  return watch ? {
    title: watch.title || "Test Retail Product", url: watch.url, storeName: watch.storeName || config.storeName,
    status: "in_stock", price: watch.price || "$59.99", sku: watch.sku || "TEST", image: watch.image || null,
    category: watch.category || detectCategory(watch.title || "Test Retail Product", watch.url), checkedAt: new Date().toISOString()
  } : {
    title: "Test Retail Product", url: "https://www.microcenter.com/", storeName: config.storeName,
    status: "in_stock", price: "$59.99", sku: "TEST", image: null, category: "General", checkedAt: new Date().toISOString()
  };
}

app.post("/api/notifications/test/:channel", async (req, res) => {
  const channel = req.params.channel;
  if (!["discord", "email", "push", "all"].includes(channel)) return res.status(400).json({ error: "Invalid notification channel" });
  const db = await readDb();
  const result = testResultFromWatch(db.watches[0]);
  const notifications = await notify(result, { test: true, only: channel === "all" ? null : channel });
  res.json({ notifications });
});

app.post("/api/notifications/test", async (_req, res) => {
  const db = await readDb();
  res.json({ notifications: await notify(testResultFromWatch(db.watches[0]), { test: true }) });
});

app.get("*", (_req, res) => res.sendFile(path.join(root, "public", "index.html")));

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Web dashboard listening on 0.0.0.0:${config.port}`);
  console.log(`Checker mode: ${config.checkerMode}`);
  startOptionalServices().catch(error => console.error("Optional services failed:", error.message));
  setTimeout(async () => {
    try {
      const db = await readDb();
      if (config.seedDefaultWatch && db.watches.length === 0) await addWatch(validateProductUrl(config.defaultProductUrl));
      if (config.checkerMode !== "agent") {
        await runAll();
        setInterval(() => runAll().catch(error => console.error("Scheduled check failed:", error.message)), config.intervalSeconds * 1000);
      } else {
        console.log("Cloud checks disabled. Waiting for the home agent.");
      }
    } catch (error) { console.error("Background initialization failed:", error.message); }
  }, 1000);
});

server.on("error", error => console.error("HTTP server error:", error));
