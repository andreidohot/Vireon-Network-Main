import { createVireonEmbed } from "./embed-factory.js";

export const WALLET_LINKS_COLLECTION = "wallet-links";

const ACTIVE_WALLET_LINK_STATUSES = new Set(["active", "linked", "verified", "custodial"]);

export function registerRewardsHandlers({ store, chainClient }) {
  return async function handleRewardsCommand(interaction) {
    if (!interaction.isChatInputCommand() || interaction.commandName !== "rewards") return false;

    await handleRewards(interaction, { store, chainClient });
    return true;
  };
}

export async function handleRewards(interaction, { store, chainClient }) {
  const target = interaction.options.getUser("user", false) ?? interaction.user;
  await interaction.deferReply({ ephemeral: true });

  const walletLink = await getWalletLinkForUser(store, {
    guildId: interaction.guildId,
    userId: target.id
  });

  if (!walletLink) {
    await interaction.editReply({
      embeds: [
        createVireonEmbed({
          title: "Vireon Rewards",
          description: [
            target.id === interaction.user.id
              ? "No verified wallet is linked to your Discord account yet."
              : `No verified wallet is linked for **${target.username}** yet.`,
            "",
            "Rewards require a Discord <-> wallet link before mining, staking or node rewards can be queried.",
            "Run `/register custodial` or `/register external address:<wallet>` first."
          ].join("\n"),
          color: 0x8b1e24,
          footer: "Vireon Rewards | Wallet link required"
        })
      ]
    });
    return;
  }

  const rewards = await chainClient.getRewardsForAddress(walletLink.address);

  await interaction.editReply({
    embeds: [
      createVireonEmbed({
        title: "Vireon Rewards",
        description: buildRewardsDescription({ rewards, walletLink, target }),
        color: rewards.ok ? 0xd4af37 : 0x8b1e24,
        fields: [
          { name: "Wallet", value: formatAddress(walletLink.address), inline: false },
          { name: "Mining", value: formatRewardAmount(rewards.miningRewards, rewards.currency), inline: true },
          { name: "Staking", value: formatRewardAmount(rewards.stakingRewards, rewards.currency), inline: true },
          { name: "Node", value: formatRewardAmount(rewards.nodeRewards, rewards.currency), inline: true },
          { name: "Claimable", value: formatRewardAmount(rewards.claimableRewards, rewards.currency), inline: true },
          { name: "Pending", value: formatRewardAmount(rewards.pendingRewards, rewards.currency), inline: true },
          { name: "Paid", value: formatRewardAmount(rewards.paidRewards, rewards.currency), inline: true },
          { name: "Total", value: formatRewardAmount(rewards.totalRewards, rewards.currency), inline: true },
          { name: "Status", value: formatStatusValue(rewards.rawStatus ?? rewards.status), inline: true },
          { name: "RPC Cache", value: formatCacheStatus(rewards), inline: true },
          { name: "Source", value: formatStatusValue(rewards.source), inline: true }
        ],
        footer: rewards.mock ? "Vireon Rewards | Mock adapter" : "Vireon Rewards"
      })
    ]
  });
}

export async function getWalletLinkForUser(store, { guildId, userId }) {
  const links = await store.list(WALLET_LINKS_COLLECTION);
  return links
    .map(normalizeWalletLink)
    .filter((link) => link.guildId === guildId && link.userId === userId)
    .filter((link) => link.address && ACTIVE_WALLET_LINK_STATUSES.has(link.status))
    .sort(compareWalletLinks)[0] ?? null;
}

export function normalizeWalletLink(link = {}) {
  return {
    ...link,
    id: link.id ?? walletLinkId(link.guildId, link.userId, link.address),
    guildId: String(link.guildId ?? ""),
    userId: String(link.userId ?? ""),
    address: String(link.address ?? link.walletAddress ?? "").trim(),
    status: String(link.status ?? "verified").trim().toLowerCase(),
    linkedAt: link.linkedAt ?? link.createdAt ?? null,
    verifiedAt: link.verifiedAt ?? null,
    updatedAt: link.updatedAt ?? null
  };
}

export function walletLinkId(guildId, userId, address) {
  return `${guildId}:${userId}:${String(address ?? "").trim().toLowerCase()}`;
}

export function buildRewardsDescription({ rewards, walletLink, target }) {
  const owner = target?.id ? `<@${target.id}>` : walletLink.userId;

  if (rewards.ok && rewards.mock) {
    return [
      `Rewards for ${owner}.`,
      "Mock adapter active. These mining/staking/node reward values are simulated until a real Vireon RPC endpoint exists."
    ].join("\n");
  }

  if (rewards.ok) {
    if (rewards.stale) {
      return [
        `Rewards for ${owner}.`,
        "Live RPC is unavailable or rate-limited, so the latest cached reward values are being shown."
      ].join("\n");
    }
    return `Rewards for ${owner}, read from the configured Vireon chain adapter.`;
  }

  return [
    `Rewards for ${owner} could not be loaded.`,
    rewards.message ?? rewards.error ?? "Check the Vireon chain rewards endpoint configuration."
  ].join("\n");
}

export function formatRewardAmount(value, currency = "VIRE") {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value)} ${currency || "VIRE"}`;
}

export function formatAddress(address) {
  const value = String(address ?? "").trim();
  if (!value) return "Unavailable";
  if (value.length <= 24) return `\`${value}\``;
  return `\`${value.slice(0, 11)}...${value.slice(-10)}\``;
}

function formatStatusValue(value) {
  if (value == null || value === "") return "Unavailable";
  return String(value).slice(0, 1024);
}

function formatCacheStatus(result) {
  if (!result.cached) return "Fresh";
  const parts = [result.stale ? "Stale" : "Cached"];
  if (typeof result.cacheAgeMs === "number" && Number.isFinite(result.cacheAgeMs)) {
    parts.push(`${Math.round(result.cacheAgeMs / 1000)}s old`);
  }
  if (result.rateLimited) parts.push("rate-limited");
  if (result.fallbackStatus) parts.push(`fallback: ${result.fallbackStatus}`);
  return parts.join(" | ");
}

function compareWalletLinks(a, b) {
  return Date.parse(b.verifiedAt ?? b.updatedAt ?? b.linkedAt ?? 0)
    - Date.parse(a.verifiedAt ?? a.updatedAt ?? a.linkedAt ?? 0);
}
