#!/usr/bin/env bash
set -Eeuo pipefail
workspace="${VIREON_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$workspace"
source scripts/lib.sh
load_dotenv .env
compose_args
required=(vireon-node vireon-rpc vireon-indexer vireon-control docker-broker vireon-ops caddy prometheus alertmanager blackbox-exporter node-exporter loki alloy grafana backup-scheduler); deadline=$((SECONDS+420))
[[ "${CLOUDFLARE_MODE:-disabled}" == tunnel ]] && required+=(cloudflared)
[[ "${ENABLE_POOL:-false}" == true ]] && required+=(vireon-mining-rpc vireon-pool)
while ((SECONDS<deadline)); do fail=0; for s in "${required[@]}"; do c="$("${VIREON_COMPOSE_ARGS[@]}" "${VIREON_PROFILE_ARGS[@]}" ps -q "$s" 2>/dev/null || true)"; [[ -n $c ]] || { fail=1; continue; }; st="$(docker inspect -f '{{.State.Status}}' "$c")"; h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")"; [[ $st == running && $h != unhealthy ]] || fail=1; done; ((fail==0)) && break; sleep 5; done
for s in "${required[@]}"; do c="$("${VIREON_COMPOSE_ARGS[@]}" "${VIREON_PROFILE_ARGS[@]}" ps -q "$s")"; [[ "$(docker inspect -f '{{.State.Status}}' "$c")" == running ]] || exit 1; [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")" != unhealthy ]] || exit 1; done
"${VIREON_COMPOSE_ARGS[@]}" exec -T vireon-rpc curl -fsS http://127.0.0.1:10787/health >/dev/null
"${VIREON_COMPOSE_ARGS[@]}" exec -T vireon-control curl -fsS http://127.0.0.1:10788/health >/dev/null
[[ "${ENABLE_POOL:-false}" != true ]] || "${VIREON_COMPOSE_ARGS[@]}" exec -T vireon-pool curl -fsS http://127.0.0.1:30787/health >/dev/null
echo "Vireon Docker stack healthy; PostgreSQL intentionally absent until a real DB adapter exists."
