import { ChannelType } from "discord.js";
import { writeAuditLog } from "./audit-log.js";
import { createVireonEmbed, normalizeColor } from "./embed-factory.js";

export const AUTOMATION_FLOWS_COLLECTION = "automation-flows";
export const AUTOMATION_EVENTS_COLLECTION = "automation-events";

export const AUTOMATION_TRIGGER_TYPES = Object.freeze([
  "any_message",
  "message_contains",
  "message_regex",
  "member_join",
  "member_leave",
  "manual_test"
]);

export const AUTOMATION_ACTION_TYPES = Object.freeze([
  "send_channel_message",
  "dm_user",
  "add_role",
  "remove_role",
  "react_message",
  "log_event"
]);

const MAX_ACTIVE_FLOWS = 150;
const MAX_ACTIONS = 10;
const MAX_NAME = 120;
const MAX_TEXT = 1900;
const MAX_REGEX_LENGTH = 180;
const DEFAULT_COOLDOWN_SECONDS = 30;

export async function buildAutomationStudioOverview({ store, guildId, client = null } = {}) {
  const [flows, events, discord] = await Promise.all([
    listAutomationFlows({ store, guildId }),
    listAutomationEvents({ store, guildId, limit: 40 }),
    buildDiscordAutomationContext({ client, guildId })
  ]);

  const activeFlows = flows.items.filter((flow) => flow.enabled !== false && !flow.deletedAt).length;

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    flows: flows.items,
    recentEvents: events.items,
    discord,
    stats: {
      totalFlows: flows.items.length,
      activeFlows,
      recentEvents: events.items.length,
      maxActiveFlows: MAX_ACTIVE_FLOWS,
      maxActionsPerFlow: MAX_ACTIONS
    },
    capabilities: {
      triggers: AUTOMATION_TRIGGER_TYPES,
      actions: AUTOMATION_ACTION_TYPES,
      dryRun: true,
      runtime: true,
      shellExecution: false,
      javascriptEval: false,
      audited: true
    }
  };
}

export async function listAutomationFlows({ store, guildId, includeDeleted = false } = {}) {
  const items = (await safeList(store, AUTOMATION_FLOWS_COLLECTION))
    .filter((item) => (!guildId || item.guildId === guildId) && (includeDeleted || !item.deletedAt))
    .map(publicAutomationFlow)
    .sort((left, right) => {
      const enabledSort = Number(right.enabled !== false) - Number(left.enabled !== false);
      if (enabledSort !== 0) return enabledSort;
      return left.name.localeCompare(right.name);
    });
  return { ok: true, items };
}

export async function listAutomationEvents({ store, guildId, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 200));
  const items = (await safeList(store, AUTOMATION_EVENTS_COLLECTION))
    .filter((item) => !guildId || item.guildId === guildId)
    .sort((left, right) => Date.parse(right.createdAt ?? 0) - Date.parse(left.createdAt ?? 0))
    .slice(0, safeLimit);
  return { ok: true, items };
}

export async function previewAutomationFlow({ store, guildId, payload = {}, actor = null } = {}) {
  const flow = normalizeAutomationFlowPayload({ guildId, payload, actor, now: new Date(), preview: true });
  const plan = buildAutomationPlan(flow);
  const activeCount = (await listAutomationFlows({ store, guildId })).items.filter((item) => item.enabled !== false).length;
  return {
    ok: true,
    dryRun: true,
    flow: publicAutomationFlow(flow),
    plan,
    limits: {
      activeCount,
      maxActiveFlows: MAX_ACTIVE_FLOWS,
      maxActionsPerFlow: MAX_ACTIONS
    }
  };
}

