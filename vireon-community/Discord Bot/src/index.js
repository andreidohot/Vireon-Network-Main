import "dotenv/config";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits
} from "discord.js";
import { registerAnnouncementHandlers, startAnnouncementScheduler } from "./announcements.js";
import { startAdminPanel } from "./admin-panel.js";
import { registerAntiSpam } from "./anti-spam.js";
import { registerAutomod } from "./automod.js";
import { registerAutomationRuntime } from "./automations-studio.js";
import { startBackupScheduler } from "./backup.js";
import { createChainClient } from "./chain-client.js";
import { registerCommandCenterHandlers } from "./command-center.js";
import { registerCommunityEvents } from "./community.js";
import { getSettings } from "./config.js";
import { registerCustomCommandRuntime, registerCustomInteractionRuntime } from "./custom-controls.js";
import { createVireonEmbed } from "./embed-factory.js";
import { registerEconomyHandlers } from "./economy.js";
import { childLogger, logger, serializeError } from "./logger.js";
import { createMusicManager, registerMusicHandlers } from "./music.js";
import { registerMusicPlaylistHandlers } from "./music-playlists.js";
import { startOnChainSyncWorker } from "./onchain-sync.js";
import { registerModerationHandlers } from "./moderation.js";
import { PermissionController } from "./permission-controller.js";
import { registerPaymentHandlers } from "./payments.js";
import { registerProposalHandlers } from "./proposals.js";
import { registerRankHandlers } from "./rank-commands.js";
import { registerRewardsHandlers } from "./rewards.js";
import { createStore } from "./store-factory.js";
import { getSetupWizardStatus, hasDiscordRuntimeConfig, loadRuntimeConfigIntoEnv } from "./runtime-config.js";
import { registerTagHandlers } from "./tags.js";
import { registerTicketHandlers } from "./tickets.js";
import { registerTriggerHandlers, registerTriggerResponder } from "./triggers.js";
import { createWalletRegistrationService, registerWalletRegistrationHandlers } from "./wallet-registration.js";
import { registerXpLeveling } from "./xp-leveling.js";
import { applyXpRoleRewards } from "./xp-role-rewards.js";
import {
  ROLE_BUTTONS,
  ROLE_NAMES,
  ROLE_TEMPLATE,
  getSetupChannelTemplate,
  getSetupRoleTemplate,
  getSetupSeedMessages,
  describeSetupPlan,
  normalizeSetupTemplateId,
  permissionBits
} from "./template.js";

await loadRuntimeConfigIntoEnv();
const setupWizardStatus = await getSetupWizardStatus();

const token = process.env.DISCORD_TOKEN;
const guildId = process.env.DISCORD_GUILD_ID;
const allowedUserIds = new Set(
  (process.env.SETUP_ALLOWED_USER_IDS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const permissions = new PermissionController({
  setupAllowedUserIds: [...allowedUserIds]
});
const runtimeLogger = childLogger({ module: "runtime" });
process.on("unhandledRejection", (error) => {
  logger.error({ error: serializeError(error) }, "Unhandled promise rejection.");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error: serializeError(error) }, "Uncaught exception.");
  process.exitCode = 1;
});

let client = null;

