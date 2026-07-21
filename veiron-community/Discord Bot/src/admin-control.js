import { ChannelType, PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { writeAuditLog } from "./audit-log.js";
import { createVireonEmbed } from "./embed-factory.js";

export const ADMIN_CONTROL_CHANNEL_TYPES = Object.freeze({
  text: ChannelType.GuildText,
  voice: ChannelType.GuildVoice,
  category: ChannelType.GuildCategory,
  forum: ChannelType.GuildForum,
  announcement: ChannelType.GuildAnnouncement
});

export const ADMIN_CONTROL_MODERATION_ACTIONS = Object.freeze([
  "warn",
  "timeout",
  "untimeout",
  "kick",
  "ban",
  "unban"
]);

const CASES_COLLECTION = "moderation-cases";
const TICKETS_COLLECTION = "tickets";
const SAFE_DELETE_CONFIRM_PREFIX = "DELETE ";
const MAX_REASON_LENGTH = 512;
const DEFAULT_MEMBER_LIMIT = 25;
const MAX_MEMBER_LIMIT = 100;
const MAX_PURGE_AMOUNT = 100;

export async function buildAdminControlOverview({ client, guildId }) {
  const guild = await fetchControlGuild(client, guildId);
  const me = guild.members.me;
  const botPermissions = me?.permissions ?? new PermissionsBitField(0n);

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    guild: summarizeGuild(guild),
    bot: {
      id: client.user?.id ?? null,
      tag: client.user?.tag ?? null,
      ready: Boolean(client.isReady?.()),
      manageable: Boolean(me),
      highestRole: me?.roles?.highest ? summarizeRole(me.roles.highest) : null,
      permissions: summarizePermissions(botPermissions),
      safety: buildSafetyReport(guild, botPermissions)
    },
    roles: listRoles(guild),
    channels: listChannels(guild),
    modules: buildControlModules(botPermissions),
    quickActions: [
      { key: "member-search", label: "Search Members", minimumRole: "MODERATOR", destructive: false },
      { key: "member-warn", label: "Warn Member", minimumRole: "MODERATOR", destructive: false },
      { key: "member-timeout", label: "Timeout Member", minimumRole: "MODERATOR", destructive: true },
      { key: "member-kick", label: "Kick Member", minimumRole: "MODERATOR", destructive: true },
      { key: "member-ban", label: "Ban Member", minimumRole: "MODERATOR", destructive: true },
      { key: "member-role", label: "Assign Member Role", minimumRole: "ADMIN", destructive: false },
      { key: "member-roles-bulk", label: "Bulk Member Roles", minimumRole: "ADMIN", destructive: false },
      { key: "purge", label: "Purge Channel", minimumRole: "MODERATOR", destructive: true },
      { key: "ticket-status", label: "Close/Reopen Ticket", minimumRole: "MODERATOR", destructive: false },
      { key: "message-send", label: "Send Message", minimumRole: "MODERATOR", destructive: false },
      { key: "role-create", label: "Create Role", minimumRole: "ADMIN", destructive: false },
      { key: "channel-create", label: "Create Channel", minimumRole: "ADMIN", destructive: false },
      { key: "channel-permissions", label: "Channel Permission Overwrites", minimumRole: "ADMIN", destructive: false },
      { key: "channel-reorder", label: "Reorder Channels", minimumRole: "ADMIN", destructive: false },
      { key: "structure-plan", label: "Bulk Structure Planner", minimumRole: "ADMIN", destructive: false },
      { key: "guild-update", label: "Update Guild Settings", minimumRole: "ADMIN", destructive: false }
    ]
  };
}

export async function listAdminControlMembers({ client, guildId, query = "", limit = DEFAULT_MEMBER_LIMIT }) {
  const guild = await fetchControlGuild(client, guildId);
  const normalizedQuery = String(query ?? "").trim();
  const safeLimit = Math.max(1, Math.min(Number.parseInt(limit, 10) || DEFAULT_MEMBER_LIMIT, MAX_MEMBER_LIMIT));

  let members = [];
  if (normalizedQuery) {
    const searched = await guild.members.search({ query: normalizedQuery, limit: safeLimit }).catch(() => null);
    members = searched ? [...searched.values()] : [];
  }

  if (members.length === 0) {
    const fetched = await guild.members.fetch({ limit: safeLimit }).catch(() => guild.members.cache);
    members = [...fetched.values()];
    if (normalizedQuery) {
      const q = normalizedQuery.toLowerCase();
      members = members.filter((member) => memberSearchText(member).includes(q));
    }
  }

  return {
    ok: true,
    query: normalizedQuery,
    limit: safeLimit,
    items: members.slice(0, safeLimit).map((member) => summarizeMember(member, guild))
  };
}

