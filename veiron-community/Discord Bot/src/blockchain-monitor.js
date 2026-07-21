export const BLOCKCHAIN_MONITOR_COLLECTION = "blockchain-monitor";
export const DEFAULT_BLOCKCHAIN_HISTORY_LIMIT = 120;

export async function getBlockchainDashboardStatus({
  store,
  chainClient,
  now = new Date(),
  historyLimit = DEFAULT_BLOCKCHAIN_HISTORY_LIMIT
}) {
  const [health, network] = await Promise.all([
    chainClient.healthCheck(),
    chainClient.getNetworkStatus()
  ]);
  const sample = createBlockchainSample({ health, network, now });
  const monitor = await appendBlockchainSample(store, sample, historyLimit);

  return {
    ok: true,
    status: sample.ok ? "ready" : "degraded",
    mode: network.mode ?? health.mode ?? chainClient.mode ?? "unknown",
    updatedAt: sample.createdAt,
    health,
    network,
    sample,
    metrics: buildBlockchainMetrics({ sample, samples: monitor.samples }),
    history: monitor.samples,
    alert: buildBlockchainAlert({ sample, health, network, samples: monitor.samples })
  };
}

export async function appendBlockchainSample(store, sample, historyLimit = DEFAULT_BLOCKCHAIN_HISTORY_LIMIT) {
  const current = await store.getSingleton(BLOCKCHAIN_MONITOR_COLLECTION, { samples: [] });
  const samples = [...(Array.isArray(current.samples) ? current.samples : []), sample]
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    .slice(-Math.max(1, Number(historyLimit) || DEFAULT_BLOCKCHAIN_HISTORY_LIMIT));

  return store.setSingleton(BLOCKCHAIN_MONITOR_COLLECTION, {
    samples,
    latest: sample
  });
}

export function createBlockchainSample({ health = {}, network = {}, now = new Date() }) {
  const ok = Boolean(health.ok) && Boolean(network.ok);

  return {
    id: now.toISOString(),
    createdAt: now.toISOString(),
    ok,
    mode: network.mode ?? health.mode ?? "unknown",
    status: ok ? "ready" : network.status ?? health.status ?? "degraded",
    healthStatus: health.status ?? null,
    networkStatus: network.status ?? null,
    blockHeight: safeNumber(network.blockHeight),
    hashRate: safeNumber(network.hashRate),
    activeNodes: safeNumber(network.activeNodes),
    circulatingSupply: safeNumber(network.circulatingSupply),
    latencyMs: safeNumber(network.latencyMs),
    cached: Boolean(network.cached),
    stale: Boolean(network.stale),
    rateLimited: Boolean(network.rateLimited),
    cacheStatus: network.cacheStatus ?? null,
    cacheAgeMs: safeNumber(network.cacheAgeMs),
    fallbackStatus: network.fallbackStatus ?? null,
    source: network.source ?? null,
    error: network.error ?? health.error ?? network.message ?? null
  };
}

export function buildBlockchainMetrics({ sample, samples = [] }) {
  const total = samples.length;
  const okCount = samples.filter((item) => item.ok).length;
  const uptimePercent = total > 0 ? (okCount / total) * 100 : sample.ok ? 100 : 0;
  const latencySamples = samples
    .map((item) => item.latencyMs)
    .filter((value) => typeof value === "number" && Number.isFinite(value));
  const latestLatencyMs = sample.latencyMs ?? latencySamples.at(-1) ?? null;
  const averageLatencyMs = latencySamples.length
    ? latencySamples.reduce((sum, value) => sum + value, 0) / latencySamples.length
    : null;

  return {
    uptimePercent,
    sampleCount: total,
    latestLatencyMs,
    averageLatencyMs,
    latestBlockHeight: sample.blockHeight,
    hashRate: sample.hashRate,
    activeNodes: sample.activeNodes,
    circulatingSupply: sample.circulatingSupply,
    downSince: sample.ok ? null : findDownSince(samples)
  };
}

export function buildBlockchainAlert({ sample, health = {}, network = {}, samples = [] }) {
  if (sample.stale) {
    return {
      severity: "warning",
      title: "RPC data served from cache",
      message: sample.rateLimited
        ? "Vireon RPC rate limit was reached, so the dashboard is showing the latest cached chain data."
        : `Live RPC returned ${sample.fallbackStatus ?? "an error"}, so the dashboard is showing the latest cached chain data.`
    };
  }

  if (sample.ok) return null;

  const isDisabled = sample.status === "disabled" || network.status === "disabled" || health.status === "disabled";
  if (isDisabled) {
    return {
      severity: "warning",
      title: "Chain adapter disabled",
      message: "Blockchain monitoring is not reading live RPC data because the chain adapter is disabled."
    };
  }

  return {
    severity: "critical",
    title: "Vireon node/RPC is down",
    message: network.message ?? network.error ?? health.error ?? "The configured chain adapter did not return healthy status.",
    downSince: findDownSince(samples)
  };
}

function findDownSince(samples) {
  const reversed = [...samples].reverse();
  let oldestDown = null;
  for (const sample of reversed) {
    if (sample.ok) break;
    oldestDown = sample.createdAt;
  }
  return oldestDown;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
