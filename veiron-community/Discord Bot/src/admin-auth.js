import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { generateSecret, generateURI, verifySync } from "otplib";
import { childLogger } from "./logger.js";

export const ADMIN_ROLES = ["VIEWER", "MODERATOR", "ADMIN", "SUPER_ADMIN"];

const ROLE_WEIGHT = {
  VIEWER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4
};
const ACCESS_TOKEN_TTL = process.env.ADMIN_JWT_TTL ?? "15m";
const REFRESH_TOKEN_DAYS = Number(process.env.ADMIN_REFRESH_TOKEN_DAYS ?? 14);
const logger = childLogger({ module: "admin-auth" });

export class AdminAuthService {
  constructor({ prisma = null } = {}) {
    this.prisma = prisma;
  }

  async ensureDefaultSuperAdmin() {
    const email = normalizeEmail(process.env.ADMIN_DEFAULT_EMAIL);
    const password = process.env.ADMIN_DEFAULT_PASSWORD;
    const prisma = await this.getPrisma();

    if (!email && !password) {
      const userCount = await prisma.user.count();
      if (userCount === 0) {
        throw new Error("ADMIN_DEFAULT_EMAIL and ADMIN_DEFAULT_PASSWORD are required for the first admin user.");
      }
      return null;
    }
    if (!email || !password) {
      const userCount = await prisma.user.count();
      if (userCount === 0) {
        throw new Error("ADMIN_DEFAULT_EMAIL and ADMIN_DEFAULT_PASSWORD are required for the first admin user.");
      }
      return null;
    }
    if (password.length < 12) {
      throw new Error("ADMIN_DEFAULT_PASSWORD must be at least 12 characters.");
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return existing;

    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email,
        displayName: "Initial Super Admin",
        passwordHash: await hashPassword(password),
        role: "SUPER_ADMIN"
      }
    });

    logger.info({ userId: user.id, email }, "Seeded default SUPER_ADMIN user.");
    return user;
  }

  async login({ email, password, totpCode }) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !password) {
      throw authError("Email and password are required.");
    }

    const prisma = await this.getPrisma();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (!user || user.disabled) {
      throw authError("Invalid email or password.");
    }

    if (isLocked(user)) {
      throw authError("Account is temporarily locked.");
    }

    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      await this.recordFailedLogin(user);
      throw authError("Invalid email or password.");
    }

    if (user.totpEnabled) {
      if (!totpCode) {
        throw authError("TOTP code is required.", "totp_required");
      }

      const secret = decryptTotpSecret(user.totpSecret);
      const totpOk = verifyTotpCode(secret, totpCode);
      if (!totpOk) {
        await this.recordFailedLogin(user);
        throw authError("Invalid TOTP code.");
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });

    return this.issueTokenPair(updated);
  }

  async setupTotp(userId) {
    const prisma = await this.getPrisma();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.disabled) throw authError("Invalid user.");

    const secret = generateSecret();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        totpSecret: encryptTotpSecret(secret),
        totpEnabled: false
      }
    });

    return {
      secret,
      otpauthUrl: generateURI({
        issuer: "VBOS",
        label: user.email,
        secret
      })
    };
  }

  async confirmTotp(userId, code) {
    const prisma = await this.getPrisma();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.totpSecret || user.disabled) throw authError("TOTP setup is not initialized.");

    const secret = decryptTotpSecret(user.totpSecret);
    if (!verifyTotpCode(secret, code)) {
      throw authError("Invalid TOTP code.");
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        totpEnabled: true,
        failedLoginAttempts: 0,
        lockedUntil: null
      }
    });

    return sanitizeUser(updated);
  }

  async disableTotp(userId, code) {
    const prisma = await this.getPrisma();
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.disabled) throw authError("Invalid user.");

    if (user.totpEnabled) {
      const secret = decryptTotpSecret(user.totpSecret);
      if (!verifyTotpCode(secret, code)) {
        throw authError("Invalid TOTP code.");
      }
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: {
        totpEnabled: false,
        totpSecret: null
      }
    });

    return sanitizeUser(updated);
  }

  async recordFailedLogin(user) {
    const prisma = await this.getPrisma();
    const attempts = (user.failedLoginAttempts ?? 0) + 1;
    const lockedUntil = attempts >= getLockoutMaxAttempts()
      ? new Date(Date.now() + getLockoutMinutes() * 60 * 1000)
      : null;

    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: attempts,
        lockedUntil
      }
    });
  }

  async refresh(refreshToken) {
    if (!refreshToken) throw authError("Refresh token is required.");

    const prisma = await this.getPrisma();
    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true }
    });

    if (!stored || stored.revokedAt || stored.expiresAt <= new Date() || stored.user.disabled || isLocked(stored.user)) {
      throw authError("Invalid refresh token.");
    }

    await prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() }
    });

    return this.issueTokenPair(stored.user);
  }

  async logout(refreshToken) {
    if (!refreshToken) return;
    const prisma = await this.getPrisma();
    const tokenHash = hashRefreshToken(refreshToken);
    const stored = await prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (stored && !stored.revokedAt) {
      await prisma.refreshToken.update({
        where: { id: stored.id },
        data: { revokedAt: new Date() }
      });
    }
  }

  async verifyAccessToken(token) {
    if (!token) throw authError("Missing bearer token.");

    let decoded;
    try {
      decoded = jwt.verify(token, getAccessSecret());
    } catch {
      throw authError("Invalid bearer token.");
    }

    const prisma = await this.getPrisma();
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user || user.disabled || isLocked(user)) throw authError("Invalid bearer token.");

    return sanitizeUser(user);
  }

  async issueTokenPair(user) {
    const accessToken = jwt.sign(
      {
        role: user.role,
        email: user.email
      },
      getAccessSecret(),
      {
        subject: user.id,
        expiresIn: ACCESS_TOKEN_TTL
      }
    );
    const refreshToken = crypto.randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000);

    const prisma = await this.getPrisma();
    await prisma.refreshToken.create({
      data: {
        id: crypto.randomUUID(),
        userId: user.id,
        tokenHash: hashRefreshToken(refreshToken),
        expiresAt
      }
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: ACCESS_TOKEN_TTL,
      user: sanitizeUser(user)
    };
  }

  async getPrisma() {
    if (this.prisma) return this.prisma;

    const clientModule = await import("@prisma/client");
    if (!clientModule.PrismaClient) {
      throw new Error("PrismaClient is not generated. Run `npm run prisma:generate` before enabling admin auth.");
    }

    this.prisma = new clientModule.PrismaClient();
    return this.prisma;
  }
}

