import webpush from "web-push";
import { config } from "./config.js";
import { listSubscriptions, pruneSubscription } from "./notificationStore.js";

let configured = false;

function ensureConfigured() {
  if (configured) return true;
  if (!config.vapidPublicKey || !config.vapidPrivateKey || !config.vapidSubject) return false;

  webpush.setVapidDetails(
    config.vapidSubject,
    config.vapidPublicKey,
    config.vapidPrivateKey
  );
  configured = true;
  return true;
}

function statusLabel(status) {
  if (status === "in_stock") return "IN STOCK";
  if (status === "out_of_stock") return "OUT OF STOCK";
  return "STATUS UNKNOWN";
}

export async function sendBrowserPush(result, options = {}) {
  if (!ensureConfigured()) return { skipped: true, reason: "Push not configured" };

  const subscriptions = await listSubscriptions();
  const payload = JSON.stringify({
    title: options.test ? "🧪 Test Restock Alert" : `🚨 ${statusLabel(result.status)}`,
    body: `${result.title}\n${result.storeName}${result.price ? ` • ${result.price}` : ""}`,
    url: result.url,
    image: result.image || null,
    tag: `restock-${result.sku || result.url}`,
    status: result.status
  });

  let sent = 0;
  let removed = 0;

  await Promise.allSettled(subscriptions.map(async subscription => {
    try {
      await webpush.sendNotification(subscription, payload, {
        TTL: 300,
        urgency: result.status === "in_stock" ? "high" : "normal"
      });
      sent += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await pruneSubscription(subscription.endpoint);
        removed += 1;
        return;
      }
      throw error;
    }
  }));

  return { sent, removed, total: subscriptions.length };
}

export function pushConfigured() {
  return Boolean(config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject);
}
