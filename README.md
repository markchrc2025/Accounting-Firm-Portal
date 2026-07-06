# Accounting Firm Portal — Handoff Package

Everything Claude Code needs to start building the Accounting Firm Portal.

## What's here

| File | Purpose |
|---|---|
| `CLAUDE.md` | Persistent project memory — Claude Code reads this at the start of every session. Stack, conventions, and guardrails. |
| `PROMPT.md` | The kickoff prompt to paste into Claude Code (plus follow-up prompts per phase). |
| `docs/system-design.md` | The full system design (requirements, actors, RBAC, domain model, activity flows, technology stack, integration). |
| `docs/bir-integration-spec.md` | The exact API/data contract for the BIR Form Generator integration. |
| `docs/ROADMAP.md` | The phased build plan Claude Code should follow. |
| `packages/shared/` | **Pre-built & verified** `@portal/shared` — the frozen enums and the full Portal ⇄ Generator contract as Zod schemas (typecheck + Vitest pass). Claude Code builds the workspace around it. |

> A PDF copy of the system design exists separately for stakeholders. **For Claude Code,
> use these Markdown files** — the diagrams and tables stay machine-readable, which they
> don't when extracted from a PDF.

## How to use it

1. Drop these files into your (empty) project repo, keeping the structure:
   ```
   your-repo/
   ├── CLAUDE.md
   ├── PROMPT.md
   ├── .gitignore
   ├── docs/
   │   ├── system-design.md
   │   ├── bir-integration-spec.md
   │   └── ROADMAP.md
   └── packages/
       └── shared/            # @portal/shared — pre-built, do not recreate
   ```
2. Open Claude Code in the repo root.
3. Paste the kickoff prompt from `PROMPT.md`. It asks Claude Code to read the docs, propose
   a plan, and wait for your approval before scaffolding.
4. Approve the plan, let it build **Phase 0**, review, then continue phase by phase using
   the follow-up prompts.

## Getting started (Phase 0 scaffold)

The repo is a **pnpm monorepo**: `apps/api` (NestJS), `apps/web` (React + Vite), and the
pre-built `packages/shared` (`@portal/shared`).

**Prerequisites:** Node 22 (see `.nvmrc`), pnpm 10, and PostgreSQL + Redis.

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env            # adjust DATABASE_URL / REDIS_URL if needed

# 3. Bring up Postgres + Redis (or use your own)
docker compose up -d

# 4. Generate the Prisma client and apply the schema
pnpm --filter api prisma:generate
pnpm --filter api prisma:migrate      # first run creates the DB tables

# 5. Seed the RBAC catalog + a bootstrap Super Admin (admin@firm.test / ChangeMe123!)
pnpm --filter api db:seed

# 6. Run both apps (API on :3000, web on :5173)
pnpm dev
```

Then open:
- Web app: <http://localhost:5173> — sign in with the seeded admin
  (`admin@firm.test` / `ChangeMe123!`) to reach the dashboard. Client users onboard
  via the invitation link at `/accept?token=…`.
- API health: <http://localhost:3000/api/v1/health> (liveness) and
  `/api/v1/health/readiness` (DB + Redis checks).
- API docs (Swagger): <http://localhost:3000/api/v1/docs>.

**Auth & RBAC (Phase 1):** email + password (argon2) with optional TOTP MFA; JWT
sessions; data-driven roles/permissions enforced by NestJS guards, with per-client
scoping for firm users (assigned clients) and client users (own organization).

**Quality gates** (also enforced in CI — `.github/workflows/ci.yml`):

```bash
pnpm typecheck      # tsc across all packages
pnpm lint           # ESLint (api + web)
pnpm test           # unit tests (shared + api + web)
pnpm --filter api test:e2e   # API e2e (hermetic — no DB required)
pnpm build          # build shared + api + web
```

The CI workflow runs those in a **hermetic** job (no DB) plus a separate **database** job
that spins up Postgres and applies the Prisma migrations.

## The one rule to remember

The Portal **summarizes**; the BIR Form Generator **computes the filing**. The Portal
classifies transactions and serves aggregates; the Generator does the authoritative BIR
tax math and pushes the filed forms back. Keep that boundary and the rest follows.
