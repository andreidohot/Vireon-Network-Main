import { createVireonEmbed } from "./embed-factory.js";
import { getSettings } from "./config.js";

export const ECONOMY_WALLETS_COLLECTION = "economy-wallets";
export const ECONOMY_TRANSACTIONS_COLLECTION = "economy-transactions";

const DEFAULT_ECONOMY_SETTINGS = Object.freeze({
  enabled: true,
  currencyName: "Shards",
  currencySymbol: "SHD",
  transferEnabled: true,
  minTransferAmount: 1,
  maxTransferAmount: 10000,
  starterBalance: 0,
  dailyAmount: 100,
  dailyCooldownHours: 24,
  workMinAmount: 15,
  workMaxAmount: 75,
  workCooldownMinutes: 60,
  shopEnabled: true,
  shopItems: [],
  showNotVireDisclaimer: true
});

const WORK_MESSAGES = Object.freeze([
  "helped organize the Vireon workshop",
  "reviewed community ideas",
  "cleaned up the testnet notes",
  "supported a new member",
  "prepared materials for the next build sprint"
]);

export function registerEconomyHandlers({ store, permissions }) {
  return async function handleEconomyCommand(interaction) {
    if (!interaction.isChatInputCommand()) return false;

    if (interaction.commandName === "daily") {
      await handleDaily(interaction, store);
      return true;
    }

    if (interaction.commandName === "work") {
      await handleWork(interaction, store);
      return true;
    }

    if (interaction.commandName === "balance") {
      await handleBalance(interaction, store);
      return true;
    }

    if (interaction.commandName === "leaderboard-economy") {
      await handleEconomyLeaderboard(interaction, store);
      return true;
    }

    if (interaction.commandName === "shop") {
      await handleShop(interaction, store);
      return true;
    }

    if (interaction.commandName !== "shards") return false;

    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "balance") await handleBalance(interaction, store);
    if (subcommand === "leaderboard") await handleEconomyLeaderboard(interaction, store);
    if (subcommand === "transfer") await handleTransfer(interaction, store);
    if (subcommand === "grant") await handleStaffAdjust(interaction, store, permissions, "grant");
    if (subcommand === "take") await handleStaffAdjust(interaction, store, permissions, "take");

    return true;
  };
}