export async function createOrUpdateAutomationFlow({ store, guildId, payload = {}, actor = null, now = new Date() } = {}) {
  const flow = normalizeAutomationFlowPayload({ guildId, payload, actor, now });
  const existing = payload.id
    ? (await safeList(store, AUTOMATION_FLOWS_COLLECTION)).find((item) => item.id === payload.id && item.guildId === guildId && !item.deletedAt)
    : null;

  if (!existing && flow.enabled !== false) {
    const activeCount = (await listAutomationFlows({ store, guildId })).items.filter((item) => item.enabled !== false).length;
    if (activeCount >= MAX_ACTIVE_FLOWS) throwHttpError(400, `Automation limit reached: ${MAX_ACTIVE_FLOWS} active flows per guild.`);
  }

  let saved;
  if (existing) {
    saved = await store.update(
      AUTOMATION_FLOWS_COLLECTION,
      (item) => item.id === existing.id,
      (item) => ({
        ...item,
        ...flow,
        id: item.id,
        createdAt: item.createdAt ?? flow.createdAt,
        createdById: item.createdById ?? flow.createdById,
        createdByTag: item.createdByTag ?? flow.createdByTag,
        runCount: Number(item.runCount ?? 0),
        failCount: Number(item.failCount ?? 0),
        lastRunAt: item.lastRunAt ?? null,
        lastRunStatus: item.lastRunStatus ?? null,
        updatedAt: now.toISOString(),
        updatedById: actor?.id ?? null,
        updatedByTag: actorLabel(actor),
        deletedAt: null,
        deletedById: null
      })
    );
  } else {
    saved = await store.add(AUTOMATION_FLOWS_COLLECTION, flow);
  }

  await logAutomationEvent({
    store,
    guildId,
    actor,
    type: existing ? "automation.flow.update" : "automation.flow.create",
    title: existing ? "Automation Flow Updated" : "Automation Flow Created",
    description: `${saved.name} ${existing ? "updated" : "created"} from Admin Web.`,
    flowId: saved.id,
    status: "success",
    metadata: { flow: publicAutomationFlow(saved), plan: buildAutomationPlan(saved) }
  });

  return { ok: true, flow: publicAutomationFlow(saved), plan: buildAutomationPlan(saved) };
}

export async function deleteAutomationFlowFromWeb({ store, guildId, flowId, actor = null, now = new Date() } = {}) {
  const flow = await store.update(
    AUTOMATION_FLOWS_COLLECTION,
    (item) => item.id === flowId && item.guildId === guildId && !item.deletedAt,
    () => ({
      enabled: false,
      deletedAt: now.toISOString(),
      deletedById: actor?.id ?? null,
      deletedByTag: actorLabel(actor)
    })
  );
  if (!flow) throwHttpError(404, "Automation flow not found.");

  await logAutomationEvent({
    store,
    guildId,
    actor,
    type: "automation.flow.delete",
    title: "Automation Flow Deleted",
    description: `${flow.name} disabled and soft-deleted from Admin Web.`,
    flowId: flow.id,
    status: "success",
    metadata: { flow: publicAutomationFlow(flow) }
  });

  return { ok: true, flow: publicAutomationFlow(flow) };
}

export async function testAutomationFlow({ client = null, store, guildId, payload = {}, actor = null } = {}) {
  const flow = normalizeAutomationFlowPayload({ guildId, payload, actor, now: new Date(), preview: true });
  const dryRun = payload.dryRun !== false;
  const context = buildManualTestContext({ guildId, actor, payload });
  const result = await executeAutomationFlow({ client, store, flow, context, dryRun, actor, source: "admin-test" });
  return { ok: true, dryRun, result };
}

export function registerAutomationRuntime({ store }) {
  return {
    async handleMessage(message) {
      if (!message?.guildId || message.author?.bot) return { ok: true, matched: 0, executed: 0 };
      return runMatchingAutomationFlows({
        store,
        guildId: message.guildId,
        context: {
          eventType: "message",
          message,
          guild: message.guild,
          channel: message.channel,
          user: message.author,
          member: message.member,
          text: message.content ?? ""
        }
      });
    },
    async handleMemberJoin(member) {
      if (!member?.guild?.id) return { ok: true, matched: 0, executed: 0 };
      return runMatchingAutomationFlows({
        store,
        guildId: member.guild.id,
        context: {
          eventType: "member_join",
          guild: member.guild,
          user: member.user,
          member,
          text: ""
        }
      });
    },
    async handleMemberLeave(member) {
      if (!member?.guild?.id) return { ok: true, matched: 0, executed: 0 };
      return runMatchingAutomationFlows({
        store,
        guildId: member.guild.id,
        context: {
          eventType: "member_leave",
          guild: member.guild,
          user: member.user,
          member,
          text: ""
        }
      });
    }
  };
}

