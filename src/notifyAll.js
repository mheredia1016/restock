import { sendAlert as sendDiscordAlert } from "./alerts.js";
import { sendBrowserPush } from "./push.js";
import { sendEmailAlert } from "./email.js";

export async function sendAllAlerts(client, result, options = {}) {
  const tasks = [
    ["discord", () => sendDiscordAlert(client, result, options)],
    ["push", () => sendBrowserPush(result, options)],
    ["email", () => sendEmailAlert(result, options)]
  ];

  const output = {};

  for (const [name, fn] of tasks) {
    try {
      output[name] = await fn();
    } catch (error) {
      console.error(`${name} notification failed:`, error.message);
      output[name] = { error: error.message };
    }
  }

  return output;
}
