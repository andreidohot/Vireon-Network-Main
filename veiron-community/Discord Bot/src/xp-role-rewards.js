import { getSettings } from "./config.js";
import { normalizeXpSettings } from "./xp-leveling.js";

export function getEligibleRoleRewards(roleRewards = [], level = 0) {
  const currentLevel = Math.max(0, Math.floor(Number(level) || 0));
  return roleRewards.filter((reward) => reward.level <= currentLevel);
}

export async function applyXpRoleRewards({
  store,
  member,
  profile,
  previousLevel = 0,
  reason = "Vireon XP level reward."
}) {
  if (!store || !member || !profile) {
    return { applied: [], skipped: [] };
  }

  const settings = await getSettings(store);
  const xpSettings = normalizeXpSettings(settings.xp);
  const rewards = getEligibleRoleRewards(xpSettings.roleRewards, profile.level);
  const applied = [];
  const skipped = [];

  for (const reward of rewards) {
    if (hasMemberRole(member, reward.roleId)) {
      skipped.push({ ...reward, reason: "already_assigned" });
      continue;
    }

    const role = await findGuildRole(member.guild, reward.roleId);
    if (!role) {
      skipped.push({ ...reward, reason: "missing_role" });
      continue;
    }

    await member.roles.add(role, reason);
    applied.push({
      level: reward.level,
      roleId: role.id,
      roleName: role.name ?? reward.roleName
    });
  }

  return { applied, skipped };
}

function hasMemberRole(member, roleId) {
  if (typeof member.roles?.cache?.has === "function") {
    return member.roles.cache.has(roleId);
  }
  return false;
}

async function findGuildRole(guild, roleId) {
  const cached = guild?.roles?.cache?.get?.(roleId);
  if (cached) return cached;

  if (typeof guild?.roles?.fetch !== "function") return null;
  return guild.roles.fetch(roleId).catch(() => null);
}
