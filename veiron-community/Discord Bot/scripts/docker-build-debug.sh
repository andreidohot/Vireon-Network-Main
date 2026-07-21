#!/usr/bin/env bash
set -euo pipefail

echo "[VBOS] Docker build debug mode"
echo "[VBOS] This prints full Docker build output, useful when npm ci looks frozen."

docker compose build --no-cache --progress=plain vbos