export async function createAdminRole({ client, guildId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const roleData = normalizeRolePayload(payload, { create: true });
  const role = await guild.roles.create({
    name: roleData.name,
    color: roleData.color,
    hoist: roleData.hoist,
    mentionable: roleData.mentionable,
    permissions: roleData.permissions,
    reason: roleData.reason
  });

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Role Created",
    description: `Created role ${role.name}.`,
    relatedId: role.id,
    metadata: { action: "role.create", role: summarizeRole(role), input: redactControlInput(roleData) }
  });

  return { ok: true, role: summarizeRole(role) };
}

export async function updateAdminRole({ client, guildId, roleId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const role = guild.roles.cache.get(roleId);
  assertEditableRole(guild, role);

  const roleData = normalizeRolePayload(payload, { create: false });
  await role.edit({
    name: roleData.name ?? undefined,
    color: roleData.color ?? undefined,
    hoist: roleData.hoist ?? undefined,
    mentionable: roleData.mentionable ?? undefined,
    permissions: roleData.permissions ?? undefined,
    reason: roleData.reason
  });

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Role Updated",
    description: `Updated role ${role.name}.`,
    relatedId: role.id,
    metadata: { action: "role.update", role: summarizeRole(role), input: redactControlInput(roleData) }
  });

  return { ok: true, role: summarizeRole(role) };
}

export async function deleteAdminRole({ client, guildId, roleId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const role = guild.roles.cache.get(roleId);
  assertEditableRole(guild, role);
  assertDeleteConfirmation(payload?.confirm, role.name);

  const summary = summarizeRole(role);
  await role.delete(normalizeReason(payload?.reason, `Admin web delete by ${actorLabel(actor)}.`));

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Role Deleted",
    description: `Deleted role ${summary.name}.`,
    relatedId: summary.id,
    metadata: { action: "role.delete", role: summary }
  });

  return { ok: true, deleted: summary };
}

export async function createAdminChannel({ client, guildId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const channelData = normalizeChannelPayload(payload, { create: true });
  const channel = await guild.channels.create({
    name: channelData.name,
    type: channelData.type,
    topic: channelData.topic || undefined,
    parent: channelData.parentId || undefined,
    nsfw: channelData.nsfw,
    reason: channelData.reason
  });

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Channel Created",
    description: `Created channel ${channel.name}.`,
    channelId: channel.id,
    relatedId: channel.id,
    metadata: { action: "channel.create", channel: summarizeChannel(channel), input: redactControlInput(channelData) }
  });

  return { ok: true, channel: summarizeChannel(channel) };
}

export async function updateAdminChannel({ client, guildId, channelId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const channel = guild.channels.cache.get(channelId);
  assertEditableChannel(channel);

  const channelData = normalizeChannelPayload(payload, { create: false });
  await channel.edit({
    name: channelData.name ?? undefined,
    topic: supportsTopic(channel) && channelData.topic !== undefined ? channelData.topic : undefined,
    parent: channelData.parentId ?? undefined,
    nsfw: typeof channelData.nsfw === "boolean" ? channelData.nsfw : undefined,
    reason: channelData.reason
  });

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Channel Updated",
    description: `Updated channel ${channel.name}.`,
    channelId: channel.id,
    relatedId: channel.id,
    metadata: { action: "channel.update", channel: summarizeChannel(channel), input: redactControlInput(channelData) }
  });

  return { ok: true, channel: summarizeChannel(channel) };
}

export async function deleteAdminChannel({ client, guildId, channelId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const channel = guild.channels.cache.get(channelId);
  assertEditableChannel(channel);
  assertDeleteConfirmation(payload?.confirm, channel.name);

  const summary = summarizeChannel(channel);
  await channel.delete(normalizeReason(payload?.reason, `Admin web delete by ${actorLabel(actor)}.`));

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Channel Deleted",
    description: `Deleted channel ${summary.name}.`,
    channelId: summary.id,
    relatedId: summary.id,
    metadata: { action: "channel.delete", channel: summary }
  });

  return { ok: true, deleted: summary };
}

export async function updateAdminGuildSettings({ client, guildId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const patch = normalizeGuildPatch(payload);
  if (Object.keys(patch).length === 0) {
    throwHttpError(400, "No supported guild settings were provided.");
  }

  const updated = await guild.edit({ ...patch, reason: normalizeReason(payload?.reason, `Admin web guild update by ${actorLabel(actor)}.`) });

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Guild Settings Updated",
    description: "Updated guild settings from Admin Web Control Center.",
    metadata: { action: "guild.update", patch }
  });

  return { ok: true, guild: summarizeGuild(updated) };
}

