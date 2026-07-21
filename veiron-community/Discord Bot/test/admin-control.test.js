import { describe, expect, it } from "vitest";
import { normalizeChannelPayload, normalizeModerationAction, normalizeRolePayload } from "../src/admin-control.js";

function captureError(fn) {
  try {
    fn();
    return null;
  } catch (error) {
    return error;
  }
}

describe("admin-control payload normalization", () => {
  it("normalizes role creation payloads", () => {
    const role = normalizeRolePayload({
      name: " Vireon Elite ",
      color: "#d4af37",
      hoist: true,
      mentionable: false,
      permissions: "ManageMessages\nModerateMembers\nNotARealPermission"
    }, { create: true });

    expect(role.name).toBe("Vireon Elite");
    expect(role.color).toBe(0xd4af37);
    expect(role.permissions).toEqual(["ManageMessages", "ModerateMembers"]);
    expect(role.hoist).toBe(true);
    expect(role.mentionable).toBe(false);
  });

  it("normalizes channel names and supported types", () => {
    const channel = normalizeChannelPayload({
      name: " Elite Chat ",
      type: "text",
      topic: "A focused community channel"
    }, { create: true });

    expect(channel.name).toBe("elite-chat");
    expect(channel.typeKey).toBe("text");
    expect(channel.topic).toBe("A focused community channel");
  });

  it("rejects unsupported channel types", () => {
    const error = captureError(() => normalizeChannelPayload({ name: "bad", type: "dm" }, { create: true }));
    expect(error?.statusCode).toBe(400);
    expect(error?.message).toContain("Unsupported channel type");
  });

  it("rejects invalid colors", () => {
    const error = captureError(() => normalizeRolePayload({ name: "Role", color: "gold" }, { create: true }));
    expect(error?.statusCode).toBe(400);
    expect(error?.message).toContain("hex color");
  });

  it("normalizes supported moderation actions", () => {
    expect(normalizeModerationAction("TIMEOUT")).toBe("timeout");
    expect(normalizeModerationAction("unban")).toBe("unban");
  });

  it("rejects unsupported moderation actions", () => {
    const error = captureError(() => normalizeModerationAction("nuke"));
    expect(error?.statusCode).toBe(400);
    expect(error?.message).toContain("Unsupported moderation action");
  });
});
