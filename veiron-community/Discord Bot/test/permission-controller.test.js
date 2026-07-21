import { PermissionFlagsBits } from "discord.js";
import { describe, expect, it } from "vitest";
import { normalizePermissionPolicies, PermissionController } from "../src/permission-controller.js";
import { ROLE_NAMES } from "../src/template.js";

describe("PermissionController", () => {
  it("allows explicit setup users to run setup", () => {
    const permissions = new PermissionController({ setupAllowedUserIds: ["user-1"] });

    expect(permissions.canRunSetup(createInteraction({ userId: "user-1" }))).toBe(true);
    expect(permissions.canRunSetup(createInteraction({ userId: "user-2" }))).toBe(false);
  });

  it("allows administrators to run setup and manage the bot", () => {
    const permissions = new PermissionController();
    const interaction = createInteraction({
      permissions: [PermissionFlagsBits.Administrator]
    });

    expect(permissions.canRunSetup(interaction)).toBe(true);
    expect(permissions.canManageCommunityBot(interaction)).toBe(true);
  });

  it("allows staff roles and ManageGuild to manage VBOS", () => {
    const permissions = new PermissionController();

    expect(permissions.canManageCommunityBot(createInteraction({
      roles: [ROLE_NAMES.coreTeam]
    }))).toBe(true);
    expect(permissions.canManageCommunityBot(createInteraction({
      permissions: [PermissionFlagsBits.ManageGuild]
    }))).toBe(true);
  });

  it("rejects members without staff role or manage permissions", () => {
    const permissions = new PermissionController();

    expect(permissions.canManageCommunityBot(createInteraction({
      roles: ["Vireon Member"]
    }))).toBe(false);
  });

  it("supports configurable manager role IDs and policy toggles", () => {
    const permissions = new PermissionController({
      policies: {
        allowAdministrator: false,
        allowManageGuild: false,
        setupAllowedUserIds: ["123"],
        managerRoleIds: ["555"],
        managerRoleNames: ["Council"]
      }
    });

    expect(permissions.canRunSetup(createInteraction({
      userId: "123"
    }))).toBe(true);
    expect(permissions.canRunSetup(createInteraction({
      permissions: [PermissionFlagsBits.Administrator]
    }))).toBe(false);
    expect(permissions.canManageCommunityBot(createInteraction({
      roleObjects: [{ id: "555", name: "Renamed Role" }]
    }))).toBe(true);
    expect(permissions.canManageCommunityBot(createInteraction({
      roles: ["Council"]
    }))).toBe(true);
    expect(permissions.canManageCommunityBot(createInteraction({
      permissions: [PermissionFlagsBits.ManageGuild]
    }))).toBe(false);
  });

  it("normalizes permission policies for dashboard storage", () => {
    expect(normalizePermissionPolicies({
      setupAllowedUserIds: "123\nabc456",
      managerRoleIds: ["777", "role-888"],
      managerRoleNames: "Core Team, Admin"
    })).toEqual({
      allowAdministrator: true,
      allowManageGuild: true,
      setupAllowedUserIds: ["123", "456"],
      managerRoleIds: ["777", "888"],
      managerRoleNames: ["Core Team", "Admin"]
    });
  });
});

function createInteraction({ userId = "user", permissions = [], roles = [], roleObjects = null } = {}) {
  return {
    user: { id: userId },
    memberPermissions: {
      has(permission) {
        return permissions.includes(permission);
      }
    },
    member: {
      roles: {
        cache: {
          some(predicate) {
            return (roleObjects ?? roles.map((name) => ({ name }))).some(predicate);
          }
        }
      }
    }
  };
}
