import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from "discord.js";
import { searchAuditEvents, writeAuditLog } from "./audit-log.js";
import { createVireonEmbed, normalizeColor } from "./embed-factory.js";
import { roleAtLeast } from "./admin-auth.js";
import { CUSTOM_INTERACTION_PREFIX, listCustomInteractions } from "./custom-controls.js";

export const MESSAGE_TEMPLATES_COLLECTION = "admin-message-templates";
export const MESSAGE_PUSHES_COLLECTION = "admin-message-pushes";
export const MESSAGE_APPROVALS_COLLECTION = "admin-message-approvals";
export const CONSOLE_RUNS_COLLECTION = "admin-console-runs";

const MAX_CHANNEL_PUSH_TARGETS = 20;
const MAX_TEMPLATE_NAME = 80;
const MAX_CONTENT_LENGTH = 1900;
const MAX_DESCRIPTION_LENGTH = 4096;
const MAX_CONSOLE_COMMAND_LENGTH = 500;
const MAX_CONSOLE_OUTPUT_ITEMS = 80;
const SCHEDULER_DEFAULT_INTERVAL_MS = 30_000;

const CONSOLE_HELP = Object.freeze([
  "help                         Show this allowlisted command list.",
  "ping                         Show Discord gateway ping and bot ready state.",
  "status                       Show bot, guild, channel, role and member summary.",
  "guild                        Show guild metadata.",
  "channels [query]             List channels, optionally filtered.",
  "roles [query]                List roles, optionally filtered.",
  "members <query>              Search members by username/display name/user ID.",
  "templates                    List saved message templates.",
  "push-history [limit]         Show recent channel message pushes.",
  "audit-tail [limit]           Show recent audit events.",
  "say <channelId> <message>    Send a plain message to a text channel. Audited."
]);

export async function buildBotOperationsOverview({ client, guildId, store }) {
  const guild = await fetchOpsGuild(client, guildId);
  await hydrateGuild(guild);
  const templates = await listMessageTemplates({ store, includeDeleted: false });
  const pushes = await listMessagePushes({ store, limit: 20 });
  const approvals = await listMessageApprovals({ store, limit: 30 });
  const pendingApprovals = approvals.items.filter((item) => item.status === "pending");

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    bot: {
      id: client.user?.id ?? null,
      tag: client.user?.tag ?? null,
      ready: Boolean(client.isReady?.()),
      pingMs: Number.isFinite(client.ws?.ping) ? client.ws.ping : null,
      uptimeMs: Number.isFinite(client.uptime) ? client.uptime : null
    },
    guild: {
      id: guild.id,
      name: guild.name,
      memberCount: guild.memberCount ?? guild.members.cache.size,
      channels: guild.channels.cache.size,
      roles: guild.roles.cache.size
    },
    textChannels: listTextChannels(guild),
    templates: templates.items,
    pushes: pushes.items,
    approvals: approvals.items,
    approvalQueue: {
      enabled: true,
      pending: pendingApprovals.length,
      moderatorCanRequest: true,
      adminCanApprove: true,
      directPushMinimumRole: "ADMIN"
    },
    console: {
      allowlisted: true,
      shellExecution: false,
      commands: CONSOLE_HELP
    },
    messageCreator: {
      maxTargets: MAX_CHANNEL_PUSH_TARGETS,
      supportsPlain: true,
      supportsEmbed: true,
      supportsLinkButton: true,
      supportsSchedule: true,
      supportsApprovalQueue: true
    }
  };
}

