import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { Connectors, LoadType, Shoukaku } from "shoukaku";
import { createVireonEmbed } from "./embed-factory.js";
import { childLogger, serializeError } from "./logger.js";

const MUSIC_BUTTON_PREFIX = "vireon_music:";
const PLAYABLE_END_REASONS = new Set(["finished", "loadFailed"]);
const STANDALONE_MUSIC_COMMANDS = new Set([
  "play",
  "pause",
  "resume",
  "skip",
  "stop",
  "queue",
  "nowplaying",
  "volume",
  "loop",
  "shuffle",
  "filter"
]);
const LOOP_MODES = ["off", "track", "queue"];
const NOW_PLAYING_BUTTON_ACTIONS = new Set(["pause", "skip", "queue"]);
export const AUDIO_FILTER_PRESETS = Object.freeze({
  off: {
    name: "off",
    label: "Off",
    description: "No active audio filter.",
    filters: null
  },
  bassboost: {
    name: "bassboost",
    label: "Bassboost",
    description: "Boosts low frequencies for a heavier sound.",
    filters: {
      equalizer: [
        { band: 0, gain: 0.22 },
        { band: 1, gain: 0.18 },
        { band: 2, gain: 0.12 },
        { band: 3, gain: 0.06 },
        { band: 4, gain: 0.02 }
      ]
    }
  },
  nightcore: {
    name: "nightcore",
    label: "Nightcore",
    description: "Raises speed and pitch for a nightcore feel.",
    filters: {
      timescale: { speed: 1.12, pitch: 1.18, rate: 1.0 }
    }
  },
  vaporwave: {
    name: "vaporwave",
    label: "Vaporwave",
    description: "Slows and lowers pitch for a vaporwave mood.",
    filters: {
      timescale: { speed: 0.84, pitch: 0.82, rate: 1.0 }
    }
  },
  karaoke: {
    name: "karaoke",
    label: "Karaoke",
    description: "Reduces center vocal frequencies.",
    filters: {
      karaoke: { level: 1.0, monoLevel: 1.0, filterBand: 220.0, filterWidth: 100.0 }
    }
  },
  eightd: {
    name: "eightd",
    label: "8D",
    description: "Rotates audio around the listener.",
    filters: {
      rotation: { rotationHz: 0.2 }
    }
  },
  lowpass: {
    name: "lowpass",
    label: "Low Pass",
    description: "Softens higher frequencies.",
    filters: {
      lowPass: { smoothing: 20.0 }
    }
  }
});
const URL_PATTERN = /^https?:\/\//i;
const logger = childLogger({ module: "music" });

export function registerMusicHandlers({ client, manager = null }) {
  const musicManager = manager ?? createMusicManager({ client });

  return async function handleMusicCommand(interaction) {
    const buttonAction = resolveMusicButtonAction(interaction);
    if (buttonAction) {
      if (!musicManager.enabled) {
        await interaction.reply({
          ephemeral: true,
          content: "Music is disabled. Set `MUSIC_ENABLED=true` and configure Lavalink to enable music controls."
        });
        return true;
      }

      try {
        await musicManager.handleNowPlayingButton(interaction, buttonAction);
      } catch (error) {
        logger.error({ error: serializeError(error), buttonAction }, "Music button failed.");
        await respond(interaction, {
          ephemeral: true,
          content: `Music control failed: ${error.message}`
        });
      }

      return true;
    }

    const command = resolveMusicCommand(interaction);
    if (!command) return false;

    if (!musicManager.enabled) {
      await interaction.reply({
        ephemeral: true,
        content: "Music is disabled. Set `MUSIC_ENABLED=true` and configure Lavalink to enable music commands."
      });
      return true;
    }

    try {
      if (command === "play") {
        await interaction.deferReply();
        await musicManager.play(interaction, interaction.options.getString("query", true));
        return true;
      }

      if (command === "queue") {
        await musicManager.showQueue(interaction);
        return true;
      }

      if (command === "nowplaying") {
        await musicManager.showNowPlaying(interaction);
        return true;
      }

      if (command === "skip") {
        await musicManager.skip(interaction);
        return true;
      }

      if (command === "pause") {
        await musicManager.pause(interaction);
        return true;
      }

      if (command === "resume") {
        await musicManager.resume(interaction);
        return true;
      }

      if (command === "stop") {
        await musicManager.stop(interaction);
        return true;
      }

      if (command === "leave") {
        await musicManager.leave(interaction);
        return true;
      }

      if (command === "volume") {
        await musicManager.volume(interaction, interaction.options.getInteger("percent", true));
        return true;
      }

      if (command === "loop") {
        await musicManager.loop(interaction, interaction.options.getString("mode", false));
        return true;
      }

      if (command === "shuffle") {
        await musicManager.shuffle(interaction);
        return true;
      }

      if (command === "filter") {
        await handleAudioFilterCommand(interaction, musicManager);
        return true;
      }
    } catch (error) {
      logger.error({ error: serializeError(error), command }, "Music command failed.");
      await respond(interaction, {
        ephemeral: true,
        content: `Music command failed: ${error.message}`
      });
      return true;
    }

    return true;
  };
}

