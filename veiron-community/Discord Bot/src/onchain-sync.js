import { PENDING_PAYMENTS_COLLECTION } from "./payments.js";
import {
  formatAssetUnits,
  parseAssetAmountToUnits
} from "./wallet-registration.js";
import { childLogger, serializeError } from "./logger.js";

export const ONCHAIN_SYNC_STATE_COLLECTION = "onchain-sync-state";

const DEFAULT_TRACKED_STATUSES = [
  "broadcasted",
  "broadcast_mock",
  "onchain_seen",
  "onchain_confirming",
  "onchain_confirmed"
];
const REORG_STATUSES = new Set(["reorged"]);
const CONFLICT_STATUSES = new Set(["double_spend", "failed"]);

export function startOnChainSyncWorker({
  store,
  ledgerStore,
  chainClient,
  env = process.env,
  logger = childLogger({ module: "onchain-sync" }),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  now = () => new Date()
}) {
  if (env.ONCHAIN_SYNC_ENABLED !== "true") {
    logger.info("On-chain sync worker is disabled.");
    return null;
  }

  const worker = new OnChainSyncWorker({
    store,
    ledgerStore,
    chainClient,
    env,
    logger,
    now
  });
  const intervalMs = parsePositiveInteger(env.ONCHAIN_SYNC_INTERVAL_MS, 30000);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await worker.runOnce();
    } catch (error) {
      logger.error({ error: serializeError(error) }, "On-chain sync tick failed.");
    } finally {
      running = false;
    }
  };

  tick();
  const timer = setIntervalImpl(tick, intervalMs);
  logger.info({ intervalMs }, "On-chain sync worker started.");

  return {
    worker,
    stop() {
      clearIntervalImpl(timer);
    }
  };
}

export class OnChainSyncWorker {
  constructor({ store, ledgerStore, chainClient, env = process.env, logger = childLogger({ module: "onchain-sync" }), now = () => new Date() }) {
    this.store = store;
    this.ledgerStore = ledgerStore;
    this.chainClient = chainClient;
    this.env = env;
    this.logger = logger;
    this.now = now;
    this.minConfirmations = parsePositiveInteger(env.ONCHAIN_SYNC_MIN_CONFIRMATIONS, 6);
    this.finalityConfirmations = Math.max(
      this.minConfirmations,
      parsePositiveInteger(env.ONCHAIN_SYNC_FINALITY_CONFIRMATIONS, 24)
    );
    this.limit = parsePositiveInteger(env.ONCHAIN_SYNC_BATCH_SIZE, 100);
    this.trackedStatuses = parseStatusList(env.ONCHAIN_SYNC_TRACK_STATUSES, DEFAULT_TRACKED_STATUSES);
  }

  async runOnce() {
    if (!this.ledgerStore.listTransactionsByStatuses) {
      throw new Error("Ledger store does not support listTransactionsByStatuses.");
    }

    const transactions = await this.ledgerStore.listTransactionsByStatuses(this.trackedStatuses, this.limit);
    const groups = groupTransactionsByHash(transactions);
    const results = [];

    for (const group of groups) {
      const result = await this.syncTransactionGroup(group);
      results.push(result);
    }

    await this.recordWorkerState({
      checked: groups.length,
      updated: results.filter((result) => result.updated).length,
      errors: results.filter((result) => result.error).length
    });

    return {
      ok: true,
      checked: groups.length,
      results
    };
  }

