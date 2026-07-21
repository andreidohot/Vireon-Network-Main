import { describe, expect, it } from "vitest";
import {
  appendBlockchainSample,
  buildBlockchainAlert,
  buildBlockchainMetrics,
  createBlockchainSample,
  getBlockchainDashboardStatus
} from "../src/blockchain-monitor.js";

describe("blockchain dashboard monitor", () => {
  it("builds uptime metrics from persisted samples", () => {
    const samples = [
      createBlockchainSample({
        health: { ok: true, status: "ready" },
        network: { ok: true, status: "ready", blockHeight: 10, latencyMs: 100 },
        now: new Date("2026-01-01T00:00:00.000Z")
      }),
      createBlockchainSample({
        health: { ok: false, status: "timeout" },
        network: { ok: false, status: "timeout", latencyMs: null },
        now: new Date("2026-01-01T00:01:00.000Z")
      })
    ];

    expect(buildBlockchainMetrics({ sample: samples.at(-1), samples })).toMatchObject({
      uptimePercent: 50,
      sampleCount: 2,
      latestLatencyMs: 100,
      latestBlockHeight: null,
      downSince: "2026-01-01T00:01:00.000Z"
    });
  });

  it("creates a critical alert when the configured chain is down", () => {
    const sample = createBlockchainSample({
      health: { ok: false, status: "timeout", error: "timeout" },
      network: { ok: false, status: "timeout", error: "timeout" },
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(buildBlockchainAlert({
      sample,
      health: { ok: false, status: "timeout", error: "timeout" },
      network: { ok: false, status: "timeout", error: "timeout" },
      samples: [sample]
    })).toMatchObject({
      severity: "critical",
      title: "Vireon node/RPC is down",
      downSince: "2026-01-01T00:00:00.000Z"
    });
  });

  it("creates a warning alert when monitoring is disabled", () => {
    const sample = createBlockchainSample({
      health: { ok: true, status: "disabled" },
      network: { ok: false, status: "disabled" },
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(buildBlockchainAlert({
      sample,
      health: { ok: true, status: "disabled" },
      network: { ok: false, status: "disabled" },
      samples: [sample]
    })).toMatchObject({
      severity: "warning",
      title: "Chain adapter disabled"
    });
  });

  it("creates a warning alert when stale RPC cache is served", () => {
    const sample = createBlockchainSample({
      health: { ok: true, status: "ready" },
      network: {
        ok: true,
        status: "ready",
        blockHeight: 10,
        stale: true,
        rateLimited: true,
        cacheAgeMs: 20000
      },
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(buildBlockchainAlert({
      sample,
      health: { ok: true, status: "ready" },
      network: { ok: true, status: "ready", stale: true, rateLimited: true },
      samples: [sample]
    })).toMatchObject({
      severity: "warning",
      title: "RPC data served from cache"
    });
    expect(sample).toMatchObject({
      cached: false,
      stale: true,
      rateLimited: true,
      cacheAgeMs: 20000
    });
  });

  it("stores capped dashboard history in the shared DAL", async () => {
    const store = createMemoryStore();
    await appendBlockchainSample(store, { id: "1", createdAt: "2026-01-01T00:00:00.000Z", ok: true }, 2);
    await appendBlockchainSample(store, { id: "2", createdAt: "2026-01-01T00:01:00.000Z", ok: true }, 2);
    const result = await appendBlockchainSample(store, { id: "3", createdAt: "2026-01-01T00:02:00.000Z", ok: false }, 2);

    expect(result.samples.map((sample) => sample.id)).toEqual(["2", "3"]);
  });

  it("combines chain health and network status for the admin API", async () => {
    const store = createMemoryStore();
    const chainClient = {
      mode: "mock",
      async healthCheck() {
        return { ok: true, status: "mock", mode: "mock" };
      },
      async getNetworkStatus() {
        return {
          ok: true,
          status: "mock",
          mode: "mock",
          blockHeight: 100,
          hashRate: 2000,
          activeNodes: 5,
          circulatingSupply: 1000,
          latencyMs: 12,
          source: "mock"
        };
      }
    };

    await expect(getBlockchainDashboardStatus({
      store,
      chainClient,
      now: new Date("2026-01-01T00:00:00.000Z")
    })).resolves.toMatchObject({
      status: "ready",
      metrics: {
        latestBlockHeight: 100,
        activeNodes: 5,
        latestLatencyMs: 12
      },
      alert: null
    });
  });
});

function createMemoryStore() {
  let value = { samples: [] };

  return {
    async getSingleton(_collection, defaults) {
      return { ...defaults, ...value };
    },
    async setSingleton(_collection, nextValue) {
      value = nextValue;
      return value;
    }
  };
}
