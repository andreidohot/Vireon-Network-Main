import express from "express";
import helmet from "helmet";
import { ChannelType } from "discord.js";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AdminAuthService, createAuthMiddleware, requireRole } from "./admin-auth.js";
import { searchAuditEvents } from "./audit-log.js";
import {
  buildAdminControlOverview,
  createAdminChannel,
  createAdminRole,
  deleteAdminChannel,
  deleteAdminRole,
  applyAdminStructurePlan,
  listAdminControlMembers,
  moderateMemberFromAdmin,
  purgeChannelFromAdmin,
  reorderChannelFromAdmin,
  sendAdminControlMessage,
  setChannelPermissionOverwriteFromAdmin,
  updateAdminChannel,
  updateAdminGuildSettings,
  updateAdminRole,
  updateMemberRoleFromAdmin,
  updateMemberRolesBulkFromAdmin,
  updateTicketStatusFromAdmin
} from "./admin-control.js";
import { normalizeAutomodSettings } from "./automod.js";
import {
  buildAutomationStudioOverview,
  createOrUpdateAutomationFlow,
  deleteAutomationFlowFromWeb,
  previewAutomationFlow,
  testAutomationFlow
} from "./automations-studio.js";
import {
  buildBotOperationsOverview,
  deleteMessageTemplate,
  listMessageApprovals,
  listMessagePushes,
  listMessageTemplates,
  previewMessagePayload,
  requestMessageApproval,
  reviewMessageApproval,
  runBotConsoleCommand,
  saveMessageTemplate,
  sendMessagePush,
  startMessagePushScheduler
} from "./bot-operations.js";
import { getBlockchainDashboardStatus } from "./blockchain-monitor.js";
import { buildCommandCenterOverview } from "./command-center.js";
import { getSettings, updateSettings } from "./config.js";
import {
  buildCustomControlsOverview,
  createOrUpdateCustomCommand,
  createOrUpdateCustomInteraction,
  deleteCustomCommandFromWeb,
  deleteCustomInteractionFromWeb,
  listCustomCommands,
  listCustomControlEvents,
  listCustomInteractions
} from "./custom-controls.js";
import { createVireonEmbed } from "./embed-factory.js";
import {
  buildModuleCenterOverview,
  exportModuleBundle,
  importModuleBundle,
  listModuleCenterEvents,
  setModuleState
} from "./module-center.js";
import { normalizeEconomySettings } from "./economy.js";
import { buildHealthStatus } from "./health.js";
import { childLogger, serializeError } from "./logger.js";
import { normalizePermissionPolicies } from "./permission-controller.js";
import {
  configureWebPush,
  deletePushSubscription,
  getPushConfig,
  savePushSubscription,
  sendPushNotification
} from "./push-notifications.js";
import { normalizeXpSettings } from "./xp-leveling.js";
import { finalizeSetupWizard, getSetupWizardPublicConfig, getSetupWizardStatus } from "./runtime-config.js";

const logger = childLogger({ module: "admin-panel" });

