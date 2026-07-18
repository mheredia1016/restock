import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  Events,
  GatewayIntentBits,
  REST,
  Routes
} from "discord.js";
import { config } from "./config.js";
import { commandJson } from "./commands.js";
import { addWatch, readDb, removeWatch, setEnabled } from "./store.js";
import { validateMicroCenterUrl, checkMicroCenterProduct } from "./microcenter.js";
import { checkAll, checkOne } from "./checker.js";
import { sendAlert } from "./alerts.js";

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, "../public");

app.use(express.json());

function dashboardAuth(req, res, next) {
  const password = process.env.DASHBOARD_PASSWORD?.trim();
  if (!password) return next();

  const header = req.headers.authorization || "";
  const [type, encoded] = header.split(" ");
  if (type === "Basic" && encoded) {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const submitted = decoded.includes(":") ? decoded.slice(decoded.indexOf(":") + 1) : "";
    if (submitted === password) return next();
  }

  res.set("WWW-Authenticate", 'Basic realm="Pokemon Restock Dashboard"');
  return res.status(401).send("Authentication required.");
}

app.get("/health", async (_req, res) => {
  const db = await readDb();
  res.json({
    ok: true,
    discordReady: client.isReady(),
    watches: db.watches.length,
    enabled: db.watches.filter((watch) => watch.enabled).length,
    store: config.storeName
  });
});

app.use(dashboardAuth);
app.use(express.static(publicDir));

