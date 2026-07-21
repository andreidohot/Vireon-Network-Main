# VBOS

VBOS (Vireon Bot Operations Studio) is the all-in-one Discord operations bot and admin web panel for Vireon Network.

Current version: **7.36.4**.

Runtime target: **Node.js 24.x**. Docker uses `node:24-bookworm-slim`; local non-Docker installs should use Node 24 as well.
Docker Compose also exposes `NODE_IMAGE`, defaulting to `node:24-bookworm-slim`, so advanced builds can pin a full patch image without editing the Dockerfile.

The goal is one strong operations system, not many disconnected bots. This release includes server setup, onboarding roles, permission control with visual admin UI, VBOS-styled embeds, moderation, tickets, live-config automod, anti-raid alerts, anti-spam, persistent audit logging, automated database backups, announcements, scheduled announcements, proposals/voting, welcome/goodbye events, XP/level tracking, server-only Shards social currency, custom tags, custom triggers, Lavalink music commands, saved playlists, audio filters, interactive now-playing controls, live Vireon chain status and reward queries via the configured adapter, Docker deployment and an installable React SPA admin dashboard.

## Current Modules

- Server setup: roles, categories, channels, permissions and starter messages.
- Role onboarding: buttons in `#roles` for `Vireon Member`, `Developer`, `Miner`, `Node Operator`, `Builder` and `Early Supporter`.
- Permission controller: one place for setup/admin/embed permissions, configurable from the admin dashboard with role and user rules.
- Embed factory: one VBOS-styled embed system used by commands and API.
- Admin dashboard: installable React + Vite PWA at `/admin/` with first-run Setup Wizard and routed panels for overview, Command Center, full Discord control, Custom Lab, Automation Studio, Module Center, VBOS Operations, embeds, tickets, moderation, proposals, automod, anti-spam, audit log search, economy/leveling, permissions, music, wallet/payments, live blockchain status and settings.
- Admin panel API: protected HTTP API with JWT login, refresh tokens, per-route RBAC, TOTP 2FA and account lockout.
- Bot Control Center: admin/moderator web console for member lookup, warn/timeout/kick/ban/unban, purge, ticket close/reopen/archive, member role assignment, bulk role changes, channel permission overwrites, channel reorder, role/channel/category/guild control, structure-plan apply/dry-run, message/embed sending, bot permission health and audited mutations.
- VBOS Operations: safe interactive console, Message Creator, embed preview, saved message templates, approval queue, admin-only direct push, multi-channel push, scheduled posts, custom button attachments and push history from `/admin/#operations`.
- Custom Lab: `/admin/#custom` lets ADMIN+ users create, update and delete DB-backed prefix commands, `/custom` gateway responses and custom Discord button interactions without editing code. MODERATOR+ users can inspect commands, buttons and recent custom events.
- Automation Studio: `/admin/#automations` lets staff build no-code Discord flows with safe triggers/actions, dry-run preview, admin testing, cooldowns, audit log and runtime execution on messages and member join/leave.
- Command Center: `/admin/#commands` shows the full VBOS command surface, categories, runtime stats, modules, custom commands, automations and audit tail for staff.
- Module Center: `/admin/#modules` acts as a Feature Marketplace for VBOS modules, with categories, risk levels, dependency warnings, audited enable/disable controls, JSON bundle export/import and dry-run validation.
- PWA support: Android-installable manifest, iconset, native VBOS service worker and cached read-only dashboard fallback.
- Web push foundation: VAPID-based subscription endpoints, test alerts, new-ticket alerts and critical automod alerts for subscribed admins.
- Moderation: warn, mute, unmute, purge and case history.
- Escalation moderation: kick and ban commands.
- Tickets: private support tickets with staff-only close flow.
- Automod: live-editable anti-scam keywords, custom regex rules, Discord invite blocking, mass-mention blocking and event logs.
- Anti-raid: configurable join-rate detection with persisted automod events, audit log entries and critical staff push alerts.
- Anti-spam: message-rate tracking with automatic timeout and audit log.
- Announcements: draft/list/publish/schedule flow with Vireon public status labels.
- Proposals: create/list/close proposals with Yes/No voting buttons.
- Community events: welcome/goodbye messages and optional auto role assignment.
- XP/Leveling: per-guild user XP profiles, message XP with cooldown anti-abuse, voice-time XP tracking, configurable level curves, automatic role rewards, `/rank` cards and `/leaderboard`.
- Social economy: server-only `Shards` points for daily/work rewards, transfers, leaderboards and cosmetic role shop items, clearly separated from VIRE with no blockchain or financial value.
- Custom tags: `/tag create`, `list`, `use` and `delete` backed by the shared DAL, with `{user}`, `{server}` and `{mentions}` variables.
- Custom triggers: `/trigger create`, `list` and `delete` for regex-based auto-responders with cooldowns, powered by existing tags.
- Music: Lavalink-backed player with Shoukaku, Docker Compose service, repo-managed Lavalink config, standalone `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/nowplaying`, `/volume`, `/loop`, `/shuffle`, `/filter`, saved `/playlist` commands, interactive now-playing buttons and legacy `/music` subcommands.
- Audit logging: moderation, ticket, automod, anti-spam, announcement and proposal events are persisted through the shared DAL and can also be posted to `#mod-log`.
- Audit dashboard: MODERATOR+ users can search/filter persisted audit events by text, type, source, user IDs, channel and date range.
- Data access layer: selectable JSON or Prisma-backed store with the same module-facing interface.
- Setup Wizard: first-run browser setup stores runtime configuration in `data/runtime-config.json`, removes the local setup token and hides the wizard after finalize.
- Serious database profile: Docker Compose defaults to PostgreSQL + Prisma for bot data instead of JSON.
- Local JSON storage: retained for dev/fallback storage only.
- Prisma storage: database-backed generic collections for production migration.
- Ledger database isolation: separate Prisma schema and `DATABASE_URL_LEDGER` for wallet, balance and VIRE transaction data.
- Automated backups: cron-like scheduler plus manual `npm run backup`, covering main DB, ledger DB and optional JSON data, with S3-compatible upload support.
- Structured logging: Pino logger for runtime/admin/music events.
- Extended health check: `/health` reports bot, DB, Lavalink and chain-client status.
- Vireon chain status: `/vireon-status` reads block height, latest block hash, hash rate, active nodes and circulating supply from the configured chain adapter, with explicit mock/disabled fallback states and RPC cache/rate-limit protection.
- Vireon wallet registration: `/register` creates custodial encrypted wallets or links external wallets through challenge-response, then returns a tokenized payment link.
- Vireon rewards: `/rewards` reads mining, staking and node rewards for the user's linked wallet address. It uses the Phase 6 Discord <-> wallet link record created by `/register`.
- Vireon payments: `/payment user:<member> amount:<amount>` validates registered wallets and available custodial balance, estimates fee, asks for Confirm/Cancel, broadcasts through the configured chain adapter, syncs the local ledger and notifies both users.
- On-chain sync: optional worker polls transaction status, confirms local ledger rows, detects reorg/conflicts and reverses local payment effects once when a transaction is reorged or double-spent.
- Wallet dashboard: `/admin/#wallet` shows registered custodial/external wallets and their payment links without exposing master seed or derived private-key material.
- Blockchain dashboard: `/admin/#blockchain` shows RPC status, uptime, latency, network metrics, RPC cache state, block-height/latency charts and a visible alert when the configured node/RPC is down or stale cached data is being served.
- Unit tests: Vitest coverage for config, storage/DAL and permission controller basics.
- Docker deployment: Dockerfile, Compose file and deployment notes.
- Status language guard: quick reminder for public wording that avoids false launch/investment claims.

