#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; repo="$(cd "$root/../.." && pwd)"; cd "$root"; [[ -f .env ]] || { echo "Missing .env" >&2; exit 66; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "state/repair-backups/$stamp" state/secrets; cp -a .env "state/repair-backups/$stamp/"
# Disable and preserve remnants from the old updater design before rebuilding.
rm -f scripts/update-stack.sh
rm -rf docker/updater
if [[ -d state/rollback ]]; then
  mkdir -p state/legacy-disabled
  mv state/rollback "state/legacy-disabled/rollback-$stamp"
fi
for n in broker_token setup_token admin_password grafana_password pool_admin_token backup_passphrase cloudflare_tunnel_token; do [[ -s state/secrets/$n && "$(cat state/secrets/$n)" != validation-placeholder ]] || openssl rand -hex 32 > state/secrets/$n; chmod 600 state/secrets/$n; done
for n in cloudflare_api_token r2_secret_access_key discord_webhook telegram_bot_token smtp_password; do [[ -e state/secrets/$n ]] || : > state/secrets/$n; chmod 600 state/secrets/$n; done
python3 - "$root" "$repo" <<'P'
from pathlib import Path
import re,sys
p=Path('.env'); s=p.read_text(); root,repo=sys.argv[1:]
for k,v in [('STACK_VERSION','2.1.0-no-autoupdate'),('VEIRON_HOST_WORKSPACE',root),('VEIRON_HOST_REPO',repo),('VEIRON_BACKUP_IMAGE','ghcr.io/andreidohot/veiron-backup-scheduler')]:
 line=f"{k}='{v}'"; s=re.sub(rf'^{k}=.*$',line,s,flags=re.M) if re.search(rf'^{k}=',s,re.M) else s+'\n'+line+'\n'
for k in ['POSTGRES_DB','POSTGRES_USER','POSTGRES_MEMORY_LIMIT']: s=re.sub(rf'^{k}=.*\n?','',s,flags=re.M)
p.write_text(s)
P
mkdir -p state/data/{chain,mempool,indexer,node} state/control state/pool state/config/generated; chown -R 10001:10001 state/data state/control state/pool state/config/generated || true
for n in veiron-node veiron-rpc veiron-indexer veiron-control veiron-pool veiron-ops veiron-caddy veiron-cloudflared veiron-postgres veiron-postgres-exporter veiron-backup-agent veiron-docker-broker veiron-updater veiron-cadvisor veiron-watchtower; do docker rm -f "$n" 2>/dev/null || true; done
set -a; source .env; set +a; [[ "${CLOUDFLARE_MODE:-disabled}" == disabled ]] || scripts/cloudflare-bootstrap.sh
c=(docker compose --env-file .env -f compose.yaml); [[ "${CLOUDFLARE_MODE:-disabled}" == tunnel ]] || c+=(-f compose.direct.yaml); p=(--profile backup); [[ "${CLOUDFLARE_MODE:-disabled}" == tunnel ]] && p+=(--profile cloudflare); [[ "${ENABLE_POOL:-false}" == true ]] && p+=(--profile pool)
COMPOSE_PARALLEL_LIMIT=1 "${c[@]}" "${p[@]}" up -d --build --remove-orphans; scripts/health-check-docker.sh
echo "Repair complete; backup: state/repair-backups/$stamp"
