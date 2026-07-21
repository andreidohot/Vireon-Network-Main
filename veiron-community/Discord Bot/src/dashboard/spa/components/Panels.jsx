import { useState } from "react";

export function OverviewPanel({ summary }) {
  const stats = [
    ["Channels", summary.guild?.channels ?? 0],
    ["Roles", summary.guild?.roles ?? 0],
    ["Members", summary.guild?.members ?? 0],
    ["Cases", summary.counts?.moderationCases ?? 0],
    ["Open Tickets", summary.counts?.openTickets ?? 0],
    ["Automod Events", summary.counts?.automodEvents ?? 0],
    ["Spam Events", summary.counts?.spamEvents ?? 0],
    ["Audit Events", summary.counts?.auditEvents ?? 0],
    ["Scheduled", summary.counts?.scheduledAnnouncements ?? 0]
  ];

  return (
    <section className="view active">
      <div className="stats">
        {stats.map(([label, value]) => (
          <div className="stat" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}


export function BotOperationsPanel({
  operations,
  channels = [],
  canModerate,
  canManage,
  onRefresh,
  onConsole,
  onPreview,
  onPush,
  onRequestApproval,
  onReviewApproval,
  onSaveTemplate,
  onDeleteTemplate
}) {
  const [consoleCommand, setConsoleCommand] = useState("help");
  const [consoleOutput, setConsoleOutput] = useState([]);
  const [messagePreview, setMessagePreview] = useState(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const templates = operations?.templates ?? [];
  const pushes = operations?.pushes ?? [];
  const approvals = operations?.approvals ?? [];
  const pendingApprovals = approvals.filter((item) => item.status === "pending");
  const textChannels = channels.filter((channel) => !channel.type || ["text", "announcement", "forum"].includes(channel.type));
  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId) ?? null;
  const defaultCommandList = operations?.console?.commands ?? [];

  async function handleConsoleSubmit(event) {
    event.preventDefault();
    const result = await onConsole(consoleCommand);
    setConsoleOutput(result.output ?? []);
  }

  async function handleMessageSubmit(event) {
    event.preventDefault();
    const submitter = event.nativeEvent?.submitter;
    const intent = submitter?.value ?? "preview";
    const payload = readMessageCreatorPayload(event.currentTarget);

    if (intent === "preview") {
      setMessagePreview(await onPreview(payload));
      return;
    }

    if (intent === "template") {
      await onSaveTemplate(payload);
      return;
    }

    if (intent === "approval") {
      const result = await onRequestApproval(payload);
      setMessagePreview({ approvalRequested: true, approval: result.approval });
      return;
    }

    if (!canManage) {
      setMessagePreview({ blocked: true, reason: "Direct push requires ADMIN. Use Request Approval instead." });
      return;
    }

    const result = await onPush(payload);
    setMessagePreview({
      mode: payload.mode,
      content: payload.content,
      embed: payload.mode === "embed" ? {
        title: payload.title,
        description: payload.description,
        color: payload.color,
        footer: payload.footer,
        fields: String(payload.fieldsText ?? "").split("\n").filter(Boolean)
      } : null,
      sent: result.sent,
      failed: result.failed,
      scheduled: result.scheduled
    });
  }

  function applyTemplate(event) {
    event.preventDefault();
    if (!selectedTemplate) return;
    const form = document.getElementById("bot-message-creator-form");
    if (!form) return;
    form.name.value = selectedTemplate.name ?? "";
    form.mode.value = selectedTemplate.mode ?? "plain";
    form.content.value = selectedTemplate.content ?? "";
    form.title.value = selectedTemplate.embed?.title ?? "";
    form.description.value = selectedTemplate.embed?.description ?? "";
    form.color.value = selectedTemplate.embed?.color ? `#${Number(selectedTemplate.embed.color).toString(16).padStart(6, "0")}` : "#d4af37";
    form.footer.value = selectedTemplate.embed?.footer ?? "Vireon Network";
    form.fieldsText.value = (selectedTemplate.embed?.fields ?? []).map((field) => `${field.name} :: ${field.value}${field.inline ? " :: inline" : ""}`).join("\n");
    form.linkButtonLabel.value = selectedTemplate.buttons?.[0]?.label ?? "";
    form.linkButtonUrl.value = selectedTemplate.buttons?.[0]?.url ?? "";
    setMessagePreview({
      mode: selectedTemplate.mode,
      content: selectedTemplate.content,
      embed: selectedTemplate.embed,
      buttons: selectedTemplate.buttons
    });
  }

  async function reviewApproval(approvalId, action) {
    const note = window.prompt(action === "approve" ? "Approval note, optional" : "Reason for rejection, optional", "") ?? "";
    const result = await onReviewApproval(approvalId, action, note);
    setMessagePreview({ approvalReviewed: true, action, result });
  }

  return (
    <Panel title="VBOS">
      {!canModerate && <PermissionNote minimumRole="MODERATOR" />}
      <div className="control-hero ops-hero">
        <div>
          <span className="eyebrow">Interactive Bot Control</span>
          <h3>{operations?.guild?.name ?? "Discord bot operations"}</h3>
          <p>Consola este allowlist, nu shell. Moderatorii pot cere aprobare, iar adminii pot aproba, respinge sau face push direct.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={!canModerate}>Refresh</button>
      </div>

      <div className="stats compact-stats">
        <div className="stat"><strong>{operations?.bot?.ready ? "Ready" : "Offline"}</strong><span>Bot</span></div>
        <div className="stat"><strong>{operations?.bot?.pingMs ?? "-"}</strong><span>Ping ms</span></div>
        <div className="stat"><strong>{templates.length}</strong><span>Templates</span></div>
        <div className="stat"><strong>{pushes.length}</strong><span>Recent pushes</span></div>
        <div className="stat"><strong>{pendingApprovals.length}</strong><span>Pending approvals</span></div>
      </div>

      <div className="ops-layout">
        <section className="panel-mini form-grid ops-console">
          <h3>Interactive console</h3>
          <p className="muted">Safe commands only. Use <code>help</code>, <code>status</code>, <code>channels</code>, <code>roles</code>, <code>members andrei</code> or <code>say channelId message</code>.</p>
          <form className="console-form" onSubmit={handleConsoleSubmit}>
            <textarea value={consoleCommand} onChange={(event) => setConsoleCommand(event.target.value)} rows="3" disabled={!canModerate} />
            <button type="submit" disabled={!canModerate}>Run Command</button>
          </form>
          <div className="console-output" aria-live="polite">
            {(consoleOutput.length ? consoleOutput : defaultCommandList.map((value) => ({ type: "text", value }))).map((item, index) => (
              <pre key={`${item.type}-${index}`}>{item.type === "json" ? JSON.stringify(item.value, null, 2) : item.value}</pre>
            ))}
          </div>
        </section>

        <section className="panel-mini form-grid ops-templates">
          <h3>Saved templates</h3>
          <form onSubmit={applyTemplate} className="form-grid compact-form">
            <select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={!canModerate || templates.length === 0}>
              <option value="">Choose template</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name} | {template.mode}</option>)}
            </select>
            <div className="button-row">
              <button type="submit" disabled={!canModerate || !selectedTemplateId}>Load</button>
              <button type="button" disabled={!canManage || !selectedTemplateId} onClick={() => onDeleteTemplate(selectedTemplateId)}>Delete</button>
            </div>
          </form>
          <DataList items={templates.slice(0, 8)} format={(item) => `${item.mode} | ${item.actorTag ?? "admin"}`} />
        </section>
      </div>

      <form id="bot-message-creator-form" className="panel-mini form-grid message-creator" onSubmit={handleMessageSubmit}>
        <h3>Message Creator + Channel Push</h3>
        <label>Template / push name</label>
        <input name="name" placeholder="Weekly community update" disabled={!canModerate} />
        <label>Target channels</label>
        <select name="channelIds" multiple size="8" disabled={!canModerate}>
          {textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
        </select>
        <label>Mode</label>
        <select name="mode" defaultValue="embed" disabled={!canModerate}>
          <option value="embed">Vireon embed</option>
          <option value="plain">Plain message</option>
        </select>
        <label>Plain content / message intro</label>
        <textarea name="content" rows="4" placeholder="Optional content above embed, or full text for plain mode." disabled={!canModerate} />
        <label>Embed title</label>
        <input name="title" placeholder="Vireon Network Update" disabled={!canModerate} />
        <label>Embed description</label>
        <textarea name="description" rows="7" placeholder="Write the full embed body here..." disabled={!canModerate} />
        <label>Embed color</label>
        <input name="color" defaultValue="#d4af37" disabled={!canModerate} />
        <label>Footer</label>
        <input name="footer" defaultValue="Vireon Network" disabled={!canModerate} />
        <label>Fields</label>
        <textarea name="fieldsText" rows="4" placeholder="Title :: Value :: inline" disabled={!canModerate} />
        <label>Link button label</label>
        <input name="linkButtonLabel" placeholder="Open dashboard" disabled={!canModerate} />
        <label>Link button URL</label>
        <input name="linkButtonUrl" placeholder="https://..." disabled={!canModerate} />
        <label>Custom button IDs</label>
        <textarea name="customInteractionIds" rows="3" placeholder="Paste IDs from Custom Lab, comma or newline separated" disabled={!canModerate} />
        <label>Schedule at</label>
        <input name="scheduleAt" type="datetime-local" disabled={!canModerate} />
        <label className="checkbox-row"><input type="checkbox" name="sendNow" defaultChecked disabled={!canModerate} /><span>Send now. Uncheck to schedule when date is in the future.</span></label>
        <label>Reason</label>
        <input name="reason" placeholder="Admin web campaign push" disabled={!canModerate} />
        <div className="button-row">
          <button type="submit" name="intent" value="preview" disabled={!canModerate}>Preview</button>
          <button type="submit" name="intent" value="template" disabled={!canModerate}>Save Template</button>
          <button type="submit" name="intent" value="approval" disabled={!canModerate}>Request Approval</button>
          <button type="submit" name="intent" value="push" disabled={!canManage}>Admin Push / Schedule</button>
        </div>
      </form>

      <section className="panel-mini approval-queue">
        <h3>Approval Queue</h3>
        <p className="muted">Moderatorii pot pregati mesajul si trimite request. Adminii aproba, resping sau trimit direct din acest panou.</p>
        {approvals.length === 0 ? (
          <div className="item muted">No approval requests yet.</div>
        ) : (
          <div className="approval-list">
            {approvals.slice(0, 12).map((item) => (
              <div className={`approval-card status-${item.status}`} key={item.id}>
                <div>
                  <strong>{item.name ?? item.id}</strong>
                  <span>{item.status} | {(item.channelIds ?? []).length} channel(s) | {item.requesterTag ?? "staff"}</span>
                  <small>{item.reason ?? "No reason"}</small>
                </div>
                <div className="button-row">
                  <button type="button" disabled={!canManage || item.status !== "pending"} onClick={() => reviewApproval(item.id, "approve")}>Approve</button>
                  <button type="button" disabled={!canManage || item.status !== "pending"} onClick={() => reviewApproval(item.id, "reject")}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {messagePreview && (
        <section className="panel-mini message-preview">
          <h3>Preview / Last result</h3>
          <pre>{JSON.stringify(messagePreview, null, 2)}</pre>
        </section>
      )}

      <section className="panel-mini">
        <h3>Push history</h3>
        <DataList items={pushes} format={(item) => `${item.status} | ${item.name ?? item.id} | ${item.sent ?? 0} sent / ${item.failed ?? 0} failed | ${item.scheduleAt ?? item.createdAt ?? "now"}`} />
      </section>
    </Panel>
  );
}

function readMessageCreatorPayload(form) {
  const data = new FormData(form);
  return {
    name: String(data.get("name") ?? ""),
    channelIds: data.getAll("channelIds").map(String),
    mode: String(data.get("mode") ?? "embed"),
    content: String(data.get("content") ?? ""),
    title: String(data.get("title") ?? ""),
    description: String(data.get("description") ?? ""),
    color: String(data.get("color") ?? "#d4af37"),
    footer: String(data.get("footer") ?? "Vireon Network"),
    fieldsText: String(data.get("fieldsText") ?? ""),
    linkButtonLabel: String(data.get("linkButtonLabel") ?? ""),
    linkButtonUrl: String(data.get("linkButtonUrl") ?? ""),
    customInteractionIds: String(data.get("customInteractionIds") ?? ""),
    scheduleAt: String(data.get("scheduleAt") ?? ""),
    sendNow: data.get("sendNow") === "on",
    reason: String(data.get("reason") ?? "")
  };
}


export function CustomControlsPanel({
  custom,
  canModerate,
  canManage,
  onRefresh,
  onSaveCommand,
  onDeleteCommand,
  onSaveInteraction,
  onDeleteInteraction
}) {
  const [lastResult, setLastResult] = useState(null);
  const commands = custom?.commands ?? [];
  const interactions = custom?.interactions ?? [];
  const events = custom?.recentEvents ?? [];

  async function handleCommandSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await onSaveCommand({
      name: String(form.get("name") ?? ""),
      prefix: String(form.get("prefix") ?? "!"),
      aliases: String(form.get("aliases") ?? ""),
      mode: String(form.get("mode") ?? "plain"),
      content: String(form.get("content") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      color: String(form.get("color") ?? "#d4af37"),
      footer: String(form.get("footer") ?? "VBOS"),
      enabled: form.get("enabled") === "on",
      ephemeral: form.get("ephemeral") === "on"
    });
    setLastResult(result);
  }

  async function handleInteractionSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await onSaveInteraction({
      label: String(form.get("label") ?? ""),
      style: String(form.get("style") ?? "primary"),
      mode: String(form.get("mode") ?? "plain"),
      content: String(form.get("content") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      color: String(form.get("color") ?? "#d4af37"),
      footer: String(form.get("footer") ?? "VBOS"),
      enabled: form.get("enabled") === "on",
      ephemeral: form.get("ephemeral") === "on"
    });
    setLastResult(result);
  }

  async function removeCommand(commandId) {
    const result = await onDeleteCommand(commandId);
    setLastResult(result);
  }

  async function removeInteraction(interactionId) {
    const result = await onDeleteInteraction(interactionId);
    setLastResult(result);
  }

  return (
    <Panel title="Custom Command & Interaction Lab">
      {!canModerate && <PermissionNote minimumRole="MODERATOR" />}
      <div className="control-hero ops-hero">
        <div>
          <span className="eyebrow">VBOS Control Plane</span>
          <h3>Custom commands, buttons and staff-built interactions</h3>
          <p>Adminii controleaza comenzile prefix, raspunsurile custom si butoanele interactive fara editare manuala in cod.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={!canModerate}>Refresh</button>
      </div>

      <div className="stats compact-stats">
        <div className="stat"><strong>{commands.length}</strong><span>Custom Commands</span></div>
        <div className="stat"><strong>{interactions.length}</strong><span>Custom Buttons</span></div>
        <div className="stat"><strong>{events.length}</strong><span>Recent Events</span></div>
        <div className="stat"><strong>{custom?.capabilities?.slashGateway ?? "/custom"}</strong><span>Slash Gateway</span></div>
      </div>

      <div className="control-grid admin-only-grid">
        <form className="panel-mini form-grid" onSubmit={handleCommandSubmit}>
          <h3>Create / update custom command</h3>
          {!canManage && <PermissionNote minimumRole="ADMIN" />}
          <label>Name</label>
          <input name="name" placeholder="rules" disabled={!canManage} />
          <label>Prefix</label>
          <input name="prefix" defaultValue="!" disabled={!canManage} />
          <label>Aliases</label>
          <input name="aliases" placeholder="helpme, info" disabled={!canManage} />
          <label>Mode</label>
          <select name="mode" defaultValue="plain" disabled={!canManage}>
            <option value="plain">Plain</option>
            <option value="embed">Embed</option>
          </select>
          <label>Content</label>
          <textarea name="content" rows="4" placeholder="Hello {user}. Input: {input}" disabled={!canManage} />
          <label>Embed title</label>
          <input name="title" placeholder="Command response" disabled={!canManage} />
          <label>Embed description</label>
          <textarea name="description" rows="4" placeholder="Embed body with {server}, {channel}, {input}" disabled={!canManage} />
          <label>Color</label>
          <input name="color" defaultValue="#d4af37" disabled={!canManage} />
          <label>Footer</label>
          <input name="footer" defaultValue="VBOS" disabled={!canManage} />
          <label className="checkbox-row"><input type="checkbox" name="enabled" defaultChecked disabled={!canManage} /><span>Enabled</span></label>
          <label className="checkbox-row"><input type="checkbox" name="ephemeral" disabled={!canManage} /><span>Ephemeral for /custom</span></label>
          <button type="submit" disabled={!canManage}>Save Command</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleInteractionSubmit}>
          <h3>Create / update custom button</h3>
          {!canManage && <PermissionNote minimumRole="ADMIN" />}
          <label>Button label</label>
          <input name="label" placeholder="Open Rules" disabled={!canManage} />
          <label>Style</label>
          <select name="style" defaultValue="primary" disabled={!canManage}>
            <option value="primary">Primary</option>
            <option value="secondary">Secondary</option>
            <option value="success">Success</option>
            <option value="danger">Danger</option>
          </select>
          <label>Response mode</label>
          <select name="mode" defaultValue="plain" disabled={!canManage}>
            <option value="plain">Plain</option>
            <option value="embed">Embed</option>
          </select>
          <label>Content</label>
          <textarea name="content" rows="4" placeholder="Thanks {user}, your click was received." disabled={!canManage} />
          <label>Embed title</label>
          <input name="title" placeholder="Button response" disabled={!canManage} />
          <label>Embed description</label>
          <textarea name="description" rows="4" placeholder="Embed body" disabled={!canManage} />
          <label>Color</label>
          <input name="color" defaultValue="#d4af37" disabled={!canManage} />
          <label>Footer</label>
          <input name="footer" defaultValue="VBOS" disabled={!canManage} />
          <label className="checkbox-row"><input type="checkbox" name="enabled" defaultChecked disabled={!canManage} /><span>Enabled</span></label>
          <label className="checkbox-row"><input type="checkbox" name="ephemeral" defaultChecked disabled={!canManage} /><span>Ephemeral response</span></label>
          <button type="submit" disabled={!canManage}>Save Button</button>
        </form>
      </div>

      <div className="control-lists">
        <div className="panel-mini">
          <h3>Custom commands</h3>
          {commands.length === 0 ? <div className="item muted">No custom commands yet.</div> : commands.map((command) => (
            <div className="item split-item" key={command.id}>
              <div>
                <strong>{command.prefix}{command.name}</strong>
                <span>{command.enabled ? "enabled" : "disabled"} | {command.response?.mode ?? "plain"} | used {command.uses ?? 0}</span>
                {command.aliases?.length ? <span>Aliases: {command.aliases.join(", ")}</span> : null}
              </div>
              <button type="button" disabled={!canManage} onClick={() => removeCommand(command.id)}>Delete</button>
            </div>
          ))}
        </div>
        <div className="panel-mini">
          <h3>Custom interactions</h3>
          {interactions.length === 0 ? <div className="item muted">No custom buttons yet.</div> : interactions.map((interaction) => (
            <div className="item split-item" key={interaction.id}>
              <div>
                <strong>{interaction.label}</strong>
                <span>{interaction.enabled ? "enabled" : "disabled"} | {interaction.style} | {interaction.ephemeral ? "ephemeral" : "public"}</span>
                <span>{interaction.customId}</span>
              </div>
              <button type="button" disabled={!canManage} onClick={() => removeInteraction(interaction.id)}>Delete</button>
            </div>
          ))}
        </div>
      </div>

      <div className="panel-mini">
        <h3>Recent custom control events</h3>
        <DataList items={events} format={(item) => `${item.type} | ${item.title} | ${item.actorTag ?? "system"}`} />
      </div>

      {lastResult && <div className="panel-mini message-preview"><h3>Last result</h3><pre>{JSON.stringify(lastResult, null, 2)}</pre></div>}
    </Panel>
  );
}

export function ControlCenterPanel({
  control,
  channels = [],
  roles = [],
  members = [],
  tickets = [],
  canModerate,
  canManage,
  onRefresh,
  onMemberSearch,
  onAction
}) {
  const allChannels = control?.channels ?? channels;
  const textChannels = allChannels.filter((channel) => ["text", "announcement", "forum"].includes(channel.type));
  const categories = allChannels.filter((channel) => channel.type === "category");
  const editableRoles = (control?.roles ?? roles).filter((role) => !role.managed);
  const guild = control?.guild ?? {};
  const bot = control?.bot ?? {};
  const modules = control?.modules ?? {};
  const safetyWarnings = bot.safety?.warnings ?? [];
  const openTickets = tickets.filter((ticket) => ticket.status === "open");

  async function handleMemberSearch(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onMemberSearch(String(form.get("query") ?? ""));
  }

  async function handleModeration(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("userId") ?? "").trim();
    await onAction({
      endpoint: `/api/control/members/${encodeURIComponent(userId)}/moderation`,
      method: "POST",
      successMessage: "Moderation action completed from Admin Web.",
      payload: {
        action: String(form.get("action") ?? "warn"),
        durationMinutes: String(form.get("durationMinutes") ?? "10"),
        deleteMessageDays: String(form.get("deleteMessageDays") ?? "0"),
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handleMemberRole(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("userId") ?? "").trim();
    await onAction({
      endpoint: `/api/control/members/${encodeURIComponent(userId)}/roles`,
      method: "POST",
      successMessage: "Member role updated from Admin Web.",
      payload: {
        action: String(form.get("action") ?? "add"),
        roleId: String(form.get("roleId") ?? ""),
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handleMemberRolesBulk(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const userId = String(form.get("userId") ?? "").trim();
    await onAction({
      endpoint: `/api/control/members/${encodeURIComponent(userId)}/roles/bulk`,
      method: "POST",
      successMessage: "Bulk member roles updated from Admin Web.",
      payload: {
        addRoleIds: String(form.get("addRoleIds") ?? ""),
        removeRoleIds: String(form.get("removeRoleIds") ?? ""),
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handlePurge(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channelId = String(form.get("channelId") ?? "");
    await onAction({
      endpoint: `/api/control/channels/${encodeURIComponent(channelId)}/purge`,
      method: "POST",
      successMessage: "Channel purge completed from Admin Web.",
      payload: {
        amount: String(form.get("amount") ?? "10"),
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handleTicketStatus(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const ticketId = String(form.get("ticketId") ?? "");
    await onAction({
      endpoint: `/api/control/tickets/${encodeURIComponent(ticketId)}/status`,
      method: "POST",
      successMessage: "Ticket status updated from Admin Web.",
      payload: {
        status: String(form.get("status") ?? "closed"),
        note: String(form.get("note") ?? "")
      }
    });
  }

  async function handleCreateRole(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onAction({
      endpoint: "/api/control/roles",
      method: "POST",
      successMessage: "Role created from Admin Web.",
      payload: {
        name: String(form.get("name") ?? ""),
        color: String(form.get("color") ?? "#d4af37"),
        hoist: form.get("hoist") === "on",
        mentionable: form.get("mentionable") === "on",
        permissions: String(form.get("permissions") ?? ""),
        reason: String(form.get("reason") ?? "")
      }
    });
    event.currentTarget.reset();
  }

  async function handleUpdateRole(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roleId = String(form.get("roleId") ?? "");
    await onAction({
      endpoint: `/api/control/roles/${encodeURIComponent(roleId)}`,
      method: "PATCH",
      successMessage: "Role updated from Admin Web.",
      payload: {
        name: String(form.get("name") ?? ""),
        color: String(form.get("color") ?? "#d4af37"),
        hoist: form.get("hoist") === "on",
        mentionable: form.get("mentionable") === "on",
        permissions: String(form.get("permissions") ?? ""),
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handleDeleteRole(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const roleId = String(form.get("roleId") ?? "");
    await onAction({
      endpoint: `/api/control/roles/${encodeURIComponent(roleId)}/delete`,
      method: "POST",
      successMessage: "Role deleted from Admin Web.",
      payload: {
        confirm: String(form.get("confirm") ?? ""),
        reason: String(form.get("reason") ?? "")
      }
    });
    event.currentTarget.reset();
  }

  async function handleCreateChannel(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onAction({
      endpoint: "/api/control/channels",
      method: "POST",
      successMessage: "Channel created from Admin Web.",
      payload: {
        name: String(form.get("name") ?? ""),
        type: String(form.get("type") ?? "text"),
        parentId: String(form.get("parentId") ?? ""),
        topic: String(form.get("topic") ?? ""),
        nsfw: form.get("nsfw") === "on",
        reason: String(form.get("reason") ?? "")
      }
    });
    event.currentTarget.reset();
  }

  async function handleUpdateChannel(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channelId = String(form.get("channelId") ?? "");
    await onAction({
      endpoint: `/api/control/channels/${encodeURIComponent(channelId)}`,
      method: "PATCH",
      successMessage: "Channel updated from Admin Web.",
      payload: {
        name: String(form.get("name") ?? ""),
        parentId: String(form.get("parentId") ?? ""),
        topic: String(form.get("topic") ?? ""),
        nsfw: form.get("nsfw") === "on",
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handleDeleteChannel(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channelId = String(form.get("channelId") ?? "");
    await onAction({
      endpoint: `/api/control/channels/${encodeURIComponent(channelId)}/delete`,
      method: "POST",
      successMessage: "Channel deleted from Admin Web.",
      payload: {
        confirm: String(form.get("confirm") ?? ""),
        reason: String(form.get("reason") ?? "")
      }
    });
    event.currentTarget.reset();
  }

  async function handleChannelPermissions(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channelId = String(form.get("channelId") ?? "");
    await onAction({
      endpoint: `/api/control/channels/${encodeURIComponent(channelId)}/permissions`,
      method: "POST",
      successMessage: "Channel permission overwrite updated from Admin Web.",
      payload: {
        targetId: String(form.get("targetId") ?? ""),
        allow: String(form.get("allow") ?? ""),
        deny: String(form.get("deny") ?? ""),
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handleChannelPosition(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const channelId = String(form.get("channelId") ?? "");
    await onAction({
      endpoint: `/api/control/channels/${encodeURIComponent(channelId)}/position`,
      method: "PATCH",
      successMessage: "Channel position updated from Admin Web.",
      payload: {
        position: String(form.get("position") ?? "0"),
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handleStructurePlan(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onAction({
      endpoint: "/api/control/structure/plan",
      method: "POST",
      successMessage: form.get("dryRun") === "on" ? "Structure plan preview completed." : "Structure plan applied from Admin Web.",
      payload: {
        dryRun: form.get("dryRun") === "on",
        roles: String(form.get("roles") ?? "[]"),
        categories: String(form.get("categories") ?? "[]"),
        channels: String(form.get("channels") ?? "[]")
      }
    });
  }

  async function handleGuildUpdate(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onAction({
      endpoint: "/api/control/guild",
      method: "PATCH",
      successMessage: "Guild settings updated from Admin Web.",
      payload: {
        name: String(form.get("name") ?? ""),
        description: String(form.get("description") ?? ""),
        preferredLocale: String(form.get("preferredLocale") ?? ""),
        systemChannelId: String(form.get("systemChannelId") ?? ""),
        rulesChannelId: String(form.get("rulesChannelId") ?? ""),
        publicUpdatesChannelId: String(form.get("publicUpdatesChannelId") ?? ""),
        reason: String(form.get("reason") ?? "")
      }
    });
  }

  async function handleSendMessage(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onAction({
      endpoint: "/api/control/messages/send",
      method: "POST",
      successMessage: "Message sent from Admin Web Control Center.",
      payload: {
        channelId: String(form.get("channelId") ?? ""),
        mode: String(form.get("mode") ?? "message"),
        content: String(form.get("content") ?? ""),
        title: String(form.get("title") ?? ""),
        description: String(form.get("description") ?? ""),
        color: String(form.get("color") ?? "#d4af37")
      }
    });
    event.currentTarget.reset();
  }

  return (
    <Panel title="Bot Control Center">
      {!control && <div className="item muted">Control data is not loaded yet. Refresh after login.</div>}
      <div className="control-hero">
        <div>
          <span className="eyebrow">Discord Bot Command Center</span>
          <h3>{guild.name ?? "Unknown guild"}</h3>
          <p>Adminii pot controla structura serverului. Moderatorii pot controla moderation, tickets, purge si mesaje direct din web.</p>
        </div>
        <button type="button" onClick={onRefresh}>Refresh</button>
      </div>

      <div className="stats compact-stats">
        <div className="stat"><strong>{guild.memberCount ?? 0}</strong><span>Members</span></div>
        <div className="stat"><strong>{guild.channels ?? allChannels.length}</strong><span>Channels</span></div>
        <div className="stat"><strong>{guild.roles ?? roles.length}</strong><span>Roles</span></div>
        <div className="stat"><strong>{bot.ready ? "Ready" : "Offline"}</strong><span>Bot</span></div>
      </div>

      <div className="module-grid">
        {Object.entries(modules).map(([key, enabled]) => (
          <div className={enabled ? "module-card ok" : "module-card warn"} key={key}>
            <strong>{key}</strong>
            <span>{enabled ? "available" : "missing permission"}</span>
          </div>
        ))}
      </div>

      <div className={bot.safety?.ok ? "notice success-note" : "notice danger-note"}>
        <strong>{bot.safety?.ok ? "Control permissions look usable" : "Control permissions need attention"}</strong>
        {(safetyWarnings.length ? safetyWarnings : ["No permission warnings reported."]).map((warning, index) => (
          <span className="block-line" key={`${warning}-${index}`}>{warning}</span>
        ))}
      </div>

      {!canModerate && <PermissionNote minimumRole="MODERATOR" />}

      <div className="control-grid control-priority">
        <form className="panel-mini form-grid" onSubmit={handleMemberSearch}>
          <h3>Member search</h3>
          <label>Search user</label>
          <input name="query" placeholder="username, tag, display name or user ID" disabled={!canModerate} />
          <button type="submit" disabled={!canModerate}>Search Members</button>
          <p className="muted">Loads up to 50 users for moderation, role assignment and quick checks.</p>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleModeration}>
          <h3>Moderate member</h3>
          <label>User ID</label>
          <input name="userId" placeholder="Discord user ID" disabled={!canModerate} required />
          <label>Action</label>
          <select name="action" disabled={!canModerate}>
            <option value="warn">Warn</option>
            <option value="timeout">Timeout</option>
            <option value="untimeout">Remove timeout</option>
            <option value="kick">Kick</option>
            <option value="ban">Ban</option>
            <option value="unban">Unban</option>
          </select>
          <label>Timeout minutes</label>
          <input name="durationMinutes" type="number" min="1" max="40320" defaultValue="10" disabled={!canModerate} />
          <label>Delete message days for ban</label>
          <input name="deleteMessageDays" type="number" min="0" max="7" defaultValue="0" disabled={!canModerate} />
          <label>Reason</label>
          <textarea name="reason" rows="3" placeholder="Reason visible in audit log" disabled={!canModerate} required />
          <button type="submit" disabled={!canModerate}>Run Moderation Action</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handlePurge}>
          <h3>Purge messages</h3>
          <label>Channel</label>
          <select name="channelId" disabled={!canModerate}>{textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select>
          <label>Amount</label>
          <input name="amount" type="number" min="1" max="100" defaultValue="10" disabled={!canModerate} />
          <label>Reason</label>
          <input name="reason" placeholder="Spam cleanup" disabled={!canModerate} />
          <button type="submit" disabled={!canModerate}>Purge</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleTicketStatus}>
          <h3>Ticket control</h3>
          <label>Ticket</label>
          <select name="ticketId" disabled={!canModerate || tickets.length === 0}>{tickets.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.status} | {ticket.userTag} | {ticket.topic}</option>)}</select>
          <label>Status</label>
          <select name="status" disabled={!canModerate || tickets.length === 0}>
            <option value="closed">Close</option>
            <option value="open">Reopen</option>
            <option value="archived">Archive</option>
          </select>
          <label>Note</label>
          <input name="note" placeholder="Resolution note" disabled={!canModerate || tickets.length === 0} />
          <button type="submit" disabled={!canModerate || tickets.length === 0}>Update Ticket</button>
          <p className="muted">Open tickets: {openTickets.length}</p>
        </form>
      </div>

      <div className="control-grid">
        <form className="panel-mini form-grid" onSubmit={handleSendMessage}>
          <h3>Send message / embed</h3>
          <label>Channel</label>
          <select name="channelId" disabled={!canModerate}>{textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select>
          <label>Mode</label>
          <select name="mode" disabled={!canModerate}><option value="message">Message</option><option value="embed">Vireon Embed</option></select>
          <label>Content</label>
          <textarea name="content" rows="4" placeholder="Plain message or optional text above embed" disabled={!canModerate} />
          <label>Embed title</label>
          <input name="title" placeholder="Vireon Update" disabled={!canModerate} />
          <label>Embed description</label>
          <textarea name="description" rows="5" placeholder="Embed body" disabled={!canModerate} />
          <label>Embed color</label>
          <input name="color" defaultValue="#d4af37" disabled={!canModerate} />
          <button type="submit" disabled={!canModerate}>Send</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleMemberRole}>
          <h3>Member roles</h3>
          {!canManage && <PermissionNote minimumRole="ADMIN" />}
          <label>User ID</label>
          <input name="userId" placeholder="Discord user ID" disabled={!canManage} required />
          <label>Action</label>
          <select name="action" disabled={!canManage}><option value="add">Add role</option><option value="remove">Remove role</option></select>
          <label>Role</label>
          <select name="roleId" disabled={!canManage}>{editableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
          <label>Reason</label>
          <input name="reason" placeholder="Manual role control" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Update Member Role</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleMemberRolesBulk}>
          <h3>Bulk member roles</h3>
          {!canManage && <PermissionNote minimumRole="ADMIN" />}
          <label>User ID</label>
          <input name="userId" placeholder="Discord user ID" disabled={!canManage} required />
          <label>Add role IDs</label>
          <textarea name="addRoleIds" rows="3" placeholder="roleId1, roleId2" disabled={!canManage} />
          <label>Remove role IDs</label>
          <textarea name="removeRoleIds" rows="3" placeholder="roleId3, roleId4" disabled={!canManage} />
          <label>Reason</label>
          <input name="reason" placeholder="Bulk role sync from Admin Web" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Apply Bulk Roles</button>
        </form>
      </div>

      <div className="control-lists">
        <div className="panel-mini">
          <h3>Members loaded</h3>
          {members.length === 0 ? <div className="item muted">Search members to load staff controls.</div> : (
            <div className="list dense-list">
              {members.map((member) => (
                <div className="item" key={member.id}>
                  <strong>{member.displayName ?? member.username ?? member.tag}</strong>
                  <span>{member.id} | {member.bot ? "bot" : "human"} | {member.timeoutUntil ? `timeout until ${member.timeoutUntil}` : "active"}</span>
                  <span>{(member.roles ?? []).slice(0, 5).map((role) => role.name).join(", ") || "No roles"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="panel-mini">
          <h3>Active quick actions</h3>
          <DataList items={control?.quickActions ?? []} format={(item) => `${item.minimumRole} | ${item.destructive ? "destructive" : "safe"}`} />
        </div>
      </div>

      {!canManage && <PermissionNote minimumRole="ADMIN" />}

      <div className="control-grid admin-only-grid">
        <form className="panel-mini form-grid" onSubmit={handleCreateRole}>
          <h3>Create role</h3>
          <label>Name</label>
          <input name="name" placeholder="Vireon Elite" disabled={!canManage} />
          <label>Color</label>
          <input name="color" defaultValue="#d4af37" disabled={!canManage} />
          <label>Permissions</label>
          <textarea name="permissions" rows="3" placeholder="ManageMessages&#10;ModerateMembers" disabled={!canManage} />
          <label className="checkbox-row"><input type="checkbox" name="hoist" disabled={!canManage} /><span>Hoist role</span></label>
          <label className="checkbox-row"><input type="checkbox" name="mentionable" disabled={!canManage} /><span>Mentionable</span></label>
          <label>Reason</label>
          <input name="reason" placeholder="Admin web role setup" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Create Role</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleUpdateRole}>
          <h3>Edit role</h3>
          <label>Role</label>
          <select name="roleId" disabled={!canManage}>{editableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
          <label>New name</label>
          <input name="name" placeholder="Updated role name" disabled={!canManage} />
          <label>Color</label>
          <input name="color" defaultValue="#d4af37" disabled={!canManage} />
          <label>Permissions</label>
          <textarea name="permissions" rows="3" placeholder="Leave blank to keep current permissions" disabled={!canManage} />
          <label className="checkbox-row"><input type="checkbox" name="hoist" disabled={!canManage} /><span>Hoist role</span></label>
          <label className="checkbox-row"><input type="checkbox" name="mentionable" disabled={!canManage} /><span>Mentionable</span></label>
          <label>Reason</label>
          <input name="reason" placeholder="Admin web role update" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Update Role</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleCreateChannel}>
          <h3>Create channel</h3>
          <label>Name</label>
          <input name="name" placeholder="elite-chat" disabled={!canManage} />
          <label>Type</label>
          <select name="type" disabled={!canManage}>
            <option value="text">Text</option>
            <option value="voice">Voice</option>
            <option value="category">Category</option>
            <option value="forum">Forum</option>
            <option value="announcement">Announcement</option>
          </select>
          <label>Category</label>
          <select name="parentId" disabled={!canManage}><option value="">No category</option>{categories.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select>
          <label>Topic</label>
          <textarea name="topic" rows="3" placeholder="Channel purpose" disabled={!canManage} />
          <label className="checkbox-row"><input type="checkbox" name="nsfw" disabled={!canManage} /><span>NSFW</span></label>
          <label>Reason</label>
          <input name="reason" placeholder="Admin web channel setup" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Create Channel</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleUpdateChannel}>
          <h3>Edit channel</h3>
          <label>Channel</label>
          <select name="channelId" disabled={!canManage}>{allChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.type} | {channel.name}</option>)}</select>
          <label>New name</label>
          <input name="name" placeholder="updated-channel" disabled={!canManage} />
          <label>Category</label>
          <select name="parentId" disabled={!canManage}><option value="">No category / keep root</option>{categories.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select>
          <label>Topic</label>
          <textarea name="topic" rows="3" placeholder="Updated topic" disabled={!canManage} />
          <label className="checkbox-row"><input type="checkbox" name="nsfw" disabled={!canManage} /><span>NSFW</span></label>
          <label>Reason</label>
          <input name="reason" placeholder="Admin web channel update" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Update Channel</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleChannelPermissions}>
          <h3>Channel permissions</h3>
          <label>Channel</label>
          <select name="channelId" disabled={!canManage}>{allChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.type} | {channel.name}</option>)}</select>
          <label>Role/User ID target</label>
          <input name="targetId" placeholder="Role ID or User ID" disabled={!canManage} />
          <label>Allow permissions</label>
          <textarea name="allow" rows="3" placeholder="ViewChannel&#10;SendMessages" disabled={!canManage} />
          <label>Deny permissions</label>
          <textarea name="deny" rows="3" placeholder="SendMessages&#10;AddReactions" disabled={!canManage} />
          <label>Reason</label>
          <input name="reason" placeholder="Permission overwrite from Admin Web" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Save Overwrite</button>
        </form>

        <form className="panel-mini form-grid" onSubmit={handleChannelPosition}>
          <h3>Reorder channel</h3>
          <label>Channel</label>
          <select name="channelId" disabled={!canManage}>{allChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.type} | {channel.name}</option>)}</select>
          <label>Position</label>
          <input name="position" type="number" min="0" max="500" defaultValue="0" disabled={!canManage} />
          <label>Reason</label>
          <input name="reason" placeholder="Channel reorder from Admin Web" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Move Channel</button>
        </form>
      </div>

      <div className="control-grid">
        <form className="panel-mini form-grid wide-form" onSubmit={handleStructurePlan}>
          <h3>Bulk structure plan</h3>
          {!canManage && <PermissionNote minimumRole="ADMIN" />}
          <p className="muted">Creates/reuses roles, categories and channels from JSON. Keep dry-run checked until the preview looks clean.</p>
          <label>Roles JSON</label>
          <textarea name="roles" rows="5" defaultValue={'[{"name":"VBOS Staff","color":"#d4af37","permissions":"ManageMessages"}]'} disabled={!canManage} />
          <label>Categories JSON</label>
          <textarea name="categories" rows="4" defaultValue={'[{"name":"community"}]'} disabled={!canManage} />
          <label>Channels JSON</label>
          <textarea name="channels" rows="6" defaultValue={'[{"name":"announcements","type":"announcement","parentName":"community","topic":"Official updates"}]'} disabled={!canManage} />
          <label className="checkbox-row"><input type="checkbox" name="dryRun" defaultChecked disabled={!canManage} /><span>Dry-run preview</span></label>
          <button type="submit" disabled={!canManage}>Run Structure Plan</button>
        </form>
      </div>

      <div className="control-grid">
        <form className="panel-mini form-grid" onSubmit={handleGuildUpdate}>
          <h3>Guild settings</h3>
          <label>Server name</label>
          <input name="name" defaultValue={guild.name ?? ""} disabled={!canManage} />
          <label>Description</label>
          <textarea name="description" rows="3" defaultValue={guild.description ?? ""} disabled={!canManage} />
          <label>Locale</label>
          <input name="preferredLocale" defaultValue={guild.preferredLocale ?? ""} placeholder="en-US" disabled={!canManage} />
          <label>System channel</label>
          <select name="systemChannelId" defaultValue={guild.systemChannelId ?? ""} disabled={!canManage}><option value="">None</option>{textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select>
          <label>Rules channel</label>
          <select name="rulesChannelId" defaultValue={guild.rulesChannelId ?? ""} disabled={!canManage}><option value="">None</option>{textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select>
          <label>Updates channel</label>
          <select name="publicUpdatesChannelId" defaultValue={guild.publicUpdatesChannelId ?? ""} disabled={!canManage}><option value="">None</option>{textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}</select>
          <label>Reason</label>
          <input name="reason" placeholder="Admin web guild update" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Save Guild Settings</button>
        </form>

        <form className="panel-mini form-grid danger-zone" onSubmit={handleDeleteRole}>
          <h3>Delete role</h3>
          <p>Type exactly <strong>DELETE role-name</strong>. Managed roles and roles above the bot cannot be deleted.</p>
          <label>Role</label>
          <select name="roleId" disabled={!canManage}>{editableRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
          <label>Confirmation</label>
          <input name="confirm" placeholder="DELETE Role Name" disabled={!canManage} />
          <label>Reason</label>
          <input name="reason" placeholder="Admin web role cleanup" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Delete Role</button>
        </form>

        <form className="panel-mini form-grid danger-zone" onSubmit={handleDeleteChannel}>
          <h3>Delete channel</h3>
          <p>Type exactly <strong>DELETE channel-name</strong>. This is intentionally not one-click.</p>
          <label>Channel</label>
          <select name="channelId" disabled={!canManage}>{allChannels.map((channel) => <option key={channel.id} value={channel.id}>{channel.type} | {channel.name}</option>)}</select>
          <label>Confirmation</label>
          <input name="confirm" placeholder="DELETE channel-name" disabled={!canManage} />
          <label>Reason</label>
          <input name="reason" placeholder="Admin web channel cleanup" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Delete Channel</button>
        </form>
      </div>

      <div className="control-lists">
        <div className="panel-mini">
          <h3>Top roles</h3>
          <DataList items={editableRoles.slice(0, 20)} format={(role) => `${role.position ?? 0} | ${role.color ?? "#000000"} | ${role.managed ? "managed" : "editable"}`} />
        </div>
        <div className="panel-mini">
          <h3>Channels</h3>
          <DataList items={allChannels.slice(0, 30)} format={(channel) => `${channel.type ?? "text"} | ${channel.parentId ? `parent ${channel.parentId}` : "root"}`} />
        </div>
      </div>
    </Panel>
  );
}

export function EmbedPanel({ channels, canSend, onSend }) {
  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSend({
      channelId: String(form.get("channelId") ?? ""),
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? ""),
      color: String(form.get("color") ?? "#d4af37")
    });
    event.currentTarget.reset();
  }

  return (
    <Panel title="Send Embed">
      {!canSend && <PermissionNote minimumRole="ADMIN" />}
      <form className="form-grid" onSubmit={handleSubmit}>
        <label htmlFor="embed-channel">Channel</label>
        <select id="embed-channel" name="channelId" disabled={!canSend}>
          {channels.map((channel) => (
            <option key={channel.id} value={channel.id}>#{channel.name}</option>
          ))}
        </select>
        <label htmlFor="embed-title">Title</label>
        <input id="embed-title" name="title" placeholder="Vireon Update" disabled={!canSend} />
        <label htmlFor="embed-description">Description</label>
        <textarea id="embed-description" name="description" rows="8" placeholder="Draft update text..." disabled={!canSend} />
        <label htmlFor="embed-color">Color</label>
        <input id="embed-color" name="color" defaultValue="#d4af37" disabled={!canSend} />
        <button type="submit" disabled={!canSend}>Send Embed</button>
      </form>
    </Panel>
  );
}

export function TicketsPanel({ tickets, canView }) {
  return (
    <Panel title="Tickets">
      {canView ? (
        <DataList items={tickets} format={(item) => `${item.status} | ${item.userTag} | ${item.topic}`} />
      ) : (
        <PermissionNote minimumRole="MODERATOR" />
      )}
    </Panel>
  );
}

export function ModerationPanel({ cases, canView }) {
  return (
    <Panel title="Moderation Cases">
      {canView ? (
        <DataList items={cases} format={(item) => `${item.type} | ${item.targetTag} | ${item.reason}`} />
      ) : (
        <PermissionNote minimumRole="MODERATOR" />
      )}
    </Panel>
  );
}

export function ProposalsPanel({ proposals }) {
  return (
    <Panel title="Proposals">
      <DataList items={proposals} format={(item) => `${item.status} | ${item.yes}/${item.no} | ${item.title}`} />
    </Panel>
  );
}

export function AutomodPanel({ events, settings = {}, canView, canManage, onSave }) {
  const automod = {
    enabled: true,
    deleteBlockedMessages: true,
    blockDiscordInvites: true,
    blockMassMentions: true,
    maxMentions: 6,
    blockScamKeywords: true,
    scamKeywords: [],
    customRules: [],
    antiRaid: {
      enabled: true,
      joinWindowSeconds: 60,
      maxJoins: 8,
      alertCooldownMinutes: 5
    },
    ...(settings.automod ?? {}),
    antiRaid: {
      enabled: true,
      joinWindowSeconds: 60,
      maxJoins: 8,
      alertCooldownMinutes: 5,
      ...(settings.automod?.antiRaid ?? {})
    }
  };
  const ruleRows = [
    ...(Array.isArray(automod.customRules) ? automod.customRules : []),
    {},
    {},
    {},
    {},
    {}
  ].slice(0, 8);

  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSave({
      enabled: form.get("enabled") === "on",
      deleteBlockedMessages: form.get("deleteBlockedMessages") === "on",
      blockDiscordInvites: form.get("blockDiscordInvites") === "on",
      blockMassMentions: form.get("blockMassMentions") === "on",
      maxMentions: Number(form.get("maxMentions")),
      blockScamKeywords: form.get("blockScamKeywords") === "on",
      scamKeywords: parseTextareaList(form.get("scamKeywords")),
      customRules: ruleRows
        .map((_rule, index) => ({
          id: String(form.get(`ruleId-${index}`) ?? "").trim(),
          label: String(form.get(`ruleLabel-${index}`) ?? "").trim(),
          pattern: String(form.get(`rulePattern-${index}`) ?? "").trim(),
          flags: String(form.get(`ruleFlags-${index}`) ?? "i").trim(),
          reason: String(form.get(`ruleReason-${index}`) ?? "").trim(),
          enabled: form.get(`ruleEnabled-${index}`) === "on"
        }))
        .filter((rule) => rule.id || rule.label || rule.pattern || rule.reason),
      antiRaid: {
        enabled: form.get("antiRaidEnabled") === "on",
        joinWindowSeconds: Number(form.get("joinWindowSeconds")),
        maxJoins: Number(form.get("maxJoins")),
        alertCooldownMinutes: Number(form.get("alertCooldownMinutes"))
      }
    });
  }

  return (
    <Panel title="Automod Events">
      {!canView && <PermissionNote minimumRole="MODERATOR" />}
      {canView && (
        <>
          {!canManage && <PermissionNote minimumRole="ADMIN" />}
          <form className="form-grid automod-settings-form" onSubmit={handleSubmit}>
            <div className="form-section">
              <h3>Live configuration</h3>
              <span className="muted">Saved settings are read at runtime by message and join handlers. No redeploy is needed.</span>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" name="enabled" defaultChecked={automod.enabled !== false} disabled={!canManage} />
              <span>Enable automod</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" name="deleteBlockedMessages" defaultChecked={automod.deleteBlockedMessages !== false} disabled={!canManage} />
              <span>Delete blocked messages when possible</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" name="blockDiscordInvites" defaultChecked={automod.blockDiscordInvites !== false} disabled={!canManage} />
              <span>Block Discord invite links</span>
            </label>
            <label className="checkbox-row">
              <input type="checkbox" name="blockMassMentions" defaultChecked={automod.blockMassMentions !== false} disabled={!canManage} />
              <span>Block mass mentions</span>
            </label>
            <label htmlFor="automod-max-mentions">Max mentions per message</label>
            <input id="automod-max-mentions" name="maxMentions" type="number" min="2" max="100" defaultValue={automod.maxMentions} disabled={!canManage} />
            <label className="checkbox-row">
              <input type="checkbox" name="blockScamKeywords" defaultChecked={automod.blockScamKeywords !== false} disabled={!canManage} />
              <span>Block scam keyword list</span>
            </label>
            <label htmlFor="automod-keywords">Scam keywords / phrases</label>
            <textarea
              id="automod-keywords"
              name="scamKeywords"
              rows="8"
              defaultValue={(Array.isArray(automod.scamKeywords) ? automod.scamKeywords : []).join("\n")}
              placeholder="seed phrase&#10;private key&#10;claim reward"
              disabled={!canManage}
            />
            <div className="form-section">
              <h3>Custom rules</h3>
              <span className="muted">Regex rules for community-specific scams, spam phrases or unsafe calls to action.</span>
            </div>
            <div className="custom-rule-grid">
              {ruleRows.map((rule, index) => (
                <div className="custom-rule-row" key={`rule-${index}`}>
                  <label htmlFor={`rule-id-${index}`}>Rule ID</label>
                  <input id={`rule-id-${index}`} name={`ruleId-${index}`} defaultValue={rule.id ?? ""} placeholder="fake-airdrop" disabled={!canManage} />
                  <label htmlFor={`rule-label-${index}`}>Label</label>
                  <input id={`rule-label-${index}`} name={`ruleLabel-${index}`} defaultValue={rule.label ?? ""} placeholder="Fake airdrop" disabled={!canManage} />
                  <label htmlFor={`rule-pattern-${index}`}>Regex pattern</label>
                  <input id={`rule-pattern-${index}`} name={`rulePattern-${index}`} defaultValue={rule.pattern ?? ""} placeholder="claim\\s+(free\\s+)?vire" disabled={!canManage} />
                  <label htmlFor={`rule-flags-${index}`}>Flags</label>
                  <input id={`rule-flags-${index}`} name={`ruleFlags-${index}`} maxLength="8" defaultValue={rule.flags ?? "i"} disabled={!canManage} />
                  <label htmlFor={`rule-reason-${index}`}>Reason</label>
                  <input id={`rule-reason-${index}`} name={`ruleReason-${index}`} defaultValue={rule.reason ?? ""} placeholder="Custom scam rule matched" disabled={!canManage} />
                  <label className="checkbox-row">
                    <input type="checkbox" name={`ruleEnabled-${index}`} defaultChecked={rule.enabled !== false} disabled={!canManage} />
                    <span>Active</span>
                  </label>
                </div>
              ))}
            </div>
            <div className="form-section">
              <h3>Anti-raid</h3>
              <span className="muted">Detects abnormal member join rate and alerts staff. It does not auto-ban or lock the server yet.</span>
            </div>
            <label className="checkbox-row">
              <input type="checkbox" name="antiRaidEnabled" defaultChecked={automod.antiRaid.enabled !== false} disabled={!canManage} />
              <span>Enable anti-raid join-rate detection</span>
            </label>
            <label htmlFor="join-window">Join window seconds</label>
            <input id="join-window" name="joinWindowSeconds" type="number" min="10" max="3600" defaultValue={automod.antiRaid.joinWindowSeconds} disabled={!canManage} />
            <label htmlFor="max-joins">Max joins in window</label>
            <input id="max-joins" name="maxJoins" type="number" min="2" max="500" defaultValue={automod.antiRaid.maxJoins} disabled={!canManage} />
            <label htmlFor="alert-cooldown">Alert cooldown minutes</label>
            <input id="alert-cooldown" name="alertCooldownMinutes" type="number" min="1" max="1440" defaultValue={automod.antiRaid.alertCooldownMinutes} disabled={!canManage} />
            <button type="submit" disabled={!canManage}>Save Automod Live Config</button>
          </form>
          <DataList items={events} format={(item) => `${item.userTag ?? item.userId ?? "system"} | ${item.reason} | ${item.matched}`} />
        </>
      )}
    </Panel>
  );
}

export function AntiSpamPanel({ events, canView }) {
  return (
    <Panel title="Anti-Spam Events">
      {canView ? (
        <DataList items={events} format={(item) => `${item.userTag} | ${item.messagesInWindow} messages | timeout ${item.timeoutMinutes}m`} />
      ) : (
        <PermissionNote minimumRole="MODERATOR" />
      )}
    </Panel>
  );
}

export function AuditLogPanel({ events = [], canView, channels = [], onSearch }) {
  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSearch({
      q: form.get("q"),
      type: form.get("type"),
      source: form.get("source"),
      actorUserId: form.get("actorUserId"),
      targetUserId: form.get("targetUserId"),
      channelId: form.get("channelId"),
      from: form.get("from"),
      to: form.get("to"),
      limit: form.get("limit")
    });
  }

  return (
    <Panel title="Audit Log">
      {canView ? (
        <div className="audit-layout">
          <form className="form-grid audit-filter-form" onSubmit={handleSubmit}>
            <div className="form-section">
              <h3>Search persisted events</h3>
              <span className="muted">Events are saved through the shared DAL and mirror the important actions posted to #mod-log.</span>
            </div>
            <label htmlFor="audit-q">Search text</label>
            <input id="audit-q" name="q" placeholder="case ID, user tag, reason, ticket topic..." />
            <label htmlFor="audit-type">Type</label>
            <select id="audit-type" name="type" defaultValue="">
              <option value="">Any type</option>
              <option value="warn">Warn</option>
              <option value="mute">Mute</option>
              <option value="unmute">Unmute</option>
              <option value="kick">Kick</option>
              <option value="ban">Ban</option>
              <option value="purge">Purge</option>
              <option value="ticket-opened">Ticket opened</option>
              <option value="ticket-closed">Ticket closed</option>
              <option value="automod">Automod</option>
              <option value="anti-spam">Anti-spam</option>
              <option value="announcement-published">Announcement published</option>
              <option value="scheduled-announcement-published">Scheduled announcement</option>
              <option value="proposal-created">Proposal created</option>
            </select>
            <label htmlFor="audit-source">Source</label>
            <select id="audit-source" name="source" defaultValue="">
              <option value="">Any source</option>
              <option value="moderation">Moderation</option>
              <option value="ticket">Ticket</option>
              <option value="automod">Automod</option>
              <option value="anti-spam">Anti-spam</option>
              <option value="announcement">Announcement</option>
              <option value="proposal">Proposal</option>
              <option value="system">System</option>
            </select>
            <label htmlFor="audit-actor">Actor user ID</label>
            <input id="audit-actor" name="actorUserId" placeholder="Moderator/admin Discord ID" />
            <label htmlFor="audit-target">Target user ID</label>
            <input id="audit-target" name="targetUserId" placeholder="Member Discord ID" />
            <label htmlFor="audit-channel">Channel</label>
            <select id="audit-channel" name="channelId" defaultValue="">
              <option value="">Any channel</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>#{channel.name}</option>
              ))}
            </select>
            <label htmlFor="audit-from">From</label>
            <input id="audit-from" name="from" type="datetime-local" />
            <label htmlFor="audit-to">To</label>
            <input id="audit-to" name="to" type="datetime-local" />
            <label htmlFor="audit-limit">Limit</label>
            <input id="audit-limit" name="limit" type="number" min="1" max="500" defaultValue="100" />
            <button type="submit">Search Audit Log</button>
          </form>
          <div className="audit-results">
            {events.length === 0 ? (
              <div className="item">No audit events matched.</div>
            ) : events.map((event) => (
              <div className="audit-event item" key={event.id}>
                <div className="audit-event-header">
                  <strong>{event.title}</strong>
                  <span>{formatDateTime(event.createdAt)}</span>
                </div>
                <span>{event.description || "No description."}</span>
                <div className="audit-meta">
                  <span>{event.type}</span>
                  <span>{event.source}</span>
                  {event.relatedId && <span>Ref: {event.relatedId}</span>}
                  {event.channelId && <span>Channel: {event.channelId}</span>}
                  {event.actorTag && <span>Actor: {event.actorTag}</span>}
                  {event.targetTag && <span>Target: {event.targetTag}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <PermissionNote minimumRole="MODERATOR" />
      )}
    </Panel>
  );
}

export function EconomyPanel({ settings, roles = [], canManage, onSave, onSaveEconomy }) {
  const xp = {
    enabled: true,
    messageXp: 15,
    messageCooldownSeconds: 60,
    voiceXpPerMinute: 5,
    minVoiceSessionSeconds: 60,
    levelCurve: "quadratic",
    levelBaseXp: 100,
    levelGrowthFactor: 1.35,
    maxLevel: 1000,
    roleRewards: [],
    ...(settings.xp ?? {})
  };
  const economy = {
    enabled: true,
    currencyName: "Shards",
    currencySymbol: "SHD",
    transferEnabled: true,
    minTransferAmount: 1,
    maxTransferAmount: 10000,
    starterBalance: 0,
    dailyAmount: 100,
    dailyCooldownHours: 24,
    workMinAmount: 15,
    workMaxAmount: 75,
    workCooldownMinutes: 60,
    shopEnabled: true,
    shopItems: [],
    showNotVireDisclaimer: true,
    ...(settings.economy ?? {})
  };
  const shopRows = [
    ...(Array.isArray(economy.shopItems) ? economy.shopItems : []),
    {},
    {},
    {},
    {},
    {}
  ].slice(0, 5);
  const rewardRows = [
    ...(Array.isArray(xp.roleRewards) ? xp.roleRewards : []),
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {}
  ].slice(0, 10);
  const previewLevels = [1, 2, 3, 4, 5, 10].map((level) => ({
    level,
    xp: calculatePreviewXpForLevel(level, xp)
  }));

  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSave({
      enabled: form.get("enabled") === "on",
      messageXp: Number(form.get("messageXp")),
      messageCooldownSeconds: Number(form.get("messageCooldownSeconds")),
      voiceXpPerMinute: Number(form.get("voiceXpPerMinute")),
      minVoiceSessionSeconds: Number(form.get("minVoiceSessionSeconds")),
      levelCurve: String(form.get("levelCurve") ?? "quadratic"),
      levelBaseXp: Number(form.get("levelBaseXp")),
      levelGrowthFactor: Number(form.get("levelGrowthFactor")),
      maxLevel: Number(form.get("maxLevel")),
      roleRewards: rewardRows
        .map((_row, index) => {
          const roleId = String(form.get(`rewardRoleId-${index}`) ?? "").trim();
          const role = roles.find((item) => item.id === roleId);
          return {
            level: Number(form.get(`rewardLevel-${index}`)),
            roleId,
            roleName: role?.name ?? ""
          };
        })
        .filter((reward) => reward.level > 0 && reward.roleId)
    });
  }

  async function handleEconomySubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSaveEconomy({
      enabled: form.get("economyEnabled") === "on",
      currencyName: String(form.get("currencyName") ?? "Shards"),
      currencySymbol: String(form.get("currencySymbol") ?? "SHD"),
      transferEnabled: form.get("transferEnabled") === "on",
      minTransferAmount: Number(form.get("minTransferAmount")),
      maxTransferAmount: Number(form.get("maxTransferAmount")),
      starterBalance: Number(form.get("starterBalance")),
      dailyAmount: Number(form.get("dailyAmount")),
      dailyCooldownHours: Number(form.get("dailyCooldownHours")),
      workMinAmount: Number(form.get("workMinAmount")),
      workMaxAmount: Number(form.get("workMaxAmount")),
      workCooldownMinutes: Number(form.get("workCooldownMinutes")),
      shopEnabled: form.get("shopEnabled") === "on",
      shopItems: shopRows
        .map((_row, index) => {
          const roleId = String(form.get(`shopRoleId-${index}`) ?? "").trim();
          const role = roles.find((item) => item.id === roleId);
          const name = String(form.get(`shopName-${index}`) ?? "").trim();
          return {
            id: String(form.get(`shopId-${index}`) ?? "").trim(),
            name,
            description: String(form.get(`shopDescription-${index}`) ?? "").trim(),
            price: Number(form.get(`shopPrice-${index}`)),
            roleId,
            roleName: role?.name ?? name,
            active: form.get(`shopActive-${index}`) === "on"
          };
        })
        .filter((item) => item.id && item.roleId && item.price > 0),
      showNotVireDisclaimer: form.get("showNotVireDisclaimer") === "on"
    });
  }

  return (
    <Panel title="Economy / Leveling">
      {!canManage && <PermissionNote minimumRole="ADMIN" />}
      <form className="form-grid xp-settings-form" onSubmit={handleEconomySubmit}>
        <div className="form-section">
          <h3>Server-only currency</h3>
          <span className="muted">This is a social points system for minigames and community rewards. It is separate from VIRE.</span>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" name="economyEnabled" defaultChecked={economy.enabled !== false} disabled={!canManage} />
          <span>Enable social currency</span>
        </label>
        <label htmlFor="currency-name">Currency name</label>
        <input id="currency-name" name="currencyName" maxLength="32" defaultValue={economy.currencyName} disabled={!canManage} />
        <label htmlFor="currency-symbol">Currency symbol</label>
        <input id="currency-symbol" name="currencySymbol" maxLength="8" defaultValue={economy.currencySymbol} disabled={!canManage} />
        <label htmlFor="starter-balance">Starter balance</label>
        <input id="starter-balance" name="starterBalance" type="number" min="0" defaultValue={economy.starterBalance} disabled={!canManage} />
        <label htmlFor="daily-amount">Daily reward</label>
        <input id="daily-amount" name="dailyAmount" type="number" min="1" defaultValue={economy.dailyAmount} disabled={!canManage} />
        <label htmlFor="daily-cooldown">Daily cooldown hours</label>
        <input id="daily-cooldown" name="dailyCooldownHours" type="number" min="1" defaultValue={economy.dailyCooldownHours} disabled={!canManage} />
        <label htmlFor="work-min">Work min reward</label>
        <input id="work-min" name="workMinAmount" type="number" min="1" defaultValue={economy.workMinAmount} disabled={!canManage} />
        <label htmlFor="work-max">Work max reward</label>
        <input id="work-max" name="workMaxAmount" type="number" min="1" defaultValue={economy.workMaxAmount} disabled={!canManage} />
        <label htmlFor="work-cooldown">Work cooldown minutes</label>
        <input id="work-cooldown" name="workCooldownMinutes" type="number" min="1" defaultValue={economy.workCooldownMinutes} disabled={!canManage} />
        <label className="checkbox-row">
          <input type="checkbox" name="transferEnabled" defaultChecked={economy.transferEnabled !== false} disabled={!canManage} />
          <span>Allow member transfers</span>
        </label>
        <label htmlFor="min-transfer">Minimum transfer</label>
        <input id="min-transfer" name="minTransferAmount" type="number" min="1" defaultValue={economy.minTransferAmount} disabled={!canManage} />
        <label htmlFor="max-transfer">Maximum transfer</label>
        <input id="max-transfer" name="maxTransferAmount" type="number" min="1" defaultValue={economy.maxTransferAmount} disabled={!canManage} />
        <label className="checkbox-row">
          <input type="checkbox" name="showNotVireDisclaimer" defaultChecked={economy.showNotVireDisclaimer !== false} disabled={!canManage} />
          <span>Show “not VIRE” disclaimer in bot responses</span>
        </label>
        <div className="form-section">
          <h3>Cosmetic role shop</h3>
          <span className="muted">Members can spend Shards on configured cosmetic Discord roles.</span>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" name="shopEnabled" defaultChecked={economy.shopEnabled !== false} disabled={!canManage} />
          <span>Enable cosmetic shop</span>
        </label>
        <div className="shop-grid">
          {shopRows.map((item, index) => (
            <div className="shop-row" key={`shop-${index}`}>
              <label htmlFor={`shop-id-${index}`}>Item ID</label>
              <input id={`shop-id-${index}`} name={`shopId-${index}`} maxLength="40" defaultValue={item.id ?? ""} placeholder="gold-name" disabled={!canManage} />
              <label htmlFor={`shop-name-${index}`}>Name</label>
              <input id={`shop-name-${index}`} name={`shopName-${index}`} maxLength="60" defaultValue={item.name ?? ""} placeholder="Gold Name" disabled={!canManage} />
              <label htmlFor={`shop-price-${index}`}>Price</label>
              <input id={`shop-price-${index}`} name={`shopPrice-${index}`} type="number" min="1" defaultValue={item.price ?? ""} disabled={!canManage} />
              <label htmlFor={`shop-role-${index}`}>Role</label>
              <select id={`shop-role-${index}`} name={`shopRoleId-${index}`} defaultValue={item.roleId ?? ""} disabled={!canManage || roles.length === 0}>
                <option value="">No cosmetic role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
              <label htmlFor={`shop-description-${index}`}>Description</label>
              <input id={`shop-description-${index}`} name={`shopDescription-${index}`} maxLength="120" defaultValue={item.description ?? ""} placeholder="Cosmetic role reward" disabled={!canManage} />
              <label className="checkbox-row">
                <input type="checkbox" name={`shopActive-${index}`} defaultChecked={item.active !== false} disabled={!canManage} />
                <span>Active</span>
              </label>
            </div>
          ))}
        </div>
        <button type="submit" disabled={!canManage}>Save Economy Settings</button>
      </form>
      <form className="form-grid xp-settings-form" onSubmit={handleSubmit}>
        <div className="form-section">
          <h3>XP engine</h3>
          <span className="muted">XP, level curve, voice rewards and level-based Discord roles.</span>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" name="enabled" defaultChecked={xp.enabled !== false} disabled={!canManage} />
          <span>Enable XP engine</span>
        </label>
        <label htmlFor="xp-message">Message XP</label>
        <input id="xp-message" name="messageXp" type="number" min="0" defaultValue={xp.messageXp} disabled={!canManage} />
        <label htmlFor="xp-cooldown">Message cooldown seconds</label>
        <input id="xp-cooldown" name="messageCooldownSeconds" type="number" min="0" defaultValue={xp.messageCooldownSeconds} disabled={!canManage} />
        <label htmlFor="xp-voice">Voice XP per minute</label>
        <input id="xp-voice" name="voiceXpPerMinute" type="number" min="0" defaultValue={xp.voiceXpPerMinute} disabled={!canManage} />
        <label htmlFor="xp-min-voice">Minimum voice session seconds</label>
        <input id="xp-min-voice" name="minVoiceSessionSeconds" type="number" min="0" defaultValue={xp.minVoiceSessionSeconds} disabled={!canManage} />
        <label htmlFor="xp-curve">Level curve</label>
        <select id="xp-curve" name="levelCurve" defaultValue={xp.levelCurve} disabled={!canManage}>
          <option value="linear">Linear</option>
          <option value="quadratic">Quadratic</option>
          <option value="exponential">Exponential</option>
        </select>
        <label htmlFor="xp-base">Base XP</label>
        <input id="xp-base" name="levelBaseXp" type="number" min="1" defaultValue={xp.levelBaseXp} disabled={!canManage} />
        <label htmlFor="xp-growth">Exponential growth factor</label>
        <input id="xp-growth" name="levelGrowthFactor" type="number" min="1.01" max="10" step="0.01" defaultValue={xp.levelGrowthFactor} disabled={!canManage} />
        <label htmlFor="xp-max-level">Max level</label>
        <input id="xp-max-level" name="maxLevel" type="number" min="1" defaultValue={xp.maxLevel} disabled={!canManage} />
        <div className="form-section">
          <h3>Level role rewards</h3>
          <span className="muted">Assign a Discord role automatically when a member reaches a configured level.</span>
        </div>
        <div className="reward-grid">
          {rewardRows.map((reward, index) => (
            <div className="reward-row" key={`reward-${index}`}>
              <label htmlFor={`reward-level-${index}`}>Level</label>
              <input
                id={`reward-level-${index}`}
                name={`rewardLevel-${index}`}
                type="number"
                min="1"
                defaultValue={reward.level ?? ""}
                disabled={!canManage}
              />
              <label htmlFor={`reward-role-${index}`}>Role</label>
              <select
                id={`reward-role-${index}`}
                name={`rewardRoleId-${index}`}
                defaultValue={reward.roleId ?? ""}
                disabled={!canManage || roles.length === 0}
              >
                <option value="">No reward role</option>
                {roles.map((role) => (
                  <option key={role.id} value={role.id}>{role.name}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
        {roles.length === 0 && (
          <div className="item muted">Discord roles are loaded when the admin API can reach the configured guild.</div>
        )}
        <button type="submit" disabled={!canManage}>Save XP Settings</button>
      </form>
      <div className="placeholder-grid xp-preview">
        {previewLevels.map((item) => (
          <div className="item" key={item.level}>
            <strong>Level {item.level}</strong>
            <span>{item.xp.toLocaleString()} total XP</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function PermissionControllerPanel({ policies = {}, roles = [], canManage, onSave }) {
  const normalized = {
    allowAdministrator: policies.allowAdministrator !== false,
    allowManageGuild: policies.allowManageGuild !== false,
    setupAllowedUserIds: Array.isArray(policies.setupAllowedUserIds) ? policies.setupAllowedUserIds : [],
    managerRoleIds: Array.isArray(policies.managerRoleIds) ? policies.managerRoleIds : [],
    managerRoleNames: Array.isArray(policies.managerRoleNames) ? policies.managerRoleNames : ["Founder", "Core Team", "Admin"]
  };
  const selectedRoleIds = new Set(normalized.managerRoleIds);

  async function handleSubmit(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onSave({
      allowAdministrator: form.get("allowAdministrator") === "on",
      allowManageGuild: form.get("allowManageGuild") === "on",
      setupAllowedUserIds: parseTextareaList(form.get("setupAllowedUserIds")),
      managerRoleNames: parseTextareaList(form.get("managerRoleNames")),
      managerRoleIds: form.getAll("managerRoleIds").map(String)
    });
  }

  return (
    <Panel title="Permission Controller">
      {!canManage && <PermissionNote minimumRole="ADMIN" />}
      <div className="permission-layout">
        <form className="form-grid permission-form" onSubmit={handleSubmit}>
          <div className="form-section">
            <h3>Global manager rules</h3>
            <span className="muted">Controls who can manage bot modules, embeds, tags, triggers, server playlists, XP rewards and similar admin workflows.</span>
          </div>
          <label className="checkbox-row">
            <input type="checkbox" name="allowAdministrator" defaultChecked={normalized.allowAdministrator} disabled={!canManage} />
            <span>Discord Administrator can manage VBOS</span>
          </label>
          <label className="checkbox-row">
            <input type="checkbox" name="allowManageGuild" defaultChecked={normalized.allowManageGuild} disabled={!canManage} />
            <span>Discord Manage Server permission can manage VBOS</span>
          </label>
          <label htmlFor="setup-user-ids">Setup allowed user IDs</label>
          <textarea
            id="setup-user-ids"
            name="setupAllowedUserIds"
            rows="4"
            defaultValue={normalized.setupAllowedUserIds.join("\n")}
            placeholder="Discord user IDs, one per line"
            disabled={!canManage}
          />
          <label htmlFor="manager-role-names">Manager role names fallback</label>
          <textarea
            id="manager-role-names"
            name="managerRoleNames"
            rows="4"
            defaultValue={normalized.managerRoleNames.join("\n")}
            placeholder="Founder&#10;Core Team&#10;Admin"
            disabled={!canManage}
          />
          <div className="form-section">
            <h3>Discord role access</h3>
            <span className="muted">Selected roles can manage protected VBOS features even if their names change later.</span>
          </div>
          <div className="role-picker">
            {roles.length === 0 ? (
              <div className="item muted">No Discord roles loaded yet.</div>
            ) : roles.map((role) => (
              <label className="role-option" key={role.id}>
                <input
                  type="checkbox"
                  name="managerRoleIds"
                  value={role.id}
                  defaultChecked={selectedRoleIds.has(role.id)}
                  disabled={!canManage}
                />
                <span>
                  <strong>{role.name}</strong>
                  <small>Position {role.position}</small>
                </span>
              </label>
            ))}
          </div>
          <button type="submit" disabled={!canManage}>Save Permission Controller</button>
        </form>
        <div className="permission-summary">
          <div className="item">
            <strong>Setup command</strong>
            <span>Allowed user IDs + Administrator when enabled.</span>
          </div>
          <div className="item">
            <strong>Community bot management</strong>
            <span>Allowed user IDs, selected roles, fallback role names, Administrator and Manage Server when enabled.</span>
          </div>
          <div className="item">
            <strong>Dashboard RBAC</strong>
            <span>API route roles still apply separately: VIEWER, MODERATOR, ADMIN and SUPER_ADMIN.</span>
          </div>
          <div className="item">
            <strong>Selected roles</strong>
            <span>{normalized.managerRoleIds.length} role ID rule{normalized.managerRoleIds.length === 1 ? "" : "s"} active.</span>
          </div>
        </div>
      </div>
    </Panel>
  );
}

export function RoadmapPanel({ title, phase, status, description, items }) {
  return (
    <Panel title={title}>
      <div className="roadmap-panel">
        <div className="item">
          <strong>{status}</strong>
          <span>{description}</span>
        </div>
        <div className="placeholder-grid">
          <div className="item">
            <strong>Target phase</strong>
            <span>{phase}</span>
          </div>
          {items.map((item) => (
            <div className="item" key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

export function WalletPanel({ wallets = [] }) {
  const custodialCount = wallets.filter((wallet) => wallet.custodyMode === "custodial").length;
  const externalCount = wallets.filter((wallet) => wallet.custodyMode === "external").length;

  return (
    <Panel title="Wallet / Payments">
      <div className="stats">
        <div className="stat">
          <strong>{wallets.length}</strong>
          <span>Total Wallets</span>
        </div>
        <div className="stat">
          <strong>{custodialCount}</strong>
          <span>Custodial</span>
        </div>
        <div className="stat">
          <strong>{externalCount}</strong>
          <span>External Links</span>
        </div>
      </div>
      <div className="item muted">
        <strong>Registration flow</strong>
        <span>Users can run /register custodial, /register external, /register verify or /register status. Private key material is not stored or exposed here.</span>
      </div>
      <div className="list wallet-list">
        {wallets.length === 0 ? (
          <div className="item">No registered wallets yet.</div>
        ) : wallets.map((wallet) => (
          <div className="item wallet-row" key={wallet.id}>
            <strong>{wallet.custodyMode} | {wallet.discordUserId}</strong>
            <span>{formatWalletAddress(wallet.address)}</span>
            <span>Daily limit: {wallet.dailyLimit ?? "0"} | Balance limit: {wallet.balanceLimit ?? "0"}</span>
            <a href={wallet.paymentLink} target="_blank" rel="noreferrer">Open payment link</a>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function BlockchainPanel({ status, onRefresh }) {
  if (!status) {
    return (
      <Panel title="Blockchain Status">
        <div className="item muted">Blockchain status has not loaded yet.</div>
        <button type="button" onClick={onRefresh}>Refresh Blockchain Status</button>
      </Panel>
    );
  }

  const metrics = status.metrics ?? {};
  const network = status.network ?? {};
  const history = Array.isArray(status.history) ? status.history : [];
  const statItems = [
    ["RPC Status", status.status ?? "unknown"],
    ["Mode", status.mode ?? "unknown"],
    ["RPC Cache", formatRpcCache(network)],
    ["Uptime", formatPercent(metrics.uptimePercent)],
    ["Latency", formatMs(metrics.latestLatencyMs)],
    ["Block Height", formatNumber(metrics.latestBlockHeight)],
    ["Active Nodes", formatNumber(metrics.activeNodes)],
    ["Hash Rate", formatHashRate(metrics.hashRate)],
    ["Circulating Supply", formatSupply(metrics.circulatingSupply)]
  ];

  return (
    <Panel title="Blockchain Status">
      <div className="blockchain-layout">
        {status.alert && (
          <div className={`chain-alert ${status.alert.severity === "critical" ? "critical" : "warning"}`}>
            <strong>{status.alert.title}</strong>
            <span>{status.alert.message}</span>
            {status.alert.downSince && <span>Down since: {formatDateTime(status.alert.downSince)}</span>}
          </div>
        )}
        <div className="blockchain-toolbar">
          <span className="muted">Last updated: {formatDateTime(status.updatedAt)}</span>
          <button type="button" onClick={onRefresh}>Refresh</button>
        </div>
        <div className="stats blockchain-stats">
          {statItems.map(([label, value]) => (
            <div className="stat" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </div>
          ))}
        </div>
        <div className="placeholder-grid">
          <div className="item">
            <strong>Source</strong>
            <span>{network.source ?? "Unavailable"}</span>
          </div>
          <div className="item">
            <strong>Network</strong>
            <span>{network.network ?? "Unavailable"}</span>
          </div>
          <div className="item">
            <strong>Latest Hash</strong>
            <span>{network.latestBlockHash ?? "Unavailable"}</span>
          </div>
          <div className="item">
            <strong>Samples</strong>
            <span>{metrics.sampleCount ?? history.length} monitoring sample(s)</span>
          </div>
        </div>
        <div className="chart-grid">
          <SparklineChart title="Block Height" items={history} valueKey="blockHeight" formatValue={formatNumber} />
          <SparklineChart title="RPC Latency" items={history} valueKey="latencyMs" formatValue={formatMs} />
        </div>
      </div>
    </Panel>
  );
}

function formatWalletAddress(address) {
  const value = String(address ?? "");
  if (value.length <= 48) return value || "Unavailable";
  return `${value.slice(0, 20)}...${value.slice(-16)}`;
}

function formatRpcCache(network = {}) {
  if (!network.cached) return "Fresh";
  const parts = [network.stale ? "Stale" : "Cached"];
  if (typeof network.cacheAgeMs === "number" && Number.isFinite(network.cacheAgeMs)) {
    parts.push(`${Math.round(network.cacheAgeMs / 1000)}s old`);
  }
  if (network.rateLimited) parts.push("rate-limited");
  if (network.fallbackStatus) parts.push(`fallback: ${network.fallbackStatus}`);
  return parts.join(" | ");
}


export function AutomationStudioPanel({ automations, canModerate, canManage, onRefresh, onPreview, onTest, onSave, onDelete }) {
  const [selectedFlowId, setSelectedFlowId] = useState("");
  const [result, setResult] = useState(null);
  const flows = automations?.flows ?? [];
  const events = automations?.recentEvents ?? [];
  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) ?? null;
  const channels = automations?.discord?.channels ?? [];
  const roles = automations?.discord?.roles ?? [];

  function loadFlow(event) {
    event.preventDefault();
    if (!selectedFlow) return;
    const form = document.getElementById("automation-flow-form");
    if (!form) return;
    form.id.value = selectedFlow.id ?? "";
    form.name.value = selectedFlow.name ?? "";
    form.description.value = selectedFlow.description ?? "";
    form.enabled.checked = selectedFlow.enabled !== false;
    form.triggerType.value = selectedFlow.trigger?.type ?? "message_contains";
    form.triggerValue.value = selectedFlow.trigger?.value ?? "";
    form.caseSensitive.checked = Boolean(selectedFlow.trigger?.caseSensitive);
    form.cooldownSeconds.value = selectedFlow.cooldownSeconds ?? 30;
    form.actionsJson.value = JSON.stringify(selectedFlow.actions ?? [], null, 2);
    setResult({ loaded: selectedFlow.name, flow: selectedFlow });
  }

  async function submitAutomation(event) {
    event.preventDefault();
    const submitter = event.nativeEvent?.submitter;
    const intent = submitter?.value ?? "preview";
    const payload = readAutomationFlowPayload(event.currentTarget);

    if (intent === "preview") {
      setResult(await onPreview(payload));
      return;
    }

    if (intent === "test") {
      setResult(await onTest({ ...payload, dryRun: true, sampleText: payload.trigger?.value || "manual automation test" }));
      return;
    }

    if (!canManage) {
      setResult({ ok: false, error: "Saving flows requires ADMIN." });
      return;
    }

    setResult(await onSave(payload));
  }

  const defaultActions = [
    {
      type: "send_channel_message",
      config: {
        channelId: channels[0]?.id ?? "",
        message: {
          mode: "embed",
          title: "VBOS Automation",
          description: "Triggered by {username} in {server}.",
          color: "#d4af37",
          footer: "VBOS"
        }
      }
    },
    { type: "log_event", config: { note: "Automation triggered by {username}" } }
  ];

  return (
    <Panel title="Automation Studio">
      {!canModerate && <PermissionNote minimumRole="MODERATOR" />}
      <div className="control-hero automation-hero">
        <div>
          <span className="eyebrow">No-code runtime flows</span>
          <h3>Triggere Discord + actiuni sigure, direct din web</h3>
          <p>Construiesti flow-uri fara shell si fara JavaScript eval. Flow-urile ruleaza pe mesaje, join/leave si test manual, cu cooldown, audit si istoric.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={!canModerate}>Refresh</button>
      </div>

      <div className="stats compact-stats">
        <div className="stat"><strong>{automations?.stats?.totalFlows ?? 0}</strong><span>Total flows</span></div>
        <div className="stat"><strong>{automations?.stats?.activeFlows ?? 0}</strong><span>Active flows</span></div>
        <div className="stat"><strong>{events.length}</strong><span>Recent events</span></div>
        <div className="stat"><strong>{automations?.stats?.maxActionsPerFlow ?? 10}</strong><span>Actions / flow</span></div>
      </div>

      <div className="automation-grid">
        <section className="panel-mini form-grid">
          <h3>Flow editor</h3>
          <form id="automation-flow-form" className="form-grid compact-form" onSubmit={submitAutomation}>
            <input name="id" type="hidden" />
            <label>Name</label>
            <input name="name" placeholder="GPU keyword helper" disabled={!canModerate} required />
            <label>Description</label>
            <input name="description" placeholder="What this automation does" disabled={!canModerate} />
            <label className="checkbox-row"><input name="enabled" type="checkbox" defaultChecked disabled={!canModerate} /><span>Enabled</span></label>
            <label>Trigger type</label>
            <select name="triggerType" defaultValue="message_contains" disabled={!canModerate}>
              {(automations?.capabilities?.triggers ?? ["message_contains", "member_join"]).map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
            <label>Trigger value / regex</label>
            <input name="triggerValue" placeholder="gpu mining" disabled={!canModerate} />
            <label className="checkbox-row"><input name="caseSensitive" type="checkbox" disabled={!canModerate} /><span>Case sensitive regex/search</span></label>
            <label>Cooldown seconds</label>
            <input name="cooldownSeconds" defaultValue="30" inputMode="numeric" disabled={!canModerate} />
            <label>Actions JSON</label>
            <textarea name="actionsJson" rows="12" defaultValue={JSON.stringify(defaultActions, null, 2)} disabled={!canModerate} />
            <div className="button-row">
              <button type="submit" name="intent" value="preview" disabled={!canModerate}>Dry-run Preview</button>
              <button type="submit" name="intent" value="test" disabled={!canManage}>Admin Test</button>
              <button type="submit" name="intent" value="save" disabled={!canManage}>Save Flow</button>
            </div>
          </form>
        </section>

        <section className="panel-mini form-grid">
          <h3>Existing flows</h3>
          <form className="form-grid compact-form" onSubmit={loadFlow}>
            <select value={selectedFlowId} onChange={(event) => setSelectedFlowId(event.target.value)} disabled={!canModerate || flows.length === 0}>
              <option value="">Choose flow</option>
              {flows.map((flow) => <option key={flow.id} value={flow.id}>{flow.enabled ? "ON" : "OFF"} | {flow.name}</option>)}
            </select>
            <div className="button-row">
              <button type="submit" disabled={!selectedFlowId}>Load</button>
              <button type="button" disabled={!canManage || !selectedFlowId} onClick={() => onDelete(selectedFlowId)}>Delete</button>
            </div>
          </form>
          <div className="custom-list automation-list">
            {flows.length === 0 ? <div className="item muted">No automation flows yet.</div> : flows.slice(0, 12).map((flow) => (
              <div className="item" key={flow.id}>
                <strong>{flow.name}</strong>
                <span>{flow.enabled ? "enabled" : "disabled"} | {flow.trigger?.type} | runs: {flow.runCount ?? 0}</span>
                <small>{flow.description || flow.id}</small>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="panel-mini automation-context">
        <h3>Discord context</h3>
        <div className="stats compact-stats">
          <div className="stat"><strong>{channels.length}</strong><span>Text channels</span></div>
          <div className="stat"><strong>{roles.length}</strong><span>Roles</span></div>
          <div className="stat"><strong>{automations?.discord?.ok ? "Ready" : "Limited"}</strong><span>Runtime</span></div>
        </div>
      </section>

      <section className="panel-mini automation-events">
        <h3>Recent automation events</h3>
        <DataList items={events} format={(item) => `${item.type} | ${item.status} | ${item.title}`} />
      </section>

      {result && (
        <section className="panel-mini message-preview">
          <h3>Preview / Last result</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </section>
      )}
    </Panel>
  );
}

function readAutomationFlowPayload(form) {
  let actions = [];
  try {
    actions = JSON.parse(form.actionsJson.value || "[]");
  } catch (error) {
    throw new Error(`Invalid actions JSON: ${error.message}`);
  }
  return {
    id: form.id.value || undefined,
    name: form.name.value,
    description: form.description.value,
    enabled: form.enabled.checked,
    trigger: {
      type: form.triggerType.value,
      value: form.triggerValue.value,
      caseSensitive: form.caseSensitive.checked
    },
    cooldownSeconds: form.cooldownSeconds.value,
    actions
  };
}

export function SettingsPanel({ settings, onTotpSetup, onTotpConfirm, onTotpDisable, pwa }) {
  async function handleConfirm(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onTotpConfirm(String(form.get("code") ?? ""));
    event.currentTarget.reset();
  }

  async function handleDisable(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onTotpDisable(String(form.get("code") ?? ""));
    event.currentTarget.reset();
  }

  return (
    <Panel title="Settings">
      <div className="settings-grid">
        <div className="totp-box">
          <h3>PWA</h3>
          <div className="item">
            <strong>Install status</strong>
            <span>{pwa.canInstall ? "Install prompt available." : "Install prompt unavailable or app already installed."}</span>
            <button type="button" onClick={pwa.onInstall} disabled={!pwa.canInstall}>Install on device</button>
          </div>
          <div className="item">
            <strong>Web push</strong>
            <span>Supported: {String(pwa.pushState.supported)}</span>
            <span>Server enabled: {String(pwa.pushState.enabled)}</span>
            <span>Permission: {pwa.pushState.permission}</span>
            <span>Subscribed: {String(pwa.pushState.subscribed)}</span>
            <div className="inline-actions">
              <button type="button" onClick={pwa.onSubscribePush} disabled={!pwa.pushState.supported || pwa.pushState.subscribed}>Subscribe</button>
              <button type="button" onClick={pwa.onUnsubscribePush} disabled={!pwa.pushState.supported || !pwa.pushState.subscribed}>Unsubscribe</button>
              <button type="button" onClick={pwa.onSendTestPush} disabled={!pwa.canSendTestPush || !pwa.pushState.subscribed}>Send test</button>
            </div>
          </div>
          <h3>Two-factor authentication</h3>
          <button type="button" onClick={onTotpSetup}>Setup 2FA</button>
          <form className="inline-form" onSubmit={handleConfirm}>
            <input name="code" inputMode="numeric" placeholder="2FA code" autoComplete="one-time-code" />
            <button type="submit">Confirm 2FA</button>
          </form>
          <form className="inline-form" onSubmit={handleDisable}>
            <input name="code" inputMode="numeric" placeholder="2FA code" autoComplete="one-time-code" />
            <button type="submit">Disable 2FA</button>
          </form>
        </div>
        <pre>{JSON.stringify(settings, null, 2)}</pre>
      </div>
    </Panel>
  );
}

export function TotpResult({ result }) {
  if (!result) return null;
  return (
    <section className="notice">
      <strong>{result.title}</strong>
      {result.lines.map((line, index) => (
        <span className="block-line" key={`${line}-${index}`}>{line}</span>
      ))}
    </section>
  );
}

function Panel({ title, children }) {
  return (
    <section className="view active">
      <div className="panel">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function DataList({ items = [], format }) {
  const visible = items.slice(-30).reverse();
  if (visible.length === 0) {
    return <div className="item">No data yet.</div>;
  }

  return (
    <div className="list">
      {visible.map((item) => (
        <div className="item" key={item.id}>
          <strong>{item.id}</strong>
          <span>{format(item)}</span>
        </div>
      ))}
    </div>
  );
}



export function CommandCenterPanel({ commandCenter, canModerate, onRefresh }) {
  const [category, setCategory] = useState("all");
  const categories = commandCenter?.categories ?? [];
  const selectedCategories = category === "all" ? categories : categories.filter((item) => item.id === category);

  return (
    <section className="view active command-center-view">
      <div className="control-hero module-hero">
        <div>
          <span className="eyebrow">Command Center</span>
          <h2>VBOS Command Surface</h2>
          <p>Catalog complet pentru comenzile Discord, modulele active, automatizari, custom commands si scurtaturi operationale. Controlul greu ramane in Admin Web, comenzile Discord sunt gateway rapid pentru staff.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={!canModerate}>Refresh</button>
      </div>
      {!canModerate && <PermissionNote minimumRole="MODERATOR" />}
      {canModerate && (
        <>
          <div className="stats">
            <div className="stat"><strong>{commandCenter?.stats?.slashCommands ?? 0}</strong><span>Slash commands</span></div>
            <div className="stat"><strong>{commandCenter?.stats?.customCommands ?? 0}</strong><span>Custom commands</span></div>
            <div className="stat"><strong>{commandCenter?.stats?.customInteractions ?? 0}</strong><span>Custom interactions</span></div>
            <div className="stat"><strong>{commandCenter?.stats?.automationFlows ?? 0}</strong><span>Automation flows</span></div>
            <div className="stat"><strong>{commandCenter?.stats?.enabledModules ?? 0}/{commandCenter?.stats?.totalModules ?? 0}</strong><span>Modules</span></div>
            <div className="stat"><strong>{commandCenter?.stats?.pendingApprovals ?? 0}</strong><span>Pending approvals</span></div>
          </div>
          <div className="module-toolbar">
            <label htmlFor="command-category">Category</label>
            <select id="command-category" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="all">All categories</option>
              {categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
            </select>
            <code>{commandCenter?.brand?.adminWeb ?? "/admin/"}</code>
          </div>
          <div className="module-grid">
            {selectedCategories.map((item) => (
              <article className="module-card status-ready" key={item.id}>
                <div className="module-card-head">
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.id}</span>
                  </div>
                  <span className="pill success">{item.commands.length} commands</span>
                </div>
                <p>{item.description}</p>
                <div className="command-chip-list">
                  {item.commands.map((command) => <code key={command}>{command}</code>)}
                </div>
              </article>
            ))}
          </div>
          <div className="module-bundle-grid">
            <div className="card module-bundle-output">
              <h3>Runtime snapshot</h3>
              <DataList items={[
                `Bot: ${commandCenter?.bot?.tag ?? "unknown"} / ${commandCenter?.bot?.ready ? "ready" : "not ready"}`,
                `Guild: ${commandCenter?.guild?.name ?? "unavailable"}`,
                `Ping: ${commandCenter?.bot?.pingMs ?? "n/a"} ms`,
                `Capabilities: shell=${String(commandCenter?.capabilities?.shellExecution)}, eval=${String(commandCenter?.capabilities?.javascriptEval)}`
              ]} format={(item) => item} />
            </div>
            <div className="card module-bundle-output">
              <h3>Recent audit tail</h3>
              <DataList items={commandCenter?.auditTail ?? []} format={(item) => `${item.type ?? "audit"} | ${item.title ?? "Event"} | ${formatDateTime(item.createdAt)}`} />
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export function ModuleCenterPanel({ modules, canModerate, canManage, onRefresh, onToggle, onExport, onImport }) {
  const [bundleText, setBundleText] = useState("");
  const [importResult, setImportResult] = useState(null);
  const [category, setCategory] = useState("all");
  const items = modules?.modules ?? [];
  const categories = ["all", ...new Set(items.map((item) => item.category).filter(Boolean))];
  const visibleItems = category === "all" ? items : items.filter((item) => item.category === category);

  async function handleToggle(module, enabled) {
    const reason = window.prompt(`Reason for ${enabled ? "enabling" : "disabling"} ${module.name}?`, enabled ? "Enable from Module Center" : "Disable from Module Center");
    if (reason === null) return;
    await onToggle(module.id, { enabled, reason });
  }

  async function handleExport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const moduleIds = parseTextareaList(form.get("moduleIds"));
    const bundle = await onExport({ moduleIds, includeAll: moduleIds.length === 0 });
    setBundleText(JSON.stringify(bundle, null, 2));
    setImportResult(null);
  }

  async function handleImport(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const dryRun = form.get("dryRun") !== "off";
    const result = await onImport({ bundle: form.get("bundle"), dryRun });
    setImportResult(result);
  }

  return (
    <section className="view active">
      <div className="control-hero module-hero">
        <div>
          <span className="eyebrow">VBOS Module Center</span>
          <h2>Feature Marketplace / Module Control</h2>
          <p>Controleaza modulele VBOS din web: status, risc, dependinte, export/import bundle si toggle auditat. Fara shell, fara eval, fara cod arbitrar.</p>
        </div>
        <button type="button" onClick={onRefresh} disabled={!canModerate}>Refresh</button>
      </div>

      <div className="stats compact-stats">
        <div className="stat"><strong>{modules?.stats?.total ?? 0}</strong><span>Total modules</span></div>
        <div className="stat"><strong>{modules?.stats?.enabled ?? 0}</strong><span>Enabled</span></div>
        <div className="stat"><strong>{modules?.stats?.disabled ?? 0}</strong><span>Disabled</span></div>
        <div className="stat"><strong>{modules?.stats?.dependencyWarnings ?? 0}</strong><span>Warnings</span></div>
      </div>

      {!canModerate && <PermissionNote minimumRole="MODERATOR" />}

      <div className="module-toolbar">
        <label>Category</label>
        <select value={category} onChange={(event) => setCategory(event.target.value)}>
          {categories.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </div>

      <div className="module-grid">
        {visibleItems.map((module) => (
          <article className={`module-card status-${module.status} risk-${module.risk}`} key={module.id}>
            <div className="module-card-head">
              <div>
                <strong>{module.name}</strong>
                <span>{module.category} | {module.risk} risk | {module.minimumRole}+</span>
              </div>
              <span className={`pill ${module.enabled ? "success" : "muted"}`}>{module.enabled ? "Enabled" : "Disabled"}</span>
            </div>
            <p>{module.description}</p>
            <div className="module-meta">
              <small>Routes: {(module.routes ?? []).join(", ") || "none"}</small>
              <small>Endpoints: {(module.endpoints ?? []).join(", ") || "none"}</small>
              <small>Dependencies: {(module.dependencies ?? []).join(", ") || "none"}</small>
            </div>
            {(module.warnings ?? []).length > 0 && (
              <div className="module-warnings">
                {module.warnings.map((warning, index) => <span key={`${module.id}-warning-${index}`}>{warning.message}</span>)}
              </div>
            )}
            <div className="button-row">
              <button type="button" disabled={!canManage || module.enabled || module.locked} onClick={() => handleToggle(module, true)}>Enable</button>
              <button type="button" disabled={!canManage || !module.enabled || module.locked} onClick={() => handleToggle(module, false)}>Disable</button>
            </div>
            {module.locked && <small className="muted">Locked core module. It cannot be disabled from web.</small>}
            {module.updatedAt && <small className="muted">Updated by {module.updatedByTag ?? "unknown"} at {formatDateTime(module.updatedAt)}</small>}
          </article>
        ))}
      </div>

      <div className="module-bundle-grid">
        <form className="card" onSubmit={handleExport}>
          <h3>Export module bundle</h3>
          <p className="muted">Lasa gol pentru export complet. Sau pune IDs: custom, automations, operations, economy.</p>
          <textarea name="moduleIds" rows="5" placeholder="custom\nautomations\noperations" disabled={!canManage} />
          <button type="submit" disabled={!canManage}>Export Bundle</button>
        </form>

        <form className="card" onSubmit={handleImport}>
          <h3>Import module bundle</h3>
          <textarea name="bundle" rows="8" placeholder="Paste VBOS module bundle JSON" value={bundleText} onChange={(event) => setBundleText(event.target.value)} disabled={!canManage} />
          <label className="checkbox-row"><input type="checkbox" name="dryRun" defaultChecked disabled={!canManage} /><span>Dry-run first</span></label>
          <button type="submit" disabled={!canManage || !bundleText.trim()}>Import / Preview</button>
        </form>
      </div>

      {bundleText && (
        <div className="card module-bundle-output">
          <h3>Bundle JSON</h3>
          <pre>{bundleText}</pre>
        </div>
      )}

      {importResult && (
        <div className="card module-bundle-output">
          <h3>Import result</h3>
          <pre>{JSON.stringify(importResult, null, 2)}</pre>
        </div>
      )}

      <div className="control-lists module-events">
        <h3>Recent module events</h3>
        {(modules?.recentEvents ?? []).length === 0 ? <div className="item muted">No module events yet.</div> : (modules?.recentEvents ?? []).map((event) => (
          <div className="item split-item" key={event.id ?? `${event.type}-${event.createdAt}`}>
            <div>
              <strong>{event.title ?? event.type}</strong>
              <span>{event.description}</span>
              <small>{event.actorTag ?? "system"} | {formatDateTime(event.createdAt)}</small>
            </div>
            <code>{event.moduleId}</code>
          </div>
        ))}
      </div>
    </section>
  );
}


function PermissionNote({ minimumRole }) {
  return <div className="item muted">Requires minimum role: {minimumRole}.</div>;
}

function SparklineChart({ title, items, valueKey, formatValue }) {
  const points = items
    .map((item) => ({
      value: Number(item?.[valueKey]),
      label: item?.createdAt
    }))
    .filter((item) => Number.isFinite(item.value));
  const width = 420;
  const height = 160;
  const latest = points.at(-1)?.value ?? null;

  return (
    <div className="chart-card">
      <div className="chart-header">
        <strong>{title}</strong>
        <span>{latest == null ? "No data" : formatValue(latest)}</span>
      </div>
      {points.length < 2 ? (
        <div className="chart-empty">Need at least two samples for a graph.</div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title} chart`}>
          <path className="chart-grid-line" d={`M0 ${height - 24} H${width}`} />
          <path className="chart-line" d={buildSparklinePath(points, width, height)} />
          {points.map((point, index) => {
            const [cx, cy] = pointToSvg(point.value, index, points, width, height);
            return <circle key={`${point.label}-${index}`} cx={cx} cy={cy} r="3" />;
          })}
        </svg>
      )}
    </div>
  );
}

function buildSparklinePath(points, width, height) {
  return points.map((point, index) => {
    const [x, y] = pointToSvg(point.value, index, points, width, height);
    return `${index === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(" ");
}

function pointToSvg(value, index, points, width, height) {
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const padding = 18;
  const x = points.length === 1
    ? width / 2
    : padding + (index / (points.length - 1)) * (width - padding * 2);
  const y = height - padding - ((value - min) / range) * (height - padding * 2);
  return [x, y];
}

function formatDateTime(value) {
  if (!value) return "Unknown time";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function formatNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)}%`;
}

function formatMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value)} ms`;
}

function formatSupply(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value)} VIRE`;
}

function formatHashRate(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Unavailable";
  const units = ["H/s", "KH/s", "MH/s", "GH/s", "TH/s", "PH/s"];
  let rate = value;
  let unitIndex = 0;
  while (rate >= 1000 && unitIndex < units.length - 1) {
    rate /= 1000;
    unitIndex += 1;
  }
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(rate)} ${units[unitIndex]}`;
}

function parseTextareaList(value) {
  return String(value ?? "")
    .split(/[\n,]/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function calculatePreviewXpForLevel(level, xp) {
  const base = Math.max(1, Number(xp.levelBaseXp) || 100);
  const targetLevel = Math.max(0, Number(level) || 0);

  if (xp.levelCurve === "linear") {
    return Math.floor(base * targetLevel);
  }

  if (xp.levelCurve === "exponential") {
    const growth = Math.max(1.01, Number(xp.levelGrowthFactor) || 1.35);
    return Math.floor(base * ((growth ** targetLevel - 1) / (growth - 1)));
  }

  return Math.floor(base * targetLevel * targetLevel);
}
