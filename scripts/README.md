# Scripts

Automation, build helpers, release helpers and development utilities.

Status: Draft

## Browser native host

| Script | Purpose |
|---|---|
| `browser/setup-extension.ps1` | Windows: guided load-unpacked + optional register |
| `browser/register-native-host.ps1` | Windows: build/copy host, write manifest, register Chrome/Edge/Brave |
| `browser/unregister-native-host.ps1` | Windows: remove registry entries (optional install dir) |
| `browser/register-native-host.sh` | Linux: install host + Chromium NativeMessagingHosts links |
| `browser/probe-chain.ps1` / `.sh` | Health + tip + chain probe; Watch/Strict/Webhook |
| `browser/check-health.sh` | Thin CI/cron wrapper around `--check-health` |
| `browser/register-health-task.ps1` | Windows Scheduled Task for periodic probe + logs |
| `browser/print-epic-pr-paths.ps1` | Print suggested git paths for SDK/browser/health PR split (no stage) |
| `browser/prepare-clean-pr-worktree.ps1` | Create clean worktree from origin/main + copy PR files (no commit) |
| `browser/verify-pr-worktrees.ps1` | Run cargo/health checks against existing `../vireon-pr-{a,b,c,d}` worktrees |

Ops doc: `docs/operator/CHAIN_HEALTH.md`  
CI: `.github/workflows/candidate-chain-health.yml`

See `vireon-browser/README.md`.
