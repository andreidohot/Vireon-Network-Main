import { ChannelType, PermissionFlagsBits } from "discord.js";
import { searchAuditEvents, writeAuditLog } from "./audit-log.js";
import { buildAutomationStudioOverview, listAutomationEvents, testAutomationFlow } from "./automations-studio.js";
import { listMessageApprovals, listMessagePushes, listMessageTemplates, runBotConsoleCommand } from "./bot-operations.js";
import { listCustomCommands, listCustomInteractions } from "./custom-controls.js";
import { createVireonEmbed } from "./embed-factory.js";
import { buildModuleCenterOverview, setModuleState } from "./module-center.js";

export const COMMAND_CENTER_COLLECTION = "command-center-events";

export const COMMAND_CATEGORIES = Object.freeze([
  {
    id: "core",
    name: "Core / Control",
    description: "Dashboard, invite, command catalog, server info, role and channel controls.",
    commands: ["/vbos", "/server", "/member-role", "/channel-control"]
  },
  {
    id: "ops",
    name: "Operations",
    description: "Message creator, approvals, push history, safe console and templates.",
    commands: ["/operations", "/send-embed", "/announce", "/proposal"]
  },
  {
    id: "custom",
    name: "Custom Builder",
    description: "Custom commands, custom interactions and slash gateway execution.",
    commands: ["/custom", "/tag", "/trigger"]
  },
  {
    id: "automation",
    name: "Automation",
    description: "No-code automation flows, execution history and manual test from Discord.",
    commands: ["/automations"]
  },
  {
    id: "modules",
    name: "Modules",
    description: "Module Center status and enable/disable controls.",
    commands: ["/modules"]
  },
  {
    id: "moderation",
    name: "Moderation",
    description: "Moderation cases, warnings, timeouts, kicks, bans, purge and tickets.",
    commands: ["/warn", "/mute", "/unmute", "/kick", "/ban", "/purge", "/cases", "/ticket"]
  },
  {
    id: "community",
    name: "Community",
    description: "XP, ranks, economy, shop and social engagement.",
    commands: ["/rank", "/leaderboard", "/daily", "/work", "/balance", "/leaderboard-economy", "/shop", "/shards"]
  },
  {
    id: "music",
    name: "Music",
    description: "Lavalink player, playlists, queue and filters.",
    commands: ["/music", "/playlist", "/play", "/pause", "/resume", "/skip", "/stop", "/queue", "/nowplaying", "/volume", "/loop", "/shuffle", "/filter"]
  },
  {
    id: "vireon",
    name: "Vireon Optional",
    description: "VIRE wallet/payment/status features remain optional and disabled unless configured.",
    commands: ["/vireon-status", "/register", "/rewards", "/payment"]
  }
]);

const MAX_LIST_ITEMS = 20;

