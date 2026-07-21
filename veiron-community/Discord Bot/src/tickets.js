import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits
} from "discord.js";
import { createVireonEmbed } from "./embed-factory.js";
import { ROLE_NAMES } from "./template.js";
import { writeAuditLog } from "./audit-log.js";
import { sendPushNotification } from "./push-notifications.js";

const TICKETS_COLLECTION = "tickets";

export function registerTicketHandlers({ store, permissions }) {
  return async function handleTicketCommand(interaction) {
    if (interaction.isButton() && interaction.customId === "vireon_ticket:close") {
      await closeTicketFromButton(interaction, store, permissions);
      return true;
    }

    if (!interaction.isChatInputCommand() || interaction.commandName !== "ticket") {
      return false;
    }

    const subcommand = interaction.options.getSubcommand(true);

    if (subcommand === "open") {
      await openTicket(interaction, store);
      return true;
    }

    if (subcommand === "close") {
      await closeTicket(interaction, store, permissions);
      return true;
    }

    if (subcommand === "list") {
      await listTickets(interaction, store, permissions);
      return true;
    }

    return false;
  };
}

async function openTicket(interaction, store) {
  const topic = interaction.options.getString("topic", true);
  const guild = interaction.guild;
  await guild.roles.fetch();
  await guild.channels.fetch();

  const existing = (await store.list(TICKETS_COLLECTION)).find(
    (item) => item.userId === interaction.user.id && item.status === "open"
  );

  if (existing) {
    await interaction.reply({
      ephemeral: true,
      content: `You already have an open ticket: <#${existing.channelId}>`
    });
    return;
  }

  const category = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name === "SUPPORT AND SAFETY"
  );

  const staffRoles = [ROLE_NAMES.founder, ROLE_NAMES.coreTeam, ROLE_NAMES.admin, ROLE_NAMES.moderator]
    .map((name) => guild.roles.cache.find((role) => role.name === name))
    .filter(Boolean);

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AddReactions
      ]
    },
    ...staffRoles.map((role) => ({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    }))
  ];

  const channel = await guild.channels.create({
    name: `ticket-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90),
    type: ChannelType.GuildText,
    parent: category?.id,
    topic: `Ticket opened by ${interaction.user.tag}: ${topic}`,
    permissionOverwrites
  });

  const ticket = await store.add(TICKETS_COLLECTION, {
    guildId: interaction.guildId,
    channelId: channel.id,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    topic,
    status: "open"
  });

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [
      createVireonEmbed({
        title: "Vireon Support Ticket",
        description: [
          `Ticket: ${ticket.id}`,
          `Topic: ${topic}`,
          "",
          "A staff member will answer here. Do not share wallet seeds, private keys, passwords or production secrets."
        ].join("\n")
      })
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("vireon_ticket:close")
          .setLabel("Close Ticket")
          .setStyle(ButtonStyle.Danger)
      )
    ]
  });

  await writeAuditLog(guild, {
    title: "Ticket Opened",
    description: `Ticket ${ticket.id} by ${interaction.user.tag}`,
    fields: [{ name: "Channel", value: `<#${channel.id}>`, inline: true }],
    type: "ticket-opened",
    source: "ticket",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: interaction.user.id,
    targetTag: interaction.user.tag,
    channelId: channel.id,
    relatedId: ticket.id,
    metadata: { topic }
  }, { store });

  await sendPushNotification(store, {
    title: "New Vireon Ticket",
    body: `${interaction.user.tag}: ${topic}`,
    url: "/admin/#tickets"
  }, { roles: ["MODERATOR", "ADMIN", "SUPER_ADMIN"] });

  await interaction.reply({
    ephemeral: true,
    content: `Ticket opened: <#${channel.id}>`
  });
}

async function closeTicket(interaction, store, permissions) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({ ephemeral: true, content: "You do not have permission to close tickets." });
    return;
  }

  await closeCurrentTicket(interaction, store);
}

async function closeTicketFromButton(interaction, store, permissions) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({ ephemeral: true, content: "Only staff can close tickets." });
    return;
  }

  await closeCurrentTicket(interaction, store);
}

async function closeCurrentTicket(interaction, store) {
  const ticket = (await store.list(TICKETS_COLLECTION)).find(
    (item) => item.channelId === interaction.channelId && item.status === "open"
  );

  if (!ticket) {
    await interaction.reply({ ephemeral: true, content: "This channel is not an open ticket." });
    return;
  }

  await store.update(
    TICKETS_COLLECTION,
    (item) => item.id === ticket.id,
    () => ({
      status: "closed",
      closedByUserId: interaction.user.id,
      closedByTag: interaction.user.tag,
      closedAt: new Date().toISOString()
    })
  );

  await writeAuditLog(interaction.guild, {
    title: "Ticket Closed",
    description: `Ticket ${ticket.id} closed by ${interaction.user.tag}`,
    fields: [{ name: "Channel", value: `<#${interaction.channelId}>`, inline: true }],
    color: 0x27ae60,
    type: "ticket-closed",
    source: "ticket",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: ticket.userId,
    targetTag: ticket.userTag,
    channelId: interaction.channelId,
    relatedId: ticket.id,
    metadata: { topic: ticket.topic }
  }, { store });

  await interaction.reply({ ephemeral: true, content: "Ticket closed. This channel will be archived by permissions." });
  await interaction.channel.permissionOverwrites.edit(ticket.userId, {
    SendMessages: false,
    AddReactions: false
  });
}

async function listTickets(interaction, store, permissions) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({ ephemeral: true, content: "You do not have permission to list tickets." });
    return;
  }

  const openTickets = (await store.list(TICKETS_COLLECTION))
    .filter((item) => item.status === "open")
    .slice(-20)
    .reverse();

  await interaction.reply({
    ephemeral: true,
    embeds: [
      createVireonEmbed({
        title: "Open Tickets",
        description: openTickets.length
          ? openTickets.map((item) => `**${item.id}** | <#${item.channelId}> | ${item.userTag} | ${item.topic}`).join("\n")
          : "No open tickets.",
        color: 0x2f80ed
      })
    ]
  });
}
