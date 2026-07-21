FROM node:20-alpine

WORKDIR /app

ARG DATABASE_PROVIDER=postgresql
ARG DATABASE_URL=postgresql://vireon:vbos_change_me@postgres:5432/vbos?schema=public
ARG DATABASE_URL_LEDGER=postgresql://vireon:vbos_ledger_change_me@postgres-ledger:5432/vbos_ledger?schema=public

COPY package*.json ./
RUN npm ci

COPY . .
ENV DATABASE_PROVIDER=${DATABASE_PROVIDER}
ENV DATABASE_URL=${DATABASE_URL}
ENV DATABASE_URL_LEDGER=${DATABASE_URL_LEDGER}
RUN npm run dashboard:build
RUN npm run prisma:generate
RUN npm run prisma:generate:ledger
RUN npm prune --omit=dev

ENV NODE_ENV=production
EXPOSE 8787

CMD ["npm", "start"]
