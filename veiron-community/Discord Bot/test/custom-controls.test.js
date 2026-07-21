import { describe, expect, it } from "vitest";
import {
  CUSTOM_COMMANDS_COLLECTION,
  CUSTOM_CONTROL_EVENTS_COLLECTION,
  CUSTOM_INTERACTIONS_COLLECTION,
  createOrUpdateCustomCommand,
  createOrUpdateCustomInteraction,
  deleteCustomCommandFromWeb,
  deleteCustomInteractionFromWeb,
  listCustomCommands,
  listCustomInteractions,
  registerCustomCommandRuntime,
  registerCustomInteractionRuntime
} from "../src/custom-controls.js";

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

function actor() {
  return { id: "admin-1", email: "admin@example.com" };
}

describe("custom controls", () => {
  it("creates, lists and soft-deletes custom commands from Admin Web", async () => {
    const store = new MemoryStore();
    const saved = await createOrUpdateCustomCommand({
      store,
      guildId: "guild-1",
      actor: actor(),
      payload: {
        name: " Rules ",
        prefix: "!",
        aliases: "reguli rules-info",
        mode: "plain",
        content: "Hello {user}, rules input: {input}"
      }
    });

    expect(saved.command.name).toBe("rules");
    expect(saved.command.aliases).toContain("reguli");
    expect((await listCustomCommands({ store, guildId: "guild-1" })).items).toHaveLength(1);

    await deleteCustomCommandFromWeb({ store, guildId: "guild-1", commandId: saved.command.id, actor: actor() });
    expect((await listCustomCommands({ store, guildId: "guild-1" })).items).toHaveLength(0);
    expect(await store.list(CUSTOM_COMMANDS_COLLECTION)).toHaveLength(1);
  });

  it("runs prefix custom commands and records usage", async () => {
    const store = new MemoryStore();
    await createOrUpdateCustomCommand({
      store,
      guildId: "guild-1",
      actor: actor(),
      payload: { name: "rules", prefix: "!", mode: "plain", content: "Read this {user}: {input}" }
    });

    let sent = null;
    const handler = registerCustomCommandRuntime({ store });
    const handled = await handler({
      guildId: "guild-1",
      content: "!rules now",
      author: { id: "user-1", bot: false, username: "andrei", tag: "andrei#0001" },
      guild: { name: "Vireon Test" },
      channel: { name: "general", send: async (payload) => { sent = payload; } }
    });

    expect(handled).toBe(true);
    expect(sent.content).toContain("<@user-1>");
    expect(sent.content).toContain("now");
    expect((await store.list(CUSTOM_COMMANDS_COLLECTION))[0].uses).toBe(1);
  });

  it("creates custom button interactions and handles interaction runtime", async () => {
    const store = new MemoryStore();
    const saved = await createOrUpdateCustomInteraction({
      store,
      guildId: "guild-1",
      actor: actor(),
      payload: {
        label: "Open Rules",
        style: "success",
        mode: "plain",
        content: "Rules for {username}"
      }
    });

    expect((await listCustomInteractions({ store, guildId: "guild-1" })).items).toHaveLength(1);

    let replyPayload = null;
    const handler = registerCustomInteractionRuntime({ store });
    const handled = await handler({
      isButton: () => true,
      customId: saved.interaction.customId,
      guildId: "guild-1",
      user: { id: "user-1", username: "andrei", tag: "andrei#0001" },
      guild: { name: "Vireon Test" },
      channel: { name: "rules" },
      reply: async (payload) => { replyPayload = payload; }
    });

    expect(handled).toBe(true);
    expect(replyPayload.content).toContain("andrei");
    expect((await store.list(CUSTOM_INTERACTIONS_COLLECTION))[0].uses).toBe(1);

    await deleteCustomInteractionFromWeb({ store, guildId: "guild-1", interactionId: saved.interaction.id, actor: actor() });
    expect((await listCustomInteractions({ store, guildId: "guild-1" })).items).toHaveLength(0);
    expect((await store.list(CUSTOM_CONTROL_EVENTS_COLLECTION)).length).toBeGreaterThanOrEqual(3);
  });
});
