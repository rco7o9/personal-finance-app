# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## Project Overview

Personal family finance tracker for Arjun & Priya. Replaces a manual spreadsheet. Tracks expenses, income, investments (Zerodha, PayTM Money, CoinSwitch, INDMoney, HDFC Bank, Employer RSUs) with an AI-assisted HITL ingestion flow.

---

## Architecture

**Monorepo** — two independent apps, one shared Docker Compose environment:

```
Browser → Next.js :3000 (UI only) → NestJS :3001 (all API/business logic) → PostgreSQL :5432
```

- **`backend/`** — NestJS. Owns all data access, validation, and business rules. No data fetching happens in the frontend server.
- **`frontend/`** — Next.js App Router. Pure UI. Server components call NestJS via `fetch()` using the Docker-internal hostname (`http://backend:3001`). Client components use `http://localhost:3001`.
- **No ORM** — raw SQL via `node-postgres` (`pg`). Migrations are plain numbered `.sql` files in `backend/migrations/`. Type safety comes from `pgtyped` which generates TypeScript types from `.sql` query files in `backend/queries/`.
- **CloudBeaver** at `:8978` — web-based DB GUI (equivalent of Prisma Studio).

### NestJS module pattern

Every domain follows: `module → controller (HTTP) → service (DB + logic) → dto/ (validation)`. The `DatabaseModule` is `@Global()` — its `DB_POOL` provider (a `pg.Pool`) is injectable everywhere without re-importing.

### Next.js server vs client components

Pages under `src/app/(app)/` are server components by default — they `await fetch(...)` to NestJS before rendering. Mark `"use client"` only when a component needs `useState`, `useEffect`, event handlers, or browser APIs (e.g. Recharts charts, `PersonSelector` dropdown, `Sidebar` active-link detection).

The `(app)` route group shares the sidebar shell layout without adding `(app)` to the URL.

### Person selection (no auth)

Selected `personId` is stored in `localStorage` by `PersonSelector` (client component in `TopBar`) and synced into the URL as `?personId=X`. Server components read it from the `searchParams` prop — they cannot access `localStorage`.

---

## Key Conventions

- **Semicolons required** — enforced by Prettier (`semi: true`) in both apps.
- **Double quotes**, 2-space indent, trailing commas, 100-char print width.
- **Money** — always `NUMERIC(18,4)` in SQL, never `FLOAT`. Quantities use `NUMERIC(18,8)`.
- **Month columns** — stored as `DATE` (first day of month, e.g. `2025-01-01`).
- **Staging** — no separate staging table. Unreviewed rows live in `expense`/`investment` tables gated by `status` enum (`pending`, `confirmed`, `edited`, `excluded`). Reports always filter `WHERE status = 'confirmed'`.
- **`pg.Pool` generics** — always pass the expected row type: `pool.query<MyRowType>(sql, params)` to avoid `any` returns.
- **Floating promises** — top-level async calls use `void fn()` to satisfy `@typescript-eslint/no-floating-promises`.

---

## Common Commands

All commands assume you are `cd`'d into the relevant subdirectory unless noted.

### Docker (run from repo root)

```bash
docker compose up          # start all services (postgres, backend, frontend, cloudbeaver)
docker compose up -d       # detached
docker compose down        # stop all
docker compose logs -f backend   # tail a specific service
```

### Backend (`cd backend`)

```bash
npm run start:dev          # watch mode (hot reload)
npm run build              # TypeScript compile check
npm run lint               # ESLint --fix
npm run format             # Prettier --write
npm run migrate:up         # run pending SQL migrations (requires postgres running)
npm run migrate:down       # roll back last migration
npm run migrate:create -- <name>   # scaffold a new migration file
npm run codegen            # run pgtyped — regenerate types from queries/*.sql
npm test                   # Jest unit tests
npm run test:e2e           # Jest e2e tests
```

> `migrate:*` commands connect to `DATABASE_URL` from `.env` (i.e. `localhost:5432`). Make sure Postgres is running (via Docker) before migrating.

### Frontend (`cd frontend`)

```bash
npm run dev                # Next.js dev server
npm run build              # production build + type check
npm run lint               # ESLint
npx prettier --write "src/**/*.{ts,tsx}"   # format all files
```

### Pre-commit hook (automatic on `git commit`)

```bash
# Runs automatically — to test it manually:
sh .husky/pre-commit
```

Checks: Backend Prettier → Backend ESLint → Frontend Prettier → Frontend ESLint. Blocks commit on any failure.

---

## Build Order / Phase Plan

| Phase | Status | Description |
|---|---|---|
| 1 — Foundation | ✅ Done | Docker Compose, NestJS scaffold, Next.js scaffold, pre-commit hooks. DB schema (`001_init.sql`) **not yet written**. |
| 2 — Portfolio value view | 🔜 Next | Portfolio overview page: current value per asset class, overall XIRR, allocation vs target. Live prices via market APIs + agentic Google fallback. |
| 3 — Statement ingestion | Pending | Upload PDF/CSV → AI parse (Claude API) → HITL review table → commit to DB. |
| 4 — Expense reporting | Pending | Monthly + YTD views, budget vs actual, anomaly exclusion, Arjun vs Priya attribution. |
| 5 — Investment reporting | Pending | Monthly invested by asset class, deficit/surplus tracker. |
| 6 — Intelligence layer | Pending | Projection engine, rebalancing suggestions, agent-surfaced insights. |

**Immediate next step:** Write `backend/migrations/001_init.sql` with all `CREATE TYPE` and `CREATE TABLE` statements, then seed static reference data (home, persons, currencies, platforms, categories).

---

## Environment

`.env` at repo root (gitignored). Copy from `.env.example`.

| Variable | Used by | Value |
|---|---|---|
| `POSTGRES_USER/PASSWORD/DB` | Docker Compose, all services | set in `.env` |
| `DATABASE_URL` | Backend (Docker: `@postgres:5432`), migrations on host (`.env`: `@localhost:5432`) | two different values |
| `API_URL` | Next.js server components | `http://backend:3001` (Docker network) |
| `NEXT_PUBLIC_API_URL` | Next.js client components (browser) | `http://localhost:3001` |

The two `DATABASE_URL` values are the most common footgun: inside Docker containers use the service name `postgres`; from your Mac terminal use `localhost`.
