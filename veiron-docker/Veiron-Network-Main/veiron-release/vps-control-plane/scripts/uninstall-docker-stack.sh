#!/usr/bin/env bash
set -Eeuo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; cd "$root"; purge=false; [[ "${1:-}" == --purge-data ]] && purge=true
if [[ -f .env ]]; then set -a; source .env; set +a; c=(docker compose --env-file .env -f compose.yaml); [[ "${CLOUDFLARE_MODE:-disabled}" == tunnel ]] || c+=(-f compose.direct.yaml); "${c[@]}" --profile cloudflare --profile pool --profile backup down --remove-orphans || true; fi
[[ -f .installer.env ]] && docker compose --env-file .installer.env -f installer.compose.yaml down --remove-orphans || true
if $purge; then read -r -p 'Type PURGE: ' a; [[ $a == PURGE ]] && rm -rf state .env .installer.env; fi
