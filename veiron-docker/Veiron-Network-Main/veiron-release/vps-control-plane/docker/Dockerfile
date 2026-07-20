# syntax=docker/dockerfile:1.7
FROM rust:1.88-bookworm AS builder
ENV CARGO_BUILD_JOBS=2
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates clang cmake libssl-dev pkg-config python3 && rm -rf /var/lib/apt/lists/*
COPY . .
RUN python3 veiron-release/vps-control-plane/docker/patches/apply_admin_docker_patch.py
RUN cargo build --locked --release -p veiron-node -p veiron-rpc-gateway -p veiron-indexer -p veiron-vps-admin -p veiron-mining-pool
FROM debian:bookworm-slim AS runtime
ARG VEIRON_UID=10001
ARG VEIRON_GID=10001
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gettext-base libssl3 procps tini && rm -rf /var/lib/apt/lists/* && groupadd --gid "${VEIRON_GID}" veiron && useradd --uid "${VEIRON_UID}" --gid "${VEIRON_GID}" --home-dir /home/veiron --create-home --shell /usr/sbin/nologin veiron
WORKDIR /app
COPY --from=builder /src/target/release/veiron-node /usr/local/bin/veiron-node
COPY --from=builder /src/target/release/veiron-rpc-gateway /usr/local/bin/veiron-rpc-gateway
COPY --from=builder /src/target/release/veiron-indexer /usr/local/bin/veiron-indexer
COPY --from=builder /src/target/release/veiron-vps-admin /usr/local/bin/veiron-vps-admin
COPY --from=builder /src/target/release/veiron-mining-pool /usr/local/bin/veiron-mining-pool
COPY veiron-release/vps-control-plane/docker/entrypoint.sh /usr/local/bin/veiron-entrypoint
COPY veiron-release/vps-control-plane/docker/templates /app/templates
COPY configs /app/configs
COPY docs/release /app/docs/release
RUN chmod 0755 /usr/local/bin/veiron-* && mkdir -p /config /data/.veiron-mainnet/chain /data/.veiron-mainnet/mempool /data/.veiron-mainnet/indexer /data/.veiron-mainnet/node /data/control /data/pool && chown -R veiron:veiron /config /data /app
USER veiron
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/veiron-entrypoint"]