## Planned Modules

- Admin Web: rollback snapshots, template diff/apply controls and richer analytics for control actions.
- Changelog publishing.
- Community analytics.
- Website/admin integration.
- Vireon testnet integrations when real APIs exist.

Dashboard shell placeholders are already present for future backend modules:

- Music: queue/player dashboard controls for the Lavalink module.
- Wallet/Payments: wallet linking, payment limits and VIRE transaction review.

The Blockchain Status panel is active and backed by `/api/blockchain/status`.


## VBOS Web Control Plane

The Admin Web panel is now the main control surface for staff. `MODERATOR+` users can operate moderation, tickets, command visibility, message previews, approval requests, push history, custom-control visibility and safe console commands. `ADMIN+` users can mutate the Discord server structure and bot behavior.

Main control areas:

- `/admin/#control` manages members, moderation actions, role assignment, bulk roles, channels, categories, permission overwrites, channel order, guild settings and bulk structure plans. Destructive actions keep explicit confirmations and Discord hierarchy checks.
- `/admin/#operations` manages Message Creator, embed preview, saved templates, approval queue, scheduled posts, direct admin push, channel push history and custom interaction buttons attached to messages.
- `/admin/#custom` manages DB-backed custom prefix commands, the `/custom` slash gateway and custom Discord button responses. These are audited and do not execute shell or arbitrary JavaScript.
- `/admin/#automations` manages no-code automation flows: message triggers, regex triggers, member join/leave triggers, channel messages, DMs, role changes, reactions and log events. Flow execution is allowlisted, cooldown-protected and audited.
- `/admin/#modules` manages the VBOS module registry: module status, risk, dependencies, optional feature toggles and import/export bundles for custom configurations.

