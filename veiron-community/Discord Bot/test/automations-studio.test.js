import { describe, expect, it } from "vitest";
import {
  AUTOMATION_EVENTS_COLLECTION,
  AUTOMATION_FLOWS_COLLECTION,
  buildAutomationStudioOverview,
  createOrUpdateAutomationFlow,
  deleteAutomationFlowFromWeb,
  matchesAutomationTrigger,
  previewAutomationFlow,
  registerAutomationRuntime,
  testAutomationFlow
} from "../src/automations-studio.js";

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

function createFlowPayload(overrides = {}) {
  return {
    name: "GPU helper",
    description: "Reply when members ask about GPU mining.",
    enabled: true,
    trigger: { type: "message_contains", value: "gpu" },
    cooldownSeconds: 0,
    actions: [
      {
        type: "send_channel_message",
        config: {
          message: { mode: "plain", content: "Hello {username}, GPU docs are in {channel}." }
        }
      },
      { type: "react_message", config: { emoji: "✅" } },
      { type: "log_event", config: { note: "GPU helper triggered by {username}" } }
    ],
    ...overrides
  };
}

describe("Automation Studio", () => {
  it("previews and saves automation flows from Admin Web", async () => {
    const store = new MemoryStore();
    const preview = await previewAutomationFlow({ store, guildId: "guild-1", actor: actor(), payload: createFlowPayload() });

    expect(preview.ok).toBe(true);
    expect(preview.dryRun).toBe(true);
    expect(preview.plan.actions).toHaveLength(3);

    const saved = await createOrUpdateAutomationFlow({ store, guildId: "guild-1", actor: actor(), payload: createFlowPayload() });
    expect(saved.flow.name).toBe("GPU helper");
    expect(saved.plan.trigger).toContain("gpu");
    expect((await store.list(AUTOMATION_FLOWS_COLLECTION))).toHaveLength(1);

    const overview = await buildAutomationStudioOverview({ store, guildId: "guild-1" });
    expect(overview.stats.activeFlows).toBe(1);
    expect(overview.capabilities.shellExecution).toBe(false);
  });

  it("matches message triggers and runs runtime actions", async () => {
    const store = new MemoryStore();
    await createOrUpdateAutomationFlow({ store, guildId: "guild-1", actor: actor(), payload: createFlowPayload() });

    let sent = null;
    let reaction = null;
    const runtime = registerAutomationRuntime({ store });
    const result = await runtime.handleMessage({
      id: "message-1",
      guildId: "guild-1",
      content: "Can I mine with GPU?",
      author: { id: "user-1", username: "andrei", tag: "andrei#0001", bot: false },
      member: { id: "user-1", user: { id: "user-1", username: "andrei" }, roles: { add: async () => null, remove: async () => null } },
      guild: { id: "guild-1", name: "VBOS Test" },
      channel: { id: "channel-1", send: async (payload) => { sent = payload; return { id: "sent-1" }; } },
      react: async (emoji) => { reaction = emoji; }
    });

    expect(result.matched).toBe(1);
    expect(result.executed).toBe(1);
    expect(sent.content).toContain("andrei");
    expect(reaction).toBe("✅");
    expect((await store.list(AUTOMATION_EVENTS_COLLECTION)).some((event) => event.type === "automation.flow.run")).toBe(true);
    expect((await store.list(AUTOMATION_FLOWS_COLLECTION))[0].runCount).toBe(1);
  });

  it("supports member join flows and admin dry-run tests", async () => {
    const store = new MemoryStore();
    await createOrUpdateAutomationFlow({
      store,
      guildId: "guild-1",
      actor: actor(),
      payload: createFlowPayload({
        name: "Welcome role",
        trigger: { type: "member_join" },
        actions: [{ type: "add_role", config: { roleId: "role-1" } }]
      })
    });

    let addedRole = null;
    const runtime = registerAutomationRuntime({ store });
    const result = await runtime.handleMemberJoin({
      id: "user-1",
      guild: { id: "guild-1", name: "VBOS Test" },
      user: { id: "user-1", username: "andrei", bot: false },
      roles: { add: async (roleId) => { addedRole = roleId; } }
    });

    expect(result.executed).toBe(1);
    expect(addedRole).toBe("role-1");

    const dryRun = await testAutomationFlow({
      store,
      guildId: "guild-1",
      actor: actor(),
      payload: createFlowPayload({ trigger: { type: "manual_test" }, dryRun: true })
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.result.status).toBe("dry_run");
  });

  it("soft deletes flows and validates regex triggers", async () => {
    const store = new MemoryStore();
    const saved = await createOrUpdateAutomationFlow({ store, guildId: "guild-1", actor: actor(), payload: createFlowPayload() });
    await deleteAutomationFlowFromWeb({ store, guildId: "guild-1", flowId: saved.flow.id, actor: actor() });
    const overview = await buildAutomationStudioOverview({ store, guildId: "guild-1" });
    expect(overview.flows).toHaveLength(0);

    expect(matchesAutomationTrigger(
      { trigger: { type: "message_regex", value: "gpu|cuda" } },
      { eventType: "message", text: "CUDA mining" }
    )).toBe(true);
  });
});