if (!hasDiscordRuntimeConfig()) {
  const bootstrapChainClient = createChainClient();
  const bootstrapMusicManager = { async healthCheck() { return { ok: true, status: "disabled", component: "lavalink" }; } };
  await startAdminPanel({
    client: null,
    guildId: null,
    store: null,
    permissions,
    musicManager: bootstrapMusicManager,
    chainClient: bootstrapChainClient,
    walletRegistration: null,
    setupWizardStatus
  }).catch((error) => {
    runtimeLogger.error({ error: serializeError(error) }, "Setup wizard admin panel failed to start.");
    process.exitCode = 1;
  });
  runtimeLogger.warn({ missing: setupWizardStatus.missing }, "Discord runtime config is missing. Started Admin Web in setup wizard mode only.");
} else {
const store = await createStore();
permissions.configure((await getSettings(store)).permissions);
const chainClient = createChainClient();
const walletRegistration = await createWalletRegistrationService({ store });
const handleModerationCommand = registerModerationHandlers({ store, permissions });
const handleTicketCommand = registerTicketHandlers({ store, permissions });
const handleAnnouncementCommand = registerAnnouncementHandlers({ store, permissions });
const handleProposalInteraction = registerProposalHandlers({ store, permissions });
const handleRankCommand = registerRankHandlers({ store });
const handleRewardsCommand = registerRewardsHandlers({ store, chainClient });
const handleRegisterCommand = registerWalletRegistrationHandlers({ walletRegistration });
const handlePaymentInteraction = registerPaymentHandlers({ store, walletRegistration, chainClient });
const handleEconomyCommand = registerEconomyHandlers({ store, permissions });
const handleTagCommand = registerTagHandlers({ store, permissions });
const handleTriggerCommand = registerTriggerHandlers({ store, permissions });
const handleTriggerMessage = registerTriggerResponder({ store });
const handleCustomCommandRuntime = registerCustomCommandRuntime({ store });
const handleCustomInteractionRuntime = registerCustomInteractionRuntime({ store });
const handleCommandCenter = registerCommandCenterHandlers({ client, guildId, store, permissions });
const automationRuntime = registerAutomationRuntime({ store });
const handleAutomodMessage = registerAutomod({ store, permissions });
const handleAntiSpamMessage = registerAntiSpam({ store, permissions });
const communityEvents = registerCommunityEvents({ store });
const xpLeveling = registerXpLeveling({ store });

client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent
  ]
});

const musicManager = createMusicManager({ client });
const handleMusicCommand = registerMusicHandlers({ client, manager: musicManager });
const handlePlaylistCommand = registerMusicPlaylistHandlers({ store, permissions, musicManager });

client.once("ready", async () => {
  runtimeLogger.info({ bot: client.user.tag }, "VBOS is online.");
  await startAdminPanel({ client, guildId, store, permissions, musicManager, chainClient, walletRegistration }).catch((error) => {
    runtimeLogger.error({ error: serializeError(error) }, "Admin panel failed to start.");
  });
  startAnnouncementScheduler({ client, guildId, store });
  startBackupScheduler({ env: process.env });
  startOnChainSyncWorker({
    store,
    ledgerStore: walletRegistration.ledgerStore,
    chainClient,
    env: process.env
  });
});

client.on("interactionCreate", async (interaction) => {
  if (await handlePaymentInteraction(interaction)) return;
  if (await handleProposalInteraction(interaction)) return;
  if (await handleTicketCommand(interaction)) return;
  if (await handleCustomInteractionRuntime(interaction)) return;

  if (interaction.isButton() && interaction.customId.startsWith("vireon_role:")) {
    await handleRoleButton(interaction);
    return;
  }

  if (await handleMusicCommand(interaction)) return;

  if (!interaction.isChatInputCommand()) return;

  if (await handleModerationCommand(interaction)) return;
  if (await handleAnnouncementCommand(interaction)) return;
  if (await handlePlaylistCommand(interaction)) return;
  if (await handleRankCommand(interaction)) return;
  if (await handleRegisterCommand(interaction)) return;
  if (await handleRewardsCommand(interaction)) return;
  if (await handleEconomyCommand(interaction)) return;
  if (await handleTagCommand(interaction)) return;
  if (await handleTriggerCommand(interaction)) return;
  if (await handleCustomCommandRuntime(interaction)) return;
  if (await handleCommandCenter(interaction)) return;

  if (interaction.commandName === "vireon-status") {
    await handleVireonStatusCommand(interaction);
    return;
  }

  if (interaction.commandName === "send-embed") {
    await handleSendEmbedCommand(interaction);
    return;
  }

  if (interaction.commandName !== "setup-vireon") return;

  const confirmed = interaction.options.getBoolean("confirm", true);
  const templateId = normalizeSetupTemplateId(interaction.options.getString("template") ?? "ultimate");
  const includeRankRoles = interaction.options.getBoolean("include_rank_roles") ?? false;
  const setupPlan = describeSetupPlan({ templateId, includeRankRoles });

  if (!confirmed) {
    await interaction.reply({
      ephemeral: true,
      content: [
        `Setup preview only. Template: ${setupPlan.name} (${setupPlan.id}).`,
        setupPlan.description,
        `Will prepare: ${setupPlan.roles} roles (${setupPlan.rankRoles} rank roles), ${setupPlan.categories} categories, ${setupPlan.textChannels} text channels and ${setupPlan.voiceChannels} voice channels.`,
        "Nothing was changed.",
        `Run /setup-vireon confirm:true template:${setupPlan.id} include_rank_roles:${includeRankRoles} when ready.`
      ].join("\n")
    });
    return;
  }

  if (!permissions.canRunSetup(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: "You must be an allowed setup user or a server Administrator to run this command."
    });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  try {
    const guild = await client.guilds.fetch(guildId);
    await guild.roles.fetch();
    await guild.channels.fetch();

    const channelTemplate = getSetupChannelTemplate(templateId);
    const roleTemplate = getSetupRoleTemplate({ includeRankRoles });
    const seedMessagesTemplate = getSetupSeedMessages(channelTemplate);

    const context = await ensureRoles(guild, roleTemplate);
    const channelStats = await ensureChannels(guild, context, channelTemplate);
    const messageStats = await seedMessages(guild, seedMessagesTemplate);

    await interaction.editReply([
      `Vireon Discord setup complete. Template: ${setupPlan.name} (${setupPlan.id}).`,
      `Roles created: ${context.createdRoles}. Roles reused: ${context.reusedRoles}.`,
      `Categories created: ${channelStats.createdCategories}. Channels created: ${channelStats.createdChannels}.`,
      `Categories reused: ${channelStats.reusedCategories}. Channels reused: ${channelStats.reusedChannels}.`,
      `Starter messages posted: ${messageStats.posted}. Starter messages skipped: ${messageStats.skipped}.`
    ].join("\n"));
  } catch (error) {
    runtimeLogger.error({ error: serializeError(error) }, "Setup failed.");
    await interaction.editReply(`Setup failed: ${error.message}`);
  }
});