export async function sendAdminControlMessage({ client, guildId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const channel = await fetchGuildTextChannel(client, guildId, payload?.channelId);

  const mode = String(payload?.mode ?? "message").trim().toLowerCase();
  const content = String(payload?.content ?? "").trim().slice(0, 1900);
  const title = String(payload?.title ?? "").trim().slice(0, 256);
  const description = String(payload?.description ?? "").trim().slice(0, 4096);

  let message;
  if (mode === "embed") {
    if (!title || !description) throwHttpError(400, "Embed mode requires title and description.");
    message = await channel.send({
      content: content || undefined,
      embeds: [createVireonEmbed({ title, description, color: payload?.color })]
    });
  } else {
    if (!content) throwHttpError(400, "Message mode requires content.");
    message = await channel.send({ content });
  }

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Message Sent",
    description: `Sent ${mode === "embed" ? "embed" : "message"} in ${channel.name}.`,
    channelId: channel.id,
    relatedId: message.id,
    metadata: { action: "message.send", mode, channel: summarizeChannel(channel), messageId: message.id }
  });

  return { ok: true, messageId: message.id, channelId: channel.id };
}

export async function moderateMemberFromAdmin({ client, guildId, userId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const action = normalizeModerationAction(payload?.action);
  const reason = normalizeReason(payload?.reason, `Admin web ${action} by ${actorLabel(actor)}.`);
  const deleteMessageDays = Math.max(0, Math.min(Number.parseInt(payload?.deleteMessageDays ?? "0", 10) || 0, 7));
  const durationMinutes = Math.max(1, Math.min(Number.parseInt(payload?.durationMinutes ?? "10", 10) || 10, 40320));

  let member = await guild.members.fetch(userId).catch(() => null);
  let targetTag = member?.user?.tag ?? userId;

  if (["warn", "timeout", "untimeout", "kick"].includes(action) && !member) {
    throwHttpError(404, "Member not found in this guild.");
  }

  if (action === "timeout") {
    assertModeratableMember(member, "timeout");
    await member.timeout(durationMinutes * 60 * 1000, reason);
  } else if (action === "untimeout") {
    assertModeratableMember(member, "untimeout");
    await member.timeout(null, reason);
  } else if (action === "kick") {
    assertModeratableMember(member, "kick");
    await member.kick(reason);
  } else if (action === "ban") {
    if (!member) {
      const user = await client.users.fetch(userId).catch(() => null);
      targetTag = user?.tag ?? userId;
    }
    await guild.members.ban(userId, {
      reason,
      deleteMessageSeconds: deleteMessageDays * 24 * 60 * 60
    });
  } else if (action === "unban") {
    await guild.members.unban(userId, reason);
  }

  const caseItem = await store.add(CASES_COLLECTION, {
    guildId,
    moderatorUserId: actor?.id ?? null,
    moderatorTag: actorLabel(actor),
    channelId: payload?.channelId ?? null,
    type: action,
    targetUserId: userId,
    targetTag,
    reason,
    durationMinutes: action === "timeout" ? durationMinutes : undefined,
    deleteMessageDays: action === "ban" ? deleteMessageDays : undefined,
    source: "admin-web"
  });

  await auditControlAction(guild, store, actor, {
    title: `Admin Web Member ${actionLabel(action)}`,
    description: `Case ${caseItem.id}: ${action} ${targetTag}.`,
    relatedId: caseItem.id,
    targetUserId: userId,
    targetTag,
    metadata: { action: `member.${action}`, caseId: caseItem.id, durationMinutes, deleteMessageDays }
  });

  return { ok: true, action, case: caseItem, member: member ? summarizeMember(member, guild) : { id: userId, tag: targetTag } };
}

export async function updateMemberRoleFromAdmin({ client, guildId, userId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throwHttpError(404, "Member not found in this guild.");

  const role = guild.roles.cache.get(String(payload?.roleId ?? ""));
  assertEditableRole(guild, role);
  const action = String(payload?.action ?? "add").trim().toLowerCase();
  const reason = normalizeReason(payload?.reason, `Admin web role ${action} by ${actorLabel(actor)}.`);

  if (action === "add") {
    await member.roles.add(role.id, reason);
  } else if (action === "remove") {
    await member.roles.remove(role.id, reason);
  } else {
    throwHttpError(400, "Role action must be add or remove.");
  }

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Member Role Updated",
    description: `${action === "add" ? "Added" : "Removed"} ${role.name} ${action === "add" ? "to" : "from"} ${member.user.tag}.`,
    relatedId: role.id,
    targetUserId: member.id,
    targetTag: member.user.tag,
    metadata: { action: `member.role.${action}`, role: summarizeRole(role), member: summarizeMember(member, guild) }
  });

  return { ok: true, action, role: summarizeRole(role), member: summarizeMember(member, guild) };
}

