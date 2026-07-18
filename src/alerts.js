import { EmbedBuilder } from "discord.js";
import { config } from "./config.js";

function colorFor(status) {
  if (status === "in_stock") return 0x2ecc71;
  if (status === "out_of_stock") return 0xe74c3c;
  return 0xf1c40f;
}

function labelFor(status) {
  if (status === "in_stock") return "IN STOCK";
  if (status === "out_of_stock") return "OUT OF STOCK";
  return "STATUS UNKNOWN";
}

export function buildStatusEmbed(result, options = {}) {
  const { test = false, priceChanged = false } = options;
  const heading = test
    ? "🧪 TEST ALERT"
    : result.status === "in_stock"
      ? "🚨 POKÉMON RESTOCK"
      : result.status === "out_of_stock"
        ? "❌ STOCK UPDATE"
        : "⚠️ CHECK NEEDED";

  const embed = new EmbedBuilder()
    .setColor(colorFor(result.status))
    .setTitle(heading)
    .setDescription(`**${result.title}**`)
    .addFields(
      { name: "Store", value: result.storeName, inline: true },
      { name: "Status", value: `**${labelFor(result.status)}**`, inline: true },
      { name: "Price", value: result.price || "Not shown", inline: true }
    )
    .setURL(result.url)
    .setTimestamp(new Date(result.checkedAt || Date.now()))
    .setFooter({ text: result.sku ? `Micro Center SKU ${result.sku}` : "Micro Center watcher" });

  if (result.image) embed.setThumbnail(result.image);
  if (priceChanged) embed.addFields({ name: "Price change", value: "The listed price changed." });

  return embed;
}

export async function sendAlert(client, result, options = {}) {
  const channel = await client.channels.fetch(config.channelId);
  if (!channel?.isTextBased()) {
    throw new Error("DISCORD_CHANNEL_ID is not a text channel the bot can access.");
  }

  const mention =
    result.status === "in_stock" && config.roleId ? `<@&${config.roleId}>` : undefined;

  await channel.send({
    content: mention,
    embeds: [buildStatusEmbed(result, options)],
    allowedMentions: { roles: config.roleId ? [config.roleId] : [] }
  });
}
