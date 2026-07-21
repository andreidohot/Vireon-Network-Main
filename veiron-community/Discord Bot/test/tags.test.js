import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/storage.js";
import {
  createCustomTag,
  deleteCustomTag,
  getCustomTag,
  incrementTagUse,
  listCustomTags,
  normalizeTagName,
  renderTagContent
} from "../src/tags.js";

describe("custom tags", () => {
  it("normalizes names and renders simple variables", () => {
    expect(normalizeTagName("  Welcome Tag!! ")).toBe("welcome-tag");
    expect(renderTagContent("Hi {user}, welcome to {server}. {mentions}", {
      user: { id: "user-1" },
      guild: { name: "Vireon" },
      mentions: "<@user-2>"
    })).toBe("Hi <@user-1>, welcome to Vireon. <@user-2>");
  });

  it("creates, lists and reads tags per guild", async () => {
    const store = await createStore();
    await createCustomTag(store, {
      guildId: "guild-1",
      name: "Rules",
      content: "Read #rules, {user}.",
      createdById: "admin-1",
      createdByTag: "Admin#0001"
    });
    await createCustomTag(store, {
      guildId: "guild-2",
      name: "Rules",
      content: "Other guild.",
      createdById: "admin-2",
      createdByTag: "Admin#0002"
    });

    const tags = await listCustomTags(store, "guild-1");
    const tag = await getCustomTag(store, "guild-1", "rules");

    expect(tags.map((item) => item.name)).toEqual(["rules"]);
    expect(tag).toMatchObject({
      id: "guild-1:rules",
      content: "Read #rules, {user}.",
      uses: 0
    });
  });

  it("increments use count", async () => {
    const store = await createStore();
    const tag = await createCustomTag(store, {
      guildId: "guild-1",
      name: "FAQ",
      content: "FAQ content.",
      createdById: "admin-1",
      createdByTag: "Admin#0001"
    });

    await incrementTagUse(store, tag, new Date("2026-01-01T00:00:00.000Z"));

    expect(await getCustomTag(store, "guild-1", "faq")).toMatchObject({
      uses: 1,
      lastUsedAt: "2026-01-01T00:00:00.000Z"
    });
  });

  it("soft deletes tags and allows recreation", async () => {
    const store = await createStore();
    await createCustomTag(store, {
      guildId: "guild-1",
      name: "Start",
      content: "Old content.",
      createdById: "admin-1",
      createdByTag: "Admin#0001"
    });
    const deleted = await deleteCustomTag(store, {
      guildId: "guild-1",
      name: "start",
      deletedById: "admin-1",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    const recreated = await createCustomTag(store, {
      guildId: "guild-1",
      name: "start",
      content: "New content.",
      createdById: "admin-2",
      createdByTag: "Admin#0002",
      now: new Date("2026-01-02T00:00:00.000Z")
    });

    expect(deleted).toMatchObject({
      deletedAt: "2026-01-01T00:00:00.000Z",
      deletedById: "admin-1"
    });
    expect(await listCustomTags(store, "guild-1")).toEqual([
      expect.objectContaining({
        name: "start",
        content: "New content.",
        deletedAt: null
      })
    ]);
    expect(recreated.updatedAt).toEqual(expect.any(String));
  });

  it("rejects duplicate active tags", async () => {
    const store = await createStore();
    await createCustomTag(store, {
      guildId: "guild-1",
      name: "help",
      content: "Help one.",
      createdById: "admin-1",
      createdByTag: "Admin#0001"
    });

    await expect(createCustomTag(store, {
      guildId: "guild-1",
      name: "help",
      content: "Help two.",
      createdById: "admin-1",
      createdByTag: "Admin#0001"
    })).rejects.toThrow("already exists");
  });
});

async function createStore() {
  return new JsonStore({ dataDir: await mkdtemp(path.join(os.tmpdir(), "vireon-tags-test-")) });
}
