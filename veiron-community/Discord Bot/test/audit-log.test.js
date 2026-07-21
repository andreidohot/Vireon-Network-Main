import { describe, expect, it } from "vitest";
import { ChannelType } from "discord.js";
import {
  AUDIT_EVENTS_COLLECTION,
  filterAuditEvents,
  normalizeAuditEvent,
  searchAuditEvents,
  writeAuditLog
} from "../src/audit-log.js";

describe("audit log persistence", () => {
  it("persists audit events even when #mod-log is missing", async () => {
    const store = createStoreMock();
    const guild = createGuildMock();

    const result = await writeAuditLog(guild, {
      title: "Member Banned",
      description: "Case case-1",
      fields: [{ name: "Reason", value: "scam", inline: false }],
      actorUserId: "mod-1",
      actorTag: "Mod#0001",
      targetUserId: "user-1",
      targetTag: "User#0001",
      relatedId: "case-1"
    }, { store });

    expect(result.message).toBeNull();
    expect(result.event).toMatchObject({
      id: "audit-1",
      guildId: "guild-1",
      type: "ban",
      source: "moderation",
      actorUserId: "mod-1",
      targetUserId: "user-1",
      relatedId: "case-1"
    });
    expect(store.items[AUDIT_EVENTS_COLLECTION]).toHaveLength(1);
  });

  it("posts to #mod-log and stores the same normalized event", async () => {
    const store = createStoreMock();
    const sentMessages = [];
    const guild = createGuildMock({
      channels: [
        {
          type: ChannelType.GuildText,
          name: "mod-log",
          async send(payload) {
            sentMessages.push(payload);
            return { id: "message-1" };
          }
        }
      ]
    });

    const result = await writeAuditLog(guild, {
      title: "Ticket Opened",
      description: "Ticket ticket-1 by User#0001",
      type: "ticket-opened",
      source: "ticket",
      targetUserId: "user-1"
    }, { store });

    expect(result.message).toMatchObject({ id: "message-1" });
    expect(sentMessages).toHaveLength(1);
    expect(result.event).toMatchObject({
      type: "ticket-opened",
      source: "ticket",
      targetUserId: "user-1"
    });
  });

  it("filters persisted audit events by type, source, text, users and dates", async () => {
    const events = [
      createEvent({ id: "old", type: "warn", source: "moderation", title: "Warning Issued", targetUserId: "u1", createdAt: "2026-01-01T00:00:00.000Z" }),
      createEvent({ id: "new", type: "ban", source: "moderation", title: "Member Banned", description: "Scam link", targetUserId: "u2", createdAt: "2026-01-02T00:00:00.000Z" }),
      createEvent({ id: "ticket", type: "ticket-opened", source: "ticket", title: "Ticket Opened", actorUserId: "u3", metadata: { topic: "wallet help" }, createdAt: "2026-01-03T00:00:00.000Z" })
    ];

    expect(filterAuditEvents(events, { source: "moderation" }).map((event) => event.id)).toEqual(["new", "old"]);
    expect(filterAuditEvents(events, { type: "ban" }).map((event) => event.id)).toEqual(["new"]);
    expect(filterAuditEvents(events, { q: "wallet" }).map((event) => event.id)).toEqual(["ticket"]);
    expect(filterAuditEvents(events, { targetUserId: "u2" }).map((event) => event.id)).toEqual(["new"]);
    expect(filterAuditEvents(events, { from: "2026-01-02T00:00:00.000Z", limit: 1 }).map((event) => event.id)).toEqual(["ticket"]);
  });

  it("searches events through the DAL collection", async () => {
    const store = {
      async list(collection) {
        expect(collection).toBe(AUDIT_EVENTS_COLLECTION);
        return [
          createEvent({ id: "1", type: "automod", source: "automod", title: "Automod Action" }),
          createEvent({ id: "2", type: "purge", source: "moderation", title: "Messages Purged" })
        ];
      }
    };

    await expect(searchAuditEvents(store, { source: "automod" })).resolves.toMatchObject([
      { id: "1", source: "automod" }
    ]);
  });

  it("normalizes fields and infers type/source from title", () => {
    expect(normalizeAuditEvent(createGuildMock(), {
      title: "Messages Purged",
      description: "Case case-2",
      fields: [{ name: "Reason", value: "cleanup" }]
    })).toMatchObject({
      type: "purge",
      source: "moderation",
      fields: [{ name: "Reason", value: "cleanup", inline: false }]
    });
  });
});

function createStoreMock() {
  const items = {};

  return {
    items,
    async add(collection, item) {
      const nextItem = {
        id: `audit-${(items[collection]?.length ?? 0) + 1}`,
        createdAt: "2026-01-01T00:00:00.000Z",
        ...item
      };
      items[collection] = [...(items[collection] ?? []), nextItem];
      return nextItem;
    }
  };
}

function createGuildMock({ channels = [] } = {}) {
  return {
    id: "guild-1",
    name: "Vireon",
    channels: {
      cache: {
        find(predicate) {
          return channels.find(predicate);
        }
      }
    }
  };
}

function createEvent(overrides = {}) {
  return {
    id: "event",
    guildId: "guild-1",
    type: "system",
    source: "system",
    title: "Event",
    description: "",
    fields: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}
