import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import { config } from "./config.js";

function colorFor(status) {
  if (status === "in_stock") return 0x22c55e;
  if (status === "out_of_stock") return 0xef4444;
  return 0xf59e0b;
}

function labelFor(status) {
  if (status === "in_stock") return "IN STOCK";
  if (status === "out_of_stock") return "OUT OF STOCK";
  return "STATUS UNKNOWN";
}

function categoryFor(result) {
  return result.category || "Pokémon";
}

export function buildStatusEmbed(result, options = {}) {
  const { test = false, previousStatus = null, previousPrice = null } = options;
  const statusChanged = previousStatus && previousStatus !== result.status;
  const priceChanged = previousPrice && result.price && previousPrice !== result.price;
  const heading = test
    ? "🧪 TEST ALERT"
    : result.status === "in_stock"
      ? "🟢 BACK IN STOCK"
      : result.status === "out_of_stock"
        ? "🔴 OUT OF STOCK"
        : "🟡 STOCK CHECK NEEDED";

  const embed = new EmbedBuilder()
    .setColor(colorFor(result.status))
    .setTitle(heading)
    .setDescription(`**${result.title || "Micro Center Product"}**`)
    .addFields(
      { name: "Status", value: `**${labelFor(result.status)}**`, inline: true },
      { name: "Price", value: result.price || "Not shown", inline: true },
      { name: "Store", value: result.storeName || config.storeName, inline: true },
      { name: "Category", value: categoryFor(result), inline: true },
      { name: "SKU", value: result.sku || "Not shown", inline: true },
      { name: "Detected", value: `<t:${Math.floor(new Date(result.checkedAt || Date.now()).getTime() / 1000)}:R>`, inline: true }
    )
    .setURL(result.url)
    .setTimestamp(new Date(result.checkedAt || Date.now()))
    .setFooter({ text: test ? "Notification test" : "Micro Center Restock Monitor" });

  if (result.image) embed.setThumbnail(result.image);
  if (statusChanged) embed.addFields({ name: "Status Change", value: `${labelFor(previousStatus)} → ${labelFor(result.status)}` });
  if (priceChanged) embed.addFields({ name: "Price Change", value: `${previousPrice} → **${result.price}**` });

  return embed;
}

export function buildButtons(result) {
  const row = new ActionRowBuilder();
  row.addComponents(
    new ButtonBuilder().setLabel("View at Micro Center").setStyle(ButtonStyle.Link).setURL(result.url)
  );
  if (config.dashboardUrl) {
    row.addComponents(
      new ButtonBuilder().setLabel("Open Dashboard").setStyle(ButtonStyle.Link).setURL(config.dashboardUrl)
    );
  }
  return row;
}
