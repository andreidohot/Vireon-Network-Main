import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { writeAuditLog } from "./audit-log.js";
import { createVireonEmbed, normalizeColor } from "./embed-factory.js";

export const CUSTOM_COMMANDS_COLLECTION = "custom-commands";
export const CUSTOM_INTERACTIONS_COLLECTION = "custom-interactions";
export const CUSTOM_CONTROL_EVENTS_COLLECTION = "custom-control-events";
export const CUSTOM_INTERACTION_PREFIX = "vbos:custom:";

const MAX_COMMAND_NAME = 32;
const MAX_ALIASES = 8;
const MAX_CONTENT = 1900;
const MAX_DESCRIPTION = 4096;
const MAX_BUTTONS = 5;
const COMMAND_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export async function buildCustomControlsOverview({ store, guildId }) {
  const [commands, interactions, events] = await Promise.all([
    listCustomCommands({ store, guildId }),
    listCustomInteractions({ store, guildId }),
    listCustomControlEvents({ store, guildId, limit: 20 })
  ]);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    commands: commands.items,
    interactions: interactions.items,
    recentEvents: events.items,
    capabilities: {
      prefixCommands: true,
      slashGateway: "/custom name:<command>",
      customButtons: true,
      audited: true,
      safeMode: true,
      shellExecution: false,
      maxButtons: MAX_BUTTONS
    }
  };
}

export async function createOrUpdateCustomCommand({ store, guildId, payload = {}, actor, now = new Date() }) {
  const command = normalizeCustomCommandPayload({ guildId, payload, actor, now });
  const existing = await findAnyCustomCommand(store, guildId, command.name);
  let saved;

  if (existing) {
    saved = await store.update(
      CUSTOM_COMMANDS_COLLECTION,
      (item) => item.id === existing.id,
      (item) => ({
        ...item,
        ...command,
        uses: Number(item.uses ?? 0),
        createdAt: item.createdAt ?? command.createdAt,
        createdById: item.createdById ?? command.createdById,
        createdByTag: item.createdByTag ?? command.createdByTag,
        updatedAt: now.toISOString(),
        updatedById: actor?.id ?? null,
        updatedByTag: actorLabel(actor),
        deletedAt: null,
        deletedById: null,
        lastUsedAt: item.lastUsedAt ?? null
      })
    );
  } else {
    saved = await store.add(CUSTOM_COMMANDS_COLLECTION, command);
  }

  await logCustomEvent({
    store,
    guildId,
    actor,
    type: existing ? "custom-command.update" : "custom-command.create",
    title: existing ? "Custom Command Updated" : "Custom Command Created",
    description: `Command ${command.prefix}${command.name} ${existing ? "updated" : "created"} from Admin Web.`,
    relatedId: saved.id,
    metadata: { command: publicCustomCommand(saved) }
  });

  return { ok: true, command: publicCustomCommand(saved) };
}

export async function listCustomCommands({ store, guildId, includeDeleted = false } = {}) {
  const items = (await store.list(CUSTOM_COMMANDS_COLLECTION))
    .filter((item) => (!guildId || item.guildId === guildId) && (includeDeleted || !item.deletedAt))
    .map(publicCustomCommand)
    .sort((left, right) => left.name.localeCompare(right.name));
  return { ok: true, items };
}

export async function deleteCustomCommandFromWeb({ store, guildId, commandId, actor, now = new Date() }) {
  const command = await store.update(
    CUSTOM_COMMANDS_COLLECTION,
    (item) => item.id === commandId && item.guildId === guildId && !item.deletedAt,
    (item) => ({
      deletedAt: now.toISOString(),
      deletedById: actor?.id ?? null,
      deletedByTag: actorLabel(actor),
      enabled: false
    })
  );
  if (!command) throwHttpError(404, "Custom command not found.");

  await logCustomEvent({
    store,
    guildId,
    actor,
    type: "custom-command.delete",
    title: "Custom Command Deleted",
    description: `Command ${command.prefix}${command.name} deleted from Admin Web.`,
    relatedId: command.id,
    metadata: { command: publicCustomCommand(command) }
  });

  return { ok: true, command: publicCustomCommand(command) };
}