export async function buildCommandCenterOverview({ client = null, guildId = null, store = null } = {}) {
  const guild = client && guildId ? await fetchCommandGuild(client, guildId).catch(() => null) : null;
  if (guild) await hydrateGuild(guild).catch(() => null);

  const [customCommands, customInteractions, automations, modules, templates, approvals, pushes, audit] = await Promise.all([
    store ? listCustomCommands({ store, guildId }).catch(() => ({ items: [] })) : { items: [] },
    store ? listCustomInteractions({ store, guildId }).catch(() => ({ items: [] })) : { items: [] },
    store ? buildAutomationStudioOverview({ store, guildId, client }).catch(() => null) : null,
    store ? buildModuleCenterOverview({ store, guildId, client }).catch(() => null) : null,
    store ? listMessageTemplates({ store }).catch(() => ({ items: [] })) : { items: [] },
    store ? listMessageApprovals({ store, limit: 20 }).catch(() => ({ items: [] })) : { items: [] },
    store ? listMessagePushes({ store, limit: 20 }).catch(() => ({ items: [] })) : { items: [] },
    store ? searchAuditEvents(store, { limit: 20 }).catch(() => []) : []
  ]);

  const slashCommands = COMMAND_CATEGORIES.flatMap((category) => category.commands.map((command) => ({
    command,
    category: category.id,
    categoryName: category.name
  })));

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    brand: {
      name: "VBOS",
      longName: "Vireon Bot Operations Studio",
      adminWeb: process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin/` : "/admin/"
    },
    bot: {
      ready: Boolean(client?.isReady?.()),
      id: client?.user?.id ?? null,
      tag: client?.user?.tag ?? null,
      pingMs: Number.isFinite(client?.ws?.ping) ? client.ws.ping : null,
      uptimeMs: Number.isFinite(client?.uptime) ? client.uptime : null
    },
    guild: guild ? {
      id: guild.id,
      name: guild.name,
      members: guild.memberCount ?? guild.members.cache.size,
      channels: guild.channels.cache.size,
      roles: guild.roles.cache.size
    } : null,
    categories: COMMAND_CATEGORIES,
    slashCommands,
    stats: {
      slashCommands: slashCommands.length,
      categories: COMMAND_CATEGORIES.length,
      customCommands: customCommands.items.length,
      customInteractions: customInteractions.items.length,
      automationFlows: automations?.stats?.totalFlows ?? 0,
      enabledModules: modules?.stats?.enabled ?? 0,
      totalModules: modules?.stats?.total ?? 0,
      messageTemplates: templates.items.length,
      pendingApprovals: approvals.items.filter((item) => item.status === "pending").length,
      recentPushes: pushes.items.length,
      recentAuditEvents: audit.length
    },
    modules: modules?.modules ?? [],
    automationFlows: automations?.flows ?? [],
    customCommands: customCommands.items,
    customInteractions: customInteractions.items,
    templates: templates.items,
    approvals: approvals.items,
    pushes: pushes.items,
    auditTail: audit,
    capabilities: {
      discordSlashGateway: true,
      adminWebCommandCatalog: true,
      moduleTogglesFromDiscord: true,
      automationDryRunFromDiscord: true,
      memberRoleControlFromDiscord: true,
      channelControlFromDiscord: true,
      shellExecution: false,
      javascriptEval: false,
      audited: true
    }
  };
}

export function registerCommandCenterHandlers({ client, guildId, store, permissions }) {
  return async function handleCommandCenterInteraction(interaction) {
    if (!interaction.isChatInputCommand()) return false;

    try {
      if (interaction.commandName === "vbos") {
        await handleVbosCommand({ interaction, client, guildId, store, permissions });
        return true;
      }

      if (interaction.commandName === "modules") {
        await handleModulesCommand({ interaction, client, guildId, store, permissions });
        return true;
      }

      if (interaction.commandName === "automations") {
        await handleAutomationsCommand({ interaction, client, guildId, store, permissions });
        return true;
      }

      if (interaction.commandName === "operations") {
        await handleOperationsCommand({ interaction, client, guildId, store, permissions });
        return true;
      }

      if (interaction.commandName === "server") {
        await handleServerCommand({ interaction, client, guildId, store, permissions });
        return true;
      }

      if (interaction.commandName === "member-role") {
        await handleMemberRoleCommand({ interaction, client, guildId, store, permissions });
        return true;
      }

      if (interaction.commandName === "channel-control") {
        await handleChannelControlCommand({ interaction, client, guildId, store, permissions });
        return true;
      }

      return false;
    } catch (error) {
      await replyError(interaction, error);
      return true;
    }
  };
}

async function handleVbosCommand({ interaction, client, guildId, store, permissions }) {
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "dashboard") {
    const baseUrl = (process.env.PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
    await replyEmbed(interaction, {
      title: "VBOS Admin Web",
      description: baseUrl ? `${baseUrl}/admin/` : "Admin URL is not configured. Set PUBLIC_BASE_URL in the Setup Wizard or env.",
      fields: [
        { name: "Local fallback", value: `http://127.0.0.1:${process.env.ADMIN_PANEL_PORT ?? "8787"}/admin/`, inline: false }
      ]
    });
    return;
  }

  if (subcommand === "invite") {
    const clientId = process.env.DISCORD_CLIENT_ID ?? client.user?.id;
    const permissionsValue = process.env.DISCORD_BOT_PERMISSIONS ?? "8";
    const scopes = encodeURIComponent(process.env.DISCORD_BOT_SCOPES ?? "bot applications.commands");
    const invite = clientId
      ? `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${permissionsValue}&scope=${scopes}`
      : "DISCORD_CLIENT_ID is not configured.";
    await replyEmbed(interaction, { title: "VBOS Invite Link", description: invite });
    return;
  }

  if (subcommand === "status") {
    const overview = await buildCommandCenterOverview({ client, guildId, store });
    await replyEmbed(interaction, {
      title: "VBOS Runtime Status",
      description: overview.guild ? `Connected to **${overview.guild.name}**.` : "Guild is not available.",
      fields: [
        { name: "Bot", value: `${overview.bot.ready ? "online" : "offline"} | ${overview.bot.tag ?? "unknown"}`, inline: true },
        { name: "Ping", value: `${overview.bot.pingMs ?? "n/a"} ms`, inline: true },
        { name: "Commands", value: String(overview.stats.slashCommands), inline: true },
        { name: "Modules", value: `${overview.stats.enabledModules}/${overview.stats.totalModules} enabled`, inline: true },
        { name: "Automations", value: String(overview.stats.automationFlows), inline: true },
        { name: "Custom", value: `${overview.stats.customCommands} commands / ${overview.stats.customInteractions} interactions`, inline: true }
      ]
    });
    return;
  }

  if (subcommand === "help" || subcommand === "commands" || subcommand === "quickstart") {
    const category = interaction.options.getString("category") ?? null;
    const filtered = category ? COMMAND_CATEGORIES.filter((item) => item.id === category) : COMMAND_CATEGORIES;
    await replyEmbed(interaction, {
      title: subcommand === "quickstart" ? "VBOS Quickstart" : "VBOS Command Catalog",
      description: subcommand === "quickstart"
        ? "Start with `/vbos dashboard`, then use `/server info`, `/modules list`, `/operations approvals`, `/custom`, `/automations list` and Admin Web for full control."
        : "A compact map of the current VBOS command surface.",
      fields: filtered.slice(0, 10).map((item) => ({
        name: item.name,
        value: `${item.description}\n${item.commands.join(" · ")}`.slice(0, 1024),
        inline: false
      }))
    });
    return;
  }

  if (subcommand === "audit") {
    requireStaff(interaction, permissions);
    const limit = interaction.options.getInteger("limit") ?? 10;
    const items = await searchAuditEvents(store, { limit });
    await replyEmbed(interaction, {
      title: "Recent Audit Events",
      description: items.length ? "Latest audited actions." : "No audit events found.",
      fields: items.slice(0, 10).map((item) => ({
        name: `${item.type ?? "audit"} · ${formatDate(item.createdAt)}`,
        value: `${item.title ?? "Event"}${item.actorTag ? `\nActor: ${item.actorTag}` : ""}`.slice(0, 1024),
        inline: false
      }))
    });
  }
}

