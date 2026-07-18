import { SlashCommandBuilder } from "discord.js";

export const command = new SlashCommandBuilder()
  .setName("watch")
  .setDescription("Manage Micro Center product restock watches")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Watch a Micro Center product")
      .addStringOption((option) =>
        option.setName("url").setDescription("Micro Center product URL").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List watched products")
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Remove a watch")
      .addStringOption((option) =>
        option.setName("id").setDescription("Watch ID from /watch list").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("check")
      .setDescription("Check one product or all products now")
      .addStringOption((option) =>
        option.setName("id").setDescription("Optional watch ID").setRequired(false)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("pause")
      .setDescription("Pause a watch")
      .addStringOption((option) =>
        option.setName("id").setDescription("Watch ID").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("resume")
      .setDescription("Resume a watch")
      .addStringOption((option) =>
        option.setName("id").setDescription("Watch ID").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub.setName("test").setDescription("Send a test alert")
  );

export const commandJson = command.toJSON();
