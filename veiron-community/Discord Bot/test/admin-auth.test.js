import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateSecret, generateSync } from "otplib";
import {
  AdminAuthService,
  encryptTotpSecret,
  hashPassword,
  roleAtLeast
} from "../src/admin-auth.js";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  process.env.ADMIN_JWT_SECRET = "x".repeat(40);
  process.env.ADMIN_TOTP_ENCRYPTION_KEY = "y".repeat(40);
  process.env.ADMIN_REFRESH_TOKEN_DAYS = "7";
  process.env.ADMIN_LOCKOUT_MAX_ATTEMPTS = "2";
  process.env.ADMIN_LOCKOUT_MINUTES = "15";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("admin auth", () => {
  it("orders admin roles by privilege", () => {
    expect(roleAtLeast("SUPER_ADMIN", "ADMIN")).toBe(true);
    expect(roleAtLeast("ADMIN", "VIEWER")).toBe(true);
    expect(roleAtLeast("VIEWER", "MODERATOR")).toBe(false);
  });

  it("logs in with bcrypt hash and rotates refresh token", async () => {
    const prisma = createAuthPrismaMock();
    const user = await prisma.user.create({
      data: {
        id: "user-1",
        email: "admin@vireon.local",
        displayName: "Admin",
        passwordHash: await hashPassword("strong-password"),
        role: "SUPER_ADMIN"
      }
    });
    const service = new AdminAuthService({ prisma });

    const firstPair = await service.login({
      email: "ADMIN@VIREON.LOCAL",
      password: "strong-password"
    });
    const secondPair = await service.refresh(firstPair.refreshToken);

    expect(firstPair.user).toMatchObject({ id: user.id, role: "SUPER_ADMIN" });
    expect(firstPair.accessToken).toEqual(expect.any(String));
    expect(secondPair.refreshToken).not.toBe(firstPair.refreshToken);
    await expect(service.refresh(firstPair.refreshToken)).rejects.toThrow("Invalid refresh token.");
  });

  it("seeds first SUPER_ADMIN from environment", async () => {
    process.env.ADMIN_DEFAULT_EMAIL = "root@vireon.local";
    process.env.ADMIN_DEFAULT_PASSWORD = "very-strong-password";
    const prisma = createAuthPrismaMock();
    const service = new AdminAuthService({ prisma });

    const user = await service.ensureDefaultSuperAdmin();

    expect(user).toMatchObject({
      email: "root@vireon.local",
      role: "SUPER_ADMIN"
    });
    expect(await prisma.user.count()).toBe(1);
  });

  it("requires and validates TOTP when 2FA is enabled", async () => {
    const prisma = createAuthPrismaMock();
    const secret = generateSecret();
    await prisma.user.create({
      data: {
        id: "user-2",
        email: "secure@vireon.local",
        displayName: "Secure Admin",
        passwordHash: await hashPassword("strong-password"),
        role: "ADMIN",
        totpEnabled: true,
        totpSecret: encryptTotpSecret(secret)
      }
    });
    const service = new AdminAuthService({ prisma });

    await expect(service.login({
      email: "secure@vireon.local",
      password: "strong-password"
    })).rejects.toMatchObject({ code: "totp_required" });

    await expect(service.login({
      email: "secure@vireon.local",
      password: "strong-password",
      totpCode: "000000"
    })).rejects.toThrow("Invalid TOTP code.");

    const pair = await service.login({
      email: "secure@vireon.local",
      password: "strong-password",
      totpCode: generateSync({ secret })
    });

    expect(pair.user).toMatchObject({
      email: "secure@vireon.local",
      totpEnabled: true,
      lockedUntil: null
    });
  });

  it("locks an account after repeated failed login attempts", async () => {
    const prisma = createAuthPrismaMock();
    await prisma.user.create({
      data: {
        id: "user-3",
        email: "locked@vireon.local",
        displayName: "Locked Admin",
        passwordHash: await hashPassword("strong-password"),
        role: "ADMIN"
      }
    });
    const service = new AdminAuthService({ prisma });

    await expect(service.login({
      email: "locked@vireon.local",
      password: "bad-password"
    })).rejects.toThrow("Invalid email or password.");
    await expect(service.login({
      email: "locked@vireon.local",
      password: "bad-password"
    })).rejects.toThrow("Invalid email or password.");

    const lockedUser = await prisma.user.findUnique({ where: { email: "locked@vireon.local" } });
    expect(lockedUser.failedLoginAttempts).toBe(2);
    expect(lockedUser.lockedUntil).toBeInstanceOf(Date);
    await expect(service.login({
      email: "locked@vireon.local",
      password: "strong-password"
    })).rejects.toThrow("Account is temporarily locked.");
  });
});

function createAuthPrismaMock() {
  const users = new Map();
  const refreshTokens = new Map();

  return {
    user: {
      async count() {
        return users.size;
      },
      async create({ data }) {
        const now = new Date();
        const user = {
          disabled: false,
          totpEnabled: false,
          totpSecret: null,
          failedLoginAttempts: 0,
          lockedUntil: null,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: null,
          ...data
        };
        users.set(user.id, user);
        return user;
      },
      async findUnique({ where }) {
        if (where.id) return users.get(where.id) ?? null;
        return [...users.values()].find((user) => user.email === where.email) ?? null;
      },
      async update({ where, data }) {
        const user = users.get(where.id);
        const next = { ...user, ...data, updatedAt: new Date() };
        users.set(where.id, next);
        return next;
      }
    },
    refreshToken: {
      async create({ data }) {
        const token = { revokedAt: null, createdAt: new Date(), ...data };
        refreshTokens.set(token.id, token);
        return token;
      },
      async findUnique({ where, include }) {
        const token = [...refreshTokens.values()].find((item) => item.tokenHash === where.tokenHash) ?? null;
        if (!token || !include?.user) return token;
        return { ...token, user: users.get(token.userId) };
      },
      async update({ where, data }) {
        const token = refreshTokens.get(where.id);
        const next = { ...token, ...data };
        refreshTokens.set(where.id, next);
        return next;
      }
    }
  };
}
