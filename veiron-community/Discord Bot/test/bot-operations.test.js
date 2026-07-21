import { Collection } from "discord.js";
import { describe, expect, it } from "vitest";
import {
  MESSAGE_APPROVALS_COLLECTION,
  MESSAGE_PUSHES_COLLECTION,
  MESSAGE_TEMPLATES_COLLECTION,
  deleteMessageTemplate,
  listMessageApprovals,
  listMessageTemplates,
  previewMessagePayload,
  requestMessageApproval,
  reviewMessageApproval,
  runBotConsoleCommand,
  saveMessageTemplate,
  sendMessagePush
} from "../src/bot-operations.js";
import { createOrUpdateCustomInteraction } from "../src/custom-controls.js";

class MemoryStore {
  constructor() {
    this.collections = new Map();
  }

  async list(collection) {
    return [...(this.collections.get(collection) ?? [])];
  }

  async add(collection, item) {
    const next = {
      id: item.id ?? `${collection}-${(this.collections.get(collection)?.length ?? 0) + 1}`,
      createdAt: item.createdAt ?? new Date("2026-01-01T00:00:00.000Z").toISOString(),
      ...item
    };
    this.collections.set(collection, [...(this.collections.get(collection) ?? []), next]);
    return next;
  }

  async update(collection, predicate, updater) {
    let updated = null;
    const next = (this.collections.get(collection) ?? []).map((item) => {
      if (!predicate(item)) return item;
      updated = { ...item, ...updater(item), updatedAt: new Date("2026-01-01T00:01:00.000Z").toISOString() };
      return updated;
    });
    this.collections.set(collection, next);
    return updated;
  }
}

function createFakeClient() {
  const channels = new Collection();
  channels.set("channel-1", {
    id: "channel-1",
    guildId: "guild-1",
    name: "announcements",
    type: 0,
    parentId: null,
    rawPosition: 1,
    isTextBased: () => true,
    send: async () => ({ id: "message-1" })
  });

  const roles = new Collection();
  roles.set("role-1", { id: "role-1", name: "Admin", position: 1, managed: false });

  const members = new Collection();
  members.set("user-1", { id: "user-1", displayName: "Andrei", user: { tag: "andrei#0001", username: "andrei" } });

  const guild = {
    id: "guild-1",
    name: "Vireon Test Guild",
    memberCount: 1,
    ownerId: "owner-1",
    channels: { cache: channels, fetch: async () => channels },
    roles: { cache: roles, fetch: async () => roles },
    members: {
      cache: members,
      fetch: async () => members,
      search: async () => members
    }
  };

  return {
    user: { id: "bot-1", tag: "Vireon#0001" },
    ws: { ping: 12 },
    uptime: 1234,
    isReady: () => true,
    guilds: { fetch: async () => guild },
    channels: { fetch: async (id) => channels.get(id) ?? null }
  };
}