app.get("/api/dashboard", async (_req, res) => {
  const db = await readDb();
  const lastScanAt = db.watches
    .map((watch) => watch.lastCheckedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || null;

  res.json({
    ok: true,
    discordReady: client.isReady(),
    storeName: config.storeName,
    intervalSeconds: config.intervalSeconds,
    lastScanAt,
    watches: db.watches
  });
});

app.post("/api/watches", async (req, res) => {
  try {
    const url = validateMicroCenterUrl(req.body?.url || "");
    const { watch, created } = await addWatch(url, config.storeName);
    const checked = await checkOne(client, watch, { manual: true });

    if (!checked.ok) {
      return res.status(502).json({
        error: `Watch ${created ? "added" : "found"}, but the stock check failed: ${checked.error}`,
        watch,
        created
      });
    }

    return res.status(created ? 201 : 200).json({
      ok: true,
      created,
      watch: { ...watch, ...checked.result }
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.patch("/api/watches/:id", async (req, res) => {
  const enabled = req.body?.enabled;
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be true or false." });
  }

  const watch = await setEnabled(req.params.id, enabled);
  if (!watch) return res.status(404).json({ error: "Watch not found." });
  return res.json({ ok: true, watch });
});

app.delete("/api/watches/:id", async (req, res) => {
  const removed = await removeWatch(req.params.id);
  if (!removed) return res.status(404).json({ error: "Watch not found." });
  return res.json({ ok: true, removed });
});

app.post("/api/watches/:id/check", async (req, res) => {
  const db = await readDb();
  const watch = db.watches.find((item) => item.id === req.params.id);
  if (!watch) return res.status(404).json({ error: "Watch not found." });

  const checked = await checkOne(client, watch, { manual: true });
  if (!checked.ok) return res.status(502).json({ error: checked.error });
  return res.json({ ok: true, ...checked });
});

app.post("/api/check-all", async (_req, res) => {
  const results = await checkAll(client);
  return res.json({
    ok: true,
    checked: results.length,
    successful: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(publicDir, "index.html"));
});

app.listen(config.port, () => {
  console.log(`Web dashboard listening on ${config.port}`);
});

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(config.discordToken);
  const route = config.guildId
    ? Routes.applicationGuildCommands(config.clientId, config.guildId)
    : Routes.applicationCommands(config.clientId);

  await rest.put(route, { body: [commandJson] });
  console.log(
    config.guildId
      ? `Registered guild slash commands for ${config.guildId}.`
      : "Registered global slash commands."
  );
}

async function seed() {
  if (!config.seedDefaultWatch) return;
  const db = await readDb();
  if (db.watches.length === 0) {
    const seeded = await addWatch(config.defaultProductUrl, config.storeName);
    console.log(`Seeded default watch ${seeded.watch.id}.`);
  }
}

function statusEmoji(status) {
  if (status === "in_stock") return "🟢";
  if (status === "out_of_stock") return "🔴";
  return "🟡";
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  await registerCommands();
  await seed();
  await checkAll(client);

  setInterval(() => {
    checkAll(client).catch((error) => console.error("Scheduled scan failed:", error));
  }, config.intervalSeconds * 1000);

  console.log(`Scheduled every ${config.intervalSeconds} seconds.`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || interaction.commandName !== "watch") return;

  const subcommand = interaction.options.getSubcommand();
  await interaction.deferReply({ ephemeral: true });

  try {
    if (subcommand === "add") {
      const url = validateMicroCenterUrl(interaction.options.getString("url", true));
      const { watch, created } = await addWatch(url, config.storeName);
      const checked = await checkOne(client, watch, { manual: true });

      if (!checked.ok) {
        await interaction.editReply(
          `${created ? "Watch added" : "Already watching"} as \`${watch.id}\`, but the first check failed: ${checked.error}`
        );
        return;
      }

      await interaction.editReply(
        `${created ? "Added" : "Already watching"} **${checked.result.title}** for **${config.storeName}**.\n` +
        `ID: \`${watch.id}\`\nCurrent status: **${checked.result.status.replaceAll("_", " ")}**`
      );
      return;
    }

    if (subcommand === "list") {
      const db = await readDb();
      if (!db.watches.length) {
        await interaction.editReply("No products are currently being watched.");
        return;
      }

      const lines = db.watches.map((watch) => {
        const state = watch.enabled ? statusEmoji(watch.lastStatus) : "⏸️";
        return `${state} \`${watch.id}\` **${watch.title || "Pending first check"}**\n` +
          `${watch.storeName} • ${watch.enabled ? "enabled" : "paused"} • ${watch.lastPrice || "price unknown"}\n` +
          `${watch.url}`;
      });

      await interaction.editReply(lines.join("\n\n").slice(0, 1900));
      return;
    }

    if (subcommand === "remove") {
      const id = interaction.options.getString("id", true).trim();
      const removed = await removeWatch(id);
      await interaction.editReply(
        removed ? `Removed **${removed.title || removed.url}**.` : `No watch found with ID \`${id}\`.`
      );
      return;
    }

    if (subcommand === "pause" || subcommand === "resume") {
      const id = interaction.options.getString("id", true).trim();
      const watch = await setEnabled(id, subcommand === "resume");
      await interaction.editReply(
        watch
          ? `${subcommand === "resume" ? "Resumed" : "Paused"} **${watch.title || watch.url}**.`
          : `No watch found with ID \`${id}\`.`
      );
      return;
    }

    if (subcommand === "check") {
      const id = interaction.options.getString("id")?.trim();
      const db = await readDb();
      const selected = id ? db.watches.filter((watch) => watch.id === id) : db.watches;

      if (!selected.length) {
        await interaction.editReply(id ? `No watch found with ID \`${id}\`.` : "No watches found.");
        return;
      }

      const outputs = [];
      for (const watch of selected) {
        const checked = await checkOne(client, watch, { manual: true });
        outputs.push(
          checked.ok
            ? `${statusEmoji(checked.result.status)} **${checked.result.title}** — ${checked.result.status.replaceAll("_", " ")}${checked.result.price ? ` — ${checked.result.price}` : ""}`
            : `⚠️ \`${watch.id}\` — ${checked.error}`
        );
      }

      await interaction.editReply(outputs.join("\n").slice(0, 1900));
      return;
    }

    if (subcommand === "test") {
      const db = await readDb();
      const watch = db.watches[0];
      let result;

      if (watch) {
        result = await checkMicroCenterProduct(watch.url, watch.storeName);
      } else {
        result = {
          title: "Test Pokémon Product",
          url: "https://www.microcenter.com/",
          storeName: config.storeName,
          status: "in_stock",
          price: "$59.99",
          sku: "TEST",
          image: null,
          checkedAt: new Date().toISOString()
        };
      }

      await sendAlert(client, { ...result, status: "in_stock" }, { test: true });
      await interaction.editReply("Test alert sent.");
    }
  } catch (error) {
    console.error("Command failed:", error);
    await interaction.editReply(`Command failed: ${error.message}`);
  }
});

process.on("unhandledRejection", (error) => console.error("Unhandled rejection:", error));
process.on("uncaughtException", (error) => console.error("Uncaught exception:", error));

client.login(config.discordToken);