export async function createOrUpdateCustomInteraction({ store, guildId, payload = {}, actor, now = new Date() }) {
  const interaction = normalizeCustomInteractionPayload({ guildId, payload, actor, now });
  const existing = payload.id ? (await store.list(CUSTOM_INTERACTIONS_COLLECTION)).find((item) => item.id === payload.id && item.guildId === guildId) : null;
  let saved;

  if (existing) {
    saved = await store.update(
      CUSTOM_INTERACTIONS_COLLECTION,
      (item) => item.id === existing.id,
      (item) => ({
        ...item,
        ...interaction,
        id: item.id,
        uses: Number(item.uses ?? 0),
        createdAt: item.createdAt ?? interaction.createdAt,
        createdById: item.createdById ?? interaction.createdById,
        createdByTag: item.createdByTag ?? interaction.createdByTag,
        updatedAt: now.toISOString(),
        updatedById: actor?.id ?? null,
        updatedByTag: actorLabel(actor),
        deletedAt: null,
        deletedById: null,
        lastUsedAt: item.lastUsedAt ?? null
      })
    );
  } else {
    saved = await store.add(CUSTOM_INTERACTIONS_COLLECTION, interaction);
  }

  await logCustomEvent({
    store,
    guildId,
    actor,
    type: existing ? "custom-interaction.update" : "custom-interaction.create",
    title: existing ? "Custom Interaction Updated" : "Custom Interaction Created",
    description: `Interaction ${saved.label} ${existing ? "updated" : "created"} from Admin Web.`,
    relatedId: saved.id,
    metadata: { interaction: publicCustomInteraction(saved) }
  });

  return { ok: true, interaction: publicCustomInteraction(saved) };
}

export async function listCustomInteractions({ store, guildId, includeDeleted = false } = {}) {
  const items = (await store.list(CUSTOM_INTERACTIONS_COLLECTION))
    .filter((item) => (!guildId || item.guildId === guildId) && (includeDeleted || !item.deletedAt))
    .map(publicCustomInteraction)
    .sort((left, right) => left.label.localeCompare(right.label));
  return { ok: true, items };
}

export async function deleteCustomInteractionFromWeb({ store, guildId, interactionId, actor, now = new Date() }) {
  const interaction = await store.update(
    CUSTOM_INTERACTIONS_COLLECTION,
    (item) => item.id === interactionId && item.guildId === guildId && !item.deletedAt,
    (item) => ({
      deletedAt: now.toISOString(),
      deletedById: actor?.id ?? null,
      deletedByTag: actorLabel(actor),
      enabled: false
    })
  );
  if (!interaction) throwHttpError(404, "Custom interaction not found.");

  await logCustomEvent({
    store,
    guildId,
    actor,
    type: "custom-interaction.delete",
    title: "Custom Interaction Deleted",
    description: `Interaction ${interaction.label} deleted from Admin Web.`,
    relatedId: interaction.id,
    metadata: { interaction: publicCustomInteraction(interaction) }
  });

  return { ok: true, interaction: publicCustomInteraction(interaction) };
}

export async function listCustomControlEvents({ store, guildId, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 200));
  const items = (await store.list(CUSTOM_CONTROL_EVENTS_COLLECTION))
    .filter((item) => !guildId || item.guildId === guildId)
    .sort((left, right) => Date.parse(right.createdAt ?? 0) - Date.parse(left.createdAt ?? 0))
    .slice(0, safeLimit);
  return { ok: true, items };
}

export function registerCustomCommandRuntime({ store }) {
  return async function handleCustomCommandRuntime(interactionOrMessage) {
    if (interactionOrMessage?.isChatInputCommand?.() && interactionOrMessage.commandName === "custom") {
      return handleCustomSlashCommand({ store, interaction: interactionOrMessage });
    }

    if (interactionOrMessage?.content && interactionOrMessage?.guildId) {
      return handleCustomPrefixCommand({ store, message: interactionOrMessage });
    }

    return false;
  };
}

