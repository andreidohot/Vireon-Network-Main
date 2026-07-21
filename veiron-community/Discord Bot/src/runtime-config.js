import crypto from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { childLogger } from "./logger.js";

const logger = childLogger({ module: "runtime-config" });
const DEFAULT_DATA_DIR = path.resolve(process.cwd(), "data");
const CONFIG_VERSION = 1;

const RUNTIME_ENV_KEYS = Object.freeze([
  "DISCORD_TOKEN",
  "DISCORD_CLIENT_ID",
  "DISCORD_GUILD_ID",
  "SETUP_ALLOWED_USER_IDS",
  "PUBLIC_BASE_URL",
  "ADMIN_PANEL_ENABLED",
  "ADMIN_PANEL_HOST",
  "ADMIN_PANEL_PORT",
  "ADMIN_JWT_SECRET",
  "ADMIN_TOTP_ENCRYPTION_KEY",
  "ADMIN_DEFAULT_EMAIL",
  "ADMIN_DEFAULT_PASSWORD",
  "ADMIN_TRUST_PROXY",
  "ADMIN_FORCE_HTTPS",
  "ADMIN_PANEL_BIND",
  "ADMIN_JSON_LIMIT",
  "ADMIN_CSP_ENABLED",
  "STORAGE_DRIVER",
  "DATABASE_PROVIDER",
  "DATABASE_URL",
  "DATABASE_URL_LEDGER",
  "LEDGER_STORAGE_DRIVER",
  "LEDGER_DATA_DIR",
  "PAYMENT_LINK_SECRET",
  "WALLET_HD_MASTER_SEED_HEX",
  "VIREON_CHAIN_MODE",
  "ONCHAIN_SYNC_ENABLED",
  "MUSIC_ENABLED",
  "LAVALINK_HOST",
  "LAVALINK_PORT",
  "LAVALINK_PASSWORD",
  "LAVALINK_SECURE"
]);

export function getRuntimeDataDir(env = process.env) {
  return path.resolve(env.BOT_DATA_DIR ?? env.RUNTIME_CONFIG_DIR ?? DEFAULT_DATA_DIR);
}

export function getRuntimeConfigPath(env = process.env) {
  return path.resolve(env.RUNTIME_CONFIG_PATH ?? path.join(getRuntimeDataDir(env), "runtime-config.json"));
}

export function getSetupStatePath(env = process.env) {
  return path.resolve(env.SETUP_WIZARD_STATE_PATH ?? path.join(getRuntimeDataDir(env), "setup-wizard.json"));
}

export function getSetupTokenPath(env = process.env) {
  return path.resolve(env.SETUP_WIZARD_TOKEN_PATH ?? path.join(getRuntimeDataDir(env), "setup-token.txt"));
}

export async function loadRuntimeConfigIntoEnv({ env = process.env, override = false } = {}) {
  const config = await readJsonIfExists(getRuntimeConfigPath(env));
  const values = config?.env ?? {};
  let loaded = 0;

  for (const key of RUNTIME_ENV_KEYS) {
    const value = values[key];
    if (value === undefined || value === null || value === "") continue;
    if (!override && env[key]) continue;
    env[key] = String(value);
    loaded += 1;
  }

  if (loaded > 0) {
    logger.info({ loaded, path: getRuntimeConfigPath(env) }, "Loaded runtime config into environment.");
  }

  return { ok: true, loaded, config };
}

export async function getSetupWizardStatus({ env = process.env } = {}) {
  if (env.SETUP_WIZARD_ENABLED === "false") {
    return { ok: true, required: false, completed: true, disabledByEnv: true };
  }

  const runtimeConfig = await readJsonIfExists(getRuntimeConfigPath(env));
  const completed = Boolean(runtimeConfig?.setup?.completedAt);
  if (completed) {
    return {
      ok: true,
      required: false,
      completed: true,
      completedAt: runtimeConfig.setup.completedAt,
      configPath: getRuntimeConfigPath(env)
    };
  }

  const tokenInfo = await ensureSetupToken({ env });
  const missing = getMissingRuntimeRequirements(env);
  return {
    ok: true,
    required: true,
    completed: false,
    setupTokenRequired: true,
    setupTokenHint: `Setup token is stored on the server at ${tokenInfo.path}. It is removed after finalize.`,
    generatedAt: tokenInfo.generatedAt,
    configPath: getRuntimeConfigPath(env),
    databaseDefault: "postgresql",
    missing
  };
}