export async function runBotConsoleCommand({ client, guildId, store, command = "", actor }) {
  const guild = await fetchOpsGuild(client, guildId);
  await hydrateGuild(guild);
  const raw = normalizeConsoleCommand(command);
  const [keyword = "", ...parts] = splitConsoleCommand(raw);
  const verb = keyword.toLowerCase();
  let output;

  if (!raw) {
    output = textOutput(["Write a command first. Use `help` to see safe commands."]);
  } else if (verb === "help") {
    output = textOutput(CONSOLE_HELP);
  } else if (verb === "ping") {
    output = jsonOutput({
      ready: Boolean(client.isReady?.()),
      pingMs: Number.isFinite(client.ws?.ping) ? client.ws.ping : null,
      uptimeMs: Number.isFinite(client.uptime) ? client.uptime : null
    });
  } else if (verb === "status") {
    output = jsonOutput({
      bot: {
        tag: client.user?.tag ?? null,
        ready: Boolean(client.isReady?.()),
        pingMs: Number.isFinite(client.ws?.ping) ? client.ws.ping : null
      },
      guild: {
        id: guild.id,
        name: guild.name,
        memberCount: guild.memberCount ?? guild.members.cache.size,
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size
      }
    });
  } else if (verb === "guild") {
    output = jsonOutput({
      id: guild.id,
      name: guild.name,
      description: guild.description ?? null,
      preferredLocale: guild.preferredLocale ?? null,
      memberCount: guild.memberCount ?? guild.members.cache.size,
      ownerId: guild.ownerId ?? null,
      systemChannelId: guild.systemChannelId ?? null,
      rulesChannelId: guild.rulesChannelId ?? null
    });
  } else if (verb === "channels") {
    output = listOutput(filterByQuery(listAllChannels(guild), parts.join(" ")), (item) => `${item.type.padEnd(12)} #${item.name} (${item.id})`);
  } else if (verb === "roles") {
    output = listOutput(filterByQuery(listAllRoles(guild), parts.join(" ")), (item) => `${String(item.position).padStart(3, "0")} ${item.name} (${item.id}) ${item.managed ? "managed" : "editable"}`);
  } else if (verb === "members") {
    const query = parts.join(" ").trim();
    if (!query) {
      output = textOutput(["Usage: members <username | display name | user id>"]);
    } else {
      const members = await searchMembers(guild, query, 20);
      output = listOutput(members, (member) => `${member.tag} | ${member.displayName} | ${member.id}`);
    }
  } else if (verb === "templates") {
    const templates = await listMessageTemplates({ store, includeDeleted: false });
    output = listOutput(templates.items, (item) => `${item.name} | ${item.mode} | ${item.id}`);
  } else if (verb === "push-history") {
    const limit = parseLimit(parts[0], 20, 50);
    const pushes = await listMessagePushes({ store, limit });
    output = listOutput(pushes.items, (item) => `${item.status} | ${item.name ?? item.id} | ${item.channelIds?.length ?? 0} channel(s) | ${item.createdAt ?? "unknown"}`);
  } else if (verb === "audit-tail") {
    const limit = parseLimit(parts[0], 20, 50);
    const items = await searchAuditEvents(store, { limit });
    output = listOutput(items, (item) => `${item.createdAt ?? "unknown"} | ${item.type} | ${item.title}`);
  } else if (verb === "say") {
    const [channelId, ...messageParts] = parts;
    const content = messageParts.join(" ").trim();
    if (!channelId || !content) {
      output = textOutput(["Usage: say <channelId> <message>"]);
    } else {
      const result = await sendMessagePush({
        client,
        guildId,
        store,
        actor,
        payload: {
          name: "Console say",
          channelIds: [channelId],
          mode: "plain",
          content,
          reason: "Admin web console say command"
        }
      });
      output = jsonOutput({ sent: result.sent, failed: result.failed, pushId: result.push.id });
    }
  } else {
    output = textOutput([
      `Unknown or blocked command: ${verb || "empty"}`,
      "This console is intentionally allowlisted. Use `help` to see available commands."
    ]);
  }

  const run = await store.add(CONSOLE_RUNS_COLLECTION, {
    guildId,
    actorUserId: actor?.id ?? null,
    actorTag: actorLabel(actor),
    command: raw,
    keyword: verb || null,
    output: output.slice(0, MAX_CONSOLE_OUTPUT_ITEMS),
    source: "admin-web"
  });

  await auditOpsAction(guild, store, actor, {
    title: "Admin Web Console Command",
    description: `Ran allowlisted console command: ${verb || "empty"}.`,
    relatedId: run.id,
    metadata: { action: "console.run", keyword: verb || null, runId: run.id }
  });

  return { ok: true, runId: run.id, command: raw, output: run.output };
}

