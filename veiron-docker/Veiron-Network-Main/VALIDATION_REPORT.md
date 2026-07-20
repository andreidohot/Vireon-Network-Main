# Validation report — 2.1.0-no-autoupdate

```json
{
  "version": "2.1.0-no-autoupdate",
  "validated": [
    "YAML parse",
    "JSON parse",
    "Python compile",
    "Bash syntax",
    "legacy storage paths absent",
    "PostgreSQL wiring absent",
    "cAdvisor absent",
    "one Docker socket holder per deployment mode",
    "duplicate init absent",
    "Docker-native enrollment patch present",
    "auto-update, updater, update API, rollback API, Watchtower and scheduled pull absent",
    "mutable latest defaults absent",
    "cloudflared internal auto-update disabled"
  ],
  "not_run_in_artifact_environment": [
    "Docker Compose rendering",
    "Docker image builds",
    "Rust compilation/tests",
    "Cloudflare API",
    "live VPS health checks"
  ]
}
```
