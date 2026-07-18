import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "./config.js";
import { addWatch, deleteWatch, readDb, saveSubscription, removeSubscription, updateWatch } from "./store.js";
import { checkProduct, validateProductUrl } from "./microcenter.js";
import { notify, serviceStatus, startOptionalServices } from "./notifiers.js";

const app = express();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
app.disable("x-powered-by");
app.use(express.json({ limit: "100kb" }));

// Always available and dependency-free for Railway.
app.get("/health", (_req, res) => res.status(200).json({ ok: true, service: "pokemon-restock-dashboard-v2", uptime: Math.round(process.uptime()) }));

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
  res.json({
    storeName: config.storeName,
    intervalSeconds: config.intervalSeconds,
    watches: db.watches,
    subscriptions: db.subscriptions.length,
    services: serviceStatus()
  });
});

app.post("/api/watches", async (req, res) => {
  try {
    const url = validateProductUrl(req.body?.url || "");
    const added = await addWatch(url);
    const checked = await runCheck(added.watch);
    res.status(added.created ? 201 : 200).json({ ...added, checked });
  } catch (error) { res.status(400).json({ error: error.message }); }
});

app.patch("/api/watches/:id", async (req, res) => {
  if (typeof req.body?.enabled !== "boolean") return res.status(400).json({ error: "enabled must be true or false" });
  const watch = await updateWatch(req.params.id, { enabled: req.body.enabled });
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
  const result = await runCheck(watch);
  res.status(result.ok ? 200 : 502).json(result);
});

app.post("/api/check-all", async (_req, res) => {
  const results = await runAll();
  res.json({ checked: results.length, successful: results.filter(r => r.ok).length, results });
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

app.post("/api/notifications/test", async (_req, res) => {
  const db = await readDb();
  const watch = db.watches[0];
  const result = watch ? await checkProduct(watch.url, watch.storeName) : {
    title: "Test Pokémon Product", url: "https://www.microcenter.com/", storeName: config.storeName,
    status: "in_stock", price: "$59.99", sku: "TEST", image: null, checkedAt: new Date().toISOString()
  };
  res.json({ notifications: await notify(result, { test: true }) });
});

app.get("*", (_req, res) => res.sendFile(path.join(root, "public", "index.html")));

const server = app.listen(config.port, "0.0.0.0", () => {
  console.log(`Web dashboard listening on 0.0.0.0:${config.port}`);
  startOptionalServices().catch(error => console.error("Optional services failed:", error.message));
  setTimeout(async () => {
    try {
      const db = await readDb();
      if (config.seedDefaultWatch && db.watches.length === 0) await addWatch(validateProductUrl(config.defaultProductUrl));
      await runAll();
      setInterval(() => runAll().catch(error => console.error("Scheduled check failed:", error.message)), config.intervalSeconds * 1000);
    } catch (error) { console.error("Background initialization failed:", error.message); }
  }, 1000);
});

server.on("error", error => console.error("HTTP server error:", error));