export async function previewMessagePayload({ payload = {} }) {
  const normalized = normalizeMessagePayload(payload);
  return {
    ok: true,
    preview: {
      mode: normalized.mode,
      content: normalized.content,
      embed: normalized.mode === "embed" ? normalized.embed : null,
      buttons: normalized.buttons,
      targetCount: normalizeChannelIds(payload.channelIds).length,
      scheduledAt: normalizeScheduleAt(payload.scheduleAt)
    }
  };
}

export async function listMessageTemplates({ store, includeDeleted = false } = {}) {
  const items = (await store.list(MESSAGE_TEMPLATES_COLLECTION))
    .filter((item) => includeDeleted || !item.deletedAt)
    .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt ?? 0) - Date.parse(left.updatedAt ?? left.createdAt ?? 0));
  return { ok: true, items };
}

export async function saveMessageTemplate({ store, payload = {}, actor }) {
  const name = normalizeTemplateName(payload.name);
  const message = normalizeMessagePayload(payload);
  const template = await store.add(MESSAGE_TEMPLATES_COLLECTION, {
    name,
    mode: message.mode,
    content: message.content,
    embed: message.embed,
    buttons: message.buttons,
    actorUserId: actor?.id ?? null,
    actorTag: actorLabel(actor),
    source: "admin-web"
  });
  return { ok: true, template };
}

export async function deleteMessageTemplate({ store, templateId, actor }) {
  const template = await store.update(
    MESSAGE_TEMPLATES_COLLECTION,
    (item) => item.id === templateId && !item.deletedAt,
    () => ({ deletedAt: new Date().toISOString(), deletedByUserId: actor?.id ?? null, deletedByTag: actorLabel(actor) })
  );
  if (!template) throwHttpError(404, "Message template not found.");
  return { ok: true, template };
}

export async function sendMessagePush({ client, guildId, store, payload = {}, actor, source = "admin-web", relatedApprovalId = null }) {
  const guild = await fetchOpsGuild(client, guildId);
  await hydrateGuild(guild);
  const channelIds = normalizeChannelIds(payload.channelIds);
  if (channelIds.length === 0) throwHttpError(400, "At least one target channel is required.");
  if (channelIds.length > MAX_CHANNEL_PUSH_TARGETS) throwHttpError(400, `Channel push is limited to ${MAX_CHANNEL_PUSH_TARGETS} channels per request.`);

  const message = normalizeMessagePayload(payload);
  const customButtons = await resolveCustomInteractionButtons({ store, guildId, payload });
  const scheduleAt = normalizeScheduleAt(payload.scheduleAt);
  const name = String(payload.name ?? "Channel Message Push").trim().slice(0, 120) || "Channel Message Push";
  const reason = String(payload.reason ?? "Admin web message push").trim().slice(0, 256);

  const push = await store.add(MESSAGE_PUSHES_COLLECTION, {
    guildId,
    name,
    channelIds,
    mode: message.mode,
    content: message.content,
    embed: message.embed,
    buttons: message.buttons,
    customButtons,
    reason,
    scheduleAt,
    status: scheduleAt && Date.parse(scheduleAt) > Date.now() && payload.sendNow !== true ? "scheduled" : "sending",
    sent: 0,
    failed: 0,
    results: [],
    actorUserId: actor?.id ?? null,
    actorTag: actorLabel(actor),
    source,
    relatedApprovalId
  });

  if (push.status === "scheduled") {
    await auditOpsAction(guild, store, actor, {
      title: "Admin Web Message Push Scheduled",
      description: `Scheduled ${name} for ${channelIds.length} channel(s).`,
      relatedId: push.id,
      metadata: { action: "message.push.schedule", pushId: push.id, channelIds, scheduleAt }
    });
    return { ok: true, scheduled: true, push };
  }

  return executeMessagePush({ client, guildId, store, pushId: push.id, actor });
}