All web mutations pass through RBAC and audit logging. The panel intentionally uses allowlisted actions instead of arbitrary remote code execution.

## First-Run Setup Wizard

The bot can now boot without Discord secrets. On first start, if `DISCORD_TOKEN`, `DISCORD_CLIENT_ID` or `DISCORD_GUILD_ID` are missing, it starts only the Admin Web setup mode. Open:

```bash
http://127.0.0.1:8787/admin/
```

The wizard asks for the local setup token. The token is generated on the server at:

```bash
data/setup-token.txt
```

After finalize, the wizard writes:

```bash
data/runtime-config.json
```

That file contains the runtime configuration for Discord, Admin Web, PostgreSQL/Prisma and generated secrets. The setup token is removed and the wizard is no longer shown. In Docker, the process exits after finalize so the container restarts and loads the normal Discord bot runtime.

Do not commit `data/runtime-config.json`; it contains secrets. Keep `data/` mounted as a private persistent volume.

## Serious Bot Database

The normal deploy profile now uses PostgreSQL with Prisma:

```bash
docker compose up -d --build
```

Compose starts:

- `postgres` for admin auth, settings, audit log, XP, economy, tickets, moderation cases and bot module data.
- `postgres-ledger` for wallet, balance and transaction records.
- `vbos` with Admin Web setup enabled on first boot.

JSON storage is still available for local experiments, but it is no longer the recommended deploy mode for a serious Discord/Admin Web bot.

## What Setup Creates

Roles:

- Founder
- Core Team
- Admin
- Moderator
- Security Reviewer
- Developer
- Miner
- Node Operator
- Builder
- Partner
- Early Supporter
- Vireon Member
- Muted
- Bot

Categories and channels:

- START HERE: welcome, rules, announcements, roadmap, faq, roles
- COMMUNITY: general, romana, english, ideas, showcase, off-topic
- VIREON DEVELOPMENT: dev-chat, protocol-design, rust-core, smart-contracts, wallet-explorer, docs-research, bugs
- MINING AND NODES: mining, node-operators, testnet-faucet, mining-pools
- ECOSYSTEM: dapps-games, nfts-assets, passport-identity, marketplace, encrypted-communication
- GOVERNANCE: proposals, governance-discussion, decision-log
- SUPPORT AND SAFETY: help, report-scam, security-disclosure
- ADMIN: admin-hq, mod-log, staff-tasks, security-room, incident-room
- VOICE: Community Lounge, Dev Room, Mining Room, Staff Voice

The setup is idempotent. Running `/setup-vireon confirm:true` again reuses existing roles and channels where possible instead of duplicating the server.

## Required Bot Permissions

When generating the invite URL in the Discord Developer Portal, include:

- Manage Roles
- Manage Channels
- Manage Server
- Manage Messages
- Moderate Members
- Kick Members
- Ban Members
- View Channels
- Send Messages
- Read Message History
- Use Slash Commands
- Connect
- Speak

For automod message scanning, enable the **Message Content Intent** in the Discord Developer Portal for the bot application.

Place the bot role above the roles it needs to create, edit or assign as XP level rewards. Discord will not allow the bot to manage roles above its own role.

## Setup

```bash
cd vbos
cp .env.example .env
npm install
npm run dashboard:build
npm run check
npm run register
npm start
```

Required `.env` values:

```bash
DISCORD_TOKEN=replace_with_bot_token
DISCORD_CLIENT_ID=replace_with_application_client_id
DISCORD_GUILD_ID=replace_with_server_guild_id
LOG_LEVEL=info
```

Optional setup lock:

```bash
SETUP_ALLOWED_USER_IDS=123456789012345678,987654321098765432
```

If `SETUP_ALLOWED_USER_IDS` is empty, any server Administrator can run `/setup-vireon`.

## Admin Panel API

Keep this disabled until the bot runs behind HTTPS, a private tunnel or a trusted reverse proxy.

```bash
ADMIN_PANEL_ENABLED=false
ADMIN_PANEL_HOST=127.0.0.1
ADMIN_PANEL_PORT=8787
ADMIN_JWT_SECRET=replace_with_at_least_32_random_characters
ADMIN_JWT_TTL=15m
ADMIN_REFRESH_TOKEN_DAYS=14
ADMIN_TOTP_ENCRYPTION_KEY=replace_with_at_least_32_random_characters
ADMIN_LOCKOUT_MAX_ATTEMPTS=5
ADMIN_LOCKOUT_MINUTES=15
ADMIN_DEFAULT_EMAIL=admin@vireon.local
ADMIN_DEFAULT_PASSWORD=replace_with_long_initial_password
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_SUBJECT=mailto:admin@vireon.local
BOT_DATA_DIR=./data
```