export async function runMatchingAutomationFlows({ store, guildId, context, client = null } = {}) {
  const flows = (await listAutomationFlows({ store, guildId })).items.filter((flow) => flow.enabled !== false);
  let matched = 0;
  let executed = 0;
  const results = [];

  for (const flow of flows) {
    if (!matchesAutomationTrigger(flow, context)) continue;
    matched += 1;
    if (isFlowOnCooldown(flow)) {
      results.push({ flowId: flow.id, status: "cooldown" });
      continue;
    }

    const result = await executeAutomationFlow({ client, store, flow, context, dryRun: false, source: "runtime" });
    results.push(result);
    if (result.status === "success" || result.status === "partial") executed += 1;
  }

  return { ok: true, matched, executed, results };
}

export function matchesAutomationTrigger(flow, context = {}) {
  const trigger = flow.trigger ?? {};
  const text = String(context.text ?? "");

  if (trigger.type === "any_message") return context.eventType === "message";
  if (trigger.type === "message_contains") {
    if (context.eventType !== "message") return false;
    const needle = String(trigger.value ?? "").trim();
    if (!needle) return false;
    return text.toLowerCase().includes(needle.toLowerCase());
  }
  if (trigger.type === "message_regex") {
    if (context.eventType !== "message") return false;
    try {
      return new RegExp(String(trigger.value ?? ""), trigger.caseSensitive ? "" : "i").test(text);
    } catch {
      return false;
    }
  }
  if (trigger.type === "member_join") return context.eventType === "member_join";
  if (trigger.type === "member_leave") return context.eventType === "member_leave";
  if (trigger.type === "manual_test") return context.eventType === "manual_test";
  return false;
}

export async function executeAutomationFlow({ client = null, store, flow, context = {}, dryRun = false, actor = null, source = "runtime" } = {}) {
  const startedAt = new Date();
  const actionResults = [];
  let failed = 0;

  for (const action of flow.actions ?? []) {
    try {
      const result = await executeAutomationAction({ client, action, context, dryRun });
      actionResults.push(result);
      if (result.ok === false) failed += 1;
    } catch (error) {
      failed += 1;
      actionResults.push({ ok: false, actionType: action.type, error: error.message });
    }
  }

  const status = dryRun ? "dry_run" : failed === 0 ? "success" : failed < (flow.actions ?? []).length ? "partial" : "failed";
  const event = await logAutomationEvent({
    store,
    guildId: flow.guildId,
    actor: actor ?? context.user,
    type: "automation.flow.run",
    title: dryRun ? "Automation Dry Run" : "Automation Flow Run",
    description: `${flow.name} ${dryRun ? "dry-run" : "executed"} from ${source}.`,
    flowId: flow.id,
    channelId: context.channel?.id ?? null,
    userId: context.user?.id ?? null,
    status,
    metadata: {
      source,
      dryRun,
      trigger: flow.trigger,
      actions: actionResults,
      durationMs: Date.now() - startedAt.getTime()
    }
  });

  if (!dryRun && flow.id) {
    await store.update(
      AUTOMATION_FLOWS_COLLECTION,
      (item) => item.id === flow.id,
      (item) => ({
        runCount: Number(item.runCount ?? 0) + 1,
        failCount: Number(item.failCount ?? 0) + (status === "failed" || status === "partial" ? 1 : 0),
        lastRunAt: new Date().toISOString(),
        lastRunStatus: status
      })
    );
  }

  return { ok: status !== "failed", status, flowId: flow.id, actions: actionResults, eventId: event.id };
}

