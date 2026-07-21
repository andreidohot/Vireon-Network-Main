import { createVireonEmbed } from "./embed-factory.js";

export const MUSIC_PLAYLISTS_COLLECTION = "music-playlists";

const PLAYLIST_SCOPES = new Set(["user", "server"]);

export function registerMusicPlaylistHandlers({ store, permissions, musicManager }) {
  return async function handlePlaylistCommand(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "playlist") return false;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "create") await handlePlaylistCreate(interaction, store, permissions);
    if (subcommand === "list") await handlePlaylistList(interaction, store);
    if (subcommand === "show") await handlePlaylistShow(interaction, store);
    if (subcommand === "add") await handlePlaylistAdd(interaction, store, permissions);
    if (subcommand === "remove") await handlePlaylistRemove(interaction, store, permissions);
    if (subcommand === "delete") await handlePlaylistDelete(interaction, store, permissions);
    if (subcommand === "play") await handlePlaylistPlay(interaction, store, musicManager);

    return true;
  };
}

export async function handlePlaylistCreate(interaction, store, permissions) {
  const scope = interaction.options.getString("scope", false) ?? "user";
  if (scope === "server" && !permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: "You need VBOS management permission to create server playlists."
    });
    return;
  }

  try {
    const playlist = await createMusicPlaylist(store, {
      guildId: interaction.guildId,
      ownerId: interaction.user.id,
      ownerTag: interaction.user.tag,
      name: interaction.options.getString("name", true),
      scope
    });

    await interaction.reply({
      ephemeral: true,
      content: `Playlist \`${playlist.name}\` created as a ${playlist.scope} playlist.`
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handlePlaylistList(interaction, store) {
  const scope = interaction.options.getString("scope", false) ?? "user";
  const playlists = await listMusicPlaylists(store, {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    scope
  });

  if (playlists.length === 0) {
    await interaction.reply({ ephemeral: true, content: `No ${scope} playlists found.` });
    return;
  }

  await interaction.reply({
    embeds: [createVireonEmbed({
      title: scope === "server" ? "Server Music Playlists" : "Your Music Playlists",
      description: playlists
        .map((playlist) => `\`${playlist.name}\` - ${playlist.tracks.length} track${playlist.tracks.length === 1 ? "" : "s"}`)
        .join("\n")
    })]
  });
}

export async function handlePlaylistShow(interaction, store) {
  const result = await getAccessiblePlaylistFromInteraction(interaction, store);
  if (!result.playlist) {
    await interaction.reply({ ephemeral: true, content: `Playlist \`${result.name}\` was not found.` });
    return;
  }

  const lines = result.playlist.tracks
    .slice(0, 15)
    .map((track, index) => `${index + 1}. ${formatPlaylistTrack(track)}`);

  await interaction.reply({
    embeds: [createVireonEmbed({
      title: `Playlist: ${result.playlist.name}`,
      description: lines.length > 0 ? lines.join("\n") : "This playlist is empty.",
      footer: `${result.playlist.scope} playlist - ${result.playlist.tracks.length} saved track${result.playlist.tracks.length === 1 ? "" : "s"}`
    })]
  });
}

export async function handlePlaylistAdd(interaction, store, permissions) {
  const result = await getEditablePlaylistFromInteraction(interaction, store, permissions);
  if (!result.playlist) {
    await interaction.reply({ ephemeral: true, content: `Playlist \`${result.name}\` was not found or cannot be edited by you.` });
    return;
  }

  try {
    const playlist = await addTrackToPlaylist(store, result.playlist, {
      query: interaction.options.getString("query", true),
      title: interaction.options.getString("title", false),
      addedById: interaction.user.id,
      addedByTag: interaction.user.tag
    });

    await interaction.reply({
      ephemeral: true,
      content: `Track saved to \`${playlist.name}\`. Total tracks: ${playlist.tracks.length}.`
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handlePlaylistRemove(interaction, store, permissions) {
  const result = await getEditablePlaylistFromInteraction(interaction, store, permissions);
  if (!result.playlist) {
    await interaction.reply({ ephemeral: true, content: `Playlist \`${result.name}\` was not found or cannot be edited by you.` });
    return;
  }

  try {
    const playlist = await removeTrackFromPlaylist(store, result.playlist, interaction.options.getInteger("index", true));
    await interaction.reply({
      ephemeral: true,
      content: `Removed track from \`${playlist.name}\`. Remaining tracks: ${playlist.tracks.length}.`
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handlePlaylistDelete(interaction, store, permissions) {
  const result = await getEditablePlaylistFromInteraction(interaction, store, permissions);
  if (!result.playlist) {
    await interaction.reply({ ephemeral: true, content: `Playlist \`${result.name}\` was not found or cannot be deleted by you.` });
    return;
  }

  const playlist = await deleteMusicPlaylist(store, result.playlist, {
    deletedById: interaction.user.id
  });

  await interaction.reply({ ephemeral: true, content: `Playlist \`${playlist.name}\` deleted.` });
}

export async function handlePlaylistPlay(interaction, store, musicManager) {
  const result = await getAccessiblePlaylistFromInteraction(interaction, store);
  if (!result.playlist) {
    await interaction.reply({ ephemeral: true, content: `Playlist \`${result.name}\` was not found.` });
    return;
  }

  if (result.playlist.tracks.length === 0) {
    await interaction.reply({ ephemeral: true, content: `Playlist \`${result.playlist.name}\` is empty.` });
    return;
  }

  if (!musicManager.enabled) {
    await interaction.reply({
      ephemeral: true,
      content: "Music is disabled. Set `MUSIC_ENABLED=true` and configure Lavalink to play saved playlists."
    });
    return;
  }

  await interaction.deferReply();

  try {
    await musicManager.playPlaylist(interaction, result.playlist);
    await incrementPlaylistUse(store, result.playlist);
  } catch (error) {
    await interaction.editReply(`Playlist playback failed: ${error.message}`);
  }
}

export async function createMusicPlaylist(store, {
  guildId,
  ownerId,
  ownerTag,
  name,
  scope = "user",
  now = new Date()
}) {
  const normalizedScope = normalizePlaylistScope(scope);
  const normalizedName = normalizePlaylistName(name);
  const existing = await findAnyPlaylist(store, {
    guildId,
    ownerId,
    name: normalizedName,
    scope: normalizedScope
  });
  const timestamp = now.toISOString();

  if (existing && !existing.deletedAt) {
    throw new Error(`Playlist \`${normalizedName}\` already exists.`);
  }

  const playlist = {
    ...(existing ?? {}),
    id: playlistId({ guildId, ownerId, scope: normalizedScope, name: normalizedName }),
    guildId,
    ownerId: normalizedScope === "server" ? null : ownerId,
    ownerTag: normalizedScope === "server" ? null : ownerTag,
    scope: normalizedScope,
    name: normalizedName,
    tracks: [],
    uses: Number(existing?.uses ?? 0),
    deletedAt: null,
    deletedById: null,
    createdAt: existing?.createdAt ?? timestamp,
    updatedAt: timestamp
  };

  if (existing) {
    return store.update(MUSIC_PLAYLISTS_COLLECTION, (item) => item.id === existing.id, () => playlist);
  }

  return store.add(MUSIC_PLAYLISTS_COLLECTION, playlist);
}

export async function listMusicPlaylists(store, { guildId, userId, scope = "user" }) {
  const normalizedScope = normalizePlaylistScope(scope);
  const playlists = await store.list(MUSIC_PLAYLISTS_COLLECTION);
  return playlists
    .filter((playlist) => playlist.guildId === guildId && playlist.scope === normalizedScope && !playlist.deletedAt)
    .filter((playlist) => normalizedScope === "server" || playlist.ownerId === userId)
    .map(normalizeStoredPlaylist)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function getMusicPlaylist(store, { guildId, userId, name, scope = "user" }) {
  const playlist = await findAnyPlaylist(store, {
    guildId,
    ownerId: userId,
    name: normalizePlaylistName(name),
    scope: normalizePlaylistScope(scope)
  });

  return playlist && !playlist.deletedAt ? normalizeStoredPlaylist(playlist) : null;
}

export async function addTrackToPlaylist(store, playlist, {
  query,
  title = null,
  addedById,
  addedByTag,
  now = new Date()
}) {
  const track = normalizePlaylistTrack({
    query,
    title,
    addedById,
    addedByTag,
    addedAt: now.toISOString()
  });

  if (playlist.tracks.length >= 100) {
    throw new Error("Playlist limit reached. Keep each playlist at 100 saved tracks or fewer.");
  }

  return store.update(
    MUSIC_PLAYLISTS_COLLECTION,
    (item) => item.id === playlist.id,
    (item) => ({
      ...item,
      tracks: [...normalizePlaylistTracks(item.tracks ?? []), track],
      updatedAt: now.toISOString()
    })
  );
}

export async function removeTrackFromPlaylist(store, playlist, index, now = new Date()) {
  const tracks = normalizePlaylistTracks(playlist.tracks);
  const zeroIndex = Number(index) - 1;
  if (!Number.isInteger(zeroIndex) || zeroIndex < 0 || zeroIndex >= tracks.length) {
    throw new Error(`Track index must be between 1 and ${tracks.length}.`);
  }

  return store.update(
    MUSIC_PLAYLISTS_COLLECTION,
    (item) => item.id === playlist.id,
    (item) => ({
      ...item,
      tracks: normalizePlaylistTracks(item.tracks ?? []).filter((_, currentIndex) => currentIndex !== zeroIndex),
      updatedAt: now.toISOString()
    })
  );
}

export async function deleteMusicPlaylist(store, playlist, {
  deletedById,
  now = new Date()
}) {
  return store.update(
    MUSIC_PLAYLISTS_COLLECTION,
    (item) => item.id === playlist.id,
    (item) => ({
      ...item,
      deletedAt: now.toISOString(),
      deletedById,
      updatedAt: now.toISOString()
    })
  );
}

export async function incrementPlaylistUse(store, playlist, now = new Date()) {
  return store.update(
    MUSIC_PLAYLISTS_COLLECTION,
    (item) => item.id === playlist.id,
    (item) => ({
      ...item,
      uses: Number(item.uses ?? 0) + 1,
      lastUsedAt: now.toISOString()
    })
  );
}

export function normalizePlaylistName(name) {
  const normalized = String(name ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized.length < 2) {
    throw new Error("Playlist name must contain at least 2 valid characters.");
  }

  return normalized.slice(0, 40);
}

export function normalizePlaylistScope(scope) {
  const normalized = String(scope ?? "user").trim().toLowerCase();
  if (!PLAYLIST_SCOPES.has(normalized)) {
    throw new Error("Playlist scope must be user or server.");
  }
  return normalized;
}

export function normalizePlaylistTrack(track) {
  const query = String(track?.query ?? "").trim();
  if (query.length < 1) throw new Error("Playlist track query cannot be empty.");
  if (query.length > 300) throw new Error("Playlist track query must be 300 characters or fewer.");

  return {
    id: track.id ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    query,
    title: String(track.title ?? query).trim().slice(0, 120),
    addedById: track.addedById ?? null,
    addedByTag: track.addedByTag ?? null,
    addedAt: track.addedAt ?? new Date().toISOString()
  };
}

export function normalizePlaylistTracks(tracks) {
  return Array.isArray(tracks) ? tracks.map(normalizePlaylistTrack) : [];
}

export function formatPlaylistTrack(track) {
  const normalized = normalizePlaylistTrack(track);
  return `${normalized.title} - \`${normalized.query}\``;
}

async function getAccessiblePlaylistFromInteraction(interaction, store) {
  const scope = interaction.options.getString("scope", false) ?? "user";
  const name = normalizePlaylistName(interaction.options.getString("name", true));
  const playlist = await getMusicPlaylist(store, {
    guildId: interaction.guildId,
    userId: interaction.user.id,
    name,
    scope
  });

  return { name, scope, playlist };
}

async function getEditablePlaylistFromInteraction(interaction, store, permissions) {
  const result = await getAccessiblePlaylistFromInteraction(interaction, store);
  if (!result.playlist) return result;
  if (result.playlist.scope === "server" && !permissions.canManageCommunityBot(interaction)) {
    return { ...result, playlist: null };
  }
  return result;
}

async function findAnyPlaylist(store, { guildId, ownerId, name, scope }) {
  const normalizedName = normalizePlaylistName(name);
  const normalizedScope = normalizePlaylistScope(scope);
  const playlists = await store.list(MUSIC_PLAYLISTS_COLLECTION);

  return playlists.find((playlist) =>
    playlist.guildId === guildId &&
    playlist.scope === normalizedScope &&
    playlist.name === normalizedName &&
    (normalizedScope === "server" || playlist.ownerId === ownerId)
  ) ?? null;
}

function normalizeStoredPlaylist(playlist) {
  return {
    ...playlist,
    scope: normalizePlaylistScope(playlist.scope),
    name: normalizePlaylistName(playlist.name),
    tracks: normalizePlaylistTracks(playlist.tracks),
    uses: Number(playlist.uses ?? 0)
  };
}

function playlistId({ guildId, ownerId, scope, name }) {
  return scope === "server" ? `${guildId}:server:${name}` : `${guildId}:user:${ownerId}:${name}`;
}