export function registerCustomInteractionRuntime({ store }) {
  return async function handleCustomInteractionRuntime(interaction) {
    if (!interaction?.isButton?.()) return false;
    if (!String(interaction.customId ?? "").startsWith(CUSTOM_INTERACTION_PREFIX)) return false;

    const interactionId = String(interaction.customId).slice(CUSTOM_INTERACTION_PREFIX.length);
    const item = (await store.list(CUSTOM_INTERACTIONS_COLLECTION)).find((entry) => entry.id === interactionId && entry.guildId === interaction.guildId && !entry.deletedAt && entry.enabled !== false);
    if (!item) {
      await interaction.reply({ ephemeral: true, content: "This custom interaction is no longer active." });
      return true;
    }

    const payload = buildCustomResponsePayload(item.response, {
      user: interaction.user,
      guild: interaction.guild,
      channel: interaction.channel
    });

    await interaction.reply({ ...payload, ephemeral: Boolean(item.ephemeral) });
    await markCustomInteractionUsed(store, item, interaction.user);
    await logCustomEvent({
      store,
      guildId: interaction.guildId,
      actor: { id: interaction.user.id, tag: interaction.user.tag },
      type: "custom-interaction.use",
      title: "Custom Interaction Used",
      description: `${interaction.user.tag} used ${item.label}.`,
      relatedId: item.id,
      channelId: interaction.channelId,
      metadata: { interactionId: item.id, label: item.label }
    });
    return true;
  };
}

export function buildCustomInteractionButton(interaction) {
  const style = normalizeButtonStyle(interaction.style);
  return new ButtonBuilder()
    .setCustomId(`${CUSTOM_INTERACTION_PREFIX}${interaction.id}`)
    .setLabel(interaction.label)
    .setStyle(style);
}

export function buildCustomInteractionComponents(interactions = []) {
  const active = interactions.filter((item) => item && !item.deletedAt && item.enabled !== false).slice(0, MAX_BUTTONS);
  if (!active.length) return [];
  return [new ActionRowBuilder().addComponents(active.map(buildCustomInteractionButton))];
}

async function handleCustomSlashCommand({ store, interaction }) {
  const name = interaction.options.getString("name", true);
  const input = interaction.options.getString("input", false) ?? "";
  const command = await findMatchingCustomCommand(store, interaction.guildId, name);
  if (!command) {
    await interaction.reply({ ephemeral: true, content: `Custom command \`${normalizeCustomName(name)}\` does not exist or is disabled.` });
    return true;
  }

  const response = buildCustomResponsePayload(command.response, {
    user: interaction.user,
    guild: interaction.guild,
    channel: interaction.channel,
    input
  });
  await interaction.reply({ ...response, ephemeral: Boolean(command.ephemeral) });
  await markCustomCommandUsed(store, command, interaction.user);
  return true;
}

async function handleCustomPrefixCommand({ store, message }) {
  if (!message.guildId || message.author?.bot || !message.content) return false;
  const commands = await listCustomCommands({ store, guildId: message.guildId });
  const command = commands.items.find((item) => {
    if (item.enabled === false) return false;
    const tokens = [item.name, ...(item.aliases ?? [])].filter(Boolean);
    return tokens.some((token) => message.content === `${item.prefix}${token}` || message.content.startsWith(`${item.prefix}${token} `));
  });
  if (!command) return false;

  const matchedName = [command.name, ...(command.aliases ?? [])].find((token) => message.content === `${command.prefix}${token}` || message.content.startsWith(`${command.prefix}${token} `)) ?? command.name;
  const input = message.content.slice(`${command.prefix}${matchedName}`.length).trim();
  const response = buildCustomResponsePayload(command.response, {
    user: message.author,
    guild: message.guild,
    channel: message.channel,
    input
  });

  await message.channel.send(response);
  await markCustomCommandUsed(store, command, message.author);
  return true;
}

async function findMatchingCustomCommand(store, guildId, value) {
  const normalized = normalizeCustomName(value);
  const commands = await listCustomCommands({ store, guildId });
  return commands.items.find((item) => item.enabled !== false && (item.name === normalized || (item.aliases ?? []).includes(normalized))) ?? null;
}

