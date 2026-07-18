import "dotenv/config";
import path from "node:path";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  discordToken: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  guildId: process.env.DISCORD_GUILD_ID?.trim() || null,
  channelId: required("DISCORD_CHANNEL_ID"),
  roleId: process.env.DISCORD_ROLE_ID?.trim() || null,
  storeName: process.env.MICROCENTER_STORE_NAME?.trim() || "IL - Chicago",
  intervalSeconds: Math.max(60, Number(process.env.CHECK_INTERVAL_SECONDS || 120)),
  dataDir: process.env.DATA_DIR?.trim() || path.resolve("data"),
  seedDefaultWatch: (process.env.SEED_DEFAULT_WATCH || "true").toLowerCase() === "true",
  defaultProductUrl:
    process.env.DEFAULT_PRODUCT_URL?.trim() ||
    "https://www.microcenter.com/product/713503/nintendo-pokemon-mega-evolution-pitch-black-elite-trainer-box",
  port: Number(process.env.PORT || 8080),
  vapidPublicKey: process.env.VAPID_PUBLIC_KEY?.trim() || null,
  vapidPrivateKey: process.env.VAPID_PRIVATE_KEY?.trim() || null,
  vapidSubject: process.env.VAPID_SUBJECT?.trim() || null,
  emailAlertsEnabled: (process.env.EMAIL_ALERTS_ENABLED || "false").toLowerCase() === "true",
  emailTo: process.env.EMAIL_TO?.trim() || null,
  smtpHost: process.env.SMTP_HOST?.trim() || null,
  smtpPort: Number(process.env.SMTP_PORT || 587),
  smtpSecure: (process.env.SMTP_SECURE || "false").toLowerCase() === "true",
  smtpUser: process.env.SMTP_USER?.trim() || null,
  smtpPass: process.env.SMTP_PASS || null,
  emailFrom: process.env.EMAIL_FROM?.trim() || null
};
