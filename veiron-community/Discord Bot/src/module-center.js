import { writeAuditLog } from "./audit-log.js";

export const MODULE_CENTER_COLLECTION = "module-center-state";
export const MODULE_CENTER_EVENTS_COLLECTION = "module-center-events";

const EXPORTABLE_COLLECTIONS = Object.freeze({
  custom: ["custom-commands", "custom-interactions"],
  automations: ["automation-flows"],
  operations: ["message-templates", "message-pushes", "message-approvals"],
  moderation: ["moderation-cases"],
  tickets: ["tickets"],
  automod: ["automod-events", "spam-events"],
  proposals: ["proposals"],
  announcements: ["announcements"],
  economy: ["social-wallets", "social-transactions", "xp-profiles"],
  music: ["music-playlists"],
  permissions: ["settings"],
  wallet: ["wallet-links"]
});

export const MODULE_REGISTRY = Object.freeze([
  {
    id: "control",
    name: "Control Center",
    category: "core",
    risk: "high",
    minimumRole: "ADMIN",
    defaultEnabled: true,
    locked: true,
    description: "Full Discord server control: members, roles, channels, categories, guild settings and safety checks.",
    routes: ["/admin/#control"],
    endpoints: ["/api/control/*"],
    permissions: ["ManageGuild", "ManageRoles", "ManageChannels", "ModerateMembers", "KickMembers", "BanMembers"],
    dependencies: []
  },
  {
    id: "operations",
    name: "Bot Operations Studio",
    category: "ops",
    risk: "medium",
    minimumRole: "MODERATOR",
    defaultEnabled: true,
    description: "Safe bot console, message creator, approval queue, templates, multi-channel push and scheduled posts.",
    routes: ["/admin/#operations"],
    endpoints: ["/api/operations/*"],
    permissions: ["SendMessages", "EmbedLinks"],
    dependencies: ["control"]
  },
  {
    id: "custom",
    name: "Custom Lab",
    category: "builder",
    risk: "medium",
    minimumRole: "ADMIN",
    defaultEnabled: true,
    description: "DB-backed custom commands, aliases, slash gateway responses and custom button interactions.",
    routes: ["/admin/#custom", "/custom"],
    endpoints: ["/api/custom/*"],
    permissions: ["SendMessages", "UseApplicationCommands"],
    dependencies: ["operations"]
  },
  {
    id: "automations",
    name: "Automation Studio",
    category: "builder",
    risk: "high",
    minimumRole: "ADMIN",
    defaultEnabled: true,
    description: "No-code flows with safe Discord triggers, allowlisted actions, dry-run, cooldown and execution history.",
    routes: ["/admin/#automations"],
    endpoints: ["/api/automations/*"],
    permissions: ["SendMessages", "ManageRoles"],
    dependencies: ["custom"]
  },
  {
    id: "moderation",
    name: "Moderation Suite",
    category: "safety",
    risk: "high",
    minimumRole: "MODERATOR",
    defaultEnabled: true,
    description: "Warnings, timeouts, kicks, bans, unbans, purge and moderation case ledger.",
    routes: ["/admin/#moderation"],
    endpoints: ["/api/moderation/*"],
    permissions: ["ModerateMembers", "KickMembers", "BanMembers", "ManageMessages"],
    dependencies: ["control"]
  },
  {
    id: "tickets",
    name: "Ticket Desk",
    category: "support",
    risk: "medium",
    minimumRole: "MODERATOR",
    defaultEnabled: true,
    description: "Ticket visibility, close/reopen/archive controls and support history.",
    routes: ["/admin/#tickets"],
    endpoints: ["/api/tickets"],
    permissions: ["ManageChannels", "SendMessages"],
    dependencies: ["control"]
  },
  {
    id: "automod",
    name: "Automod + Anti-Spam",
    category: "safety",
    risk: "high",
    minimumRole: "ADMIN",
    defaultEnabled: true,
    description: "Live scam keywords, regex rules, invite blocking, mass mention rules, anti-spam and event review.",
    routes: ["/admin/#automod", "/admin/#spam"],
    endpoints: ["/api/automod/*", "/api/anti-spam/*"],
    permissions: ["ManageMessages", "ModerateMembers"],
    dependencies: ["moderation"]
  },
  {
    id: "economy",
    name: "XP + Economy",
    category: "community",
    risk: "medium",
    minimumRole: "ADMIN",
    defaultEnabled: true,
    description: "XP, levels, role rewards, rank cards and server-only social Shards economy.",
    routes: ["/admin/#economy"],
    endpoints: ["/api/xp/settings", "/api/economy/settings"],
    permissions: ["ManageRoles"],
    dependencies: ["control"]
  },
  {
    id: "music",
    name: "Music Studio",
    category: "media",
    risk: "medium",
    minimumRole: "ADMIN",
    defaultEnabled: false,
    description: "Lavalink music backend, playlists, queue controls, audio filters and now-playing actions.",
    routes: ["/admin/#music"],
    endpoints: [],
    permissions: ["Connect", "Speak"],
    envKeys: ["LAVALINK_NODES"],
    dependencies: []
  },
  {
    id: "announcements",
    name: "Announcements + Proposals",
    category: "community",
    risk: "medium",
    minimumRole: "ADMIN",
    defaultEnabled: true,
    description: "Announcements, scheduled posts, proposals and voting review.",
    routes: ["/admin/#proposals"],
    endpoints: ["/api/proposals", "/api/announcements"],
    permissions: ["SendMessages", "EmbedLinks"],
    dependencies: ["operations"]
  },
  {
    id: "permissions",
    name: "Permission Controller",
    category: "core",
    risk: "high",
    minimumRole: "SUPER_ADMIN",
    defaultEnabled: true,
    locked: true,
    description: "Central RBAC policies for setup, moderation, admin features and protected workflows.",
    routes: ["/admin/#permissions"],
    endpoints: ["/api/permissions"],
    permissions: ["Administrator"],
    dependencies: []
  },
  {
    id: "push",
    name: "Web Push Alerts",
    category: "ops",
    risk: "low",
    minimumRole: "ADMIN",
    defaultEnabled: false,
    description: "Browser/PWA push notifications for admin alerts and important bot events.",
    routes: ["/admin/#settings"],
    endpoints: ["/api/push/*"],
    envKeys: ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY"],
    permissions: [],
    dependencies: []
  },
  {
    id: "backup",
    name: "Backup + Restore",
    category: "ops",
    risk: "high",
    minimumRole: "SUPER_ADMIN",
    defaultEnabled: true,
    description: "Database backup hooks, local retention and deployment-safe restore planning.",
    routes: [],
    endpoints: [],
    envKeys: ["BACKUP_ENABLED"],
    permissions: [],
    dependencies: []
  },
  {
    id: "wallet",
    name: "Wallet/Payments",
    category: "finance-disabled",
    risk: "critical",
    minimumRole: "SUPER_ADMIN",
    defaultEnabled: false,
    description: "Wallet/payment features stay optional and disabled for Discord/Admin deploys unless explicitly enabled.",
    routes: ["/admin/#wallet"],
    endpoints: ["/api/wallets"],
    envKeys: ["VIREON_CHAIN_MODE", "WALLET_HD_MASTER_SEED"],
    permissions: [],
    dependencies: []
  },
  {
    id: "blockchain",
    name: "Blockchain Status",
    category: "finance-disabled",
    risk: "critical",
    minimumRole: "VIEWER",
    defaultEnabled: false,
    description: "Vireon chain adapter status remains optional while VBOS focuses on Discord operations.",
    routes: ["/admin/#blockchain"],
    endpoints: ["/api/blockchain/status"],
    envKeys: ["VIREON_CHAIN_MODE"],
    permissions: [],
    dependencies: []
  }
]);