async function findAnyCustomCommand(store, guildId, name) {
  const normalized = normalizeCustomName(name);
  const commands = await store.list(CUSTOM_COMMANDS_COLLECTION);
  return commands.find((item) => item.guildId === guildId && item.name === normalized) ?? null;
}

async function markCustomCommandUsed(store, command, user) {
  return store.update(CUSTOM_COMMANDS_COLLECTION, (item) => item.id === command.id, (item) => ({
    uses: Number(item.uses ?? 0) + 1,
    lastUsedAt: new Date().toISOString(),
    lastUsedById: user?.id ?? null,
    lastUsedByTag: user?.tag ?? null
  }));
}

async function markCustomInteractionUsed(store, interaction, user) {
  return store.update(CUSTOM_INTERACTIONS_COLLECTION, (item) => item.id === interaction.id, (item) => ({
    uses: Number(item.uses ?? 0) + 1,
    lastUsedAt: new Date().toISOString(),
    lastUsedById: user?.id ?? null,
    lastUsedByTag: user?.tag ?? null
  }));
}

export function normalizeCustomCommandPayload({ guildId, payload = {}, actor, now = new Date() }) {
  const name = normalizeCustomName(payload.name);
  const prefix = normalizeCommandPrefix(payload.prefix ?? "!");
  const aliases = normalizeAliases(payload.aliases);
  const response = normalizeCustomResponse(payload);
  return {
    id: customCommandId(guildId, name),
    guildId,
    name,
    prefix,
    aliases,
    enabled: payload.enabled !== false,
    ephemeral: Boolean(payload.ephemeral),
    response,
    createdAt: now.toISOString(),
    createdById: actor?.id ?? null,
    createdByTag: actorLabel(actor),
    uses: 0,
    lastUsedAt: null,
    source: "admin-web"
  };
}

export function normalizeCustomInteractionPayload({ guildId, payload = {}, actor, now = new Date() }) {
  const label = normalizeLabel(payload.label, "Interaction label", 80);
  const id = payload.id ? String(payload.id).trim() : customInteractionId(guildId, label, now);
  const response = normalizeCustomResponse(payload);
  return {
    id,
    guildId,
    label,
    style: normalizeButtonStyleKey(payload.style),
    enabled: payload.enabled !== false,
    ephemeral: payload.ephemeral !== false,
    response,
    createdAt: now.toISOString(),
    createdById: actor?.id ?? null,
    createdByTag: actorLabel(actor),
    uses: 0,
    lastUsedAt: null,
    source: "admin-web"
  };
}

function normalizeCustomResponse(payload = {}) {
  const mode = String(payload.mode ?? payload.response?.mode ?? "plain").trim().toLowerCase() === "embed" ? "embed" : "plain";
  const content = String(payload.content ?? payload.response?.content ?? "").trim().slice(0, MAX_CONTENT);
  if (mode === "plain") {
    if (!content) throwHttpError(400, "Custom response requires content.");
    return { mode, content, embed: null };
  }

  const title = String(payload.title ?? payload.response?.embed?.title ?? "").trim().slice(0, 256);
  const description = String(payload.description ?? payload.response?.embed?.description ?? "").trim().slice(0, MAX_DESCRIPTION);
  if (!title && !description) throwHttpError(400, "Embed custom response requires title or description.");
  return {
    mode,
    content,
    embed: {
      title,
      description,
      color: normalizeColor(payload.color ?? payload.response?.embed?.color ?? "#d4af37"),
      footer: String(payload.footer ?? payload.response?.embed?.footer ?? "VBOS").trim().slice(0, 2048) || "VBOS"
    }
  };
}

function buildCustomResponsePayload(response, context = {}) {
  const renderedContent = renderVariables(response?.content ?? "", context);
  if (response?.mode === "embed") {
    const embed = response.embed ?? {};
    const payload = {
      embeds: [createVireonEmbed({
        title: renderVariables(embed.title, context),
        description: renderVariables(embed.description, context),
        color: embed.color,
        footer: renderVariables(embed.footer ?? "VBOS", context)
      })]
    };
    if (renderedContent) payload.content = renderedContent;
    return payload;
  }

  return { content: renderedContent || "-" };
}