export async function listMessagePushes({ store, limit = 50 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 200));
  const items = (await store.list(MESSAGE_PUSHES_COLLECTION))
    .sort((left, right) => Date.parse(right.updatedAt ?? right.createdAt ?? 0) - Date.parse(left.updatedAt ?? left.createdAt ?? 0))
    .slice(0, safeLimit);
  return { ok: true, items };
}

export async function listMessageApprovals({ store, limit = 50, includeClosed = true } = {}) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 200));
  const items = (await store.list(MESSAGE_APPROVALS_COLLECTION))
    .filter((item) => includeClosed || item.status === "pending")
    .sort((left, right) => {
      const leftScore = left.status === "pending" ? 1 : 0;
      const rightScore = right.status === "pending" ? 1 : 0;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return Date.parse(right.updatedAt ?? right.createdAt ?? 0) - Date.parse(left.updatedAt ?? left.createdAt ?? 0);
    })
    .slice(0, safeLimit);
  return { ok: true, items };
}

export async function requestMessageApproval({ client, guildId, store, payload = {}, actor }) {
  const guild = await fetchOpsGuild(client, guildId);
  await hydrateGuild(guild);
  const channelIds = normalizeChannelIds(payload.channelIds);
  if (channelIds.length === 0) throwHttpError(400, "At least one target channel is required.");
  if (channelIds.length > MAX_CHANNEL_PUSH_TARGETS) throwHttpError(400, `Channel push is limited to ${MAX_CHANNEL_PUSH_TARGETS} channels per request.`);

  for (const channelId of channelIds) {
    await fetchTextChannel(client, guildId, channelId);
  }

  const message = normalizeMessagePayload(payload);
  const customButtons = await resolveCustomInteractionButtons({ store, guildId, payload });
  const scheduleAt = normalizeScheduleAt(payload.scheduleAt);
  const name = String(payload.name ?? "Message Approval Request").trim().slice(0, 120) || "Message Approval Request";
  const reason = String(payload.reason ?? "Admin web approval request").trim().slice(0, 256);

  const approval = await store.add(MESSAGE_APPROVALS_COLLECTION, {
    guildId,
    name,
    channelIds,
    mode: message.mode,
    content: message.content,
    embed: message.embed,
    buttons: message.buttons,
    customButtons,
    reason,
    scheduleAt,
    sendNow: payload.sendNow === true,
    status: "pending",
    requestedAt: new Date().toISOString(),
    requesterUserId: actor?.id ?? null,
    requesterTag: actorLabel(actor),
    reviewerUserId: null,
    reviewerTag: null,
    reviewedAt: null,
    reviewNote: null,
    pushId: null,
    source: "admin-web"
  });

  await auditOpsAction(guild, store, actor, {
    title: "Message Approval Requested",
    description: `${actorLabel(actor)} requested approval for ${name} in ${channelIds.length} channel(s).`,
    relatedId: approval.id,
    metadata: { action: "message.approval.request", approvalId: approval.id, channelIds, scheduleAt }
  });

  return { ok: true, approval };
}