## Data Storage

The bot uses a shared DAL with the same interface for JSON and Prisma:

```text
list(collection)
add(collection, item)
update(collection, predicate, updater)
getSingleton(collection, defaults)
setSingleton(collection, value)
```

Default local mode:

```bash
STORAGE_DRIVER=json
BOT_DATA_DIR=./data
```

Prisma mode:

```bash
STORAGE_DRIVER=prisma
DATABASE_PROVIDER=sqlite
DATABASE_URL=file:./data/vbos.db
DATABASE_URL_LEDGER=file:./data/vireon-ledger.db
npm run prisma:generate
npm run prisma:generate:ledger
npm run prisma:push
npm run prisma:push:ledger
```

The Prisma adapter stores most module data in generic collection tables, so existing modules can move from JSON to Prisma without internal rewrites. XP profiles use a dedicated `XpProfile` table when `STORAGE_DRIVER=prisma`, while JSON mode stores them in the `xp-profiles` collection.

`DATABASE_PROVIDER` supports `sqlite`, `postgresql` and `mysql`. Prisma requires literal providers in schema files, so `npm run prisma:select` materializes the active main and ledger schemas before generation or push.

Wallet registration can use the ledger Prisma client when `STORAGE_DRIVER=prisma` and `npm run prisma:generate:ledger` has been run. In local/dev mode, set `LEDGER_STORAGE_DRIVER=json` to store ledger data separately under `LEDGER_DATA_DIR`.

## Database Backups

Manual backup:

```bash
npm run backup
npm run backup:dry-run
```

Automated backup scheduler:

```bash
BACKUP_ENABLED=true
BACKUP_CRON=0 3 * * *
BACKUP_DIR=./backups
BACKUP_RETENTION_DAYS=14
BACKUP_INCLUDE_JSON_DATA=true
```

`BACKUP_CRON` uses UTC 5-field cron syntax. SQLite backups copy `DATABASE_URL` and `DATABASE_URL_LEDGER` files, including WAL/SHM companions when present. PostgreSQL and MySQL backups use `pg_dump` and `mysqldump`, so those CLIs must exist in the runtime image/host.

S3-compatible upload:

```bash
BACKUP_S3_ENABLED=true
BACKUP_S3_ENDPOINT=https://s3.amazonaws.com
BACKUP_S3_REGION=auto
BACKUP_S3_BUCKET=vireon-backups
BACKUP_S3_PREFIX=vbos
BACKUP_S3_ACCESS_KEY_ID=replace_me
BACKUP_S3_SECRET_ACCESS_KEY=replace_me
BACKUP_S3_FORCE_PATH_STYLE=true
```

The S3 target can be AWS S3, Cloudflare R2, MinIO, Wasabi or any compatible service that accepts AWS Signature v4 PUT uploads.

## XP and Leveling

The XP engine awards XP from messages and voice activity:

- message XP uses a per-user cooldown to reduce spam farming;
- voice XP is awarded by full minutes after the minimum voice session length;
- level curves are configurable from the admin dashboard Economy/Leveling panel;
- level role rewards can be configured from the same panel and are assigned automatically when users level up;
- supported curves are `linear`, `quadratic` and `exponential`;
- `ADMIN` or `SUPER_ADMIN` users can save XP settings through the dashboard.

User-facing XP commands:

```text
/rank [user]        Generates a VBOS-styled PNG rank card.
/leaderboard [limit] Shows the top XP profiles for the current guild.
```

Rank cards are generated with `@napi-rs/canvas` using a Blood Red, Charcoal and Mineral Gold visual style. The renderer uses a serif fallback when Cormorant Garamond is not available to the runtime.

## Server Social Currency

The bot includes an internal community currency named `Shards` by default. Shards are Discord server-only social points for minigames, leaderboards and community rewards.

Important separation rules:

- Shards are not VIRE.
- Shards are not stored in the isolated financial ledger database.
- Shards are not on-chain and have no financial value.
- The settings normalizer rejects `VIRE` as the social currency symbol to avoid confusion.

Commands:

```text
/daily                      Claims the daily Shards reward.
/work                       Earns a random Shards work reward.
/balance [user]             Shows a member's internal Shards balance.
/leaderboard-economy [limit] Shows the top Shards balances.
/shop list                  Lists cosmetic role shop items.
/shop buy item_id:<id>      Buys a cosmetic role with Shards.
/shards balance [user]      Shows a member's Shards balance.
/shards leaderboard [limit] Shows the top Shards balances.
/shards transfer            Transfers Shards between members if enabled.
/shards grant               Staff-only grant command.
/shards take                Staff-only removal command.
```

