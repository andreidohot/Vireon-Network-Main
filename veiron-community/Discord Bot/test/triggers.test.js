import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/storage.js";
import { createCustomTag, getCustomTag } from "../src/tags.js";
import {
  createCustomTrigger,
  deleteCustomTrigger,
  getCustomTrigger,
  isTriggerCooldownReady,
  listCustomTriggers,
  matchesTrigger,
  normalizeTriggerName,
  normalizeTriggerPattern,
  processTriggerMessage
} from "../src/triggers.js";

describe("custom triggers", () => {
  it("normalizes trigger names and validates regex patterns", () => {
    expect(normalizeTriggerName("  Help Trigger!! ")).toBe("help-trigger");
    expect(normalizeTriggerPattern("help|faq")).toBe("help|faq");
    expect(() => normalizeTriggerPattern("[broken")).toThrow("Invalid trigger regex");
  });

  it("creates, lists and soft deletes triggers per guild", async () => {
    const store = await createStore();
    const trigger = await createCustomTrigger(store, {
      guildId: "guild-1",
      name: "Help",
      pattern: "\\bhelp\\b",
      tagName: "faq",
      cooldownSeconds: 30,
      createdById: "admin-1",
      createdByTag: "Admin#0001"
    });

    expect(trigger).toMatchObject({
      id: "guild-1:help",
      name: "help",
      pattern: "\\bhelp\\b",
      tagName: "faq",
      cooldownSeconds: 30
    });
    expect((await listCustomTriggers(store, "guild-1")).map((item) => item.name)).toEqual(["help"]);
    expect(matchesTrigger(trigger, "Can I get HELP?")).toBe(true);

    const deleted = await deleteCustomTrigger(store, {
      guildId: "guild-1",
      name: "help",
      deletedById: "admin-1",
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    expect(deleted).toMatchObject({ deletedAt: "2026-01-01T00:00:00.000Z" });
    expect(await listCustomTriggers(store, "guild-1")).toEqual([]);
  });

  it("processes the first matching trigger and respects cooldown", async () => {
    const store = await createStore();
    await createCustomTag(store, {
      guildId: "guild-1",
      name: "faq",
      content: "Hey {user}, read this in {server}. {mentions}",
      createdById: "admin-1",
      createdByTag: "Admin#0001"
    });
    await createCustomTrigger(store, {
      guildId: "guild-1",
      name: "Need Help",
      pattern: "\\bhelp\\b",
      tagName: "faq",
      cooldownSeconds: 60,
      createdById: "admin-1",
      createdByTag: "Admin#0001"
    });
    const sent = [];
    const message = createMessage({
      content: "I need help please",
      sent
    });

    const first = await processTriggerMessage({
      store,
      message,
      now: new Date("2026-01-01T00:00:00.000Z")
    });
    const second = await processTriggerMessage({
      store,
      message,
      now: new Date("2026-01-01T00:00:30.000Z")
    });
    const third = await processTriggerMessage({
      store,
      message,
      now: new Date("2026-01-01T00:01:01.000Z")
    });
    const trigger = await getCustomTrigger(store, "guild-1", "need-help");
    const tag = await getCustomTag(store, "guild-1", "faq");

    expect(first.name).toBe("need-help");
    expect(second).toBeNull();
    expect(third.name).toBe("need-help");
    expect(sent).toEqual([
      {
        content: "Hey <@user-1>, read this in Vireon Test. <@user-2> <@&role-1>",
        allowedMentions: { parse: ["users", "roles"] }
      },
      {
        content: "Hey <@user-1>, read this in Vireon Test. <@user-2> <@&role-1>",
        allowedMentions: { parse: ["users", "roles"] }
      }
    ]);
    expect(trigger).toMatchObject({
      uses: 2,
      lastTriggeredAt: "2026-01-01T00:01:01.000Z"
    });
    expect(tag).toMatchObject({ uses: 2 });
  });

  it("reports cooldown readiness", () => {
    const trigger = {
      lastTriggeredAt: "2026-01-01T00:00:00.000Z",
      cooldownSeconds: 60
    };

    expect(isTriggerCooldownReady(trigger, new Date("2026-01-01T00:00:59.000Z"))).toBe(false);
    expect(isTriggerCooldownReady(trigger, new Date("2026-01-01T00:01:00.000Z"))).toBe(true);
  });
});

async function createStore() {
  return new JsonStore({ dataDir: await mkdtemp(path.join(os.tmpdir(), "vireon-triggers-test-")) });
}

function createMessage({ content, sent }) {
  return {
    guildId: "guild-1",
    content,
    author: {
      id: "user-1",
      bot: false
    },
    guild: {
      name: "Vireon Test"
    },
    mentions: {
      users: new Map([["user-2", { id: "user-2" }]]),
      roles: new Map([["role-1", { id: "role-1" }]])
    },
    channel: {
      send: async (payload) => {
        sent.push(payload);
        return payload;
      }
    }
  };
}
