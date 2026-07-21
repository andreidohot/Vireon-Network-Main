import crypto from "node:crypto";

export function createChainClient({ env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  const mode = env.VIREON_CHAIN_MODE ?? "disabled";
  const rpcUrl = env.VIREON_CHAIN_RPC_URL ?? null;
  const statusUrl = env.VIREON_CHAIN_STATUS_URL ?? null;
  const statusPath = env.VIREON_CHAIN_STATUS_PATH ?? "/status";
  const rewardsUrl = env.VIREON_CHAIN_REWARDS_URL ?? null;
  const rewardsPath = env.VIREON_CHAIN_REWARDS_PATH ?? "/rewards/{address}";
  const paymentFeeUrl = env.VIREON_CHAIN_PAYMENT_FEE_URL ?? null;
  const paymentFeePath = env.VIREON_CHAIN_PAYMENT_FEE_PATH ?? "/payments/estimate-fee";
  const paymentBroadcastUrl = env.VIREON_CHAIN_PAYMENT_BROADCAST_URL ?? null;
  const paymentBroadcastPath = env.VIREON_CHAIN_PAYMENT_BROADCAST_PATH ?? "/payments/broadcast";
  const txStatusUrl = env.VIREON_CHAIN_TX_STATUS_URL ?? null;
  const txStatusPath = env.VIREON_CHAIN_TX_STATUS_PATH ?? "/transactions/{txHash}";
  const healthUrl = env.VIREON_CHAIN_HEALTH_URL ?? rpcUrl ?? statusUrl;
  const healthTimeoutMs = parseTimeout(env.VIREON_CHAIN_HEALTH_TIMEOUT_MS, 3000);
  const statusTimeoutMs = parseTimeout(env.VIREON_CHAIN_STATUS_TIMEOUT_MS, healthTimeoutMs);
  const rewardsTimeoutMs = parseTimeout(env.VIREON_CHAIN_REWARDS_TIMEOUT_MS, statusTimeoutMs);
  const paymentTimeoutMs = parseTimeout(env.VIREON_CHAIN_PAYMENT_TIMEOUT_MS, statusTimeoutMs);
  const txStatusTimeoutMs = parseTimeout(env.VIREON_CHAIN_TX_STATUS_TIMEOUT_MS, statusTimeoutMs);
  const mockPaymentFee = normalizeAmountString(env.VIREON_CHAIN_MOCK_PAYMENT_FEE ?? "0.001");
  const cacheEnabled = parseBoolean(env.VIREON_CHAIN_CACHE_ENABLED, true);
  const staleTtlMs = parseTimeout(env.VIREON_CHAIN_STALE_CACHE_TTL_MS, 120000);
  const healthCacheTtlMs = parseTimeout(env.VIREON_CHAIN_HEALTH_CACHE_TTL_MS, 10000);
  const statusCacheTtlMs = parseTimeout(env.VIREON_CHAIN_STATUS_CACHE_TTL_MS, 15000);
  const rewardsCacheTtlMs = parseTimeout(env.VIREON_CHAIN_REWARDS_CACHE_TTL_MS, 30000);
  const rateLimiter = createRpcRateLimiter({
    maxRequests: parsePositiveInteger(env.VIREON_CHAIN_RPC_RATE_LIMIT_PER_MINUTE, 60),
    windowMs: parseTimeout(env.VIREON_CHAIN_RPC_RATE_LIMIT_WINDOW_MS, 60000),
    now
  });
  const cache = createRpcCache({ now });

  return {
    mode,
    rpcUrl,
    cacheEnabled,
    async healthCheck() {
      if (mode === "disabled") {
        return {
          ok: true,
          status: "disabled",
          mode
        };
      }

      if (mode === "mock") {
        return {
          ok: true,
          status: "mock",
          mode
        };
      }

      if (mode !== "rpc") {
        return {
          ok: false,
          status: "unsupported_mode",
          mode
        };
      }

      if (!healthUrl) {
        return {
          ok: false,
          status: "missing_rpc_url",
          mode
        };
      }

      return executeRpcCall({
        key: `health:${healthUrl}`,
        cache,
        cacheEnabled,
        ttlMs: healthCacheTtlMs,
        staleTtlMs,
        rateLimiter,
        rateLimitedResponse: {
          ok: false,
          status: "rate_limited",
          mode,
          source: healthUrl,
          message: "Vireon RPC rate limit reached before health check."
        },
        fetcher: () => checkRpcHealth({ rpcUrl: healthUrl, mode, timeoutMs: healthTimeoutMs, fetchImpl })
      });
    },
    async getNetworkStatus() {
      if (mode === "disabled") {
        return {
          ok: false,
          status: "disabled",
          mode,
          message: "Vireon chain adapter is disabled."
        };
      }

      if (mode === "mock") {
        return buildMockNetworkStatus(mode);
      }

      if (mode !== "rpc") {
        return {
          ok: false,
          status: "unsupported_mode",
          mode,
          message: `Unsupported Vireon chain mode: ${mode}`
        };
      }

      const resolvedStatusUrl = statusUrl || joinUrl(rpcUrl, statusPath);
      if (!resolvedStatusUrl) {
        return {
          ok: false,
          status: "missing_rpc_url",
          mode,
          message: "VIREON_CHAIN_RPC_URL or VIREON_CHAIN_STATUS_URL is required."
        };
      }

      return executeRpcCall({
        key: `status:${resolvedStatusUrl}`,
        cache,
        cacheEnabled,
        ttlMs: statusCacheTtlMs,
        staleTtlMs,
        rateLimiter,
        rateLimitedResponse: {
          ok: false,
          status: "rate_limited",
          mode,
          source: resolvedStatusUrl,
          message: "Vireon RPC rate limit reached before network status could be queried."
        },
        fetcher: () => fetchNetworkStatus({ statusUrl: resolvedStatusUrl, mode, timeoutMs: statusTimeoutMs, fetchImpl })
      });
    },
    async getRewardsForAddress(address) {
      const normalizedAddress = normalizeAddress(address);
      if (!normalizedAddress) {
        return {
          ok: false,
          status: "missing_wallet_address",
          mode,
          message: "A wallet address is required before rewards can be queried."
        };
      }

      if (mode === "disabled") {
        return {
          ok: false,
          status: "disabled",
          mode,
          address: normalizedAddress,
          message: "Vireon chain adapter is disabled."
        };
      }

      if (mode === "mock") {
        return buildMockRewards({ mode, address: normalizedAddress });
      }

      if (mode !== "rpc") {
        return {
          ok: false,
          status: "unsupported_mode",
          mode,
          address: normalizedAddress,
          message: `Unsupported Vireon chain mode: ${mode}`
        };
      }

      const resolvedRewardsUrl = resolveRewardsUrl({
        rpcUrl,
        rewardsUrl,
        rewardsPath,
        address: normalizedAddress
      });
      if (!resolvedRewardsUrl) {
        return {
          ok: false,
          status: "missing_rewards_url",
          mode,
          address: normalizedAddress,
          message: "VIREON_CHAIN_RPC_URL or VIREON_CHAIN_REWARDS_URL is required."
        };
      }

      return executeRpcCall({
        key: `rewards:${resolvedRewardsUrl}`,
        cache,
        cacheEnabled,
        ttlMs: rewardsCacheTtlMs,
        staleTtlMs,
        rateLimiter,
        rateLimitedResponse: {
          ok: false,
          status: "rate_limited",
          mode,
          address: normalizedAddress,
          source: resolvedRewardsUrl,
          message: "Vireon RPC rate limit reached before rewards could be queried."
        },
        fetcher: () => fetchRewards({ rewardsUrl: resolvedRewardsUrl, mode, address: normalizedAddress, timeoutMs: rewardsTimeoutMs, fetchImpl })
      });
    },
    async estimatePaymentFee(payment) {
      const normalized = normalizePaymentRequest(payment);
      if (!normalized.ok) {
        return {
          ok: false,
          status: normalized.status,
          mode,
          message: normalized.message
        };
      }

      if (mode === "disabled") {
        return {
          ok: false,
          status: "disabled",
          mode,
          message: "Vireon chain adapter is disabled."
        };
      }

      if (mode === "mock") {
        return {
          ok: true,
          status: "mock",
          mode,
          mock: true,
          feeAmount: mockPaymentFee,
          feeAsset: normalized.asset,
          source: "mock-adapter",
          updatedAt: new Date().toISOString()
        };
      }

      if (mode !== "rpc") {
        return {
          ok: false,
          status: "unsupported_mode",
          mode,
          message: `Unsupported Vireon chain mode: ${mode}`
        };
      }

      const resolvedFeeUrl = paymentFeeUrl || joinUrl(rpcUrl, paymentFeePath);
      if (!resolvedFeeUrl) {
        return {
          ok: false,
          status: "missing_payment_fee_url",
          mode,
          message: "VIREON_CHAIN_RPC_URL or VIREON_CHAIN_PAYMENT_FEE_URL is required."
        };
      }

      return executeRpcMutation({
        rateLimiter,
        rateLimitedResponse: {
          ok: false,
          status: "rate_limited",
          mode,
          source: resolvedFeeUrl,
          message: "Vireon RPC rate limit reached before payment fee could be estimated."
        },
        mutator: () => postPaymentFee({ feeUrl: resolvedFeeUrl, mode, payment: normalized, timeoutMs: paymentTimeoutMs, fetchImpl })
      });
    },
    async broadcastPayment(payment) {
      const normalized = normalizePaymentRequest(payment);
      if (!normalized.ok) {
        return {
          ok: false,
          status: normalized.status,
          mode,
          message: normalized.message
        };
      }

      if (mode === "disabled") {
        return {
          ok: false,
          status: "disabled",
          mode,
          message: "Vireon chain adapter is disabled."
        };
      }

      if (mode === "mock") {
        const txHash = `mock_${crypto.createHash("sha256")
          .update(`${normalized.referenceId ?? ""}:${normalized.fromAddress}:${normalized.toAddress}:${normalized.amount}:${normalized.asset}`)
          .digest("hex")
          .slice(0, 48)}`;
        return {
          ok: true,
          status: "broadcast_mock",
          mode,
          mock: true,
          txHash,
          source: "mock-adapter",
          updatedAt: new Date().toISOString()
        };
      }

      if (mode !== "rpc") {
        return {
          ok: false,
          status: "unsupported_mode",
          mode,
          message: `Unsupported Vireon chain mode: ${mode}`
        };
      }

      const resolvedBroadcastUrl = paymentBroadcastUrl || joinUrl(rpcUrl, paymentBroadcastPath);
      if (!resolvedBroadcastUrl) {
        return {
          ok: false,
          status: "missing_payment_broadcast_url",
          mode,
          message: "VIREON_CHAIN_RPC_URL or VIREON_CHAIN_PAYMENT_BROADCAST_URL is required."
        };
      }

      return executeRpcMutation({
        rateLimiter,
        rateLimitedResponse: {
          ok: false,
          status: "rate_limited",
          mode,
          source: resolvedBroadcastUrl,
          message: "Vireon RPC rate limit reached before payment broadcast could be submitted."
        },
        mutator: () => postPaymentBroadcast({ broadcastUrl: resolvedBroadcastUrl, mode, payment: normalized, timeoutMs: paymentTimeoutMs, fetchImpl })
      });
    },
    async getTransactionStatus(txHash) {
      const normalizedTxHash = normalizeTxHash(txHash);
      if (!normalizedTxHash) {
        return {
          ok: false,
          status: "missing_tx_hash",
          mode,
          message: "A transaction hash is required."
        };
      }

      if (mode === "disabled") {
        return {
          ok: false,
          status: "disabled",
          mode,
          txHash: normalizedTxHash,
          message: "Vireon chain adapter is disabled."
        };
      }

      if (mode === "mock") {
        return buildMockTransactionStatus({ mode, txHash: normalizedTxHash });
      }

      if (mode !== "rpc") {
        return {
          ok: false,
          status: "unsupported_mode",
          mode,
          txHash: normalizedTxHash,
          message: `Unsupported Vireon chain mode: ${mode}`
        };
      }

      const resolvedTxStatusUrl = resolveTxStatusUrl({
        rpcUrl,
        txStatusUrl,
        txStatusPath,
        txHash: normalizedTxHash
      });
      if (!resolvedTxStatusUrl) {
        return {
          ok: false,
          status: "missing_tx_status_url",
          mode,
          txHash: normalizedTxHash,
          message: "VIREON_CHAIN_RPC_URL or VIREON_CHAIN_TX_STATUS_URL is required."
        };
      }

      return executeRpcCall({
        key: `tx:${resolvedTxStatusUrl}`,
        cache,
        cacheEnabled,
        ttlMs: parseTimeout(env.VIREON_CHAIN_TX_STATUS_CACHE_TTL_MS, 5000),
        staleTtlMs,
        rateLimiter,
        rateLimitedResponse: {
          ok: false,
          status: "rate_limited",
          mode,
          txHash: normalizedTxHash,
          source: resolvedTxStatusUrl,
          message: "Vireon RPC rate limit reached before transaction status could be queried."
        },
        fetcher: () => fetchTransactionStatus({
          txStatusUrl: resolvedTxStatusUrl,
          mode,
          txHash: normalizedTxHash,
          timeoutMs: txStatusTimeoutMs,
          fetchImpl
        })
      });
    }
  };
}

async function executeRpcCall({
  key,
  cache,
  cacheEnabled,
  ttlMs,
  staleTtlMs,
  rateLimiter,
  rateLimitedResponse,
  fetcher
}) {
  if (!cacheEnabled) {
    if (!rateLimiter.allow()) return rateLimitedResponse;
    return fetcher();
  }

  const fresh = cache.getFresh(key, ttlMs);
  if (fresh) {
    return withCacheMetadata(fresh.value, {
      cacheStatus: "hit",
      cacheAgeMs: fresh.ageMs
    });
  }

  const inflight = cache.getInflight(key);
  if (inflight) {
    return withCacheMetadata(await inflight, {
      cacheStatus: "inflight"
    });
  }

  const staleBeforeFetch = cache.getStale(key, ttlMs, staleTtlMs);
  if (!rateLimiter.allow()) {
    if (staleBeforeFetch) {
      return withCacheMetadata(staleBeforeFetch.value, {
        cacheStatus: "stale",
        cacheAgeMs: staleBeforeFetch.ageMs,
        stale: true,
        rateLimited: true
      });
    }
    return rateLimitedResponse;
  }

  const request = (async () => {
    const result = await fetcher();
    if (result?.ok || !staleBeforeFetch) {
      cache.set(key, result);
    }
    if (!result?.ok && staleBeforeFetch) {
      return withCacheMetadata(staleBeforeFetch.value, {
        cacheStatus: "stale",
        cacheAgeMs: staleBeforeFetch.ageMs,
        stale: true,
        fallbackStatus: result?.status ?? "error"
      });
    }
    return result;
  })();

  cache.setInflight(key, request);
  try {
    return await request;
  } finally {
    cache.clearInflight(key);
  }
}

async function executeRpcMutation({ rateLimiter, rateLimitedResponse, mutator }) {
  if (!rateLimiter.allow()) return rateLimitedResponse;
  return mutator();
}

function createRpcCache({ now }) {
  const entries = new Map();
  const inflight = new Map();

  return {
    getFresh(key, ttlMs) {
      const entry = entries.get(key);
      if (!entry) return null;
      const ageMs = now() - entry.storedAt;
      return ageMs >= 0 && ageMs <= ttlMs ? { value: entry.value, ageMs } : null;
    },
    getStale(key, ttlMs, staleTtlMs) {
      const entry = entries.get(key);
      if (!entry) return null;
      const ageMs = now() - entry.storedAt;
      return ageMs > ttlMs && ageMs <= ttlMs + staleTtlMs ? { value: entry.value, ageMs } : null;
    },
    set(key, value) {
      entries.set(key, {
        value,
        storedAt: now()
      });
    },
    getInflight(key) {
      return inflight.get(key) ?? null;
    },
    setInflight(key, value) {
      inflight.set(key, value);
    },
    clearInflight(key) {
      inflight.delete(key);
    }
  };
}

function createRpcRateLimiter({ maxRequests, windowMs, now }) {
  const timestamps = [];

  return {
    allow() {
      if (!maxRequests || maxRequests <= 0) return true;
      const threshold = now() - windowMs;
      while (timestamps.length && timestamps[0] <= threshold) {
        timestamps.shift();
      }
      if (timestamps.length >= maxRequests) return false;
      timestamps.push(now());
      return true;
    }
  };
}

function withCacheMetadata(result, metadata) {
  if (!result || typeof result !== "object") return result;
  return {
    ...result,
    cached: true,
    ...metadata
  };
}

async function checkRpcHealth({ rpcUrl, mode, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(rpcUrl, {
      method: "GET",
      signal: controller.signal
    });

    return {
      ok: response.ok,
      status: response.ok ? "ready" : "http_error",
      mode,
      httpStatus: response.status
    };
  } catch (error) {
    return {
      ok: false,
      status: error.name === "AbortError" ? "timeout" : "error",
      mode,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchNetworkStatus({ statusUrl, mode, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(statusUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        status: "http_error",
        mode,
        source: statusUrl,
        httpStatus: response.status,
        latencyMs
      };
    }

    const payload = await response.json();
    return normalizeNetworkStatus({
      payload,
      mode,
      source: statusUrl,
      latencyMs
    });
  } catch (error) {
    return {
      ok: false,
      status: error.name === "AbortError" ? "timeout" : "error",
      mode,
      source: statusUrl,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRewards({ rewardsUrl, mode, address, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(rewardsUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        status: "http_error",
        mode,
        address,
        source: rewardsUrl,
        httpStatus: response.status,
        latencyMs
      };
    }

    const payload = await response.json();
    return normalizeRewards({
      payload,
      mode,
      address,
      source: rewardsUrl,
      latencyMs
    });
  } catch (error) {
    return {
      ok: false,
      status: error.name === "AbortError" ? "timeout" : "error",
      mode,
      address,
      source: rewardsUrl,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTransactionStatus({ txStatusUrl, mode, txHash, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(txStatusUrl, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;

    if (response.status === 404) {
      return {
        ok: true,
        status: "not_found",
        mode,
        txHash,
        source: txStatusUrl,
        confirmations: 0,
        latencyMs
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: "http_error",
        mode,
        txHash,
        source: txStatusUrl,
        httpStatus: response.status,
        latencyMs
      };
    }

    const payload = await response.json();
    return normalizeTransactionStatus({
      payload,
      mode,
      txHash,
      source: txStatusUrl,
      latencyMs
    });
  } catch (error) {
    return {
      ok: false,
      status: error.name === "AbortError" ? "timeout" : "error",
      mode,
      txHash,
      source: txStatusUrl,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function postPaymentFee({ feeUrl, mode, payment, timeoutMs, fetchImpl }) {
  const result = await postJson({ url: feeUrl, body: buildPaymentPayload(payment), mode, timeoutMs, fetchImpl });
  if (!result.ok) return result;
  return normalizePaymentFee({
    payload: result.payload,
    mode,
    source: feeUrl,
    latencyMs: result.latencyMs,
    asset: payment.asset
  });
}

async function postPaymentBroadcast({ broadcastUrl, mode, payment, timeoutMs, fetchImpl }) {
  const result = await postJson({ url: broadcastUrl, body: buildPaymentPayload(payment), mode, timeoutMs, fetchImpl });
  if (!result.ok) return result;
  return normalizePaymentBroadcast({
    payload: result.payload,
    mode,
    source: broadcastUrl,
    latencyMs: result.latencyMs
  });
}

async function postJson({ url, body, mode, timeoutMs, fetchImpl }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
    const latencyMs = Date.now() - startedAt;

    if (!response.ok) {
      return {
        ok: false,
        status: "http_error",
        mode,
        source: url,
        httpStatus: response.status,
        latencyMs
      };
    }

    return {
      ok: true,
      payload: await response.json(),
      latencyMs
    };
  } catch (error) {
    return {
      ok: false,
      status: error.name === "AbortError" ? "timeout" : "error",
      mode,
      source: url,
      error: error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeNetworkStatus({ payload, mode, source, latencyMs }) {
  const data = unwrapPayload(payload);
  const latestBlock = pickObject(data, ["latestBlock", "latest_block", "block", "bestBlock", "tip"]) ?? {};
  const supply = pickObject(data, ["supply", "tokenSupply", "token_supply"]) ?? {};
  const nodes = pickObject(data, ["nodes", "peers", "network"]) ?? {};

  const blockHeight = pickNumber(data, [
    "blockHeight",
    "height",
    "latestBlockHeight",
    "latest_block_height",
    "bestHeight",
    "best_height"
  ]) ?? pickNumber(latestBlock, ["height", "number", "blockHeight"]);
  const latestBlockHash = pickString(data, [
    "latestBlockHash",
    "blockHash",
    "hash",
    "bestHash",
    "best_hash"
  ]) ?? pickString(latestBlock, ["hash", "id", "blockHash"]);
  const hashRate = pickNumber(data, [
    "hashRate",
    "hashrate",
    "networkHashRate",
    "networkHashrate",
    "network_hash_rate",
    "network_hashrate",
    "hash_rate"
  ]) ?? pickNumber(nodes, ["hashRate", "hashrate"]);
  const activeNodes = pickNumber(data, [
    "activeNodes",
    "nodesActive",
    "nodeCount",
    "peerCount",
    "peers",
    "activePeers",
    "active_nodes"
  ]) ?? pickNumber(nodes, ["active", "count", "total", "peerCount"]);
  const circulatingSupply = pickNumber(data, [
    "circulatingSupply",
    "supplyCirculating",
    "circulating_supply",
    "circulating"
  ]) ?? pickNumber(supply, ["circulating", "circulatingSupply", "current"]);

  const normalized = {
    ok: true,
    status: "ready",
    mode,
    source,
    latencyMs,
    network: pickString(data, ["network", "networkName", "chain", "chainId"]) ?? "Vireon Network",
    blockHeight,
    latestBlockHash,
    hashRate,
    activeNodes,
    circulatingSupply,
    updatedAt: pickString(data, ["updatedAt", "updated_at", "timestamp", "time"]) ?? new Date().toISOString(),
    rawStatus: pickString(data, ["status", "syncStatus", "sync_status"]) ?? null
  };

  if ([blockHeight, latestBlockHash, hashRate, activeNodes, circulatingSupply].every((value) => value == null)) {
    return {
      ...normalized,
      ok: false,
      status: "invalid_response",
      message: "Chain status response did not contain known Vireon network metrics."
    };
  }

  return normalized;
}

function buildMockNetworkStatus(mode) {
  return {
    ok: true,
    status: "mock",
    mode,
    mock: true,
    source: "mock-adapter",
    network: "Vireon Mocknet",
    blockHeight: 411001,
    latestBlockHash: "0xvireonmock000000000000000000000000000000000000000000000000411001",
    hashRate: 1250000000000,
    activeNodes: 42,
    circulatingSupply: 0,
    updatedAt: new Date().toISOString(),
    rawStatus: "simulated"
  };
}

function normalizeRewards({ payload, mode, address, source, latencyMs }) {
  const data = unwrapPayload(payload);
  const rewards = pickObject(data, ["rewards", "rewardTotals", "reward_totals"]) ?? {};
  const mining = pickObject(data, ["mining", "miningRewards", "mining_rewards"]) ?? {};
  const staking = pickObject(data, ["staking", "stakingRewards", "staking_rewards"]) ?? {};
  const node = pickObject(data, ["node", "nodeRewards", "node_rewards", "validator", "validatorRewards"]) ?? {};

  const miningRewards = pickRewardAmount(data, rewards, mining, ["mining", "miningRewards", "mining_rewards", "amount"]);
  const stakingRewards = pickRewardAmount(data, rewards, staking, ["staking", "stakingRewards", "staking_rewards", "amount"]);
  const nodeRewards = pickRewardAmount(data, rewards, node, ["node", "nodeRewards", "node_rewards", "validator", "validatorRewards", "amount"]);
  const totalRewards = pickNumber(data, ["totalRewards", "total_rewards", "total", "lifetimeTotal"])
    ?? pickNumber(rewards, ["total", "totalRewards", "lifetime"])
    ?? sumKnown([miningRewards, stakingRewards, nodeRewards]);
  const claimableRewards = pickNumber(data, ["claimableRewards", "claimable_rewards", "claimable", "pendingClaim"])
    ?? pickNumber(rewards, ["claimable", "claimableRewards"]);
  const pendingRewards = pickNumber(data, ["pendingRewards", "pending_rewards", "pending"])
    ?? pickNumber(rewards, ["pending", "pendingRewards"]);
  const paidRewards = pickNumber(data, ["paidRewards", "paid_rewards", "paid", "claimedRewards", "claimed"])
    ?? pickNumber(rewards, ["paid", "claimed", "paidRewards"]);

  const normalized = {
    ok: true,
    status: "ready",
    mode,
    address: pickString(data, ["address", "wallet", "walletAddress"]) ?? address,
    source,
    latencyMs,
    miningRewards,
    stakingRewards,
    nodeRewards,
    totalRewards,
    claimableRewards,
    pendingRewards,
    paidRewards,
    currency: pickString(data, ["currency", "symbol", "asset"]) ?? "VIRE",
    updatedAt: pickString(data, ["updatedAt", "updated_at", "timestamp", "time"]) ?? new Date().toISOString(),
    rawStatus: pickString(data, ["status", "rewardStatus", "reward_status"]) ?? null
  };

  if ([miningRewards, stakingRewards, nodeRewards, totalRewards, claimableRewards, pendingRewards, paidRewards].every((value) => value == null)) {
    return {
      ...normalized,
      ok: false,
      status: "invalid_response",
      message: "Rewards response did not contain known mining, staking or node reward metrics."
    };
  }

  return normalized;
}

function buildMockRewards({ mode, address }) {
  return {
    ok: true,
    status: "mock",
    mode,
    mock: true,
    address,
    source: "mock-adapter",
    miningRewards: 12.5,
    stakingRewards: 4.25,
    nodeRewards: 2,
    totalRewards: 18.75,
    claimableRewards: 3.5,
    pendingRewards: 1.25,
    paidRewards: 14,
    currency: "VIRE",
    updatedAt: new Date().toISOString(),
    rawStatus: "simulated"
  };
}

function normalizePaymentFee({ payload, mode, source, latencyMs, asset }) {
  const data = unwrapPayload(payload);
  const feeAmount = pickString(data, ["feeAmount", "fee", "estimatedFee", "estimated_fee", "amount"])
    ?? normalizeAmountString(pickNumber(data, ["feeAmount", "fee", "estimatedFee", "estimated_fee", "amount"]));
  const feeAsset = pickString(data, ["feeAsset", "asset", "currency", "symbol"]) ?? asset ?? "VIRE";

  if (!feeAmount || normalizeAmountString(feeAmount) == null) {
    return {
      ok: false,
      status: "invalid_fee_response",
      mode,
      source,
      latencyMs,
      message: "Payment fee response did not contain a known fee amount."
    };
  }

  return {
    ok: true,
    status: pickString(data, ["status", "feeStatus", "fee_status"]) ?? "ready",
    mode,
    source,
    latencyMs,
    feeAmount: normalizeAmountString(feeAmount),
    feeAsset,
    updatedAt: pickString(data, ["updatedAt", "updated_at", "timestamp", "time"]) ?? new Date().toISOString(),
    rawStatus: pickString(data, ["status", "feeStatus", "fee_status"]) ?? null
  };
}

function normalizePaymentBroadcast({ payload, mode, source, latencyMs }) {
  const data = unwrapPayload(payload);
  const txHash = pickString(data, ["txHash", "hash", "transactionHash", "transaction_hash", "id"]);

  if (!txHash) {
    return {
      ok: false,
      status: "invalid_broadcast_response",
      mode,
      source,
      latencyMs,
      message: "Payment broadcast response did not contain a transaction hash."
    };
  }

  return {
    ok: true,
    status: pickString(data, ["status", "broadcastStatus", "broadcast_status"]) ?? "broadcasted",
    mode,
    source,
    latencyMs,
    txHash,
    rawStatus: pickString(data, ["status", "broadcastStatus", "broadcast_status"]) ?? null,
    updatedAt: pickString(data, ["updatedAt", "updated_at", "timestamp", "time"]) ?? new Date().toISOString()
  };
}

function normalizeTransactionStatus({ payload, mode, txHash, source, latencyMs }) {
  const data = unwrapPayload(payload);
  const block = pickObject(data, ["block", "includedBlock", "included_block", "blockHeader"]) ?? {};
  const conflict = pickObject(data, ["conflict", "doubleSpend", "double_spend"]) ?? {};
  const rawStatus = pickString(data, ["status", "txStatus", "transactionStatus", "transaction_status"]) ?? "unknown";
  const normalizedStatus = normalizeTxStatus(rawStatus, data);
  const confirmations = pickNumber(data, ["confirmations", "confirmationCount", "confirmation_count"])
    ?? pickNumber(block, ["confirmations", "confirmationCount"])
    ?? 0;
  const blockHeight = pickNumber(data, ["blockHeight", "block_height", "height"])
    ?? pickNumber(block, ["height", "number", "blockHeight"]);
  const blockHash = pickString(data, ["blockHash", "block_hash"])
    ?? pickString(block, ["hash", "id", "blockHash"]);
  const canonical = pickBoolean(data, ["canonical", "isCanonical", "mainChain", "main_chain"])
    ?? pickBoolean(block, ["canonical", "isCanonical", "mainChain"])
    ?? !["reorged", "orphaned", "double_spend"].includes(normalizedStatus);
  const conflictTxHash = pickString(data, ["conflictTxHash", "conflictingTxHash", "conflicting_tx_hash"])
    ?? pickString(conflict, ["txHash", "hash", "id"]);

  return {
    ok: true,
    status: normalizedStatus,
    rawStatus,
    mode,
    txHash: pickString(data, ["txHash", "hash", "transactionHash", "transaction_hash", "id"]) ?? txHash,
    source,
    latencyMs,
    confirmations,
    blockHeight,
    blockHash,
    canonical,
    conflictTxHash,
    updatedAt: pickString(data, ["updatedAt", "updated_at", "timestamp", "time"]) ?? new Date().toISOString()
  };
}

function normalizeTxStatus(status, data = {}) {
  const normalized = String(status ?? "").trim().toLowerCase().replaceAll("-", "_");
  if (["confirmed", "final", "finalized", "accepted"].includes(normalized)) return "confirmed";
  if (["pending", "mempool", "broadcasted", "seen", "included", "confirming"].includes(normalized)) return "confirming";
  if (["not_found", "missing", "unknown"].includes(normalized)) return "not_found";
  if (["reorged", "orphaned", "uncled", "detached"].includes(normalized)) return "reorged";
  if (["double_spend", "conflict", "conflicted", "replaced"].includes(normalized)) return "double_spend";
  if (["failed", "invalid", "rejected"].includes(normalized)) return "failed";
  if (pickBoolean(data, ["doubleSpend", "double_spend", "conflicted"])) return "double_spend";
  if (pickBoolean(data, ["orphaned", "reorged"])) return "reorged";
  return normalized || "unknown";
}

function buildMockTransactionStatus({ mode, txHash }) {
  const digest = crypto.createHash("sha256").update(txHash).digest("hex");
  return {
    ok: true,
    status: "confirmed",
    rawStatus: "mock_confirmed",
    mode,
    mock: true,
    txHash,
    source: "mock-adapter",
    confirmations: 12,
    blockHeight: 411001,
    blockHash: `0xmockblock${digest.slice(0, 48)}`,
    canonical: true,
    updatedAt: new Date().toISOString()
  };
}

function normalizePaymentRequest(payment = {}) {
  const fromAddress = normalizeAddress(payment.fromAddress);
  const toAddress = normalizeAddress(payment.toAddress);
  const amount = normalizeAmountString(payment.amount);
  const asset = String(payment.asset ?? "VIRE").trim().toUpperCase() || "VIRE";
  const feeAmount = payment.feeAmount == null ? null : normalizeAmountString(payment.feeAmount);
  const feeAsset = String(payment.feeAsset ?? asset).trim().toUpperCase() || asset;

  if (!fromAddress || !toAddress) {
    return { ok: false, status: "missing_payment_address", message: "fromAddress and toAddress are required." };
  }
  if (!amount || amount === "0") {
    return { ok: false, status: "invalid_payment_amount", message: "Payment amount must be greater than zero." };
  }
  if (payment.feeAmount != null && feeAmount == null) {
    return { ok: false, status: "invalid_payment_fee", message: "Payment fee amount is invalid." };
  }

  return {
    ok: true,
    fromAddress,
    toAddress,
    amount,
    asset,
    feeAmount,
    feeAsset,
    referenceId: payment.referenceId ?? null,
    memo: payment.memo ?? null,
    custodyMode: payment.custodyMode ?? null,
    signingMode: payment.signingMode ?? null
  };
}

function buildPaymentPayload(payment) {
  return {
    fromAddress: payment.fromAddress,
    toAddress: payment.toAddress,
    amount: payment.amount,
    asset: payment.asset,
    feeAmount: payment.feeAmount,
    feeAsset: payment.feeAsset,
    referenceId: payment.referenceId,
    memo: payment.memo,
    custodyMode: payment.custodyMode,
    signingMode: payment.signingMode
  };
}

function normalizeAmountString(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const text = String(value ?? "").trim();
  if (!/^\d+(\.\d{1,8})?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  return `${BigInt(whole)}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}

function unwrapPayload(payload) {
  if (!payload || typeof payload !== "object") return {};
  if (payload.result && typeof payload.result === "object") return unwrapPayload(payload.result);
  if (payload.data && typeof payload.data === "object") return unwrapPayload(payload.data);
  if (payload.status && typeof payload.status === "object") return unwrapPayload(payload.status);
  return payload;
}

function pickObject(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  }
  return null;
}

function pickNumber(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "") {
      const parsed = Number(value.replaceAll(",", ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function pickString(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function pickBoolean(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) return true;
      if (["false", "0", "no"].includes(normalized)) return false;
    }
  }
  return null;
}

function pickRewardAmount(root, aggregate, nested, keys) {
  return pickNumber(root, keys)
    ?? pickNumber(aggregate, keys)
    ?? pickNumber(nested, ["amount", "total", "earned", "rewards"]);
}

function sumKnown(values) {
  const known = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
}

function normalizeAddress(address) {
  return String(address ?? "").trim();
}

function resolveRewardsUrl({ rpcUrl, rewardsUrl, rewardsPath, address }) {
  const encodedAddress = encodeURIComponent(address);
  if (rewardsUrl) {
    return String(rewardsUrl).replaceAll("{address}", encodedAddress);
  }

  if (!rpcUrl) return null;
  return joinUrl(rpcUrl, String(rewardsPath || "/rewards/{address}").replaceAll("{address}", encodedAddress));
}

function resolveTxStatusUrl({ rpcUrl, txStatusUrl, txStatusPath, txHash }) {
  const encodedTxHash = encodeURIComponent(txHash);
  if (txStatusUrl) {
    return String(txStatusUrl).replaceAll("{txHash}", encodedTxHash);
  }

  if (!rpcUrl) return null;
  return joinUrl(rpcUrl, String(txStatusPath || "/transactions/{txHash}").replaceAll("{txHash}", encodedTxHash));
}

function normalizeTxHash(txHash) {
  return String(txHash ?? "").trim();
}

function joinUrl(baseUrl, path) {
  if (!baseUrl) return null;
  const base = String(baseUrl).replace(/\/+$/, "");
  const suffix = String(path || "").replace(/^\/+/, "");
  return suffix ? `${base}/${suffix}` : base;
}

function parseTimeout(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function parseBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}
