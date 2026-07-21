import { describe, expect, it } from "vitest";
import { OnChainSyncWorker, ONCHAIN_SYNC_STATE_COLLECTION } from "../src/onchain-sync.js";
import { PENDING_PAYMENTS_COLLECTION } from "../src/payments.js";

describe("on-chain sync worker", () => {
  it("marks broadcasted payment transactions as confirmed after enough confirmations", async () => {
    const store = createMemoryStore();
    const ledgerStore = createMemoryLedgerStore({
      transactions: [
        paymentTx({ id: "sent", type: "payment_sent", walletId: "sender-wallet" }),
        paymentTx({ id: "received", type: "payment_received", walletId: "recipient-wallet" }),
        paymentTx({ id: "fee", type: "payment_fee", walletId: "sender-wallet", amount: "0.001" })
      ]
    });
    await store.add(PENDING_PAYMENTS_COLLECTION, { id: "payment-1", status: "broadcasted" });
    const worker = new OnChainSyncWorker({
      store,
      ledgerStore,
      env: {
        ONCHAIN_SYNC_MIN_CONFIRMATIONS: "6",
        ONCHAIN_SYNC_FINALITY_CONFIRMATIONS: "12"
      },
      chainClient: {
        async getTransactionStatus(txHash) {
          return {
            ok: true,
            status: "confirmed",
            txHash,
            confirmations: 8,
            blockHeight: 100,
            blockHash: "0xblock-100",
            canonical: true,
            source: "mock"
          };
        }
      },
      now: fixedNow(),
      logger: silentLogger()
    });

    const result = await worker.runOnce();

    expect(result).toMatchObject({ ok: true, checked: 1 });
    expect(ledgerStore.__transactions.every((transaction) => transaction.status === "onchain_confirmed")).toBe(true);
    expect(JSON.parse(ledgerStore.__transactions[0].metadata)).toMatchObject({
      onchainConfirmations: 8,
      onchainBlockHash: "0xblock-100"
    });
    expect((await store.list(PENDING_PAYMENTS_COLLECTION))[0]).toMatchObject({
      status: "onchain_confirmed",
      onchainConfirmations: 8
    });
    expect((await store.list(ONCHAIN_SYNC_STATE_COLLECTION))[0]).toMatchObject({
      id: "onchain-sync",
      checked: 1,
      updated: 1
    });
  });

  it("reverses local balances once when a previously seen payment is reorged out", async () => {
    const store = createMemoryStore();
    const ledgerStore = createMemoryLedgerStore({
      balances: [
        { id: "sender-balance", walletId: "sender-wallet", asset: "VIRE", available: "7.499", locked: "0" },
        { id: "recipient-balance", walletId: "recipient-wallet", asset: "VIRE", available: "3.5", locked: "0" }
      ],
      transactions: [
        paymentTx({
          id: "sent",
          type: "payment_sent",
          walletId: "sender-wallet",
          status: "onchain_confirmed",
          metadata: { paymentId: "payment-1", onchainBlockHash: "0xold", onchainBlockHeight: 99 }
        }),
        paymentTx({
          id: "received",
          type: "payment_received",
          walletId: "recipient-wallet",
          status: "onchain_confirmed",
          metadata: { paymentId: "payment-1", onchainBlockHash: "0xold", onchainBlockHeight: 99 }
        }),
        paymentTx({
          id: "fee",
          type: "payment_fee",
          walletId: "sender-wallet",
          amount: "0.001",
          status: "onchain_confirmed",
          metadata: { paymentId: "payment-1", onchainBlockHash: "0xold", onchainBlockHeight: 99 }
        })
      ]
    });
    const worker = new OnChainSyncWorker({
      store,
      ledgerStore,
      env: { ONCHAIN_SYNC_MIN_CONFIRMATIONS: "6" },
      chainClient: {
        async getTransactionStatus(txHash) {
          return {
            ok: true,
            status: "reorged",
            txHash,
            confirmations: 0,
            canonical: false,
            source: "mock"
          };
        }
      },
      now: fixedNow(),
      logger: silentLogger()
    });

    await worker.runOnce();
    await worker.runOnce();

    expect(ledgerStore.__balances.find((balance) => balance.id === "sender-balance")).toMatchObject({
      available: "10"
    });
    expect(ledgerStore.__balances.find((balance) => balance.id === "recipient-balance")).toMatchObject({
      available: "1"
    });
    expect(ledgerStore.__transactions.every((transaction) => transaction.status === "onchain_reorged")).toBe(true);
    expect(JSON.parse(ledgerStore.__transactions[0].metadata)).toMatchObject({
      balanceReversed: true,
      balanceReverseReason: "reorg"
    });
  });

  it("marks duplicate payment ids on the same tx hash as double spend and reverses them", async () => {
    const store = createMemoryStore();
    const ledgerStore = createMemoryLedgerStore({
      balances: [
        { id: "sender-balance", walletId: "sender-wallet", asset: "VIRE", available: "8", locked: "0" },
        { id: "recipient-balance", walletId: "recipient-wallet", asset: "VIRE", available: "2", locked: "0" }
      ],
      transactions: [
        paymentTx({ id: "sent-1", type: "payment_sent", walletId: "sender-wallet", metadata: { paymentId: "payment-1" } }),
        paymentTx({ id: "sent-2", type: "payment_sent", walletId: "sender-wallet", metadata: { paymentId: "payment-2" } }),
        paymentTx({ id: "received-1", type: "payment_received", walletId: "recipient-wallet", metadata: { paymentId: "payment-1" } })
      ]
    });
    const worker = new OnChainSyncWorker({
      store,
      ledgerStore,
      chainClient: {
        async getTransactionStatus() {
          throw new Error("duplicate should be caught before RPC lookup");
        }
      },
      logger: silentLogger()
    });

    await worker.runOnce();

    expect(ledgerStore.__transactions.every((transaction) => transaction.status === "double_spend")).toBe(true);
    expect(JSON.parse(ledgerStore.__transactions[0].metadata)).toMatchObject({
      conflictReason: expect.stringContaining("multiple payment ids")
    });
  });
});

