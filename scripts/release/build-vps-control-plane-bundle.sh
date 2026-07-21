#!/usr/bin/env bash
set -Eeuo pipefail

workspace="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
output_dir="$workspace/release-artifacts"
output="$output_dir/vireon-docker-control-plane.tar.gz"

cd "$workspace"
git diff --quiet && git diff --cached --quiet || {
  echo "Refusing to build a release archive from a dirty working tree." >&2
  exit 73
}

# The Dockerfile builds the selected VPS binaries from the workspace. Include
# every Cargo member so workspace discovery remains valid, but no frontend,
# runtime state, local environment, build output or secret file.
paths=(
  .dockerignore .gitattributes Cargo.toml Cargo.lock VERSION clippy.toml
  configs docs/release shared
  vireon-core vireon-node vireon-rpc-gateway vireon-wallet vireon-sdk-rust
  vireon-browser/host vireon-indexer vireon-miner vireon-mining-pool
  vireon-desktop vireon-mobile-core
  vireon-release/vps-control-plane
)

mkdir -p "$output_dir"
git archive --format=tar HEAD -- "${paths[@]}" | gzip -9 > "$output"
(cd "$output_dir" && sha256sum "$(basename "$output")" > "$(basename "$output").sha256")

tar -tzf "$output" | grep -Fxq 'vireon-release/vps-control-plane/compose.yaml'
tar -tzf "$output" | grep -Fxq 'vireon-release/vps-control-plane/scripts/install-docker-stack.sh'
tar -tzf "$output" | grep -Fxq 'vireon-release/vps-control-plane/docker/Dockerfile'

if tar -tzf "$output" | grep -Eq '(^|/)(\.env|state/[^.].*|target/|node_modules/|\.artifacts/)'; then
  echo "Forbidden runtime or generated file entered the Docker release archive." >&2
  exit 1
fi

echo "$output"
