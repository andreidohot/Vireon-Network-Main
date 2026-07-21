import { describe, expect, it } from "vitest";
import { PaymentService } from "../src/payments.js";

describe("Vireon payments", () => {
  it("confirms a custodial payment, broadcasts it and syncs local balances", async () => {
    const store = createMemoryStore();
    const ledgerStore = createMemoryLedgerStore();
    const service = new PaymentService({
      store,
      ledgerStore,
      chainClient: {
        async estimatePaymentFee() {
          return {
            ok: true,
            feeAmount: "0.001",
            feeAsset: "VIRE",
            source: "mock"
          };
        },
        async broadcastPayment(payment) {
          return {
            ok: true,
            status: "broadcasted",
            txHash: `0x${payment.referenceId}`,
            mode: "rpc"
          };
        }
      },
      now: fixedNow()
    });

    ledgerStore.__wallets.push(
      {
        id: "wallet-sender",
        discordUserId: "sender",
        custodyMode: "custodial",
        address: "vire_sender"
      },
      {
        id: "wallet-recipient",
        discordUserId: "recipient",
        custodyMode: "external",
        address: "vire_recipient"
      }
    );
    ledgerStore.__balances.push(
      { id: "balance-sender", walletId: "wallet-sender", asset: "VIRE", available: "10", locked: "0" },
      { id: "balance-recipient", walletId: "wallet-recipient", asset: "VIRE", available: "1", locked: "0" }
    );

    const prepared = await service.preparePayment({
      guildId: "guild",
      senderUser: { id: "sender", username: "Sender" },
      recipientUser: { id: "recipient", username: "Recipient" },
      amount: "2.5"
    });
    const result = await service.confirmPayment(prepared.payment.id, "sender");

    expect(result).toMatchObject({
      ok: true,
      payment: {
        status: "broadcasted",
        amount: "2.5",
        feeAmount: "0.001",
        txHash: expect.stringContaining("0xpayment_")
      }
    });
    expect(ledgerStore.__balances.find((item) => item.id === "balance-sender")).toMatchObject({
      available: "7.499"
    });
    expect(ledgerStore.__balances.find((item) => item.id === "balance-recipient")).toMatchObject({
      available: "3.5"
    });
    expect(ledgerStore.__transactions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "payment_sent", status: "broadcasted", txHash: result.payment.txHash }),
      expect.objectContaining({ type: "payment_received", status: "broadcasted", txHash: result.payment.txHash }),
      expect.objectContaining({ type: "payment_fee", status: "broadcasted", amount: "0.001" })
    ]));
  });

  it("rejects payments from external sender wallets because the bot cannot sign them", async () => {
    const service = new PaymentService({
      store: createMemoryStore(),
      ledgerStore: createMemoryLedgerStore({
        wallets: [
          { id: "wallet-sender", discordUserId: "sender", custodyMode: "external", address: "vire_sender" },
          { id: "wallet-recipient", discordUserId: "recipient", custodyMode: "custodial", address: "vire_recipient" }
        ]
      }),
      chainClient: {
        async estimatePaymentFee() {
          throw new Error("should not estimate fee");
        }
      }
    });

    await expect(service.preparePayment({
      guildId: "guild",
      senderUser: { id: "sender", username: "Sender" },
      recipientUser: { id: "recipient", username: "Recipient" },
      amount: "1"
    })).rejects.toThrow("external");
  });

  it("does not create a pending payment when available balance cannot cover amount plus fee", async () => {
    const store = createMemoryStore();
    const ledgerStore = createMemoryLedgerStore({
      wallets: [
        { id: "wallet-sender", discordUserId: "sender", custodyMode: "custodial", address: "vire_sender" },
        { id: "wallet-recipient", discordUserId: "recipient", custodyMode: "custodial", address: "vire_recipient" }
      ],
      balances: [
        { id: "balance-sender", walletId: "wallet-sender", asset: "VIRE", available: "1", locked: "0" }
      ]
    });
    const service = new PaymentService({
      store,
      ledgerStore,
      chainClient: {
        async estimatePaymentFee() {
          return {
            ok: true,
            feeAmount: "0.01",
            feeAsset: "VIRE"
          };
        }
      }
    });

    await expect(service.preparePayment({
      guildId: "guild",
      senderUser: { id: "sender", username: "Sender" },
      recipientUser: { id: "recipient", username: "Recipient" },
      amount: "1"
    })).rejects.toThrow("Insufficient available balance");
    expect(await store.list("pending-payments")).toHaveLength(0);
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
      const next = {
        createdAt: item.createdAt ?? new Date().toISOString(),
        ...item
      };
      collections.set(collection, [...(collections.get(collection) ?? []), next]);
      return next;
    },
    async update(collection, predicate, updater) {
      let updated = null;
      const next = (collections.get(collection) ?? []).map((item) => {
        if (!predicate(item)) return item;
        updated = {
          ...item,
          ...updater(item),
          updatedAt: new Date().toISOString()
        };
        return updated;
      });
      collections.set(collection, next);
      return updated;
    }
  };
}

function createMemoryLedgerStore({ wallets = [], balances = [] } = {}) {
  const transactions = [];
  return {
    __wallets: wallets,
    __balances: balances,
    __transactions: transactions,
    async findWalletByDiscordUserId(discordUserId) {
      return wallets.find((wallet) => wallet.discordUserId === discordUserId) ?? null;
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
    async updateTransaction(transactionId, updates) {
      const index = transactions.findIndex((transaction) => transaction.id === transactionId);
      transactions[index] = { ...transactions[index], ...updates, updatedAt: new Date().toISOString() };
      return transactions[index];
    }
  };
}
