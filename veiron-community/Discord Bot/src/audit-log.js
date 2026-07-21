import { ChannelType } from "discord.js";
import { createVireonEmbed } from "./embed-factory.js";
import { childLogger, serializeError } from "./logger.js";

export const AUDIT_EVENTS_COLLECTION = "audit-events";

const logger = childLogger({ module: "audit-log" });

export async function writeAuditLog(guild, {
  title,
  description,
  fields = [],
  color = 0xf2994a,
  type = null,
  source = null,
  actorUserId = null,
  actorTag = null,
  targetUserId = null,
  targetTag = null,
  channelId = null,
  relatedId = null,
  metadata = {}
}, { store = null } = {}) {
  const auditEvent = normalizeAuditEvent(guild, {
    title,
    description,
    fields,
    color,
    type,
    source,
    actorUserId,
    actorTag,
    targetUserId,
    targetTag,
    channelId,
    relatedId,
    metadata
  });
  const persistedEvent = await persistAuditEvent(store, auditEvent);
  const channel = guild.channels.cache.find(
    (item) => item.type === ChannelType.GuildText && item.name === "mod-log"
  );

  if (!channel) {
    return { event: persistedEvent, message: null };
  }

  const message = await channel.send({
    embeds: [
      createVireonEmbed({
        title,
        description,
        fields,
        color,
        footer: "VBOS"
      })
    ]
  });

  return { event: persistedEvent, message };
}

export async function persistAuditEvent(store, event) {
  if (!store) return null;

  try {
    return await store.add(AUDIT_EVENTS_COLLECTION, event);
  } catch (error) {
    logger.error({ error: serializeError(error), event }, "Failed to persist audit event.");
    throw error;
  }
}

export async function searchAuditEvents(store, filters = {}) {
  const events = await store.list(AUDIT_EVENTS_COLLECTION);
  return filterAuditEvents(events, filters);
}

export function filterAuditEvents(events = [], filters = {}) {
  const normalized = normalizeAuditFilters(filters);

  return events
    .filter((event) => matchesAuditFilters(event, normalized))
    .sort((left, right) => Date.parse(right.createdAt ?? 0) - Date.parse(left.createdAt ?? 0))
    .slice(0, normalized.limit);
}

export function normalizeAuditEvent(guild, event) {
  const fields = normalizeAuditFields(event.fields);
  const title = String(event.title ?? "Audit Event").trim() || "Audit Event";
  const description = String(event.description ?? "").trim();
  const type = normalizeToken(event.type) || inferAuditType(title);

  return {
    guildId: guild?.id ?? event.guildId ?? null,
    guildName: guild?.name ?? event.guildName ?? null,
    type,
    source: normalizeToken(event.source) || inferAuditSource(type),
    title,
    description,
    color: Number(event.color ?? 0xf2994a),
    fields,
    actorUserId: event.actorUserId ?? null,
    actorTag: event.actorTag ?? null,
    targetUserId: event.targetUserId ?? null,
    targetTag: event.targetTag ?? null,
    channelId: event.channelId ?? null,
    relatedId: event.relatedId ?? null,
    metadata: event.metadata && typeof event.metadata === "object" ? event.metadata : {}
  };
}

function normalizeAuditFilters(filters) {
  const limit = Math.max(1, Math.min(Number.parseInt(filters.limit ?? "100", 10) || 100, 500));

  return {
    q: String(filters.q ?? "").trim().toLowerCase(),
    type: normalizeToken(filters.type),
    source: normalizeToken(filters.source),
    guildId: String(filters.guildId ?? "").trim(),
    actorUserId: String(filters.actorUserId ?? "").trim(),
    targetUserId: String(filters.targetUserId ?? "").trim(),
    channelId: String(filters.channelId ?? "").trim(),
    from: parseOptionalDate(filters.from),
    to: parseOptionalDate(filters.to),
    limit
  };
}

function matchesAuditFilters(event, filters) {
  if (filters.type && normalizeToken(event.type) !== filters.type) return false;
  if (filters.source && normalizeToken(event.source) !== filters.source) return false;
  if (filters.guildId && event.guildId !== filters.guildId) return false;
  if (filters.actorUserId && event.actorUserId !== filters.actorUserId) return false;
  if (filters.targetUserId && event.targetUserId !== filters.targetUserId) return false;
  if (filters.channelId && event.channelId !== filters.channelId) return false;

  const createdAt = Date.parse(event.createdAt ?? 0);
  if (filters.from && createdAt < filters.from.getTime()) return false;
  if (filters.to && createdAt > filters.to.getTime()) return false;
  if (filters.q && !auditSearchText(event).includes(filters.q)) return false;

  return true;
}

function auditSearchText(event) {
  return [
    event.id,
    event.type,
    event.source,
    event.title,
    event.description,
    event.actorUserId,
    event.actorTag,
    event.targetUserId,
    event.targetTag,
    event.channelId,
    event.relatedId,
    ...(Array.isArray(event.fields) ? event.fields.flatMap((field) => [field.name, field.value]) : []),
    JSON.stringify(event.metadata ?? {})
  ].filter(Boolean).join(" ").toLowerCase();
}

function normalizeAuditFields(fields) {
  if (!Array.isArray(fields)) return [];

  return fields
    .map((field) => ({
      name: String(field?.name ?? "").slice(0, 256),
      value: String(field?.value ?? "").slice(0, 1024),
      inline: Boolean(field?.inline)
    }))
    .filter((field) => field.name && field.value);
}

function normalizeToken(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function inferAuditType(title) {
  const normalized = normalizeToken(title);
  if (normalized.includes("automod")) return "automod";
  if (normalized.includes("anti-spam")) return "anti-spam";
  if (normalized.includes("ticket")) return "ticket";
  if (normalized.includes("announcement")) return "announcement";
  if (normalized.includes("proposal")) return "proposal";
  if (normalized.includes("warn")) return "warn";
  if (normalized.includes("muted")) return "mute";
  if (normalized.includes("unmuted")) return "unmute";
  if (normalized.includes("kicked")) return "kick";
  if (normalized.includes("banned")) return "ban";
  if (normalized.includes("purged")) return "purge";
  return "system";
}

function inferAuditSource(type) {
  if (["warn", "mute", "unmute", "kick", "ban", "purge"].includes(type)) return "moderation";
  if (["automod", "anti-spam", "ticket", "announcement", "proposal"].includes(type)) return type;
  return "system";
}

function parseOptionalDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