Admins can configure the social currency name, symbol, starter balance, daily/work rewards, cooldowns, transfer limits, cosmetic role shop items and disclaimer visibility from the Economy/Leveling dashboard panel.

## Custom Tags

Custom tags are reusable community responses stored through the same JSON/Prisma DAL as the rest of the bot.

Commands:

```text
/tag create name:<name> content:<text>  Staff-only creation.
/tag list                              Lists active tags.
/tag use name:<name> [mentions]        Sends the rendered tag.
/tag delete name:<name>                Staff-only soft delete.
```

Supported variables:

- `{user}` renders the member who used the tag.
- `{server}` renders the current Discord server name.
- `{mentions}` injects the optional `mentions` argument from `/tag use`.

## Custom Triggers

Triggers are automatic responders that watch normal Discord messages, match a simple case-insensitive regex and send an existing tag as the response.

Commands:

```text
/trigger create name:<name> pattern:<regex> tag:<tag> [cooldown_seconds]
/trigger list
/trigger delete name:<name>
```

Notes:

- Trigger creation and deletion require staff/admin bot management permission.
- Cooldown is global per trigger and persists in storage.
- Only the first matching trigger responds to a message, reducing spam.
- Trigger responses reuse tag variables. In auto-responses, `{mentions}` renders users/roles mentioned in the triggering message.

### JSON to Prisma Migration

After generating and pushing the Prisma schema, migrate existing JSON data with:

```bash
npm run migrate:json-to-prisma:dry-run
npm run migrate:json-to-prisma
```

The migration reads `data/*.json`, preserves existing item IDs and upserts:

```text
moderation-cases, tickets, proposals, announcements, automod-events, spam-events
```

Legacy `cases.json` is accepted and migrated into the current `moderation-cases` collection.

Open the dashboard:

```text
http://127.0.0.1:8787/admin/
```

The admin panel serves the built SPA from `src/dashboard/dist`. Run this after dashboard source changes and before enabling the admin panel:

```bash
npm run dashboard:build
```

For frontend-only development, use:

```bash
npm run dashboard:dev
```

The dashboard is installable on Android when served over HTTPS or localhost. It includes a native VBOS service worker, manifest, iconset and read-only cached dashboard data for offline viewing. Workbox/vite-plugin-pwa is no longer required for current builds, which keeps Docker `npm ci` cleaner and avoids deprecated transitive dependency warnings from the old PWA build chain.

Optional web push notifications require VAPID keys:

```bash
npm run push:vapid
WEB_PUSH_VAPID_PUBLIC_KEY=generated_public_key
WEB_PUSH_VAPID_PRIVATE_KEY=generated_private_key
WEB_PUSH_SUBJECT=mailto:admin@vireon.local
```

Current automatic push alerts:

```text
New ticket -> MODERATOR, ADMIN, SUPER_ADMIN
Critical automod event -> MODERATOR, ADMIN, SUPER_ADMIN
Large transaction alert -> reserved for the future ledger/payment module
```

Login with the seeded admin account. On first run, set `ADMIN_DEFAULT_EMAIL` and `ADMIN_DEFAULT_PASSWORD`; the bot creates a `SUPER_ADMIN` user if the users table is empty.

Admin authentication always uses the main Prisma database tables, even if community module storage still runs with `STORAGE_DRIVER=json`.

After login, enable 2FA from the dashboard settings section. The bot generates an otpauth URL and secret, then requires a valid authenticator code to confirm. When 2FA is enabled, `/auth/login` requires `totpCode`. Failed password or TOTP attempts increment account lockout counters.

Admin roles:

```text
SUPER_ADMIN, ADMIN, MODERATOR, VIEWER
```

Auth endpoints:

```text
POST /auth/login
POST /auth/refresh
POST /auth/logout
GET  /auth/me
POST /auth/totp/setup
POST /auth/totp/confirm
POST /auth/totp/disable
```

Protected endpoints and minimum roles:

