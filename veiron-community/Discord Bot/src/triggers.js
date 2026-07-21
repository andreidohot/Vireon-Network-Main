import { createVireonEmbed } from "./embed-factory.js";
import { getCustomTag, incrementTagUse, normalizeTagName, renderTagContent } from "./tags.js";

export const CUSTOM_TRIGGERS_COLLECTION = "custom-triggers";

export function registerTriggerHandlers({ store, permissions }) {
  return async function handleTriggerCommand(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "trigger") return false;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "create") await handleTriggerCreate(interaction, store, permissions);
    if (subcommand === "list") await handleTriggerList(interaction, store);
    if (subcommand === "delete") await handleTriggerDelete(interaction, store, permissions);

    return true;
  };
}

export function registerTriggerResponder({ store }) {
  return async function handleTriggerMessage(message) {
    return processTriggerMessage({ store, message });
  };
}

export async function handleTriggerCreate(interaction, store, permissions) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: "You need VBOS management permission to create triggers."
    });
    return;
  }

  const name = interaction.options.getString("name", true);
  const pattern = interaction.options.getString("pattern", true);
  const tagName = interaction.options.getString("tag", true);
  const cooldownSeconds = interaction.options.getInteger("cooldown_seconds", false) ?? 60;

  try {
    const tag = await getCustomTag(store, interaction.guildId, tagName);
    if (!tag) throw new Error(`Tag \`${normalizeTagName(tagName)}\` does not exist.`);

    const trigger = await createCustomTrigger(store, {
      guildId: interaction.guildId,
      name,
      pattern,
      tagName,
      cooldownSeconds,
      createdById: interaction.user.id,
      createdByTag: interaction.user.tag
    });

    await interaction.reply({
      ephemeral: true,
      content: `Trigger \`${trigger.name}\` saved. It responds with tag \`${trigger.tagName}\` and has a ${trigger.cooldownSeconds}s cooldown.`
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handleTriggerList(interaction, store) {
  const triggers = await listCustomTriggers(store, interaction.guildId);
  if (triggers.length === 0) {
    await interaction.reply({ ephemeral: true, content: "No custom triggers exist yet." });
    return;
  }

  await interaction.reply({
    embeds: [
      createVireonEmbed({
        title: "Vireon Auto-Responders",
        description: triggers.map((trigger) => [
          `\`${trigger.name}\` -> tag \`${trigger.tagName}\``,
          `regex: \`${trigger.pattern}\``,
          `cooldown: ${trigger.cooldownSeconds}s | fired ${trigger.uses} time${trigger.uses === 1 ? "" : "s"}`
        ].join(" | ")).join("\n"),
        footer: "Triggers fire on normal messages, not bot messages."
      })
    ]
  });
}

export async function handleTriggerDelete(interaction, store, permissions) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: "You need VBOS management permission to delete triggers."
    });
    return;
  }

  const name = interaction.options.getString("name", true);
  const trigger = await deleteCustomTrigger(store, {
    guildId: interaction.guildId,
    name,
    deletedById: interaction.user.id
  });

  if (!trigger) {
    await interaction.reply({ ephemeral: true, content: `Trigger \`${normalizeTriggerName(name)}\` does not exist.` });
    return;
  }

  await interaction.reply({ ephemeral: true, content: `Trigger \`${trigger.name}\` deleted.` });
}

export async function processTriggerMessage({ store, message, now = new Date() }) {
  if (!message.guildId || message.author?.bot || !message.content) return null;

  const triggers = await listCustomTriggers(store, message.guildId);
  for (const trigger of triggers) {
    if (!matchesTrigger(trigger, message.content)) continue;
    if (!isTriggerCooldownReady(trigger, now)) continue;

    const tag = await getCustomTag(store, message.guildId, trigger.tagName);
    if (!tag) continue;

    const rendered = renderTagContent(tag.content, {
      user: message.author,
      guild: message.guild,
      mentions: formatMessageMentions(message)
    });

    await message.channel.send({
      content: rendered,
      allowedMentions: { parse: ["users", "roles"] }
    });
    await Promise.all([
      incrementTagUse(store, tag, now),
      markTriggerFired(store, trigger, now)
    ]);
    return trigger;
  }

  return null;
}

