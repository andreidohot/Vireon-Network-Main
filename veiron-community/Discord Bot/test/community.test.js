import { describe, expect, it } from "vitest";
import { handleAntiRaidJoin } from "../src/community.js";

describe("community anti-raid detection", () => {
  it("persists an anti-raid event when join rate crosses the configured threshold", async () => {
    const store = createStore();
    const raidTracker = new Map();
    const settings = {
      automod: {
        enabled: true,
        antiRaid: {
          enabled: true,
          joinWindowSeconds: 60,
          maxJoins: 3,
          alertCooldownMinutes: 5
        }
      }
    };

    await handleAntiRaidJoin({ member: createMember("u1"), store, settings, raidTracker, now: 1_000 });
    await handleAntiRaidJoin({ member: createMember("u2"), store, settings, raidTracker, now: 2_000 });
    const event = await handleAntiRaidJoin({ member: createMember("u3"), store, settings, raidTracker, now: 3_000 });

    expect(event).toMatchObject({
      reason: "Anti-raid join-rate alert",
      matched: "3 joins in 60s",
      joinCount: 3,
      threshold: 3
    });
    expect(store.items["automod-events"]).toHaveLength(1);
    expect(store.items["audit-events"]).toHaveLength(1);
    expect(store.items["audit-events"][0]).toMatchObject({
      type: "anti-raid",
      source: "automod"
    });
  });

  it("respects alert cooldown to avoid duplicate raid alerts", async () => {
    const store = createStore();
    const raidTracker = new Map();
    const settings = {
      automod: {
        enabled: true,
        antiRaid: {
          enabled: true,
          joinWindowSeconds: 60,
          maxJoins: 2,
          alertCooldownMinutes: 5
        }
      }
    };

    await handleAntiRaidJoin({ member: createMember("u1"), store, settings, raidTracker, now: 1_000 });
    await handleAntiRaidJoin({ member: createMember("u2"), store, settings, raidTracker, now: 2_000 });
    await handleAntiRaidJoin({ member: createMember("u3"), store, settings, raidTracker, now: 3_000 });

    expect(store.items["automod-events"]).toHaveLength(1);
  });
});

function createStore() {
  const items = {};

  return {
    items,
    async add(collection, item) {
      const nextItem = {
        id: `${collection}-${(items[collection]?.length ?? 0) + 1}`,
        createdAt: "2026-01-01T00:00:00.000Z",
        ...item
      };
      items[collection] = [...(items[collection] ?? []), nextItem];
      return nextItem;
    }
  };
}

function createMember(id) {
  return {
    id,
    user: {
      id,
      tag: `${id}#0001`
    },
    guild: {
      id: "guild-1",
      name: "Vireon",
      channels: {
        cache: {
          find: () => null
        }
      }
    }
  };
}
