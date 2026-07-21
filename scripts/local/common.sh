#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
default_local_root="$WORKSPACE_ROOT/.vireon-local"
if [[ -z "${VIREON_LOCAL_ROOT:-}" && -d "$WORKSPACE_ROOT/.veiron-local" && ! -e "$default_local_root" ]]; then
  default_local_root="$WORKSPACE_ROOT/.veiron-local"
fi
LOCAL_ROOT="${VIREON_LOCAL_ROOT:-$default_local_root}"
CHAIN_DIR="$LOCAL_ROOT/chain"
MEMPOOL_DIR="$LOCAL_ROOT/mempool"
INDEX_DIR="$LOCAL_ROOT/indexer"
WALLET_DIR="${HOME}/.vireon-mainnet/wallets"
if [[ -d "${HOME}/.veiron-mainnet/wallets" && ! -e "$WALLET_DIR" ]]; then
  WALLET_DIR="${HOME}/.veiron-mainnet/wallets"
fi
SIGNED_TX_DIR="$WALLET_DIR/signed-txs"
LOG_DIR="$LOCAL_ROOT/logs"
BACKUP_DIR="$LOCAL_ROOT/backups"
BUILD_DIR="$LOCAL_ROOT/build/target"
LOCAL_NODE_CONFIG="$WORKSPACE_ROOT/configs/local.toml"
LOCAL_RPC_CONFIG="$WORKSPACE_ROOT/configs/rpc.local.toml"
EXPLORER_DIR="$WORKSPACE_ROOT/vireon-explorer"
RPC_URL="http://127.0.0.1:10787"
EXPLORER_URL="http://127.0.0.1:4173"
CARGO_BIN="${CARGO:-cargo}"
PACKAGED="false"
if [[ -x "$WORKSPACE_ROOT/bin/vireon-node" ]]; then
  PACKAGED="true"
fi

ensure_local_directories() {
  mkdir -p "$CHAIN_DIR" "$MEMPOOL_DIR" "$INDEX_DIR" "$WALLET_DIR" "$SIGNED_TX_DIR" "$LOG_DIR" "$BACKUP_DIR" "$BUILD_DIR"
}

pid_file_for() {
  printf '%s/%s.pid\n' "$LOG_DIR" "$1"
}

log_file_for() {
  printf '%s/%s.log\n' "$LOG_DIR" "$1"
}

err_log_file_for() {
  printf '%s/%s.err.log\n' "$LOG_DIR" "$1"
}

stored_pid() {
  local pid_file
  pid_file="$(pid_file_for "$1")"
  [[ -f "$pid_file" ]] || return 1
  tr -d '[:space:]' <"$pid_file"
}

is_managed_process_running() {
  local name="$1"
  local pid
  if ! pid="$(stored_pid "$name" 2>/dev/null)"; then
    return 1
  fi
  if kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  rm -f "$(pid_file_for "$name")"
  return 1
}

run_in_workspace() {
  (cd "$WORKSPACE_ROOT" && CARGO_TARGET_DIR="$BUILD_DIR" "$@")
}

run_node() {
  if [[ "$PACKAGED" == "true" ]]; then
    (cd "$WORKSPACE_ROOT" && "$WORKSPACE_ROOT/bin/vireon-node" --config "$LOCAL_NODE_CONFIG" --data-dir "$CHAIN_DIR" --mempool-dir "$MEMPOOL_DIR" "$@")
  else
    run_in_workspace "$CARGO_BIN" run -p vireon-node -- --config "$LOCAL_NODE_CONFIG" --data-dir "$CHAIN_DIR" --mempool-dir "$MEMPOOL_DIR" "$@"
  fi
}

run_wallet() {
  run_in_workspace "$CARGO_BIN" run -p vireon-wallet -- --network mainnet-candidate --wallet-dir "$WALLET_DIR" --signed-tx-dir "$SIGNED_TX_DIR" --rpc-base-url "$RPC_URL" --chain-data-dir "$CHAIN_DIR" "$@"
}

run_indexer() {
  if [[ "$PACKAGED" == "true" ]]; then
    (cd "$WORKSPACE_ROOT" && "$WORKSPACE_ROOT/bin/vireon-indexer" --network mainnet-candidate --chain-data-dir "$CHAIN_DIR" --index-dir "$INDEX_DIR" "$@")
  else
    run_in_workspace "$CARGO_BIN" run -p vireon-indexer -- --network mainnet-candidate --chain-data-dir "$CHAIN_DIR" --index-dir "$INDEX_DIR" "$@"
  fi
}

node_start_command() {
  if [[ "$PACKAGED" == "true" ]]; then
    printf 'cd %q && %q --config %q --data-dir %q --mempool-dir %q start-node' "$WORKSPACE_ROOT" "$WORKSPACE_ROOT/bin/vireon-node" "$LOCAL_NODE_CONFIG" "$CHAIN_DIR" "$MEMPOOL_DIR"
  else
    printf 'cd %q && env CARGO_TARGET_DIR=%q %q run -p vireon-node -- --config %q --data-dir %q --mempool-dir %q start-node' "$WORKSPACE_ROOT" "$BUILD_DIR" "$CARGO_BIN" "$LOCAL_NODE_CONFIG" "$CHAIN_DIR" "$MEMPOOL_DIR"
  fi
}

