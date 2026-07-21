import { describe, expect, it } from "vitest";
import {
  WALLET_CHALLENGES_COLLECTION,
  WalletRegistrationService,
  createMockSignature,
  loadWalletHdMasterSeed,
  renderPaymentLinkHtml
} from "../src/wallet-registration.js";
import { WALLET_LINKS_COLLECTION } from "../src/rewards.js";

const ENV = {
  WALLET_HD_MASTER_SEED_HEX: "a".repeat(64),
  PAYMENT_LINK_SECRET: "test-payment-link-secret-32-chars",
  PUBLIC_BASE_URL: "https://bot.vireon.example",
  WALLET_ALLOW_MOCK_SIGNATURES: "true",
  WALLET_MOCK_SIGNATURE_SECRET: "test-wallet-mock-signature-secret"
};

describe("wallet registration", () => {
  it("creates a custodial wallet from an env master seed without storing private material", async () => {
    const store = createMemoryStore();
    const ledgerStore = createMemoryLedgerStore();
    const service = new WalletRegistrationService({
      store,
      ledgerStore,
      env: ENV,
      now: fixedNow()
    });

    const result = await service.getOrCreateCustodialWallet({
      guildId: "guild-1",
      userId: "user-1",
      userTag: "User#0001"
    });

    expect(result).toMatchObject({
      ok: true,
      created: true,
      mode: "custodial",
      wallet: {
        discordUserId: "user-1",
        custodyMode: "custodial"
      }
    });
    expect(result.wallet.address).toMatch(/^vire_/);
    expect(result.wallet.encryptedKeyEnvelope).toBeUndefined();
    expect(result.paymentLink).toContain("https://bot.vireon.example/admin/pay/");
    const rawWallet = ledgerStore.__wallets[0];
    const envelope = JSON.parse(rawWallet.encryptedKeyEnvelope);
    expect(envelope).toMatchObject({
      version: 2,
      custody: "hd-env-master",
      derivationPath: "m/44'/984'/0'/0/0",
      masterSeedStoredInDatabase: false,
      derivedPrivateKeyStoredInDatabase: false
    });
    expect(rawWallet.encryptedKeyEnvelope).not.toContain(ENV.WALLET_HD_MASTER_SEED_HEX);
    expect(rawWallet.encryptedKeyEnvelope).not.toContain("ciphertext");
    expect(rawWallet.encryptedKeyEnvelope).not.toContain("private");

    const links = await store.list(WALLET_LINKS_COLLECTION);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      guildId: "guild-1",
      userId: "user-1",
      address: result.wallet.address,
      custodyMode: "custodial",
      status: "custodial"
    });

    const paymentData = await service.getPaymentLinkData(result.paymentLink.split("/pay/")[1]);
    expect(paymentData).toMatchObject({
      ok: true,
      wallet: { address: result.wallet.address },
      balances: [{ asset: "VIRE", available: "0", locked: "0" }]
    });
    expect(paymentData.transactions[0]).toMatchObject({
      type: "wallet_registered",
      status: "recorded"
    });
  });

  it("creates and verifies an external wallet challenge with mock signatures", async () => {
    const store = createMemoryStore();
    const service = new WalletRegistrationService({
      store,
      ledgerStore: createMemoryLedgerStore(),
      env: ENV,
      now: fixedNow()
    });

    const challenge = await service.createExternalWalletChallenge({
      guildId: "guild-1",
      userId: "user-2",
      address: "vire_external_wallet"
    });
    const signature = createMockSignature({
      address: "vire_external_wallet",
      message: challenge.challenge.message,
      secret: ENV.WALLET_MOCK_SIGNATURE_SECRET
    });

    const result = await service.verifyExternalWalletLink({
      guildId: "guild-1",
      userId: "user-2",
      address: "vire_external_wallet",
      signature
    });

    expect(result).toMatchObject({
      ok: true,
      mode: "external",
      wallet: {
        custodyMode: "external",
        address: "vire_external_wallet",
        externalAddress: "vire_external_wallet"
      }
    });
    expect((await store.list(WALLET_CHALLENGES_COLLECTION))[0]).toMatchObject({
      status: "verified",
      verifier: "mock"
    });
    expect((await store.list(WALLET_LINKS_COLLECTION))[0]).toMatchObject({
      userId: "user-2",
      status: "verified",
      address: "vire_external_wallet"
    });
  });

  it("renders payment link HTML without leaking custody secrets", async () => {
    const store = createMemoryStore();
    const service = new WalletRegistrationService({
      store,
      ledgerStore: createMemoryLedgerStore(),
      env: ENV,
      now: fixedNow()
    });
    const result = await service.getOrCreateCustodialWallet({ guildId: "guild-1", userId: "user-3" });
    const data = await service.getPaymentLinkData(result.paymentLink.split("/pay/")[1]);
    const html = renderPaymentLinkHtml(data);

    expect(html).toContain(result.wallet.address);
    expect(html).toContain("Balance");
    expect(html).not.toContain("encryptedKeyEnvelope");
    expect(html).not.toContain("ciphertext");
    expect(html).not.toContain(ENV.WALLET_HD_MASTER_SEED_HEX);
  });

  it("creates pending withdrawal requests and locks available balance", async () => {
    const store = createMemoryStore();
    const ledgerStore = createMemoryLedgerStore();
    const service = new WalletRegistrationService({
      store,
      ledgerStore,
      env: ENV,
      now: fixedNow()
    });
    const result = await service.getOrCreateCustodialWallet({ guildId: "guild-1", userId: "user-4" });
    const token = result.paymentLink.split("/admin/pay/")[1];
    ledgerStore.__balances[0].available = "10";

    const withdrawal = await service.requestWithdrawal({
      token,
      toAddress: "vire_external_destination",
      amount: "2.5",
      asset: "VIRE"
    });

    expect(withdrawal).toMatchObject({
      ok: true,
      balance: {
        available: "7.5",
        locked: "2.5"
      },
      withdrawal: {
        type: "withdrawal",
        status: "pending_review",
        amount: "2.5",
        asset: "VIRE",
        toAddress: "vire_external_destination"
      }
    });
    expect(withdrawal.payment.transactions.some((transaction) =>
      transaction.type === "withdrawal" && transaction.status === "pending_review"
    )).toBe(true);
  });

  it("loads the first non-empty HD master seed source", async () => {
    const seed = await loadWalletHdMasterSeed({
      WALLET_HD_MASTER_SEED_BASE64: "",
      WALLET_HD_MASTER_SEED_HEX: "b".repeat(64),
      WALLET_HD_MASTER_SEED: "ignored"
    });

    expect(seed).toHaveLength(32);
    expect(seed.toString("hex")).toBe("b".repeat(64));
  });
});