export function createMusicManager({ client }) {
  const enabled = process.env.MUSIC_ENABLED === "true";
  const queues = new Map();
  const defaultVolume = clampNumber(Number(process.env.MUSIC_DEFAULT_VOLUME ?? 70), 1, 150);

  if (!enabled) {
    return createDisabledMusicManager();
  }

  const nodes = buildLavalinkNodes();
  if (nodes.length === 0) {
    throw new Error("MUSIC_ENABLED=true requires at least one Lavalink node.");
  }

  const lavalink = new Shoukaku(new Connectors.DiscordJS(client), nodes, {
    moveOnDisconnect: true,
    reconnectTries: 5,
    reconnectInterval: 5000,
    restTimeout: 10000,
    resume: true,
    resumeTimeout: 30,
    resumeByLibrary: true
  });

  lavalink.on("ready", (name) => {
    logger.info({ node: name }, "Lavalink node is ready.");
  });

  lavalink.on("error", (name, error) => {
    logger.error({ node: name, error: serializeError(error) }, "Lavalink node error.");
  });

  lavalink.on("close", (name, code, reason) => {
    logger.warn({ node: name, code, reason }, "Lavalink node closed.");
  });

  async function play(interaction, query) {
    const voiceChannelId = interaction.member?.voice?.channelId;
    if (!voiceChannelId) {
      await respond(interaction, {
        ephemeral: true,
        content: "Join a voice channel before using `/music play`."
      });
      return;
    }

    const node = lavalink.getIdealNode();
    if (!node) {
      await respond(interaction, {
        ephemeral: true,
        content: "No Lavalink node is available yet. Check the Lavalink service and try again."
      });
      return;
    }

    const result = await node.rest.resolve(normalizeIdentifier(query));
    const tracks = extractTracks(result);
    if (tracks.length === 0) {
      await respond(interaction, {
        ephemeral: true,
        content: "No playable tracks were found for that query."
      });
      return;
    }

    const guildId = interaction.guildId;
    const state = await getOrCreateQueue(interaction, voiceChannelId);
    const wasIdle = !state.current;

    state.queue.push(...tracks);
    state.textChannelId = interaction.channelId;

    if (wasIdle) {
      await playNext(guildId);
    }

    const firstTrack = tracks[0];
    const title = tracks.length === 1
      ? `Queued: ${formatTrack(firstTrack)}`
      : `Queued ${tracks.length} tracks. First: ${formatTrack(firstTrack)}`;

    await respond(interaction, {
      embeds: [createVireonEmbed({
        title: "Vireon Music",
        description: title
      })]
    });
  }

  async function playPlaylist(interaction, playlist) {
    const voiceChannelId = interaction.member?.voice?.channelId;
    if (!voiceChannelId) {
      await respond(interaction, {
        ephemeral: true,
        content: "Join a voice channel before playing a saved playlist."
      });
      return;
    }

    const node = lavalink.getIdealNode();
    if (!node) {
      await respond(interaction, {
        ephemeral: true,
        content: "No Lavalink node is available yet. Check the Lavalink service and try again."
      });
      return;
    }

    const tracks = [];
    for (const savedTrack of playlist.tracks.slice(0, 100)) {
      const result = await node.rest.resolve(normalizeIdentifier(savedTrack.query));
      tracks.push(...extractTracks(result).slice(0, 1));
    }

    if (tracks.length === 0) {
      await respond(interaction, {
        ephemeral: true,
        content: `No playable tracks were found in playlist \`${playlist.name}\`.`
      });
      return;
    }

    const guildId = interaction.guildId;
    const state = await getOrCreateQueue(interaction, voiceChannelId);
    const wasIdle = !state.current;

    state.queue.push(...tracks);
    state.textChannelId = interaction.channelId;

    if (wasIdle) {
      await playNext(guildId);
    }

    await respond(interaction, {
      embeds: [createVireonEmbed({
        title: "Saved Playlist Queued",
        description: `Queued **${tracks.length}** track${tracks.length === 1 ? "" : "s"} from \`${playlist.name}\`.`
      })]
    });
  }

  async function showQueue(interaction) {
    return showQueueWithOptions(interaction);
  }

  async function showQueueWithOptions(interaction, { ephemeral = false } = {}) {
    const state = queues.get(interaction.guildId);
    if (!state?.current) {
      await respond(interaction, { ephemeral: true, content: "Nothing is playing right now." });
      return;
    }

    const upcoming = state.queue
      .slice(0, 10)
      .map((track, index) => `${index + 1}. ${formatTrack(track)}`)
      .join("\n");

    await respond(interaction, {
      ephemeral,
      embeds: [createVireonEmbed({
        title: "Music Queue",
        description: [
          `Now: ${formatTrack(state.current)}`,
          `Loop: ${formatLoopMode(state.loopMode)}`,
          `Filter: ${formatAudioFilterName(state.audioFilter)}`,
          "",
          upcoming || "Queue is empty."
        ].join("\n")
      })]
    });
  }

  async function showNowPlaying(interaction) {
    const state = queues.get(interaction.guildId);
    if (!state?.current) {
      await respond(interaction, { ephemeral: true, content: "Nothing is playing right now." });
      return;
    }

    await respond(interaction, buildNowPlayingPanelPayload(state));
  }

  async function skip(interaction) {
    const state = await skipCurrentTrack(interaction.guildId);
    if (!state) {
      await respond(interaction, { ephemeral: true, content: "Nothing is playing right now." });
      return;
    }

    await respond(interaction, { content: "Skipped the current track." });
  }

  async function pause(interaction) {
    await setPauseState(interaction, true);
  }

  async function resume(interaction) {
    await setPauseState(interaction, false);
  }

  async function setPauseState(interaction, paused) {
    const state = queues.get(interaction.guildId);
    if (!state?.player || !state.current) {
      await respond(interaction, { ephemeral: true, content: "Nothing is playing right now." });
      return;
    }

    state.paused = Boolean(paused);
    await state.player.setPaused(state.paused);
    await respond(interaction, { content: state.paused ? "Playback paused." : "Playback resumed." });
  }

  async function stop(interaction) {
    const state = queues.get(interaction.guildId);
    if (!state?.player) {
      await respond(interaction, { ephemeral: true, content: "Music is not active on this server." });
      return;
    }

    state.queue = [];
    state.current = null;
    state.loopMode = "off";
    state.audioFilter = "off";
    state.paused = false;
    await state.player.clearFilters();
    await state.player.stopTrack();
    await respond(interaction, { content: "Playback stopped and queue cleared." });
  }

  async function leave(interaction) {
    const state = queues.get(interaction.guildId);
    if (!state) {
      await respond(interaction, { ephemeral: true, content: "Music is not active on this server." });
      return;
    }

    queues.delete(interaction.guildId);
    await lavalink.leaveVoiceChannel(interaction.guildId);
    await respond(interaction, { content: "Disconnected from voice and cleared the queue." });
  }

  async function volume(interaction, percent) {
    const state = queues.get(interaction.guildId);
    if (!state?.player) {
      await respond(interaction, { ephemeral: true, content: "Music is not active on this server." });
      return;
    }

    const nextVolume = clampNumber(percent, 1, 150);
    state.volume = nextVolume;
    await state.player.setGlobalVolume(nextVolume);
    await respond(interaction, { content: `Volume set to ${nextVolume}%.` });
  }

  async function loop(interaction, mode) {
    const state = queues.get(interaction.guildId);
    if (!state?.player) {
      await respond(interaction, { ephemeral: true, content: "Music is not active on this server." });
      return;
    }

    state.loopMode = resolveLoopMode(state.loopMode, mode);
    await respond(interaction, { content: `Loop mode set to ${formatLoopMode(state.loopMode)}.` });
  }

  async function shuffle(interaction) {
    const state = queues.get(interaction.guildId);
    if (!state?.player || !state.current) {
      await respond(interaction, { ephemeral: true, content: "Nothing is playing right now." });
      return;
    }

    if (state.queue.length < 2) {
      await respond(interaction, { ephemeral: true, content: "Add at least two queued tracks before shuffling." });
      return;
    }

    state.queue = shuffleTracks(state.queue);
    await respond(interaction, { content: `Shuffled ${state.queue.length} queued tracks.` });
  }

  async function handleNowPlayingButton(interaction, action) {
    if (action === "queue") {
      await showQueueWithOptions(interaction, { ephemeral: true });
      return;
    }

    if (action === "pause") {
      const state = queues.get(interaction.guildId);
      if (!state?.player || !state.current) {
        await interaction.reply({ ephemeral: true, content: "Nothing is playing right now." });
        return;
      }

      state.paused = !Boolean(state.paused ?? state.player.paused);
      await state.player.setPaused(state.paused);
      await interaction.update(buildNowPlayingPanelPayload(state));
      return;
    }

    if (action === "skip") {
      const state = await skipCurrentTrack(interaction.guildId);
      if (!state) {
        await interaction.reply({ ephemeral: true, content: "Nothing is playing right now." });
        return;
      }

      await interaction.update(buildNowPlayingPanelPayload(state));
    }
  }

  async function applyFilter(interaction, presetName) {
    const state = queues.get(interaction.guildId);
    if (!state?.player) {
      await respond(interaction, { ephemeral: true, content: "Music is not active on this server." });
      return;
    }

    const preset = buildAudioFilterPreset(presetName);
    if (preset.name === "off") {
      await state.player.clearFilters();
    } else {
      await state.player.setFilters(preset.filters);
    }

    state.audioFilter = preset.name;
    await respond(interaction, { content: `Audio filter set to ${preset.label}.` });
  }

  async function clearFilter(interaction) {
    await applyFilter(interaction, "off");
  }

  async function showFilter(interaction) {
    const state = queues.get(interaction.guildId);
    if (!state?.player) {
      await respond(interaction, { ephemeral: true, content: "Music is not active on this server." });
      return;
    }

    const preset = buildAudioFilterPreset(state.audioFilter ?? "off");
    await respond(interaction, {
      embeds: [createVireonEmbed({
        title: "Audio Filter",
        description: [
          `Active: **${preset.label}**`,
          preset.description
        ].join("\n")
      })]
    });
  }

  async function getOrCreateQueue(interaction, voiceChannelId) {
    const guildId = interaction.guildId;
    const existing = queues.get(guildId);
    if (existing) {
      if (existing.voiceChannelId !== voiceChannelId) {
        throw new Error("The music player is already active in another voice channel.");
      }
      return existing;
    }

    const player = await lavalink.joinVoiceChannel({
      guildId,
      channelId: voiceChannelId,
      shardId: interaction.guild?.shardId ?? 0,
      deaf: true
    });
    await player.setGlobalVolume(defaultVolume);

    const state = {
      player,
      voiceChannelId,
      textChannelId: interaction.channelId,
      queue: [],
      current: null,
      volume: defaultVolume,
      loopMode: "off",
      audioFilter: "off",
      paused: false
    };

    player.on("end", async (event) => {
      if (!PLAYABLE_END_REASONS.has(event.reason)) return;
      await playNext(guildId).catch((error) => {
        logger.error({ error: serializeError(error), guildId }, "Failed to play next track.");
      });
    });

    player.on("exception", (event) => {
      logger.error({ exception: event.exception, guildId }, "Lavalink track exception.");
    });

    queues.set(guildId, state);
    return state;
  }

  async function playNext(guildId, options = {}) {
    const state = queues.get(guildId);
    if (!state) return;

    const nextTrack = advanceQueueState(state, options);
    if (!nextTrack) {
      return;
    }

    await state.player.playTrack({ track: { encoded: nextTrack.encoded } });
    state.paused = false;
  }

  async function skipCurrentTrack(guildId) {
    const state = queues.get(guildId);
    if (!state?.player || !state.current) return null;

    await state.player.stopTrack();
    await playNext(guildId, { skipCurrent: true });
    return state;
  }

  async function healthCheck() {
    const nodes = [...lavalink.nodes.values()].map((node) => ({
      name: node.name,
      state: String(node.state),
      connected: Boolean(node.sessionId),
      sessionId: node.sessionId ?? null,
      stats: node.stats
        ? {
            players: node.stats.players,
            playingPlayers: node.stats.playingPlayers,
            uptime: node.stats.uptime
          }
        : null,
      players: [...lavalink.players.values()].filter((player) => player.node.name === node.name).length
    }));
    const readyNodes = nodes.filter((node) => node.sessionId).length;

    return {
      ok: readyNodes > 0,
      status: readyNodes > 0 ? "ready" : "unavailable",
      enabled: true,
      configuredNodes: nodes.length,
      readyNodes,
      nodes,
      players: lavalink.players.size,
      queues: queues.size,
      loopQueues: [...queues.values()].filter((state) => state.loopMode !== "off").length,
      filteredQueues: [...queues.values()].filter((state) => state.audioFilter !== "off").length
    };
  }

  return {
    enabled,
    lavalink,
    queues,
    healthCheck,
    play,
    playPlaylist,
    showQueue,
    showNowPlaying,
    handleNowPlayingButton,
    skip,
    pause,
    resume,
    stop,
    leave,
    volume,
    loop,
    shuffle,
    applyFilter,
    clearFilter,
    showFilter
  };
}

