import { describe, expect, it } from "vitest";
import { createChainClient } from "../src/chain-client.js";

describe("Vireon chain client", () => {
  it("reports disabled network status without pretending live data exists", async () => {
    const client = createChainClient({
      env: { VIREON_CHAIN_MODE: "disabled" },
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    await expect(client.healthCheck()).resolves.toMatchObject({
      ok: true,
      status: "disabled",
      mode: "disabled"
    });
    await expect(client.getNetworkStatus()).resolves.toMatchObject({
      ok: false,
      status: "disabled",
      mode: "disabled"
    });
  });

  it("returns clearly marked mock metrics in mock mode", async () => {
    const client = createChainClient({
      env: { VIREON_CHAIN_MODE: "mock" },
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    const status = await client.getNetworkStatus();

    expect(status).toMatchObject({
      ok: true,
      status: "mock",
      mode: "mock",
      mock: true,
      network: "Vireon Mocknet"
    });
    expect(status.blockHeight).toEqual(expect.any(Number));
    expect(status.latestBlockHash).toContain("vireonmock");
  });

  it("fetches and normalizes live RPC status metrics", async () => {
    const requests = [];
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example/api",
        VIREON_CHAIN_STATUS_PATH: "/network/status"
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              result: {
                networkName: "Vireon Testnet",
                latestBlock: {
                  height: "123456",
                  hash: "0xabcd"
                },
                networkHashrate: "2500000000",
                nodes: { active: 17 },
                supply: { circulating: "41000000.5" },
                syncStatus: "synced",
                updated_at: "2026-07-06T18:00:00.000Z"
              }
            };
          }
        };
      }
    });

    const status = await client.getNetworkStatus();

    expect(requests[0]).toMatchObject({
      url: "https://rpc.vireon.example/api/network/status"
    });
    expect(requests[0].options.headers.accept).toBe("application/json");
    expect(status).toMatchObject({
      ok: true,
      status: "ready",
      mode: "rpc",
      source: "https://rpc.vireon.example/api/network/status",
      network: "Vireon Testnet",
      blockHeight: 123456,
      latestBlockHash: "0xabcd",
      hashRate: 2500000000,
      activeNodes: 17,
      circulatingSupply: 41000000.5,
      rawStatus: "synced"
    });
  });

  it("uses an explicit status URL when configured", async () => {
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example",
        VIREON_CHAIN_STATUS_URL: "https://explorer.vireon.example/status.json"
      },
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              height: 10,
              hashRate: 100,
              activeNodes: 2,
              circulatingSupply: 50
            },
            requestedUrl: url
          };
        }
      })
    });

    await expect(client.getNetworkStatus()).resolves.toMatchObject({
      ok: true,
      source: "https://explorer.vireon.example/status.json",
      blockHeight: 10
    });
  });

  it("caches network status calls within the configured TTL", async () => {
    let calls = 0;
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example",
        VIREON_CHAIN_STATUS_CACHE_TTL_MS: "10000"
      },
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return { result: { height: calls, hashRate: 100, activeNodes: 2, circulatingSupply: 50 } };
          }
        };
      }
    });

    const first = await client.getNetworkStatus();
    const second = await client.getNetworkStatus();

    expect(calls).toBe(1);
    expect(first).toMatchObject({ ok: true, blockHeight: 1 });
    expect(second).toMatchObject({
      ok: true,
      blockHeight: 1,
      cached: true,
      cacheStatus: "hit"
    });
  });

  it("deduplicates concurrent status calls to the same RPC URL", async () => {
    let calls = 0;
    let resolveFetch;
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example"
      },
      fetchImpl: async () => {
        calls += 1;
        return fetchPromise;
      }
    });

    const firstPromise = client.getNetworkStatus();
    const secondPromise = client.getNetworkStatus();
    await Promise.resolve();

    resolveFetch({
      ok: true,
      status: 200,
      async json() {
        return { result: { height: 25, hashRate: 100, activeNodes: 2, circulatingSupply: 50 } };
      }
    });

    const [first, second] = await Promise.all([firstPromise, secondPromise]);

    expect(calls).toBe(1);
    expect(first).toMatchObject({ ok: true, blockHeight: 25 });
    expect(second).toMatchObject({ ok: true, blockHeight: 25, cached: true, cacheStatus: "inflight" });
  });

  it("serves stale cached status when the RPC rate limit is reached", async () => {
    let time = 0;
    let calls = 0;
    const client = createChainClient({
      now: () => time,
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example",
        VIREON_CHAIN_STATUS_CACHE_TTL_MS: "10",
        VIREON_CHAIN_STALE_CACHE_TTL_MS: "1000",
        VIREON_CHAIN_RPC_RATE_LIMIT_PER_MINUTE: "1"
      },
      fetchImpl: async () => {
        calls += 1;
        return {
          ok: true,
          status: 200,
          async json() {
            return { result: { height: 50, hashRate: 100, activeNodes: 2, circulatingSupply: 50 } };
          }
        };
      }
    });

    await expect(client.getNetworkStatus()).resolves.toMatchObject({
      ok: true,
      blockHeight: 50
    });

    time = 20;
    await expect(client.getNetworkStatus()).resolves.toMatchObject({
      ok: true,
      blockHeight: 50,
      cached: true,
      stale: true,
      rateLimited: true,
      cacheStatus: "stale"
    });
    expect(calls).toBe(1);
  });

  it("can use the status URL as health fallback when no RPC URL is configured", async () => {
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_STATUS_URL: "https://explorer.vireon.example/status.json"
      },
      fetchImpl: async (url) => ({
        ok: url === "https://explorer.vireon.example/status.json",
        status: 200
      })
    });

    await expect(client.healthCheck()).resolves.toMatchObject({
      ok: true,
      status: "ready",
      mode: "rpc"
    });
  });

  it("marks unknown RPC responses as invalid instead of showing fake values", async () => {
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example"
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return { result: { message: "pong" } };
        }
      })
    });

    await expect(client.getNetworkStatus()).resolves.toMatchObject({
      ok: false,
      status: "invalid_response"
    });
  });

  it("fetches and normalizes rewards for a linked wallet address", async () => {
    const requests = [];
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example/api",
        VIREON_CHAIN_REWARDS_PATH: "/wallet/{address}/rewards"
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              data: {
                address: "vire_wallet_1",
                rewards: {
                  mining: "12.5",
                  staking: "4.25",
                  node: "3",
                  claimable: "5",
                  paid: "14"
                },
                pendingRewards: "0.75",
                currency: "VIRE",
                updated_at: "2026-07-06T18:00:00.000Z"
              }
            };
          }
        };
      }
    });

    const rewards = await client.getRewardsForAddress("vire_wallet_1");

    expect(requests[0]).toMatchObject({
      url: "https://rpc.vireon.example/api/wallet/vire_wallet_1/rewards"
    });
    expect(requests[0].options.headers.accept).toBe("application/json");
    expect(rewards).toMatchObject({
      ok: true,
      status: "ready",
      mode: "rpc",
      address: "vire_wallet_1",
      miningRewards: 12.5,
      stakingRewards: 4.25,
      nodeRewards: 3,
      totalRewards: 19.75,
      claimableRewards: 5,
      pendingRewards: 0.75,
      paidRewards: 14,
      currency: "VIRE"
    });
  });

  it("uses an explicit rewards URL with the address placeholder", async () => {
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_REWARDS_URL: "https://explorer.vireon.example/accounts/{address}/rewards.json"
      },
      fetchImpl: async (url) => ({
        ok: true,
        status: 200,
        async json() {
          return {
            result: {
              address: url.includes("vire_abc") ? "vire_abc" : "wrong",
              totalRewards: 10
            }
          };
        }
      })
    });

    await expect(client.getRewardsForAddress("vire_abc")).resolves.toMatchObject({
      ok: true,
      source: "https://explorer.vireon.example/accounts/vire_abc/rewards.json",
      totalRewards: 10
    });
  });

  it("keeps rewards cache entries isolated per wallet address", async () => {
    const requests = [];
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_REWARDS_URL: "https://explorer.vireon.example/accounts/{address}/rewards.json",
        VIREON_CHAIN_REWARDS_CACHE_TTL_MS: "10000"
      },
      fetchImpl: async (url) => {
        requests.push(url);
        const isFirstWallet = url.includes("vire_one");
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              result: {
                address: isFirstWallet ? "vire_one" : "vire_two",
                totalRewards: isFirstWallet ? 1 : 2
              }
            };
          }
        };
      }
    });

    await expect(client.getRewardsForAddress("vire_one")).resolves.toMatchObject({
      ok: true,
      address: "vire_one",
      totalRewards: 1
    });
    await expect(client.getRewardsForAddress("vire_two")).resolves.toMatchObject({
      ok: true,
      address: "vire_two",
      totalRewards: 2
    });
    await expect(client.getRewardsForAddress("vire_one")).resolves.toMatchObject({
      ok: true,
      address: "vire_one",
      totalRewards: 1,
      cached: true
    });

    expect(requests).toEqual([
      "https://explorer.vireon.example/accounts/vire_one/rewards.json",
      "https://explorer.vireon.example/accounts/vire_two/rewards.json"
    ]);
  });

  it("does not query rewards without a wallet address", async () => {
    const client = createChainClient({
      env: { VIREON_CHAIN_MODE: "mock" },
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    await expect(client.getRewardsForAddress("")).resolves.toMatchObject({
      ok: false,
      status: "missing_wallet_address"
    });
  });

  it("estimates payment fees through the configured RPC adapter", async () => {
    const requests = [];
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example/api",
        VIREON_CHAIN_PAYMENT_FEE_PATH: "/payments/fee"
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, options, body: JSON.parse(options.body) });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              result: {
                feeAmount: "0.001",
                feeAsset: "VIRE",
                status: "estimated"
              }
            };
          }
        };
      }
    });

    const fee = await client.estimatePaymentFee({
      fromAddress: "vire_sender",
      toAddress: "vire_receiver",
      amount: "2.5",
      asset: "VIRE",
      referenceId: "payment_1"
    });

    expect(requests[0]).toMatchObject({
      url: "https://rpc.vireon.example/api/payments/fee",
      body: {
        fromAddress: "vire_sender",
        toAddress: "vire_receiver",
        amount: "2.5",
        asset: "VIRE",
        referenceId: "payment_1"
      }
    });
    expect(requests[0].body.ok).toBeUndefined();
    expect(fee).toMatchObject({
      ok: true,
      status: "estimated",
      feeAmount: "0.001",
      feeAsset: "VIRE"
    });
  });

  it("broadcasts payments through the configured RPC adapter", async () => {
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_PAYMENT_BROADCAST_URL: "https://signer.vireon.example/broadcast"
      },
      fetchImpl: async (url, options) => ({
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              txHash: JSON.parse(options.body).referenceId === "payment_2" ? "0xpaymenthash" : null,
              status: "accepted",
              url
            }
          };
        }
      })
    });

    await expect(client.broadcastPayment({
      fromAddress: "vire_sender",
      toAddress: "vire_receiver",
      amount: "1",
      asset: "VIRE",
      feeAmount: "0.001",
      feeAsset: "VIRE",
      referenceId: "payment_2"
    })).resolves.toMatchObject({
      ok: true,
      status: "accepted",
      txHash: "0xpaymenthash",
      source: "https://signer.vireon.example/broadcast"
    });
  });

  it("returns explicit mock payment fee and broadcast results in mock mode", async () => {
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "mock",
        VIREON_CHAIN_MOCK_PAYMENT_FEE: "0.002"
      },
      fetchImpl: async () => {
        throw new Error("fetch should not be called");
      }
    });

    await expect(client.estimatePaymentFee({
      fromAddress: "vire_sender",
      toAddress: "vire_receiver",
      amount: "1",
      asset: "VIRE"
    })).resolves.toMatchObject({
      ok: true,
      mock: true,
      feeAmount: "0.002"
    });
    await expect(client.broadcastPayment({
      fromAddress: "vire_sender",
      toAddress: "vire_receiver",
      amount: "1",
      asset: "VIRE",
      referenceId: "payment_mock"
    })).resolves.toMatchObject({
      ok: true,
      mock: true,
      status: "broadcast_mock"
    });
  });

  it("fetches and normalizes transaction status for on-chain sync", async () => {
    const requests = [];
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_RPC_URL: "https://rpc.vireon.example/api",
        VIREON_CHAIN_TX_STATUS_PATH: "/tx/{txHash}"
      },
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              result: {
                txHash: "0xabc",
                status: "confirmed",
                confirmations: "8",
                block: {
                  height: 123,
                  hash: "0xblock"
                },
                canonical: true
              }
            };
          }
        };
      }
    });

    const status = await client.getTransactionStatus("0xabc");

    expect(requests[0]).toMatchObject({
      url: "https://rpc.vireon.example/api/tx/0xabc"
    });
    expect(requests[0].options.headers.accept).toBe("application/json");
    expect(status).toMatchObject({
      ok: true,
      status: "confirmed",
      txHash: "0xabc",
      confirmations: 8,
      blockHeight: 123,
      blockHash: "0xblock",
      canonical: true
    });
  });

  it("marks conflicting transaction status as double spend", async () => {
    const client = createChainClient({
      env: {
        VIREON_CHAIN_MODE: "rpc",
        VIREON_CHAIN_TX_STATUS_URL: "https://rpc.vireon.example/transactions/{txHash}"
      },
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        async json() {
          return {
            data: {
              hash: "0xabc",
              status: "replaced",
              conflictTxHash: "0xdef"
            }
          };
        }
      })
    });

    await expect(client.getTransactionStatus("0xabc")).resolves.toMatchObject({
      ok: true,
      status: "double_spend",
      conflictTxHash: "0xdef"
    });
  });
});