export async function buildModuleCenterOverview({ store, guildId, client = null } = {}) {
  const [states, events, diagnostics] = await Promise.all([
    loadModuleStates(store, guildId),
    listModuleCenterEvents({ store, guildId, limit: 60 }),
    buildModuleDiagnostics({ client, guildId })
  ]);
  const diagnosticContext = { ...diagnostics, states };
  const modules = MODULE_REGISTRY.map((definition) => decorateModule(definition, states.get(definition.id), diagnosticContext));
  const enabled = modules.filter((module) => module.enabled).length;
  const disabled = modules.length - enabled;
  const critical = modules.filter((module) => module.risk === "critical").length;
  const dependencyWarnings = modules.flatMap((module) => module.warnings ?? []).filter((warning) => warning.type === "dependency").length;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    modules,
    recentEvents: events.items,
    stats: {
      total: modules.length,
      enabled,
      disabled,
      critical,
      dependencyWarnings,
      categories: [...new Set(modules.map((module) => module.category))].sort()
    },
    capabilities: {
      toggleModules: true,
      lockedCoreProtection: true,
      exportBundles: true,
      importDryRun: true,
      importApply: true,
      shellExecution: false,
      javascriptEval: false,
      audited: true
    }
  };
}

export async function setModuleState({ store, guildId, moduleId, payload = {}, actor = null, client = null } = {}) {
  const definition = findModule(moduleId);
  if (!definition) throwHttpError(404, "Module not found.");
  if (definition.locked && payload.enabled === false) throwHttpError(400, `${definition.name} is locked and cannot be disabled.`);

  const now = new Date().toISOString();
  const existing = (await safeList(store, MODULE_CENTER_COLLECTION)).find((item) => item.guildId === guildId && item.moduleId === definition.id);
  const nextState = {
    guildId,
    moduleId: definition.id,
    enabled: payload.enabled == null ? (existing?.enabled ?? definition.defaultEnabled) : Boolean(payload.enabled),
    locked: Boolean(definition.locked),
    reason: String(payload.reason ?? payload.note ?? existing?.reason ?? "").slice(0, 500),
    tags: normalizeTags(payload.tags ?? existing?.tags ?? []),
    updatedAt: now,
    updatedById: actor?.id ?? null,
    updatedByTag: actorLabel(actor)
  };

  let saved;
  if (existing) {
    saved = await store.update(MODULE_CENTER_COLLECTION, (item) => item.id === existing.id, () => nextState);
  } else {
    saved = await store.add(MODULE_CENTER_COLLECTION, nextState);
  }

  const overview = await buildModuleCenterOverview({ store, guildId, client });
  const module = overview.modules.find((item) => item.id === definition.id);
  await logModuleCenterEvent({
    store,
    guildId,
    actor,
    type: "module.state.update",
    status: "success",
    moduleId: definition.id,
    title: "Module State Updated",
    description: `${definition.name} was ${saved.enabled ? "enabled" : "disabled"} from Admin Web.`,
    metadata: { module, reason: saved.reason }
  });

  return { ok: true, module, state: saved };
}