export async function purgeChannelFromAdmin({ client, guildId, channelId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const channel = await fetchGuildTextChannel(client, guildId, channelId);
  if (typeof channel.bulkDelete !== "function") throwHttpError(400, "Target channel does not support bulk delete.");

  const amount = Math.max(1, Math.min(Number.parseInt(payload?.amount ?? "10", 10) || 10, MAX_PURGE_AMOUNT));
  const reason = normalizeReason(payload?.reason, `Admin web purge by ${actorLabel(actor)}.`);
  const deleted = await channel.bulkDelete(amount, true);

  const caseItem = await store.add(CASES_COLLECTION, {
    guildId,
    moderatorUserId: actor?.id ?? null,
    moderatorTag: actorLabel(actor),
    channelId: channel.id,
    type: "purge",
    targetUserId: "channel",
    targetTag: `#${channel.name}`,
    reason,
    messageCount: deleted.size,
    source: "admin-web"
  });

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Messages Purged",
    description: `Deleted ${deleted.size} message(s) from #${channel.name}. Case ${caseItem.id}.`,
    channelId: channel.id,
    relatedId: caseItem.id,
    metadata: { action: "channel.purge", requestedAmount: amount, deletedCount: deleted.size, caseId: caseItem.id }
  });

  return { ok: true, deletedCount: deleted.size, requestedAmount: amount, case: caseItem };
}

export async function updateTicketStatusFromAdmin({ client, guildId, ticketId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const status = String(payload?.status ?? "closed").trim().toLowerCase();
  if (!["open", "closed", "archived"].includes(status)) throwHttpError(400, "Ticket status must be open, closed or archived.");

  const ticket = await store.update(TICKETS_COLLECTION, (item) => item.id === ticketId, (item) => ({
    status,
    updatedByUserId: actor?.id ?? null,
    updatedByTag: actorLabel(actor),
    closedByUserId: status === "closed" ? actor?.id ?? null : item.closedByUserId ?? null,
    closedByTag: status === "closed" ? actorLabel(actor) : item.closedByTag ?? null,
    closedAt: status === "closed" ? new Date().toISOString() : item.closedAt ?? null,
    reopenedAt: status === "open" ? new Date().toISOString() : item.reopenedAt ?? null,
    archivedAt: status === "archived" ? new Date().toISOString() : item.archivedAt ?? null,
    adminNote: String(payload?.note ?? "").trim().slice(0, 512)
  }));

  if (!ticket) throwHttpError(404, "Ticket not found.");

  const channel = ticket.channelId ? await client.channels.fetch(ticket.channelId).catch(() => null) : null;
  if (channel?.guildId === guildId && channel.permissionOverwrites && ticket.userId) {
    await channel.permissionOverwrites.edit(ticket.userId, {
      SendMessages: status === "open",
      AddReactions: status === "open"
    }).catch(() => null);
  }

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Ticket Updated",
    description: `Ticket ${ticket.id} set to ${status}.`,
    channelId: ticket.channelId ?? null,
    relatedId: ticket.id,
    targetUserId: ticket.userId ?? null,
    targetTag: ticket.userTag ?? null,
    metadata: { action: "ticket.status", status, note: ticket.adminNote ?? "" }
  });

  return { ok: true, ticket };
}


export async function updateMemberRolesBulkFromAdmin({ client, guildId, userId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) throwHttpError(404, "Member not found in this guild.");

  const addRoleIds = normalizeIdList(payload.addRoleIds ?? payload.addRoles ?? []);
  const removeRoleIds = normalizeIdList(payload.removeRoleIds ?? payload.removeRoles ?? []);
  if (addRoleIds.length === 0 && removeRoleIds.length === 0) throwHttpError(400, "Select at least one role to add or remove.");

  const reason = normalizeReason(payload?.reason, `Admin web bulk role update by ${actorLabel(actor)}.`);
  const added = [];
  const removed = [];
  const skipped = [];

  for (const roleId of addRoleIds) {
    const role = guild.roles.cache.get(roleId);
    try {
      assertEditableRole(guild, role);
      await member.roles.add(role.id, reason);
      added.push(summarizeRole(role));
    } catch (error) {
      skipped.push({ roleId, action: "add", error: error.message });
    }
  }

  for (const roleId of removeRoleIds) {
    const role = guild.roles.cache.get(roleId);
    try {
      assertEditableRole(guild, role);
      await member.roles.remove(role.id, reason);
      removed.push(summarizeRole(role));
    } catch (error) {
      skipped.push({ roleId, action: "remove", error: error.message });
    }
  }

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Member Roles Bulk Updated",
    description: `Bulk role update for ${member.user.tag}: ${added.length} added, ${removed.length} removed, ${skipped.length} skipped.`,
    targetUserId: member.id,
    targetTag: member.user.tag,
    metadata: { action: "member.roles.bulk", added, removed, skipped }
  });

  return { ok: skipped.length === 0, added, removed, skipped, member: summarizeMember(member, guild) };
}

