import { describe, expect, it } from "vitest";
import { normalizeAutomodSettings, registerAutomod } from "../src/automod.js";

describe("automod live configuration", () => {
  it("normalizes keyword lists, custom regex rules and anti-raid settings", () => {
    const settings = normalizeAutomodSettings({
      maxMentions: 999,
      scamKeywords: "seed phrase\nprivate key, fake airdrop",
      customRules: [
        {
          id: "Fake Airdrop!",
          label: "Fake Airdrop",
          pattern: "claim\\s+vire",
          flags: "ii?",
          reason: "Unsafe claim CTA"
        },
        {
          id: "broken",
          pattern: "[",
          reason: "Invalid regex"
        }
      ],
      antiRaid: {
        joinWindowSeconds: 2,
        maxJoins: 1,
        alertCooldownMinutes: 0
      }
    });

    expect(settings.maxMentions).toBe(100);
    expect(settings.scamKeywords).toEqual(["seed phrase", "private key", "fake airdrop"]);
    expect(settings.customRules).toEqual([
      {
        id: "fake-airdrop",
        label: "Fake Airdrop",
        pattern: "claim\\s+vire",
        flags: "i",
        reason: "Unsafe claim CTA",
        enabled: true,
        valid: true
      }
    ]);
    expect(settings.antiRaid).toEqual({
      enabled: true,
      joinWindowSeconds: 10,
      maxJoins: 2,
      alertCooldownMinutes: 1
    });
  });

  it("uses live custom rules from settings without redeploy", async () => {
    const store = createStore({
      automod: {
        enabled: true,
        deleteBlockedMessages: true,
        blockDiscordInvites: false,
        blockMassMentions: false,
        blockScamKeywords: false,
        customRules: [
          {
            id: "fake-airdrop",
            label: "Fake Airdrop",
            pattern: "claim\\s+free\\s+vire",
            flags: "i",
            reason: "Fake VIRE airdrop"
          }
        ]
      }
    });
    const handler = registerAutomod({
      store,
      permissions: { hasStaffRoleFromMember: () => false }
    });
    const message = createMessage("Claim free VIRE now");

    await handler(message);

    expect(message.deleted).toBe(true);
    expect(store.items["automod-events"]).toHaveLength(1);
    expect(store.items["automod-events"][0]).toMatchObject({
      reason: "Fake VIRE airdrop",
      matched: "Fake Airdrop"
    });
    expect(store.items["audit-events"][0]).toMatchObject({
      type: "automod",
      source: "automod"
    });
  });
});

function createStore(settings) {
  const items = {};

  return {
    items,
    async getSingleton(_collection, defaults) {
      return { ...defaults, ...settings };
    },
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

function createMessage(content) {
  return {
    content,
    deleted: false,
    deletable: true,
    guildId: "guild-1",
    channelId: "channel-1",
    author: {
      id: "user-1",
      tag: "User#0001",
      bot: false
    },
    member: {
      permissions: { has: () => false }
    },
    mentions: {
      users: { size: 0 },
      roles: { size: 0 }
    },
    guild: {
      id: "guild-1",
      name: "Vireon",
      channels: {
        cache: {
          find: () => null
        }
      }
    },
    async delete() {
      this.deleted = true;
    }
  };
}