function createDisabledMusicManager() {
  return {
    enabled: false,
    async healthCheck() {
      return {
        ok: true,
        status: "disabled",
        enabled: false
      };
    },
    async play() {},
    async playPlaylist() {},
    async showQueue() {},
    async showNowPlaying() {},
    async handleNowPlayingButton() {},
    async skip() {},
    async pause() {},
    async resume() {},
    async stop() {},
    async leave() {},
    async volume() {},
    async loop() {},
    async shuffle() {},
    async applyFilter() {},
    async clearFilter() {},
    async showFilter() {}
  };
}

async function handleAudioFilterCommand(interaction, musicManager) {
  if (interaction.commandName === "filter") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "preset") {
      await musicManager.applyFilter(interaction, interaction.options.getString("preset", true));
      return;
    }
    if (subcommand === "clear") {
      await musicManager.clearFilter(interaction);
      return;
    }
    if (subcommand === "status") {
      await musicManager.showFilter(interaction);
      return;
    }
  }

  await musicManager.applyFilter(interaction, interaction.options.getString("preset", true));
}

export function resolveMusicCommand(interaction) {
  if (!interaction.isChatInputCommand()) return null;
  if (interaction.commandName === "music") return interaction.options.getSubcommand();
  if (STANDALONE_MUSIC_COMMANDS.has(interaction.commandName)) return interaction.commandName;
  return null;
}

