import { describe, expect, it } from "vitest";
import { buildCommandCenterOverview, COMMAND_CATEGORIES } from "../src/command-center.js";
import { MODULE_CENTER_COLLECTION } from "../src/module-center.js";

class MemoryStore {
  constructor(seed = {}) {
    this.collections = new Map(Object.entries(seed));
  }

  async list(collection) {
    return [...(this.collections.get(collection) ?? [])];
  }

  async add(collection, item) {
    const next = {
      id: item.id ?? `${collection}-${(this.collections.get(collection)?.length ?? 0) + 1}`,
      createdAt: item.createdAt ?? "2026-01-01T00:00:00.000Z",
      ...item
    };
    this.collections.set(collection, [...(this.collections.get(collection) ?? []), next]);
    return next;
  }

  async update(collection, predicate, updater) {
    let updated = null;
    const next = (this.collections.get(collection) ?? []).map((item) => {
      if (!predicate(item)) return item;
      updated = { ...item, ...updater(item), updatedAt: "2026-01-01T00:01:00.000Z" };
      return updated;
    });
    this.collections.set(collection, next);
    return updated;
  }
}

describe("Command Center", () => {
  it("builds a complete command surface overview", async () => {
    const store = new MemoryStore({
      "custom-commands": [{ id: "cmd-1", guildId: "guild-1", name: "rules", enabled: true }],
      "custom-interactions": [{ id: "btn-1", guildId: "guild-1", label: "Start", enabled: true }],
      "automation-flows": [{ id: "flow-1", guildId: "guild-1", name: "Welcome", enabled: true, actions: [] }],
      "admin-message-templates": [{ id: "tpl-1", name: "Welcome", mode: "embed" }],
      "admin-message-approvals": [{ id: "apr-1", status: "pending", name: "Launch" }],
      "audit-events": [{ id: "audit-1", title: "Created role", type: "role", createdAt: "2026-01-01T00:00:00.000Z" }],
      [MODULE_CENTER_COLLECTION]: [{ id: "music", guildId: "guild-1", enabled: false }]
    });

    const overview = await buildCommandCenterOverview({ store, guildId: "guild-1" });

    expect(overview.ok).toBe(true);
    expect(overview.brand.name).toBe("VBOS");
    expect(overview.categories.length).toBe(COMMAND_CATEGORIES.length);
    expect(overview.stats.slashCommands).toBeGreaterThan(20);
    expect(overview.stats.customCommands).toBe(1);
    expect(overview.stats.customInteractions).toBe(1);
    expect(overview.stats.automationFlows).toBe(1);
    expect(overview.stats.pendingApprovals).toBe(1);
    expect(overview.capabilities.shellExecution).toBe(false);
    expect(overview.capabilities.javascriptEval).toBe(false);
    expect(overview.slashCommands.some((item) => item.command === "/vbos")).toBe(true);
    expect(overview.slashCommands.some((item) => item.command === "/channel-control")).toBe(true);
  });
});
