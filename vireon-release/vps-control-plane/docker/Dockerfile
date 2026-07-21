# syntax=docker/dockerfile:1.7
FROM rust:1.88-bookworm AS builder
ENV CARGO_BUILD_JOBS=2
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates clang cmake libssl-dev pkg-config python3 && rm -rf /var/lib/apt/lists/*
COPY . .
RUN cargo build --locked --release -p vireon-node -p vireon-rpc-gateway -p vireon-indexer -p vireon-vps-admin -p vireon-mining-pool
FROM debian:bookworm-slim AS runtime
ARG VIREON_UID=10001
ARG VIREON_GID=10001
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl gettext-base libssl3 procps tini && rm -rf /var/lib/apt/lists/* && groupadd --gid "${VIREON_GID}" vireon && useradd --uid "${VIREON_UID}" --gid "${VIREON_GID}" --home-dir /home/vireon --create-home --shell /usr/sbin/nologin vireon
WORKDIR /app
COPY --from=builder /src/target/release/vireon-node /usr/local/bin/vireon-node
COPY --from=builder /src/target/release/vireon-rpc-gateway /usr/local/bin/vireon-rpc-gateway
COPY --from=builder /src/target/release/vireon-indexer /usr/local/bin/vireon-indexer
COPY --from=builder /src/target/release/vireon-vps-admin /usr/local/bin/vireon-vps-admin
COPY --from=builder /src/target/release/vireon-mining-pool /usr/local/bin/vireon-mining-pool
COPY vireon-release/vps-control-plane/docker/entrypoint.sh /usr/local/bin/vireon-entrypoint
COPY vireon-release/vps-control-plane/docker/templates /app/templates
COPY configs /app/configs
COPY docs/release /app/docs/release
RUN chmod 0755 /usr/local/bin/vireon-* && mkdir -p /config /data/.vireon-mainnet/chain /data/.vireon-mainnet/mempool /data/.vireon-mainnet/indexer /data/.vireon-mainnet/node /data/control /data/pool && chown -R vireon:vireon /config /data /app
USER vireon
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/vireon-entrypoint"]