async function handleModulesCommand({ interaction, client, guildId, store, permissions }) {
  const subcommand = interaction.options.getSubcommand();
  const overview = await buildModuleCenterOverview({ store, guildId, client });

  if (subcommand === "list") {
    await replyEmbed(interaction, {
      title: "VBOS Modules",
      description: `${overview.stats.enabled}/${overview.stats.total} modules enabled.`,
      fields: overview.modules.slice(0, 15).map((module) => ({
        name: `${module.enabled ? "ON" : "OFF"} · ${module.name}`,
        value: `ID: ${module.id} · Risk: ${module.risk} · Role: ${module.minimumRole}${module.locked ? " · locked" : ""}`,
        inline: false
      }))
    });
    return;
  }

  const moduleId = interaction.options.getString("module_id", true);
  const module = overview.modules.find((item) => item.id === moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);

  if (subcommand === "status") {
    await replyEmbed(interaction, {
      title: module.name,
      description: module.description,
      fields: [
        { name: "State", value: module.enabled ? "enabled" : "disabled", inline: true },
        { name: "Risk", value: module.risk, inline: true },
        { name: "Minimum role", value: module.minimumRole, inline: true },
        { name: "Dependencies", value: module.dependencies?.join(", ") || "none", inline: false },
        { name: "Warnings", value: module.warnings?.map((warning) => warning.message).join("\n") || "none", inline: false }
      ]
    });
    return;
  }

  requireStaff(interaction, permissions);
  if (!permissions.hasAdministrator(interaction) && !permissions.hasPermission(interaction, PermissionFlagsBits.ManageGuild)) {
    throw new Error("Enabling/disabling modules requires Administrator or Manage Server.");
  }

  const enabled = subcommand === "enable";
  const result = await setModuleState({
    store,
    guildId,
    moduleId,
    client,
    actor: discordActor(interaction),
    payload: {
      enabled,
      reason: interaction.options.getString("reason") ?? `Changed from /modules ${subcommand}`
    }
  });

  await replyEmbed(interaction, {
    title: `Module ${enabled ? "enabled" : "disabled"}`,
    description: `${result.module.name} is now ${result.module.enabled ? "enabled" : "disabled"}.`
  });
}