async function executeAutomationAction({ client = null, action, context = {}, dryRun = false }) {
  const actionType = action?.type;
  const config = action?.config ?? {};

  if (dryRun) {
    return { ok: true, dryRun: true, actionType, summary: describeAction(action) };
  }

  if (actionType === "send_channel_message") {
    const channelId = config.channelId || context.channel?.id;
    const channel = await fetchTextChannel({ client, context, channelId });
    if (!channel?.send) throw new Error("Target channel is not sendable.");
    const payload = buildActionMessagePayload(config.message ?? config, context);
    const sent = await channel.send(payload);
    return { ok: true, actionType, channelId, messageId: sent?.id ?? null };
  }

  if (actionType === "dm_user") {
    const user = context.user ?? context.member?.user;
    if (!user?.send) throw new Error("Context user cannot receive DMs.");
    const sent = await user.send(buildActionMessagePayload(config.message ?? config, context));
    return { ok: true, actionType, userId: user.id, messageId: sent?.id ?? null };
  }

  if (actionType === "add_role" || actionType === "remove_role") {
    const member = context.member;
    const roleId = String(config.roleId ?? "").trim();
    if (!member?.roles) throw new Error("Context member is unavailable.");
    if (!roleId) throw new Error("roleId is required.");
    if (actionType === "add_role") await member.roles.add(roleId, "VBOS automation flow");
    else await member.roles.remove(roleId, "VBOS automation flow");
    return { ok: true, actionType, userId: member.id, roleId };
  }

  if (actionType === "react_message") {
    if (!context.message?.react) throw new Error("Context message is unavailable.");
    const emoji = String(config.emoji ?? "").trim().slice(0, 80);
    if (!emoji) throw new Error("emoji is required.");
    await context.message.react(emoji);
    return { ok: true, actionType, messageId: context.message.id, emoji };
  }

  if (actionType === "log_event") {
    return { ok: true, actionType, note: interpolateText(config.note ?? config.content ?? "Automation log event", context) };
  }

  throw new Error(`Unsupported automation action: ${actionType}`);
}

function normalizeAutomationFlowPayload({ guildId, payload = {}, actor = null, now = new Date(), preview = false } = {}) {
  const name = String(payload.name ?? "").trim().slice(0, MAX_NAME);
  if (!name) throwHttpError(400, "Automation flow name is required.");
  const trigger = normalizeTrigger(payload.trigger ?? payload);
  const actions = normalizeActions(payload.actions ?? []);
  if (actions.length === 0) throwHttpError(400, "At least one automation action is required.");

  const createdAt = now.toISOString();
  return {
    id: payload.id || (preview ? `preview-${Date.now()}` : `automation-${Date.now()}-${Math.random().toString(16).slice(2)}`),
    guildId,
    name,
    description: String(payload.description ?? "").trim().slice(0, 512),
    enabled: payload.enabled !== false,
    trigger,
    actions,
    cooldownSeconds: normalizeCooldown(payload.cooldownSeconds ?? payload.cooldown ?? DEFAULT_COOLDOWN_SECONDS),
    runCount: 0,
    failCount: 0,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt,
    createdById: actor?.id ?? null,
    createdByTag: actorLabel(actor),
    updatedAt: createdAt,
    updatedById: actor?.id ?? null,
    updatedByTag: actorLabel(actor)
  };
}

function normalizeTrigger(trigger = {}) {
  const type = String(trigger.type ?? "message_contains").trim();
  if (!AUTOMATION_TRIGGER_TYPES.includes(type)) throwHttpError(400, `Unsupported trigger type: ${type}.`);
  const value = String(trigger.value ?? trigger.pattern ?? "").trim();
  if (["message_contains", "message_regex"].includes(type) && !value) throwHttpError(400, "Trigger value is required for message triggers.");
  if (type === "message_regex") {
    if (value.length > MAX_REGEX_LENGTH) throwHttpError(400, `Regex trigger is limited to ${MAX_REGEX_LENGTH} characters.`);
    try {
      new RegExp(value);
    } catch (error) {
      throwHttpError(400, `Invalid regex trigger: ${error.message}`);
    }
  }
  return {
    type,
    value: value.slice(0, type === "message_regex" ? MAX_REGEX_LENGTH : 180),
    caseSensitive: Boolean(trigger.caseSensitive)
  };
}

function normalizeActions(actions) {
  if (!Array.isArray(actions)) throwHttpError(400, "actions must be an array.");
  if (actions.length > MAX_ACTIONS) throwHttpError(400, `Automation flows are limited to ${MAX_ACTIONS} actions.`);
  return actions
    .map((action, index) => normalizeAction(action, index))
    .filter(Boolean);
}

function normalizeAction(action = {}, index = 0) {
  const type = String(action.type ?? "").trim();
  if (!AUTOMATION_ACTION_TYPES.includes(type)) throwHttpError(400, `Unsupported action type at #${index + 1}: ${type}.`);
  const config = normalizeActionConfig(type, action.config ?? action);
  return { id: action.id ?? `action-${index + 1}`, type, config };
}