async function handleVireonStatusCommand(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const status = await chainClient.getNetworkStatus();
  const isLive = status.ok && !status.mock && status.mode === "rpc";

  const embed = createVireonEmbed({
    title: isLive ? "Vireon Network Status" : "Vireon Chain Adapter Status",
    description: buildVireonStatusDescription(status),
    color: status.ok ? 0xd4af37 : 0x8b1e24,
    fields: [
      { name: "Network", value: formatStatusValue(status.network), inline: true },
      { name: "Mode", value: formatStatusValue(status.mode), inline: true },
      { name: "Status", value: formatStatusValue(status.rawStatus ?? status.status), inline: true },
      { name: "Block Height", value: formatInteger(status.blockHeight), inline: true },
      { name: "Hash Rate", value: formatHashRate(status.hashRate), inline: true },
      { name: "Active Nodes", value: formatInteger(status.activeNodes), inline: true },
      { name: "Circulating Supply", value: formatSupply(status.circulatingSupply), inline: true },
      { name: "Latest Block Hash", value: formatHash(status.latestBlockHash), inline: false },
      { name: "Updated", value: formatStatusValue(status.updatedAt), inline: true },
      { name: "RPC Cache", value: formatCacheStatus(status), inline: true },
      { name: "Source", value: formatStatusValue(status.source), inline: true }
    ]
  });

  await interaction.editReply({ embeds: [embed] });
}

function buildVireonStatusDescription(status) {
  if (status.ok && status.mock) {
    return "Mock adapter active. Values are simulated until a real Vireon RPC/testnet endpoint is configured.";
  }

  if (status.ok) {
    if (status.stale) {
      return "Live RPC is unavailable or rate-limited. Showing the latest cached Vireon chain data.";
    }
    if (status.cached) {
      return "Cached live data from the configured Vireon chain adapter.";
    }
    return "Live data from the configured Vireon chain adapter.";
  }

  return [
    "Live Vireon network data is unavailable right now.",
    status.message ?? status.error ?? "Check VIREON_CHAIN_MODE, VIREON_CHAIN_RPC_URL and VIREON_CHAIN_STATUS_URL."
  ].join("\n");
}

function formatStatusValue(value) {
  if (value == null || value === "") return "Unavailable";
  return String(value).slice(0, 1024);
}

function formatCacheStatus(status) {
  if (!status.cached) return "Fresh";
  const parts = [status.stale ? "Stale" : "Cached"];
  if (typeof status.cacheAgeMs === "number" && Number.isFinite(status.cacheAgeMs)) {
    parts.push(`${Math.round(status.cacheAgeMs / 1000)}s old`);
  }
  if (status.rateLimited) parts.push("rate-limited");
  if (status.fallbackStatus) parts.push(`fallback: ${status.fallbackStatus}`);
  return parts.join(" | ");
}

