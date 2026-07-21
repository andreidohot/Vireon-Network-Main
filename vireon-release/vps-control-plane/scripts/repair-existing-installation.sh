#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; repo="$(cd "$root/../.." && pwd)"; cd "$root"; [[ -f .env ]] || { echo "Missing .env" >&2; exit 66; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)"; mkdir -p "state/repair-backups/$stamp" state/secrets; cp -a .env "state/repair-backups/$stamp/"
# Preserve disabled rollback state from the former updater design.
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
for k,v in [('STACK_VERSION','2.1.0-no-autoupdate'),('VIREON_HOST_WORKSPACE',root),('VIREON_HOST_REPO',repo),('VIREON_BACKUP_IMAGE','ghcr.io/andreidohot/vireon-backup-scheduler')]:
 line=f"{k}={__import__('json').dumps(v)}"; s=re.sub(rf'^{k}=.*$',line,s,flags=re.M) if re.search(rf'^{k}=',s,re.M) else s+'\n'+line+'\n'
for k in ['POSTGRES_DB','POSTGRES_USER','POSTGRES_MEMORY_LIMIT']: s=re.sub(rf'^{k}=.*\n?','',s,flags=re.M)
p.write_text(s)
P
"$root/scripts/prepare-state.sh"
# Stop and preserve old host services. Unit files and data are not deleted.
legacy_units=(veiron-indexer-refresh.timer veiron-auto-update.timer veiron-mining-pool veiron-vps-admin veiron-rpc veiron-node vireon-indexer-refresh.timer vireon-auto-update.timer vireon-mining-pool vireon-vps-admin vireon-rpc vireon-node)
for unit in "${legacy_units[@]}"; do
  systemctl disable --now "$unit" 2>/dev/null || true
done

# Preserve conflicting containers under a timestamped legacy name instead of
# deleting them. Legacy-named containers are stopped in place.
for old in veiron-node veiron-rpc veiron-indexer veiron-control veiron-pool veiron-ops veiron-caddy veiron-cloudflared veiron-docker-broker veiron-updater veiron-cadvisor veiron-watchtower; do
  docker update --restart=no "$old" >/dev/null 2>&1 || true
  docker stop "$old" >/dev/null 2>&1 || true
done
for current in vireon-node vireon-rpc vireon-mining-rpc vireon-indexer vireon-control vireon-pool vireon-ops vireon-caddy vireon-cloudflared vireon-docker-broker; do
  if docker container inspect "$current" >/dev/null 2>&1; then
    docker update --restart=no "$current" >/dev/null
    docker stop "$current" >/dev/null 2>&1 || true
    docker rename "$current" "legacy-${stamp}-${current}"
  fi
done

source scripts/lib.sh
load_dotenv .env
compose_args
if [[ "${CLOUDFLARE_MODE:-disabled}" == tunnel ]]; then
  scripts/cloudflare-bootstrap.sh --prepare
fi
COMPOSE_PARALLEL_LIMIT=1 "${VIREON_COMPOSE_ARGS[@]}" "${VIREON_PROFILE_ARGS[@]}" up -d --build
scripts/health-check-docker.sh
if [[ "${CLOUDFLARE_MODE:-disabled}" != disabled ]]; then
  scripts/cloudflare-bootstrap.sh --activate
  scripts/verify-public-health.sh
fi
echo "Repair complete; backup: state/repair-backups/$stamp"