export async function reviewMessageApproval({ client, guildId, store, approvalId, payload = {}, actor }) {
  if (!roleAtLeast(actor?.role, "ADMIN")) throwHttpError(403, "Only ADMIN or SUPER_ADMIN users can review message approvals.");

  const action = String(payload.action ?? "").trim().toLowerCase();
  if (!["approve", "reject"].includes(action)) throwHttpError(400, "action must be approve or reject.");

  const guild = await fetchOpsGuild(client, guildId);
  const approval = (await store.list(MESSAGE_APPROVALS_COLLECTION)).find((item) => item.id === approvalId && !item.deletedAt);
  if (!approval) throwHttpError(404, "Message approval request not found.");
  if (approval.status !== "pending") throwHttpError(409, `Message approval request is already ${approval.status}.`);

  const reviewNote = String(payload.note ?? "").trim().slice(0, 500) || null;
  const reviewedAt = new Date().toISOString();

  if (action === "reject") {
    const rejected = await store.update(MESSAGE_APPROVALS_COLLECTION, (item) => item.id === approvalId, () => ({
      status: "rejected",
      reviewerUserId: actor?.id ?? null,
      reviewerTag: actorLabel(actor),
      reviewedAt,
      reviewNote
    }));

    await auditOpsAction(guild, store, actor, {
      title: "Message Approval Rejected",
      description: `${actorLabel(actor)} rejected ${approval.name}.`,
      relatedId: approval.id,
      metadata: { action: "message.approval.reject", approvalId: approval.id, reviewNote }
    });

    return { ok: true, approval: rejected };
  }

  const approved = await store.update(MESSAGE_APPROVALS_COLLECTION, (item) => item.id === approvalId, () => ({
    status: "approved",
    reviewerUserId: actor?.id ?? null,
    reviewerTag: actorLabel(actor),
    reviewedAt,
    reviewNote
  }));

  try {
    const pushResult = await sendMessagePush({
      client,
      guildId,
      store,
      actor,
      payload: {
        name: approval.name,
        channelIds: approval.channelIds,
        mode: approval.mode,
        content: approval.content,
        embed: approval.embed,
        buttons: approval.buttons,
        customButtons: approval.customButtons,
        reason: `Approved message request: ${approval.reason ?? approval.name}`,
        scheduleAt: approval.scheduleAt,
        sendNow: approval.sendNow
      },
      source: "approval-queue",
      relatedApprovalId: approval.id
    });

    const linked = await store.update(MESSAGE_APPROVALS_COLLECTION, (item) => item.id === approvalId, () => ({
      status: pushResult.scheduled ? "approved_scheduled" : pushResult.ok === false ? "approved_failed" : "approved_sent",
      pushId: pushResult.push?.id ?? null,
      pushStatus: pushResult.push?.status ?? null,
      sent: pushResult.sent ?? 0,
      failed: pushResult.failed ?? 0
    }));

    await auditOpsAction(guild, store, actor, {
      title: "Message Approval Approved",
      description: `${actorLabel(actor)} approved ${approval.name}.`,
      relatedId: approval.id,
      metadata: { action: "message.approval.approve", approvalId: approval.id, pushId: pushResult.push?.id ?? null, pushStatus: pushResult.push?.status ?? null }
    });

    return { ok: pushResult.ok !== false, approval: linked ?? approved, push: pushResult.push, sent: pushResult.sent ?? 0, failed: pushResult.failed ?? 0, scheduled: Boolean(pushResult.scheduled) };
  } catch (error) {
    const failed = await store.update(MESSAGE_APPROVALS_COLLECTION, (item) => item.id === approvalId, () => ({
      status: "approval_failed",
      pushError: error?.message ?? "Unknown approval send error"
    }));
    throwHttpError(error.statusCode ?? 500, failed.pushError);
  }
}

export async function executeDueMessagePushes({ client, guildId, store, now = new Date(), limit = 10 } = {}) {
  const due = (await store.list(MESSAGE_PUSHES_COLLECTION))
    .filter((item) => item.status === "scheduled" && item.scheduleAt && Date.parse(item.scheduleAt) <= now.getTime())
    .sort((left, right) => Date.parse(left.scheduleAt) - Date.parse(right.scheduleAt))
    .slice(0, Math.max(1, Math.min(Number.parseInt(limit, 10) || 10, 25)));

  const results = [];
  for (const item of due) {
    results.push(await executeMessagePush({ client, guildId, store, pushId: item.id, actor: { id: item.actorUserId, email: item.actorTag, role: "SYSTEM" } }));
  }
  return { ok: true, processed: results.length, results };
}