  async syncTransactionGroup(group) {
    const paymentIds = uniquePaymentIds(group.transactions);
    if (paymentIds.length > 1) {
      await this.markGroupConflict({
        group,
        status: "double_spend",
        reason: `Same txHash is linked to multiple payment ids: ${paymentIds.join(", ")}.`
      });
      return { txHash: group.txHash, updated: true, status: "double_spend" };
    }

    const txStatus = await this.chainClient.getTransactionStatus(group.txHash);
    if (!txStatus.ok) {
      this.logger.warn({ txHash: group.txHash, status: txStatus.status }, "Transaction status lookup failed.");
      return { txHash: group.txHash, updated: false, error: txStatus.status };
    }

    if (CONFLICT_STATUSES.has(txStatus.status)) {
      await this.markGroupConflict({
        group,
        status: txStatus.status === "failed" ? "onchain_failed" : "double_spend",
        reason: txStatus.message ?? txStatus.error ?? txStatus.rawStatus ?? txStatus.status,
        txStatus
      });
      return { txHash: group.txHash, updated: true, status: txStatus.status };
    }

    if (this.isReorg(group, txStatus)) {
      await this.markGroupReorged({ group, txStatus });
      return { txHash: group.txHash, updated: true, status: "onchain_reorged" };
    }

    const nextStatus = this.getNextStatus(txStatus);
    await this.updateGroupStatus({
      group,
      status: nextStatus,
      txStatus,
      extraMetadata: {
        onchainLastSeenAt: this.now().toISOString()
      }
    });

    return { txHash: group.txHash, updated: true, status: nextStatus };
  }

  getNextStatus(txStatus) {
    if (txStatus.status === "not_found") {
      return "onchain_seen";
    }
    if (txStatus.status === "confirmed" && txStatus.confirmations >= this.finalityConfirmations) {
      return "onchain_finalized";
    }
    if (["confirmed", "confirming"].includes(txStatus.status) && txStatus.confirmations >= this.minConfirmations) {
      return "onchain_confirmed";
    }
    return "onchain_confirming";
  }

  isReorg(group, txStatus) {
    if (REORG_STATUSES.has(txStatus.status)) return true;
    if (txStatus.status === "not_found") {
      return group.transactions.some((transaction) => Boolean(readMetadata(transaction).onchainBlockHash));
    }
    if (txStatus.canonical === false) return true;
    if (!txStatus.blockHash) return false;
    return group.transactions.some((transaction) => {
      const metadata = readMetadata(transaction);
      return metadata.onchainBlockHash
        && metadata.onchainBlockHeight === txStatus.blockHeight
        && metadata.onchainBlockHash !== txStatus.blockHash;
    });
  }

  async markGroupReorged({ group, txStatus }) {
    const reversed = await this.reversePaymentEffectOnce({
      transactions: group.transactions,
      reason: "reorg",
      txStatus
    });
    await this.updateGroupStatus({
      group,
      status: "onchain_reorged",
      txStatus,
      extraMetadata: {
        reorgDetectedAt: this.now().toISOString(),
        ...(reversed ? { balanceReversed: true, balanceReverseReason: "reorg" } : {})
      }
    });
  }

  async markGroupConflict({ group, status, reason, txStatus = {} }) {
    const reversed = await this.reversePaymentEffectOnce({
      transactions: group.transactions,
      reason: status,
      txStatus
    });
    await this.updateGroupStatus({
      group,
      status,
      txStatus,
      extraMetadata: {
        conflictDetectedAt: this.now().toISOString(),
        conflictReason: reason,
        conflictTxHash: txStatus.conflictTxHash ?? null,
        ...(reversed ? { balanceReversed: true, balanceReverseReason: status } : {})
      }
    });
  }

