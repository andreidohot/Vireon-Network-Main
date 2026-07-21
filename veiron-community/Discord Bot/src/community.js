import { ChannelType } from "discord.js";
import { writeAuditLog } from "./audit-log.js";
import { normalizeAutomodSettings } from "./automod.js";
import { createVireonEmbed } from "./embed-factory.js";
import { getSettings } from "./config.js";
import { sendPushNotification } from "./push-notifications.js";

const AUTOMOD_COLLECTION = "automod-events";

export function registerCommunityEvents({ store }) {
  const raidTracker = new Map();

  return {
    async handleMemberJoin(member) {
      const settings = await getSettings(store);
      await handleAntiRaidJoin({ member, store, settings, raidTracker });

      if (!settings.community?.welcomeEnabled) return;

      if (settings.community.autoAssignMemberRole) {
        const role = member.guild.roles.cache.find((item) => item.name === settings.community.memberRoleName);
        if (role) await member.roles.add(role, "Vireon auto member role").catch(() => null);
      }

      const channel = findTextChannel(member.guild, settings.community.welcomeChannelName);
      if (!channel) return;

      await channel.send({
        content: `<@${member.id}>`,
        embeds: [
          createVireonEmbed({
            title: "Welcome to Vireon Network",
            description: [
              "Welcome to the Vireon community.",
              "",
              "Start with #rules, #faq and #roles. Vireon is currently in draft/prototype development, so avoid treating planned features as live."
            ].join("\n"),
            color: 0xd4af37
          })
        ]
      });
    },

    async handleMemberLeave(member) {
      const settings = await getSettings(store);
      if (!settings.community?.goodbyeEnabled) return;

      const channel = findTextChannel(member.guild, settings.community.goodbyeChannelName);
      if (!channel) return;

      await channel.send({
        embeds: [
          createVireonEmbed({
            title: "Member Left",
            description: `${member.user?.tag ?? "A member"} left the server.`,
            color: 0x828282
          })
        ]
      });
    }
  };
}

export async function handleAntiRaidJoin({ member, store, settings, raidTracker, now = Date.now() }) {
  const automodSettings = normalizeAutomodSettings(settings.automod);
  const antiRaid = automodSettings.antiRaid;
  if (!automodSettings.enabled || !antiRaid.enabled) return null;

  const key = member.guild.id;
  const windowMs = antiRaid.joinWindowSeconds * 1000;
  const current = raidTracker.get(key) ?? { joins: [], lastAlertAt: 0 };
  const joins = current.joins.filter((timestamp) => now - timestamp <= windowMs);
  joins.push(now);

  const nextState = { ...current, joins };
  raidTracker.set(key, nextState);

  if (joins.length < antiRaid.maxJoins) return null;

  const cooldownMs = antiRaid.alertCooldownMinutes * 60 * 1000;
  if (current.lastAlertAt && now - current.lastAlertAt < cooldownMs) return null;

  nextState.lastAlertAt = now;

  const event = await store.add(AUTOMOD_COLLECTION, {
    guildId: member.guild.id,
    userId: member.id,
    userTag: member.user?.tag ?? member.id,
    reason: "Anti-raid join-rate alert",
    matched: `${joins.length} joins in ${antiRaid.joinWindowSeconds}s`,
    joinCount: joins.length,
    joinWindowSeconds: antiRaid.joinWindowSeconds,
    threshold: antiRaid.maxJoins,
    alertCooldownMinutes: antiRaid.alertCooldownMinutes
  });

  await writeAuditLog(member.guild, {
    title: "Anti-Raid Alert",
    description: `Event ${event.id}: ${joins.length} joins in ${antiRaid.joinWindowSeconds}s`,
    fields: [
      { name: "Latest Member", value: member.user?.tag ?? member.id, inline: true },
      { name: "Join Count", value: String(joins.length), inline: true },
      { name: "Window", value: `${antiRaid.joinWindowSeconds}s`, inline: true }
    ],
    color: 0xeb5757,
    type: "anti-raid",
    source: "automod",
    targetUserId: member.id,
    targetTag: member.user?.tag ?? member.id,
    relatedId: event.id,
    metadata: {
      joinCount: joins.length,
      joinWindowSeconds: antiRaid.joinWindowSeconds,
      threshold: antiRaid.maxJoins
    }
  }, { store });

  await sendPushNotification(store, {
    title: "Critical Anti-Raid Alert",
    body: `${joins.length} joins in ${antiRaid.joinWindowSeconds}s on ${member.guild.name}.`,
    url: "/admin/#automod"
  }, { roles: ["MODERATOR", "ADMIN", "SUPER_ADMIN"] });

  return event;
}

function findTextChannel(guild, name) {
  return guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildText && channel.name === name
  );
}
