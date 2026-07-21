import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/storage.js";
import {
  calculateLevel,
  calculateXpForLevel,
  getLevelProgress,
  normalizeRoleRewards,
  normalizeXpSettings,
  trackMessageXp,
  trackVoiceStateXp
} from "../src/xp-leveling.js";

describe("XP leveling", () => {
  it("tracks message XP with a per-user cooldown", async () => {
    const store = await createXpStore({
      messageXp: 10,
      messageCooldownSeconds: 60,
      levelBaseXp: 100
    });
    const message = createMessage({ guildId: "guild-message", userId: "user-message" });

    const first = await trackMessageXp({
      store,
      message,
      now: () => new Date("2026-01-01T00:00:00.000Z")
    });
    const skipped = await trackMessageXp({
      store,
      message,
      now: () => new Date("2026-01-01T00:00:30.000Z")
    });
    const second = await trackMessageXp({
      store,
      message,
      now: () => new Date("2026-01-01T00:01:01.000Z")
    });

    expect(first.awardedXp).toBe(10);
    expect(skipped).toMatchObject({ awardedXp: 0, cooldownSkipped: true });
    expect(second.awardedXp).toBe(10);
    expect(second.profile).toMatchObject({
      xp: 20,
      messageXp: 20,
      messageCount: 3,
      awardedMessageCount: 2,
      cooldownSkippedMessages: 1
    });
  });

  it("tracks voice time and awards XP after the minimum session length", async () => {
    const store = await createXpStore({
      voiceXpPerMinute: 5,
      minVoiceSessionSeconds: 60,
      levelBaseXp: 100
    });
    const joinedAt = new Date("2026-01-01T10:00:00.000Z");
    const leftAt = new Date("2026-01-01T10:02:05.000Z");

    await trackVoiceStateXp({
      store,
      oldState: createVoiceState({ guildId: "guild-voice", userId: "user-voice", channelId: null }),
      newState: createVoiceState({ guildId: "guild-voice", userId: "user-voice", channelId: "voice-1" }),
      now: () => joinedAt
    });

    const result = await trackVoiceStateXp({
      store,
      oldState: createVoiceState({ guildId: "guild-voice", userId: "user-voice", channelId: "voice-1" }),
      newState: createVoiceState({ guildId: "guild-voice", userId: "user-voice", channelId: null }),
      now: () => leftAt
    });

    expect(result).toMatchObject({
      awardedXp: 10,
      voiceSeconds: 125
    });
    expect(result.profile).toMatchObject({
      xp: 10,
      voiceXp: 10,
      voiceSeconds: 125,
      activeVoiceChannelId: null,
      activeVoiceJoinedAt: null
    });
  });

  it("supports configurable linear, quadratic and exponential level curves", () => {
    expect(calculateXpForLevel(4, { levelCurve: "linear", levelBaseXp: 100 })).toBe(400);
    expect(calculateLevel(450, { levelCurve: "linear", levelBaseXp: 100 })).toBe(4);

    expect(calculateXpForLevel(4, { levelCurve: "quadratic", levelBaseXp: 100 })).toBe(1600);
    expect(calculateLevel(1599, { levelCurve: "quadratic", levelBaseXp: 100 })).toBe(3);

    expect(calculateXpForLevel(3, {
      levelCurve: "exponential",
      levelBaseXp: 100,
      levelGrowthFactor: 2
    })).toBe(700);
    expect(calculateLevel(700, {
      levelCurve: "exponential",
      levelBaseXp: 100,
      levelGrowthFactor: 2
    })).toBe(3);
  });

  it("normalizes unsafe XP settings and reports level progress", () => {
    const settings = normalizeXpSettings({
      messageXp: -5,
      levelCurve: "unknown",
      levelBaseXp: 0,
      levelGrowthFactor: 99,
      maxLevel: 0
    });
    const progress = getLevelProgress(250, {
      levelCurve: "linear",
      levelBaseXp: 100,
      maxLevel: 10
    });

    expect(settings).toMatchObject({
      messageXp: 0,
      levelCurve: "quadratic",
      levelBaseXp: 1,
      levelGrowthFactor: 10,
      maxLevel: 1
    });
    expect(progress).toMatchObject({
      level: 2,
      currentLevelXp: 200,
      nextLevelXp: 300,
      xpIntoLevel: 50,
      xpNeededForNextLevel: 50,
      percentToNextLevel: 50
    });
  });

  it("normalizes level role rewards", () => {
    const rewards = normalizeRoleRewards([
      { level: 10, roleId: "role-10", roleName: "Level 10" },
      { level: 0, roleId: "ignored" },
      { level: 5, roleId: "role-5", roleName: "Level 5" },
      { level: 5, roleId: "role-5", roleName: "Duplicate" },
      { level: 2, roleId: "" }
    ]);

    expect(rewards).toEqual([
      { level: 5, roleId: "role-5", roleName: "Level 5" },
      { level: 10, roleId: "role-10", roleName: "Level 10" }
    ]);
  });
});

async function createXpStore(xpSettings) {
  const store = new JsonStore({ dataDir: await tempDataDir() });
  await store.setSingleton("settings", {
    xp: {
      enabled: true,
      messageXp: 15,
      messageCooldownSeconds: 60,
      voiceXpPerMinute: 5,
      minVoiceSessionSeconds: 60,
      levelCurve: "quadratic",
      levelBaseXp: 100,
      levelGrowthFactor: 1.35,
      maxLevel: 1000,
      ...xpSettings
    }
  });
  return store;
}

async function tempDataDir() {
  return mkdtemp(path.join(os.tmpdir(), "vireon-xp-test-"));
}

function createMessage({ guildId, userId }) {
  return {
    guildId,
    author: {
      id: userId,
      tag: `${userId}#0001`,
      bot: false
    }
  };
}

function createVoiceState({ guildId, userId, channelId }) {
  return {
    id: userId,
    guild: { id: guildId },
    channelId,
    member: {
      user: {
        id: userId,
        tag: `${userId}#0001`,
        bot: false
      }
    }
  };
}