export async function exportModuleBundle({ store, guildId, payload = {}, actor = null } = {}) {
  const moduleIds = normalizeModuleIds(payload.moduleIds, { includeAll: payload.includeAll !== false });
  const includeCollections = new Set(moduleIds.flatMap((moduleId) => EXPORTABLE_COLLECTIONS[moduleId] ?? []));
  const collections = {};
  for (const collection of includeCollections) {
    const items = await safeList(store, collection);
    collections[collection] = items.filter((item) => !guildId || item.guildId == null || item.guildId === guildId);
  }
  const bundle = {
    schema: "vbos.module-bundle.v1",
    exportedAt: new Date().toISOString(),
    guildId,
    exportedBy: actorLabel(actor),
    modules: moduleIds,
    collections,
    summary: Object.fromEntries(Object.entries(collections).map(([name, items]) => [name, items.length]))
  };

  await logModuleCenterEvent({
    store,
    guildId,
    actor,
    type: "module.bundle.export",
    status: "success",
    moduleId: "module-center",
    title: "Module Bundle Exported",
    description: `Exported ${moduleIds.length} module(s) and ${Object.keys(collections).length} collection(s).`,
    metadata: { summary: bundle.summary, modules: moduleIds }
  });

  return { ok: true, bundle };
}

export async function importModuleBundle({ store, guildId, payload = {}, actor = null } = {}) {
  const dryRun = payload.dryRun !== false;
  const bundle = parseBundle(payload.bundle ?? payload);
  if (bundle.schema !== "vbos.module-bundle.v1") throwHttpError(400, "Unsupported bundle schema.");
  const collections = bundle.collections && typeof bundle.collections === "object" ? bundle.collections : {};
  const plan = [];
  for (const [collection, items] of Object.entries(collections)) {
    if (!Array.isArray(items)) throwHttpError(400, `Invalid collection payload: ${collection}.`);
    if (items.length > 500) throwHttpError(400, `Import limit exceeded for ${collection}: max 500 items.`);
    plan.push({ collection, items: items.length });
  }

  let imported = 0;
  if (!dryRun) {
    for (const [collection, items] of Object.entries(collections)) {
      for (const item of items) {
        const sanitized = sanitizeImportedItem(item, guildId, actor);
        await store.add(collection, sanitized);
        imported += 1;
      }
    }
  }

  await logModuleCenterEvent({
    store,
    guildId,
    actor,
    type: dryRun ? "module.bundle.import.preview" : "module.bundle.import.apply",
    status: "success",
    moduleId: "module-center",
    title: dryRun ? "Module Bundle Import Preview" : "Module Bundle Imported",
    description: dryRun ? `Validated ${plan.length} collection(s).` : `Imported ${imported} item(s).`,
    metadata: { dryRun, plan, imported, source: bundle.exportedAt ?? null }
  });

  return { ok: true, dryRun, plan, imported };
}