async function handleAutomationsCommand({ interaction, client, guildId, store, permissions }) {
  const subcommand = interaction.options.getSubcommand();
  requireStaff(interaction, permissions);

  if (subcommand === "list") {
    const overview = await buildAutomationStudioOverview({ store, guildId, client });
    await replyEmbed(interaction, {
      title: "Automation Flows",
      description: `${overview.stats.activeFlows}/${overview.stats.totalFlows} active flows.`,
      fields: overview.flows.slice(0, 15).map((flow) => ({
        name: `${flow.enabled === false ? "OFF" : "ON"} · ${flow.name}`,
        value: `ID: ${flow.id}\nTrigger: ${flow.trigger?.type ?? "unknown"} · Actions: ${flow.actions?.length ?? 0}`,
        inline: false
      }))
    });
    return;
  }

  if (subcommand === "events") {
    const limit = interaction.options.getInteger("limit") ?? 10;
    const events = await listAutomationEvents({ store, guildId, limit });
    await replyEmbed(interaction, {
      title: "Automation Events",
      description: events.items.length ? "Latest automation executions." : "No automation events yet.",
      fields: events.items.slice(0, 10).map((event) => ({
        name: `${event.status ?? "event"} · ${formatDate(event.createdAt)}`,
        value: `${event.flowName ?? event.flowId ?? "flow"}\n${event.source ?? "runtime"}`,
        inline: false
      }))
    });
    return;
  }

  const overview = await buildAutomationStudioOverview({ store, guildId, client });
  const flowId = interaction.options.getString("flow_id", true);
  const flow = overview.flows.find((item) => item.id === flowId || item.name.toLowerCase() === flowId.toLowerCase());
  if (!flow) throw new Error(`Automation flow not found: ${flowId}`);

  if (subcommand === "info") {
    await replyEmbed(interaction, {
      title: flow.name,
      description: flow.description || "No description.",
      fields: [
        { name: "ID", value: flow.id, inline: false },
        { name: "Enabled", value: flow.enabled === false ? "false" : "true", inline: true },
        { name: "Trigger", value: flow.trigger?.type ?? "unknown", inline: true },
        { name: "Actions", value: String(flow.actions?.length ?? 0), inline: true }
      ]
    });
    return;
  }

  if (subcommand === "test") {
    if (!permissions.hasAdministrator(interaction) && !permissions.hasPermission(interaction, PermissionFlagsBits.ManageGuild)) {
      throw new Error("Testing automation flows requires Administrator or Manage Server.");
    }
    const dryRun = interaction.options.getBoolean("dry_run") !== false;
    const result = await testAutomationFlow({
      client,
      store,
      guildId,
      actor: discordActor(interaction),
      payload: { ...flow, dryRun }
    });
    await replyEmbed(interaction, {
      title: dryRun ? "Automation Dry Run" : "Automation Test Executed",
      description: `${flow.name}: ${result.result?.status ?? "completed"}`,
      fields: [
        { name: "Dry run", value: String(dryRun), inline: true },
        { name: "Actions", value: String(result.result?.actions?.length ?? flow.actions?.length ?? 0), inline: true }
      ]
    });
  }
}