function formatInteger(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatSupply(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} VIRE`;
}

function formatHashRate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s"];
  let rate = value;
  let unitIndex = 0;
  while (rate >= 1000 && unitIndex < units.length - 1) {
    rate /= 1000;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(rate)} ${units[unitIndex]}`;
}

function formatHash(value) {
  if (!value) return "Unavailable";
  const text = String(value);
  if (text.length <= 96) return `\`${text}\``;
  return `\`${text.slice(0, 42)}...${text.slice(-24)}\``;
}

client.on("messageCreate", async (message) => {
  await handleAutomodMessage(message).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), messageId: message.id }, "Automod failed.");
  });
  await handleAntiSpamMessage(message).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), messageId: message.id }, "Anti-spam failed.");
  });
  const customHandled = await handleCustomCommandRuntime(message).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), messageId: message.id }, "Custom command responder failed.");
    return false;
  });
  if (!customHandled) {
    await handleTriggerMessage(message).catch((error) => {
      runtimeLogger.error({ error: serializeError(error), messageId: message.id }, "Trigger responder failed.");
    });
  }
  await automationRuntime.handleMessage(message).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), messageId: message.id }, "Automation Studio message flow failed.");
  });
  const xpResult = await xpLeveling.handleMessage(message).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), messageId: message.id }, "XP message tracking failed.");
    return null;
  });
  if (xpResult?.leveledUp && message.member) {
    await applyXpRoleRewards({
      store,
      member: message.member,
      profile: xpResult.profile,
      previousLevel: xpResult.previousLevel,
      reason: "Vireon XP message level reward."
    }).catch((error) => {
      runtimeLogger.error({ error: serializeError(error), userId: message.author?.id }, "XP role reward failed.");
    });
  }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
  const xpResult = await xpLeveling.handleVoiceStateUpdate(oldState, newState).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), userId: newState.id ?? oldState.id }, "XP voice tracking failed.");
    return null;
  });
  const member = newState.member ?? oldState.member;
  if (xpResult?.leveledUp && member) {
    await applyXpRoleRewards({
      store,
      member,
      profile: xpResult.profile,
      previousLevel: xpResult.previousLevel,
      reason: "Vireon XP voice level reward."
    }).catch((error) => {
      runtimeLogger.error({ error: serializeError(error), userId: member.id }, "XP role reward failed.");
    });
  }
});

client.on("guildMemberAdd", async (member) => {
  await communityEvents.handleMemberJoin(member).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), memberId: member.id }, "Welcome event failed.");
  });
  await automationRuntime.handleMemberJoin(member).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), memberId: member.id }, "Automation Studio member join flow failed.");
  });
});

client.on("guildMemberRemove", async (member) => {
  await communityEvents.handleMemberLeave(member).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), memberId: member.id }, "Goodbye event failed.");
  });
  await automationRuntime.handleMemberLeave(member).catch((error) => {
    runtimeLogger.error({ error: serializeError(error), memberId: member.id }, "Automation Studio member leave flow failed.");
  });
});

async function handleSendEmbedCommand(interaction) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: "You do not have permission to use Vireon embed tools."
    });
    return;
  }

  const channel = interaction.options.getChannel("channel", true);
  const title = interaction.options.getString("title", true);
  const description = interaction.options.getString("description", true);
  const color = interaction.options.getString("color", false);

  if (!channel.isTextBased()) {
    await interaction.reply({ ephemeral: true, content: "Target channel must be text-based." });
    return;
  }

  const message = await channel.send({
    embeds: [createVireonEmbed({ title, description, color })]
  });

  await interaction.reply({
    ephemeral: true,
    content: `Embed sent to #${channel.name}. Message ID: ${message.id}`
  });
}

