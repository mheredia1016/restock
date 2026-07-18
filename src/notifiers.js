import webpush from "web-push";
import nodemailer from "nodemailer";
import { Client, GatewayIntentBits } from "discord.js";
import { config } from "./config.js";
import { readDb, removeSubscription } from "./store.js";

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

export async function notify(result, { test = false } = {}) {
  const out = {};
  const heading = test ? "TEST RESTOCK ALERT" : result.status === "in_stock" ? "IN STOCK" : "STATUS CHANGED";
  if (discord?.isReady()) {
    try {
      const channel = await discord.channels.fetch(config.discordChannelId);
      await channel.send({ content: `🚨 **${heading}**\n**${result.title}**\n${result.storeName}${result.price ? ` • ${result.price}` : ""}\n${result.url}` });
      out.discord = "sent";
    } catch (error) { out.discord = error.message; }
  }
  if (pushReady) {
    const db = await readDb();
    let sent = 0;
    for (const sub of db.subscriptions) {
      try {
        await webpush.sendNotification(sub, JSON.stringify({
          title: `🚨 ${heading}`,
          body: `${result.title}\n${result.storeName}${result.price ? ` • ${result.price}` : ""}`,
          url: result.url,
          image: result.image,
          tag: `restock-${result.sku || result.url}`,
          status: result.status
        }));
        sent++;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) await removeSubscription(sub.endpoint);
      }
    }
    out.push = sent;
  }
  if (smtp) {
    try {
      await smtp.sendMail({
        from: config.emailFrom || config.smtpUser,
        to: config.emailTo,
        subject: `${test ? "TEST — " : ""}${heading}: ${result.title}`,
        text: `${heading}\n${result.title}\n${result.storeName}\n${result.price || ""}\n${result.url}`,
        html: `<div style="font-family:Arial;padding:24px"><h1>${heading}</h1><h2>${result.title}</h2><p><b>${result.storeName}</b>${result.price ? ` • ${result.price}` : ""}</p><p><a href="${result.url}">Open Product</a></p></div>`
      });
      out.email = "sent";
    } catch (error) { out.email = error.message; }
  }
  return out;
}
