import { useEffect, useMemo, useRef, useState } from "react";
import { Shell } from "./components/Shell.jsx";
import {
  AntiSpamPanel,
  AuditLogPanel,
  AutomationStudioPanel,
  AutomodPanel,
  BlockchainPanel,
  BotOperationsPanel,
  CommandCenterPanel,
  ControlCenterPanel,
  CustomControlsPanel,
  EconomyPanel,
  EmbedPanel,
  ModerationPanel,
  ModuleCenterPanel,
  OverviewPanel,
  PermissionControllerPanel,
  ProposalsPanel,
  RoadmapPanel,
  SettingsPanel,
  TicketsPanel,
  TotpResult,
  WalletPanel
} from "./components/Panels.jsx";
import { createApiClient, persistAuth, publicApi, readStoredAuth } from "./lib/api.js";

const ROLE_WEIGHT = {
  VIEWER: 1,
  MODERATOR: 2,
  ADMIN: 3,
  SUPER_ADMIN: 4
};

const ROUTES = new Set([
  "overview",
  "commands",
  "control",
  "operations",
  "custom",
  "automations",
  "modules",
  "embeds",
  "tickets",
  "moderation",
  "proposals",
  "automod",
  "spam",
  "audit",
  "economy",
  "permissions",
  "music",
  "wallet",
  "blockchain",
  "settings"
]);

const ROADMAP_PANELS = {
  economy: {
    title: "Economy / Leveling",
    phase: "Phase 2 / Phase 3 backend",
    status: "XP and Shards backend active.",
    description: "This panel manages XP, levels, server-only social currency settings, role rewards and leaderboards.",
    items: [
      { title: "Leveling", description: "XP rules, cooldowns, level roles and rank cards." },
      { title: "Economy", description: "Server-only Shards balances, transfers and anti-confusion limits." },
      { title: "Analytics", description: "Top users, weekly activity and reward history." }
    ]
  },
  music: {
    title: "Music",
    phase: "Phase 3 dashboard API",
    status: "Shell ready, Discord command backend exists.",
    description: "The bot already has Lavalink-backed music commands. This panel reserves the UI for queue control, player state and per-guild music settings.",
    items: [
      { title: "Player", description: "Now playing, queue, skip, pause, resume, stop and volume controls." },
      { title: "Connections", description: "Voice channel state, Lavalink node state and reconnect controls." },
      { title: "Policy", description: "Allowed roles, max queue length, default volume and music channel rules." }
    ]
  },
};

const EMPTY_DATA = {
  summary: {},
  commandCenter: null,
  control: null,
  controlMembers: [],
  operations: null,
  custom: null,
  automations: null,
  modules: null,
  channels: [],
  roles: [],
  cases: [],
  tickets: [],
  proposals: [],
  automod: [],
  spam: [],
  audit: [],
  settings: {},
  permissions: {},
  blockchain: null,
  wallets: []
};
const DASHBOARD_CACHE_KEY = "vireon_admin_dashboard_cache";

export function App() {
  const paymentToken = readPaymentToken();
  const [setupStatus, setSetupStatus] = useState(null);
  const [setupMessage, setSetupMessage] = useState("Checking first-run setup...");

  useEffect(() => {
    if (paymentToken) return;
    publicApi("/setup/status")
      .then((result) => {
        setSetupStatus(result);
        setSetupMessage(result.required ? "Setup Wizard is active." : "Setup completed.");
      })
      .catch((error) => {
        setSetupStatus({ required: false });
        setSetupMessage(`Setup status unavailable: ${error.message}`);
      });
  }, [paymentToken]);

  if (paymentToken) return <PaymentLinkPage token={paymentToken} />;
  if (!setupStatus) return <SetupLoading message={setupMessage} />;
  if (setupStatus.required) return <SetupWizard status={setupStatus} />;
  return <AdminApp initialStatus={setupMessage} />;
}

