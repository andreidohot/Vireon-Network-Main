import { ChannelType, PermissionFlagsBits } from "discord.js";
import { createVireonEmbed } from "./embed-factory.js";
import { writeAuditLog } from "./audit-log.js";

const CASES_COLLECTION = "moderation-cases";

export function registerModerationHandlers({ store, permissions }) {
  return async function handleModerationCommand(interaction) {
    if (!["warn", "mute", "unmute", "kick", "ban", "purge", "cases"].includes(interaction.commandName)) {
      return false;
    }

    if (!canModerate(interaction, permissions)) {
      await interaction.reply({
        ephemeral: true,
        content: "You do not have permission to use moderation tools."
      });
      return true;
    }

    if (interaction.commandName === "warn") {
      await handleWarn(interaction, store);
      return true;
    }

    if (interaction.commandName === "mute") {
      await handleMute(interaction, store);
      return true;
    }

    if (interaction.commandName === "unmute") {
      await handleUnmute(interaction, store);
      return true;
    }

    if (interaction.commandName === "kick") {
      await handleKick(interaction, store);
      return true;
    }

    if (interaction.commandName === "ban") {
      await handleBan(interaction, store);
      return true;
    }

    if (interaction.commandName === "purge") {
      await handlePurge(interaction, store);
      return true;
    }

    if (interaction.commandName === "cases") {
      await handleCases(interaction, store);
      return true;
    }

    return false;
  };
}

function canModerate(interaction, permissions) {
  return (
    permissions.canManageCommunityBot(interaction) ||
    permissions.hasPermission(interaction, PermissionFlagsBits.ModerateMembers) ||
    permissions.hasPermission(interaction, PermissionFlagsBits.ManageMessages)
  );
}

async function handleWarn(interaction, store) {
  const user = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const caseItem = await createCase(interaction, store, {
    type: "warn",
    targetUserId: user.id,
    targetTag: user.tag,
    reason
  });

  await writeAuditLog(interaction.guild, {
    title: "Warning Issued",
    description: `Case ${caseItem.id}`,
    fields: caseFields(caseItem),
    type: "warn",
    source: "moderation",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: user.id,
    targetTag: user.tag,
    channelId: interaction.channelId,
    relatedId: caseItem.id
  }, { store });

  await interaction.reply({
    ephemeral: true,
    content: `Warning logged for ${user.tag}. Case: ${caseItem.id}`
  });
}

async function handleMute(interaction, store) {
  const member = interaction.options.getMember("user");
  const minutes = interaction.options.getInteger("minutes", true);
  const reason = interaction.options.getString("reason", true);

  if (!member) {
    await interaction.reply({ ephemeral: true, content: "Member not found in this server." });
    return;
  }

  const durationMs = Math.max(1, Math.min(minutes, 40320)) * 60 * 1000;
  await member.timeout(durationMs, reason);

  const caseItem = await createCase(interaction, store, {
    type: "mute",
    targetUserId: member.user.id,
    targetTag: member.user.tag,
    reason,
    durationMinutes: minutes
  });

  await writeAuditLog(interaction.guild, {
    title: "Member Muted",
    description: `Case ${caseItem.id}`,
    fields: caseFields(caseItem),
    type: "mute",
    source: "moderation",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: member.user.id,
    targetTag: member.user.tag,
    channelId: interaction.channelId,
    relatedId: caseItem.id,
    metadata: { durationMinutes: minutes }
  }, { store });

  await interaction.reply({
    ephemeral: true,
    content: `Muted ${member.user.tag} for ${minutes} minute(s). Case: ${caseItem.id}`
  });
}

async function handleUnmute(interaction, store) {
  const member = interaction.options.getMember("user");
  const reason = interaction.options.getString("reason", false) ?? "No reason provided.";

  if (!member) {
    await interaction.reply({ ephemeral: true, content: "Member not found in this server." });
    return;
  }

  await member.timeout(null, reason);

  const caseItem = await createCase(interaction, store, {
    type: "unmute",
    targetUserId: member.user.id,
    targetTag: member.user.tag,
    reason
  });

  await writeAuditLog(interaction.guild, {
    title: "Member Unmuted",
    description: `Case ${caseItem.id}`,
    fields: caseFields(caseItem),
    color: 0x27ae60,
    type: "unmute",
    source: "moderation",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: member.user.id,
    targetTag: member.user.tag,
    channelId: interaction.channelId,
    relatedId: caseItem.id
  }, { store });

  await interaction.reply({
    ephemeral: true,
    content: `Unmuted ${member.user.tag}. Case: ${caseItem.id}`
  });
}