export async function setChannelPermissionOverwriteFromAdmin({ client, guildId, channelId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const channel = guild.channels.cache.get(channelId);
  assertEditableChannel(channel);
  if (!channel.permissionOverwrites?.edit) throwHttpError(400, "This channel does not support permission overwrites.");

  const targetId = String(payload.targetId ?? "").trim();
  if (!targetId) throwHttpError(400, "targetId is required for permission overwrites.");

  const allow = normalizePermissionNames(payload.allow ?? "");
  const deny = normalizePermissionNames(payload.deny ?? "");
  const reason = normalizeReason(payload?.reason, `Admin web channel permissions by ${actorLabel(actor)}.`);
  const patch = {};
  for (const permission of allow) patch[permission] = true;
  for (const permission of deny) patch[permission] = false;
  if (Object.keys(patch).length === 0) throwHttpError(400, "At least one allow or deny permission is required.");

  await channel.permissionOverwrites.edit(targetId, patch, { reason });

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Channel Permission Updated",
    description: `Updated permission overwrite on #${channel.name}.`,
    channelId: channel.id,
    relatedId: targetId,
    metadata: { action: "channel.permissions.overwrite", channel: summarizeChannel(channel), targetId, allow, deny }
  });

  return { ok: true, channel: summarizeChannel(channel), targetId, allow, deny };
}

