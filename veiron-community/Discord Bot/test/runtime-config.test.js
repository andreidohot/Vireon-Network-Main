import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  finalizeSetupWizard,
  getRuntimeConfigPath,
  getSetupTokenPath,
  getSetupWizardStatus,
  loadRuntimeConfigIntoEnv
} from "../src/runtime-config.js";

async function createEnv() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "vireon-runtime-config-"));
  return {
    BOT_DATA_DIR: dataDir,
    SETUP_WIZARD_RESTART_ON_FINISH: "false"
  };
}

describe("runtime setup wizard", () => {
  it("creates a local setup token and reports wizard as required", async () => {
    const env = await createEnv();
    const status = await getSetupWizardStatus({ env });
    const token = await readFile(getSetupTokenPath(env), "utf8");

    expect(status.required).toBe(true);
    expect(status.completed).toBe(false);
    expect(token.trim()).toMatch(/^vireon-setup-/);
  });

  it("finalizes setup into runtime config and removes the setup token", async () => {
    const env = await createEnv();
    await getSetupWizardStatus({ env });
    const setupToken = (await readFile(getSetupTokenPath(env), "utf8")).trim();

    const result = await finalizeSetupWizard({
      env,
      payload: {
        setupToken,
        discordToken: "mfa.fake_discord_bot_token_value_for_tests_1234567890",
        discordClientId: "123456789012345678",
        discordGuildId: "234567890123456789",
        publicBaseUrl: "https://bot.example.com",
        adminEmail: "Admin@Example.com",
        adminPassword: "very-strong-password",
        databaseProvider: "postgresql",
        databaseUrl: "postgresql://vireon:secret@postgres:5432/vbos?schema=public",
        databaseUrlLedger: "postgresql://vireon:secret@postgres-ledger:5432/vbos_ledger?schema=public"
      }
    });

    const rawConfig = JSON.parse(await readFile(getRuntimeConfigPath(env), "utf8"));

    expect(result.ok).toBe(true);
    expect(result.wizardRemoved).toBe(true);
    expect(rawConfig.env.STORAGE_DRIVER).toBe("prisma");
    expect(rawConfig.env.DATABASE_PROVIDER).toBe("postgresql");
    expect(rawConfig.env.LEDGER_STORAGE_DRIVER).toBe("prisma");
    await expect(readFile(getSetupTokenPath(env), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("loads runtime config values into env without overwriting existing values by default", async () => {
    const env = await createEnv();
    await getSetupWizardStatus({ env });
    const setupToken = (await readFile(getSetupTokenPath(env), "utf8")).trim();
    await finalizeSetupWizard({
      env,
      payload: {
        setupToken,
        discordToken: "mfa.fake_discord_bot_token_value_for_tests_1234567890",
        discordClientId: "123456789012345678",
        discordGuildId: "234567890123456789",
        publicBaseUrl: "https://bot.example.com",
        adminEmail: "admin@example.com",
        adminPassword: "very-strong-password",
        databaseProvider: "postgresql",
        databaseUrl: "postgresql://vireon:secret@postgres:5432/vbos?schema=public",
        databaseUrlLedger: "postgresql://vireon:secret@postgres-ledger:5432/vbos_ledger?schema=public"
      }
    });

    env.DISCORD_GUILD_ID = "999999999999999999";
    await loadRuntimeConfigIntoEnv({ env });

    expect(env.DISCORD_GUILD_ID).toBe("999999999999999999");
    expect(env.STORAGE_DRIVER).toBe("prisma");
  });
});