export function startMessagePushScheduler({ client, guildId, store, intervalMs = Number.parseInt(process.env.ADMIN_MESSAGE_PUSH_INTERVAL_MS ?? `${SCHEDULER_DEFAULT_INTERVAL_MS}`, 10) } = {}) {
  if (!client || !guildId || !store) return null;
  const safeInterval = Math.max(10_000, Math.min(Number.parseInt(intervalMs, 10) || SCHEDULER_DEFAULT_INTERVAL_MS, 300_000));
  const timer = setInterval(() => {
    executeDueMessagePushes({ client, guildId, store }).catch(() => null);
  }, safeInterval);
  timer.unref?.();
  return timer;
}

async function executeMessagePush({ client, guildId, store, pushId, actor }) {
  const guild = await fetchOpsGuild(client, guildId);
  const current = (await store.list(MESSAGE_PUSHES_COLLECTION)).find((item) => item.id === pushId);
  if (!current) throwHttpError(404, "Message push not found.");
  if (!["sending", "scheduled", "failed"].includes(current.status)) {
    return { ok: true, alreadyProcessed: true, push: current, sent: current.sent ?? 0, failed: current.failed ?? 0 };
  }

  await store.update(MESSAGE_PUSHES_COLLECTION, (item) => item.id === pushId, () => ({ status: "sending", startedAt: new Date().toISOString() }));

  const results = [];
  for (const channelId of current.channelIds ?? []) {
    try {
      const channel = await fetchTextChannel(client, guildId, channelId);
      const message = await channel.send(buildDiscordMessage(current));
      results.push({ ok: true, channelId, messageId: message.id, channelName: channel.name });
    } catch (error) {
      results.push({ ok: false, channelId, error: error?.message ?? "Unknown send error" });
    }
  }

  const sent = results.filter((item) => item.ok).length;
  const failed = results.length - sent;
  const status = sent > 0 && failed === 0 ? "sent" : sent > 0 ? "partial" : "failed";
  const updated = await store.update(MESSAGE_PUSHES_COLLECTION, (item) => item.id === pushId, () => ({
    status,
    sent,
    failed,
    results,
    completedAt: new Date().toISOString()
  }));

  await auditOpsAction(guild, store, actor, {
    title: "Admin Web Channel Message Push",
    description: `Message push ${status}: ${sent} sent, ${failed} failed.`,
    relatedId: pushId,
    metadata: { action: "message.push.execute", pushId, status, sent, failed }
  });

  return { ok: failed === 0, push: updated, sent, failed, results };
}

function normalizeMessagePayload(payload = {}) {
  const mode = String(payload.mode ?? "plain").trim().toLowerCase() === "embed" ? "embed" : "plain";
  const content = String(payload.content ?? "").trim().slice(0, MAX_CONTENT_LENGTH);
  const buttons = normalizeLinkButtons(payload);

  if (mode === "plain") {
    if (!content) throwHttpError(400, "Plain message requires content.");
    return { mode, content, embed: null, buttons };
  }

  const title = String(payload.title ?? payload.embed?.title ?? "").trim().slice(0, 256);
  const description = String(payload.description ?? payload.embed?.description ?? "").trim().slice(0, MAX_DESCRIPTION_LENGTH);
  if (!title && !description) throwHttpError(400, "Embed message requires title or description.");

  const embed = {
    title,
    description,
    color: normalizeColor(payload.color ?? payload.embed?.color ?? "#d4af37"),
    footer: String(payload.footer ?? payload.embed?.footer ?? "Vireon Network").trim().slice(0, 2048) || "Vireon Network",
    fields: normalizeEmbedFields(payload.fieldsText ?? payload.fields ?? payload.embed?.fields)
  };

  return { mode, content, embed, buttons };
}

