#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
require_docker=false
[[ "${1:-}" == --require-docker ]] && require_docker=true
[[ -f .env ]] || cp .env.example .env
mkdir -p state/secrets state/config/generated
for secret in admin_password grafana_password setup_token broker_token cloudflare_api_token cloudflare_tunnel_token pool_admin_token backup_passphrase r2_secret_access_key discord_webhook telegram_bot_token smtp_password; do
  [[ -f "state/secrets/$secret" ]] || printf 'validation-placeholder\n' > "state/secrets/$secret"
done
[[ -f state/config/generated/alertmanager.yml ]] || cp monitoring/alertmanager/alertmanager.yml state/config/generated/alertmanager.yml
python3 - <<'PY2'
import json
from pathlib import Path
import yaml
root=Path('.')
yaml_paths=[
 root/'compose.yaml', root/'compose.direct.yaml', root/'installer.compose.yaml',
 root/'monitoring/prometheus/prometheus.yml', root/'monitoring/prometheus/alerts.yml',
 root/'monitoring/alertmanager/alertmanager.yml', root/'monitoring/blackbox/blackbox.yml',
 root/'monitoring/loki/loki.yml', root/'monitoring/grafana/provisioning/datasources/datasources.yml',
 root/'monitoring/grafana/provisioning/dashboards/dashboard-provider.yml',
]
for path in yaml_paths:
 yaml.safe_load(path.read_text())
json.loads((root/'monitoring/grafana/dashboards/vireon-overview.json').read_text())
operational='\n'.join((root/p).read_text() for p in [
 'compose.yaml','installer.compose.yaml','docker/entrypoint.sh','docker/templates/rpc.toml.template',
 'docker/ops/app.py','docker/ops/broker.py','docker/ops/templates/index.html',
 'monitoring/prometheus/prometheus.yml','monitoring/prometheus/alerts.yml',
])
for legacy in ('/data/chain','/data/mempool','/data/indexer','/data/node'):
 assert legacy not in operational, f'legacy storage path remains: {legacy}'
for forbidden in ('privileged: true','init: true','DATABASE_URL','postgres-exporter','vireon-postgres','cadvisor:','vireon-cadvisor','watchtower','update-stack.sh','/api/update','/api/rollback',"a=='update'","a=='rollback'","compose('pull'",'DEPLOYMENT_SOURCE'):
 assert forbidden not in operational, f'forbidden mechanism remains: {forbidden}'
assert 'value="latest"' not in operational
assert '${VIREON_VERSION:-latest}' not in operational
assert '--no-autoupdate' in (root/'compose.yaml').read_text()
assert not (root/'scripts/update-stack.sh').exists()
for legacy_path in (
 'install.sh','install-interactive.sh','auto-install.sh','auto-update.sh','health-check.sh',
 'uninstall.sh','nginx','systemd',
):
 assert not (root/legacy_path).exists(), f'legacy host deployment path remains: {legacy_path}'
main=(root/'compose.yaml').read_text(); installer=(root/'installer.compose.yaml').read_text()
assert ',mode=' not in main
assert ',mode=' not in installer
assert main.count('/var/run/docker.sock:/var/run/docker.sock') == 1
assert installer.count('/var/run/docker.sock:/var/run/docker.sock') == 1
assert 'VIREON_COMPONENT: mining-rpc' in main
assert 'profiles: [pool]' in main
assert 'RPC_ACCESS_MODE: private-mining' in main
assert 'RPC_EXPOSE_MINING: "false"' in main
assert 'working_dir: /app' in main
assert 'state/data \\' in (root/'scripts/prepare-state.sh').read_text()
assert 'create_owned 473 473 state/alloy' in (root/'scripts/prepare-state.sh').read_text()
assert 'user: "473:0"' in main
assert 'chmod 0444' in (root/'scripts/prepare-state.sh').read_text()
assert 'ports:' not in main.split('  vireon-mining-rpc:', 1)[1].split('  vireon-indexer:', 1)[0]
proxy=(root/'docker/caddy/Caddyfile.template').read_text()
assert 'handle_path /pool/*' in proxy
assert 'reverse_proxy vireon-pool:30787' in proxy
assert '/data/.vireon-mainnet/chain' in operational
assert '/data/.vireon-mainnet/mempool' in operational
PY2
python3 -m py_compile docker/ops/app.py docker/ops/broker.py
find scripts docker -type f -name '*.sh' -print0 | xargs -0 -n1 bash -n
if grep -R -n --exclude=validate-stack.sh -E 'source[[:space:]]+\.env|docker[[:space:]]+rm|docker[[:space:]]+container[[:space:]]+rm|docker compose down -v' scripts docker compose.yaml installer.compose.yaml; then
  echo "Unsafe dotenv execution, container deletion, or volume deletion found." >&2
  exit 1
fi
echo "Static YAML, JSON, Python, Bash, storage, security and no-auto-update validation passed."
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose --env-file .env -f compose.yaml config >/dev/null
  VIREON_HOST_WORKSPACE="$root" VIREON_HOST_REPO="$(cd ../.. && pwd)" docker compose -f installer.compose.yaml config >/dev/null
  echo "Docker Compose rendering passed."
elif [[ "$require_docker" == true ]]; then
  echo "Docker Compose v2 is required for full validation." >&2; exit 127
else
  echo "WARNING: Docker unavailable; Compose rendering and image builds were not executed." >&2
fi
