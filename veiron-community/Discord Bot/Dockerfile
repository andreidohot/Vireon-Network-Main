# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:24-bookworm-slim
FROM ${NODE_IMAGE}

WORKDIR /app

ARG DATABASE_PROVIDER=postgresql
ARG DATABASE_URL=postgresql://vireon:vbos_change_me@postgres:5432/vbos?schema=public
ARG DATABASE_URL_LEDGER=postgresql://vireon:vbos_ledger_change_me@postgres-ledger:5432/vbos_ledger?schema=public

ENV NPM_CONFIG_AUDIT=false \
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
COPY scripts/preflight-install.js scripts/npm-ci-heartbeat.js ./scripts/

RUN echo "[VBOS] Running npm/preflight check..." \
  && node scripts/preflight-install.js \
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