async function handleKick(interaction, store) {
  const member = interaction.options.getMember("user");
  const reason = interaction.options.getString("reason", true);

  if (!member) {
    await interaction.reply({ ephemeral: true, content: "Member not found in this server." });
    return;
  }

  if (!member.kickable) {
    await interaction.reply({ ephemeral: true, content: "I cannot kick this member. Check role hierarchy and bot permissions." });
    return;
  }

  await member.kick(reason);

  const caseItem = await createCase(interaction, store, {
    type: "kick",
    targetUserId: member.user.id,
    targetTag: member.user.tag,
    reason
  });

  await writeAuditLog(interaction.guild, {
    title: "Member Kicked",
    description: `Case ${caseItem.id}`,
    fields: caseFields(caseItem),
    color: 0xeb5757,
    type: "kick",
    source: "moderation",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: member.user.id,
    targetTag: member.user.tag,
    channelId: interaction.channelId,
    relatedId: caseItem.id
  }, { store });

  await interaction.reply({
    ephemeral: true,
    content: `Kicked ${member.user.tag}. Case: ${caseItem.id}`
  });
}

async function handleBan(interaction, store) {
  const user = interaction.options.getUser("user", true);
  const reason = interaction.options.getString("reason", true);
  const deleteMessageDays = interaction.options.getInteger("delete_message_days", false) ?? 0;

  await interaction.guild.members.ban(user.id, {
    reason,
    deleteMessageSeconds: Math.max(0, Math.min(deleteMessageDays, 7)) * 24 * 60 * 60
  });

  const caseItem = await createCase(interaction, store, {
    type: "ban",
    targetUserId: user.id,
    targetTag: user.tag,
    reason,
    deleteMessageDays
  });

  await writeAuditLog(interaction.guild, {
    title: "Member Banned",
    description: `Case ${caseItem.id}`,
    fields: caseFields(caseItem),
    color: 0xeb5757,
    type: "ban",
    source: "moderation",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: user.id,
    targetTag: user.tag,
    channelId: interaction.channelId,
    relatedId: caseItem.id,
    metadata: { deleteMessageDays }
  }, { store });

  await interaction.reply({
    ephemeral: true,
    content: `Banned ${user.tag}. Case: ${caseItem.id}`
  });
}

async function handlePurge(interaction, store) {
  const amount = interaction.options.getInteger("amount", true);
  const reason = interaction.options.getString("reason", false) ?? "No reason provided.";

  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({ ephemeral: true, content: "Purge works only in text channels." });
    return;
  }

  const safeAmount = Math.max(1, Math.min(amount, 100));
  const deleted = await interaction.channel.bulkDelete(safeAmount, true);

  const caseItem = await createCase(interaction, store, {
    type: "purge",
    targetUserId: "channel",
    targetTag: `#${interaction.channel.name}`,
    reason,
    messageCount: deleted.size
  });

  await writeAuditLog(interaction.guild, {
    title: "Messages Purged",
    description: `Case ${caseItem.id}`,
    fields: caseFields(caseItem),
    type: "purge",
    source: "moderation",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: "channel",
    targetTag: `#${interaction.channel.name}`,
    channelId: interaction.channelId,
    relatedId: caseItem.id,
    metadata: { messageCount: deleted.size }
  }, { store });

  await interaction.reply({
    ephemeral: true,
    content: `Deleted ${deleted.size} message(s). Case: ${caseItem.id}`
  });
}

async function handleCases(interaction, store) {
  const user = interaction.options.getUser("user", true);
  const cases = (await store.list(CASES_COLLECTION))
    .filter((item) => item.targetUserId === user.id)
    .slice(-10)
    .reverse();

  if (cases.length === 0) {
    await interaction.reply({ ephemeral: true, content: `No cases found for ${user.tag}.` });
    return;
  }

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createVireonEmbed({
        title: `Moderation Cases: ${user.tag}`,
        description: cases
          .map((item) => `**${item.id}** | ${item.type} | ${item.reason}`)
          .join("\n"),
        color: 0xf2994a
      })
    ]
  });
}

async function createCase(interaction, store, data) {
  return store.add(CASES_COLLECTION, {
    guildId: interaction.guildId,
    moderatorUserId: interaction.user.id,
    moderatorTag: interaction.user.tag,
    channelId: interaction.channelId,
    ...data
  });
}

function caseFields(caseItem) {
  return [
    { name: "Type", value: caseItem.type, inline: true },
    { name: "Target", value: caseItem.targetTag, inline: true },
    { name: "Moderator", value: caseItem.moderatorTag, inline: true },
    { name: "Reason", value: caseItem.reason.slice(0, 1024), inline: false }
  ];
}
