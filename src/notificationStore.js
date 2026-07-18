import fs from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";

const filePath = path.join(config.dataDir, "push-subscriptions.json");

async function readFile() {
  await fs.mkdir(config.dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    return { subscriptions: Array.isArray(data.subscriptions) ? data.subscriptions : [] };
  } catch {
    return { subscriptions: [] };
  }
}

async function writeFile(data) {
  await fs.mkdir(config.dataDir, { recursive: true });
  const temp = `${filePath}.tmp`;
  await fs.writeFile(temp, JSON.stringify(data, null, 2));
  await fs.rename(temp, filePath);
}

export async function listSubscriptions() {
  const data = await readFile();
  return data.subscriptions;
}

export async function saveSubscription(subscription) {
  const data = await readFile();
  const endpoint = subscription?.endpoint;
  if (!endpoint) throw new Error("Invalid push subscription.");

  const existing = data.subscriptions.find(item => item.endpoint === endpoint);
  if (existing) {
    Object.assign(existing, subscription, { updatedAt: new Date().toISOString() });
  } else {
    data.subscriptions.push({
      ...subscription,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  }

  await writeFile(data);
  return data.subscriptions.length;
}

export async function removeSubscription(endpoint) {
  const data = await readFile();
  const before = data.subscriptions.length;
  data.subscriptions = data.subscriptions.filter(item => item.endpoint !== endpoint);
  await writeFile(data);
  return before !== data.subscriptions.length;
}

export async function pruneSubscription(endpoint) {
  return removeSubscription(endpoint);
}