export async function reorderChannelFromAdmin({ client, guildId, channelId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const channel = guild.channels.cache.get(channelId);
  assertEditableChannel(channel);
  if (typeof channel.setPosition !== "function") throwHttpError(400, "This channel does not support position updates.");
  const position = Math.max(0, Math.min(Number.parseInt(payload.position ?? "0", 10) || 0, 500));
  const reason = normalizeReason(payload?.reason, `Admin web channel reorder by ${actorLabel(actor)}.`);
  await channel.setPosition(position, { reason });

  await auditControlAction(guild, store, actor, {
    title: "Admin Web Channel Reordered",
    description: `Moved #${channel.name} to position ${position}.`,
    channelId: channel.id,
    metadata: { action: "channel.reorder", channelId: channel.id, position }
  });

  return { ok: true, channel: summarizeChannel(channel), position };
}

export async function applyAdminStructurePlan({ client, guildId, payload = {}, actor, store }) {
  const guild = await fetchControlGuild(client, guildId);
  const dryRun = payload.dryRun !== false;
  const plan = normalizeStructurePlan(payload);
  const result = { ok: true, dryRun, roles: [], categories: [], channels: [], skipped: [] };

  for (const rolePayload of plan.roles) {
    try {
      const roleData = normalizeRolePayload(rolePayload, { create: true });
      const existing = guild.roles.cache.find((role) => role.name.toLowerCase() === roleData.name.toLowerCase());
      if (existing) {
        result.roles.push({ action: "reuse", role: summarizeRole(existing) });
        continue;
      }
      if (dryRun) {
        result.roles.push({ action: "would_create", input: redactControlInput(roleData) });
        continue;
      }
      const role = await guild.roles.create(roleData);
      result.roles.push({ action: "created", role: summarizeRole(role) });
    } catch (error) {
      result.skipped.push({ type: "role", input: rolePayload, error: error.message });
    }
  }

  const categoryByName = new Map(guild.channels.cache.filter((channel) => channel.type === ADMIN_CONTROL_CHANNEL_TYPES.category).map((channel) => [channel.name.toLowerCase(), channel]));
  for (const categoryPayload of plan.categories) {
    try {
      const categoryData = normalizeChannelPayload({ ...categoryPayload, type: "category" }, { create: true });
      const existing = categoryByName.get(categoryData.name.toLowerCase());
      if (existing) {
        result.categories.push({ action: "reuse", channel: summarizeChannel(existing) });
        continue;
      }
      if (dryRun) {
        result.categories.push({ action: "would_create", input: redactControlInput(categoryData) });
        continue;
      }
      const category = await guild.channels.create({ name: categoryData.name, type: categoryData.type, reason: categoryData.reason });
      categoryByName.set(category.name.toLowerCase(), category);
      result.categories.push({ action: "created", channel: summarizeChannel(category) });
    } catch (error) {
      result.skipped.push({ type: "category", input: categoryPayload, error: error.message });
    }
  }

  for (const channelPayload of plan.channels) {
    try {
      const channelData = normalizeChannelPayload(channelPayload, { create: true });
      const parentName = String(channelPayload.parentName ?? "").trim().toLowerCase();
      const parent = channelData.parentId ? guild.channels.cache.get(channelData.parentId) : parentName ? categoryByName.get(parentName) : null;
      const existing = guild.channels.cache.find((channel) => channel.name.toLowerCase() === channelData.name.toLowerCase() && (parent ? channel.parentId === parent.id : true));
      if (existing) {
        result.channels.push({ action: "reuse", channel: summarizeChannel(existing) });
        continue;
      }
      if (dryRun) {
        result.channels.push({ action: "would_create", input: { ...redactControlInput(channelData), parentName: channelPayload.parentName ?? null } });
        continue;
      }
      const channel = await guild.channels.create({
        name: channelData.name,
        type: channelData.type,
        topic: channelData.topic || undefined,
        parent: parent?.id ?? channelData.parentId ?? undefined,
        nsfw: channelData.nsfw,
        reason: channelData.reason
      });
      result.channels.push({ action: "created", channel: summarizeChannel(channel) });
    } catch (error) {
      result.skipped.push({ type: "channel", input: channelPayload, error: error.message });
    }
  }

  await auditControlAction(guild, store, actor, {
    title: dryRun ? "Admin Web Structure Plan Previewed" : "Admin Web Structure Plan Applied",
    description: `${dryRun ? "Previewed" : "Applied"} structure plan: ${result.roles.length} role item(s), ${result.categories.length} category item(s), ${result.channels.length} channel item(s), ${result.skipped.length} skipped.`,
    metadata: { action: dryRun ? "structure.preview" : "structure.apply", counts: { roles: result.roles.length, categories: result.categories.length, channels: result.channels.length, skipped: result.skipped.length } }
  });

  return result;
}

export function normalizeRolePayload(payload = {}, { create = false } = {}) {
  const result = {};
  const rawName = String(payload.name ?? "").trim();
  if (create || rawName) result.name = normalizeName(payload.name, "Role name", { min: 2, max: 100 });

  const rawColor = String(payload.color ?? "").trim();
  if (create || rawColor) result.color = normalizeColor(rawColor || "#d4af37");

  if (payload.hoist !== undefined || create) result.hoist = Boolean(payload.hoist);
  if (payload.mentionable !== undefined || create) result.mentionable = Boolean(payload.mentionable);
  if (payload.permissions !== undefined) result.permissions = normalizePermissionNames(payload.permissions);
  if (create && result.permissions === undefined) result.permissions = [];
  result.reason = normalizeReason(payload.reason, create ? "Admin web role create." : "Admin web role update.");
  return result;
}

export function normalizeChannelPayload(payload = {}, { create = false } = {}) {
  const result = {};
  const rawName = String(payload.name ?? "").trim();
  if (create || rawName) {
    result.name = normalizeName(payload.name, "Channel name", { min: 2, max: 100 }).replace(/\s+/g, "-").toLowerCase();
  }

  if (create || payload.type !== undefined) {
    const typeKey = String(payload.type ?? "text").trim().toLowerCase();
    if (!(typeKey in ADMIN_CONTROL_CHANNEL_TYPES)) throwHttpError(400, `Unsupported channel type: ${typeKey}.`);
    result.type = ADMIN_CONTROL_CHANNEL_TYPES[typeKey];
    result.typeKey = typeKey;
  }

  if (payload.topic !== undefined || create) result.topic = String(payload.topic ?? "").trim().slice(0, 1024);
  if (payload.parentId !== undefined) result.parentId = String(payload.parentId ?? "").trim() || null;
  if (payload.nsfw !== undefined) result.nsfw = Boolean(payload.nsfw);
  result.reason = normalizeReason(payload.reason, create ? "Admin web channel create." : "Admin web channel update.");
  return result;
}

export function normalizeModerationAction(value) {
  const action = String(value ?? "warn").trim().toLowerCase();
  if (!ADMIN_CONTROL_MODERATION_ACTIONS.includes(action)) {
    throwHttpError(400, `Unsupported moderation action: ${action}.`);
  }
  return action;
}

function normalizeGuildPatch(payload = {}) {
  const patch = {};
  if (payload.name !== undefined && String(payload.name).trim()) patch.name = normalizeName(payload.name, "Guild name", { min: 2, max: 100 });
  if (payload.description !== undefined) patch.description = String(payload.description ?? "").trim().slice(0, 120);
  if (payload.preferredLocale !== undefined) patch.preferredLocale = String(payload.preferredLocale ?? "").trim().slice(0, 32) || undefined;
  for (const key of ["systemChannelId", "rulesChannelId", "publicUpdatesChannelId"]) {
    if (payload[key] !== undefined) patch[key] = String(payload[key] ?? "").trim() || null;
  }
  return patch;
}

async function fetchControlGuild(client, guildId) {
  const guild = await client.guilds.fetch(guildId);
  await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
    guild.members.fetchMe().catch(() => null)
  ]);
  return guild;
}

async function fetchGuildTextChannel(client, guildId, channelId) {
  const channel = await client.channels.fetch(String(channelId ?? "").trim()).catch(() => null);
  if (!channel || channel.guildId !== guildId || !channel.isTextBased()) {
    throwHttpError(400, "Target channel must be a text-based channel from this guild.");
  }
  return channel;
}

function summarizeGuild(guild) {
  return {
    id: guild.id,
    name: guild.name,
    description: guild.description ?? null,
    ownerId: guild.ownerId ?? null,
    memberCount: guild.memberCount ?? null,
    preferredLocale: guild.preferredLocale ?? null,
    verificationLevel: String(guild.verificationLevel ?? "unknown"),
    premiumTier: String(guild.premiumTier ?? "unknown"),
    systemChannelId: guild.systemChannelId ?? null,
    rulesChannelId: guild.rulesChannelId ?? null,
    publicUpdatesChannelId: guild.publicUpdatesChannelId ?? null,
    channels: guild.channels?.cache?.size ?? 0,
    roles: guild.roles?.cache?.size ?? 0
  };
}

