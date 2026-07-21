import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/storage.js";
import {
  adjustSocialCurrency,
  buyShopItem,
  calculateWorkReward,
  claimDailyReward,
  claimWorkReward,
  formatEconomyDisclaimer,
  formatEconomyLeaderboardLines,
  formatDuration,
  getGuildEconomyWallets,
  getOrCreateEconomyWallet,
  normalizeShopItems,
  normalizeEconomySettings,
  transferSocialCurrency
} from "../src/economy.js";

describe("server social economy", () => {
  it("normalizes economy settings and keeps Shards separate from VIRE", () => {
    const settings = normalizeEconomySettings({
      currencyName: "",
      currencySymbol: "vire",
      minTransferAmount: -5,
      maxTransferAmount: 0,
      starterBalance: -10,
      shopItems: [
        { id: "Gold Name!", name: "Gold Name", price: 500, roleId: "role-gold", roleName: "Gold" },
        { id: "broken", price: 0, roleId: "" }
      ]
    });

    expect(settings).toMatchObject({
      currencyName: "Shards",
      currencySymbol: "SHD",
      minTransferAmount: 1,
      maxTransferAmount: 1,
      starterBalance: 0,
      dailyAmount: 100,
      workMinAmount: 15,
      workMaxAmount: 75
    });
    expect(settings.shopItems).toEqual([
      {
        id: "gold-name-",
        name: "Gold Name",
        description: "Cosmetic role reward",
        price: 500,
        roleId: "role-gold",
        roleName: "Gold",
        active: true
      }
    ]);
    expect(formatEconomyDisclaimer(settings)).toContain("not VIRE");
    expect(formatEconomyDisclaimer(settings)).toContain("no financial value");
  });

  it("creates wallets with starter balance and records adjustments", async () => {
    const store = await createEconomyStore({ starterBalance: 25 });
    const wallet = await getOrCreateEconomyWallet(store, {
      guildId: "guild-1",
      userId: "user-1",
      userTag: "Alpha#0001"
    });
    const result = await adjustSocialCurrency(store, {
      guildId: "guild-1",
      userId: "user-1",
      userTag: "Alpha#0001",
      amount: 75,
      type: "grant",
      actorId: "admin-1",
      reason: "Test grant"
    });
    const transactions = await store.list("economy-transactions");

    expect(wallet.balance).toBe(25);
    expect(result.wallet).toMatchObject({
      balance: 100,
      totalEarned: 100,
      totalSpent: 0
    });
    expect(transactions).toHaveLength(1);
    expect(transactions[0]).toMatchObject({
      amount: 75,
      balanceAfter: 100,
      currency: "server-social-shards",
      notVire: true
    });
  });

  it("transfers Shards between users", async () => {
    const store = await createEconomyStore();
    await adjustSocialCurrency(store, {
      guildId: "guild-1",
      userId: "sender",
      userTag: "Sender#0001",
      amount: 200,
      type: "grant"
    });

    const transfer = await transferSocialCurrency(store, {
      guildId: "guild-1",
      fromUser: createUser("sender", "Sender#0001"),
      toUser: createUser("receiver", "Receiver#0001"),
      amount: 60,
      settings: normalizeEconomySettings()
    });
    const wallets = await getGuildEconomyWallets(store, "guild-1");

    expect(transfer.fromWallet.balance).toBe(140);
    expect(transfer.toWallet.balance).toBe(60);
    expect(wallets.map((wallet) => wallet.userId)).toEqual(["sender", "receiver"]);
    expect(formatEconomyLeaderboardLines(wallets, normalizeEconomySettings())).toEqual([
      "**#01** Sender#0001 | 140 SHD",
      "**#02** Receiver#0001 | 60 SHD"
    ]);
  });

  it("rejects transfers without enough balance", async () => {
    const store = await createEconomyStore();

    await expect(transferSocialCurrency(store, {
      guildId: "guild-1",
      fromUser: createUser("sender", "Sender#0001"),
      toUser: createUser("receiver", "Receiver#0001"),
      amount: 60,
      settings: normalizeEconomySettings()
    })).rejects.toThrow("Insufficient Shards balance.");
  });

  it("claims daily rewards once per cooldown window", async () => {
    const store = await createEconomyStore({ dailyAmount: 125, dailyCooldownHours: 24 });
    const user = createUser("daily-user", "Daily#0001");
    const first = await claimDailyReward(store, {
      guildId: "guild-1",
      user,
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    await expect(claimDailyReward(store, {
      guildId: "guild-1",
      user,
      now: new Date("2026-01-01T12:00:00.000Z")
    })).rejects.toThrow("Daily reward is on cooldown.");

    const second = await claimDailyReward(store, {
      guildId: "guild-1",
      user,
      now: new Date("2026-01-02T00:00:01.000Z")
    });

    expect(first.wallet.balance).toBe(125);
    expect(second.wallet.balance).toBe(250);
  });

  it("claims work rewards with configured range and cooldown", async () => {
    const store = await createEconomyStore({
      workMinAmount: 10,
      workMaxAmount: 20,
      workCooldownMinutes: 60
    });
    const user = createUser("worker", "Worker#0001");
    const result = await claimWorkReward(store, {
      guildId: "guild-1",
      user,
      rng: () => 0.5,
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    await expect(claimWorkReward(store, {
      guildId: "guild-1",
      user,
      rng: () => 0.5,
      now: new Date("2026-01-01T00:30:00.000Z")
    })).rejects.toThrow("Work command is on cooldown.");

    expect(result.amount).toBe(15);
    expect(result.wallet.balance).toBe(15);
    expect(calculateWorkReward({ workMinAmount: 10, workMaxAmount: 20 }, () => 0)).toBe(10);
    expect(formatDuration(90 * 60000)).toBe("1h 30m");
  });

  it("spends Shards on normalized shop items", async () => {
    const store = await createEconomyStore();
    const user = createUser("buyer", "Buyer#0001");
    const [item] = normalizeShopItems([
      { id: "gold", name: "Gold Role", price: 150, roleId: "role-gold", roleName: "Gold" }
    ]);
    await adjustSocialCurrency(store, {
      guildId: "guild-1",
      userId: user.id,
      userTag: user.tag,
      amount: 200,
      type: "grant"
    });

    const result = await buyShopItem(store, {
      guildId: "guild-1",
      user,
      item
    });

    expect(result.wallet.balance).toBe(50);
    expect(result.transaction).toMatchObject({
      amount: -150,
      type: "shop_purchase",
      reason: "Shop purchase: gold"
    });
  });
});

async function createEconomyStore(economy = {}) {
  const store = new JsonStore({ dataDir: await mkdtemp(path.join(os.tmpdir(), "vireon-economy-test-")) });
  await store.setSingleton("settings", {
    economy: {
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
      showNotVireDisclaimer: true,
      ...economy
    }
  });
  return store;
}

function createUser(id, tag) {
  return {
    id,
    tag,
    username: tag.split("#")[0],
    bot: false
  };
}