async function handleOperationsCommand({ interaction, client, guildId, store, permissions }) {
  const subcommand = interaction.options.getSubcommand();
  requireStaff(interaction, permissions);

  if (subcommand === "templates") {
    const templates = await listMessageTemplates({ store });
    await replyList(interaction, "Message Templates", templates.items, (item) => `${item.name} · ${item.mode} · ${item.id}`);
    return;
  }

  if (subcommand === "approvals") {
    const approvals = await listMessageApprovals({ store, limit: interaction.options.getInteger("limit") ?? 10 });
    await replyList(interaction, "Message Approvals", approvals.items, (item) => `${item.status} · ${item.name ?? item.id} · ${item.id}`);
    return;
  }

  if (subcommand === "pushes") {
    const pushes = await listMessagePushes({ store, limit: interaction.options.getInteger("limit") ?? 10 });
    await replyList(interaction, "Message Push History", pushes.items, (item) => `${item.status} · ${item.name ?? item.id} · ${item.channelIds?.length ?? 0} channel(s)`);
    return;
  }

  if (subcommand === "console") {
    const command = interaction.options.getString("command", true);
    const result = await runBotConsoleCommand({ client, guildId, store, command, actor: discordActor(interaction) });
    await replyEmbed(interaction, {
      title: `Console: ${result.command || "empty"}`,
      description: formatConsoleOutput(result.output).slice(0, 4096)
    });
  }
}

async function handleServerCommand({ interaction, client, guildId, permissions }) {
  const subcommand = interaction.options.getSubcommand();
  requireStaff(interaction, permissions);
  const guild = await fetchCommandGuild(client, guildId);
  await hydrateGuild(guild);

  if (subcommand === "info") {
    await replyEmbed(interaction, {
      title: guild.name,
      description: "Discord server snapshot.",
      fields: [
        { name: "ID", value: guild.id, inline: true },
        { name: "Members", value: String(guild.memberCount ?? guild.members.cache.size), inline: true },
        { name: "Channels", value: String(guild.channels.cache.size), inline: true },
        { name: "Roles", value: String(guild.roles.cache.size), inline: true },
        { name: "Owner", value: guild.ownerId ?? "unknown", inline: true },
        { name: "Locale", value: guild.preferredLocale ?? "unknown", inline: true }
      ]
    });
    return;
  }

  if (subcommand === "channels") {
    const query = interaction.options.getString("query") ?? "";
    const channels = [...guild.channels.cache.values()]
      .map((channel) => ({ id: channel.id, name: channel.name, type: channelTypeLabel(channel.type), position: channel.rawPosition ?? channel.position ?? 0 }))
      .filter((channel) => fuzzy(channel.name, query) || fuzzy(channel.id, query))
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name));
    await replyList(interaction, "Server Channels", channels, (item) => `${item.type} · #${item.name} · ${item.id}`);
    return;
  }

  if (subcommand === "roles") {
    const query = interaction.options.getString("query") ?? "";
    const roles = [...guild.roles.cache.values()]
      .filter((role) => role.name !== "@everyone")
      .filter((role) => fuzzy(role.name, query) || fuzzy(role.id, query))
      .sort((a, b) => b.position - a.position);
    await replyList(interaction, "Server Roles", roles, (role) => `${String(role.position).padStart(3, "0")} · ${role.name} · ${role.id}`);
    return;
  }

  if (subcommand === "members") {
    const query = interaction.options.getString("query", true);
    const members = await guild.members.search({ query, limit: 20 }).catch(() => guild.members.cache.filter((member) => fuzzy(member.displayName, query) || fuzzy(member.user?.tag, query) || member.id === query));
    await replyList(interaction, "Member Search", [...members.values()], (member) => `${member.user?.tag ?? member.id} · ${member.displayName} · ${member.id}`);
  }
}