  async updateGroupStatus({ group, status, txStatus = {}, extraMetadata = {} }) {
    await Promise.all(group.transactions.map((transaction) => {
      const metadata = {
        ...readMetadata(transaction),
        onchainStatus: txStatus.status ?? status,
        onchainRawStatus: txStatus.rawStatus ?? null,
        onchainConfirmations: txStatus.confirmations ?? 0,
        onchainBlockHeight: txStatus.blockHeight ?? null,
        onchainBlockHash: txStatus.blockHash ?? null,
        onchainCanonical: txStatus.canonical ?? null,
        onchainSource: txStatus.source ?? null,
        onchainUpdatedAt: txStatus.updatedAt ?? this.now().toISOString(),
        ...extraMetadata
      };

      return this.ledgerStore.updateTransaction(transaction.id, {
        status,
        metadata: JSON.stringify(metadata)
      });
    }));

    const paymentId = uniquePaymentIds(group.transactions)[0];
    if (paymentId) {
      await this.store.update(PENDING_PAYMENTS_COLLECTION, (payment) => payment.id === paymentId, () => ({
        status,
        onchainConfirmations: txStatus.confirmations ?? 0,
        onchainBlockHeight: txStatus.blockHeight ?? null,
        onchainBlockHash: txStatus.blockHash ?? null,
        onchainStatus: txStatus.status ?? status,
        onchainUpdatedAt: txStatus.updatedAt ?? this.now().toISOString()
      })).catch(() => null);
    }
  }

  async reversePaymentEffectOnce({ transactions, reason, txStatus = {} }) {
    const sent = transactions.find((transaction) => transaction.type === "payment_sent");
    if (!sent) return false;
    const sentMetadata = readMetadata(sent);
    if (sentMetadata.balanceReversed) return false;

    const received = transactions.find((transaction) => transaction.type === "payment_received");
    const fee = transactions.find((transaction) => transaction.type === "payment_fee");
    const amountUnits = parseAssetAmountToUnits(sent.amount);

    if (amountUnits > 0n) {
      await this.addAvailable(sent.walletId, sent.asset, amountUnits);
    }
    if (received && amountUnits > 0n) {
      await this.addAvailable(received.walletId, received.asset, -amountUnits);
    }
    if (fee) {
      const feeUnits = parseAssetAmountToUnits(fee.amount);
      if (feeUnits > 0n) {
        await this.addAvailable(fee.walletId, fee.asset, feeUnits);
      }
    }

    await Promise.all(transactions.map((transaction) => {
      const metadata = {
        ...readMetadata(transaction),
        balanceReversed: true,
        balanceReversedAt: this.now().toISOString(),
        balanceReverseReason: reason,
        reverseSourceStatus: txStatus.status ?? null
      };
      return this.ledgerStore.updateTransaction(transaction.id, {
        metadata: JSON.stringify(metadata)
      });
    }));
    return true;
  }

  async addAvailable(walletId, asset, deltaUnits) {
    const balance = (await this.ledgerStore.listBalances(walletId)).find((item) => item.asset === asset)
      ?? await this.ledgerStore.ensureBalance(walletId, asset);
    const currentUnits = parseAssetAmountToUnits(balance.available);
    await this.ledgerStore.updateBalance(walletId, asset, {
      available: formatAssetUnits(currentUnits + deltaUnits)
    });
  }

  async recordWorkerState(summary) {
    const state = {
      id: "onchain-sync",
      checkedAt: this.now().toISOString(),
      ...summary
    };
    const updated = await this.store.update(ONCHAIN_SYNC_STATE_COLLECTION, (item) => item.id === state.id, () => state);
    return updated ?? this.store.add(ONCHAIN_SYNC_STATE_COLLECTION, state);
  }
}

function groupTransactionsByHash(transactions) {
  const groups = new Map();
  for (const transaction of transactions) {
    if (!transaction.txHash) continue;
    const key = transaction.txHash;
    if (!groups.has(key)) groups.set(key, { txHash: key, transactions: [] });
    groups.get(key).transactions.push(transaction);
  }
  return [...groups.values()];
}

function uniquePaymentIds(transactions) {
  return [...new Set(transactions
    .map((transaction) => readMetadata(transaction).paymentId)
    .filter(Boolean))];
}

function readMetadata(transaction) {
  try {
    return transaction.metadata ? JSON.parse(transaction.metadata) : {};
  } catch {
    return {};
  }
}

function parseStatusList(value, fallback) {
  const statuses = String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return statuses.length ? statuses : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