function listRoles(guild) {
  return guild.roles.cache
    .filter((role) => role.id !== guild.id)
    .sort((left, right) => right.position - left.position)
    .map(summarizeRole);
}

function listChannels(guild) {
  return guild.channels.cache
    .sort((left, right) => (left.rawPosition ?? 0) - (right.rawPosition ?? 0))
    .map(summarizeChannel);
}

function summarizeRole(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    hoist: role.hoist,
    managed: role.managed,
    mentionable: role.mentionable,
    position: role.position,
    permissions: role.permissions?.toArray?.() ?? []
  };
}

function summarizeChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channelTypeName(channel.type),
    parentId: channel.parentId ?? null,
    position: channel.rawPosition ?? channel.position ?? 0,
    topic: supportsTopic(channel) ? channel.topic ?? "" : "",
    nsfw: Boolean(channel.nsfw),
    manageable: Boolean(channel.manageable ?? true)
  };
}

function summarizeMember(member, guild) {
  const permissions = member.permissions ?? new PermissionsBitField(0n);
  return {
    id: member.id,
    tag: member.user?.tag ?? member.displayName ?? member.id,
    username: member.user?.username ?? null,
    displayName: member.displayName ?? null,
    avatarUrl: member.displayAvatarURL?.({ size: 128 }) ?? member.user?.displayAvatarURL?.({ size: 128 }) ?? null,
    joinedAt: member.joinedAt?.toISOString?.() ?? null,
    createdAt: member.user?.createdAt?.toISOString?.() ?? null,
    bot: Boolean(member.user?.bot),
    timeoutUntil: member.communicationDisabledUntil?.toISOString?.() ?? null,
    manageable: Boolean(member.manageable ?? false),
    kickable: Boolean(member.kickable ?? false),
    bannable: Boolean(member.bannable ?? false),
    highestRole: member.roles?.highest ? summarizeRole(member.roles.highest) : null,
    roles: member.roles?.cache
      ?.filter((role) => role.id !== guild.id)
      ?.sort((left, right) => right.position - left.position)
      ?.map(summarizeRole) ?? [],
    permissions: summarizePermissions(permissions)
  };
}

function summarizePermissions(permissions) {
  return {
    administrator: permissions.has(PermissionFlagsBits.Administrator),
    manageGuild: permissions.has(PermissionFlagsBits.ManageGuild),
    manageChannels: permissions.has(PermissionFlagsBits.ManageChannels),
    manageRoles: permissions.has(PermissionFlagsBits.ManageRoles),
    manageMessages: permissions.has(PermissionFlagsBits.ManageMessages),
    moderateMembers: permissions.has(PermissionFlagsBits.ModerateMembers),
    kickMembers: permissions.has(PermissionFlagsBits.KickMembers),
    banMembers: permissions.has(PermissionFlagsBits.BanMembers),
    viewAuditLog: permissions.has(PermissionFlagsBits.ViewAuditLog)
  };
}

function buildControlModules(permissions) {
  const flags = summarizePermissions(permissions);
  const adminAll = flags.administrator;
  return {
    guildSettings: adminAll || flags.manageGuild,
    roleManagement: adminAll || flags.manageRoles,
    channelManagement: adminAll || flags.manageChannels,
    messageSend: adminAll || flags.manageMessages,
    purge: adminAll || flags.manageMessages,
    timeout: adminAll || flags.moderateMembers,
    kick: adminAll || flags.kickMembers,
    ban: adminAll || flags.banMembers,
    auditLog: adminAll || flags.viewAuditLog
  };
}

function buildSafetyReport(guild, permissions) {
  const flags = summarizePermissions(permissions);
  return {
    ok: flags.administrator || (flags.manageGuild && flags.manageChannels && flags.manageRoles && flags.manageMessages && flags.moderateMembers),
    warnings: [
      !flags.manageGuild ? "Bot lacks Manage Server for guild setting updates." : null,
      !flags.manageChannels ? "Bot lacks Manage Channels for channel control." : null,
      !flags.manageRoles ? "Bot lacks Manage Roles for role control." : null,
      !flags.manageMessages ? "Bot lacks Manage Messages for purge/message controls." : null,
      !flags.moderateMembers ? "Bot lacks Moderate Members for timeout controls." : null,
      !flags.kickMembers ? "Bot lacks Kick Members for kick controls." : null,
      !flags.banMembers ? "Bot lacks Ban Members for ban/unban controls." : null,
      !guild.members.me?.roles?.highest ? "Bot highest role could not be resolved." : null
    ].filter(Boolean)
  };
}

