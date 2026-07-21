const NAV_ITEMS = [
  ["overview", "Overview"],
  ["commands", "Command Center"],
  ["control", "Control Center"],
  ["operations", "Bot Studio"],
  ["custom", "Custom Lab"],
  ["automations", "Automation Studio"],
  ["modules", "Module Center"],
  ["embeds", "Embeds"],
  ["tickets", "Tickets"],
  ["moderation", "Moderation"],
  ["proposals", "Proposals"],
  ["automod", "Automod"],
  ["spam", "Anti-Spam"],
  ["audit", "Audit Log"],
  ["economy", "Economy/Leveling"],
  ["permissions", "Permissions"],
  ["music", "Music"],
  ["wallet", "Wallet/Payments"],
  ["blockchain", "Blockchain Status"],
  ["settings", "Settings"]
];

export function Shell({ route, onRouteChange, auth, status, children, onLogin, onLogout }) {
  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="mark">V</span>
          <div>
            <strong>VBOS</strong>
            <small>Community Admin</small>
          </div>
        </div>
        <nav aria-label="Dashboard sections">
          {NAV_ITEMS.map(([key, label]) => (
            <button
              className={route === key ? "active" : ""}
              key={key}
              onClick={() => onRouteChange(key)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <main>
        <header>
          <div>
            <h1>VBOS</h1>
            <p>Single control panel for Discord community operations.</p>
          </div>
          <AuthBar auth={auth} onLogin={onLogin} onLogout={onLogout} />
        </header>

        <section className="notice" role="status">{status}</section>
        {children}
      </main>
    </div>
  );
}

function AuthBar({ auth, onLogin, onLogout }) {
  const userLabel = auth.user ? `${auth.user.email} (${auth.user.role})` : "Not logged in";

  async function handleLogin(event) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await onLogin({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
      totpCode: String(form.get("totpCode") ?? "")
    });
    event.currentTarget.reset();
  }

  return (
    <div className="auth-panel">
      <span>{userLabel}</span>
      <form className="auth-box" onSubmit={handleLogin}>
        <input name="email" type="email" placeholder="Email" autoComplete="username" />
        <input name="password" type="password" placeholder="Password" autoComplete="current-password" />
        <input name="totpCode" inputMode="numeric" placeholder="2FA code" autoComplete="one-time-code" />
        <button type="submit">Login</button>
        <button type="button" onClick={onLogout}>Logout</button>
      </form>
    </div>
  );
}
