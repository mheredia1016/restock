import webpush from "web-push";
import nodemailer from "nodemailer";
import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { readDb, removeSubscription } from "./store.js";
import { buildButtons, buildStatusEmbed } from "./alerts.js";

let discord = null;
let smtp = null;
let pushReady = false;

export async function startOptionalServices() {
  if (config.vapidPublicKey && config.vapidPrivateKey && config.vapidSubject) {
    try {
      webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
      pushReady = true;
      console.log("Browser push configured.");
    } catch (error) { console.error("Push setup failed:", error.message); }
  }
  if (config.discordToken && config.discordChannelId) {
    try {
      discord = new Client({ intents: [GatewayIntentBits.Guilds] });
      discord.on("ready", () => console.log(`Discord connected as ${discord.user.tag}`));
      discord.on("error", error => console.error("Discord error:", error.message));
      discord.login(config.discordToken).catch(error => console.error("Discord login failed:", error.message));
    } catch (error) { console.error("Discord setup failed:", error.message); }
  }
  if (config.emailEnabled && config.smtpHost && config.smtpUser && config.smtpPass && config.emailTo) {
    smtp = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: { user: config.smtpUser, pass: config.smtpPass }
    });
    smtp.verify().then(() => console.log("Email SMTP verified.")).catch(error => console.error("SMTP verification failed:", error.message));
  }
}

export function serviceStatus() {
  return {
    pushConfigured: pushReady,
    emailConfigured: Boolean(smtp),
    discordConnected: Boolean(discord?.isReady())
  };
}

async function sendDiscord(result, options) {
  if (!discord?.isReady()) throw new Error("Discord is not connected.");
  const channel = await discord.channels.fetch(config.discordChannelId);
  if (!channel?.isTextBased()) throw new Error("Configured Discord channel is unavailable.");
  const mention = result.status === "in_stock" && config.discordRoleId ? `<@&${config.discordRoleId}>` : undefined;
  await channel.send({
    content: mention,
    embeds: [buildStatusEmbed(result, options)],
    components: [buildButtons(result)],
    allowedMentions: { roles: config.discordRoleId ? [config.discordRoleId] : [] }
  });
}

async function sendPush(result, options) {
  if (!pushReady) throw new Error("Browser push is not configured. Check the VAPID variables in Railway.");
  const db = await readDb();
  if (!db.subscriptions.length) {
    throw new Error("No browser is subscribed. Click Enable Browser Push on the device that should receive alerts.");
  }

  let sent = 0;
  let removed = 0;
  const failures = [];
  for (const sub of db.subscriptions) {
    try {
      await webpush.sendNotification(sub, JSON.stringify({
        title: options.test ? "🧪 Test Restock Alert" : result.status === "in_stock" ? "🟢 Back In Stock" : "Stock Status Changed",
        body: `${result.title}\n${result.storeName}${result.price ? ` • ${result.price}` : ""}`,
        url: result.url,
        image: result.image || null,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: `restock-${result.sku || result.url}`,
        status: result.status
      }), {
        TTL: 300,
        urgency: result.status === "in_stock" ? "high" : "normal"
      });
      sent++;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await removeSubscription(sub.endpoint);
        removed++;
      } else {
        failures.push(error.body || error.message || `HTTP ${error.statusCode || "error"}`);
      }
    }
  }

  if (!sent) {
    const detail = failures[0] || (removed ? "The saved subscription expired and was removed." : "Unknown push delivery error.");
    throw new Error(`Browser push sent to 0 devices. ${detail}`);
  }
  return { sent, removed, failed: failures.length };
}

async function sendEmail(result, options) {
  if (!smtp) throw new Error("Email is not configured.");
  const heading = options.test ? "TEST RESTOCK ALERT" : result.status === "in_stock" ? "BACK IN STOCK" : "STOCK STATUS CHANGED";
  await smtp.sendMail({
    from: config.emailFrom || config.smtpUser,
    to: config.emailTo,
    subject: `${options.test ? "TEST — " : ""}${heading}: ${result.title}`,
    text: `${heading}\n${result.title}\n${result.storeName}\n${result.price || ""}\n${result.url}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;padding:24px;background:#07111f;color:#fff;border-radius:16px"><div style="font-size:12px;letter-spacing:2px;color:#60a5fa;font-weight:bold">MICRO CENTER RESTOCK MONITOR</div><h1 style="margin-bottom:8px">${heading}</h1>${result.image ? `<img src="${result.image}" alt="" style="width:100%;max-height:300px;object-fit:contain;background:#fff;border-radius:12px">` : ""}<h2>${result.title}</h2><p style="font-size:18px"><b>${result.price || "Price not shown"}</b></p><p>${result.storeName} • ${result.sku ? `SKU ${result.sku}` : "SKU unavailable"}</p><p><a href="${result.url}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold">View at Micro Center</a></p></div>`
  });
}

export async function notify(result, options = {}) {
  const { test = false, only = null, previousStatus = null, previousPrice = null } = options;
  const out = {};
  const send = channel => !only || only === channel;
  const details = { test, previousStatus, previousPrice };

  if (send("discord")) {
    try { await sendDiscord(result, details); out.discord = "sent"; }
    catch (error) { out.discord = error.message; }
  }
  if (send("push")) {
    try { out.push = await sendPush(result, details); }
    catch (error) { out.push = error.message; }
  }
  if (send("email")) {
    try { await sendEmail(result, details); out.email = "sent"; }
    catch (error) { out.email = error.message; }
  }
  return out;
}