```text
GET   /auth/me                  VIEWER
POST  /auth/totp/setup          VIEWER
POST  /auth/totp/confirm        VIEWER
POST  /auth/totp/disable        VIEWER
GET   /api/dashboard/summary    VIEWER
GET   /api/guild                VIEWER
GET   /api/settings             VIEWER
PATCH /api/settings             ADMIN
GET   /api/moderation/cases     MODERATOR
GET   /api/tickets              MODERATOR
GET   /api/automod/events       MODERATOR
GET   /api/anti-spam/events     MODERATOR
GET   /api/proposals            VIEWER
GET   /api/announcements        VIEWER
GET   /api/modules/overview      MODERATOR
GET   /api/modules/events        MODERATOR
POST  /api/modules/:id/state     ADMIN
POST  /api/modules/export        ADMIN
POST  /api/modules/import        ADMIN
GET   /api/blockchain/status    VIEWER
GET   /api/push/public-key      VIEWER
POST  /api/push/subscriptions   VIEWER
DELETE /api/push/subscriptions  VIEWER
POST  /api/push/test            ADMIN
POST  /api/embeds/send          ADMIN
```

Use the access token returned by `/auth/login` as a Bearer token:

```bash
curl -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" http://127.0.0.1:8787/api/dashboard/summary
```

`/health` is intentionally not under `/api`; it returns HTTP `200` when all required components are healthy and `503` when the bot is degraded. It includes:

```text
bot, database, lavalink, chain
```

Chain client health modes:

```bash
VIREON_CHAIN_MODE=disabled
VIREON_CHAIN_MODE=mock
VIREON_CHAIN_MODE=rpc
VIREON_CHAIN_HEALTH_URL=https://rpc.example/health
VIREON_CHAIN_RPC_URL=https://rpc.example
VIREON_CHAIN_STATUS_PATH=/status
# or override the exact status endpoint:
VIREON_CHAIN_STATUS_URL=https://rpc.example/status
VIREON_CHAIN_REWARDS_PATH=/rewards/{address}
# or override the exact rewards endpoint:
VIREON_CHAIN_REWARDS_URL=https://rpc.example/rewards/{address}
VIREON_CHAIN_PAYMENT_FEE_PATH=/payments/estimate-fee
VIREON_CHAIN_PAYMENT_BROADCAST_PATH=/payments/broadcast
# or override exact payment endpoints:
VIREON_CHAIN_PAYMENT_FEE_URL=https://rpc.example/payments/estimate-fee
VIREON_CHAIN_PAYMENT_BROADCAST_URL=https://rpc.example/payments/broadcast
VIREON_CHAIN_PAYMENT_TIMEOUT_MS=3000
VIREON_CHAIN_MOCK_PAYMENT_FEE=0.001
VIREON_CHAIN_TX_STATUS_PATH=/transactions/{txHash}
# or override the exact tx status endpoint:
VIREON_CHAIN_TX_STATUS_URL=https://rpc.example/transactions/{txHash}
VIREON_CHAIN_TX_STATUS_TIMEOUT_MS=3000
VIREON_CHAIN_CACHE_ENABLED=true
VIREON_CHAIN_HEALTH_CACHE_TTL_MS=10000
VIREON_CHAIN_STATUS_CACHE_TTL_MS=15000
VIREON_CHAIN_REWARDS_CACHE_TTL_MS=30000
VIREON_CHAIN_TX_STATUS_CACHE_TTL_MS=5000
VIREON_CHAIN_STALE_CACHE_TTL_MS=120000
VIREON_CHAIN_RPC_RATE_LIMIT_PER_MINUTE=60
VIREON_CHAIN_RPC_RATE_LIMIT_WINDOW_MS=60000
ONCHAIN_SYNC_ENABLED=false
ONCHAIN_SYNC_INTERVAL_MS=30000
ONCHAIN_SYNC_BATCH_SIZE=100
ONCHAIN_SYNC_MIN_CONFIRMATIONS=6
ONCHAIN_SYNC_FINALITY_CONFIRMATIONS=24
ONCHAIN_SYNC_TRACK_STATUSES=broadcasted,broadcast_mock,onchain_seen,onchain_confirming,onchain_confirmed
```

`/vireon-status` uses the same chain adapter. In `rpc` mode it expects a JSON response containing known network metrics such as `height`/`blockHeight`, `latestBlock.hash`, `hashRate`, `activeNodes`/`peerCount` and `circulatingSupply`/`supply.circulating`. Until a real Vireon RPC/testnet endpoint exists, use `VIREON_CHAIN_MODE=mock` only for clearly marked simulated values.

`/rewards` uses a verified record from the shared DAL collection `wallet-links`, expected to be created by the future Phase 6 wallet-link flow. In `rpc` mode it expects reward metrics such as `mining`, `staking`, `node`, `claimable`, `pending`, `paid` or `totalRewards`. In `mock` mode the command marks the values as simulated.

RPC calls are protected by a shared in-memory cache and rate limiter inside the chain client. Health, status and rewards endpoints each have their own TTL. If the rate limit is reached or a temporary RPC error happens while a stale value is still available, commands and the dashboard return that stale cached value with `cached`/`stale` metadata instead of hammering the node.

