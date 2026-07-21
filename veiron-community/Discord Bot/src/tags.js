import { createVireonEmbed } from "./embed-factory.js";

export const CUSTOM_TAGS_COLLECTION = "custom-tags";

export function registerTagHandlers({ store, permissions }) {
  return async function handleTagCommand(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "tag") return false;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "create") await handleTagCreate(interaction, store, permissions);
    if (subcommand === "list") await handleTagList(interaction, store);
    if (subcommand === "use") await handleTagUse(interaction, store);
    if (subcommand === "delete") await handleTagDelete(interaction, store, permissions);

    return true;
  };
}

export async function handleTagCreate(interaction, store, permissions) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: "You need VBOS management permission to create tags."
    });
    return;
  }

  const name = interaction.options.getString("name", true);
  const content = interaction.options.getString("content", true);

  try {
    const tag = await createCustomTag(store, {
      guildId: interaction.guildId,
      name,
      content,
      createdById: interaction.user.id,
      createdByTag: interaction.user.tag
    });

    await interaction.reply({
      ephemeral: true,
      content: `Tag \`${tag.name}\` saved. Variables available: \`{user}\`, \`{server}\`, \`{mentions}\`.`
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handleTagList(interaction, store) {
  const tags = await listCustomTags(store, interaction.guildId);
  if (tags.length === 0) {
    await interaction.reply({ ephemeral: true, content: "No custom tags exist yet." });
    return;
  }

  await interaction.reply({
    embeds: [
      createVireonEmbed({
        title: "Vireon Custom Tags",
        description: tags.map((tag) => `\`${tag.name}\` - used ${tag.uses} time${tag.uses === 1 ? "" : "s"}`).join("\n"),
        footer: "Use /tag use name:<tag>"
      })
    ]
  });
}

export async function handleTagUse(interaction, store) {
  const name = interaction.options.getString("name", true);
  const mentions = interaction.options.getString("mentions", false) ?? "";
  const tag = await getCustomTag(store, interaction.guildId, name);

  if (!tag) {
    await interaction.reply({ ephemeral: true, content: `Tag \`${normalizeTagName(name)}\` does not exist.` });
    return;
  }

  const rendered = renderTagContent(tag.content, {
    user: interaction.user,
    guild: interaction.guild,
    mentions
  });
  await incrementTagUse(store, tag);
  await interaction.reply({
    content: rendered,
    allowedMentions: { parse: ["users", "roles"] }
  });
}

export async function handleTagDelete(interaction, store, permissions) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: "You need VBOS management permission to delete tags."
    });
    return;
  }

  const name = interaction.options.getString("name", true);
  const tag = await deleteCustomTag(store, {
    guildId: interaction.guildId,
    name,
    deletedById: interaction.user.id
  });

  if (!tag) {
    await interaction.reply({ ephemeral: true, content: `Tag \`${normalizeTagName(name)}\` does not exist.` });
    return;
  }

  await interaction.reply({ ephemeral: true, content: `Tag \`${tag.name}\` deleted.` });
}

export async function createCustomTag(store, {
  guildId,
  name,
  content,
  createdById,
  createdByTag,
  now = new Date()
}) {
  const normalizedName = normalizeTagName(name);
  const normalizedContent = normalizeTagContent(content);
  const existing = await findAnyTag(store, guildId, normalizedName);
  const timestamp = now.toISOString();

  if (existing && !existing.deletedAt) {
    throw new Error(`Tag \`${normalizedName}\` already exists. Delete it before creating it again.`);
  }

  const tag = {
    ...(existing ?? {}),
    id: tagId(guildId, normalizedName),
    guildId,
    name: normalizedName,
    content: normalizedContent,
    createdById,
    createdByTag,
    deletedAt: null,
    deletedById: null,
    uses: Number(existing?.uses ?? 0),
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  if (existing) {
    return store.update(CUSTOM_TAGS_COLLECTION, (item) => item.id === existing.id, () => tag);
  }

  return store.add(CUSTOM_TAGS_COLLECTION, tag);
}

export async function listCustomTags(store, guildId) {
  const tags = await store.list(CUSTOM_TAGS_COLLECTION);
  return tags
    .filter((tag) => tag.guildId === guildId && !tag.deletedAt)
    .map(normalizeStoredTag)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getCustomTag(store, guildId, name) {
  const tag = await findAnyTag(store, guildId, normalizeTagName(name));
  return tag && !tag.deletedAt ? normalizeStoredTag(tag) : null;
}

export async function deleteCustomTag(store, {
  guildId,
  name,
  deletedById,
  now = new Date()
}) {
  const tag = await getCustomTag(store, guildId, name);
  if (!tag) return null;

  return store.update(
    CUSTOM_TAGS_COLLECTION,
    (item) => item.id === tag.id,
    (item) => ({
      ...item,
      deletedAt: now.toISOString(),
      deletedById,
      updatedAt: now.toISOString()
    })
  );
}

export async function incrementTagUse(store, tag, now = new Date()) {
  return store.update(
    CUSTOM_TAGS_COLLECTION,
    (item) => item.id === tag.id,
    (item) => ({
      ...item,
      uses: Number(item.uses ?? 0) + 1,
      lastUsedAt: now.toISOString()
    })
  );
}

export function renderTagContent(content, { user, guild, mentions = "" } = {}) {
  return normalizeTagContent(content)
    .replaceAll("{user}", user ? `<@${user.id}>` : "")
    .replaceAll("{server}", guild?.name ?? "this server")
    .replaceAll("{mentions}", String(mentions ?? "").trim());
}

export function normalizeTagName(name) {
  const normalized = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized.length < 2) {
    throw new Error("Tag name must contain at least 2 valid characters.");
  }

  return normalized.slice(0, 40);
}

export function normalizeTagContent(content) {
  const normalized = String(content ?? "").trim();
  if (normalized.length < 1) throw new Error("Tag content cannot be empty.");
  if (normalized.length > 1800) throw new Error("Tag content must be 1800 characters or fewer.");
  return normalized;
}

async function findAnyTag(store, guildId, name) {
  const normalizedName = normalizeTagName(name);
  const tags = await store.list(CUSTOM_TAGS_COLLECTION);
  return tags.find((tag) => tag.guildId === guildId && tag.name === normalizedName) ?? null;
}

function normalizeStoredTag(tag) {
  return {
    ...tag,
    name: normalizeTagName(tag.name),
    content: normalizeTagContent(tag.content),
    uses: Number(tag.uses ?? 0)
  };
}

function tagId(guildId, name) {
  return `${guildId}:${name}`;
}
