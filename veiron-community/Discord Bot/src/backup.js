import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { gzip } from "node:zlib";
import { promisify } from "node:util";
import { childLogger, serializeError } from "./logger.js";

const gzipAsync = promisify(gzip);
const logger = childLogger({ module: "backup" });

export const DEFAULT_BACKUP_CRON = "0 3 * * *";
export const DEFAULT_BACKUP_DIR = "./backups";

export function createBackupConfig(env = process.env) {
  return {
    enabled: env.BACKUP_ENABLED === "true",
    runOnStartup: env.BACKUP_RUN_ON_STARTUP === "true",
    cron: env.BACKUP_CRON || DEFAULT_BACKUP_CRON,
    backupDir: env.BACKUP_DIR || DEFAULT_BACKUP_DIR,
    retentionDays: clampInteger(env.BACKUP_RETENTION_DAYS, 1, 3650, 14),
    includeJsonData: env.BACKUP_INCLUDE_JSON_DATA !== "false",
    storageDriver: env.STORAGE_DRIVER || "json",
    databaseProvider: env.DATABASE_PROVIDER || "sqlite",
    databaseUrl: env.DATABASE_URL || "file:./data/vbos.db",
    ledgerDatabaseUrl: env.DATABASE_URL_LEDGER || "file:./data/vireon-ledger.db",
    botDataDir: env.BOT_DATA_DIR || "./data",
    s3: {
      enabled: env.BACKUP_S3_ENABLED === "true",
      endpoint: env.BACKUP_S3_ENDPOINT || "",
      region: env.BACKUP_S3_REGION || "auto",
      bucket: env.BACKUP_S3_BUCKET || "",
      prefix: trimSlashes(env.BACKUP_S3_PREFIX || "vbos"),
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID || "",
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY || "",
      forcePathStyle: env.BACKUP_S3_FORCE_PATH_STYLE !== "false"
    }
  };
}