function assertEditableRole(guild, role) {
  if (!role) throwHttpError(404, "Role not found.");
  if (role.managed || role.id === guild.id) throwHttpError(400, "Managed/default roles cannot be edited from Admin Web.");
  if (guild.members.me?.roles?.highest && role.position >= guild.members.me.roles.highest.position) {
    throwHttpError(403, "Bot cannot edit a role at or above its highest role.");
  }
}

function assertEditableChannel(channel) {
  if (!channel) throwHttpError(404, "Channel not found.");
  if (channel.manageable === false) throwHttpError(403, "Bot cannot manage this channel.");
}

function assertModeratableMember(member, action) {
  if (!member) throwHttpError(404, "Member not found.");
  if (action === "kick" && !member.kickable) throwHttpError(403, "Bot cannot kick this member. Check role hierarchy and permissions.");
  if (["timeout", "untimeout"].includes(action) && !member.moderatable) throwHttpError(403, "Bot cannot timeout this member. Check role hierarchy and permissions.");
}

function assertDeleteConfirmation(confirm, resourceName) {
  const expected = `${SAFE_DELETE_CONFIRM_PREFIX}${resourceName}`;
  if (String(confirm ?? "").trim() !== expected) {
    const error = new Error(`Destructive action requires confirmation: ${expected}`);
    error.statusCode = 400;
    error.code = "CONFIRMATION_REQUIRED";
    throw error;
  }
}


function normalizeIdList(value) {
  const raw = Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/);
  return [...new Set(raw.map((item) => String(item ?? "").trim()).filter(Boolean))].slice(0, 100);
}

function normalizeStructurePlan(payload = {}) {
  const parseMaybeJson = (value, fallback) => {
    if (Array.isArray(value)) return value;
    if (!value) return fallback;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : fallback;
      } catch {
        throwHttpError(400, "Structure plan JSON is invalid.");
      }
    }
    return fallback;
  };

  const roles = parseMaybeJson(payload.roles, []);
  const categories = parseMaybeJson(payload.categories, []);
  const channels = parseMaybeJson(payload.channels, []);
  if (roles.length > 50) throwHttpError(400, "Structure plan supports up to 50 roles per apply.");
  if (categories.length > 50) throwHttpError(400, "Structure plan supports up to 50 categories per apply.");
  if (channels.length > 100) throwHttpError(400, "Structure plan supports up to 100 channels per apply.");
  return { roles, categories, channels };
}

function normalizeName(value, label, { min, max }) {
  const name = String(value ?? "").trim();
  if (name.length < min || name.length > max) throwHttpError(400, `${label} must be between ${min} and ${max} characters.`);
  return name;
}

function normalizeColor(value) {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const color = String(value ?? "#d4af37").trim();
  if (/^#[0-9a-f]{6}$/i.test(color)) return Number.parseInt(color.slice(1), 16);
  if (/^0x[0-9a-f]{6}$/i.test(color)) return Number.parseInt(color.slice(2), 16);
  throwHttpError(400, "Color must be a hex color like #d4af37.");
}

function normalizePermissionNames(value) {
  const list = Array.isArray(value) ? value : String(value ?? "").split(/[\n,]/g);
  return list
    .map((item) => String(item ?? "").trim())
    .filter(Boolean)
    .filter((item) => Object.prototype.hasOwnProperty.call(PermissionFlagsBits, item));
}

function normalizeReason(value, fallback) {
  const reason = String(value ?? fallback ?? "Admin web action.").trim() || String(fallback ?? "Admin web action.");
  return reason.slice(0, MAX_REASON_LENGTH);
}

function supportsTopic(channel) {
  return "topic" in channel;
}

function channelTypeName(type) {
  for (const [key, value] of Object.entries(ADMIN_CONTROL_CHANNEL_TYPES)) {
    if (value === type) return key;
  }
  return String(type);
}

function memberSearchText(member) {
  return [member.id, member.displayName, member.nickname, member.user?.tag, member.user?.username]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function actorLabel(actor) {
  return actor?.email ?? actor?.id ?? "unknown admin";
}

function actionLabel(action) {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function redactControlInput(input) {
  const clone = { ...(input ?? {}) };
  delete clone.reason;
  return clone;
}

async function auditControlAction(guild, store, actor, event) {
  await writeAuditLog(guild, {
    title: event.title,
    description: event.description,
    color: event.color ?? 0xd4af37,
    type: "admin-control",
    source: "admin-web",
    actorUserId: actor?.id ?? null,
    actorTag: actor?.email ?? null,
    targetUserId: event.targetUserId ?? null,
    targetTag: event.targetTag ?? null,
    channelId: event.channelId ?? null,
    relatedId: event.relatedId ?? null,
    metadata: event.metadata ?? {}
  }, { store });
}

function throwHttpError(statusCode, message, code = undefined) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  throw error;
}