async function handleRoleButton(interaction) {
  const button = ROLE_BUTTONS.find((item) => item.customId === interaction.customId);
  if (!button) {
    await interaction.reply({ ephemeral: true, content: "Unknown role button." });
    return;
  }

  const guild = await client.guilds.fetch(guildId);
  await guild.roles.fetch();

  const targetRole = guild.roles.cache.find(
    (role) => role.name === ROLE_TEMPLATE.find((item) => item.key === button.roleKey)?.name
  );
  const memberRole = guild.roles.cache.find((role) => role.name === ROLE_NAMES.member);

  if (!targetRole) {
    await interaction.reply({ ephemeral: true, content: "Role does not exist yet. Ask an admin to run `/setup-vireon confirm:true`." });
    return;
  }

  if (button.roleKey !== "member" && memberRole && !interaction.member.roles.cache.has(memberRole.id)) {
    await interaction.member.roles.add(memberRole, "Vireon onboarding button.");
  }

  if (button.required) {
    if (!interaction.member.roles.cache.has(targetRole.id)) {
      await interaction.member.roles.add(targetRole, "Vireon onboarding button.");
    }

    await interaction.reply({ ephemeral: true, content: `You now have the ${targetRole.name} role.` });
    return;
  }

  if (interaction.member.roles.cache.has(targetRole.id)) {
    await interaction.member.roles.remove(targetRole, "Vireon role toggle button.");
    await interaction.reply({ ephemeral: true, content: `Removed the ${targetRole.name} role.` });
    return;
  }

  await interaction.member.roles.add(targetRole, "Vireon role toggle button.");
  await interaction.reply({ ephemeral: true, content: `Added the ${targetRole.name} role.` });
}

async function ensureRoles(guild, roleTemplates) {
  const roleMap = new Map();
  let createdRoles = 0;
  let reusedRoles = 0;

  for (const roleTemplate of roleTemplates) {
    let role = guild.roles.cache.find((item) => item.name === roleTemplate.name);

    if (!role) {
      role = await guild.roles.create({
        name: roleTemplate.name,
        color: roleTemplate.color,
        hoist: roleTemplate.hoist,
        permissions: permissionBits(roleTemplate.permissions),
        mentionable: false,
        reason: roleTemplate.reason
      });
      createdRoles += 1;
    } else {
      reusedRoles += 1;
      await role.edit({
        color: roleTemplate.color,
        hoist: roleTemplate.hoist,
        permissions: permissionBits(roleTemplate.permissions),
        mentionable: false
      });
    }

    roleMap.set(roleTemplate.key, role);
  }

  return { roleMap, createdRoles, reusedRoles };
}

async function ensureChannels(guild, context, channelTemplates) {
  let createdCategories = 0;
  let reusedCategories = 0;
  let createdChannels = 0;
  let reusedChannels = 0;

  for (const categoryTemplate of channelTemplates) {
    let category = guild.channels.cache.find(
      (channel) =>
        channel.type === ChannelType.GuildCategory &&
        channel.name === categoryTemplate.name
    );

    const categoryOverwrites = overwritesFor(guild, context, categoryTemplate);

    if (!category) {
      category = await guild.channels.create({
        name: categoryTemplate.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: categoryOverwrites
      });
      createdCategories += 1;
    } else {
      reusedCategories += 1;
      await category.permissionOverwrites.set(categoryOverwrites);
    }

    for (const childTemplate of categoryTemplate.children) {
      const channelType = childTemplate.type ?? ChannelType.GuildText;
      let channel = guild.channels.cache.find(
        (item) =>
          item.parentId === category.id &&
          item.type === channelType &&
          item.name === childTemplate.name
      );

      const childOverwrites = overwritesFor(guild, context, childTemplate, categoryTemplate);

      if (!channel) {
        channel = await guild.channels.create({
          name: childTemplate.name,
          type: channelType,
          parent: category.id,
          topic: channelType === ChannelType.GuildText ? childTemplate.topic : undefined,
          permissionOverwrites: childOverwrites
        });
        createdChannels += 1;
      } else {
        reusedChannels += 1;
        await channel.permissionOverwrites.set(childOverwrites);

        if (channelType === ChannelType.GuildText && channel.topic !== childTemplate.topic) {
          await channel.setTopic(childTemplate.topic ?? null);
        }
      }
    }
  }

  return { createdCategories, reusedCategories, createdChannels, reusedChannels };
}

