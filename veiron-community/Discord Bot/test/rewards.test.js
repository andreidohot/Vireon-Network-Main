import { describe, expect, it } from "vitest";
import {
  buildRewardsDescription,
  formatAddress,
  formatRewardAmount,
  getWalletLinkForUser,
  normalizeWalletLink,
  WALLET_LINKS_COLLECTION
} from "../src/rewards.js";

describe("Vireon rewards command helpers", () => {
  it("finds the latest active wallet link for a Discord user", async () => {
    const store = createMemoryStore([
      {
        guildId: "guild-1",
        userId: "user-1",
        address: "vire_old",
        status: "verified",
        verifiedAt: "2026-01-01T00:00:00.000Z"
      },
      {
        guildId: "guild-1",
        userId: "user-1",
        address: "vire_new",
        status: "linked",
        verifiedAt: "2026-01-02T00:00:00.000Z"
      },
      {
        guildId: "guild-1",
        userId: "user-1",
        address: "vire_revoked",
        status: "revoked",
        verifiedAt: "2026-01-03T00:00:00.000Z"
      }
    ]);

    await expect(getWalletLinkForUser(store, {
      guildId: "guild-1",
      userId: "user-1"
    })).resolves.toMatchObject({
      address: "vire_new",
      status: "linked"
    });
  });

  it("normalizes wallet link aliases for the future Phase 6 wallet module", () => {
    expect(normalizeWalletLink({
      guildId: 123,
      userId: 456,
      walletAddress: "  vire_wallet  "
    })).toMatchObject({
      guildId: "123",
      userId: "456",
      address: "vire_wallet",
      status: "verified"
    });
  });

  it("formats reward values and wallet addresses for embeds", () => {
    expect(formatRewardAmount(12.3456789123, "VIRE")).toBe("12.34567891 VIRE");
    expect(formatRewardAmount(null, "VIRE")).toBe("Unavailable");
    expect(formatAddress("vire_1234567890abcdef1234567890")).toBe("`vire_123456...1234567890`");
  });

  it("marks mock rewards as simulated in the command description", () => {
    expect(buildRewardsDescription({
      rewards: { ok: true, mock: true },
      walletLink: { userId: "user-1" },
      target: { id: "user-1" }
    })).toContain("simulated");
  });
});

function createMemoryStore(links) {
  return {
    async list(collection) {
      if (collection === WALLET_LINKS_COLLECTION) return links;
      return [];
    }
  };
}