export function requireRole(minimumRole) {
  return (request, response, next) => {
    const user = request.adminUser;
    if (!user || !roleAtLeast(user.role, minimumRole)) {
      response.status(403).json({ ok: false, error: "Forbidden." });
      return;
    }

    next();
  };
}

export function roleAtLeast(role, minimumRole) {
  return (ROLE_WEIGHT[role] ?? 0) >= (ROLE_WEIGHT[minimumRole] ?? 0);
}

export function createAuthMiddleware(authService) {
  return async (request, response, next) => {
    try {
      const header = request.headers.authorization ?? "";
      const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
      request.adminUser = await authService.verifyAccessToken(token);
      next();
    } catch (error) {
      response.status(401).json({ ok: false, error: error.message, code: error.code });
    }
  };
}

export async function hashPassword(password) {
  return bcrypt.hash(password, 12);
}

export function hashRefreshToken(refreshToken) {
  return crypto.createHash("sha256").update(refreshToken).digest("hex");
}

export function sanitizeUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    totpEnabled: Boolean(user.totpEnabled),
    lockedUntil: user.lockedUntil,
    disabled: user.disabled,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt
  };
}

function getAccessSecret() {
  const secret = process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_JWT_SECRET must be set and at least 32 characters.");
  }
  return secret;
}

function getTotpEncryptionKey() {
  const secret = process.env.ADMIN_TOTP_ENCRYPTION_KEY ?? process.env.ADMIN_JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_TOTP_ENCRYPTION_KEY or ADMIN_JWT_SECRET must be at least 32 characters.");
  }

  return crypto.createHash("sha256").update(secret).digest();
}

function getLockoutMaxAttempts() {
  return positiveNumber(process.env.ADMIN_LOCKOUT_MAX_ATTEMPTS, 5);
}

function getLockoutMinutes() {
  return positiveNumber(process.env.ADMIN_LOCKOUT_MINUTES, 15);
}

function positiveNumber(value, fallback) {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function verifyTotpCode(secret, code) {
  return verifySync({
    secret,
    token: String(code ?? "").trim()
  }).valid;
}

export function encryptTotpSecret(secret) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getTotpEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url")
  ].join(".");
}

export function decryptTotpSecret(value) {
  if (!value) throw new Error("Missing TOTP secret.");
  const [iv, tag, encrypted] = value.split(".");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    getTotpEncryptionKey(),
    Buffer.from(iv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

function isLocked(user) {
  return user.lockedUntil && user.lockedUntil > new Date();
}

function normalizeEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

function authError(message, code = "auth_failed") {
  const error = new Error(message);
  error.statusCode = 401;
  error.code = code;
  return error;
}