export const ADMIN_ROUTE_ROLES = Object.freeze({
  "GET /auth/me": "VIEWER",
  "POST /auth/totp/setup": "VIEWER",
  "POST /auth/totp/confirm": "VIEWER",
  "POST /auth/totp/disable": "VIEWER",
  "GET /api/dashboard/summary": "VIEWER",
  "GET /api/guild": "VIEWER",
  "GET /api/control/overview": "VIEWER",
  "GET /api/control/members": "MODERATOR",
  "POST /api/control/members/:userId/moderation": "MODERATOR",
  "POST /api/control/members/:userId/roles": "ADMIN",
  "POST /api/control/members/:userId/roles/bulk": "ADMIN",
  "POST /api/control/channels/:channelId/purge": "MODERATOR",
  "POST /api/control/channels/:channelId/permissions": "ADMIN",
  "PATCH /api/control/channels/:channelId/position": "ADMIN",
  "POST /api/control/tickets/:ticketId/status": "MODERATOR",
  "POST /api/control/roles": "ADMIN",
  "PATCH /api/control/roles/:roleId": "ADMIN",
  "POST /api/control/roles/:roleId/delete": "ADMIN",
  "POST /api/control/channels": "ADMIN",
  "PATCH /api/control/channels/:channelId": "ADMIN",
  "POST /api/control/channels/:channelId/delete": "ADMIN",
  "PATCH /api/control/guild": "ADMIN",
  "POST /api/control/structure/plan": "ADMIN",
  "POST /api/control/messages/send": "MODERATOR",
  "GET /api/operations/overview": "MODERATOR",
  "POST /api/operations/console": "MODERATOR",
  "POST /api/operations/messages/preview": "MODERATOR",
  "POST /api/operations/messages/push": "ADMIN",
  "GET /api/operations/messages/pushes": "MODERATOR",
  "GET /api/operations/messages/approvals": "MODERATOR",
  "POST /api/operations/messages/approvals": "MODERATOR",
  "POST /api/operations/messages/approvals/:approvalId/review": "ADMIN",
  "GET /api/operations/templates": "MODERATOR",
  "POST /api/operations/templates": "MODERATOR",
  "POST /api/operations/templates/:templateId/delete": "ADMIN",
  "GET /api/custom/overview": "MODERATOR",
  "GET /api/custom/commands": "MODERATOR",
  "POST /api/custom/commands": "ADMIN",
  "POST /api/custom/commands/:commandId/delete": "ADMIN",
  "GET /api/custom/interactions": "MODERATOR",
  "POST /api/custom/interactions": "ADMIN",
  "POST /api/custom/interactions/:interactionId/delete": "ADMIN",
  "GET /api/custom/events": "MODERATOR",
  "GET /api/automations/overview": "MODERATOR",
  "POST /api/automations/preview": "MODERATOR",
  "POST /api/automations/test": "ADMIN",
  "POST /api/automations/flows": "ADMIN",
  "POST /api/automations/flows/:flowId/delete": "ADMIN",
  "GET /api/modules/overview": "MODERATOR",
  "GET /api/modules/events": "MODERATOR",
  "GET /api/commands/overview": "MODERATOR",
  "POST /api/modules/:moduleId/state": "ADMIN",
  "POST /api/modules/export": "ADMIN",
  "POST /api/modules/import": "ADMIN",
  "GET /api/settings": "VIEWER",
  "GET /api/permissions": "VIEWER",
  "PATCH /api/settings": "ADMIN",
  "PATCH /api/permissions": "ADMIN",
  "PATCH /api/xp/settings": "ADMIN",
  "PATCH /api/economy/settings": "ADMIN",
  "PATCH /api/automod/settings": "ADMIN",
  "GET /api/moderation/cases": "MODERATOR",
  "GET /api/tickets": "MODERATOR",
  "GET /api/audit/events": "MODERATOR",
  "GET /api/automod/events": "MODERATOR",
  "GET /api/anti-spam/events": "MODERATOR",
  "GET /api/proposals": "VIEWER",
  "GET /api/announcements": "VIEWER",
  "GET /api/blockchain/status": "VIEWER",
  "GET /api/wallets": "VIEWER",
  "GET /api/push/public-key": "VIEWER",
  "POST /api/push/subscriptions": "VIEWER",
  "DELETE /api/push/subscriptions": "VIEWER",
  "POST /api/push/test": "ADMIN",
  "POST /api/embeds/send": "ADMIN"
});

