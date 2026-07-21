import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore } from "../src/storage.js";
import { applyXpRoleRewards, getEligibleRoleRewards } from "../src/xp-role-rewards.js";

describe("XP role rewards", () => {
  it("returns rewards eligible for the current level", () => {
    expect(getEligibleRoleRewards([
      { level: 5, roleId: "role-5" },
      { level: 10, roleId: "role-10" }
    ], 7)).toEqual([
      { level: 5, roleId: "role-5" }
    ]);
  });

  it("assigns missing reward roles and skips roles already assigned", async () => {
    const store = await createStoreWithRewards([
      { level: 5, roleId: "role-5", roleName: "Level 5" },
      { level: 10, roleId: "role-10", roleName: "Level 10" }
    ]);
    const member = createMember([
      { id: "role-5", name: "Level 5" },
      { id: "role-10", name: "Level 10" }
    ]);

    const first = await applyXpRoleRewards({
      store,
      member,
      profile: { level: 6 },
      previousLevel: 4
    });
    const second = await applyXpRoleRewards({
      store,
      member,
      profile: { level: 6 },
      previousLevel: 4
    });

    expect(first.applied).toEqual([
      { level: 5, roleId: "role-5", roleName: "Level 5" }
    ]);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual([
      { level: 5, roleId: "role-5", roleName: "Level 5", reason: "already_assigned" }
    ]);
  });
});

async function createStoreWithRewards(roleRewards) {
  const store = new JsonStore({ dataDir: await mkdtemp(path.join(os.tmpdir(), "vireon-role-rewards-test-")) });
  await store.setSingleton("settings", {
    xp: {
      enabled: true,
      roleRewards
    }
  });
  return store;
}

function createMember(roles) {
  const guildRoles = new Map(roles.map((role) => [role.id, role]));
  const memberRoles = new Map();

  return {
    guild: {
      roles: {
        cache: guildRoles,
        fetch: async (roleId) => guildRoles.get(roleId) ?? null
      }
    },
    roles: {
      cache: memberRoles,
      add: async (role) => {
        memberRoles.set(role.id, role);
      }
    }
  };
}
