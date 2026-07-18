import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

const filePath = path.join(config.dataDir, "watches.json");

async function ensureFile() {
  await fs.mkdir(config.dataDir, { recursive: true });
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, JSON.stringify({ watches: [] }, null, 2));
  }
}

export async function readDb() {
  await ensureFile();
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return { watches: Array.isArray(parsed.watches) ? parsed.watches : [] };
  } catch (error) {
    console.error("Could not read database; creating a clean file:", error.message);
    const db = { watches: [] };
    await writeDb(db);
    return db;
  }
}

export async function writeDb(db) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const temp = `${filePath}.tmp`;
  await fs.writeFile(temp, JSON.stringify(db, null, 2));
  await fs.rename(temp, filePath);
}

export async function addWatch(url, storeName = config.storeName) {
  const db = await readDb();
  const normalized = new URL(url).toString();
  const duplicate = db.watches.find(
    (watch) => watch.url === normalized && watch.storeName.toLowerCase() === storeName.toLowerCase()
  );
  if (duplicate) return { watch: duplicate, created: false };

  const watch = {
    id: crypto.randomBytes(3).toString("hex"),
    url: normalized,
    storeName,
    enabled: true,
    title: null,
    sku: null,
    image: null,
    lastStatus: null,
    lastPrice: null,
    lastCheckedAt: null,
    lastChangedAt: null,
    consecutiveErrors: 0,
    createdAt: new Date().toISOString()
  };

  db.watches.push(watch);
  await writeDb(db);
  return { watch, created: true };
}

export async function removeWatch(id) {
  const db = await readDb();
  const index = db.watches.findIndex((watch) => watch.id === id);
  if (index === -1) return null;
  const [removed] = db.watches.splice(index, 1);
  await writeDb(db);
  return removed;
}

export async function setEnabled(id, enabled) {
  const db = await readDb();
  const watch = db.watches.find((item) => item.id === id);
  if (!watch) return null;
  watch.enabled = enabled;
  await writeDb(db);
  return watch;
}

export async function updateWatch(id, patch) {
  const db = await readDb();
  const watch = db.watches.find((item) => item.id === id);
  if (!watch) return null;
  Object.assign(watch, patch);
  await writeDb(db);
  return watch;
}