function AdminApp({ initialStatus = "Login to load dashboard data." } = {}) {
  const [route, setRoute] = useState(readRoute());
  const [auth, setAuthState] = useState(readStoredAuth);
  const [data, setData] = useState(EMPTY_DATA);
  const [status, setStatus] = useState(initialStatus);
  const [totpResult, setTotpResult] = useState(null);
  const [installPrompt, setInstallPrompt] = useState(null);
  const [pushState, setPushState] = useState({
    supported: supportsPush(),
    subscribed: false,
    enabled: false,
    permission: typeof Notification === "undefined" ? "unsupported" : Notification.permission
  });
  const authRef = useRef(auth);

  function setAuth(nextAuth) {
    const merged = {
      accessToken: nextAuth.accessToken ?? "",
      refreshToken: nextAuth.refreshToken ?? "",
      user: nextAuth.user ?? authRef.current.user
    };
    authRef.current = merged;
    persistAuth(merged);
    setAuthState(merged);
  }

  const apiClient = useMemo(() => createApiClient({
    getAuth: () => authRef.current,
    setAuth
  }), []);

  useEffect(() => {
    const onHashChange = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  }, []);

  useEffect(() => {
    loadDashboard().catch((error) => setStatus(`Dashboard error: ${error.message}`));
  }, []);

  function changeRoute(nextRoute) {
    window.location.hash = nextRoute;
    setRoute(nextRoute);
  }

  async function login({ email, password, totpCode }) {
    const result = await publicApi("/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: email.trim(),
        password,
        totpCode: totpCode.trim()
      })
    });
    setAuth(result);
    setStatus(`Logged in as ${result.user.email} (${result.user.role}).`);
    await loadDashboard(result.user);
    await refreshPushState();
  }

  async function logout() {
    await publicApi("/auth/logout", {
      method: "POST",
      body: JSON.stringify({ refreshToken: authRef.current.refreshToken })
    }).catch(() => null);
    setAuth({ accessToken: "", refreshToken: "", user: null });
    setData(EMPTY_DATA);
    setTotpResult(null);
    setPushState((current) => ({ ...current, subscribed: false }));
    setStatus("Logged out.");
  }

  async function loadDashboard(existingUser = null) {
    if (!authRef.current.accessToken && !authRef.current.refreshToken) {
      setStatus("Login is required.");
      return;
    }

    if (!authRef.current.accessToken && authRef.current.refreshToken) {
      await apiClient.refreshAccessToken();
    }

    let user;
    try {
      user = existingUser ?? (await apiClient.api("/auth/me")).user;
      setAuth({ ...authRef.current, user });
    } catch (error) {
      const cached = readCachedDashboard();
      if (cached && !navigator.onLine) {
        setData(cached.data);
        setStatus(`Offline: showing read-only dashboard data cached at ${cached.cachedAt}.`);
        return;
      }
      throw error;
    }

    const canModerate = roleAtLeast(user.role, "MODERATOR");
    const baseRequests = [
      ["summary", apiClient.api("/api/dashboard/summary")],
      ["control", apiClient.api("/api/control/overview")],
      ["guild", apiClient.api("/api/guild")],
      ["settings", apiClient.api("/api/settings")],
      ["permissions", apiClient.api("/api/permissions")],
      ["proposals", apiClient.api("/api/proposals")],
      ["announcements", apiClient.api("/api/announcements")],
      ["wallets", apiClient.api("/api/wallets")],
      ["blockchain", apiClient.api("/api/blockchain/status")]
    ];
    const moderatorRequests = canModerate
      ? [
          ["cases", apiClient.api("/api/moderation/cases")],
          ["tickets", apiClient.api("/api/tickets")],
          ["audit", apiClient.api("/api/audit/events?limit=100")],
          ["automod", apiClient.api("/api/automod/events")],
          ["spam", apiClient.api("/api/anti-spam/events")],
          ["commands", apiClient.api("/api/commands/overview")],
          ["operations", apiClient.api("/api/operations/overview")],
          ["custom", apiClient.api("/api/custom/overview")],
          ["automations", apiClient.api("/api/automations/overview")],
          ["modules", apiClient.api("/api/modules/overview")]
        ]
      : [];

    const loaded = await loadSettled([...baseRequests, ...moderatorRequests]);
    setData({
      summary: loaded.summary ?? {},
      commandCenter: loaded.commands?.ok === false ? null : loaded.commands ?? data.commandCenter ?? null,
      control: loaded.control?.ok === false ? null : loaded.control ?? null,
      controlMembers: data.controlMembers ?? [],
      operations: loaded.operations?.ok === false ? null : loaded.operations ?? data.operations ?? null,
      custom: loaded.custom?.ok === false ? null : loaded.custom ?? data.custom ?? null,
      automations: loaded.automations?.ok === false ? null : loaded.automations ?? data.automations ?? null,
      modules: loaded.modules?.ok === false ? null : loaded.modules ?? data.modules ?? null,
      channels: loaded.guild?.channels ?? [],
      roles: loaded.guild?.roles ?? [],
      cases: loaded.cases?.items ?? [],
      tickets: loaded.tickets?.items ?? [],
      proposals: loaded.proposals?.items ?? [],
      automod: loaded.automod?.items ?? [],
      spam: loaded.spam?.items ?? [],
      audit: loaded.audit?.items ?? [],
      settings: loaded.settings?.settings ?? {},
      permissions: loaded.permissions?.permissions ?? loaded.settings?.settings?.permissions ?? {},
      blockchain: loaded.blockchain?.ok === false ? null : loaded.blockchain ?? null,
      wallets: loaded.wallets?.items ?? []
    });
    writeCachedDashboard({
      summary: loaded.summary ?? {},
      commandCenter: loaded.commands?.ok === false ? null : loaded.commands ?? data.commandCenter ?? null,
      control: loaded.control?.ok === false ? null : loaded.control ?? null,
      controlMembers: data.controlMembers ?? [],
      operations: loaded.operations?.ok === false ? null : loaded.operations ?? data.operations ?? null,
      custom: loaded.custom?.ok === false ? null : loaded.custom ?? data.custom ?? null,
      automations: loaded.automations?.ok === false ? null : loaded.automations ?? data.automations ?? null,
      modules: loaded.modules?.ok === false ? null : loaded.modules ?? data.modules ?? null,
      channels: loaded.guild?.channels ?? [],
      roles: loaded.guild?.roles ?? [],
      cases: loaded.cases?.items ?? [],
      tickets: loaded.tickets?.items ?? [],
      proposals: loaded.proposals?.items ?? [],
      automod: loaded.automod?.items ?? [],
      spam: loaded.spam?.items ?? [],
      audit: loaded.audit?.items ?? [],
      settings: loaded.settings?.settings ?? {},
      permissions: loaded.permissions?.permissions ?? loaded.settings?.settings?.permissions ?? {},
      blockchain: loaded.blockchain?.ok === false ? null : loaded.blockchain ?? null,
      wallets: loaded.wallets?.items ?? []
    });
    setStatus("Dashboard loaded.");
    await refreshPushState();
  }


  async function refreshCommandCenter(message = "Command Center refreshed.") {
    const result = await apiClient.api("/api/commands/overview");
    const nextData = { ...data, commandCenter: result };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(message);
    return result;
  }

  async function refreshControlOverview(message = "Control Center refreshed.") {
    const result = await apiClient.api("/api/control/overview");
    const nextData = {
      ...data,
      control: result,
      channels: result.channels ?? data.channels,
      roles: result.roles ?? data.roles
    };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(message);
  }

  async function runControlAction({ endpoint, method = "POST", payload = {}, successMessage = "Admin control action completed." }) {
    await apiClient.api(endpoint, {
      method,
      body: JSON.stringify(payload)
    });
    await refreshControlOverview(successMessage);
  }

  async function searchControlMembers(query = "") {
    const params = new URLSearchParams();
    if (String(query).trim()) params.set("q", String(query).trim());
    params.set("limit", "50");
    const result = await apiClient.api(`/api/control/members?${params.toString()}`);
    const nextData = {
      ...data,
      controlMembers: result.items ?? []
    };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(`Members loaded: ${nextData.controlMembers.length}.`);
  }

  async function refreshBotOperations(message = "Bot Studio refreshed.") {
    const result = await apiClient.api("/api/operations/overview");
    const nextData = { ...data, operations: result };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(message);
  }

  async function runOperationConsole(command) {
    const result = await apiClient.api("/api/operations/console", {
      method: "POST",
      body: JSON.stringify({ command })
    });
    await refreshBotOperations(`Console command completed: ${result.command || "empty"}.`);
    return result;
  }

  async function previewOperationMessage(payload) {
    const result = await apiClient.api("/api/operations/messages/preview", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setStatus("Message preview generated.");
    return result.preview;
  }

  async function pushOperationMessage(payload) {
    const result = await apiClient.api("/api/operations/messages/push", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshBotOperations(result.scheduled ? "Message push scheduled." : `Message push finished: ${result.sent ?? 0} sent, ${result.failed ?? 0} failed.`);
    return result;
  }

  async function requestOperationApproval(payload) {
    const result = await apiClient.api("/api/operations/messages/approvals", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshBotOperations(`Approval requested: ${result.approval?.name ?? "message"}.`);
    return result;
  }

  async function reviewOperationApproval(approvalId, action, note = "") {
    const result = await apiClient.api(`/api/operations/messages/approvals/${encodeURIComponent(approvalId)}/review`, {
      method: "POST",
      body: JSON.stringify({ action, note })
    });
    await refreshBotOperations(action === "approve" ? "Approval approved and queued/sent." : "Approval rejected.");
    return result;
  }

  async function saveOperationTemplate(payload) {
    const result = await apiClient.api("/api/operations/templates", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshBotOperations(`Template saved: ${result.template?.name ?? "message"}.`);
    return result;
  }

  async function deleteOperationTemplate(templateId) {
    const result = await apiClient.api(`/api/operations/templates/${encodeURIComponent(templateId)}/delete`, { method: "POST" });
    await refreshBotOperations(`Template deleted: ${result.template?.name ?? templateId}.`);
    return result;
  }

  async function refreshCustomControls(message = "Custom Control Lab refreshed.") {
    const result = await apiClient.api("/api/custom/overview");
    const nextData = { ...data, custom: result };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(message);
    return result;
  }

  async function saveCustomCommand(payload) {
    const result = await apiClient.api("/api/custom/commands", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshCustomControls(`Custom command saved: ${result.command?.prefix ?? "!"}${result.command?.name ?? "command"}.`);
    return result;
  }

  async function deleteCustomCommand(commandId) {
    const result = await apiClient.api(`/api/custom/commands/${encodeURIComponent(commandId)}/delete`, { method: "POST" });
    await refreshCustomControls(`Custom command deleted: ${result.command?.name ?? commandId}.`);
    return result;
  }

  async function saveCustomInteraction(payload) {
    const result = await apiClient.api("/api/custom/interactions", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshCustomControls(`Custom interaction saved: ${result.interaction?.label ?? "button"}.`);
    return result;
  }

  async function deleteCustomInteraction(interactionId) {
    const result = await apiClient.api(`/api/custom/interactions/${encodeURIComponent(interactionId)}/delete`, { method: "POST" });
    await refreshCustomControls(`Custom interaction deleted: ${result.interaction?.label ?? interactionId}.`);
    return result;
  }

  async function refreshAutomationStudio(message = "Automation Studio refreshed.") {
    const result = await apiClient.api("/api/automations/overview");
    const nextData = { ...data, automations: result };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(message);
    return result;
  }

  async function previewAutomationFlow(payload) {
    const result = await apiClient.api("/api/automations/preview", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setStatus(`Automation dry-run ready: ${result.plan?.trigger ?? "flow"}.`);
    return result;
  }

  async function testAutomationFlow(payload) {
    const result = await apiClient.api("/api/automations/test", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshAutomationStudio(result.dryRun ? "Automation test dry-run completed." : "Automation test executed.");
    return result;
  }

  async function saveAutomationFlow(payload) {
    const result = await apiClient.api("/api/automations/flows", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshAutomationStudio(`Automation flow saved: ${result.flow?.name ?? "flow"}.`);
    return result;
  }

  async function deleteAutomationFlow(flowId) {
    const result = await apiClient.api(`/api/automations/flows/${encodeURIComponent(flowId)}/delete`, { method: "POST" });
    await refreshAutomationStudio(`Automation flow deleted: ${result.flow?.name ?? flowId}.`);
    return result;
  }

  async function refreshModuleCenter(message = "Module Center refreshed.") {
    const result = await apiClient.api("/api/modules/overview");
    const nextData = { ...data, modules: result };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(message);
    return result;
  }

  async function updateModuleState(moduleId, payload) {
    const result = await apiClient.api(`/api/modules/${encodeURIComponent(moduleId)}/state`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshModuleCenter(`Module updated: ${result.module?.name ?? moduleId}.`);
    return result;
  }

  async function exportModuleBundle(payload) {
    const result = await apiClient.api("/api/modules/export", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshModuleCenter("Module bundle exported.");
    return result.bundle;
  }

  async function importModuleBundle(payload) {
    const result = await apiClient.api("/api/modules/import", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await refreshModuleCenter(result.dryRun ? "Module bundle import preview completed." : `Module bundle imported: ${result.imported ?? 0} item(s).`);
    return result;
  }

  async function refreshBlockchainStatus() {
    const result = await apiClient.api("/api/blockchain/status");
    const nextData = {
      ...data,
      blockchain: result
    };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(result.alert ? `Blockchain alert: ${result.alert.title}` : "Blockchain status refreshed.");
  }

  async function sendEmbed(payload) {
    const result = await apiClient.api("/api/embeds/send", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setStatus(result.ok ? `Embed sent. Message ID: ${result.messageId}` : result.error);
  }

  async function searchAudit(filters) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== null && String(value).trim()) {
        params.set(key, String(value).trim());
      }
    }

    if (!params.has("limit")) {
      params.set("limit", "100");
    }

    const result = await apiClient.api(`/api/audit/events?${params.toString()}`);
    const nextData = {
      ...data,
      audit: result.items ?? []
    };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus(`Audit log loaded: ${nextData.audit.length} event(s).`);
  }

  async function saveXpSettings(xp) {
    const result = await apiClient.api("/api/xp/settings", {
      method: "PATCH",
      body: JSON.stringify({ xp })
    });
    const nextData = {
      ...data,
      settings: result.settings ?? {
        ...data.settings,
        xp: result.xp
      }
    };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus("XP settings saved.");
  }

  async function saveEconomySettings(economy) {
    const result = await apiClient.api("/api/economy/settings", {
      method: "PATCH",
      body: JSON.stringify({ economy })
    });
    const nextData = {
      ...data,
      settings: result.settings ?? {
        ...data.settings,
        economy: result.economy
      }
    };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus("Economy settings saved.");
  }

  async function saveAutomodSettings(automod) {
    const result = await apiClient.api("/api/automod/settings", {
      method: "PATCH",
      body: JSON.stringify({ automod })
    });
    const nextData = {
      ...data,
      settings: result.settings ?? {
        ...data.settings,
        automod: result.automod
      }
    };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus("Automod settings saved live.");
  }

  async function savePermissionPolicies(permissions) {
    const result = await apiClient.api("/api/permissions", {
      method: "PATCH",
      body: JSON.stringify({ permissions })
    });
    const nextData = {
      ...data,
      settings: result.settings ?? {
        ...data.settings,
        permissions: result.permissions
      },
      permissions: result.permissions
    };
    setData(nextData);
    writeCachedDashboard(nextData);
    setStatus("Permission policies saved.");
  }

  async function setupTotp() {
    const result = await apiClient.api("/auth/totp/setup", { method: "POST" });
    setTotpResult({
      title: "2FA setup started",
      lines: [
        "Add this TOTP secret in your authenticator app, then confirm with a code:",
        result.secret,
        "",
        result.otpauthUrl
      ]
    });
    setStatus("2FA setup started.");
  }

  async function confirmTotp(code) {
    const result = await apiClient.api("/auth/totp/confirm", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    setAuth({ ...authRef.current, user: result.user });
    setTotpResult({ title: "2FA enabled", lines: [`Enabled for ${result.user.email}.`] });
    setStatus("2FA enabled.");
  }

  async function disableTotp(code) {
    const result = await apiClient.api("/auth/totp/disable", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    setAuth({ ...authRef.current, user: result.user });
    setTotpResult({ title: "2FA disabled", lines: [`Disabled for ${result.user.email}.`] });
    setStatus("2FA disabled.");
  }

  async function installPwa() {
    if (!installPrompt) {
      setStatus("PWA install prompt is not available yet.");
      return;
    }
    await installPrompt.prompt();
    setInstallPrompt(null);
    setStatus("PWA install prompt completed.");
  }

  async function refreshPushState() {
    if (!supportsPush() || !authRef.current.accessToken) {
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    const config = await apiClient.api("/api/push/public-key");
    setPushState({
      supported: true,
      subscribed: Boolean(subscription),
      enabled: Boolean(config.enabled),
      permission: Notification.permission
    });
  }

  async function subscribePush() {
    if (!supportsPush()) {
      setStatus("Web push is not supported by this browser.");
      return;
    }

    const config = await apiClient.api("/api/push/public-key");
    if (!config.enabled || !config.publicKey) {
      setStatus("Web push is not configured on the server.");
      return;
    }

    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setPushState((current) => ({ ...current, permission }));
      setStatus("Notification permission was not granted.");
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(config.publicKey)
    });

    await apiClient.api("/api/push/subscriptions", {
      method: "POST",
      body: JSON.stringify({ subscription: subscription.toJSON() })
    });
    await refreshPushState();
    setStatus("Web push notifications enabled.");
  }

  async function unsubscribePush() {
    if (!supportsPush()) return;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await apiClient.api("/api/push/subscriptions", {
        method: "DELETE",
        body: JSON.stringify({ endpoint: subscription.endpoint })
      });
      await subscription.unsubscribe();
    }
    await refreshPushState();
    setStatus("Web push notifications disabled.");
  }

  async function sendTestPush() {
    const result = await apiClient.api("/api/push/test", { method: "POST" });
    setStatus(result.disabled
      ? "Web push is not configured on the server."
      : `Test push sent: ${result.sent}, failed: ${result.failed}.`);
  }

  const canModerate = roleAtLeast(auth.user?.role, "MODERATOR");
  const canAdmin = roleAtLeast(auth.user?.role, "ADMIN");

  return (
    <Shell
      route={route}
      onRouteChange={changeRoute}
      auth={auth}
      status={status}
      onLogin={(payload) => login(payload).catch((error) => setStatus(`Login failed: ${error.message}`))}
      onLogout={() => logout().catch((error) => setStatus(`Logout failed: ${error.message}`))}
    >
      <TotpResult result={totpResult} />
      {route === "overview" && <OverviewPanel summary={data.summary} />}
      {route === "commands" && (
        <CommandCenterPanel
          commandCenter={data.commandCenter}
          canModerate={canModerate}
          onRefresh={() => refreshCommandCenter().catch((error) => setStatus(`Command Center refresh failed: ${error.message}`))}
        />
      )}
      {route === "control" && (
        <ControlCenterPanel
          control={data.control}
          channels={data.channels}
          roles={data.roles}
          members={data.controlMembers}
          tickets={data.tickets}
          canModerate={canModerate}
          canManage={canAdmin}
          onRefresh={() => refreshControlOverview().catch((error) => setStatus(`Control refresh failed: ${error.message}`))}
          onMemberSearch={(query) => searchControlMembers(query).catch((error) => setStatus(`Member search failed: ${error.message}`))}
          onAction={(action) => runControlAction(action).catch((error) => setStatus(`Control action failed: ${error.message}`))}
        />
      )}

      {route === "operations" && (
        <BotOperationsPanel
          operations={data.operations}
          channels={data.operations?.textChannels ?? data.channels}
          canModerate={canModerate}
          canManage={canAdmin}
          onRefresh={() => refreshBotOperations().catch((error) => setStatus(`Bot Studio refresh failed: ${error.message}`))}
          onConsole={(command) => runOperationConsole(command).catch((error) => {
            setStatus(`Console failed: ${error.message}`);
            throw error;
          })}
          onPreview={(payload) => previewOperationMessage(payload).catch((error) => {
            setStatus(`Preview failed: ${error.message}`);
            throw error;
          })}
          onPush={(payload) => pushOperationMessage(payload).catch((error) => {
            setStatus(`Message push failed: ${error.message}`);
            throw error;
          })}
          onRequestApproval={(payload) => requestOperationApproval(payload).catch((error) => {
            setStatus(`Approval request failed: ${error.message}`);
            throw error;
          })}
          onReviewApproval={(approvalId, action, note) => reviewOperationApproval(approvalId, action, note).catch((error) => {
            setStatus(`Approval review failed: ${error.message}`);
            throw error;
          })}
          onSaveTemplate={(payload) => saveOperationTemplate(payload).catch((error) => setStatus(`Template save failed: ${error.message}`))}
          onDeleteTemplate={(templateId) => deleteOperationTemplate(templateId).catch((error) => setStatus(`Template delete failed: ${error.message}`))}
        />
      )}
      {route === "custom" && (
        <CustomControlsPanel
          custom={data.custom}
          canModerate={canModerate}
          canManage={canAdmin}
          onRefresh={() => refreshCustomControls().catch((error) => setStatus(`Custom controls refresh failed: ${error.message}`))}
          onSaveCommand={(payload) => saveCustomCommand(payload).catch((error) => setStatus(`Custom command save failed: ${error.message}`))}
          onDeleteCommand={(commandId) => deleteCustomCommand(commandId).catch((error) => setStatus(`Custom command delete failed: ${error.message}`))}
          onSaveInteraction={(payload) => saveCustomInteraction(payload).catch((error) => setStatus(`Custom interaction save failed: ${error.message}`))}
          onDeleteInteraction={(interactionId) => deleteCustomInteraction(interactionId).catch((error) => setStatus(`Custom interaction delete failed: ${error.message}`))}
        />
      )}
      {route === "automations" && (
        <AutomationStudioPanel
          automations={data.automations}
          canModerate={canModerate}
          canManage={canAdmin}
          onRefresh={() => refreshAutomationStudio().catch((error) => setStatus(`Automation Studio refresh failed: ${error.message}`))}
          onPreview={(payload) => previewAutomationFlow(payload).catch((error) => {
            setStatus(`Automation preview failed: ${error.message}`);
            throw error;
          })}
          onTest={(payload) => testAutomationFlow(payload).catch((error) => {
            setStatus(`Automation test failed: ${error.message}`);
            throw error;
          })}
          onSave={(payload) => saveAutomationFlow(payload).catch((error) => setStatus(`Automation save failed: ${error.message}`))}
          onDelete={(flowId) => deleteAutomationFlow(flowId).catch((error) => setStatus(`Automation delete failed: ${error.message}`))}
        />
      )}
      {route === "modules" && (
        <ModuleCenterPanel
          modules={data.modules}
          canModerate={canModerate}
          canManage={canAdmin}
          onRefresh={() => refreshModuleCenter().catch((error) => setStatus(`Module Center refresh failed: ${error.message}`))}
          onToggle={(moduleId, payload) => updateModuleState(moduleId, payload).catch((error) => setStatus(`Module update failed: ${error.message}`))}
          onExport={(payload) => exportModuleBundle(payload).catch((error) => {
            setStatus(`Module export failed: ${error.message}`);
            throw error;
          })}
          onImport={(payload) => importModuleBundle(payload).catch((error) => {
            setStatus(`Module import failed: ${error.message}`);
            throw error;
          })}
        />
      )}
      {route === "embeds" && <EmbedPanel channels={data.channels} canSend={canAdmin} onSend={(payload) => sendEmbed(payload).catch((error) => setStatus(`Embed failed: ${error.message}`))} />}
      {route === "tickets" && <TicketsPanel tickets={data.tickets} canView={canModerate} />}
      {route === "moderation" && <ModerationPanel cases={data.cases} canView={canModerate} />}
      {route === "proposals" && <ProposalsPanel proposals={data.proposals} />}
      {route === "automod" && (
        <AutomodPanel
          events={data.automod}
          settings={data.settings}
          canView={canModerate}
          canManage={canAdmin}
          onSave={(automod) => saveAutomodSettings(automod).catch((error) => setStatus(`Automod settings failed: ${error.message}`))}
        />
      )}
      {route === "spam" && <AntiSpamPanel events={data.spam} canView={canModerate} />}
      {route === "audit" && (
        <AuditLogPanel
          events={data.audit}
          canView={canModerate}
          channels={data.channels}
          onSearch={(filters) => searchAudit(filters).catch((error) => setStatus(`Audit search failed: ${error.message}`))}
        />
      )}
      {route === "economy" && (
        <EconomyPanel
          settings={data.settings}
          roles={data.roles}
          canManage={canAdmin}
          onSave={(xp) => saveXpSettings(xp).catch((error) => setStatus(`XP settings failed: ${error.message}`))}
          onSaveEconomy={(economy) => saveEconomySettings(economy).catch((error) => setStatus(`Economy settings failed: ${error.message}`))}
        />
      )}
      {route === "permissions" && (
        <PermissionControllerPanel
          policies={data.permissions}
          roles={data.roles}
          canManage={canAdmin}
          onSave={(permissions) => savePermissionPolicies(permissions).catch((error) => setStatus(`Permission policies failed: ${error.message}`))}
        />
      )}
      {route === "music" && <RoadmapPanel {...ROADMAP_PANELS.music} />}
      {route === "wallet" && <WalletPanel wallets={data.wallets} />}
      {route === "blockchain" && (
        <BlockchainPanel
          status={data.blockchain}
          onRefresh={() => refreshBlockchainStatus().catch((error) => setStatus(`Blockchain refresh failed: ${error.message}`))}
        />
      )}
      {route === "settings" && (
        <SettingsPanel
          settings={data.settings}
          onTotpSetup={() => setupTotp().catch((error) => setStatus(`2FA setup failed: ${error.message}`))}
          onTotpConfirm={(code) => confirmTotp(code).catch((error) => setStatus(`2FA confirm failed: ${error.message}`))}
          onTotpDisable={(code) => disableTotp(code).catch((error) => setStatus(`2FA disable failed: ${error.message}`))}
          pwa={{
            canInstall: Boolean(installPrompt),
            pushState,
            canSendTestPush: canAdmin,
            onInstall: () => installPwa().catch((error) => setStatus(`PWA install failed: ${error.message}`)),
            onSubscribePush: () => subscribePush().catch((error) => setStatus(`Push subscribe failed: ${error.message}`)),
            onUnsubscribePush: () => unsubscribePush().catch((error) => setStatus(`Push unsubscribe failed: ${error.message}`)),
            onSendTestPush: () => sendTestPush().catch((error) => setStatus(`Test push failed: ${error.message}`))
          }}
        />
      )}
    </Shell>
  );
}


function SetupLoading({ message }) {
  return (
    <main className="setup-page">
      <section className="setup-card setup-card-narrow">
        <span className="eyebrow">VBOS Admin</span>
        <h1>Loading setup</h1>
        <p>{message}</p>
      </section>
    </main>
  );
}

function SetupWizard({ status }) {
  const [message, setMessage] = useState(status.setupTokenHint ?? "Enter the local setup token from data/setup-token.txt.");
  const [completed, setCompleted] = useState(null);
  const defaultDatabaseUrl = "postgresql://vireon:vbos_change_me@postgres:5432/vbos?schema=public";
  const defaultLedgerUrl = "postgresql://vireon:vbos_ledger_change_me@postgres-ledger:5432/vbos_ledger?schema=public";

  async function finalizeSetup(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.musicEnabled = form.get("musicEnabled") === "on";
    payload.adminForceHttps = form.get("adminForceHttps") === "on";
    payload.adminTrustProxy = form.get("adminTrustProxy") === "on";
    payload.adminCspEnabled = form.get("adminCspEnabled") !== "off";

    const result = await publicApi("/setup/finalize", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    setCompleted(result);
    setMessage(result.restartRequired
      ? "Setup finalized. The server is restarting; refresh in a few seconds and login normally."
      : "Setup finalized. Wizard is now locked.");
    event.currentTarget.reset();
  }

  if (completed) {
    return (
      <main className="setup-page">
        <section className="setup-card setup-card-narrow success">
          <span className="eyebrow">Setup complete</span>
          <h1>Wizard locked</h1>
          <p>{message}</p>
          <ul>
            <li>Runtime config: {completed.configPath}</li>
            <li>Database: {completed.database.driver} / {completed.database.provider}</li>
            <li>Admin: {completed.admin.email}</li>
          </ul>
          <button type="button" onClick={() => window.location.reload()}>Reload admin panel</button>
        </section>
      </main>
    );
  }

  return (
    <main className="setup-page">
      <section className="setup-card">
        <span className="eyebrow">First-run setup</span>
        <h1>VBOS Setup Wizard</h1>
        <p>{message}</p>
        <p className="muted">Configure Discord, Admin Web and PostgreSQL from here. After finalize, the setup token is removed and this wizard disappears.</p>

        <form className="setup-grid" onSubmit={(event) => finalizeSetup(event).catch((error) => setMessage(`Setup failed: ${error.message}`))}>
          <fieldset>
            <legend>Unlock</legend>
            <label>Setup token</label>
            <input name="setupToken" placeholder="vireon-setup-..." required autoComplete="one-time-code" />
          </fieldset>

          <fieldset>
            <legend>Discord bot</legend>
            <label>Bot token</label>
            <input name="discordToken" type="password" required minLength="20" autoComplete="off" />
            <label>Application / Client ID</label>
            <input name="discordClientId" required inputMode="numeric" />
            <label>Guild / Server ID</label>
            <input name="discordGuildId" required inputMode="numeric" />
            <label>Allowed setup Discord user IDs, optional</label>
            <input name="setupAllowedUserIds" placeholder="123,456" />
          </fieldset>

          <fieldset>
            <legend>Admin Web</legend>
            <label>Public base URL</label>
            <input name="publicBaseUrl" defaultValue="http://127.0.0.1:8787" required />
            <label>Admin email</label>
            <input name="adminEmail" type="email" defaultValue="admin@vireon.local" required />
            <label>Admin password</label>
            <input name="adminPassword" type="password" minLength="12" required />
            <label>Admin bind host</label>
            <input name="adminHost" defaultValue="0.0.0.0" required />
            <label>Admin port</label>
            <input name="adminPort" defaultValue="8787" required inputMode="numeric" />
            <label className="checkline"><input name="adminTrustProxy" type="checkbox" defaultChecked /> Trust reverse proxy</label>
            <label className="checkline"><input name="adminForceHttps" type="checkbox" /> Force HTTPS behind proxy</label>
          </fieldset>

          <fieldset>
            <legend>Serious database</legend>
            <label>Provider</label>
            <select name="databaseProvider" defaultValue="postgresql">
              <option value="postgresql">PostgreSQL / Prisma recommended</option>
              <option value="sqlite">SQLite / local dev only</option>
              <option value="mysql">MySQL / advanced</option>
            </select>
            <label>Main DATABASE_URL</label>
            <input name="databaseUrl" defaultValue={defaultDatabaseUrl} required />
            <label>Ledger DATABASE_URL</label>
            <input name="databaseUrlLedger" defaultValue={defaultLedgerUrl} required />
            <p className="muted">PostgreSQL is the normal profile for the bot: admin users, audit log, moderation cases, XP, economy, tickets and settings.</p>
          </fieldset>

          <fieldset>
            <legend>Optional modules</legend>
            <label className="checkline"><input name="musicEnabled" type="checkbox" /> Enable Lavalink music</label>
            <label>Lavalink host</label>
            <input name="lavalinkHost" defaultValue="lavalink" />
            <label>Lavalink password</label>
            <input name="lavalinkPassword" defaultValue="youshallnotpass" />
          </fieldset>

          <div className="setup-actions">
            <button type="submit">Finalize setup and lock wizard</button>
            <p className="muted">Blockchain remains disabled in this profile. You can enable it later from config after the Discord/Admin system is stable.</p>
          </div>
        </form>
      </section>
    </main>
  );
}

function PaymentLinkPage({ token }) {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("Loading payment link...");

  useEffect(() => {
    loadPaymentLink().catch((error) => setStatus(`Payment link failed: ${error.message}`));
  }, [token]);

  async function loadPaymentLink() {
    const result = await publicApi(`/payment-links/${encodeURIComponent(token)}.json`);
    setData(result);
    setStatus("Payment link loaded.");
  }

  async function requestWithdrawal(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await publicApi(`/payment-links/${encodeURIComponent(token)}/withdrawals`, {
      method: "POST",
      body: JSON.stringify({
        toAddress: String(form.get("toAddress") ?? ""),
        amount: String(form.get("amount") ?? ""),
        asset: String(form.get("asset") ?? "VIRE")
      })
    });
    setData(result.payment);
    setStatus(`Withdrawal request created: ${result.withdrawal.amount} ${result.withdrawal.asset} pending review.`);
    event.currentTarget.reset();
  }

  const balances = data?.balances ?? [];
  const transactions = data?.transactions ?? [];

  return (
    <main className="payment-page">
      <section className="payment-hero">
        <span>Vireon Payment Link</span>
        <h1>{data?.wallet?.address ?? "Loading wallet..."}</h1>
        <p>{data ? `Wallet mode: ${data.wallet.custodyMode}. Public receive page with balance, history and withdrawal request.` : status}</p>
      </section>
      <section className="notice" role="status">{status}</section>
      <section className="panel">
        <h2>Balance</h2>
        <div className="stats">
          {balances.length === 0 ? (
            <div className="stat">
              <strong>0</strong>
              <span>No balances yet</span>
            </div>
          ) : balances.map((balance) => (
            <div className="stat" key={balance.id ?? balance.asset}>
              <strong>{balance.available} {balance.asset}</strong>
              <span>Locked: {balance.locked}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>Withdraw To External Wallet</h2>
        <form className="form-grid withdrawal-form" onSubmit={(event) => requestWithdrawal(event).catch((error) => setStatus(`Withdrawal failed: ${error.message}`))}>
          <label htmlFor="withdraw-to">External wallet</label>
          <input id="withdraw-to" name="toAddress" placeholder="vire_external_wallet" required minLength="8" />
          <label htmlFor="withdraw-amount">Amount</label>
          <input id="withdraw-amount" name="amount" inputMode="decimal" placeholder="1.5" required />
          <label htmlFor="withdraw-asset">Asset</label>
          <input id="withdraw-asset" name="asset" defaultValue="VIRE" required />
          <button type="submit" disabled={!data}>Create Withdrawal Request</button>
        </form>
        <p>Withdrawals are created as pending review ledger transactions. Broadcast/signing is handled by the future wallet operations flow.</p>
      </section>
      <section className="panel">
        <h2>Transaction History</h2>
        <div className="list">
          {transactions.length === 0 ? (
            <div className="item">No transaction history yet.</div>
          ) : transactions.map((transaction) => (
            <div className="item" key={transaction.id}>
              <strong>{transaction.type} | {transaction.status}</strong>
              <span>{transaction.amount} {transaction.asset}</span>
              <span>{transaction.createdAt}</span>
              {transaction.toAddress && <span>To: {transaction.toAddress}</span>}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

function readRoute() {
  const route = window.location.hash.replace(/^#\/?/, "");
  return ROUTES.has(route) ? route : "overview";
}

function readPaymentToken() {
  const match = window.location.pathname.match(/^\/admin\/pay\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function loadSettled(requests) {
  const entries = await Promise.all(requests.map(async ([key, promise]) => {
    try {
      return [key, await promise];
    } catch (error) {
      return [key, { ok: false, error: error.message }];
    }
  }));
  return Object.fromEntries(entries);
}

function roleAtLeast(role, minimumRole) {
  return (ROLE_WEIGHT[role] ?? 0) >= (ROLE_WEIGHT[minimumRole] ?? 0);
}

function supportsPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function writeCachedDashboard(data) {
  localStorage.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({
    cachedAt: new Date().toISOString(),
    data
  }));
}

function readCachedDashboard() {
  try {
    const raw = localStorage.getItem(DASHBOARD_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}
