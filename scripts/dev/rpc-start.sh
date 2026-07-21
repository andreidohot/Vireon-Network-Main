#!/usr/bin/env bash
set -euo pipefail
cargo run -p vireon-rpc-gateway -- --config vireon-rpc-gateway/config/devnet-rpc.toml
