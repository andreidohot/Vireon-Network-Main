#!/usr/bin/env bash
set -euo pipefail
count="${1:-1}"
if [ "$count" -le 1 ]; then
  cargo run -p vireon-node -- mine-dev-block
else
  cargo run -p vireon-node -- mine-dev-blocks "$count"
fi
