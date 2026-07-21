import { AttachmentBuilder } from "discord.js";
import { createVireonEmbed } from "./embed-factory.js";
import { getLevelProgress, getOrCreateXpProfile, normalizeXpSettings, XP_COLLECTION } from "./xp-leveling.js";
import { getSettings } from "./config.js";
import { renderRankCard } from "./rank-card.js";

export function registerRankHandlers({ store }) {
  return async function handleRankCommand(interaction) {
    if (!interaction.isChatInputCommand()) return false;

    if (interaction.commandName === "rank") {
      await handleRank(interaction, store);
      return true;
    }

    if (interaction.commandName === "leaderboard") {
      await handleLeaderboard(interaction, store);
      return true;
    }

    return false;
  };
}

export async function handleRank(interaction, store) {
  const target = interaction.options.getUser("member", false) ?? interaction.options.getUser("user", false) ?? interaction.user;
  await interaction.deferReply();

  const settings = await getSettings(store);
  const xpSettings = normalizeXpSettings(settings.xp);
  const profile = await getOrCreateXpProfile(store, {
    guildId: interaction.guildId,
    userId: target.id,
    userTag: target.tag
  });
  const profiles = await getGuildXpProfiles(store, interaction.guildId);
  const rank = getUserRank(profiles, target.id);
  const progress = getLevelProgress(profile.xp, xpSettings);
  const card = await renderRankCard({
    user: {
      id: target.id,
      tag: target.tag,
      displayName: target.globalName ?? target.username ?? target.tag,
      avatarUrl: getAvatarUrl(target)
    },
    profile: {
      ...profile,
      level: progress.level
    },
    rank,
    progress
  });
  const attachment = new AttachmentBuilder(card, { name: "vireon-rank-card.png" });

  await interaction.editReply({
    content: `${target.id === interaction.user.id ? "Your" : `${target.username}'s`} Vireon rank card.`,
    files: [attachment]
  });
}

export async function handleLeaderboard(interaction, store) {
  const limit = interaction.options.getInteger("limit", false) ?? 10;
  const settings = await getSettings(store);
  const xpSettings = normalizeXpSettings(settings.xp);
  const profiles = (await getGuildXpProfiles(store, interaction.guildId)).slice(0, limit);

  if (profiles.length === 0) {
    await interaction.reply({
      ephemeral: true,
      content: "No XP profiles exist yet. Activity will appear here after members send messages or join voice."
    });
    return;
  }

  const lines = formatLeaderboardLines(profiles, xpSettings);
  await interaction.reply({
    embeds: [
      createVireonEmbed({
        title: "Vireon Leaderboard",
        description: lines.join("\n"),
        footer: "Vireon XP Engine"
      })
    ]
  });
}

export async function getGuildXpProfiles(store, guildId) {
  const profiles = await store.list(XP_COLLECTION);
  return profiles
    .filter((profile) => profile.guildId === guildId)
    .sort(compareXpProfiles);
}

export function getUserRank(profiles, userId) {
  const index = profiles.findIndex((profile) => profile.userId === userId);
  return index >= 0 ? index + 1 : profiles.length + 1;
}

export function formatLeaderboardLines(profiles, xpSettings = null) {
  return profiles.map((profile, index) => {
    const medal = index === 0 ? "01" : String(index + 1).padStart(2, "0");
    const name = profile.userTag ?? profile.userId;
    const level = xpSettings ? getLevelProgress(profile.xp, xpSettings).level : profile.level ?? 0;
    return `**#${medal}** ${name} | Level ${level} | ${Number(profile.xp ?? 0).toLocaleString()} XP`;
  });
}

function compareXpProfiles(a, b) {
  return Number(b.xp ?? 0) - Number(a.xp ?? 0)
    || Number(b.level ?? 0) - Number(a.level ?? 0)
    || String(a.userTag ?? a.userId).localeCompare(String(b.userTag ?? b.userId));
}

function getAvatarUrl(user) {
  try {
    return user.displayAvatarURL({ extension: "png", size: 128, forceStatic: true });
  } catch {
    return null;
  }
}