function normalizeActionConfig(type, config = {}) {
  if (type === "send_channel_message") {
    return {
      channelId: String(config.channelId ?? "").trim(),
      message: normalizeMessageConfig(config.message ?? config)
    };
  }
  if (type === "dm_user") return { message: normalizeMessageConfig(config.message ?? config) };
  if (type === "add_role" || type === "remove_role") return { roleId: String(config.roleId ?? "").trim() };
  if (type === "react_message") return { emoji: String(config.emoji ?? "").trim().slice(0, 80) };
  if (type === "log_event") return { note: String(config.note ?? config.content ?? "Automation log event").trim().slice(0, 512) };
  return {};
}

function normalizeMessageConfig(config = {}) {
  const mode = String(config.mode ?? "plain").trim() === "embed" ? "embed" : "plain";
  return {
    mode,
    content: String(config.content ?? "").trim().slice(0, MAX_TEXT),
    title: String(config.title ?? "").trim().slice(0, 256),
    description: String(config.description ?? "").trim().slice(0, 4096),
    color: config.color ?? "#d4af37",
    footer: String(config.footer ?? "VBOS").trim().slice(0, 256)
  };
}

function buildActionMessagePayload(config, context) {
  const message = normalizeMessageConfig(config);
  const content = interpolateText(message.content, context);
  if (message.mode === "embed") {
    const embed = createVireonEmbed({
      title: interpolateText(message.title || "VBOS Automation", context),
      description: interpolateText(message.description || content || "Automation event triggered.", context),
      color: normalizeColor(message.color),
      footer: interpolateText(message.footer || "VBOS", context)
    });
    return content ? { content, embeds: [embed] } : { embeds: [embed] };
  }
  if (!content) throw new Error("Plain message content is required.");
  return { content };
}

function interpolateText(text, context = {}) {
  const user = context.user ?? context.member?.user ?? {};
  const guild = context.guild ?? {};
  const channel = context.channel ?? {};
  return String(text ?? "")
    .replaceAll("{user}", user.id ? `<@${user.id}>` : "")
    .replaceAll("{username}", user.username ?? user.tag ?? "user")
    .replaceAll("{server}", guild.name ?? "server")
    .replaceAll("{channel}", channel.id ? `<#${channel.id}>` : "")
    .replaceAll("{message}", String(context.text ?? "").slice(0, 300));
}

async function fetchTextChannel({ client, context, channelId }) {
  if ((!channelId || channelId === context.channel?.id) && context.channel) return context.channel;
  const guild = context.guild ?? (client && context.guildId ? await client.guilds.fetch(context.guildId).catch(() => null) : null);
  const channel = guild?.channels?.cache?.get(channelId)
    ?? await guild?.channels?.fetch?.(channelId).catch(() => null)
    ?? await client?.channels?.fetch?.(channelId).catch(() => null);
  return channel;
}

function buildAutomationPlan(flow) {
  return {
    trigger: describeTrigger(flow.trigger),
    actions: (flow.actions ?? []).map(describeAction),
    cooldownSeconds: flow.cooldownSeconds
  };
}

function describeTrigger(trigger = {}) {
  if (trigger.type === "any_message") return "When any non-bot message is created.";
  if (trigger.type === "message_contains") return `When a message contains '${trigger.value}'.`;
  if (trigger.type === "message_regex") return `When a message matches /${trigger.value}/${trigger.caseSensitive ? "" : "i"}.`;
  if (trigger.type === "member_join") return "When a member joins the server.";
  if (trigger.type === "member_leave") return "When a member leaves the server.";
  return "Manual test only.";
}

function describeAction(action = {}) {
  const config = action.config ?? {};
  if (action.type === "send_channel_message") return `Send ${config.message?.mode ?? "plain"} message to ${config.channelId || "trigger channel"}.`;
  if (action.type === "dm_user") return `DM user with ${config.message?.mode ?? "plain"} message.`;
  if (action.type === "add_role") return `Add role ${config.roleId}.`;
  if (action.type === "remove_role") return `Remove role ${config.roleId}.`;
  if (action.type === "react_message") return `React with ${config.emoji}.`;
  if (action.type === "log_event") return `Write automation log: ${config.note}.`;
  return action.type ?? "Unknown action";
}

