> VBOS 7.36.7 targets **Node.js 24.x**. Docker uses `node:24-bookworm-slim`. Local non-Docker deployments should use Node 24.x before running `npm ci`. Docker Compose uses `NODE_IMAGE=${NODE_IMAGE:-node:24-bookworm-slim}` by default.

# VBOS Deployment

## Local Run

```bash
cp .env.example .env
npm install
npm run dashboard:build
npm run prisma:generate
npm run prisma:generate:ledger
npm run migrate:json-to-prisma:dry-run
npm run migrate:json-to-prisma
npm run check
npm run register
npm start
```

## Docker Run

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f
```

## Vireon VPS Docker Deployment

The production VPS overlay joins the bot to the control-plane network and
reuses explicitly named PostgreSQL volumes. Keep `.env` untracked and set the
chain client to the internal RPC service:

```dotenv
VIREON_CHAIN_MODE=rpc
VIREON_CHAIN_RPC_URL=http://vireon-rpc:10787
VIREON_CHAIN_HEALTH_URL=http://vireon-rpc:10787/health
VIREON_CHAIN_STATUS_URL=http://vireon-rpc:10787/status
```

Deploy from the organized `/home/vireon/discord-bot` path:

```bash
docker compose -p vireon-discord-bot --env-file .env \
  -f docker-compose.yml -f docker-compose.vps.yml up -d --build
```

The overlay expects `vireon-internal`, `discord-bot_postgres-data` and
`discord-bot_postgres-ledger-data` to exist. It does not create replacement
database volumes during a migration.

Dashboard:

```text
http://SERVER_IP:8787/admin/
```

The dashboard is a React + Vite SPA. Docker builds it automatically. For non-Docker deployments, run `npm run dashboard:build` before `npm start`; the admin panel serves `src/dashboard/dist`.

The dashboard is also an installable PWA. Android install and web push require HTTPS or localhost. Offline mode shows the last cached read-only dashboard data after a successful online login.

Use the seeded admin email/password to login. For first deployment, set `ADMIN_DEFAULT_EMAIL`, `ADMIN_DEFAULT_PASSWORD`, a strong `ADMIN_JWT_SECRET` and a strong `ADMIN_TOTP_ENCRYPTION_KEY`. Admin authentication uses the main Prisma database, so run `npm run prisma:push` before enabling the panel.

Admin 2FA and lockout settings:

```bash
ADMIN_TOTP_ENCRYPTION_KEY=replace_with_at_least_32_random_characters
ADMIN_LOCKOUT_MAX_ATTEMPTS=5
ADMIN_LOCKOUT_MINUTES=15
```

Enable TOTP from the dashboard settings section after the first successful login. Once enabled, login requires a valid authenticator code.

Protected admin endpoints have explicit minimum roles. Operational read routes for moderation, tickets, automod and anti-spam require `MODERATOR`; settings writes and embed sends require `ADMIN`; dashboard, guild, proposals, announcements and self-service 2FA routes require `VIEWER`.

Optional web push settings:

```bash
npm run push:vapid
WEB_PUSH_VAPID_PUBLIC_KEY=generated_public_key
WEB_PUSH_VAPID_PRIVATE_KEY=generated_private_key
WEB_PUSH_SUBJECT=mailto:admin@vireon.local
```

Without VAPID keys, the PWA still installs and works offline, but push subscriptions stay disabled.

## Required Discord Settings

In the Discord Developer Portal:

- enable Server Members Intent;
- enable Message Content Intent for automod;
- invite the bot with Manage Roles, Manage Channels, Manage Server, Manage Messages, Moderate Members, Kick Members, Ban Members, View Channels, Send Messages, Read Message History and Use Slash Commands.
- for music, also include Connect and Speak permissions.
- keep the bot role above every Discord role configured as an XP level reward.

## Music Service

The music module is disabled by default. To enable it:

```bash
MUSIC_ENABLED=true
LAVALINK_HOST=lavalink
LAVALINK_PORT=2333
LAVALINK_PASSWORD=replace_with_long_random_password
MUSIC_DEFAULT_VOLUME=70
```

Docker Compose starts a separate Lavalink service. For non-Docker deployments, run Lavalink separately and point the bot to its host, port and password.

Docker Compose mounts `lavalink/application.yml` into the Lavalink container. Keep `LAVALINK_PASSWORD` and `LAVALINK_SERVER_PASSWORD` aligned when changing the service password.

For larger deployments, use `LAVALINK_NODES` instead of the single-node variables:

```json
[
  { "name": "primary", "url": "http://lavalink-a:2333", "auth": "password-a" },
  { "name": "backup", "url": "http://lavalink-b:2333", "auth": "password-b" }
]
```

The `/health` endpoint includes configured Lavalink nodes, ready nodes, player stats and queue count.

## Production Notes

- Use `STORAGE_DRIVER=prisma` with `DATABASE_PROVIDER` and `DATABASE_URL` for database-backed community storage.
- Use a separate `DATABASE_URL_LEDGER` for financial ledger data.
- Run `npm run prisma:push` and `npm run prisma:push:ledger` after configuring new Prisma databases. The main push creates the dedicated `XpProfile` table used by XP/Leveling.
- Before switching production to `STORAGE_DRIVER=prisma`, run `npm run migrate:json-to-prisma:dry-run`, then `npm run migrate:json-to-prisma`.
- Set `LOG_LEVEL=info` in production and use `/health` for bot, DB, Lavalink and chain-client readiness checks.
- Run `npm run check` before deployment; it includes syntax checks, dashboard build and unit tests.
- Rotate `ADMIN_DEFAULT_PASSWORD` after first login by replacing the seeded user password through the next admin-user management task.
- Set and back up `ADMIN_TOTP_ENCRYPTION_KEY`; changing it invalidates stored TOTP secrets.
- Set and back up `WEB_PUSH_VAPID_PRIVATE_KEY` before enabling web push.
- Keep `ADMIN_PANEL_HOST=127.0.0.1` unless using a reverse proxy or private tunnel.
- Use HTTPS before exposing the dashboard publicly.
- Keep `./data` backed up.
- Never commit `.env`.

## Docker build stuck at npm ci

VBOS 7.36.7 does not run a silent `npm ci` inside Docker. The Dockerfile runs `scripts/npm-ci-heartbeat.js`, which prints an install heartbeat every 15 seconds and stops with a useful error after the configured timeout.

Recommended rebuild:

```bash
docker compose down
docker builder prune -f
docker compose build --no-cache --progress=plain vbos
docker compose up -d
```

For very slow VPS/network environments you can increase the timeout:

```bash
VBOS_NPM_CI_TIMEOUT_MS=2400000 docker compose build --no-cache --progress=plain vbos
```

The default image is `node:24-bookworm-slim`. It is intentionally not Alpine, because Debian/glibc is more predictable for native dependencies such as Prisma engines and canvas packages.

## Docker build timeout on applied-caas / internal registry URLs

If the build log shows package downloads from a URL like `packages.applied-caas...` or any internal Artifactory registry, the lockfile is wrong for a public VPS. VBOS 7.36.7 retains the public-registry lockfile guard through `npm run lock:verify`.

Before rebuilding, clear the old Docker build cache so the previous lockfile layer is not reused:

```bash
docker compose down
docker builder prune -f
docker compose build --no-cache --progress=plain vbos
docker compose up -d
```

Expected pre-install output:

```text
[VBOS lock] OK. package-lock.json uses the public npm registry only.
https://registry.npmjs.org/
```

If `npm ci` still times out after that, the problem is no longer the lockfile; check VPS DNS/firewall, npm registry reachability, or available RAM.