function buildDiscordMessage(message) {
  const payload = {};
  if (message.content) payload.content = message.content;
  if (message.mode === "embed") {
    payload.embeds = [createVireonEmbed(message.embed ?? {})];
  }
  const components = [];
  for (const button of message.buttons ?? []) {
    components.push(new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(button.label)
      .setURL(button.url));
  }
  for (const button of message.customButtons ?? []) {
    components.push(new ButtonBuilder()
      .setCustomId(button.customId ?? `${CUSTOM_INTERACTION_PREFIX}${button.id}`)
      .setStyle(discordButtonStyle(button.style))
      .setLabel(button.label));
  }
  if (components.length) {
    payload.components = [new ActionRowBuilder().addComponents(components.slice(0, 5))];
  }
  return payload;
}


async function resolveCustomInteractionButtons({ store, guildId, payload = {} }) {
  const ids = normalizeChannelIds(payload.customInteractionIds ?? payload.customButtons ?? []);
  if (!ids.length) return [];
  const interactions = await listCustomInteractions({ store, guildId });
  const byId = new Map(interactions.items.map((item) => [item.id, item]));
  const byCustomId = new Map(interactions.items.map((item) => [item.customId, item]));
  return ids
    .map((id) => byId.get(id) ?? byCustomId.get(id))
    .filter((item) => item && item.enabled !== false)
    .slice(0, 5)
    .map((item) => ({ id: item.id, label: item.label, style: item.style, customId: item.customId }));
}

function discordButtonStyle(style) {
  if (style === "secondary") return ButtonStyle.Secondary;
  if (style === "success") return ButtonStyle.Success;
  if (style === "danger") return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}

function normalizeEmbedFields(fields) {
  if (Array.isArray(fields)) {
    return fields.slice(0, 10).map((field) => ({
      name: String(field.name ?? "Field").trim().slice(0, 256) || "Field",
      value: String(field.value ?? "-").trim().slice(0, 1024) || "-",
      inline: Boolean(field.inline)
    }));
  }

  return String(fields ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((line) => {
      const [name, value, inline] = line.includes("::") ? line.split("::") : line.split("|");
      return {
        name: String(name ?? "Field").trim().slice(0, 256) || "Field",
        value: String(value ?? "-").trim().slice(0, 1024) || "-",
        inline: String(inline ?? "").trim().toLowerCase() === "inline"
      };
    });
}

function normalizeLinkButtons(payload = {}) {
  const items = [];
  if (Array.isArray(payload.buttons)) items.push(...payload.buttons);
  if (payload.linkButtonLabel && payload.linkButtonUrl) items.push({ label: payload.linkButtonLabel, url: payload.linkButtonUrl });
  if (payload.linkButton2Label && payload.linkButton2Url) items.push({ label: payload.linkButton2Label, url: payload.linkButton2Url });

  return items
    .map((button) => ({
      label: String(button.label ?? "Open").trim().slice(0, 80) || "Open",
      url: String(button.url ?? "").trim()
    }))
    .filter((button) => /^https?:\/\//i.test(button.url))
    .slice(0, 5);
}

function normalizeChannelIds(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  return [...new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean))];
}

function normalizeScheduleAt(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throwHttpError(400, "scheduleAt must be a valid ISO date/time.");
  return date.toISOString();
}

function normalizeTemplateName(value) {
  const name = String(value ?? "").trim().slice(0, MAX_TEMPLATE_NAME);
  if (!name) throwHttpError(400, "Template name is required.");
  return name;
}

function normalizeConsoleCommand(command) {
  return String(command ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, MAX_CONSOLE_COMMAND_LENGTH);
}

function splitConsoleCommand(command) {
  return command.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) ?? [];
}

async function fetchOpsGuild(client, guildId) {
  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) throwHttpError(503, "Discord guild is not available. Check bot token, guild ID and gateway connection.");
  return guild;
}