Wallet registration:

```bash
PUBLIC_BASE_URL=https://bot.example.com
PAYMENT_LINK_SECRET=replace_with_at_least_32_random_characters
WALLET_HD_MASTER_SEED_FILE=/run/secrets/vireon_wallet_master_seed
# or one of:
WALLET_HD_MASTER_SEED_BASE64=
WALLET_HD_MASTER_SEED_HEX=
WALLET_HD_MASTER_SEED=
LEDGER_STORAGE_DRIVER=json
LEDGER_DATA_DIR=./data/ledger
VIREON_WALLET_SIGNATURE_VERIFY_URL=https://rpc.example/wallet/verify-signature
WALLET_ALLOW_MOCK_SIGNATURES=false
```

`/register custodial` creates a custodial wallet record in the isolated ledger store and derives the Vireon-style address from a master seed loaded from env/vault. The database stores only derivation metadata: wallet id, address, path and public hash. The master seed and derived private keys are never stored in cleartext or encrypted form in the DB, and are never returned through Discord, `/api/wallets` or payment links.

`/register external address:<wallet>` creates a challenge message. `/register verify address:<wallet> signature:<signature>` verifies the response through `VIREON_WALLET_SIGNATURE_VERIFY_URL`. For local development only, `WALLET_ALLOW_MOCK_SIGNATURES=true` enables deterministic mock signatures shown in the ephemeral challenge response.

Payment links are tokenized PWA URLs such as `/admin/pay/<token>`; legacy `/pay/<token>` redirects there. They show public receive data only: address, balances and transaction history. They do not expose custody envelopes or secrets. Withdrawal requests can be submitted from the page and are recorded as `pending_review` ledger transactions that move funds from `available` to `locked`; they do not broadcast on-chain automatically.

`/payment user:<member> amount:<amount>` sends VIRE from the caller's custodial wallet to another registered wallet. The command checks both registrations, rejects external sender wallets because the bot cannot sign their keys, estimates the network fee through `estimatePaymentFee`, then shows Confirm/Cancel buttons. Confirming calls `broadcastPayment`; only a successful broadcast updates local ledger balances and records `payment_sent`, `payment_received` and `payment_fee` transactions. In `mock` mode, the result is explicitly marked as simulated.

When `ONCHAIN_SYNC_ENABLED=true`, the on-chain sync worker polls transactions with broadcast/confirming statuses through `getTransactionStatus(txHash)`. It promotes rows to `onchain_confirming`, `onchain_confirmed` or `onchain_finalized`, stores block height/hash/confirmations in transaction metadata, updates the payment record, and marks conflicts as `double_spend` or `onchain_reorged`. If a transaction that already affected local balances is reorged out or conflicted, the worker reverses the local sender/recipient/fee balance effect once and records `balanceReversed` in metadata.

Send an embed:

```bash
curl -X POST http://127.0.0.1:8787/api/embeds/send \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"channelId":"123","title":"Vireon Update","description":"Draft update text.","color":"#d4af37"}'
```


## Admin Web Workspace

VBOS Admin Web now includes a web-first workspace at `/admin/#web`. It stores each admin user's preferences in the shared database, including default route, pinned panels, favorite quick actions, UI density, compact mode and reduced motion. The shell also includes a command palette opened with `Ctrl+K` / `Cmd+K`, sidebar filtering and role-aware disabled routes, so moderators and admins can move quickly without touching `.env` or using shell access.

Protected web endpoints:

```text
GET   /api/web/overview
PATCH /api/web/preferences
```

The command palette is navigation/action based only. It does not execute shell commands, JavaScript eval or destructive Discord actions directly.

## Commands

Command Center / staff operations added in `7.35.0`:

```text
/vbos help [category]
/vbos dashboard
/vbos invite
/vbos status
/vbos commands [category]
/vbos quickstart
/vbos audit [limit]
/modules list | status | enable | disable
/automations list | info | events | test
/operations templates | approvals | pushes | console
/server info | channels | roles | members
/member-role add | remove | list
/channel-control create | delete | topic | lock | unlock
```

These are allowlisted bot/server controls with Discord permission checks and audit logs; there is no shell execution or JavaScript eval.