export async function listModuleCenterEvents({ store, guildId, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 200));
  const items = (await safeList(store, MODULE_CENTER_EVENTS_COLLECTION))
    .filter((item) => !guildId || item.guildId === guildId)
    .sort((left, right) => Date.parse(right.createdAt ?? 0) - Date.parse(left.createdAt ?? 0))
    .slice(0, safeLimit);
  return { ok: true, items };
}

async function loadModuleStates(store, guildId) {
  const states = new Map();
  for (const item of await safeList(store, MODULE_CENTER_COLLECTION)) {
    if (!guildId || item.guildId === guildId) states.set(item.moduleId, item);
  }
  return states;
}

function decorateModule(definition, state = null, diagnostics = {}) {
  const enabled = state?.enabled ?? definition.defaultEnabled;
  const env = Object.fromEntries((definition.envKeys ?? []).map((key) => [key, Boolean(process.env[key])]));
  const warnings = [];
  for (const dependency of definition.dependencies ?? []) {
    const dependencyState = diagnostics.states?.get?.(dependency);
    if (dependencyState && dependencyState.enabled === false) {
      warnings.push({ type: "dependency", message: `Depends on disabled module: ${dependency}.` });
    }
  }
  for (const [key, exists] of Object.entries(env)) {
    if (!exists && ["push", "music"].includes(definition.id) && enabled) {
      warnings.push({ type: "env", message: `Missing optional env: ${key}.` });
    }
  }

  return {
    ...definition,
    enabled,
    locked: Boolean(definition.locked || state?.locked),
    desiredState: enabled ? "enabled" : "disabled",
    status: enabled ? (warnings.length ? "warning" : "active") : "disabled",
    configuredEnv: env,
    guildReady: diagnostics.guildReady,
    updatedAt: state?.updatedAt ?? null,
    updatedByTag: state?.updatedByTag ?? null,
    reason: state?.reason ?? "",
    tags: state?.tags ?? [],
    warnings
  };
}

async function buildModuleDiagnostics({ client, guildId } = {}) {
  const states = new Map();
  return {
    guildReady: Boolean(client?.guilds?.cache?.get?.(guildId)),
    states
  };
}

function findModule(moduleId) {
  return MODULE_REGISTRY.find((module) => module.id === normalizeToken(moduleId));
}

function normalizeModuleIds(value, { includeAll = true } = {}) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/g);
  const ids = raw.map(normalizeToken).filter(Boolean).filter((id) => MODULE_REGISTRY.some((module) => module.id === id));
  return ids.length ? [...new Set(ids)] : (includeAll ? MODULE_REGISTRY.map((module) => module.id) : []);
}

function parseBundle(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      throwHttpError(400, "Bundle must be valid JSON.");
    }
  }
  if (!value || typeof value !== "object") throwHttpError(400, "Bundle payload is required.");
  return value;
}

function sanitizeImportedItem(item, guildId, actor) {
  const clone = JSON.parse(JSON.stringify(item ?? {}));
  delete clone.id;
  delete clone.createdAt;
  delete clone.updatedAt;
  clone.guildId = guildId ?? clone.guildId ?? null;
  clone.importedAt = new Date().toISOString();
  clone.importedById = actor?.id ?? null;
  clone.importedByTag = actorLabel(actor);
  return clone;
}

async function logModuleCenterEvent({ store, guildId, actor, type, status, moduleId, title, description, metadata = {} }) {
  const event = {
    guildId,
    type,
    status,
    moduleId,
    title,
    description,
    actorUserId: actor?.id ?? null,
    actorTag: actorLabel(actor),
    metadata,
    createdAt: new Date().toISOString()
  };
  await store.add(MODULE_CENTER_EVENTS_COLLECTION, event);
  await writeAuditLog(null, {
    title,
    description,
    type,
    source: "module-center",
    actorUserId: event.actorUserId,
    actorTag: event.actorTag,
    relatedId: moduleId,
    metadata
  }, { store }).catch(() => null);
  return event;
}

function normalizeTags(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/g);
  return raw.map((item) => String(item).trim().slice(0, 40)).filter(Boolean).slice(0, 12);
}

function normalizeToken(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
}

function actorLabel(actor) {
  return actor?.email ?? actor?.tag ?? actor?.username ?? actor?.id ?? "system";
}

async function safeList(store, collection) {
  if (!store?.list) return [];
  try {
    return await store.list(collection);
  } catch {
    return [];
  }
}

function throwHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