describe("bot operations studio", () => {
  it("previews embed payloads with fields and link buttons", async () => {
    const result = await previewMessagePayload({
      payload: {
        mode: "embed",
        title: "Vireon Update",
        description: "A focused update.",
        fieldsText: "Status :: Online :: inline",
        linkButtonLabel: "Open panel",
        linkButtonUrl: "https://panel.example.com"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.preview.mode).toBe("embed");
    expect(result.preview.embed.fields[0]).toMatchObject({ name: "Status", value: "Online", inline: true });
    expect(result.preview.buttons[0].url).toBe("https://panel.example.com");
  });

  it("saves and soft-deletes message templates", async () => {
    const store = new MemoryStore();
    const saved = await saveMessageTemplate({
      store,
      actor: { id: "admin-1", email: "admin@example.com" },
      payload: { name: "Launch", mode: "plain", content: "Hello Vireon" }
    });

    expect(saved.template.name).toBe("Launch");
    expect((await listMessageTemplates({ store })).items).toHaveLength(1);

    await deleteMessageTemplate({ store, templateId: saved.template.id, actor: { id: "admin-1" } });
    expect((await listMessageTemplates({ store })).items).toHaveLength(0);
    expect(await store.list(MESSAGE_TEMPLATES_COLLECTION)).toHaveLength(1);
  });

  it("schedules channel message pushes without sending immediately", async () => {
    const store = new MemoryStore();
    const result = await sendMessagePush({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      actor: { id: "mod-1", email: "mod@example.com" },
      payload: {
        name: "Scheduled Update",
        channelIds: ["channel-1"],
        mode: "plain",
        content: "Scheduled hello",
        sendNow: false,
        scheduleAt: "2099-01-01T00:00:00.000Z"
      }
    });

    expect(result.scheduled).toBe(true);
    const pushes = await store.list(MESSAGE_PUSHES_COLLECTION);
    expect(pushes[0].status).toBe("scheduled");
    expect(pushes[0].sent).toBe(0);
  });


  it("attaches Custom Lab button interactions to channel pushes", async () => {
    const store = new MemoryStore();
    const interaction = await createOrUpdateCustomInteraction({
      store,
      guildId: "guild-1",
      actor: { id: "admin-1", email: "admin@example.com" },
      payload: { label: "Open Rules", style: "success", mode: "plain", content: "Rules opened" }
    });

    const result = await sendMessagePush({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      actor: { id: "admin-1", email: "admin@example.com" },
      payload: {
        name: "Custom Button Push",
        channelIds: ["channel-1"],
        mode: "plain",
        content: "Click the button",
        customInteractionIds: interaction.interaction.customId
      }
    });

    expect(result.ok).toBe(true);
    const pushes = await store.list(MESSAGE_PUSHES_COLLECTION);
    expect(pushes[0].customButtons[0]).toMatchObject({ label: "Open Rules", style: "success" });
  });

  it("keeps console commands allowlisted", async () => {
    const store = new MemoryStore();
    const result = await runBotConsoleCommand({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      actor: { id: "mod-1", email: "mod@example.com" },
      command: "rm -rf /"
    });

    expect(result.ok).toBe(true);
    expect(result.output[0].value).toContain("Unknown or blocked command");
  });

  it("creates approval requests without sending immediately", async () => {
    const store = new MemoryStore();
    const result = await requestMessageApproval({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      actor: { id: "mod-1", email: "mod@example.com", role: "MODERATOR" },
      payload: {
        name: "Staff Update",
        channelIds: ["channel-1"],
        mode: "plain",
        content: "Needs admin approval",
        reason: "Prepared by moderator"
      }
    });

    expect(result.ok).toBe(true);
    expect(result.approval.status).toBe("pending");
    expect((await store.list(MESSAGE_APPROVALS_COLLECTION))).toHaveLength(1);
    expect((await store.list(MESSAGE_PUSHES_COLLECTION))).toHaveLength(0);
  });

  it("lets admins approve pending messages and creates a channel push", async () => {
    const store = new MemoryStore();
    const requested = await requestMessageApproval({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      actor: { id: "mod-1", email: "mod@example.com", role: "MODERATOR" },
      payload: {
        name: "Approved Update",
        channelIds: ["channel-1"],
        mode: "plain",
        content: "Approved message",
        reason: "Ready for publish"
      }
    });

    const reviewed = await reviewMessageApproval({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      approvalId: requested.approval.id,
      actor: { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
      payload: { action: "approve", note: "Looks good" }
    });

    expect(reviewed.ok).toBe(true);
    expect(reviewed.approval.status).toBe("approved_sent");
    expect(reviewed.approval.pushId).toBeTruthy();
    const pushes = await store.list(MESSAGE_PUSHES_COLLECTION);
    expect(pushes[0].source).toBe("approval-queue");
    expect(pushes[0].relatedApprovalId).toBe(requested.approval.id);
  });

  it("rejects approvals without creating a push", async () => {
    const store = new MemoryStore();
    const requested = await requestMessageApproval({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      actor: { id: "mod-1", email: "mod@example.com", role: "MODERATOR" },
      payload: { name: "Rejected Update", channelIds: ["channel-1"], mode: "plain", content: "Nope" }
    });

    const rejected = await reviewMessageApproval({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      approvalId: requested.approval.id,
      actor: { id: "admin-1", email: "admin@example.com", role: "ADMIN" },
      payload: { action: "reject", note: "Needs rewrite" }
    });

    expect(rejected.approval.status).toBe("rejected");
    expect(rejected.approval.reviewNote).toBe("Needs rewrite");
    expect((await store.list(MESSAGE_PUSHES_COLLECTION))).toHaveLength(0);
  });

  it("blocks moderators from reviewing approvals", async () => {
    const store = new MemoryStore();
    const requested = await requestMessageApproval({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      actor: { id: "mod-1", email: "mod@example.com", role: "MODERATOR" },
      payload: { name: "Blocked Review", channelIds: ["channel-1"], mode: "plain", content: "Needs admin" }
    });

    await expect(reviewMessageApproval({
      client: createFakeClient(),
      guildId: "guild-1",
      store,
      approvalId: requested.approval.id,
      actor: { id: "mod-2", email: "second-mod@example.com", role: "MODERATOR" },
      payload: { action: "approve" }
    })).rejects.toThrow("Only ADMIN");

    expect((await listMessageApprovals({ store, includeClosed: false })).items[0].status).toBe("pending");
  });

});
