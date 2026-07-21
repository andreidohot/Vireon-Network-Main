import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildS3UploadRequest,
  createBackupConfig,
  runDatabaseBackup,
  shouldRunCronNow,
  startBackupScheduler
} from "../src/backup.js";

describe("database backup config", () => {
  it("normalizes backup environment settings", () => {
    const config = createBackupConfig({
      BACKUP_ENABLED: "true",
      BACKUP_RUN_ON_STARTUP: "true",
      BACKUP_CRON: "15 2 * * *",
      BACKUP_RETENTION_DAYS: "30",
      BACKUP_S3_ENABLED: "true",
      BACKUP_S3_ENDPOINT: "https://r2.example.com",
      BACKUP_S3_BUCKET: "vireon-backups",
      BACKUP_S3_ACCESS_KEY_ID: "key",
      BACKUP_S3_SECRET_ACCESS_KEY: "secret",
      BACKUP_S3_FORCE_PATH_STYLE: "false"
    });

    expect(config.enabled).toBe(true);
    expect(config.runOnStartup).toBe(true);
    expect(config.cron).toBe("15 2 * * *");
    expect(config.retentionDays).toBe(30);
    expect(config.s3).toMatchObject({
      enabled: true,
      endpoint: "https://r2.example.com",
      bucket: "vireon-backups",
      forcePathStyle: false
    });
  });

  it("matches UTC cron schedules", () => {
    expect(shouldRunCronNow("0 3 * * *", new Date("2026-01-01T03:00:00.000Z"))).toBe(true);
    expect(shouldRunCronNow("0 3 * * *", new Date("2026-01-01T03:01:00.000Z"))).toBe(false);
    expect(shouldRunCronNow("*/15 * * * *", new Date("2026-01-01T03:30:00.000Z"))).toBe(true);
  });
});

describe("database backup runner", () => {
  it("creates a tar.gz backup archive for sqlite and JSON data", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vireon-backup-test-"));
    const dataDir = path.join(root, "data");
    const backupDir = path.join(root, "backups");
    const mainDb = path.join(dataDir, "main.db");
    const ledgerDb = path.join(dataDir, "ledger.db");
    await mkdir(dataDir, { recursive: true });
    await writeFile(mainDb, "main-db", "utf8");
    await writeFile(ledgerDb, "ledger-db", "utf8");
    await writeFile(path.join(dataDir, "settings.json"), JSON.stringify({ value: { ok: true } }), "utf8");

    const result = await runDatabaseBackup({
      env: {
        DATABASE_PROVIDER: "sqlite",
        DATABASE_URL: `file:${mainDb}`,
        DATABASE_URL_LEDGER: `file:${ledgerDb}`,
        BOT_DATA_DIR: dataDir,
        BACKUP_DIR: backupDir,
        BACKUP_RETENTION_DAYS: "14"
      },
      now: new Date("2026-01-01T03:00:00.000Z")
    });

    expect(result.ok).toBe(true);
    expect(result.archiveName).toBe("vireon-db-backup-2026-01-01T03-00-00Z.tar.gz");
    expect(result.sources.some((source) => source.label === "main" && source.type === "sqlite")).toBe(true);
    expect(result.sources.some((source) => source.label === "ledger" && source.type === "sqlite")).toBe(true);
    expect(result.sources.some((source) => source.type === "json")).toBe(true);
    await expect(stat(result.archivePath)).resolves.toMatchObject({ size: expect.any(Number) });
  });

  it("supports dry-run without writing the archive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vireon-backup-dry-"));
    const dbPath = path.join(root, "main.db");
    await writeFile(dbPath, "main-db", "utf8");

    const result = await runDatabaseBackup({
      env: {
        DATABASE_PROVIDER: "sqlite",
        DATABASE_URL: `file:${dbPath}`,
        DATABASE_URL_LEDGER: `file:${path.join(root, "missing-ledger.db")}`,
        BACKUP_INCLUDE_JSON_DATA: "false",
        BACKUP_DIR: path.join(root, "backups")
      },
      dryRun: true
    });

    expect(result.dryRun).toBe(true);
    expect(result.archivePath).toBeNull();
    expect(result.sources.find((source) => source.label === "ledger").skipped).toBe(true);
  });
});

describe("S3-compatible backup uploads", () => {
  it("builds a signed path-style PUT request", () => {
    const body = Buffer.from("backup");
    const request = buildS3UploadRequest({
      config: {
        s3: {
          endpoint: "https://s3.example.com",
          region: "auto",
          bucket: "vireon",
          prefix: "prod/bot",
          accessKeyId: "access",
          secretAccessKey: "secret",
          forcePathStyle: true
        }
      },
      archiveName: "backup.tar.gz",
      body,
      now: new Date("2026-01-01T00:00:00.000Z")
    });

    expect(request.url).toBe("https://s3.example.com/vireon/prod/bot/backup.tar.gz");
    expect(request.key).toBe("prod/bot/backup.tar.gz");
    expect(request.headers.authorization).toContain("AWS4-HMAC-SHA256 Credential=access/20260101/auto/s3/aws4_request");
    expect(request.headers["x-amz-content-sha256"]).toHaveLength(64);
  });
});

describe("backup scheduler", () => {
  it("runs the backup callback when the configured cron matches", async () => {
    let runs = 0;
    const originalDate = globalThis.Date;
    class FixedDate extends originalDate {
      constructor(...args) {
        super(...(args.length ? args : ["2026-01-01T03:00:00.000Z"]));
      }
      static now() {
        return new originalDate("2026-01-01T03:00:00.000Z").getTime();
      }
    }
    globalThis.Date = FixedDate;

    try {
      const scheduler = startBackupScheduler({
        env: {
          BACKUP_ENABLED: "true",
          BACKUP_CRON: "0 3 * * *"
        },
        runBackup: async () => {
          runs += 1;
          return { archiveName: "backup.tar.gz", upload: { skipped: true } };
        },
        schedulerLogger: { info() {}, error() {} }
      });

      scheduler.tick();
      scheduler.stop();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(runs).toBe(1);
    } finally {
      globalThis.Date = originalDate;
    }
  });
});
