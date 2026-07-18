import { readDb, updateWatch } from "./store.js";
import { checkMicroCenterProduct } from "./microcenter.js";
import { sendAlert } from "./alerts.js";

let running = false;

export async function checkOne(client, watch, { manual = false } = {}) {
  try {
    const result = await checkMicroCenterProduct(watch.url, watch.storeName);
    const previousStatus = watch.lastStatus;
    const previousPrice = watch.lastPrice;
    const statusChanged = previousStatus !== null && previousStatus !== result.status;
    const priceChanged = previousPrice !== null && result.price && previousPrice !== result.price;

    await updateWatch(watch.id, {
      title: result.title,
      sku: result.sku,
      image: result.image,
      lastStatus: result.status,
      lastPrice: result.price,
      lastCheckedAt: result.checkedAt,
      lastChangedAt: statusChanged ? result.checkedAt : watch.lastChangedAt,
      consecutiveErrors: 0
    });

    // Automated alerts only happen after an initial baseline has been stored.
    if (statusChanged || priceChanged) {
      await sendAlert(client, result, { priceChanged });
    }

    console.log(
      `[${result.checkedAt}] ${watch.id} ${result.storeName}: ${result.status} | ${result.title}`
    );
    return { ok: true, result, statusChanged, priceChanged, baseline: previousStatus === null };
  } catch (error) {
    const failures = Number(watch.consecutiveErrors || 0) + 1;
    await updateWatch(watch.id, {
      lastCheckedAt: new Date().toISOString(),
      consecutiveErrors: failures
    });
    console.error(`Watch ${watch.id} failed (${failures}):`, error.message);
    return { ok: false, error: error.message };
  }
}

export async function checkAll(client) {
  if (running) {
    console.log("Skipping scan because the previous scan is still running.");
    return [];
  }

  running = true;
  try {
    const db = await readDb();
    const enabled = db.watches.filter((watch) => watch.enabled);
    const results = [];
    for (const watch of enabled) {
      results.push(await checkOne(client, watch));
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return results;
  } finally {
    running = false;
  }
}