function paymentTx({
  id,
  type,
  walletId,
  status = "broadcasted",
  amount = "2.5",
  metadata = { paymentId: "payment-1" }
}) {
  return {
    id,
    walletId,
    type,
    status,
    amount,
    asset: "VIRE",
    fromAddress: "vire_sender",
    toAddress: "vire_recipient",
    txHash: "0xtx",
    metadata: JSON.stringify(metadata),
    createdAt: "2026-01-01T00:00:00.000Z"
  };
}

function fixedNow() {
  return () => new Date("2026-01-01T00:00:00.000Z");
}

function silentLogger() {
  return {
    info() {},
    warn() {},
    error() {}
  };
}

function createMemoryStore() {
  const collections = new Map();
  return {
    async list(collection) {
      return collections.get(collection) ?? [];
    },
    async add(collection, item) {
      const next = { createdAt: new Date().toISOString(), ...item };
      collections.set(collection, [...(collections.get(collection) ?? []), next]);
      return next;
    },
    async update(collection, predicate, updater) {
      let updated = null;
      const next = (collections.get(collection) ?? []).map((item) => {
        if (!predicate(item)) return item;
        updated = { ...item, ...updater(item), updatedAt: new Date().toISOString() };
        return updated;
      });
      collections.set(collection, next);
      return updated;
    }
  };
}

function createMemoryLedgerStore({ balances = [], transactions = [] } = {}) {
  return {
    __balances: balances,
    __transactions: transactions,
    async listTransactionsByStatuses(statuses, limit) {
      const wanted = new Set(statuses);
      return transactions.filter((transaction) => wanted.has(transaction.status)).slice(0, limit);
    },
    async updateTransaction(transactionId, updates) {
      const index = transactions.findIndex((transaction) => transaction.id === transactionId);
      transactions[index] = { ...transactions[index], ...updates, updatedAt: new Date().toISOString() };
      return transactions[index];
    },
    async listBalances(walletId) {
      return balances.filter((balance) => balance.walletId === walletId);
    },
    async ensureBalance(walletId, asset) {
      let balance = balances.find((item) => item.walletId === walletId && item.asset === asset);
      if (!balance) {
        balance = { id: `balance-${walletId}-${asset}`, walletId, asset, available: "0", locked: "0" };
        balances.push(balance);
      }
      return balance;
    },
    async updateBalance(walletId, asset, updates) {
      const index = balances.findIndex((balance) => balance.walletId === walletId && balance.asset === asset);
      balances[index] = { ...balances[index], ...updates, updatedAt: new Date().toISOString() };
      return balances[index];
    }
  };
}