export async function createCustomTrigger(store, {
  guildId,
  name,
  pattern,
  tagName,
  cooldownSeconds = 60,
  createdById,
  createdByTag,
  now = new Date()
}) {
  const normalizedName = normalizeTriggerName(name);
  const normalizedPattern = normalizeTriggerPattern(pattern);
  const normalizedTagName = normalizeTagName(tagName);
  const existing = await findAnyTrigger(store, guildId, normalizedName);
  const timestamp = now.toISOString();

  if (existing && !existing.deletedAt) {
    throw new Error(`Trigger \`${normalizedName}\` already exists. Delete it before creating it again.`);
  }

  const trigger = {
    ...(existing ?? {}),
    id: triggerId(guildId, normalizedName),
    guildId,
    name: normalizedName,
    pattern: normalizedPattern,
    tagName: normalizedTagName,
    cooldownSeconds: clampInteger(cooldownSeconds, 0, 86400, 60),
    createdById,
    createdByTag,
    deletedAt: null,
    deletedById: null,
    uses: Number(existing?.uses ?? 0),
    lastTriggeredAt: null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  if (existing) {
    return store.update(CUSTOM_TRIGGERS_COLLECTION, (item) => item.id === existing.id, () => trigger);
  }

  return store.add(CUSTOM_TRIGGERS_COLLECTION, trigger);
}

export async function listCustomTriggers(store, guildId) {
  const triggers = await store.list(CUSTOM_TRIGGERS_COLLECTION);
  return triggers
    .filter((trigger) => trigger.guildId === guildId && !trigger.deletedAt)
    .map(normalizeStoredTrigger)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getCustomTrigger(store, guildId, name) {
  const trigger = await findAnyTrigger(store, guildId, normalizeTriggerName(name));
  return trigger && !trigger.deletedAt ? normalizeStoredTrigger(trigger) : null;
}

export async function deleteCustomTrigger(store, {
  guildId,
  name,
  deletedById,
  now = new Date()
}) {
  const trigger = await getCustomTrigger(store, guildId, name);
  if (!trigger) return null;

  return store.update(
    CUSTOM_TRIGGERS_COLLECTION,
    (item) => item.id === trigger.id,
    (item) => ({
      ...item,
      deletedAt: now.toISOString(),
      deletedById,
      updatedAt: now.toISOString()
    })
  );
}

export async function markTriggerFired(store, trigger, now = new Date()) {
  return store.update(
    CUSTOM_TRIGGERS_COLLECTION,
    (item) => item.id === trigger.id,
    (item) => ({
      ...item,
      uses: Number(item.uses ?? 0) + 1,
      lastTriggeredAt: now.toISOString()
    })
  );
}

export function matchesTrigger(trigger, content) {
  try {
    return new RegExp(trigger.pattern, "i").test(content);
  } catch {
    return false;
  }
}

export function isTriggerCooldownReady(trigger, now = new Date()) {
  if (!trigger.lastTriggeredAt || Number(trigger.cooldownSeconds ?? 0) <= 0) return true;
  const lastTime = new Date(trigger.lastTriggeredAt).getTime();
  if (!Number.isFinite(lastTime)) return true;
  return now.getTime() - lastTime >= Number(trigger.cooldownSeconds) * 1000;
}

export function normalizeTriggerName(name) {
  const normalized = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized.length < 2) throw new Error("Trigger name must contain at least 2 valid characters.");
  return normalized.slice(0, 40);
}

export function normalizeTriggerPattern(pattern) {
  const normalized = String(pattern ?? "").trim();
  if (normalized.length < 1) throw new Error("Trigger regex cannot be empty.");
  if (normalized.length > 200) throw new Error("Trigger regex must be 200 characters or fewer.");

  try {
    new RegExp(normalized, "i");
  } catch (error) {
    throw new Error(`Invalid trigger regex: ${error.message}`);
  }

  return normalized;
}

function normalizeStoredTrigger(trigger) {
  return {
    ...trigger,
    name: normalizeTriggerName(trigger.name),
    pattern: normalizeTriggerPattern(trigger.pattern),
    tagName: normalizeTagName(trigger.tagName),
    cooldownSeconds: clampInteger(trigger.cooldownSeconds, 0, 86400, 60),
    uses: Number(trigger.uses ?? 0),
    lastTriggeredAt: trigger.lastTriggeredAt ?? null
  };
}

async function findAnyTrigger(store, guildId, name) {
  const normalizedName = normalizeTriggerName(name);
  const triggers = await store.list(CUSTOM_TRIGGERS_COLLECTION);
  return triggers.find((trigger) => trigger.guildId === guildId && trigger.name === normalizedName) ?? null;
}

function formatMessageMentions(message) {
  const users = [...(message.mentions?.users?.values?.() ?? [])].map((user) => `<@${user.id}>`);
  const roles = [...(message.mentions?.roles?.values?.() ?? [])].map((role) => `<@&${role.id}>`);
  return [...users, ...roles].join(" ");
}

function triggerId(guildId, name) {
  return `${guildId}:${name}`;
}

function clampInteger(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