export async function startAdminPanel({ client, guildId, store, permissions = null, musicManager, chainClient, walletRegistration = null, setupWizardStatus = null }) {
  if (process.env.ADMIN_PANEL_ENABLED !== "true") {
    return null;
  }

  const setupStatus = setupWizardStatus ?? await getSetupWizardStatus();
  const setupActive = Boolean(setupStatus.required);
  const authService = new AdminAuthService();
  if (!setupActive) {
    await authService.ensureDefaultSuperAdmin();
    configureWebPush();
  }

  const messagePushScheduler = setupActive ? null : startMessagePushScheduler({ client, guildId, store });

  const app = express();
  app.use(helmet());
  app.use(express.json({ limit: process.env.ADMIN_JSON_LIMIT ?? "128kb" }));

  const dashboardDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard", "dist");
  const dashboardIndex = path.join(dashboardDir, "index.html");
  if (!existsSync(dashboardIndex)) {
    throw new Error("Dashboard build is missing. Run `npm run dashboard:build` before enabling the admin panel.");
  }

  app.use("/admin", express.static(dashboardDir));
  app.get("/", (_request, response) => response.redirect("/admin/"));
  app.get("/admin", (_request, response) => response.redirect("/admin/"));
  app.get("/admin/*", (_request, response) => response.sendFile(dashboardIndex));

  app.get("/setup/status", asyncRoute(async (_request, response) => {
    const status = await getSetupWizardStatus();
    response.json({ ok: true, ...status, publicConfig: getSetupWizardPublicConfig() });
  }));

  app.post("/setup/finalize", asyncRoute(async (request, response) => {
    const result = await finalizeSetupWizard({ payload: request.body ?? {} });
    response.status(201).json(result);
    if (result.restartRequired) {
      logger.warn("Setup wizard finalized. Restarting process so Docker/systemd can start the normal bot runtime.");
      setTimeout(() => process.exit(0), 600).unref?.();
    }
  }));

  app.get("/pay/:token", asyncRoute(async (request, response) => {
    response.redirect(302, `/admin/pay/${encodeURIComponent(request.params.token)}`);
  }));

  app.get("/payment-links/:token.json", asyncRoute(async (request, response) => {
    if (!walletRegistration) {
      response.status(503).json({ ok: false, error: "Wallet registration service is not available." });
      return;
    }
    const data = await walletRegistration.getPaymentLinkData(request.params.token);
    if (!data) {
      response.status(404).json({ ok: false, error: "Payment link not found." });
      return;
    }
    response.json(data);
  }));

  app.post("/payment-links/:token/withdrawals", asyncRoute(async (request, response) => {
    if (!walletRegistration) {
      response.status(503).json({ ok: false, error: "Wallet registration service is not available." });
      return;
    }
    const result = await walletRegistration.requestWithdrawal({
      token: request.params.token,
      toAddress: request.body?.toAddress,
      amount: request.body?.amount,
      asset: request.body?.asset
    });
    response.status(201).json(result);
  }));

  const auth = createAuthMiddleware(authService);
  const role = (method, route) => requireConfiguredRouteRole(method, route);

  app.get("/health", asyncRoute(async (_request, response) => {
    const status = await buildHealthStatus({ client, store, musicManager, chainClient });
    response.status(status.ok ? 200 : 503).json(status);
  }));

  app.post("/auth/login", asyncRoute(async (request, response) => {
    if (setupActive) {
      response.status(423).json({ ok: false, error: "Setup wizard must be finalized before admin login is available.", code: "setup_required" });
      return;
    }
    const result = await authService.login(request.body ?? {});
    response.json({ ok: true, ...result });
  }));

  app.post("/auth/refresh", asyncRoute(async (request, response) => {
    if (setupActive) {
      response.status(423).json({ ok: false, error: "Setup wizard must be finalized before token refresh is available.", code: "setup_required" });
      return;
    }
    const result = await authService.refresh(request.body?.refreshToken);
    response.json({ ok: true, ...result });
  }));

  app.post("/auth/logout", asyncRoute(async (request, response) => {
    await authService.logout(request.body?.refreshToken);
    response.json({ ok: true });
  }));

  app.get("/auth/me", auth, role("GET", "/auth/me"), asyncRoute(async (request, response) => {
    response.json({ ok: true, user: request.adminUser });
  }));

  app.post("/auth/totp/setup", auth, role("POST", "/auth/totp/setup"), asyncRoute(async (request, response) => {
    const result = await authService.setupTotp(request.adminUser.id);
    response.json({ ok: true, ...result });
  }));

  app.post("/auth/totp/confirm", auth, role("POST", "/auth/totp/confirm"), asyncRoute(async (request, response) => {
    const user = await authService.confirmTotp(request.adminUser.id, request.body?.code);
    response.json({ ok: true, user });
  }));

  app.post("/auth/totp/disable", auth, role("POST", "/auth/totp/disable"), asyncRoute(async (request, response) => {
    const user = await authService.disableTotp(request.adminUser.id, request.body?.code);
    response.json({ ok: true, user });
  }));

  app.use("/api", auth);

  app.get("/api/dashboard/summary", role("GET", "/api/dashboard/summary"), asyncRoute(async (_request, response) => {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    await guild.roles.fetch();

    const [cases, tickets, proposals, announcements, automodEvents, spamEvents, auditEvents] = await Promise.all([
      store.list("moderation-cases"),
      store.list("tickets"),
      store.list("proposals"),
      store.list("announcements"),
      store.list("automod-events"),
      store.list("spam-events"),
      store.list("audit-events")
    ]);

    response.json({
      ok: true,
      guild: {
        id: guild.id,
        name: guild.name,
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size,
        members: guild.memberCount
      },
      counts: {
        moderationCases: cases.length,
        openTickets: tickets.filter((item) => item.status === "open").length,
        proposals: proposals.length,
        announcements: announcements.length,
        automodEvents: automodEvents.length,
        spamEvents: spamEvents.length,
        auditEvents: auditEvents.length,
        scheduledAnnouncements: announcements.filter((item) => item.scheduledAt && !item.published).length
      }
    });
  }));

  app.get("/api/guild", role("GET", "/api/guild"), asyncRoute(async (_request, response) => {
    const guild = await client.guilds.fetch(guildId);
    await guild.channels.fetch();
    await guild.roles.fetch();

    response.json({
      id: guild.id,
      name: guild.name,
      channels: guild.channels.cache
        .filter((channel) => channel.type === ChannelType.GuildText)
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          parentId: channel.parentId
        })),
      roles: guild.roles.cache
        .filter((roleItem) => roleItem.id !== guild.id && !roleItem.managed)
        .sort((left, right) => right.position - left.position)
        .map((roleItem) => ({
          id: roleItem.id,
          name: roleItem.name,
          position: roleItem.position,
          color: roleItem.hexColor,
          managed: roleItem.managed
        }))
    });
  }));

  app.get("/api/control/overview", role("GET", "/api/control/overview"), asyncRoute(async (_request, response) => {
    response.json(await buildAdminControlOverview({ client, guildId }));
  }));

  app.post("/api/control/roles", role("POST", "/api/control/roles"), asyncRoute(async (request, response) => {
    const result = await createAdminRole({ client, guildId, payload: request.body, actor: request.adminUser, store });
    response.status(201).json(result);
  }));

  app.patch("/api/control/roles/:roleId", role("PATCH", "/api/control/roles/:roleId"), asyncRoute(async (request, response) => {
    response.json(await updateAdminRole({ client, guildId, roleId: request.params.roleId, payload: request.body, actor: request.adminUser, store }));
  }));

  app.post("/api/control/roles/:roleId/delete", role("POST", "/api/control/roles/:roleId/delete"), asyncRoute(async (request, response) => {
    response.json(await deleteAdminRole({ client, guildId, roleId: request.params.roleId, payload: request.body, actor: request.adminUser, store }));
  }));

  app.post("/api/control/channels", role("POST", "/api/control/channels"), asyncRoute(async (request, response) => {
    const result = await createAdminChannel({ client, guildId, payload: request.body, actor: request.adminUser, store });
    response.status(201).json(result);
  }));

  app.patch("/api/control/channels/:channelId", role("PATCH", "/api/control/channels/:channelId"), asyncRoute(async (request, response) => {
    response.json(await updateAdminChannel({ client, guildId, channelId: request.params.channelId, payload: request.body, actor: request.adminUser, store }));
  }));

  app.post("/api/control/channels/:channelId/delete", role("POST", "/api/control/channels/:channelId/delete"), asyncRoute(async (request, response) => {
    response.json(await deleteAdminChannel({ client, guildId, channelId: request.params.channelId, payload: request.body, actor: request.adminUser, store }));
  }));

  app.patch("/api/control/guild", role("PATCH", "/api/control/guild"), asyncRoute(async (request, response) => {
    response.json(await updateAdminGuildSettings({ client, guildId, payload: request.body, actor: request.adminUser, store }));
  }));

  app.post("/api/control/structure/plan", role("POST", "/api/control/structure/plan"), asyncRoute(async (request, response) => {
    response.json(await applyAdminStructurePlan({ client, guildId, payload: request.body ?? {}, actor: request.adminUser, store }));
  }));

  app.post("/api/control/messages/send", role("POST", "/api/control/messages/send"), asyncRoute(async (request, response) => {
    response.json(await sendAdminControlMessage({ client, guildId, payload: request.body, actor: request.adminUser, store }));
  }));

  app.get("/api/control/members", role("GET", "/api/control/members"), asyncRoute(async (request, response) => {
    response.json(await listAdminControlMembers({
      client,
      guildId,
      query: request.query?.q,
      limit: request.query?.limit
    }));
  }));

  app.post("/api/control/members/:userId/moderation", role("POST", "/api/control/members/:userId/moderation"), asyncRoute(async (request, response) => {
    response.json(await moderateMemberFromAdmin({
      client,
      guildId,
      userId: request.params.userId,
      payload: request.body,
      actor: request.adminUser,
      store
    }));
  }));

  app.post("/api/control/members/:userId/roles", role("POST", "/api/control/members/:userId/roles"), asyncRoute(async (request, response) => {
    response.json(await updateMemberRoleFromAdmin({
      client,
      guildId,
      userId: request.params.userId,
      payload: request.body,
      actor: request.adminUser,
      store
    }));
  }));

  app.post("/api/control/members/:userId/roles/bulk", role("POST", "/api/control/members/:userId/roles/bulk"), asyncRoute(async (request, response) => {
    response.json(await updateMemberRolesBulkFromAdmin({
      client,
      guildId,
      userId: request.params.userId,
      payload: request.body ?? {},
      actor: request.adminUser,
      store
    }));
  }));

  app.post("/api/control/channels/:channelId/purge", role("POST", "/api/control/channels/:channelId/purge"), asyncRoute(async (request, response) => {
    response.json(await purgeChannelFromAdmin({
      client,
      guildId,
      channelId: request.params.channelId,
      payload: request.body,
      actor: request.adminUser,
      store
    }));
  }));

  app.post("/api/control/channels/:channelId/permissions", role("POST", "/api/control/channels/:channelId/permissions"), asyncRoute(async (request, response) => {
    response.json(await setChannelPermissionOverwriteFromAdmin({
      client,
      guildId,
      channelId: request.params.channelId,
      payload: request.body ?? {},
      actor: request.adminUser,
      store
    }));
  }));

  app.patch("/api/control/channels/:channelId/position", role("PATCH", "/api/control/channels/:channelId/position"), asyncRoute(async (request, response) => {
    response.json(await reorderChannelFromAdmin({
      client,
      guildId,
      channelId: request.params.channelId,
      payload: request.body ?? {},
      actor: request.adminUser,
      store
    }));
  }));

  app.post("/api/control/tickets/:ticketId/status", role("POST", "/api/control/tickets/:ticketId/status"), asyncRoute(async (request, response) => {
    response.json(await updateTicketStatusFromAdmin({
      client,
      guildId,
      ticketId: request.params.ticketId,
      payload: request.body,
      actor: request.adminUser,
      store
    }));
  }));


  app.get("/api/operations/overview", role("GET", "/api/operations/overview"), asyncRoute(async (_request, response) => {
    response.json(await buildBotOperationsOverview({ client, guildId, store }));
  }));

  app.post("/api/operations/console", role("POST", "/api/operations/console"), asyncRoute(async (request, response) => {
    response.json(await runBotConsoleCommand({
      client,
      guildId,
      store,
      command: request.body?.command,
      actor: request.adminUser
    }));
  }));

  app.post("/api/operations/messages/preview", role("POST", "/api/operations/messages/preview"), asyncRoute(async (request, response) => {
    response.json(await previewMessagePayload({ payload: request.body ?? {} }));
  }));

  app.post("/api/operations/messages/push", role("POST", "/api/operations/messages/push"), asyncRoute(async (request, response) => {
    response.status(201).json(await sendMessagePush({
      client,
      guildId,
      store,
      payload: request.body ?? {},
      actor: request.adminUser
    }));
  }));

  app.get("/api/operations/messages/pushes", role("GET", "/api/operations/messages/pushes"), asyncRoute(async (request, response) => {
    response.json(await listMessagePushes({ store, limit: request.query?.limit }));
  }));

  app.get("/api/operations/messages/approvals", role("GET", "/api/operations/messages/approvals"), asyncRoute(async (request, response) => {
    response.json(await listMessageApprovals({ store, limit: request.query?.limit, includeClosed: request.query?.includeClosed !== "false" }));
  }));

  app.post("/api/operations/messages/approvals", role("POST", "/api/operations/messages/approvals"), asyncRoute(async (request, response) => {
    const result = await requestMessageApproval({ client, guildId, store, payload: request.body ?? {}, actor: request.adminUser });
    response.status(201).json(result);
  }));

  app.post("/api/operations/messages/approvals/:approvalId/review", role("POST", "/api/operations/messages/approvals/:approvalId/review"), asyncRoute(async (request, response) => {
    response.json(await reviewMessageApproval({
      client,
      guildId,
      store,
      approvalId: request.params.approvalId,
      payload: request.body ?? {},
      actor: request.adminUser
    }));
  }));

  app.get("/api/operations/templates", role("GET", "/api/operations/templates"), asyncRoute(async (_request, response) => {
    response.json(await listMessageTemplates({ store }));
  }));

  app.post("/api/operations/templates", role("POST", "/api/operations/templates"), asyncRoute(async (request, response) => {
    response.status(201).json(await saveMessageTemplate({ store, payload: request.body ?? {}, actor: request.adminUser }));
  }));

  app.post("/api/operations/templates/:templateId/delete", role("POST", "/api/operations/templates/:templateId/delete"), asyncRoute(async (request, response) => {
    response.json(await deleteMessageTemplate({ store, templateId: request.params.templateId, actor: request.adminUser }));
  }));


  app.get("/api/custom/overview", role("GET", "/api/custom/overview"), asyncRoute(async (_request, response) => {
    response.json(await buildCustomControlsOverview({ store, guildId }));
  }));

  app.get("/api/custom/commands", role("GET", "/api/custom/commands"), asyncRoute(async (_request, response) => {
    response.json(await listCustomCommands({ store, guildId }));
  }));

  app.post("/api/custom/commands", role("POST", "/api/custom/commands"), asyncRoute(async (request, response) => {
    response.status(201).json(await createOrUpdateCustomCommand({ store, guildId, payload: request.body ?? {}, actor: request.adminUser }));
  }));

  app.post("/api/custom/commands/:commandId/delete", role("POST", "/api/custom/commands/:commandId/delete"), asyncRoute(async (request, response) => {
    response.json(await deleteCustomCommandFromWeb({ store, guildId, commandId: request.params.commandId, actor: request.adminUser }));
  }));

  app.get("/api/custom/interactions", role("GET", "/api/custom/interactions"), asyncRoute(async (_request, response) => {
    response.json(await listCustomInteractions({ store, guildId }));
  }));

  app.post("/api/custom/interactions", role("POST", "/api/custom/interactions"), asyncRoute(async (request, response) => {
    response.status(201).json(await createOrUpdateCustomInteraction({ store, guildId, payload: request.body ?? {}, actor: request.adminUser }));
  }));

  app.post("/api/custom/interactions/:interactionId/delete", role("POST", "/api/custom/interactions/:interactionId/delete"), asyncRoute(async (request, response) => {
    response.json(await deleteCustomInteractionFromWeb({ store, guildId, interactionId: request.params.interactionId, actor: request.adminUser }));
  }));

  app.get("/api/custom/events", role("GET", "/api/custom/events"), asyncRoute(async (request, response) => {
    response.json(await listCustomControlEvents({ store, guildId, limit: request.query?.limit }));
  }));

  app.get("/api/automations/overview", role("GET", "/api/automations/overview"), asyncRoute(async (_request, response) => {
    response.json(await buildAutomationStudioOverview({ store, guildId, client }));
  }));

  app.post("/api/automations/preview", role("POST", "/api/automations/preview"), asyncRoute(async (request, response) => {
    response.json(await previewAutomationFlow({ store, guildId, payload: request.body ?? {}, actor: request.adminUser }));
  }));

  app.post("/api/automations/test", role("POST", "/api/automations/test"), asyncRoute(async (request, response) => {
    response.json(await testAutomationFlow({ client, store, guildId, payload: request.body ?? {}, actor: request.adminUser }));
  }));

  app.post("/api/automations/flows", role("POST", "/api/automations/flows"), asyncRoute(async (request, response) => {
    response.status(201).json(await createOrUpdateAutomationFlow({ store, guildId, payload: request.body ?? {}, actor: request.adminUser }));
  }));

  app.post("/api/automations/flows/:flowId/delete", role("POST", "/api/automations/flows/:flowId/delete"), asyncRoute(async (request, response) => {
    response.json(await deleteAutomationFlowFromWeb({ store, guildId, flowId: request.params.flowId, actor: request.adminUser }));
  }));

  app.get("/api/modules/overview", role("GET", "/api/modules/overview"), asyncRoute(async (_request, response) => {
    response.json(await buildModuleCenterOverview({ store, guildId, client }));
  }));

  app.get("/api/modules/events", role("GET", "/api/modules/events"), asyncRoute(async (request, response) => {
    response.json(await listModuleCenterEvents({ store, guildId, limit: request.query?.limit }));
  }));

  app.get("/api/commands/overview", role("GET", "/api/commands/overview"), asyncRoute(async (_request, response) => {
    response.json(await buildCommandCenterOverview({ client, guildId, store }));
  }));

  app.post("/api/modules/:moduleId/state", role("POST", "/api/modules/:moduleId/state"), asyncRoute(async (request, response) => {
    response.json(await setModuleState({
      store,
      guildId,
      client,
      moduleId: request.params.moduleId,
      payload: request.body ?? {},
      actor: request.adminUser
    }));
  }));

  app.post("/api/modules/export", role("POST", "/api/modules/export"), asyncRoute(async (request, response) => {
    response.json(await exportModuleBundle({ store, guildId, payload: request.body ?? {}, actor: request.adminUser }));
  }));

  app.post("/api/modules/import", role("POST", "/api/modules/import"), asyncRoute(async (request, response) => {
    response.json(await importModuleBundle({ store, guildId, payload: request.body ?? {}, actor: request.adminUser }));
  }));

  app.get("/api/moderation/cases", role("GET", "/api/moderation/cases"), asyncRoute(async (_request, response) => {
    response.json({
      ok: true,
      items: await store.list("moderation-cases")
    });
  }));

  app.get("/api/tickets", role("GET", "/api/tickets"), asyncRoute(async (_request, response) => {
    response.json({
      ok: true,
      items: await store.list("tickets")
    });
  }));

  app.get("/api/audit/events", role("GET", "/api/audit/events"), asyncRoute(async (request, response) => {
    const items = await searchAuditEvents(store, request.query ?? {});
    response.json({
      ok: true,
      items,
      filters: {
        q: request.query?.q ?? "",
        type: request.query?.type ?? "",
        source: request.query?.source ?? "",
        actorUserId: request.query?.actorUserId ?? "",
        targetUserId: request.query?.targetUserId ?? "",
        channelId: request.query?.channelId ?? "",
        from: request.query?.from ?? "",
        to: request.query?.to ?? "",
        limit: request.query?.limit ?? "100"
      }
    });
  }));

  app.get("/api/settings", role("GET", "/api/settings"), asyncRoute(async (_request, response) => {
    const settings = await getSettings(store);

    response.json({
      ok: true,
      settings: {
        ...settings,
        adminPanelEnabled: process.env.ADMIN_PANEL_ENABLED === "true",
        guildId,
        dataDir: process.env.BOT_DATA_DIR ?? "./data"
      }
    });
  }));

  app.get("/api/permissions", role("GET", "/api/permissions"), asyncRoute(async (_request, response) => {
    const settings = await getSettings(store);
    response.json({
      ok: true,
      permissions: normalizePermissionPolicies(settings.permissions)
    });
  }));

  app.patch("/api/settings", role("PATCH", "/api/settings"), asyncRoute(async (request, response) => {
    const settings = await updateSettings(store, request.body ?? {});
    permissions?.configure(settings.permissions);
    response.json({ ok: true, settings });
  }));

  app.patch("/api/permissions", role("PATCH", "/api/permissions"), asyncRoute(async (request, response) => {
    const permissionPolicies = normalizePermissionPolicies(request.body?.permissions ?? request.body ?? {});
    const settings = await updateSettings(store, { permissions: permissionPolicies });
    permissions?.configure(settings.permissions);
    response.json({ ok: true, settings, permissions: settings.permissions });
  }));

  app.patch("/api/xp/settings", role("PATCH", "/api/xp/settings"), asyncRoute(async (request, response) => {
    const xp = normalizeXpSettings(request.body?.xp ?? request.body ?? {});
    const settings = await updateSettings(store, { xp });
    response.json({ ok: true, settings, xp: settings.xp });
  }));

  app.patch("/api/economy/settings", role("PATCH", "/api/economy/settings"), asyncRoute(async (request, response) => {
    const economy = normalizeEconomySettings(request.body?.economy ?? request.body ?? {});
    const settings = await updateSettings(store, { economy });
    response.json({ ok: true, settings, economy: settings.economy });
  }));

  app.patch("/api/automod/settings", role("PATCH", "/api/automod/settings"), asyncRoute(async (request, response) => {
    const automod = normalizeAutomodSettings(request.body?.automod ?? request.body ?? {});
    const settings = await updateSettings(store, { automod });
    response.json({ ok: true, settings, automod: settings.automod });
  }));

  app.get("/api/automod/events", role("GET", "/api/automod/events"), asyncRoute(async (_request, response) => {
    response.json({
      ok: true,
      items: await store.list("automod-events")
    });
  }));

  app.get("/api/anti-spam/events", role("GET", "/api/anti-spam/events"), asyncRoute(async (_request, response) => {
    response.json({
      ok: true,
      items: await store.list("spam-events")
    });
  }));

  app.get("/api/proposals", role("GET", "/api/proposals"), asyncRoute(async (_request, response) => {
    response.json({
      ok: true,
      items: await store.list("proposals")
    });
  }));

  app.get("/api/announcements", role("GET", "/api/announcements"), asyncRoute(async (_request, response) => {
    response.json({
      ok: true,
      items: await store.list("announcements")
    });
  }));

  app.get("/api/blockchain/status", role("GET", "/api/blockchain/status"), asyncRoute(async (_request, response) => {
    const status = await getBlockchainDashboardStatus({ store, chainClient });
    response.json(status);
  }));

  app.get("/api/wallets", role("GET", "/api/wallets"), asyncRoute(async (_request, response) => {
    if (!walletRegistration) {
      response.status(503).json({ ok: false, error: "Wallet registration service is not available." });
      return;
    }
    response.json({
      ok: true,
      items: await walletRegistration.listWalletSummaries()
    });
  }));

  app.get("/api/push/public-key", role("GET", "/api/push/public-key"), asyncRoute(async (_request, response) => {
    const config = getPushConfig();
    response.json({
      ok: true,
      enabled: config.enabled,
      publicKey: config.publicKey
    });
  }));

  app.post("/api/push/subscriptions", role("POST", "/api/push/subscriptions"), asyncRoute(async (request, response) => {
    const subscription = await savePushSubscription(store, request.adminUser, request.body?.subscription);
    response.json({ ok: true, subscriptionId: subscription.id });
  }));

  app.delete("/api/push/subscriptions", role("DELETE", "/api/push/subscriptions"), asyncRoute(async (request, response) => {
    await deletePushSubscription(store, request.body?.endpoint);
    response.json({ ok: true });
  }));

  app.post("/api/push/test", role("POST", "/api/push/test"), asyncRoute(async (_request, response) => {
    const result = await sendPushNotification(store, {
      title: "Vireon Test Alert",
      body: "Web push notifications are enabled for the Vireon admin dashboard.",
      url: "/admin/#overview"
    }, { roles: ["ADMIN", "SUPER_ADMIN"] });
    response.json(result);
  }));

  app.post("/api/embeds/send", role("POST", "/api/embeds/send"), asyncRoute(async (request, response) => {
    const { channelId, title, description, color } = request.body ?? {};

    if (!channelId || !title || !description) {
      response.status(400).json({ ok: false, error: "channelId, title and description are required." });
      return;
    }

    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) {
      response.status(400).json({ ok: false, error: "Target channel is not text-based." });
      return;
    }

    const message = await channel.send({
      embeds: [createVireonEmbed({ title, description, color })]
    });

    response.json({ ok: true, messageId: message.id });
  }));

  app.use(errorHandler);

  const host = process.env.ADMIN_PANEL_HOST ?? "127.0.0.1";
  const port = Number.parseInt(process.env.ADMIN_PANEL_PORT ?? "8787", 10);

  const server = app.listen(port, host, () => {
    logger.info({ host, port }, "Vireon admin panel API listening.");
  });

  if (messagePushScheduler) {
    server.on("close", () => clearInterval(messagePushScheduler));
  }

  return server;
}

function asyncRoute(handler) {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

function requireConfiguredRouteRole(method, route) {
  const key = `${method} ${route}`;
  const minimumRole = ADMIN_ROUTE_ROLES[key];
  if (!minimumRole) {
    throw new Error(`Missing admin route RBAC requirement for ${key}.`);
  }

  return requireRole(minimumRole);
}

function errorHandler(error, _request, response, _next) {
  logger.error({ error: serializeError(error) }, "Admin panel request failed.");
  response.status(error.statusCode ?? 500).json({
    ok: false,
    error: error.statusCode ? error.message : "Internal server error.",
    code: error.code
  });
}