export function resolveMusicButtonAction(interaction) {
  if (!interaction.isButton?.()) return null;
  if (!interaction.customId?.startsWith(MUSIC_BUTTON_PREFIX)) return null;
  const action = interaction.customId.slice(MUSIC_BUTTON_PREFIX.length);
  return NOW_PLAYING_BUTTON_ACTIONS.has(action) ? action : null;
}

export function buildNowPlayingComponents({ paused = false } = {}) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${MUSIC_BUTTON_PREFIX}pause`)
        .setLabel(paused ? "Resume" : "Pause")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`${MUSIC_BUTTON_PREFIX}skip`)
        .setLabel("Skip")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`${MUSIC_BUTTON_PREFIX}queue`)
        .setLabel("Queue")
        .setStyle(ButtonStyle.Secondary)
    )
  ];
}

export function buildLavalinkNodes(env = process.env) {
  if (env.LAVALINK_NODES) {
    const parsed = JSON.parse(env.LAVALINK_NODES);
    if (!Array.isArray(parsed)) throw new Error("LAVALINK_NODES must be a JSON array.");
    if (parsed.length === 0) throw new Error("LAVALINK_NODES must contain at least one node.");
    return parsed.map((node, index) => normalizeLavalinkNode(node, index));
  }

  const host = env.LAVALINK_HOST ?? "127.0.0.1";
  const port = env.LAVALINK_PORT ?? "2333";
  const secure = env.LAVALINK_SECURE === "true";
  const auth = env.LAVALINK_PASSWORD ?? "youshallnotpass";
  const protocol = secure ? "https" : "http";

  return [{
    name: "vireon-main",
    url: `${protocol}://${host}:${port}`,
    auth,
    secure
  }];
}