export async function handleDaily(interaction, store) {
  const settings = await getEconomySettings(store);
  if (await replyIfEconomyDisabled(interaction, settings)) return;

  try {
    const result = await claimDailyReward(store, {
      guildId: interaction.guildId,
      user: interaction.user,
      settings
    });

    await interaction.reply({
      embeds: [
        createVireonEmbed({
          title: "Daily Shards",
          description: [
            `You claimed **${formatCurrency(result.amount, settings)}**.`,
            `New balance: **${formatCurrency(result.wallet.balance, settings)}**.`,
            formatEconomyDisclaimer(settings)
          ].filter(Boolean).join("\n")
        })
      ]
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handleWork(interaction, store) {
  const settings = await getEconomySettings(store);
  if (await replyIfEconomyDisabled(interaction, settings)) return;

  try {
    const result = await claimWorkReward(store, {
      guildId: interaction.guildId,
      user: interaction.user,
      settings
    });

    await interaction.reply({
      embeds: [
        createVireonEmbed({
          title: "Work Complete",
          description: [
            `You ${result.activity} and earned **${formatCurrency(result.amount, settings)}**.`,
            `New balance: **${formatCurrency(result.wallet.balance, settings)}**.`,
            formatEconomyDisclaimer(settings)
          ].filter(Boolean).join("\n")
        })
      ]
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handleBalance(interaction, store) {
  const settings = await getEconomySettings(store);
  if (await replyIfEconomyDisabled(interaction, settings)) return;

  const target = interaction.options.getUser("user", false) ?? interaction.user;
  const wallet = await getOrCreateEconomyWallet(store, {
    guildId: interaction.guildId,
    userId: target.id,
    userTag: target.tag
  });

  await interaction.reply({
    embeds: [
      createVireonEmbed({
        title: `${settings.currencyName} Balance`,
        description: [
          `**${target.username}** has **${formatCurrency(wallet.balance, settings)}**.`,
          formatEconomyDisclaimer(settings)
        ].filter(Boolean).join("\n")
      })
    ]
  });
}

export async function handleEconomyLeaderboard(interaction, store) {
  const settings = await getEconomySettings(store);
  if (await replyIfEconomyDisabled(interaction, settings)) return;

  const limit = interaction.options.getInteger("limit", false) ?? 10;
  const wallets = (await getGuildEconomyWallets(store, interaction.guildId)).slice(0, limit);

  if (wallets.length === 0) {
    await interaction.reply({
      ephemeral: true,
      content: `No ${settings.currencyName} wallets exist yet. Social activity and minigames will populate this board.`
    });
    return;
  }

  await interaction.reply({
    embeds: [
      createVireonEmbed({
        title: `${settings.currencyName} Leaderboard`,
        description: [
          ...formatEconomyLeaderboardLines(wallets, settings),
          "",
          formatEconomyDisclaimer(settings)
        ].filter(Boolean).join("\n"),
        footer: "Server-only social economy"
      })
    ]
  });
}

export async function handleTransfer(interaction, store) {
  const settings = await getEconomySettings(store);
  if (await replyIfEconomyDisabled(interaction, settings)) return;

  if (!settings.transferEnabled) {
    await interaction.reply({
      ephemeral: true,
      content: `${settings.currencyName} transfers are disabled for this server.`
    });
    return;
  }

  const target = interaction.options.getUser("user", true);
  const amount = interaction.options.getInteger("amount", true);
  const reason = interaction.options.getString("reason", false) ?? "Member transfer";

  try {
    const result = await transferSocialCurrency(store, {
      guildId: interaction.guildId,
      fromUser: interaction.user,
      toUser: target,
      amount,
      reason,
      settings
    });

    await interaction.reply({
      embeds: [
        createVireonEmbed({
          title: `${settings.currencyName} Transfer`,
          description: [
            `Transferred **${formatCurrency(amount, settings)}** from **${interaction.user.username}** to **${target.username}**.`,
            `Your new balance: **${formatCurrency(result.fromWallet.balance, settings)}**.`,
            formatEconomyDisclaimer(settings)
          ].filter(Boolean).join("\n")
        })
      ]
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handleStaffAdjust(interaction, store, permissions, mode) {
  if (!permissions.canManageCommunityBot(interaction)) {
    await interaction.reply({
      ephemeral: true,
      content: `You need VBOS management permission to ${mode} Shards.`
    });
    return;
  }

  const settings = await getEconomySettings(store);
  if (await replyIfEconomyDisabled(interaction, settings)) return;

  const target = interaction.options.getUser("user", true);
  const amount = interaction.options.getInteger("amount", true);
  const reason = interaction.options.getString("reason", false) ?? `Staff ${mode}`;
  const signedAmount = mode === "take" ? -amount : amount;

  try {
    const result = await adjustSocialCurrency(store, {
      guildId: interaction.guildId,
      userId: target.id,
      userTag: target.tag,
      amount: signedAmount,
      type: mode,
      actorId: interaction.user.id,
      reason
    });

    await interaction.reply({
      ephemeral: true,
      embeds: [
        createVireonEmbed({
          title: `${settings.currencyName} ${mode === "take" ? "Removed" : "Granted"}`,
          description: [
            `Updated **${target.username}** by **${formatCurrency(Math.abs(amount), settings)}**.`,
            `New balance: **${formatCurrency(result.wallet.balance, settings)}**.`,
            formatEconomyDisclaimer(settings)
          ].filter(Boolean).join("\n")
        })
      ]
    });
  } catch (error) {
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function handleShop(interaction, store) {
  const settings = await getEconomySettings(store);
  if (await replyIfEconomyDisabled(interaction, settings)) return;

  if (!settings.shopEnabled) {
    await interaction.reply({ ephemeral: true, content: `${settings.currencyName} shop is disabled for this server.` });
    return;
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "list") {
    await handleShopList(interaction, settings);
    return;
  }

  if (subcommand === "buy") {
    await handleShopBuy(interaction, store, settings);
  }
}

export async function handleShopList(interaction, settings) {
  const items = settings.shopItems.filter((item) => item.active !== false);
  if (items.length === 0) {
    await interaction.reply({
      ephemeral: true,
      content: "The cosmetic role shop has no active items yet."
    });
    return;
  }

  await interaction.reply({
    embeds: [
      createVireonEmbed({
        title: `${settings.currencyName} Cosmetic Shop`,
        description: [
          ...formatShopLines(items, settings),
          "",
          "Use `/shop buy item_id:<id>` to buy a configured cosmetic role.",
          formatEconomyDisclaimer(settings)
        ].filter(Boolean).join("\n")
      })
    ]
  });
}

export async function handleShopBuy(interaction, store, settings) {
  const itemId = interaction.options.getString("item_id", true);
  const item = settings.shopItems.find((entry) => entry.id === itemId && entry.active !== false);
  if (!item) {
    await interaction.reply({ ephemeral: true, content: "That shop item does not exist or is disabled." });
    return;
  }

  const member = interaction.member;
  if (member?.roles?.cache?.has?.(item.roleId)) {
    await interaction.reply({ ephemeral: true, content: `You already have the ${item.roleName || item.name} role.` });
    return;
  }

  const role = await findGuildRole(interaction.guild, item.roleId);
  if (!role) {
    await interaction.reply({ ephemeral: true, content: "The configured cosmetic role no longer exists." });
    return;
  }

  try {
    const wallet = await getOrCreateEconomyWallet(store, {
      guildId: interaction.guildId,
      userId: interaction.user.id,
      userTag: interaction.user.tag
    });
    if (wallet.balance < item.price) {
      await interaction.reply({ ephemeral: true, content: "Insufficient Shards balance." });
      return;
    }

    await member.roles.add(role, "Vireon Shards cosmetic shop purchase.");
    const result = await buyShopItem(store, {
      guildId: interaction.guildId,
      user: interaction.user,
      item,
      settings
    });

    await interaction.reply({
      embeds: [
        createVireonEmbed({
          title: "Shop Purchase Complete",
          description: [
            `You bought **${item.name}** for **${formatCurrency(item.price, settings)}**.`,
            `New balance: **${formatCurrency(result.wallet.balance, settings)}**.`,
            formatEconomyDisclaimer(settings)
          ].filter(Boolean).join("\n")
        })
      ]
    });
  } catch (error) {
    if (member?.roles?.cache?.has?.(item.roleId) && typeof member.roles.remove === "function") {
      await member.roles.remove(item.roleId, "Vireon Shards shop purchase rollback.").catch(() => null);
    }
    await interaction.reply({ ephemeral: true, content: error.message });
  }
}

export async function getEconomySettings(store) {
  const settings = await getSettings(store);
  return normalizeEconomySettings(settings.economy);
}

export async function getOrCreateEconomyWallet(store, { guildId, userId, userTag = null, now = new Date() }) {
  const existing = (await store.list(ECONOMY_WALLETS_COLLECTION)).find(
    (item) => item.guildId === guildId && item.userId === userId
  );
  if (existing) return normalizeEconomyWallet(existing);

  const settings = await getEconomySettings(store);
  return upsertEconomyWallet(store, createEconomyWallet({
    guildId,
    userId,
    userTag,
    balance: settings.starterBalance,
    now
  }));
}

export async function adjustSocialCurrency(store, {
  guildId,
  userId,
  userTag = null,
  amount,
  type = "adjust",
  actorId = null,
  reason = "Social economy adjustment",
  walletPatch = {},
  now = new Date()
}) {
  const delta = Math.floor(Number(amount));
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error("Amount must be a non-zero whole number.");
  }

  const wallet = await getOrCreateEconomyWallet(store, { guildId, userId, userTag, now });
  const nextBalance = wallet.balance + delta;
  if (nextBalance < 0) {
    throw new Error("Insufficient Shards balance.");
  }

  const updatedWallet = await upsertEconomyWallet(store, {
    ...wallet,
    userTag: userTag ?? wallet.userTag,
    balance: nextBalance,
    totalEarned: wallet.totalEarned + Math.max(0, delta),
    totalSpent: wallet.totalSpent + Math.max(0, -delta),
    ...walletPatch,
    updatedAt: now.toISOString()
  });
  const transaction = await recordEconomyTransaction(store, {
    guildId,
    userId,
    userTag: userTag ?? wallet.userTag,
    amount: delta,
    balanceAfter: updatedWallet.balance,
    type,
    actorId,
    reason,
    now
  });

  return { wallet: updatedWallet, transaction };
}

export async function claimDailyReward(store, {
  guildId,
  user,
  settings = null,
  now = new Date()
}) {
  const economySettings = settings ? normalizeEconomySettings(settings) : await getEconomySettings(store);
  const wallet = await getOrCreateEconomyWallet(store, {
    guildId,
    userId: user.id,
    userTag: user.tag,
    now
  });
  const cooldownMs = economySettings.dailyCooldownHours * 60 * 60 * 1000;
  assertCooldownReady(wallet.lastDailyAt, cooldownMs, now, "Daily reward");

  const result = await adjustSocialCurrency(store, {
    guildId,
    userId: user.id,
    userTag: user.tag,
    amount: economySettings.dailyAmount,
    type: "daily",
    actorId: user.id,
    reason: "Daily Shards claim",
    walletPatch: { lastDailyAt: now.toISOString() },
    now
  });

  return { ...result, amount: economySettings.dailyAmount };
}

export async function claimWorkReward(store, {
  guildId,
  user,
  settings = null,
  rng = Math.random,
  now = new Date()
}) {
  const economySettings = settings ? normalizeEconomySettings(settings) : await getEconomySettings(store);
  const wallet = await getOrCreateEconomyWallet(store, {
    guildId,
    userId: user.id,
    userTag: user.tag,
    now
  });
  const cooldownMs = economySettings.workCooldownMinutes * 60 * 1000;
  assertCooldownReady(wallet.lastWorkAt, cooldownMs, now, "Work command");

  const amount = calculateWorkReward(economySettings, rng);
  const activity = WORK_MESSAGES[Math.floor(rng() * WORK_MESSAGES.length)] ?? WORK_MESSAGES[0];
  const result = await adjustSocialCurrency(store, {
    guildId,
    userId: user.id,
    userTag: user.tag,
    amount,
    type: "work",
    actorId: user.id,
    reason: `Work reward: ${activity}`,
    walletPatch: { lastWorkAt: now.toISOString() },
    now
  });

  return { ...result, amount, activity };
}

export async function buyShopItem(store, {
  guildId,
  user,
  item,
  settings = null,
  now = new Date()
}) {
  const economySettings = settings ? normalizeEconomySettings(settings) : await getEconomySettings(store);
  const shopItem = normalizeShopItems([item])[0];
  if (!shopItem) throw new Error("Invalid shop item.");
  if (!economySettings.shopEnabled) throw new Error(`${economySettings.currencyName} shop is disabled.`);

  return adjustSocialCurrency(store, {
    guildId,
    userId: user.id,
    userTag: user.tag,
    amount: -shopItem.price,
    type: "shop_purchase",
    actorId: user.id,
    reason: `Shop purchase: ${shopItem.id}`,
    now
  });
}

export async function transferSocialCurrency(store, {
  guildId,
  fromUser,
  toUser,
  amount,
  reason = "Member transfer",
  settings = null,
  now = new Date()
}) {
  const economySettings = settings ? normalizeEconomySettings(settings) : await getEconomySettings(store);
  const transferAmount = Math.floor(Number(amount));

  if (!toUser || toUser.bot) throw new Error("You can only transfer Shards to a real server member.");
  if (fromUser.id === toUser.id) throw new Error("You cannot transfer Shards to yourself.");
  if (transferAmount < economySettings.minTransferAmount || transferAmount > economySettings.maxTransferAmount) {
    throw new Error(`Transfer amount must be between ${economySettings.minTransferAmount} and ${economySettings.maxTransferAmount} ${economySettings.currencyName}.`);
  }

  const debit = await adjustSocialCurrency(store, {
    guildId,
    userId: fromUser.id,
    userTag: fromUser.tag,
    amount: -transferAmount,
    type: "transfer_out",
    actorId: fromUser.id,
    reason,
    now
  });
  const credit = await adjustSocialCurrency(store, {
    guildId,
    userId: toUser.id,
    userTag: toUser.tag,
    amount: transferAmount,
    type: "transfer_in",
    actorId: fromUser.id,
    reason,
    now
  });

  return {
    fromWallet: debit.wallet,
    toWallet: credit.wallet,
    debitTransaction: debit.transaction,
    creditTransaction: credit.transaction
  };
}

export async function getGuildEconomyWallets(store, guildId) {
  const wallets = await store.list(ECONOMY_WALLETS_COLLECTION);
  return wallets
    .filter((wallet) => wallet.guildId === guildId)
    .map(normalizeEconomyWallet)
    .sort(compareEconomyWallets);
}

export async function upsertEconomyWallet(store, wallet) {
  const normalized = normalizeEconomyWallet(wallet);
  const updated = await store.update(
    ECONOMY_WALLETS_COLLECTION,
    (item) => item.id === normalized.id,
    () => normalized
  );

  return updated ?? store.add(ECONOMY_WALLETS_COLLECTION, normalized);
}

export function createEconomyWallet({ guildId, userId, userTag = null, balance = 0, now = new Date() }) {
  const timestamp = now instanceof Date ? now.toISOString() : String(now);
  const startingBalance = Math.max(0, Math.floor(Number(balance) || 0));
  return {
    id: economyWalletId(guildId, userId),
    guildId,
    userId,
    userTag,
    balance: startingBalance,
    totalEarned: startingBalance,
    totalSpent: 0,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function normalizeEconomySettings(settings = {}) {
  const maxTransferAmount = clampInteger(settings.maxTransferAmount, 1, 1000000000, DEFAULT_ECONOMY_SETTINGS.maxTransferAmount);
  const minTransferAmount = Math.min(
    maxTransferAmount,
    clampInteger(settings.minTransferAmount, 1, maxTransferAmount, DEFAULT_ECONOMY_SETTINGS.minTransferAmount)
  );

  return {
    ...DEFAULT_ECONOMY_SETTINGS,
    ...settings,
    enabled: settings.enabled !== false,
    currencyName: normalizeCurrencyName(settings.currencyName),
    currencySymbol: normalizeCurrencySymbol(settings.currencySymbol),
    transferEnabled: settings.transferEnabled !== false,
    minTransferAmount,
    maxTransferAmount,
    starterBalance: clampInteger(settings.starterBalance, 0, 1000000, DEFAULT_ECONOMY_SETTINGS.starterBalance),
    dailyAmount: clampInteger(settings.dailyAmount, 1, 1000000, DEFAULT_ECONOMY_SETTINGS.dailyAmount),
    dailyCooldownHours: clampInteger(settings.dailyCooldownHours, 1, 720, DEFAULT_ECONOMY_SETTINGS.dailyCooldownHours),
    workMinAmount: clampInteger(settings.workMinAmount, 1, 1000000, DEFAULT_ECONOMY_SETTINGS.workMinAmount),
    workMaxAmount: Math.max(
      clampInteger(settings.workMinAmount, 1, 1000000, DEFAULT_ECONOMY_SETTINGS.workMinAmount),
      clampInteger(settings.workMaxAmount, 1, 1000000, DEFAULT_ECONOMY_SETTINGS.workMaxAmount)
    ),
    workCooldownMinutes: clampInteger(settings.workCooldownMinutes, 1, 43200, DEFAULT_ECONOMY_SETTINGS.workCooldownMinutes),
    shopEnabled: settings.shopEnabled !== false,
    shopItems: normalizeShopItems(settings.shopItems),
    showNotVireDisclaimer: settings.showNotVireDisclaimer !== false
  };
}

export function normalizeShopItems(shopItems = []) {
  if (!Array.isArray(shopItems)) return [];

  const seen = new Set();
  return shopItems
    .map((item) => {
      const roleId = String(item?.roleId ?? "").trim();
      const id = clampText(item?.id, roleId || "item", 40).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
      return {
        id,
        name: clampText(item?.name, item?.roleName || id, 60),
        description: clampText(item?.description, "Cosmetic role reward", 120),
        price: clampInteger(item?.price, 1, 1000000000, 0),
        roleId,
        roleName: clampText(item?.roleName, item?.name || id, 60),
        active: item?.active !== false
      };
    })
    .filter((item) => item.id && item.roleId && item.price > 0)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .slice(0, 50);
}

export function calculateWorkReward(settings = {}, rng = Math.random) {
  const economySettings = normalizeEconomySettings(settings);
  const min = Math.min(economySettings.workMinAmount, economySettings.workMaxAmount);
  const max = Math.max(economySettings.workMinAmount, economySettings.workMaxAmount);
  return min + Math.floor(rng() * (max - min + 1));
}

export function formatCurrency(amount, settings = {}) {
  const economySettings = normalizeEconomySettings(settings);
  return `${Number(amount ?? 0).toLocaleString()} ${economySettings.currencySymbol}`;
}

export function formatEconomyDisclaimer(settings = {}) {
  const economySettings = normalizeEconomySettings(settings);
  if (!economySettings.showNotVireDisclaimer) return "";
  return `${economySettings.currencyName} are server-only social points for community features and minigames. They are not VIRE, not on-chain and have no financial value.`;
}

export function formatEconomyLeaderboardLines(wallets, settings = {}) {
  return wallets.map((wallet, index) => {
    const medal = index === 0 ? "01" : String(index + 1).padStart(2, "0");
    const name = wallet.userTag ?? wallet.userId;
    return `**#${medal}** ${name} | ${formatCurrency(wallet.balance, settings)}`;
  });
}

export function formatShopLines(items, settings = {}) {
  return items.map((item) => `**${item.id}** | ${item.name} | ${formatCurrency(item.price, settings)} | role: ${item.roleName || item.roleId}`);
}

async function recordEconomyTransaction(store, {
  guildId,
  userId,
  userTag = null,
  amount,
  balanceAfter,
  type,
  actorId = null,
  reason,
  now = new Date()
}) {
  return store.add(ECONOMY_TRANSACTIONS_COLLECTION, {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    guildId,
    userId,
    userTag,
    amount,
    balanceAfter,
    type,
    actorId,
    reason,
    currency: "server-social-shards",
    notVire: true,
    createdAt: now.toISOString()
  });
}

async function replyIfEconomyDisabled(interaction, settings) {
  if (settings.enabled !== false) return false;
  await interaction.reply({
    ephemeral: true,
    content: `${settings.currencyName} are disabled for this server.`
  });
  return true;
}

function normalizeEconomyWallet(wallet) {
  return {
    ...wallet,
    id: wallet.id ?? economyWalletId(wallet.guildId, wallet.userId),
    balance: Math.max(0, Math.floor(Number(wallet.balance) || 0)),
    totalEarned: Math.max(0, Math.floor(Number(wallet.totalEarned) || 0)),
    totalSpent: Math.max(0, Math.floor(Number(wallet.totalSpent) || 0)),
    lastDailyAt: wallet.lastDailyAt ?? null,
    lastWorkAt: wallet.lastWorkAt ?? null
  };
}

function assertCooldownReady(lastAt, cooldownMs, now, label) {
  const remainingMs = getRemainingCooldownMs(lastAt, cooldownMs, now);
  if (remainingMs > 0) {
    throw new Error(`${label} is on cooldown. Try again in ${formatDuration(remainingMs)}.`);
  }
}

export function getRemainingCooldownMs(lastAt, cooldownMs, now = new Date()) {
  if (!lastAt) return 0;
  const lastTime = new Date(lastAt).getTime();
  if (!Number.isFinite(lastTime)) return 0;
  const elapsedMs = now.getTime() - lastTime;
  return Math.max(0, cooldownMs - elapsedMs);
}

export function formatDuration(ms) {
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

async function findGuildRole(guild, roleId) {
  const cached = guild?.roles?.cache?.get?.(roleId);
  if (cached) return cached;

  if (typeof guild?.roles?.fetch !== "function") return null;
  return guild.roles.fetch(roleId).catch(() => null);
}

function compareEconomyWallets(a, b) {
  return Number(b.balance ?? 0) - Number(a.balance ?? 0)
    || Number(b.totalEarned ?? 0) - Number(a.totalEarned ?? 0)
    || String(a.userTag ?? a.userId).localeCompare(String(b.userTag ?? b.userId));
}

function economyWalletId(guildId, userId) {
  return `${guildId}:${userId}`;
}

function clampText(value, fallback, maxLength) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function normalizeCurrencyName(value) {
  const name = clampText(value, DEFAULT_ECONOMY_SETTINGS.currencyName, 32);
  return name.toLowerCase().includes("vire") ? DEFAULT_ECONOMY_SETTINGS.currencyName : name;
}

function normalizeCurrencySymbol(value) {
  const symbol = clampText(value, DEFAULT_ECONOMY_SETTINGS.currencySymbol, 8).toUpperCase();
  return symbol === "VIRE" ? DEFAULT_ECONOMY_SETTINGS.currencySymbol : symbol;
}

function clampInteger(value, min, max, fallback) {
  const number = Math.floor(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