async function handleMemberRoleCommand({ interaction, client, guildId, store, permissions }) {
  const subcommand = interaction.options.getSubcommand();
  requireStaff(interaction, permissions);
  if (!permissions.hasAdministrator(interaction) && !permissions.hasPermission(interaction, PermissionFlagsBits.ManageRoles)) {
    throw new Error("Member role control requires Administrator or Manage Roles.");
  }

  const guild = await fetchCommandGuild(client, guildId);
  await hydrateGuild(guild);
  const member = interaction.options.getMember("user") ?? await guild.members.fetch(interaction.options.getUser("user", true).id);

  if (subcommand === "list") {
    const roles = [...member.roles.cache.values()].filter((role) => role.name !== "@everyone").sort((a, b) => b.position - a.position);
    await replyList(interaction, `Roles for ${member.displayName}`, roles, (role) => `${role.name} · ${role.id}`);
    return;
  }

  const role = interaction.options.getRole("role", true);
  ensureRoleEditableByBot(guild, role);
  const reason = interaction.options.getString("reason") ?? `VBOS /member-role ${subcommand}`;

  if (subcommand === "add") {
    await member.roles.add(role, reason);
  } else if (subcommand === "remove") {
    await member.roles.remove(role, reason);
  }

  await writeAuditLog(guild, {
    title: `Member role ${subcommand}`,
    description: `${subcommand === "add" ? "Added" : "Removed"} ${role.name} ${subcommand === "add" ? "to" : "from"} ${member.user?.tag ?? member.id}.`,
    type: "member-role",
    source: "discord-command",
    actorUserId: interaction.user.id,
    actorTag: interaction.user.tag,
    targetUserId: member.id,
    targetTag: member.user?.tag,
    metadata: { roleId: role.id, roleName: role.name, action: subcommand, reason }
  }, { store });

  await replyEmbed(interaction, {
    title: `Role ${subcommand === "add" ? "added" : "removed"}`,
    description: `${role.name} ${subcommand === "add" ? "added to" : "removed from"} ${member.displayName}.`
  });
}

async function handleChannelControlCommand({ interaction, client, guildId, store, permissions }) {
  const subcommand = interaction.options.getSubcommand();
  requireStaff(interaction, permissions);
  if (!permissions.hasAdministrator(interaction) && !permissions.hasPermission(interaction, PermissionFlagsBits.ManageChannels)) {
    throw new Error("Channel control requires Administrator or Manage Channels.");
  }

  const guild = await fetchCommandGuild(client, guildId);
  await hydrateGuild(guild);
  const reason = interaction.options.getString("reason") ?? `VBOS /channel-control ${subcommand}`;

  if (subcommand === "create") {
    const name = interaction.options.getString("name", true);
    const type = interaction.options.getString("type") ?? "text";
    const parent = interaction.options.getChannel("category") ?? null;
    const channel = await guild.channels.create({
      name,
      type: type === "category" ? ChannelType.GuildCategory : type === "voice" ? ChannelType.GuildVoice : ChannelType.GuildText,
      parent: parent?.type === ChannelType.GuildCategory ? parent.id : undefined,
      reason
    });
    await writeAuditLog(guild, {
      title: "Channel created from Discord",
      description: `${channel.name} (${channel.id}) was created through VBOS command controls.`,
      type: "channel-create",
      source: "discord-command",
      actorUserId: interaction.user.id,
      actorTag: interaction.user.tag,
      channelId: channel.id,
      metadata: { name, type, reason }
    }, { store });
    await replyEmbed(interaction, { title: "Channel created", description: `${channel.name} (${channel.id})` });
    return;
  }

  const channel = interaction.options.getChannel("channel", true);

  if (subcommand === "delete") {
    const confirm = interaction.options.getBoolean("confirm") === true;
    if (!confirm) throw new Error("Set confirm:true to delete this channel.");
    const name = channel.name;
    const id = channel.id;
    await channel.delete(reason);
    await writeAuditLog(guild, {
      title: "Channel deleted from Discord",
      description: `${name} (${id}) was deleted through VBOS command controls.`,
      type: "channel-delete",
      source: "discord-command",
      actorUserId: interaction.user.id,
      actorTag: interaction.user.tag,
      channelId: id,
      metadata: { reason }
    }, { store });
    await replyEmbed(interaction, { title: "Channel deleted", description: `${name} (${id})` });
    return;
  }

  if (subcommand === "topic") {
    const topic = interaction.options.getString("topic", true);
    if (typeof channel.setTopic !== "function") throw new Error("This channel type does not support topics.");
    await channel.setTopic(topic, reason);
    await writeAuditLog(guild, {
      title: "Channel topic updated",
      description: `${channel.name} topic was updated through VBOS command controls.`,
      type: "channel-topic",
      source: "discord-command",
      actorUserId: interaction.user.id,
      actorTag: interaction.user.tag,
      channelId: channel.id,
      metadata: { topic, reason }
    }, { store });
    await replyEmbed(interaction, { title: "Topic updated", description: `${channel.name}: ${topic}` });
    return;
  }

  if (subcommand === "lock" || subcommand === "unlock") {
    const allow = subcommand === "unlock";
    await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: allow }, { reason });
    await writeAuditLog(guild, {
      title: `Channel ${subcommand}ed`,
      description: `${channel.name} was ${subcommand}ed through VBOS command controls.`,
      type: `channel-${subcommand}`,
      source: "discord-command",
      actorUserId: interaction.user.id,
      actorTag: interaction.user.tag,
      channelId: channel.id,
      metadata: { reason }
    }, { store });
    await replyEmbed(interaction, { title: `Channel ${subcommand}ed`, description: `${channel.name} is now ${allow ? "unlocked" : "locked"}.` });
  }
}