export async function finalizeSetupWizard({ payload = {}, env = process.env } = {}) {
  const status = await getSetupWizardStatus({ env });
  if (!status.required) {
    const error = new Error("Setup wizard is already completed or disabled.");
    error.statusCode = 409;
    throw error;
  }

  await assertSetupToken(payload.setupToken, { env });
  const normalized = normalizeSetupPayload(payload, env);

  const runtimeConfig = {
    version: CONFIG_VERSION,
    setup: {
      completedAt: new Date().toISOString(),
      completedBy: normalized.admin.email,
      wizardRemoved: true
    },
    env: normalized.env
  };

  const configPath = getRuntimeConfigPath(env);
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, `${JSON.stringify(runtimeConfig, null, 2)}\n`, "utf8");
  await chmodSafe(configPath, 0o600);
  await cleanupSetupWizard({ env });
  await loadRuntimeConfigIntoEnv({ env, override: true });

  logger.info({ configPath, databaseProvider: normalized.env.DATABASE_PROVIDER }, "Setup wizard finalized.");

  return {
    ok: true,
    completed: true,
    restartRequired: env.SETUP_WIZARD_RESTART_ON_FINISH !== "false",
    configPath,
    database: {
      provider: normalized.env.DATABASE_PROVIDER,
      driver: normalized.env.STORAGE_DRIVER,
      ledgerDriver: normalized.env.LEDGER_STORAGE_DRIVER
    },
    admin: {
      email: normalized.admin.email,
      role: "SUPER_ADMIN"
    },
    wizardRemoved: true
  };
}

export async function cleanupSetupWizard({ env = process.env } = {}) {
  await rm(getSetupTokenPath(env), { force: true }).catch(() => null);
  const statePath = getSetupStatePath(env);
  const state = await readJsonIfExists(statePath);
  await writeJson(statePath, {
    ...(state ?? {}),
    completedAt: new Date().toISOString(),
    tokenRemoved: true,
    active: false
  });
}

export function getMissingRuntimeRequirements(env = process.env) {
  const required = [
    "DISCORD_TOKEN",
    "DISCORD_CLIENT_ID",
    "DISCORD_GUILD_ID",
    "ADMIN_JWT_SECRET",
    "ADMIN_DEFAULT_EMAIL",
    "ADMIN_DEFAULT_PASSWORD",
    "DATABASE_URL"
  ];
  return required.filter((key) => !env[key]);
}

export function hasDiscordRuntimeConfig(env = process.env) {
  return Boolean(env.DISCORD_TOKEN && env.DISCORD_GUILD_ID && env.DISCORD_CLIENT_ID);
}

export function getSetupWizardPublicConfig() {
  return {
    databaseProviders: [
      {
        id: "postgresql",
        label: "PostgreSQL / Prisma",
        recommended: true,
        description: "Recommended for production Discord bot data: users, audit logs, XP, economy, tickets and admin auth."
      },
      {
        id: "sqlite",
        label: "SQLite / Prisma",
        recommended: false,
        description: "Local testing only. Easier, but not the serious production profile."
      }
    ],
    defaultProvider: "postgresql"
  };
}

