#!/usr/bin/env bash
set -Eeuo pipefail
component="${VIREON_COMPONENT:-}"
config_dir="${VIREON_CONFIG_DIR:-/config}"
chain_root="${VIREON_CHAIN_ROOT:-/data/.vireon-mainnet}"
chain_dir="$chain_root/chain"; mempool_dir="$chain_root/mempool"; index_dir="$chain_root/indexer"
mkdir -p "$config_dir" "$chain_dir" "$mempool_dir" "$index_dir" "$chain_root/node"
required_env(){ local n="$1"; [[ -n "${!n:-}" ]] || { echo "ERROR: missing $n" >&2; exit 64; }; }
render(){ envsubst < "$1" > "$2.tmp"; mv "$2.tmp" "$2"; }
export BASE_DOMAIN="${BASE_DOMAIN:-example.invalid}" NODE_NAME="${NODE_NAME:-vireon-node}" RPC_HOST="${RPC_HOST:-rpc.${BASE_DOMAIN}}" CONTROL_HOST="${CONTROL_HOST:-control.${BASE_DOMAIN}}" POOL_HOST="${POOL_HOST:-pool.${BASE_DOMAIN}}" P2P_HOST="${P2P_HOST:-node.${BASE_DOMAIN}}" SEED_NODES_TOML="${SEED_NODES_TOML:-}"
export RPC_ACCESS_MODE="${RPC_ACCESS_MODE:-public-submit}" RPC_EXPOSE_MINING="${RPC_EXPOSE_MINING:-false}"
export CONTROLLER_URL_TOML='""'; [[ -n "${CONTROLLER_URL:-}" ]] && CONTROLLER_URL_TOML="\"${CONTROLLER_URL}\""
case "$component" in
 node)
  render /app/templates/node.toml.template "$config_dir/node.toml"
  stop_node(){ vireon-node --config "$config_dir/node.toml" --data-dir "$chain_dir" --mempool-dir "$mempool_dir" shutdown || true; }
  trap stop_node TERM INT
  vireon-node --config "$config_dir/node.toml" --data-dir "$chain_dir" --mempool-dir "$mempool_dir" start-node & child=$!; wait "$child" ;;
 rpc)
  render /app/templates/node.toml.template "$config_dir/rpc-node.toml"; render /app/templates/rpc.toml.template "$config_dir/rpc.toml"
  exec vireon-rpc-gateway --config "$config_dir/rpc.toml" --node-config "$config_dir/rpc-node.toml" ;;
 mining-rpc)
  render /app/templates/node.toml.template "$config_dir/mining-node.toml"; render /app/templates/rpc.toml.template "$config_dir/mining-rpc.toml"
  exec vireon-rpc-gateway --config "$config_dir/mining-rpc.toml" --node-config "$config_dir/mining-node.toml" ;;
 indexer)
  interval="${INDEXER_INTERVAL_SECONDS:-15}"
  while true; do if vireon-indexer --network mainnet-candidate --chain-data-dir "$chain_dir" --index-dir "$index_dir" sync; then date -u +%FT%TZ > "$index_dir/.last-success"; else echo "Indexer refresh failed" >&2; fi; sleep "$interval"; done ;;
 control)
  render /app/templates/admin.toml.template "$config_dir/admin.toml"
  if [[ -n "${CONTROLLER_URL:-}" && -n "${ENROLLMENT_TOKEN:-}" && ! -s /data/control/agent-credentials.json ]]; then umask 077; printf '%s' "$ENROLLMENT_TOKEN" > /data/control/enrollment.token; fi
  exec vireon-vps-admin --config "$config_dir/admin.toml" ;;
 pool)
  required_env POOL_ADDRESS; render /app/templates/pool.toml.template "$config_dir/pool.toml"; exec vireon-mining-pool --config "$config_dir/pool.toml" ;;
 *) echo "ERROR: invalid VIREON_COMPONENT" >&2; exit 64 ;;
esac
