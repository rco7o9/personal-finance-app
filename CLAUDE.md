# CLAUDE.md

## Stack
- **Backend:** NestJS (TypeScript) — `backend/` — port 3001
- **Frontend:** Next.js App Router (TypeScript) — `frontend/` — port 3000
- **Database:** PostgreSQL — raw SQL via `node-postgres` + `pgtyped` for types
- **Dev environment:** Docker Compose (postgres, backend, frontend, cloudbeaver :8978)
- **UI components:** shadcn/ui (component library built on Radix UI + Tailwind CSS)
- **Charts:** Recharts (React charting library — use for all data visualisations)
- **Styling:** Tailwind CSS (comes with shadcn/ui setup)

## Key Conventions
- Semicolons required; double quotes; 2-space indent; trailing commas; 100-char line width
- Money: `NUMERIC(18,4)` in SQL — never `FLOAT`. Quantities: `NUMERIC(18,8)`. See ADR-005.
- `NUMERIC` columns come back as JS strings from node-postgres — use `decimal.js` for arithmetic, never `parseFloat()`
- Month columns: `DATE` stored as first day of month (`2025-01-01`)
- Reports always filter `WHERE status = 'confirmed'` — omitting this is a silent correctness bug. See ADR-004.
- `pg.Pool` queries: always pass the row type generic — `pool.query<MyRowType>(sql, params)`
- Floating promises: use `void fn()` at call sites to satisfy `@typescript-eslint/no-floating-promises`
- NestJS domains: `module → controller → service → dto/`. `DatabaseModule` is `@Global()` — inject `DB_POOL` anywhere without re-importing
- Next.js: server components `await fetch(...)` to NestJS. Mark `"use client"` only for `useState`, `useEffect`, event handlers, or browser APIs
- Server components read `personId` from `searchParams` prop — never from `localStorage`. Links must preserve `?personId=X`. See ADR-003.
- All business logic lives in `backend/` — never in Next.js server actions or API routes. See ADR-001.
- All database table and column names use `snake_case` — no camelCase or PascalCase in SQL

## Commands

### Docker (repo root)
```bash
docker compose up               # start all services
docker compose up -d            # detached
docker compose down             # stop all
docker compose logs -f backend  # tail a specific service
```

### Backend (`cd backend`)
```bash
npm run start:dev               # watch mode (hot reload)
npm run build                   # TypeScript compile check
npm run lint                    # ESLint --fix
npm run format                  # Prettier --write
npm run migrate:up              # run pending migrations (postgres must be running)
npm run migrate:down            # roll back last migration
npm run migrate:create -- <name>
npm run codegen                 # regenerate pgtyped types (postgres must be running)
npm test
npm run test:e2e
```

### Frontend (`cd frontend`)
```bash
npm run dev
npm run build
npm run lint
npx prettier --write "src/**/*.{ts,tsx}"
```

### Pre-commit
```bash
sh .husky/pre-commit            # runs automatically on git commit
```

## Memory
- **Active phase note:** `.claude/notes/phase3-statement-ingestion.md`
- **Previous phase (complete):** `.claude/notes/phase2-portfolio-view.md`
- **ADRs:** `docs/decisions/`

## Commit Rules
Follow the `git-workflow-and-versioning` skill from agent-skills for all commits.
Invoke it explicitly before every commit: "apply the git-workflow-and-versioning skill to create this commit".

## Rules
- Read the active phase note at the start of every session
- Before any architectural decision, check `docs/decisions/` for an existing ADR
- When a new architectural decision is made, write a new ADR in `docs/decisions/` immediately
- Never modify existing ADRs — supersede with a new numbered ADR that references the old one
- Use `/start-feature` at the start of each session and `/end-session` at the end
- Update `docs/system.md` at the end of every session (via `/end-session`) after changes are verified — not during implementation
