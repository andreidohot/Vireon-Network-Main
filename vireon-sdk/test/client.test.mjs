import assert from "node:assert/strict";
import test from "node:test";

import { VireonClient, VireonError, poolBlockMaturity } from "../dist/index.js";

test("poolBlockMaturity follows the configured confirmation boundary", () => {
  const immature = poolBlockMaturity(100, 105, 12);
  assert.equal(immature.status, "immature");
  assert.equal(immature.confirmations, 5);
  assert.equal(immature.remaining, 7);
  assert.equal(immature.matureAtTip, 112);

  const mature = poolBlockMaturity(100, 112, 12);
  assert.equal(mature.status, "mature");
  assert.equal(mature.percent, 100);
});

test("client normalizes base URLs and requests the expected endpoint", async () => {
  const calls = [];
  const client = new VireonClient({
    rpcUrl: " https://rpc.example.test/// ",
    poolUrl: "https://pool.example.test/",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.equal(client.rpcUrl, "https://rpc.example.test");
  assert.equal(client.poolUrl, "https://pool.example.test");
  assert.deepEqual(await client.health(), { ok: true });
  assert.equal(calls[0].url, "https://rpc.example.test/health");
  assert.equal(calls[0].init.method, "GET");
});

test("client rejects invalid local input before calling fetch", async () => {
  let called = false;
  const client = new VireonClient({
    fetch: async () => {
      called = true;
      throw new Error("fetch must not run");
    }
  });

  await assert.rejects(client.blockByHeight(-1), VireonError);
  await assert.rejects(client.transaction("bad-hash"), VireonError);
  await assert.rejects(client.addressBalance("not-an-address"), VireonError);
  await assert.rejects(
    client.submitTransaction({ from: "vire1from", to: "vire1to", nonce: 1 }),
    VireonError
  );
  assert.equal(called, false);
});

test("HTTP failures retain status and URL context", async () => {
  const client = new VireonClient({
    rpcUrl: "https://rpc.example.test",
    fetch: async () => new Response("unavailable", { status: 503 })
  });

  await assert.rejects(client.status(), (error) => {
    assert.ok(error instanceof VireonError);
    assert.equal(error.status, 503);
    assert.equal(error.url, "https://rpc.example.test/status");
    return true;
  });
});
