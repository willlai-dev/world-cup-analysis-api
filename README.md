# AI World Cup Analyst — Backend (Phase 1)

NestJS + Fastify + Prisma + PostgreSQL backend for the AI World Cup Analyst platform.
This repository currently delivers **Phase 1** (the runnable data-browsing MVP);
Phase 2 (real AI Router / NVIDIA / Qwen) and Phase 3 (deep chat, quota, model
cross-analysis) are scaffolded as guarded mock endpoints.

## Stack

- **NestJS 11** on the **Fastify** adapter, TypeScript `strict`
- **Prisma 6** + **PostgreSQL**
- Auth: signed **JWT in an HttpOnly cookie** + `GET /auth/me`
- Swagger/OpenAPI at `/docs`
- Tests: **Jest** (unit) + **Supertest** (e2e)

## Repository layout (pnpm monorepo)

```
world-cup-analysis-api/
├── apps/
│   └── api/            # NestJS backend (this app)
├── packages/           # (reserved for future apps/web shared types)
├── docker-compose.yml  # optional local Postgres (aligned to .env credentials)
├── pnpm-workspace.yaml
└── package.json        # root scripts proxy to apps/api
```

## Prerequisites

- Node.js ≥ 20 (tested on v22), pnpm 10
- A reachable PostgreSQL. Either:
  - **Reuse your existing local Postgres** (the configured default — see `apps/api/.env`), or
  - `docker compose up -d` to start one. **Do not run both on port 5432.**

## Local setup

```bash
# 1. install (root) — also generates + patches the Prisma client
pnpm install

# 2. configure env: apps/api/.env already contains working values.
#    Copy apps/api/.env.example for a fresh setup.

# 3. database (from apps/api)
cd apps/api
pnpm prisma:generate     # prisma generate + CJK-path patch (see note below)
pnpm prisma:migrate      # prisma migrate dev + re-patch
pnpm prisma:seed         # idempotent seed (admin/premium/user + demo data)

# 4. run
pnpm start:dev           # http://localhost:3000/api  (Swagger: /docs)
```

Root-level shortcuts also work: `pnpm dev`, `pnpm build`, `pnpm test`, `pnpm test:e2e`,
`pnpm prisma:migrate`, `pnpm prisma:seed`, `pnpm db:up`.

## Seeded accounts

| Role | Email | Password |
|---|---|---|
| ADMIN | `admin@example.com` | `admin123456` |
| PREMIUM | `premium@example.com` | `premium123456` |
| USER | `user@example.com` | `user123456` |

## Tests

```bash
cd apps/api
pnpm test        # unit tests (services, guards)
pnpm test:e2e    # e2e: auto-creates/migrates/seeds footy_predict_test, runs the 15 required RBAC cases
```

The e2e harness uses a **separate database** (`footy_predict_test`) created automatically
in `test/setup/global-setup.ts` (the configured role has CREATEDB). It is migrated and
seeded with idempotent fixtures, so re-runs are safe.

## API surface (all under `/api`)

- **Public**: `GET /health`, `GET /health/db`, `GET /home/highlights`,
  `POST /auth/register`, `POST /auth/login`
- **Auth**: `POST /auth/logout`, `GET /auth/me`
- **Users (USER/PREMIUM)**: `GET/PATCH /users/me`, `GET /users/me/favorites`
- **Admin (ADMIN only)**: `GET/POST /admin/users`, `PATCH /admin/users/:id/role`,
  `DELETE /admin/users/:id` (soft delete), `POST /admin/register-admin`
- **Reads (USER/PREMIUM)**: `matches`, `teams`, `players`, `news`, `champion-predictions`
  (+ detail / analysis / prediction / post-match-report routes)
- **Favorites (USER/PREMIUM)**: `POST/DELETE /favorites/teams|players/:id`
- **AI chat (USER/PREMIUM)**: `POST /ai/chat`
- **PREMIUM-only mocks (Phase 2/3 stubs)**: `*/deep-chat`, `news/:id/translate`,
  `champion-predictions/recalculate`
- **Jobs (cron-protected)**: `POST /jobs/*` requires header `x-cron-secret`

Every response uses the envelope `{ data, meta?, error }`.

## RBAC summary

- Global `JwtAuthGuard` (cookie JWT). `@Public()` opts routes out.
- `AdminOnlyGuard` → ADMIN only (admin controller).
- `NonAdminUserGuard` → USER/PREMIUM; **ADMIN is 403** on all user-domain APIs.
- `PremiumOnlyGuard` → PREMIUM only (translate / recalculate / deep-chat).
- `CronSecretGuard` → `x-cron-secret` for jobs.
- DISABLED accounts cannot log in and are rejected (403) on protected routes.

### Account deletion = soft delete

`DELETE /admin/users/:id` never removes the row. It sets `status = DISABLED`
(keeping profile, favorites, AI logs, prediction runs). The last **active** admin
cannot be disabled/demoted (409 `LAST_ADMIN_PROTECTED`), and an admin cannot disable
their own account.

## Environment keys that need manual setup

`apps/api/.env` is preconfigured for this machine. For a fresh environment set at least:

- `DATABASE_URL` — Postgres connection (reuses your existing DB by default)
- `JWT_SECRET`, `COOKIE_SECRET`, `CRON_SECRET` — long random secrets
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` / `SEED_ADMIN_DISPLAY_NAME`
- Phase 2/3 only (optional while `AI_MOCK_MODE=true`): `NVIDIA_API_KEY`,
  `DASHSCOPE_API_KEY`, `FOOTBALL_DATA_API_KEY`, `GUARDIAN_API_KEY`, `NEWS_API_KEY`

`AI_MOCK_MODE=true` keeps all AI-touching endpoints working without external keys.

## Environment notes / gotchas

- **Prisma client on a CJK/non-ASCII path.** This project lives under a path with
  CJK characters. Prisma 6.7+ generates `.prisma/client/default.js` with a Node
  subpath import `require('#main-entry-point')`, and Node's URL-based subpath-imports
  resolver fails to find the package's `imports` map when the absolute path contains
  non-ASCII characters on Windows. We rewrite that one line to `require('./index.js')`
  via `apps/api/scripts/patch-prisma-client.cjs`, run automatically after
  `postinstall` and the `prisma:generate` / `prisma:migrate` scripts. If you ever run
  bare `prisma generate`, re-run `node scripts/patch-prisma-client.cjs` afterwards.
- **pnpm** uses `node-linker=hoisted` (`.npmrc`) and allows Prisma build scripts
  (`pnpm.onlyBuiltDependencies`).
- **Database privileges.** The migration role needs `CREATE` on the `public` schema
  of the target database (Postgres 15+ revokes this by default for non-owners).
- **docker-compose** is aligned to the `.env` credentials; skip it if you already run
  Postgres on 5432.

## Phase 1 scope

Implemented: bootstrap, config, Prisma schema + seed, cookie-JWT auth, RBAC, admin
account management (soft delete), read APIs, favorites, mock AI/translate/recalculate/
deep-chat stubs, jobs stubs, unit + e2e tests.

Deferred to Phase 2/3: real AI Router and NVIDIA/Qwen adapters, news fetch/summary/
classification, real translation, champion dual-model cross-analysis, deep chat,
quota/rate-limit enforcement.
