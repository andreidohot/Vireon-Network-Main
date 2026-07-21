#!/usr/bin/env bash
set -Eeuo pipefail
workspace="${VIREON_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$workspace"
source scripts/lib.sh
load_dotenv .env
compose_args
stamp="$(date -u +%Y%m%dT%H%M%SZ)"; out="state/backups/$stamp"; mkdir -p "$out"
services=(vireon-indexer vireon-control vireon-rpc vireon-node)
[[ "${ENABLE_POOL:-false}" == true ]] && services=(vireon-pool vireon-mining-rpc "${services[@]}")
stopped=false
cleanup(){ [[ "$stopped" == true ]] && "${VIREON_COMPOSE_ARGS[@]}" "${VIREON_PROFILE_ARGS[@]}" up -d "${services[@]}" >/dev/null 2>&1 || true; }
trap cleanup EXIT
if [[ "${CHAIN_SNAPSHOT_STOP_SERVICES:-true}" == true ]]; then
  "${VIREON_COMPOSE_ARGS[@]}" "${VIREON_PROFILE_ARGS[@]}" stop "${services[@]}" || true
  stopped=true
fi
items=(state/data state/control state/pool state/config/generated .env); existing=(); for i in "${items[@]}"; do [[ -e $i ]] && existing+=("$i"); done
tar -czf "$out/vireon-state.tar.gz" "${existing[@]}"
pass=/run/secrets/backup_passphrase; [[ -s $pass ]] || pass=state/secrets/backup_passphrase
tar -czf - state/secrets | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 -pass "file:$pass" -out "$out/vireon-secrets.tar.gz.enc"
sha256sum "$out"/* > "$out/SHA256SUMS"
if [[ "${BACKUP_REMOTE_ENABLED:-false}" == true ]]; then
 secret=/run/secrets/r2_secret_access_key; [[ -s $secret ]] || secret=state/secrets/r2_secret_access_key
 export RCLONE_CONFIG_R2_TYPE=s3 RCLONE_CONFIG_R2_PROVIDER=Other RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT" RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$(cat "$secret")" RCLONE_CONFIG_R2_REGION="${R2_REGION:-auto}"
 rclone copy "$out" "r2:${R2_BUCKET}/vireon/$stamp" --checksum
fi
find state/backups -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS:-30}" -exec rm -rf {} +
cleanup; stopped=false; echo "Backup completed: $out"
