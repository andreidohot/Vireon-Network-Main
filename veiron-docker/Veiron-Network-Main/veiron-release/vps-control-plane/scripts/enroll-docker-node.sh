#!/usr/bin/env bash
set -Eeuo pipefail
node=""; host=""; email=""; controller=""; token=""; bundle=""; seeds=()
while (($#)); do case "$1" in --node-name) node="$2";shift 2;; --p2p-host|--domain) host="$2";shift 2;; --email) email="$2";shift 2;; --controller-url) controller="$2";shift 2;; --enrollment-token) token="$2";shift 2;; --seed) seeds+=("$2");shift 2;; --release-bundle-url) bundle="$2";shift 2;; *) exit 64;; esac; done
[[ -n $node && -n $host && -n $email && $controller == https://* && -n $token ]] || exit 64
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; repo="$(cd "$root/../.." && pwd)"; cd "$root"; base="${host#*.}"
mkdir -p state/secrets state/config/generated state/data/{chain,mempool,indexer,node} state/control state/pool
for n in admin_password grafana_password setup_token broker_token cloudflare_tunnel_token pool_admin_token backup_passphrase; do openssl rand -hex 32 > state/secrets/$n; chmod 600 state/secrets/$n; done
for n in cloudflare_api_token r2_secret_access_key discord_webhook telegram_bot_token smtp_password; do : > state/secrets/$n; chmod 600 state/secrets/$n; done
st=""; for x in "${seeds[@]}"; do [[ -n $st ]] && st+=", "; st+="\"$x\""; done
cat > .env <<EOF
COMPOSE_PROJECT_NAME='veiron-agent-${node}'
STACK_VERSION='2.1.0-no-autoupdate'
VEIRON_HOST_WORKSPACE='$root'
VEIRON_HOST_REPO='$repo'
VEIRON_VERSION='2.1.0-no-autoupdate'
BASE_DOMAIN='$base'
NODE_NAME='$node'
ADMIN_EMAIL='$email'
CONTROL_ROLE='agent'
CONTROLLER_URL='$controller'
ENROLLMENT_TOKEN='$token'
RELEASE_BUNDLE_URL='$bundle'
P2P_HOST='$host'
P2P_PORT='20787'
SEED_NODES_TOML='$st'
CLOUDFLARE_MODE='disabled'
ENABLE_POOL='false'
INDEXER_INTERVAL_SECONDS='15'
EOF
chown -R 10001:10001 state/data state/control state/pool state/config/generated || true
COMPOSE_PARALLEL_LIMIT=1 docker compose --env-file .env -f compose.yaml up -d --build veiron-node veiron-rpc veiron-indexer veiron-control