function isFlowOnCooldown(flow) {
  const cooldownSeconds = Number(flow.cooldownSeconds ?? 0);
  if (!cooldownSeconds || !flow.lastRunAt) return false;
  return Date.now() - Date.parse(flow.lastRunAt) < cooldownSeconds * 1000;
}

function publicAutomationFlow(flow) {
  return {
    id: flow.id,
    guildId: flow.guildId,
    name: flow.name,
    description: flow.description ?? "",
    enabled: flow.enabled !== false,
    trigger: flow.trigger,
    actions: flow.actions ?? [],
    cooldownSeconds: Number(flow.cooldownSeconds ?? DEFAULT_COOLDOWN_SECONDS),
    runCount: Number(flow.runCount ?? 0),
    failCount: Number(flow.failCount ?? 0),
    lastRunAt: flow.lastRunAt ?? null,
    lastRunStatus: flow.lastRunStatus ?? null,
    createdAt: flow.createdAt ?? null,
    createdByTag: flow.createdByTag ?? null,
    updatedAt: flow.updatedAt ?? null,
    updatedByTag: flow.updatedByTag ?? null,
    deletedAt: flow.deletedAt ?? null
  };
}

async function buildDiscordAutomationContext({ client, guildId }) {
  if (!client || !guildId) return { ok: false, channels: [], roles: [], reason: "Discord runtime unavailable." };
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { ok: false, channels: [], roles: [], reason: "Guild unavailable." };
  await Promise.all([
    guild.channels.fetch().catch(() => null),
    guild.roles.fetch().catch(() => null)
  ]);
  const textTypes = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum]);
  const channels = [...guild.channels.cache.values()]
    .filter((channel) => textTypes.has(channel.type))
    .map((channel) => ({ id: channel.id, name: channel.name, type: channel.type }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.name !== "@everyone")
    .map((role) => ({ id: role.id, name: role.name, position: role.position, managed: role.managed }))
    .sort((left, right) => right.position - left.position);
  return { ok: true, guild: { id: guild.id, name: guild.name }, channels, roles };
}

function buildManualTestContext({ guildId, actor, payload = {} }) {
  const fakeUser = {
    id: actor?.id ?? "admin-web",
    tag: actorLabel(actor),
    username: actor?.email ?? actor?.tag ?? "admin",
    async send(message) {
      return { id: `dry-dm-${Date.now()}`, message };
    }
  };
  return {
    eventType: "manual_test",
    guildId,
    user: fakeUser,
    member: { id: fakeUser.id, user: fakeUser, roles: fakeRoleManager() },
    guild: { id: guildId, name: payload.guildName ?? "VBOS Test Guild" },
    channel: fakeChannel(payload.channelId),
    text: String(payload.sampleText ?? "manual test message")
  };
}

function fakeChannel(channelId = "test-channel") {
  return {
    id: channelId || "test-channel",
    async send(message) {
      return { id: `dry-channel-${Date.now()}`, message };
    }
  };
}

function fakeRoleManager() {
  return {
    async add(roleId) { return roleId; },
    async remove(roleId) { return roleId; }
  };
}

async function logAutomationEvent({ store, guildId, actor = null, type, title, description, flowId = null, channelId = null, userId = null, status = "info", metadata = {} }) {
  const event = await store.add(AUTOMATION_EVENTS_COLLECTION, {
    guildId,
    type,
    title,
    description,
    flowId,
    channelId,
    userId,
    status,
    actorId: actor?.id ?? null,
    actorTag: actorLabel(actor),
    metadata,
    createdAt: new Date().toISOString()
  });

  await writeAuditLog({
    store,
    guildId,
    type,
    title,
    description,
    actor: actor ? { id: actor.id, tag: actorLabel(actor) } : null,
    channelId,
    targetId: flowId,
    source: "automation-studio",
    metadata
  }).catch(() => null);

  return event;
}

async function safeList(store, collection) {
  if (!store?.list) return [];
  return store.list(collection);
}

function normalizeCooldown(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_COOLDOWN_SECONDS;
  return Math.max(0, Math.min(parsed, 86400));
}

function actorLabel(actor) {
  return actor?.tag ?? actor?.email ?? actor?.id ?? "admin-web";
}

function throwHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