function normalizeLavalinkNode(node, index) {
  const url = String(node?.url ?? "").trim();
  const auth = String(node?.auth ?? "").trim();
  if (!url) throw new Error(`Lavalink node ${index + 1} is missing url.`);
  if (!auth) throw new Error(`Lavalink node ${index + 1} is missing auth.`);

  return {
    name: node.name ?? `vireon-${index + 1}`,
    url,
    auth,
    secure: Boolean(node.secure),
    group: node.group
  };
}

export function resolveLoopMode(currentMode = "off", requestedMode = null) {
  if (requestedMode) {
    if (!LOOP_MODES.includes(requestedMode)) throw new Error("Invalid loop mode.");
    return requestedMode;
  }

  const currentIndex = LOOP_MODES.indexOf(currentMode);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % LOOP_MODES.length;
  return LOOP_MODES[nextIndex];
}

export function advanceQueueState(state, { skipCurrent = false } = {}) {
  if (!state) return null;

  if (!skipCurrent && state.loopMode === "track" && state.current) {
    return state.current;
  }

  if (!skipCurrent && state.loopMode === "queue" && state.current) {
    state.queue.push(state.current);
  }

  const nextTrack = state.queue.shift() ?? null;
  state.current = nextTrack;
  return nextTrack;
}

export function shuffleTracks(tracks, random = Math.random) {
  const shuffled = [...tracks];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function buildAudioFilterPreset(name) {
  const normalized = normalizeAudioFilterName(name);
  const preset = AUDIO_FILTER_PRESETS[normalized];
  if (!preset) {
    throw new Error(`Unknown audio filter preset: ${name}.`);
  }

  return {
    ...preset,
    filters: preset.filters ? structuredClone(preset.filters) : null
  };
}

export function normalizeAudioFilterName(name) {
  return String(name ?? "off").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeIdentifier(query) {
  const trimmed = query.trim();
  if (URL_PATTERN.test(trimmed)) return trimmed;
  return `ytsearch:${trimmed}`;
}

function extractTracks(result) {
  if (!result) return [];
  if (result.loadType === LoadType.TRACK) return [result.data];
  if (result.loadType === LoadType.SEARCH) return result.data.slice(0, 1);
  if (result.loadType === LoadType.PLAYLIST) return result.data.tracks;
  return [];
}

function formatTrack(track) {
  const title = track.info?.title ?? "Unknown title";
  const author = track.info?.author ? ` by ${track.info.author}` : "";
  const duration = track.info?.isStream ? "live" : formatDuration(track.info?.length ?? 0);
  return `[${title}](${track.info?.uri ?? "https://vireon.network"})${author} (${duration})`;
}

function buildNowPlayingPanelPayload(state) {
  if (!state?.current) {
    return {
      content: "Nothing is playing right now.",
      embeds: [],
      components: []
    };
  }

  return {
    embeds: [createVireonEmbed({
      title: "Now Playing",
      description: [
        formatTrack(state.current),
        `Volume: ${state.volume}%`,
        `Loop: ${formatLoopMode(state.loopMode)}`,
        `Filter: ${formatAudioFilterName(state.audioFilter)}`
      ].join("\n")
    })],
    components: buildNowPlayingComponents({ paused: Boolean(state.paused ?? state.player?.paused) })
  };
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatLoopMode(mode) {
  if (mode === "track") return "track";
  if (mode === "queue") return "queue";
  return "off";
}

function formatAudioFilterName(name) {
  return buildAudioFilterPreset(name ?? "off").label;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

async function respond(interaction, payload) {
  if (interaction.deferred) {
    await interaction.editReply(payload);
    return;
  }

  if (interaction.replied) {
    await interaction.followUp(payload);
    return;
  }

  await interaction.reply(payload);
}
