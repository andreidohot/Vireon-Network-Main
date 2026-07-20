#!/usr/bin/env bash
set -Eeuo pipefail
workspace="${VEIRON_WORKSPACE:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"; cd "$workspace"; set -a; source .env; set +a
compose=(docker compose --env-file .env -f compose.yaml); [[ "${CLOUDFLARE_MODE:-disabled}" == tunnel ]] || compose+=(-f compose.direct.yaml)
profiles=(--profile backup); [[ "${CLOUDFLARE_MODE:-disabled}" == tunnel ]] && profiles+=(--profile cloudflare); [[ "${ENABLE_POOL:-false}" == true ]] && profiles+=(--profile pool)
required=(veiron-node veiron-rpc veiron-indexer veiron-control docker-broker veiron-ops caddy prometheus grafana loki); deadline=$((SECONDS+420))
while ((SECONDS<deadline)); do fail=0; for s in "${required[@]}"; do c="$("${compose[@]}" "${profiles[@]}" ps -q "$s" 2>/dev/null || true)"; [[ -n $c ]] || { fail=1; continue; }; st="$(docker inspect -f '{{.State.Status}}' "$c")"; h="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")"; [[ $st == running && $h != unhealthy ]] || fail=1; done; ((fail==0)) && break; sleep 5; done
for s in "${required[@]}"; do c="$("${compose[@]}" "${profiles[@]}" ps -q "$s")"; [[ "$(docker inspect -f '{{.State.Status}}' "$c")" == running ]] || exit 1; [[ "$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$c")" != unhealthy ]] || exit 1; done
"${compose[@]}" exec -T veiron-rpc curl -fsS http://127.0.0.1:10787/health >/dev/null
"${compose[@]}" exec -T veiron-control curl -fsS http://127.0.0.1:10788/health >/dev/null
[[ "${ENABLE_POOL:-false}" != true ]] || "${compose[@]}" exec -T veiron-pool curl -fsS http://127.0.0.1:30787/health >/dev/null
echo "Veiron Docker stack healthy; PostgreSQL intentionally absent until a real DB adapter exists."