function requireStaff(interaction, permissions) {
  if (!permissions?.canManageCommunityBot?.(interaction)) {
    throw new Error("You need VBOS staff permission, Administrator, or Manage Server to use this command.");
  }
}

async function fetchCommandGuild(client, guildId) {
  if (!client || !guildId) throw new Error("Discord client is not ready.");
  return client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId);
}

async function hydrateGuild(guild) {
  await Promise.allSettled([
    guild.roles?.fetch?.(),
    guild.channels?.fetch?.(),
    guild.members?.fetch?.({ limit: 100 }).catch(() => null)
  ]);
  return guild;
}

function ensureRoleEditableByBot(guild, role) {
  if (!role) throw new Error("Role not found.");
  if (role.managed) throw new Error("Managed roles cannot be edited by VBOS.");
  const botRole = guild.members.me?.roles?.highest;
  if (botRole && role.position >= botRole.position) {
    throw new Error("VBOS cannot manage a role at or above its highest role.");
  }
}


async function replyError(interaction, error) {
  const payload = {
    ephemeral: true,
    content: `VBOS command failed: ${error.message ?? error}`.slice(0, 1900)
  };

  if (interaction.deferred || interaction.replied) {
    await interaction.followUp(payload).catch(() => null);
    return;
  }

  await interaction.reply(payload).catch(() => null);
}

async function replyEmbed(interaction, { title, description, fields = [], ephemeral = true }) {
  await interaction.reply({
    ephemeral,
    embeds: [createVireonEmbed({ title, description, fields, footer: "VBOS" })]
  });
}

async function replyList(interaction, title, items, formatter) {
  const lines = items.slice(0, MAX_LIST_ITEMS).map((item, index) => `${index + 1}. ${formatter(item)}`);
  await replyEmbed(interaction, {
    title,
    description: lines.length ? lines.join("\n").slice(0, 4096) : "No items found."
  });
}

function formatConsoleOutput(items = []) {
  if (!items.length) return "No output.";
  return items.map((item) => {
    if (typeof item === "string") return item;
    if (item?.type === "json") return `\`\`\`json\n${JSON.stringify(item.value ?? item.data ?? item, null, 2).slice(0, 1500)}\n\`\`\``;
    if (item?.text) return String(item.text);
    return JSON.stringify(item);
  }).join("\n");
}

function discordActor(interaction) {
  return {
    id: interaction.user?.id ?? "unknown",
    email: `${interaction.user?.tag ?? interaction.user?.id ?? "discord-user"}@discord.local`,
    displayName: interaction.user?.tag ?? interaction.user?.username ?? "Discord User",
    role: permissionsHint(interaction)
  };
}

function permissionsHint(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return "ADMIN";
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return "MODERATOR";
  return "DISCORD_STAFF";
}

function channelTypeLabel(type) {
  if (type === ChannelType.GuildCategory) return "category";
  if (type === ChannelType.GuildVoice) return "voice";
  if (type === ChannelType.GuildAnnouncement) return "announcement";
  if (type === ChannelType.GuildForum) return "forum";
  if (type === ChannelType.GuildText) return "text";
  return String(type ?? "unknown");
}

function fuzzy(value, query) {
  const needle = String(query ?? "").trim().toLowerCase();
  if (!needle) return true;
  return String(value ?? "").toLowerCase().includes(needle);
}

function formatDate(value) {
  if (!value) return "unknown";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value) : parsed.toISOString().replace("T", " ").slice(0, 16);
}
