# Vireon Network Deployment

This project is split into three deployable parts:

1. Static React website and admin panel
2. Node.js API server
3. PostgreSQL database

The public site reads the Vireon Mainnet Candidate RPC. This is candidate-chain data and must not be described as a live public mainnet until launch gates pass.

## Frontend Hosting

Build command:

```bash
npm install
npm run build
```

Publish directory:

```text
dist
```

Required frontend environment variable:

```text
VITE_API_BASE_URL=https://api.vireon.example
VITE_VIREON_RPC_URL=https://rpc-candidate.vireon.example
```

The `/admin` panel is lazy-loaded inside the same React build and uses the same API base URL.

## Backend Hosting

Recommended runtime:

```text
Node.js 20+
```

Build/start commands:

```bash
cd server
npm install
npm run prisma:generate
npm run prisma:migrate
npm run seed
npm run cms:migrate
npm run start
```

Production backend environment variables:

| Variable | Required | Example | Notes |
|---|---:|---|---|
| `DATABASE_URL` | yes | `postgresql://user:pass@host:5432/vireon?schema=public` | PostgreSQL connection string |
| `JWT_SECRET` | yes | long random secret | Access token signing secret |
| `JWT_REFRESH_SECRET` | yes | different long random secret | Refresh token signing secret |
| `PORT` | no | `4000` | API server port |
| `CORS_ORIGIN` | yes | `https://vireon.example,https://www.vireon.example` | Comma-separated allowlist |
| `RATE_LIMIT_WINDOW_MS` | no | `900000` | Default 15 minutes |
| `RATE_LIMIT_MAX` | no | `300` | Global request limit per window |
| `NODE_ENV` | yes | `production` | Enables secure refresh cookie |
| `VIREON_RPC_URL` | yes | `http://127.0.0.1:10787` | Mainnet Candidate Rust RPC used by the read-only network adapter |
| `DEFAULT_ADMIN_EMAIL` | first deploy | `admin@vireon.network` | Used by seed |
| `DEFAULT_ADMIN_PASSWORD` | first deploy | strong password | Rotate after first login |

## PostgreSQL

Use a managed PostgreSQL service or a separately hosted database. The server expects normal Prisma migrations against PostgreSQL.

Operational notes:

- Run migrations before starting a new backend release.
- Keep database backups enabled.
- Rotate `DEFAULT_ADMIN_PASSWORD` after seed by creating a new superadmin or changing the user through the admin panel.
- Restrict direct DB access to the backend host/provider.

## API Documentation

After backend deploy:

```text
GET /openapi.json
GET /api/docs
```

## Verification Checklist

```bash
npm run build
npm run server:test
```

Manual checks:

- Public site loads with `VITE_API_BASE_URL`.
- `/api/network/stats` returns `mode: "mainnet_candidate"` and matches the Rust RPC height.
- `/admin` login works with seeded superadmin.
- CMS pages still render if the API is temporarily down because the frontend has static fallback content.
