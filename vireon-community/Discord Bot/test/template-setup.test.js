import { describe, expect, it } from "vitest";
import {
  SETUP_TEMPLATE_PRESETS,
  describeSetupPlan,
  getSetupChannelTemplate,
  getSetupRoleTemplate,
  getSetupSeedMessages,
  normalizeSetupTemplateId
} from "../src/template.js";

describe("setup template presets", () => {
  it("normalizes unknown template ids to ultimate", () => {
    expect(normalizeSetupTemplateId("starter")).toBe("starter");
    expect(normalizeSetupTemplateId("missing-template")).toBe("ultimate");
    expect(SETUP_TEMPLATE_PRESETS.map((preset) => preset.id)).toContain("gaming");
  });

  it("builds smaller starter channel templates", () => {
    const starter = getSetupChannelTemplate("starter");
    const ultimate = getSetupChannelTemplate("ultimate");

    expect(starter.length).toBeGreaterThan(0);
    expect(starter.length).toBeLessThan(ultimate.length);
    expect(starter.map((category) => category.name)).toContain("START HERE");
    expect(starter.map((category) => category.name)).not.toContain("VIREON DEVELOPMENT");
  });

  it("adds optional rank roles only when requested", () => {
    const baseRoles = getSetupRoleTemplate({ includeRankRoles: false });
    const withRankRoles = getSetupRoleTemplate({ includeRankRoles: true });

    expect(withRankRoles.length).toBeGreaterThan(baseRoles.length);
    expect(withRankRoles.some((role) => role.name === "Level 1000")).toBe(true);
  });

  it("describes a setup preview without mutating the server", () => {
    const plan = describeSetupPlan({ templateId: "starter", includeRankRoles: true });
    const channels = getSetupChannelTemplate("starter");
    const seedMessages = getSetupSeedMessages(channels);

    expect(plan.id).toBe("starter");
    expect(plan.rankRoles).toBeGreaterThan(0);
    expect(Object.keys(seedMessages)).toContain("welcome");
  });
});
