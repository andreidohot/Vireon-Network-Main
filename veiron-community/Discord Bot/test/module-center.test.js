import { describe, expect, it } from "vitest";
import {
  MODULE_CENTER_COLLECTION,
  MODULE_CENTER_EVENTS_COLLECTION,
  buildModuleCenterOverview,
  exportModuleBundle,
  importModuleBundle,
  setModuleState
} from "../src/module-center.js";

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

describe("Module Center", () => {
  it("builds a module marketplace overview", async () => {
    const store = new MemoryStore();
    const overview = await buildModuleCenterOverview({ store, guildId: "guild-1" });

    expect(overview.ok).toBe(true);
    expect(overview.modules.length).toBeGreaterThan(10);
    expect(overview.modules.some((module) => module.id === "automations")).toBe(true);
    expect(overview.capabilities.shellExecution).toBe(false);
    expect(overview.capabilities.importDryRun).toBe(true);
  });

  it("toggles module state and protects locked core modules", async () => {
    const store = new MemoryStore();
    const disabled = await setModuleState({
      store,
      guildId: "guild-1",
      moduleId: "music",
      actor: actor(),
      payload: { enabled: false, reason: "Music is not deployed yet." }
    });

    expect(disabled.module.enabled).toBe(false);
    expect((await store.list(MODULE_CENTER_COLLECTION))).toHaveLength(1);
    expect((await store.list(MODULE_CENTER_EVENTS_COLLECTION))).toHaveLength(1);

    await expect(setModuleState({
      store,
      guildId: "guild-1",
      moduleId: "control",
      actor: actor(),
      payload: { enabled: false }
    })).rejects.toThrow(/locked/);
  });

  it("exports and imports module bundles with dry-run first", async () => {
    const store = new MemoryStore();
    await store.add("custom-commands", { guildId: "guild-1", name: "rules", response: { mode: "plain", content: "Read rules" } });
    await store.add("automation-flows", { guildId: "guild-1", name: "GPU helper", enabled: true });

    const exported = await exportModuleBundle({
      store,
      guildId: "guild-1",
      actor: actor(),
      payload: { moduleIds: ["custom", "automations"] }
    });

    expect(exported.bundle.summary["custom-commands"]).toBe(1);
    expect(exported.bundle.summary["automation-flows"]).toBe(1);

    const preview = await importModuleBundle({
      store: new MemoryStore(),
      guildId: "guild-2",
      actor: actor(),
      payload: { bundle: exported.bundle, dryRun: true }
    });
    expect(preview.dryRun).toBe(true);
    expect(preview.imported).toBe(0);
    expect(preview.plan.find((item) => item.collection === "custom-commands")?.items).toBe(1);

    const target = new MemoryStore();
    const applied = await importModuleBundle({
      store: target,
      guildId: "guild-2",
      actor: actor(),
      payload: { bundle: JSON.stringify(exported.bundle), dryRun: false }
    });
    expect(applied.imported).toBe(2);
    expect((await target.list("custom-commands"))[0].guildId).toBe("guild-2");
  });
});