async function ensureSetupToken({ env = process.env } = {}) {
  const tokenPath = getSetupTokenPath(env);
  const statePath = getSetupStatePath(env);
  let token = await readTextIfExists(tokenPath);
  const generatedAt = new Date().toISOString();

  if (!token) {
    token = `vireon-setup-${crypto.randomBytes(24).toString("base64url")}`;
    await mkdir(path.dirname(tokenPath), { recursive: true });
    await writeFile(tokenPath, `${token}\n`, "utf8");
    await chmodSafe(tokenPath, 0o600);
    logger.warn({ tokenPath }, "Setup wizard is active. Read this local file to unlock first-run setup.");
  }

  await writeJson(statePath, {
    active: true,
    generatedAt,
    tokenPath,
    configPath: getRuntimeConfigPath(env)
  });

  return { path: tokenPath, generatedAt };
}

async function assertSetupToken(value, { env = process.env } = {}) {
  const expected = (await readTextIfExists(getSetupTokenPath(env)))?.trim();
  const received = String(value ?? "").trim();
  if (!expected || !received || !constantTimeEqual(expected, received)) {
    const error = new Error("Invalid setup token.");
    error.statusCode = 401;
    throw error;
  }
}

function normalizeSetupPayload(payload, env) {
  const adminEmail = normalizeEmail(payload.adminEmail);
  const adminPassword = String(payload.adminPassword ?? "");
  const discordToken = String(payload.discordToken ?? "").trim();
  const discordClientId = String(payload.discordClientId ?? "").trim();
  const discordGuildId = String(payload.discordGuildId ?? "").trim();
  const publicBaseUrl = normalizeBaseUrl(payload.publicBaseUrl ?? env.PUBLIC_BASE_URL ?? "http://127.0.0.1:8787");
  const databaseProvider = String(payload.databaseProvider ?? "postgresql").trim().toLowerCase();
  const databaseUrl = String(payload.databaseUrl ?? defaultDatabaseUrl(databaseProvider)).trim();
  const databaseUrlLedger = String(payload.databaseUrlLedger ?? defaultLedgerDatabaseUrl(databaseProvider)).trim();
  const adminHost = String(payload.adminHost ?? "0.0.0.0").trim();
  const adminPort = String(payload.adminPort ?? "8787").trim();

  const errors = [];
  if (!discordToken || discordToken.length < 20) errors.push("Discord bot token is required.");
  if (!/^\d{10,32}$/.test(discordClientId)) errors.push("Discord client/application ID must be a numeric Discord snowflake.");
  if (!/^\d{10,32}$/.test(discordGuildId)) errors.push("Discord guild/server ID must be a numeric Discord snowflake.");
  if (!adminEmail) errors.push("Admin email is required.");
  if (adminPassword.length < 12) errors.push("Admin password must be at least 12 characters.");
  if (!new Set(["postgresql", "sqlite", "mysql"]).has(databaseProvider)) errors.push("Database provider must be postgresql, sqlite or mysql.");
  if (!databaseUrl) errors.push("DATABASE_URL is required.");
  if (databaseProvider === "postgresql" && !databaseUrl.startsWith("postgresql://") && !databaseUrl.startsWith("postgres://")) {
    errors.push("PostgreSQL DATABASE_URL must start with postgresql:// or postgres://.");
  }

  if (errors.length > 0) {
    const error = new Error(errors.join(" "));
    error.statusCode = 400;
    throw error;
  }

  const jwtSecret = strongSecret(payload.adminJwtSecret ?? env.ADMIN_JWT_SECRET);
  const totpSecret = strongSecret(payload.adminTotpEncryptionKey ?? env.ADMIN_TOTP_ENCRYPTION_KEY ?? jwtSecret);
  const paymentSecret = strongSecret(payload.paymentLinkSecret ?? env.PAYMENT_LINK_SECRET);
  const walletSeed = String(payload.walletHdMasterSeedHex ?? env.WALLET_HD_MASTER_SEED_HEX ?? crypto.randomBytes(32).toString("hex")).trim();
  if (!/^[a-f0-9]{64,}$/i.test(walletSeed)) {
    const error = new Error("Wallet HD master seed HEX must be at least 32 bytes in hex.");
    error.statusCode = 400;
    throw error;
  }

  const envValues = {
    DISCORD_TOKEN: discordToken,
    DISCORD_CLIENT_ID: discordClientId,
    DISCORD_GUILD_ID: discordGuildId,
    SETUP_ALLOWED_USER_IDS: String(payload.setupAllowedUserIds ?? "").trim(),
    PUBLIC_BASE_URL: publicBaseUrl,
    ADMIN_PANEL_ENABLED: "true",
    ADMIN_PANEL_HOST: adminHost,
    ADMIN_PANEL_PORT: adminPort,
    ADMIN_JWT_SECRET: jwtSecret,
    ADMIN_TOTP_ENCRYPTION_KEY: totpSecret,
    ADMIN_DEFAULT_EMAIL: adminEmail,
    ADMIN_DEFAULT_PASSWORD: adminPassword,
    ADMIN_TRUST_PROXY: String(payload.adminTrustProxy ?? "true"),
    ADMIN_FORCE_HTTPS: String(payload.adminForceHttps ?? "false"),
    ADMIN_PANEL_BIND: String(payload.adminPanelBind ?? adminHost),
    ADMIN_JSON_LIMIT: String(payload.adminJsonLimit ?? "256kb"),
    ADMIN_CSP_ENABLED: String(payload.adminCspEnabled ?? "true"),
    STORAGE_DRIVER: "prisma",
    DATABASE_PROVIDER: databaseProvider,
    DATABASE_URL: databaseUrl,
    DATABASE_URL_LEDGER: databaseUrlLedger,
    LEDGER_STORAGE_DRIVER: databaseProvider === "sqlite" ? "json" : "prisma",
    LEDGER_DATA_DIR: String(payload.ledgerDataDir ?? "./data/ledger"),
    PAYMENT_LINK_SECRET: paymentSecret,
    WALLET_HD_MASTER_SEED_HEX: walletSeed,
    VIREON_CHAIN_MODE: "disabled",
    ONCHAIN_SYNC_ENABLED: "false",
    MUSIC_ENABLED: String(payload.musicEnabled ?? "false"),
    LAVALINK_HOST: String(payload.lavalinkHost ?? "lavalink"),
    LAVALINK_PORT: String(payload.lavalinkPort ?? "2333"),
    LAVALINK_PASSWORD: String(payload.lavalinkPassword ?? "youshallnotpass"),
    LAVALINK_SECURE: String(payload.lavalinkSecure ?? "false")
  };

  return {
    admin: { email: adminEmail },
    env: envValues
  };
}

