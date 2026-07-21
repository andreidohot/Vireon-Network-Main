import { DEFAULT_PERMISSION_POLICIES } from "./permission-controller.js";

export const DEFAULT_SETTINGS = {
  automod: {
    enabled: true,
    deleteBlockedMessages: true,
    blockDiscordInvites: true,
    blockMassMentions: true,
    maxMentions: 6,
    blockScamKeywords: true,
    scamKeywords: [
      "airdrop",
      "free mint",
      "claim reward",
      "seed phrase",
      "private key",
      "guaranteed profit",
      "guaranteed returns",
      "investment opportunity",
      "double your",
      "wallet verification"
    ],
    customRules: [],
    antiRaid: {
      enabled: true,
      joinWindowSeconds: 60,
      maxJoins: 8,
      alertCooldownMinutes: 5
    }
  },
  antiSpam: {
    enabled: true,
    windowSeconds: 10,
    maxMessages: 7,
    timeoutMinutes: 10
  },
  announcements: {
    defaultChannelName: "announcements",
    requireStatusLabel: true,
    schedulerIntervalSeconds: 30
  },
  proposals: {
    defaultChannelName: "proposals",
    votingEnabled: true
  },
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
    roleRewards: []
  },
  economy: {
    enabled: true,
    currencyName: "Shards",
    currencySymbol: "SHD",
    transferEnabled: true,
    minTransferAmount: 1,
    maxTransferAmount: 10000,
    starterBalance: 0,
    dailyAmount: 100,
    dailyCooldownHours: 24,
    workMinAmount: 15,
    workMaxAmount: 75,
    workCooldownMinutes: 60,
    shopEnabled: true,
    shopItems: [],
    showNotVireDisclaimer: true
  },
  moderation: {
    auditChannelName: "mod-log"
  },
  community: {
    welcomeChannelName: "welcome",
    goodbyeChannelName: "general",
    memberRoleName: "Vireon Member",
    welcomeEnabled: true,
    goodbyeEnabled: true,
    autoAssignMemberRole: false
  },
  permissions: DEFAULT_PERMISSION_POLICIES
};

export async function getSettings(store) {
  return store.getSingleton("settings", DEFAULT_SETTINGS);
}

export async function updateSettings(store, patch) {
  const current = await getSettings(store);
  const next = deepMerge(current, patch);
  return store.setSingleton("settings", next);
}

function deepMerge(target, patch) {
  if (!isPlainObject(patch)) return target;

  const result = { ...target };

  for (const [key, value] of Object.entries(patch)) {
    if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = deepMerge(result[key], value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
