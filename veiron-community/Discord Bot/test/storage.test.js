import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaStore } from "../src/prisma-store.js";
import { JsonStore } from "../src/storage.js";

describe("JsonStore", () => {
  it("implements list/add/update while preserving explicit IDs", async () => {
    const store = new JsonStore({ dataDir: await tempDataDir() });

    const added = await store.add("tickets", {
      id: "ticket-1",
      topic: "Help"
    });
    const updated = await store.update("tickets", (item) => item.id === "ticket-1", () => ({
      status: "closed"
    }));
    const items = await store.list("tickets");

    expect(added.id).toBe("ticket-1");
    expect(updated.status).toBe("closed");
    expect(updated.updatedAt).toEqual(expect.any(String));
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("ticket-1");
  });

  it("stores and merges singleton defaults", async () => {
    const dataDir = await tempDataDir();
    const store = new JsonStore({ dataDir });

    await store.setSingleton("settings", { enabled: false });
    const settings = await store.getSingleton("settings", { enabled: true, name: "Vireon" });
    const raw = JSON.parse(await readFile(path.join(dataDir, "settings.json"), "utf8"));

    expect(settings).toMatchObject({ enabled: false, name: "Vireon" });
    expect(raw.value.updatedAt).toEqual(expect.any(String));
  });

  it("reports JSON health status", async () => {
    const store = new JsonStore({ dataDir: await tempDataDir() });

    await expect(store.healthCheck()).resolves.toMatchObject({
      ok: true,
      status: "ready",
      driver: "json"
    });
  });
});

describe("PrismaStore DAL contract", () => {
  it("uses Prisma upsert and preserves the JsonStore method contract", async () => {
    const prisma = createPrismaMock();
    const store = new PrismaStore({ prisma });

    const added = await store.add("moderation-cases", { id: "case-1", reason: "spam" });
    const updated = await store.update("moderation-cases", (item) => item.id === "case-1", () => ({
      status: "resolved"
    }));
    await store.setSingleton("settings", { automod: { enabled: false } });

    expect(added.id).toBe("case-1");
    expect(updated).toMatchObject({ id: "case-1", status: "resolved" });
    await expect(store.list("moderation-cases")).resolves.toHaveLength(1);
    await expect(store.getSingleton("settings", { name: "default" })).resolves.toMatchObject({
      name: "default",
      automod: { enabled: false }
    });
  });

  it("stores XP profiles in the dedicated Prisma model when available", async () => {
    const prisma = createPrismaMock();
    const store = new PrismaStore({ prisma });

    await store.add("xp-profiles", {
      id: "guild-1:user-1",
      guildId: "guild-1",
      userId: "user-1",
      userTag: "User#0001",
      xp: 10,
      level: 0,
      messageXp: 10,
      voiceXp: 0,
      messageCount: 1,
      awardedMessageCount: 1,
      cooldownSkippedMessages: 0,
      voiceSeconds: 0,
      lastMessageAt: "2026-01-01T00:00:00.000Z",
      lastMessageXpAt: "2026-01-01T00:00:00.000Z",
      activeVoiceChannelId: null,
      activeVoiceJoinedAt: null
    });
    const updated = await store.update("xp-profiles", (item) => item.userId === "user-1", () => ({
      xp: 25,
      level: 1
    }));

    expect(updated).toMatchObject({ xp: 25, level: 1 });
    await expect(store.list("xp-profiles")).resolves.toMatchObject([
      {
        id: "guild-1:user-1",
        guildId: "guild-1",
        userId: "user-1",
        xp: 25,
        level: 1
      }
    ]);
    await expect(prisma.storeItem.count()).resolves.toBe(0);
  });
});

async function tempDataDir() {
  return mkdtemp(path.join(os.tmpdir(), "vireon-store-test-"));
}

function createPrismaMock() {
  const items = new Map();
  const singletons = new Map();
  const xpProfiles = new Map();

  return {
    xpProfile: {
      async findMany() {
        return [...xpProfiles.values()];
      },
      async create({ data }) {
        xpProfiles.set(data.id, { ...data, createdAt: new Date(), updatedAt: new Date() });
      },
      async update({ where, data }) {
        const current = xpProfiles.get(where.id);
        xpProfiles.set(where.id, { ...current, ...data, updatedAt: new Date() });
      }
    },
    storeItem: {
      async findMany({ where }) {
        return [...items.values()].filter((item) => item.collection === where.collection);
      },
      async create({ data }) {
        items.set(`${data.collection}:${data.id}`, { ...data, createdAt: new Date() });
      },
      async upsert({ where, create, update }) {
        const key = `${where.collection_id.collection}:${where.collection_id.id}`;
        const current = items.get(key);
        items.set(key, current ? { ...current, ...update } : create);
      },
      async count() {
        return items.size;
      }
    },
    storeSingleton: {
      async findUnique({ where }) {
        return singletons.get(where.collection) ?? null;
      },
      async upsert({ where, create, update }) {
        const current = singletons.get(where.collection);
        singletons.set(where.collection, current ? { ...current, ...update } : create);
      }
    },
    async $disconnect() {}
  };
}
