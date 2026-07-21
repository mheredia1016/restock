import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { config } from "./config.js";

const dbFile = path.join(config.dataDir, "restock-db.json");
let memoryDb = { watches: [], subscriptions: [], jobs: [], agents: [], settings: { homeZip: "" } };
let usingMemory = false;
let writeChain = Promise.resolve();

async function ensureDir() {
  try { await fs.mkdir(config.dataDir, { recursive: true }); return true; }
  catch (error) { usingMemory = true; console.error("Data directory unavailable; using memory storage:", error.message); return false; }
}
function normalizeDb(parsed = {}) {
  return {
    watches: Array.isArray(parsed.watches) ? parsed.watches : [],
    subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
    jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    agents: Array.isArray(parsed.agents) ? parsed.agents : [],
    settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : { homeZip: "" }
  };
}
export async function readDb() {
  if (usingMemory || !(await ensureDir())) return structuredClone(memoryDb);
  try { return normalizeDb(JSON.parse(await fs.readFile(dbFile, "utf8"))); }
  catch (error) { if (error.code !== "ENOENT") console.error("Database read failed:", error.message); return normalizeDb(); }
}
export async function writeDb(db) {
  const normalized = normalizeDb(db);
  memoryDb = structuredClone(normalized);
  if (usingMemory || !(await ensureDir())) return;

  // Heartbeats and product results can arrive at nearly the same time. The old
  // implementation made every request use the same .tmp filename, so one
  // request could rename it while another request was still expecting it.
  // Serialize writes and use a unique temporary file for each write.
  const payload = JSON.stringify(normalized, null, 2);
  const runWrite = async () => {
    const temp = `${dbFile}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    try {
      await fs.writeFile(temp, payload, "utf8");
      await fs.rename(temp, dbFile);
    } catch (error) {
      try { await fs.unlink(temp); } catch {}
      throw error;
    }
  };

  const pending = writeChain.then(runWrite, runWrite);
  writeChain = pending.catch(error => {
    console.error("Database write failed:", error.message);
  });
  await pending;
}
export function detectCategory(title = "", url = "") {
  const text = `${title} ${url}`.toLowerCase();
  if (/pokemon|pokémon|trading card|booster|elite trainer|tcg/.test(text)) return "Trading Cards";
  if (/lego|building set|building blocks/.test(text)) return "LEGO";
  if (/gpu|graphics card|geforce|radeon/.test(text)) return "GPUs";
  if (/cpu|processor|ryzen|intel core/.test(text)) return "CPUs";
  if (/console|playstation|xbox|nintendo switch|video game/.test(text)) return "Video Games";
  if (/fidget|toy|squeezy|squish|doll|figure|plush/.test(text)) return "Toys";
  if (/monitor|laptop|desktop|keyboard|mouse|electronics/.test(text)) return "Electronics";
  return "General";
}
function retailerFromUrl(url) { try { const h = new URL(url).hostname; return /target\.com$/i.test(h) ? "Target" : "Micro Center"; } catch { return "Unknown"; } }
export async function addWatch(url) {
  const db = await readDb();
  const existing = db.watches.find(w => w.url === url);
  if (existing) return { watch: existing, created: false };
  const retailer = retailerFromUrl(url);
  const watch = { id: crypto.randomBytes(3).toString("hex"), url, retailer, storeName: retailer === "Target" ? "Target session location" : config.storeName, enabled: true, title: "Pending first check", status: "unknown", price: null, sku: null, image: null, availabilityText: null, source: null, pageUrl: url, httpStatus: null, lastSuccessfulAt: null, createdAt: new Date().toISOString(), lastCheckedAt: null, lastChangedAt: null, lastError: null, category: detectCategory("", url), lastAlertAt: null, alertCount: 0, history: [], checkState: null };
  db.watches.push(watch); await writeDb(db); return { watch, created: true };
}
export async function updateWatch(id, patch) { const db = await readDb(); const watch = db.watches.find(w => w.id === id); if (!watch) return null; Object.assign(watch, patch); await writeDb(db); return watch; }
export async function deleteWatch(id) { const db = await readDb(); const index = db.watches.findIndex(w => w.id === id); if (index < 0) return null; const [removed] = db.watches.splice(index, 1); db.jobs = db.jobs.filter(j => j.watchId !== id); await writeDb(db); return removed; }
export async function saveSubscription(subscription) { const db = await readDb(); const existing = db.subscriptions.find(s => s.endpoint === subscription.endpoint); if (existing) Object.assign(existing, subscription, { updatedAt: new Date().toISOString() }); else db.subscriptions.push({ ...subscription, createdAt: new Date().toISOString() }); await writeDb(db); return db.subscriptions.length; }
export async function removeSubscription(endpoint) { const db = await readDb(); db.subscriptions = db.subscriptions.filter(s => s.endpoint !== endpoint); await writeDb(db); }

export async function queueWatchJobs(watchIds, requestedBy = "dashboard") {
  const db = await readDb(); const now = new Date().toISOString(); const created = [];
  for (const watchId of [...new Set(watchIds)]) {
    const watch = db.watches.find(w => w.id === watchId && w.enabled);
    if (!watch) continue;
    const existing = db.jobs.find(j => j.watchId === watchId && ["queued", "claimed"].includes(j.status));
    if (existing) { created.push(existing); continue; }
    const job = { id: crypto.randomBytes(8).toString("hex"), watchId, url: watch.url, retailer: watch.retailer || retailerFromUrl(watch.url), storeName: watch.storeName || config.storeName, title: watch.title, status: "queued", requestedBy, createdAt: now, claimedAt: null, claimedBy: null, completedAt: null, error: null };
    db.jobs.push(job); watch.checkState = { status: "queued", jobId: job.id, at: now }; created.push(job);
  }
  db.jobs = db.jobs.filter(j => Date.now() - new Date(j.createdAt).getTime() < 7 * 86400000);
  await writeDb(db); return created;
}
export async function claimJobs(agentId, limit = 10) {
  const db = await readDb(); const now = new Date().toISOString();
  for (const job of db.jobs.filter(j => j.status === "claimed" && Date.now() - new Date(j.claimedAt || j.createdAt).getTime() > 5 * 60000)) { job.status = "queued"; job.claimedAt = null; job.claimedBy = null; }
  const jobs = db.jobs.filter(j => j.status === "queued").slice(0, limit);
  for (const job of jobs) { job.status = "claimed"; job.claimedAt = now; job.claimedBy = agentId; const w = db.watches.find(x => x.id === job.watchId); if (w) w.checkState = { status: "checking", jobId: job.id, at: now, agentId }; }
  await writeDb(db); return jobs;
}
export async function completeJob(jobId, { error = null } = {}) {
  if (!jobId) return null;
  const db = await readDb(); const job = db.jobs.find(j => j.id === jobId); if (!job) return null;
  const now = new Date().toISOString(); job.status = error ? "failed" : "completed"; job.completedAt = now; job.error = error ? String(error).slice(0, 500) : null;
  const w = db.watches.find(x => x.id === job.watchId); if (w) w.checkState = { status: error ? "failed" : "completed", jobId, at: now, error: job.error };
  await writeDb(db); return job;
}
export async function heartbeatAgent(agentId, details = {}) {
  const db = await readDb(); const now = new Date().toISOString(); let agent = db.agents.find(a => a.id === agentId);
  if (!agent) { agent = { id: agentId, firstSeenAt: now }; db.agents.push(agent); }
  Object.assign(agent, { lastSeenAt: now, name: String(details.name || "Chrome Extension").slice(0, 100), version: String(details.version || "unknown").slice(0, 30), userAgent: String(details.userAgent || "").slice(0, 250) });
  await writeDb(db); return agent;
}

export async function updateSettings(patch) { const db = await readDb(); db.settings = { ...(db.settings || {}), ...patch }; await writeDb(db); return db.settings; }