rpc_start_command() {
  if [[ "$PACKAGED" == "true" ]]; then
    printf 'cd %q && env VIREON_LOCAL_ROOT=%q %q --config %q' "$WORKSPACE_ROOT" "$LOCAL_ROOT" "$WORKSPACE_ROOT/bin/vireon-rpc-gateway" "$LOCAL_RPC_CONFIG"
  else
    printf 'cd %q && env VIREON_LOCAL_ROOT=%q CARGO_TARGET_DIR=%q %q run -p vireon-rpc-gateway -- --config %q' "$WORKSPACE_ROOT" "$LOCAL_ROOT" "$BUILD_DIR" "$CARGO_BIN" "$LOCAL_RPC_CONFIG"
  fi
}

run_release_gate() {
  (cd "$WORKSPACE_ROOT" && bash scripts/release/release-gate.sh)
}

wait_for_http_ready() {
  local url="$1"
  local attempts="${2:-60}"
  local sleep_seconds="${3:-1}"
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep "$sleep_seconds"
  done
  echo "Timed out waiting for $url" >&2
  return 1
}

refresh_index_snapshot() {
  ensure_local_directories
  if run_indexer index-chain >"$(log_file_for indexer-refresh)" 2>"$(err_log_file_for indexer-refresh)"; then
    return 0
  fi
  echo "Indexer refresh failed. See $(err_log_file_for indexer-refresh)" >&2
  return 1
}

start_background_process() {
  local name="$1"
  local workdir="$2"
  local command="$3"
  local pid_file
  pid_file="$(pid_file_for "$name")"
  ensure_local_directories
  if is_managed_process_running "$name"; then
    echo "$name is already running with pid $(stored_pid "$name")"
    return 0
  fi
  (
    cd "$workdir"
    nohup bash -lc "$command" >"$(log_file_for "$name")" 2>"$(err_log_file_for "$name")" &
    echo $! >"$pid_file"
  )
  echo "Started $name pid $(cat "$pid_file") log $(log_file_for "$name")"
}

stop_managed_process() {
  local name="$1"
  local pid
  if ! pid="$(stored_pid "$name" 2>/dev/null)"; then
    return 0
  fi
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    sleep 1
    if kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
  rm -f "$(pid_file_for "$name")"
}

stop_node_process() {
  if ! is_managed_process_running node; then
    return 0
  fi
  run_node shutdown >/dev/null 2>&1 || true
  local pid
  pid="$(stored_pid node 2>/dev/null || true)"
  if [[ -n "$pid" ]]; then
    for _ in $(seq 1 15); do
      if ! kill -0 "$pid" 2>/dev/null; then
        rm -f "$(pid_file_for node)"
        return 0
      fi
      sleep 1
    done
  fi
  stop_managed_process node
}

backup_local_data() {
  ensure_local_directories
  local include_wallets="${1:-false}"
  local timestamp
  timestamp="$(date +%Y%m%d-%H%M%S)"
  local destination="$BACKUP_DIR/local-backup-$timestamp"
  mkdir -p "$destination"

  [[ -d "$CHAIN_DIR" ]] && cp -R "$CHAIN_DIR" "$destination/chain"
  [[ -d "$MEMPOOL_DIR" ]] && cp -R "$MEMPOOL_DIR" "$destination/mempool"
  [[ -d "$INDEX_DIR" ]] && cp -R "$INDEX_DIR" "$destination/indexer"
  [[ -d "$LOG_DIR" ]] && cp -R "$LOG_DIR" "$destination/logs"
  [[ -f "$LOCAL_ROOT/genesis-info.json" ]] && cp "$LOCAL_ROOT/genesis-info.json" "$destination/genesis-info.json"
  if [[ "$include_wallets" == "true" ]]; then
    echo "Wallet backup is intentionally excluded. Back up $WALLET_DIR separately to encrypted offline storage." >&2
  fi

  printf '%s\n' "$destination"
}

latest_backup_path() {
  [[ -d "$BACKUP_DIR" ]] || return 1
  ls -1dt "$BACKUP_DIR"/* 2>/dev/null | head -n 1
}

clear_local_chain_state() {
  ensure_local_directories
  rm -rf "$CHAIN_DIR" "$MEMPOOL_DIR" "$INDEX_DIR"
  mkdir -p "$CHAIN_DIR" "$MEMPOOL_DIR" "$INDEX_DIR"
  rm -f "$LOCAL_ROOT/genesis-info.json"
  rm -f "$(pid_file_for node)" "$(pid_file_for rpc)" "$(pid_file_for explorer)"
}

show_local_summary() {
  cat <<EOF
Local root: $LOCAL_ROOT
Chain dir: $CHAIN_DIR
Mempool dir: $MEMPOOL_DIR
Indexer dir: $INDEX_DIR
Wallet dir: $WALLET_DIR
Logs dir: $LOG_DIR
RPC URL: $RPC_URL
Explorer URL: $EXPLORER_URL
EOF
}
