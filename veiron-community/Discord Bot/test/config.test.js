import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, getSettings, updateSettings } from "../src/config.js";

function createMemoryStore(initial = null) {
  let value = initial;

  return {
    async getSingleton(_collection, defaults) {
      return { ...defaults, ...(value ?? {}) };
    },
    async setSingleton(_collection, nextValue) {
      value = nextValue;
      return value;
    }
  };
}

describe("config", () => {
  it("returns default settings when no stored singleton exists", async () => {
    const settings = await getSettings(createMemoryStore());

    expect(settings.automod.enabled).toBe(true);
    expect(settings.automod.customRules).toEqual([]);
    expect(settings.automod.antiRaid).toMatchObject({
      enabled: true,
      joinWindowSeconds: 60,
      maxJoins: 8,
      alertCooldownMinutes: 5
    });
    expect(settings.antiSpam.maxMessages).toBe(DEFAULT_SETTINGS.antiSpam.maxMessages);
    expect(settings.community.memberRoleName).toBe("Vireon Member");
    expect(settings.permissions.allowAdministrator).toBe(true);
  });

  it("deep merges patches without dropping nested defaults", async () => {
    const store = createMemoryStore();

    const settings = await updateSettings(store, {
      automod: {
        enabled: false
      },
      community: {
        welcomeEnabled: false
      }
    });

    expect(settings.automod.enabled).toBe(false);
    expect(settings.automod.blockDiscordInvites).toBe(true);
    expect(settings.community.welcomeEnabled).toBe(false);
    expect(settings.community.goodbyeEnabled).toBe(true);
  });

  it("ignores non-object patches", async () => {
    const store = createMemoryStore();

    const settings = await updateSettings(store, null);

    expect(settings.automod.enabled).toBe(true);
    expect(settings.proposals.votingEnabled).toBe(true);
  });
});