function defaultDatabaseUrl(provider) {
  if (provider === "sqlite") return "file:./data/vbos.db";
  if (provider === "mysql") return "mysql://vireon:vbos_change_me@mysql:3306/vbos";
  return "postgresql://vireon:vbos_change_me@postgres:5432/vbos?schema=public";
}

function defaultLedgerDatabaseUrl(provider) {
  if (provider === "sqlite") return "file:./data/vireon-ledger.db";
  if (provider === "mysql") return "mysql://vireon:vbos_change_me@mysql-ledger:3306/vbos_ledger";
  return "postgresql://vireon:vbos_change_me@postgres-ledger:5432/vbos_ledger?schema=public";
}

function strongSecret(value) {
  const current = String(value ?? "").trim();
  return current.length >= 32 && !current.startsWith("replace_with") ? current : crypto.randomBytes(48).toString("base64url");
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeBaseUrl(value) {
  const raw = String(value ?? "").trim().replace(/\/+$/, "");
  if (!raw) return "http://127.0.0.1:8787";
  try {
    const url = new URL(raw);
    return url.toString().replace(/\/+$/, "");
  } catch {
    const error = new Error("PUBLIC_BASE_URL must be a valid URL.");
    error.statusCode = 400;
    throw error;
  }
}

function constantTimeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await chmodSafe(filePath, 0o600);
}

async function chmodSafe(filePath, mode) {
  if (!existsSync(filePath)) return;
  await chmod(filePath, mode).catch(() => null);
}
