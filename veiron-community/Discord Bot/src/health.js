export async function buildHealthStatus({ client, store, musicManager, chainClient }) {
  const [database, lavalink, chain] = await Promise.all([
    store ? checkComponent(() => store.healthCheck(), "database") : Promise.resolve({ ok: true, status: "bootstrap_skipped", component: "database" }),
    musicManager ? checkComponent(() => musicManager.healthCheck(), "lavalink") : Promise.resolve({ ok: true, status: "disabled", component: "lavalink" }),
    chainClient ? checkComponent(() => chainClient.healthCheck(), "chain") : Promise.resolve({ ok: true, status: "disabled", component: "chain" })
  ]);

  const botReady = Boolean(client?.isReady?.());
  const setupMode = !client;
  const ok = setupMode ? database.ok && lavalink.ok && chain.ok : botReady && database.ok && lavalink.ok && chain.ok;

  return {
    ok,
    status: setupMode ? "setup" : ok ? "ok" : "degraded",
    setupMode,
    timestamp: new Date().toISOString(),
    bot: {
      ok: setupMode ? true : botReady,
      status: setupMode ? "setup_wizard" : botReady ? "ready" : "not_ready",
      tag: client?.user?.tag ?? null,
      guilds: client?.guilds?.cache?.size ?? 0,
      ping: client?.ws?.ping ?? null
    },
    database,
    lavalink,
    chain
  };
}

async function checkComponent(check, name) {
  try {
    return await check();
  } catch (error) {
    return {
      ok: false,
      status: "error",
      component: name,
      error: error.message
    };
  }
}