async function hydrateGuild(guild) {
  await Promise.all([
    guild.channels.fetch().catch(() => null),
    guild.roles.fetch().catch(() => null),
    guild.members.fetch({ limit: 25 }).catch(() => null)
  ]);
}

async function fetchTextChannel(client, guildId, channelId) {
  const channel = await client.channels.fetch(String(channelId ?? "")).catch(() => null);
  if (!channel || channel.guildId !== guildId || !channel.isTextBased?.()) {
    throwHttpError(404, "Target channel is not a text channel in this guild.");
  }
  return channel;
}

function listTextChannels(guild) {
  return guild.channels.cache
    .filter((channel) => channel.isTextBased?.() && channel.type !== ChannelType.DM)
    .sort((left, right) => (left.rawPosition ?? 0) - (right.rawPosition ?? 0))
    .map((channel) => ({ id: channel.id, name: channel.name, type: channelTypeName(channel.type), parentId: channel.parentId ?? null }));
}

function listAllChannels(guild) {
  return guild.channels.cache
    .sort((left, right) => (left.rawPosition ?? 0) - (right.rawPosition ?? 0))
    .map((channel) => ({ id: channel.id, name: channel.name, type: channelTypeName(channel.type), searchText: `${channel.id} ${channel.name} ${channelTypeName(channel.type)}`.toLowerCase() }));
}

function listAllRoles(guild) {
  return guild.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort((left, right) => right.position - left.position)
    .map((role) => ({ id: role.id, name: role.name, position: role.position, managed: role.managed, searchText: `${role.id} ${role.name}`.toLowerCase() }));
}

async function searchMembers(guild, query, limit = 20) {
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || 20, 50));
  const searched = await guild.members.search({ query, limit: safeLimit }).catch(() => null);
  const members = searched ? [...searched.values()] : [...guild.members.cache.values()];
  const q = query.toLowerCase();
  return members
    .filter((member) => `${member.id} ${member.user?.tag ?? ""} ${member.displayName ?? ""}`.toLowerCase().includes(q))
    .slice(0, safeLimit)
    .map((member) => ({ id: member.id, tag: member.user?.tag ?? member.id, displayName: member.displayName ?? member.user?.username ?? member.id }));
}

function filterByQuery(items, query) {
  const q = String(query ?? "").trim().toLowerCase();
  return (q ? items.filter((item) => item.searchText?.includes(q)) : items).slice(0, 50);
}

function textOutput(lines) {
  return lines.map((line) => ({ type: "text", value: String(line) }));
}

function jsonOutput(value) {
  return [{ type: "json", value }];
}

function listOutput(items, formatter) {
  if (!items.length) return textOutput(["No results."]);
  return items.slice(0, MAX_CONSOLE_OUTPUT_ITEMS).map((item) => ({ type: "text", value: formatter(item) }));
}

function parseLimit(value, fallback, max) {
  return Math.max(1, Math.min(Number.parseInt(value, 10) || fallback, max));
}

function channelTypeName(type) {
  if (type === ChannelType.GuildText) return "text";
  if (type === ChannelType.GuildAnnouncement) return "announcement";
  if (type === ChannelType.GuildForum) return "forum";
  if (type === ChannelType.GuildVoice) return "voice";
  if (type === ChannelType.GuildCategory) return "category";
  return String(type ?? "unknown");
}

async function auditOpsAction(guild, store, actor, event) {
  return writeAuditLog(guild, {
    title: event.title,
    description: event.description,
    type: "bot-operations",
    source: "admin-web",
    actorUserId: actor?.id ?? null,
    actorTag: actorLabel(actor),
    channelId: event.channelId ?? null,
    relatedId: event.relatedId ?? null,
    metadata: event.metadata ?? {}
  }, { store });
}

function actorLabel(actor) {
  return actor?.email ?? actor?.tag ?? actor?.id ?? "admin-web";
}

function throwHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  throw error;
}
