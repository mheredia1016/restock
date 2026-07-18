import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

const dbFile = path.join(config.dataDir, "restock-db.json");
let memoryDb = { watches: [], subscriptions: [] };
let usingMemory = false;

async function ensureDir() {
  try {
    await fs.mkdir(config.dataDir, { recursive: true });
    return true;
  } catch (error) {
    usingMemory = true;
    console.error("Data directory unavailable; using memory storage:", error.message);
    return false;
  }
}

export async function readDb() {
  if (usingMemory || !(await ensureDir())) return structuredClone(memoryDb);
  try {
    const parsed = JSON.parse(await fs.readFile(dbFile, "utf8"));
    return {
      watches: Array.isArray(parsed.watches) ? parsed.watches : [],
      subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : []
    };
  } catch (error) {
    if (error.code !== "ENOENT") console.error("Database read failed:", error.message);
    return { watches: [], subscriptions: [] };
  }
}

export async function writeDb(db) {
  memoryDb = structuredClone(db);
  if (usingMemory || !(await ensureDir())) return;
  const temp = `${dbFile}.tmp`;
  await fs.writeFile(temp, JSON.stringify(db, null, 2));
  await fs.rename(temp, dbFile);
}

export async function addWatch(url) {
  const db = await readDb();
  const existing = db.watches.find(w => w.url === url);
  if (existing) return { watch: existing, created: false };
  const watch = {
    id: crypto.randomBytes(3).toString("hex"),
    url,
    storeName: config.storeName,
    enabled: true,
    title: "Pending first check",
    status: "unknown",
    price: null,
    sku: null,
    image: null,
    availabilityText: null,
    source: null,
    pageUrl: url,
    httpStatus: null,
    lastSuccessfulAt: null,
    createdAt: new Date().toISOString(),
    lastCheckedAt: null,
    lastChangedAt: null,
    lastError: null
  };
  db.watches.push(watch);
  await writeDb(db);
  return { watch, created: true };
}

export async function updateWatch(id, patch) {
  const db = await readDb();
  const watch = db.watches.find(w => w.id === id);
  if (!watch) return null;
  Object.assign(watch, patch);
  await writeDb(db);
  return watch;
}

export async function deleteWatch(id) {
  const db = await readDb();
  const index = db.watches.findIndex(w => w.id === id);
  if (index < 0) return null;
  const [removed] = db.watches.splice(index, 1);
  await writeDb(db);
  return removed;
}

export async function saveSubscription(subscription) {
  const db = await readDb();
  const existing = db.subscriptions.find(s => s.endpoint === subscription.endpoint);
  if (existing) Object.assign(existing, subscription, { updatedAt: new Date().toISOString() });
  else db.subscriptions.push({ ...subscription, createdAt: new Date().toISOString() });
  await writeDb(db);
  return db.subscriptions.length;
}

export async function removeSubscription(endpoint) {
  const db = await readDb();
  db.subscriptions = db.subscriptions.filter(s => s.endpoint !== endpoint);
  await writeDb(db);
}