export async function runDatabaseBackup({ env = process.env, now = new Date(), dryRun = false } = {}) {
  const config = createBackupConfig(env);
  const timestamp = formatBackupTimestamp(now);
  const backupDir = path.resolve(config.backupDir);
  const workDir = path.join(backupDir, `.work-${timestamp}`);
  const archiveName = `vireon-db-backup-${timestamp}.tar.gz`;
  const archivePath = path.join(backupDir, archiveName);

  await mkdir(workDir, { recursive: true });
  await mkdir(backupDir, { recursive: true });

  try {
    const sources = await collectBackupSources(config, workDir);
    const manifest = buildBackupManifest({ config, timestamp, sources });
    await writeFile(path.join(workDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    if (!dryRun) {
      await writeTarGzArchive(workDir, archivePath);
    }

    const upload = !dryRun && config.s3.enabled
      ? await uploadBackupArchive({ config, archivePath, archiveName, timestamp })
      : { enabled: config.s3.enabled, skipped: true };

    if (!dryRun) {
      await pruneOldBackups(backupDir, config.retentionDays, now);
    }

    return {
      ok: true,
      dryRun,
      archivePath: dryRun ? null : archivePath,
      archiveName,
      sources,
      upload
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => null);
  }
}

export function startBackupScheduler({ env = process.env, runBackup = runDatabaseBackup, schedulerLogger = logger } = {}) {
  const config = createBackupConfig(env);
  if (!config.enabled) {
    schedulerLogger.info({ status: "disabled" }, "Database backup scheduler disabled.");
    return null;
  }

  let running = false;
  let lastRunKey = null;

  async function run(reason) {
    if (running) return;
    running = true;
    try {
      const result = await runBackup({ env });
      schedulerLogger.info({ reason, archiveName: result.archiveName, upload: result.upload }, "Database backup completed.");
    } catch (error) {
      schedulerLogger.error({ reason, error: serializeError(error) }, "Database backup failed.");
    } finally {
      running = false;
    }
  }

  const tick = () => {
    const now = new Date();
    const runKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}-${now.getUTCHours()}-${now.getUTCMinutes()}`;
    if (lastRunKey !== runKey && shouldRunCronNow(config.cron, now)) {
      lastRunKey = runKey;
      run("cron");
    }
  };

  const interval = setInterval(tick, 60_000);
  interval.unref?.();

  if (config.runOnStartup) {
    run("startup");
  }

  schedulerLogger.info({ cron: config.cron, backupDir: config.backupDir }, "Database backup scheduler started.");
  return {
    stop() {
      clearInterval(interval);
    },
    tick
  };
}

export function shouldRunCronNow(expression, date = new Date()) {
  const parts = String(expression || "").trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error("BACKUP_CRON must use 5 fields: minute hour day-of-month month day-of-week.");
  }

  const values = [
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
    date.getUTCDay()
  ];

  return parts.every((part, index) => cronPartMatches(part, values[index], index === 4));
}

export async function collectBackupSources(config, workDir) {
  const sources = [];
  const provider = String(config.databaseProvider || "sqlite").toLowerCase();

  if (provider === "sqlite") {
    sources.push(...await copySqliteDatabaseFiles({
      label: "main",
      databaseUrl: config.databaseUrl,
      workDir
    }));
    sources.push(...await copySqliteDatabaseFiles({
      label: "ledger",
      databaseUrl: config.ledgerDatabaseUrl,
      workDir
    }));
  } else if (provider === "postgresql") {
    sources.push(await dumpPostgresDatabase({
      label: "main",
      databaseUrl: config.databaseUrl,
      outputPath: path.join(workDir, "main-postgresql.sql")
    }));
    sources.push(await dumpPostgresDatabase({
      label: "ledger",
      databaseUrl: config.ledgerDatabaseUrl,
      outputPath: path.join(workDir, "ledger-postgresql.sql")
    }));
  } else if (provider === "mysql") {
    sources.push(await dumpMysqlDatabase({
      label: "main",
      databaseUrl: config.databaseUrl,
      outputPath: path.join(workDir, "main-mysql.sql")
    }));
    sources.push(await dumpMysqlDatabase({
      label: "ledger",
      databaseUrl: config.ledgerDatabaseUrl,
      outputPath: path.join(workDir, "ledger-mysql.sql")
    }));
  } else {
    throw new Error(`Unsupported DATABASE_PROVIDER for backups: ${provider}`);
  }

  if (config.includeJsonData) {
    sources.push(...await copyJsonDataFiles(config.botDataDir, path.join(workDir, "json-data")));
  }

  return sources;
}

export function buildS3UploadRequest({ config, archiveName, body, now = new Date() }) {
  const s3 = config.s3;
  validateS3Config(s3);

  const endpoint = new URL(s3.endpoint);
  const key = [s3.prefix, archiveName].filter(Boolean).join("/");
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const host = s3.forcePathStyle ? endpoint.host : `${s3.bucket}.${endpoint.host}`;
  const pathname = s3.forcePathStyle ? `/${s3.bucket}/${encodedKey}` : `/${encodedKey}`;
  const url = `${endpoint.protocol}//${host}${pathname}`;
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = [
    `content-type:application/gzip`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`
  ].join("\n");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    pathname,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash
  ].join("\n");
  const credentialScope = `${dateStamp}/${s3.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const signingKey = getSignatureKey(s3.secretAccessKey, dateStamp, s3.region, "s3");
  const signature = hmacHex(signingKey, stringToSign);

  return {
    url,
    key,
    headers: {
      authorization: `AWS4-HMAC-SHA256 Credential=${s3.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "content-type": "application/gzip",
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate
    }
  };
}

async function copySqliteDatabaseFiles({ label, databaseUrl, workDir }) {
  const databasePath = resolveSqlitePath(databaseUrl);
  const targets = [databasePath, `${databasePath}-wal`, `${databasePath}-shm`];
  const copied = [];

  for (const sourcePath of targets) {
    const exists = await fileExists(sourcePath);
    if (!exists) continue;
    const destination = path.join(workDir, `${label}-${path.basename(sourcePath)}`);
    await cp(sourcePath, destination);
    copied.push({
      label,
      type: "sqlite",
      source: redactPath(sourcePath),
      file: path.basename(destination),
      sizeBytes: (await stat(destination)).size
    });
  }

  if (copied.length === 0) {
    return [{
      label,
      type: "sqlite",
      source: redactPath(databasePath),
      skipped: true,
      reason: "database file not found"
    }];
  }

  return copied;
}

async function copyJsonDataFiles(dataDir, destinationDir) {
  const sourceDir = path.resolve(dataDir);
  if (!await fileExists(sourceDir)) {
    return [{ label: "json", type: "json", source: redactPath(sourceDir), skipped: true, reason: "data dir not found" }];
  }

  const files = await listFiles(sourceDir);
  const copied = [];
  for (const filePath of files) {
    const relative = path.relative(sourceDir, filePath);
    const destination = path.join(destinationDir, relative);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(filePath, destination);
    copied.push({
      label: "json",
      type: "json",
      source: redactPath(filePath),
      file: path.join("json-data", relative).replaceAll("\\", "/"),
      sizeBytes: (await stat(destination)).size
    });
  }

  return copied.length
    ? copied
    : [{ label: "json", type: "json", source: redactPath(sourceDir), skipped: true, reason: "no files" }];
}

async function dumpPostgresDatabase({ label, databaseUrl, outputPath }) {
  await runCommand("pg_dump", ["--dbname", databaseUrl, "--file", outputPath]);
  return {
    label,
    type: "postgresql",
    file: path.basename(outputPath),
    sizeBytes: (await stat(outputPath)).size
  };
}

async function dumpMysqlDatabase({ label, databaseUrl, outputPath }) {
  const url = new URL(databaseUrl);
  const args = [
    "--host", url.hostname,
    "--port", url.port || "3306",
    "--user", decodeURIComponent(url.username),
    `--password=${decodeURIComponent(url.password)}`,
    decodeURIComponent(url.pathname.replace(/^\//, ""))
  ];
  await runCommand("mysqldump", args, outputPath);
  return {
    label,
    type: "mysql",
    file: path.basename(outputPath),
    sizeBytes: (await stat(outputPath)).size
  };
}

async function runCommand(command, args, stdoutFile = null) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: stdoutFile ? ["ignore", "pipe", "pipe"] : ["ignore", "inherit", "pipe"]
    });
    let stderr = "";
    let outputPromise = Promise.resolve();
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    if (stdoutFile) {
      const output = createWriteStream(stdoutFile);
      outputPromise = pipeline(child.stdout, output);
    }
    child.on("error", reject);
    child.on("close", async (code) => {
      try {
        await outputPromise;
        if (code === 0) resolve();
        else reject(new Error(`${command} exited with code ${code}: ${stderr.trim()}`));
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function writeTarGzArchive(sourceDir, archivePath) {
  const files = await listFiles(sourceDir);
  const chunks = [];

  for (const filePath of files) {
    const relative = path.relative(sourceDir, filePath).replaceAll("\\", "/");
    const data = await readFile(filePath);
    chunks.push(createTarHeader(relative, data.length));
    chunks.push(data);
    chunks.push(Buffer.alloc((512 - (data.length % 512)) % 512));
  }

  chunks.push(Buffer.alloc(1024));
  const archive = await gzipAsync(Buffer.concat(chunks));
  await writeFile(archivePath, archive);
}

async function uploadBackupArchive({ config, archivePath, archiveName, timestamp }) {
  const body = await readFile(archivePath);
  const request = buildS3UploadRequest({
    config,
    archiveName,
    body
  });

  const response = await fetch(request.url, {
    method: "PUT",
    headers: request.headers,
    body
  });

  if (!response.ok) {
    throw new Error(`S3 backup upload failed with HTTP ${response.status}.`);
  }

  return {
    enabled: true,
    ok: response.ok,
    status: response.status,
    key: request.key,
    url: redactS3Url(request.url)
  };
}

async function pruneOldBackups(backupDir, retentionDays, now) {
  const entries = await readdir(backupDir, { withFileTypes: true }).catch(() => []);
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  await Promise.all(entries
    .filter((entry) => entry.isFile() && /^vireon-db-backup-.*\.tar\.gz$/.test(entry.name))
    .map(async (entry) => {
      const filePath = path.join(backupDir, entry.name);
      const fileStat = await stat(filePath);
      if (fileStat.mtime.getTime() < cutoff) {
        await rm(filePath, { force: true });
      }
    }));
}

function buildBackupManifest({ config, timestamp, sources }) {
  return {
    version: 1,
    createdAt: timestamp,
    app: "vbos",
    storageDriver: config.storageDriver,
    databaseProvider: config.databaseProvider,
    includesLedger: Boolean(config.ledgerDatabaseUrl),
    includesJsonData: config.includeJsonData,
    sources
  };
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const current = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(current));
    } else if (entry.isFile()) {
      files.push(current);
    }
  }
  return files.sort();
}

function createTarHeader(name, size) {
  const header = Buffer.alloc(512);
  writeString(header, name, 0, 100);
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, Math.floor(Date.now() / 1000), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  writeString(header, "ustar", 257, 6);
  writeString(header, "00", 263, 2);

  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeOctal(header, checksum, 148, 8);
  return header;
}

function writeString(buffer, value, offset, length) {
  buffer.write(String(value).slice(0, length), offset, length, "utf8");
}

function writeOctal(buffer, value, offset, length) {
  const octal = value.toString(8).padStart(length - 1, "0");
  buffer.write(`${octal}\0`, offset, length, "ascii");
}

function resolveSqlitePath(databaseUrl) {
  if (!databaseUrl.startsWith("file:")) {
    throw new Error(`SQLite backups require file: DATABASE_URL values. Received: ${redactDatabaseUrl(databaseUrl)}`);
  }

  const rawPath = databaseUrl.slice("file:".length);
  return path.resolve(rawPath);
}

function cronPartMatches(part, value, isDayOfWeek = false) {
  return String(part).split(",").some((segment) => {
    if (segment === "*") return true;
    if (segment.includes("/")) {
      const [base, stepRaw] = segment.split("/");
      const step = Number.parseInt(stepRaw, 10);
      if (!Number.isFinite(step) || step <= 0) return false;
      const min = base === "*" ? 0 : Number.parseInt(base, 10);
      return value >= min && (value - min) % step === 0;
    }
    if (segment.includes("-")) {
      const [start, end] = segment.split("-").map((item) => Number.parseInt(item, 10));
      return value >= start && value <= end;
    }
    const target = Number.parseInt(segment, 10);
    return value === target || (isDayOfWeek && target === 7 && value === 0);
  });
}

function formatBackupTimestamp(date) {
  return date.toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest("hex");
}

function getSignatureKey(secret, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

function validateS3Config(s3) {
  for (const key of ["endpoint", "bucket", "accessKeyId", "secretAccessKey"]) {
    if (!s3[key]) throw new Error(`Missing S3 backup config: ${key}`);
  }
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function trimSlashes(value) {
  return String(value ?? "").replace(/^\/+|\/+$/g, "");
}

function redactPath(value) {
  return path.relative(process.cwd(), value) || path.basename(value);
}

function redactDatabaseUrl(value) {
  try {
    const url = new URL(value);
    if (url.password) url.password = "REDACTED";
    return url.toString();
  } catch {
    return value;
  }
}

function redactS3Url(value) {
  const url = new URL(value);
  return `${url.origin}${url.pathname}`;
}
