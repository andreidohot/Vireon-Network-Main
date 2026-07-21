# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

WORKDIR /app

ARG DATABASE_PROVIDER=postgresql
ARG DATABASE_URL=postgresql://vireon:vbos_change_me@postgres:5432/vbos?schema=public
ARG DATABASE_URL_LEDGER=postgresql://vireon:vbos_ledger_change_me@postgres-ledger:5432/vbos_ledger?schema=public

RUN if command -v apt-get >/dev/null 2>&1; then \
      apt-get update -y && apt-get install -y --no-install-recommends openssl ca-certificates fontconfig fonts-dejavu-core fonts-liberation && fc-cache -f && rm -rf /var/lib/apt/lists/*; \
    elif command -v apk >/dev/null 2>&1; then \
      apk add --no-cache openssl ca-certificates fontconfig ttf-dejavu font-liberation && fc-cache -f; \
    else \
      echo "[VBOS] Warning: no supported package manager found for OpenSSL install."; \
    fi

ENV NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    npm_config_registry=https://registry.npmjs.org/ \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_PROGRESS=false \
    NPM_CONFIG_FETCH_RETRIES=3 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=60000 \
    NPM_CONFIG_FETCH_TIMEOUT=300000 \
    NPM_CONFIG_LOGLEVEL=http \
    VBOS_NPM_HEARTBEAT_MS=15000 \
    VBOS_NPM_CI_TIMEOUT_MS=1200000

COPY package*.json .npmrc ./
COPY scripts/preflight-install.js scripts/npm-ci-heartbeat.js scripts/verify-public-npm-lock.js ./scripts/

RUN echo "[VBOS] Running npm/preflight check..." \
  && node scripts/preflight-install.js \
  && node scripts/verify-public-npm-lock.js \
  && npm config set registry https://registry.npmjs.org/ \
  && npm config get registry \
  && echo "[VBOS] Installing dependencies with npm ci using visible heartbeat logs..." \
  && node scripts/npm-ci-heartbeat.js

COPY . .
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER}
ENV DATABASE_URL=${DATABASE_URL}
ENV DATABASE_URL_LEDGER=${DATABASE_URL_LEDGER}

RUN echo "[VBOS] Building Admin Web PWA..." && npm run dashboard:build
RUN echo "[VBOS] Generating Prisma client..." && npm run prisma:generate
RUN echo "[VBOS] Generating Prisma ledger client..." && npm run prisma:generate:ledger
RUN echo "[VBOS] Pruning dev dependencies for production..." && npm prune --omit=dev --no-audit --no-fund

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm", "start"]
