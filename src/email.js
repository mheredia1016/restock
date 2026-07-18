import nodemailer from "nodemailer";
import { config } from "./config.js";

let transporter = null;

function getTransporter() {
  if (!config.emailAlertsEnabled) return null;
  if (!config.smtpHost || !config.smtpUser || !config.smtpPass || !config.emailTo) {
    throw new Error("Email alerts are enabled, but SMTP settings are incomplete.");
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpSecure,
      auth: {
        user: config.smtpUser,
        pass: config.smtpPass
      }
    });
  }

  return transporter;
}

function statusLabel(status) {
  if (status === "in_stock") return "IN STOCK";
  if (status === "out_of_stock") return "OUT OF STOCK";
  return "STATUS UNKNOWN";
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export async function sendEmailAlert(result, options = {}) {
  const mailer = getTransporter();
  if (!mailer) return { skipped: true };

  const isTest = options.test === true;
  const subjectPrefix = isTest ? "TEST — " : "";
  const subject = `${subjectPrefix}${statusLabel(result.status)}: ${result.title}`;

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:28px;">
    <div style="max-width:640px;margin:auto;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e8f0;">
      <div style="background:#0f172a;color:#ffffff;padding:24px 28px;">
        <div style="font-size:13px;font-weight:800;letter-spacing:1px;color:#93c5fd;">POKÉMON RESTOCK ALERT</div>
        <h1 style="font-size:26px;line-height:1.25;margin:10px 0 0;">${escapeHtml(result.title)}</h1>
      </div>
      <div style="padding:28px;">
        ${result.image ? `<img src="${escapeHtml(result.image)}" alt="" style="display:block;max-width:220px;max-height:220px;object-fit:contain;margin:0 auto 24px;">` : ""}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:16px;">
          <tr><td style="padding:8px 0;color:#64748b;">Store</td><td align="right" style="padding:8px 0;font-weight:700;">${escapeHtml(result.storeName)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Status</td><td align="right" style="padding:8px 0;font-weight:900;color:${result.status === "in_stock" ? "#16a34a" : "#dc2626"};">${statusLabel(result.status)}</td></tr>
          <tr><td style="padding:8px 0;color:#64748b;">Price</td><td align="right" style="padding:8px 0;font-weight:700;">${escapeHtml(result.price || "Not shown")}</td></tr>
        </table>
        <div style="padding-top:24px;text-align:center;">
          <a href="${escapeHtml(result.url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:800;padding:14px 22px;border-radius:10px;">Open Product</a>
        </div>
      </div>
    </div>
  </div>`;

  await mailer.sendMail({
    from: config.emailFrom || config.smtpUser,
    to: config.emailTo,
    subject,
    text: `${statusLabel(result.status)}\n${result.title}\n${result.storeName}\n${result.price || ""}\n${result.url}`,
    html
  });

  return { sent: true };
}

export async function verifyEmailTransport() {
  const mailer = getTransporter();
  if (!mailer) return { enabled: false };
  await mailer.verify();
  return { enabled: true, verified: true };
}