function fixedNow() {
  return () => new Date("2026-01-01T00:00:00.000Z");
}

function createMemoryStore() {
  const collections = new Map();
  return {
    async list(collection) {
      return collections.get(collection) ?? [];
    },
    async add(collection, item) {
      const nextItem = {
        id: item.id ?? `${collection}-${(collections.get(collection)?.length ?? 0) + 1}`,
        createdAt: item.createdAt ?? new Date().toISOString(),
        ...item
      };
      collections.set(collection, [...(collections.get(collection) ?? []), nextItem]);
      return nextItem;
    },
    async update(collection, predicate, updater) {
      let updated = null;
      const nextItems = (collections.get(collection) ?? []).map((item) => {
        if (!predicate(item)) return item;
        updated = {
          ...item,
          ...updater(item),
          updatedAt: new Date().toISOString()
        };
        return updated;
      });
      collections.set(collection, nextItems);
      return updated;
    }
  };
}

function createMemoryLedgerStore() {
  const wallets = [];
  const balances = [];
  const transactions = [];
  return {
    __wallets: wallets,
    __balances: balances,
    async countWallets() {
      return wallets.length;
    },
    async listWallets() {
      return wallets;
    },
    async findWalletByDiscordUserId(discordUserId) {
      return wallets.find((wallet) => wallet.discordUserId === discordUserId) ?? null;
    },
    async createWallet(wallet) {
      const next = {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...wallet
      };
      wallets.push(next);
      return next;
    },
    async updateWallet(walletId, updates) {
      const index = wallets.findIndex((wallet) => wallet.id === walletId);
      wallets[index] = { ...wallets[index], ...updates, updatedAt: new Date().toISOString() };
      return wallets[index];
    },
    async ensureBalance(walletId, asset) {
      let balance = balances.find((item) => item.walletId === walletId && item.asset === asset);
      if (!balance) {
        balance = { id: `balance-${walletId}-${asset}`, walletId, asset, available: "0", locked: "0" };
        balances.push(balance);
      }
      return balance;
    },
    async listBalances(walletId) {
      return balances.filter((balance) => balance.walletId === walletId);
    },
    async updateBalance(walletId, asset, updates) {
      const index = balances.findIndex((balance) => balance.walletId === walletId && balance.asset === asset);
      balances[index] = { ...balances[index], ...updates, updatedAt: new Date().toISOString() };
      return balances[index];
    },
    async addTransaction(transaction) {
      const next = { createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...transaction };
      transactions.push(next);
      return next;
    },
    async listTransactions(walletId, limit) {
      return transactions
        .filter((transaction) => transaction.walletId === walletId)
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
        .slice(0, limit);
    }
  };
}