```text
/setup-vireon confirm:true
/send-embed channel:#announcements title:"Vireon Update" description:"Draft update text."
/warn user:@member reason:"Reason"
/mute user:@member minutes:30 reason:"Reason"
/unmute user:@member reason:"Reason"
/kick user:@member reason:"Reason"
/ban user:@member reason:"Reason" delete_message_days:1
/purge amount:20 reason:"Cleanup"
/cases user:@member
/ticket open topic:"Need help"
/ticket close
/ticket list
/announce publish title:"Update" body:"Draft update text." status:Draft
/announce draft title:"Draft" body:"Draft text."
/announce schedule title:"Update" body:"Text" scheduled_at:"2026-07-05T12:00:00.000Z"
/announce list
/proposal create title:"Idea" summary:"Proposal text." type:community
/proposal list
/proposal close id:"proposal-id"
/play query:"song name or URL"
/pause
/resume
/skip
/stop
/queue
/nowplaying
/volume percent:70
/loop mode:queue
/shuffle
/filter preset preset:bassboost
/filter status
/filter clear
/playlist create name:"focus" scope:user
/playlist add name:"focus" query:"song name or URL"
/playlist play name:"focus"
/music play query:"song name or URL"   # legacy grouped form still supported
/vireon-status                         # live chain adapter status: height, hash rate, nodes, supply
/register custodial                    # create or show your custodial Vireon wallet
/register external address:<wallet>    # start external wallet challenge-response linking
/register verify address:<wallet> signature:<sig>
/register status                       # show linked wallet and payment link
/rewards                               # mining/staking/node rewards for a linked wallet
/payment user:@member amount:1.5       # confirm, broadcast and sync a VIRE payment
```

## Music / Lavalink

The music module uses Lavalink through Shoukaku. The bot does not encode audio in the Discord process, and Docker Compose runs Lavalink as a separate service.

Primary slash commands:

- `/play query:"song name or URL"`
- `/pause`, `/resume`, `/skip`, `/stop`
- `/queue`, `/nowplaying`, `/volume percent:70`
- `/nowplaying` sends an interactive panel with Pause/Resume, Skip and Queue buttons
- `/loop mode:off|track|queue` or `/loop` to cycle modes
- `/shuffle`
- `/filter preset preset:bassboost|nightcore|vaporwave|karaoke|eightd|lowpass|off`
- `/filter status`, `/filter clear`
- `/playlist create|list|show|add|remove|play|delete`

The older grouped `/music ...` commands remain available for compatibility.

Audio filters use native Lavalink filters through Shoukaku. Supported presets are `bassboost`, `nightcore`, `vaporwave`, `karaoke`, `eightd`, `lowpass` and `off`.

Saved playlists are stored through the shared DAL, so they work with both JSON storage and Prisma-backed production storage. User playlists belong to the creator; server playlists are shared per guild and require VBOS management permission to create, edit or delete.

```bash
MUSIC_ENABLED=true
LAVALINK_HOST=127.0.0.1
LAVALINK_PORT=2333
LAVALINK_PASSWORD=youshallnotpass
LAVALINK_SECURE=false
MUSIC_DEFAULT_VOLUME=70
```

For Docker Compose, keep `LAVALINK_HOST=lavalink` or leave the Compose default in place. The Lavalink container mounts `lavalink/application.yml`, so source settings, buffering and logging stay versioned with the bot.

For multi-node deployments, set `LAVALINK_NODES` to a JSON array and skip the single-node host/port variables:

```json
[
  { "name": "primary", "url": "http://lavalink-a:2333", "auth": "password-a" },
  { "name": "backup", "url": "http://lavalink-b:2333", "auth": "password-b" }
]
```

`/health` reports configured Lavalink nodes, ready nodes, active players and queue count.

## Tests

```bash
npm run test
npm run check
```

`npm run check` runs syntax checks, builds the React dashboard and runs the Vitest suite.

## Honest Readiness Rating

This release is a usable alpha for a private or early community server.

Current realistic rating: **7.8/10**.

Remaining work before a public, serious crypto community:

- user management UI for admin accounts;
- backup and restore workflows;
- monitoring and uptime checks.

## Safety Notes

- Never commit `.env`.
- Never share the bot token.
- Do not present VIRE as an investment or guaranteed return.
- Do not mark mainnet, wallet, explorer, mining pool, DAO or marketplace as live until each one is implemented, verified and documented.
- Security disclosures should go to the private security channels.


### Docker build hangs at `npm ci`

The Docker build is pinned to Node.js 24. If you run commands outside Docker, check `node -v` first and use Node 24.x.

If the first Docker build looks stuck at `RUN npm ci`, use the debug build command to print full progress:

```bash
./scripts/docker-build-debug.sh
```

On Windows PowerShell:

```powershell
.\scripts\docker-build-debug.ps1
```

Most slow installs are caused by npm package downloads or Prisma/canvas native package downloads on the first build. The Dockerfile now uses `node:24-bookworm-slim`, runs `scripts/npm-ci-heartbeat.js`, prints periodic install heartbeats, applies a controlled timeout, and runs a preflight registry check before installing dependencies.
