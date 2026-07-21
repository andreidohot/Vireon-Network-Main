import { writeAuditLog } from "./audit-log.js";
import { getSettings } from "./config.js";

const SPAM_EVENTS_COLLECTION = "spam-events";

export function registerAntiSpam({ store, permissions }) {
  const buckets = new Map();

  return async function handleAntiSpam(message) {
    if (!message.guild || message.author.bot) return;
    if (permissions.hasStaffRoleFromMember(message.member)) return;

    const settings = await getSettings(store);
    if (!settings.antiSpam?.enabled) return;

    const now = Date.now();
    const windowMs = Math.max(1, settings.antiSpam.windowSeconds ?? 10) * 1000;
    const maxMessages = Math.max(2, settings.antiSpam.maxMessages ?? 7);
    const key = `${message.guildId}:${message.author.id}`;
    const recent = (buckets.get(key) ?? []).filter((timestamp) => now - timestamp <= windowMs);
    recent.push(now);
    buckets.set(key, recent);

    if (recent.length <= maxMessages) return;

    const timeoutMinutes = Math.max(1, settings.antiSpam.timeoutMinutes ?? 10);

    if (message.member?.moderatable) {
      await message.member.timeout(timeoutMinutes * 60 * 1000, "Vireon anti-spam rate limit").catch(() => null);
    }

    const event = await store.add(SPAM_EVENTS_COLLECTION, {
      guildId: message.guildId,
      channelId: message.channelId,
      userId: message.author.id,
      userTag: message.author.tag,
      messagesInWindow: recent.length,
      windowSeconds: settings.antiSpam.windowSeconds,
      timeoutMinutes
    });

    await writeAuditLog(message.guild, {
      title: "Anti-Spam Action",
      description: `Event ${event.id}`,
      fields: [
        { name: "User", value: message.author.tag, inline: true },
        { name: "Messages", value: String(recent.length), inline: true },
        { name: "Window", value: `${settings.antiSpam.windowSeconds}s`, inline: true }
      ],
      color: 0xeb5757,
      type: "anti-spam",
      source: "anti-spam",
      targetUserId: message.author.id,
      targetTag: message.author.tag,
      channelId: message.channelId,
      relatedId: event.id,
      metadata: {
        messagesInWindow: recent.length,
        windowSeconds: settings.antiSpam.windowSeconds,
        timeoutMinutes
      }
    }, { store });

    buckets.set(key, []);
  };
}