function overwritesFor(guild, context, item, parentItem = null) {
  const everyone = guild.roles.everyone;
  const role = (key) => context.roleMap.get(key);
  const visibility = item.visibility ?? parentItem?.visibility ?? "members";
  const restrictedTo = item.restrictedTo ?? parentItem?.restrictedTo ?? [];
  const readOnly = item.readOnly ?? false;

  const overwrites = [
    {
      id: everyone.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
      deny: []
    },
    {
      id: role("muted").id,
      deny: [
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AddReactions,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak
      ]
    }
  ];

  if (visibility === "members" && restrictedTo.length === 0) {
    overwrites[0].deny.push(PermissionFlagsBits.ViewChannel);
    overwrites.push(memberAllow(role("member").id, readOnly, item.type));
  }

  if (visibility === "staff") {
    overwrites[0].deny.push(PermissionFlagsBits.ViewChannel);
    for (const key of ["founder", "coreTeam", "admin", "moderator"]) {
      overwrites.push(staffAllow(role(key).id, item.type));
    }
  }

  if (restrictedTo.length > 0) {
    overwrites[0].deny.push(PermissionFlagsBits.ViewChannel);
    for (const key of restrictedTo) {
      overwrites.push(staffAllow(role(key).id, item.type));
    }
  }

  if (!readOnly && visibility === "public_read" && restrictedTo.length === 0) {
    overwrites.push(memberAllow(everyone.id, false, item.type));
  }

  if (readOnly) {
    overwrites.push({
      id: everyone.id,
      deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
    });

    for (const key of ["founder", "coreTeam", "admin", "moderator"]) {
      overwrites.push(staffAllow(role(key).id, item.type));
    }
  }

  return dedupeOverwrites(overwrites);
}

function memberAllow(id, readOnly, channelType) {
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory
  ];
  const deny = [];

  if (channelType === ChannelType.GuildVoice) {
    allow.push(PermissionFlagsBits.Connect, PermissionFlagsBits.Speak);
  } else if (readOnly) {
    deny.push(PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions);
  } else {
    allow.push(PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions);
  }

  return { id, allow, deny };
}

function staffAllow(id, channelType) {
  const allow = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.AddReactions,
    PermissionFlagsBits.ManageMessages
  ];

  if (channelType === ChannelType.GuildVoice) {
    allow.push(PermissionFlagsBits.Connect, PermissionFlagsBits.Speak);
  }

  return { id, allow };
}

function dedupeOverwrites(overwrites) {
  const byId = new Map();

  for (const overwrite of overwrites) {
    const existing = byId.get(overwrite.id);
    if (!existing) {
      byId.set(overwrite.id, {
        id: overwrite.id,
        allow: new Set(overwrite.allow ?? []),
        deny: new Set(overwrite.deny ?? [])
      });
      continue;
    }

    for (const permission of overwrite.allow ?? []) existing.allow.add(permission);
    for (const permission of overwrite.deny ?? []) existing.deny.add(permission);
  }

  return [...byId.values()].map((overwrite) => ({
    id: overwrite.id,
    allow: [...overwrite.allow],
    deny: [...overwrite.deny]
  }));
}

async function seedMessages(guild, seedMessagesTemplate) {
  let posted = 0;
  let skipped = 0;

  for (const [channelName, messages] of Object.entries(seedMessagesTemplate)) {
    const channel = guild.channels.cache.find(
      (item) => item.type === ChannelType.GuildText && item.name === channelName
    );

    if (!channel) {
      skipped += messages.length;
      continue;
    }

    const recentMessages = await channel.messages.fetch({ limit: 20 });
    const alreadySeeded = recentMessages.some((message) => message.author.id === client.user.id);

    if (alreadySeeded) {
      skipped += messages.length;
      continue;
    }

    for (const message of messages) {
      const components = channelName === "roles" ? roleButtonComponents() : [];

      await channel.send({
        embeds: [
          createVireonEmbed({
            title: message.title,
            description: message.body
          })
        ],
        components
      });
      posted += 1;
    }
  }

  return { posted, skipped };
}

function roleButtonComponents() {
  return [
    new ActionRowBuilder().addComponents(
      ROLE_BUTTONS.slice(0, 5).map((button) =>
        new ButtonBuilder()
          .setCustomId(button.customId)
          .setLabel(button.label)
          .setStyle(button.required ? ButtonStyle.Success : ButtonStyle.Secondary)
      )
    ),
    new ActionRowBuilder().addComponents(
      ROLE_BUTTONS.slice(5).map((button) =>
        new ButtonBuilder()
          .setCustomId(button.customId)
          .setLabel(button.label)
          .setStyle(ButtonStyle.Secondary)
      )
    )
  ];
}

await client.login(token);
}