function renderVariables(value, { user, guild, channel, input = "" } = {}) {
  return String(value ?? "")
    .replaceAll("{user}", user ? `<@${user.id}>` : "")
    .replaceAll("{username}", user?.username ?? user?.tag ?? "")
    .replaceAll("{server}", guild?.name ?? "this server")
    .replaceAll("{channel}", channel?.name ? `#${channel.name}` : "")
    .replaceAll("{input}", String(input ?? "").trim());
}

function publicCustomCommand(item) {
  return {
    ...item,
    name: normalizeCustomName(item.name),
    prefix: normalizeCommandPrefix(item.prefix ?? "!"),
    aliases: normalizeAliases(item.aliases),
    enabled: item.enabled !== false,
    uses: Number(item.uses ?? 0),
    response: item.response ?? { mode: "plain", content: item.content ?? "" }
  };
}

function publicCustomInteraction(item) {
  return {
    ...item,
    label: normalizeLabel(item.label, "Interaction label", 80),
    style: normalizeButtonStyleKey(item.style),
    enabled: item.enabled !== false,
    ephemeral: item.ephemeral !== false,
    uses: Number(item.uses ?? 0),
    response: item.response ?? { mode: "plain", content: item.content ?? "" },
    customId: `${CUSTOM_INTERACTION_PREFIX}${item.id}`
  };
}

function normalizeCustomName(value) {
  const name = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_COMMAND_NAME);
  if (!COMMAND_NAME_PATTERN.test(name)) throwHttpError(400, "Custom command names must be 2-32 chars: lowercase letters, numbers, dash or underscore.");
  return name;
}

function normalizeAliases(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[,\s]+/);
  return [...new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean).map(normalizeCustomName))]
    .filter(Boolean)
    .slice(0, MAX_ALIASES);
}

function normalizeCommandPrefix(value) {
  const prefix = String(value ?? "!").trim().slice(0, 4) || "!";
  if (/\s/.test(prefix)) throwHttpError(400, "Command prefix cannot contain whitespace.");
  return prefix;
}

function normalizeLabel(value, label, max) {
  const normalized = String(value ?? "").trim().slice(0, max);
  if (!normalized) throwHttpError(400, `${label} is required.`);
  return normalized;
}

function normalizeButtonStyleKey(value) {
  const style = String(value ?? "primary").trim().toLowerCase();
  if (["primary", "secondary", "success", "danger"].includes(style)) return style;
  return "primary";
}

function normalizeButtonStyle(value) {
  const key = normalizeButtonStyleKey(value);
  if (key === "secondary") return ButtonStyle.Secondary;
  if (key === "success") return ButtonStyle.Success;
  if (key === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}

async function logCustomEvent({ store, guildId, actor, type, title, description, relatedId = null, channelId = null, metadata = {} }) {
  const event = await store.add(CUSTOM_CONTROL_EVENTS_COLLECTION, {
    guildId,
    type,
    title,
    description,
    actorUserId: actor?.id ?? null,
    actorTag: actorLabel(actor),
    relatedId,
    channelId,
    metadata,
    source: "admin-web"
  });

  if (metadata.guildLike) return event;
  try {
    await writeAuditLog({
      id: guildId,
      name: "Discord guild",
      channels: { cache: { find: () => null } }
    }, {
      title,
      description,
      type: "custom-control",
      source: "admin-web",
      actorUserId: actor?.id ?? null,
      actorTag: actorLabel(actor),
      relatedId,
      channelId,
      metadata
    }, { store });
  } catch {
    // Audit log must not block admin operations if storage is unavailable during bootstrap.
  }
  return event;
}

function customCommandId(guildId, name) {
  return `${guildId}:cmd:${name}`;
}

function customInteractionId(guildId, label, now) {
  const slug = String(label ?? "button").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24) || "button";
  return `${guildId}:btn:${slug}:${now.getTime().toString(36)}:${Math.random().toString(16).slice(2, 8)}`;
}

function actorLabel(actor) {
  return actor?.email ?? actor?.tag ?? actor?.id ?? "admin-web";
}

function throwHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
