import { ChannelType } from "discord.js";
import { writeAuditLog } from "./audit-log.js";
import { createVireonEmbed } from "./embed-factory.js";
import { getSettings } from "./config.js";
import { childLogger, serializeError } from "./logger.js";

const ANNOUNCEMENTS_COLLECTION = "announcements";
const logger = childLogger({ module: "announcements" });

export function registerAnnouncementHandlers({ store, permissions }) {
  return async function handleAnnouncementCommand(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "announce") {
      return false;
    }

    if (!permissions.canManageCommunityBot(interaction)) {
      await interaction.reply({ ephemeral: true, content: "You do not have permission to publish announcements." });
      return true;
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "publish") {
      await publishAnnouncement(interaction, store);
      return true;
    }

    if (subcommand === "draft") {
      await draftAnnouncement(interaction, store);
      return true;
    }

    if (subcommand === "list") {
      await listAnnouncements(interaction, store);
      return true;
    }

    if (subcommand === "schedule") {
      await scheduleAnnouncement(interaction, store);
      return true;
    }

    return false;
  };
}

export function startAnnouncementScheduler({ client, guildId, store }) {
  const interval = setInterval(async () => {
    await publishDueAnnouncements({ client, guildId, store }).catch((error) => {
      logger.error({ error: serializeError(error) }, "Announcement scheduler failed.");
    });
  }, 30_000);

  return interval;
}

async function publishAnnouncement(interaction, store) {
  const channel = interaction.options.getChannel("channel", false) ?? await findDefaultAnnouncementChannel(interaction, store);
  const title = interaction.options.getString("title", true);
  const body = interaction.options.getString("body", true);
  const status = interaction.options.getString("status", false) ?? "Draft";

  if (!channel?.isTextBased()) {
    await interaction.reply({ ephemeral: true, content: "No valid announcement channel found." });
    return;
  }

  const announcement = await store.add(ANNOUNCEMENTS_COLLECTION, {
    title,
    body,
    status,
    channelId: channel.id,
    authorUserId: interaction.user.id,
    authorTag: interaction.user.tag,
    published: true
  });

  const message = await channel.send({
    embeds: [
      createVireonEmbed({
        title,
        description: [`Status: **${status}**`, "", body].join("\n"),
        color: 0xd4af37
      })
    ]
  });

  await store.update(
    ANNOUNCEMENTS_COLLECTION,
    (item) => item.id === announcement.id,
    () => ({ messageId: message.id })
  );

  await writeAuditLog(interaction.guild, {
    title: "Announcement Published",
    description: `${title} -> <#${channel.id}>`,
    color: 0x2f80ed,
    type: "announcement-published",
    source: "announcement",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    channelId: channel.id,
    relatedId: announcement.id,
    metadata: { title, status, messageId: message.id }
  }, { store });

  await interaction.reply({ ephemeral: true, content: `Announcement published in #${channel.name}.` });
}

async function draftAnnouncement(interaction, store) {
  const title = interaction.options.getString("title", true);
  const body = interaction.options.getString("body", true);
  const status = interaction.options.getString("status", false) ?? "Draft";

  const announcement = await store.add(ANNOUNCEMENTS_COLLECTION, {
    title,
    body,
    status,
    authorUserId: interaction.user.id,
    authorTag: interaction.user.tag,
    published: false
  });

  await interaction.reply({
    ephemeral: true,
    content: `Draft saved. ID: ${announcement.id}`
  });
}

async function scheduleAnnouncement(interaction, store) {
  const channel = interaction.options.getChannel("channel", false) ?? await findDefaultAnnouncementChannel(interaction, store);
  const title = interaction.options.getString("title", true);
  const body = interaction.options.getString("body", true);
  const scheduledAt = interaction.options.getString("scheduled_at", true);
  const status = interaction.options.getString("status", false) ?? "Draft";
  const date = new Date(scheduledAt);

  if (Number.isNaN(date.getTime())) {
    await interaction.reply({ ephemeral: true, content: "Invalid scheduled_at value. Use ISO format, for example 2026-07-05T12:00:00.000Z." });
    return;
  }

  if (!channel?.isTextBased()) {
    await interaction.reply({ ephemeral: true, content: "No valid announcement channel found." });
    return;
  }

  const announcement = await store.add(ANNOUNCEMENTS_COLLECTION, {
    title,
    body,
    status,
    channelId: channel.id,
    authorUserId: interaction.user.id,
    authorTag: interaction.user.tag,
    published: false,
    scheduledAt: date.toISOString()
  });

  await interaction.reply({
    ephemeral: true,
    content: `Announcement scheduled for ${date.toISOString()}. ID: ${announcement.id}`
  });
}

async function listAnnouncements(interaction, store) {
  const items = (await store.list(ANNOUNCEMENTS_COLLECTION)).slice(-10).reverse();

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createVireonEmbed({
        title: "Recent Announcements",
        description: items.length
          ? items.map((item) => `**${item.id}** | ${item.published ? "Published" : "Draft"} | ${item.status} | ${item.title}`).join("\n")
          : "No announcements saved yet.",
        color: 0x2f80ed
      })
    ]
  });
}

async function findDefaultAnnouncementChannel(interaction, store) {
  const settings = await getSettings(store);
  const channelName = settings.announcements?.defaultChannelName ?? "announcements";
  return interaction.guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === channelName
  );
}

async function publishDueAnnouncements({ client, guildId, store }) {
  const now = Date.now();
  const announcements = await store.list(ANNOUNCEMENTS_COLLECTION);
  const due = announcements.filter((item) =>
    item.scheduledAt &&
    !item.published &&
    !item.cancelled &&
    new Date(item.scheduledAt).getTime() <= now
  );

  if (due.length === 0) return;

  const guild = await client.guilds.fetch(guildId);

  for (const announcement of due) {
    const channel = await client.channels.fetch(announcement.channelId).catch(() => null);
    if (!channel?.isTextBased()) continue;

    const message = await channel.send({
      embeds: [
        createVireonEmbed({
          title: announcement.title,
          description: [`Status: **${announcement.status}**`, "", announcement.body].join("\n"),
          color: 0xd4af37
        })
      ]
    });

    await store.update(
      ANNOUNCEMENTS_COLLECTION,
      (item) => item.id === announcement.id,
      () => ({
        published: true,
        publishedAt: new Date().toISOString(),
        messageId: message.id
      })
    );

    await writeAuditLog(guild, {
      title: "Scheduled Announcement Published",
      description: `${announcement.title} -> <#${channel.id}>`,
      color: 0x2f80ed,
      type: "scheduled-announcement-published",
      source: "announcement",
      actorUserId: announcement.authorUserId,
      actorTag: announcement.authorTag,
      channelId: channel.id,
      relatedId: announcement.id,
      metadata: { title: announcement.title, status: announcement.status, messageId: message.id }
    }, { store });
  }
}
