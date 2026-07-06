# Accounting Firm Portal — Project Memory

Persistent context for Claude Code. Keep this file short and stable. The detailed
specs live in `docs/`; read them, don't duplicate them here.

## What this is

A multi-tenant web application for an accounting firm to manage **clients**, their
**sales/income** and **expenses**, **tax estimates**, a self-service **Client Portal**,
and a machine-to-machine **integration with an external BIR Form Generator**.

## Source of truth (read before building)

- `docs/system-design.md` — full system design: requirements, actors, RBAC, domain
  model, activity flows, technology stack, and the integration section.
- `docs/bir-integration-spec.md` — the exact API/data contract for the BIR Form
  Generator (entities, endpoints, JSON shapes, enums, aggregation rules).
- `docs/ROADMAP.md` — the phased build plan. Follow it; work one phase at a time.

## Tech stack (decided — do not re-derive)

- **Frontend:** React 18 + TypeScript (strict) + Vite; Tailwind + Radix/shadcn;
  TanStack Query + Table; React Hook Form + Zod; Recharts; SheetJS + PapaParse.
- **Backend:** Node.js + TypeScript + **NestJS**; REST/JSON at `/api/v1`; OpenAPI
  (Swagger); **Prisma**.
- **Data:** PostgreSQL; Redis + BullMQ (async imports & email); S3-compatible object
  storage (files, exports, BIR XML/PDF).
- **Auth:** argon2 + JWT + TOTP MFA for users; **OAuth2 client-credentials** for the
  BIR Generator integration.
- **Shared:** a workspace package of Zod schemas/types for the tax-classification enums,
  reused by both frontend and backend.
- **Tooling:** Vitest/Jest + Supertest + Playwright; ESLint + Prettier; GitHub Actions.

## Conventions

- TypeScript strict everywhere. No `any` without a comment justifying it.
- Validation lives in shared Zod schemas; API DTOs derive from them. Enums are defined
  once and imported — never re-typed inline.
- REST resources under `/api/v1`; document every endpoint in OpenAPI.
- Every endpoint enforces auth + **per-client RBAC**. Integration endpoints also check
  OAuth scopes.
- Write tests for anything with real logic. The **aggregation** that turns classified
  transactions into `vat-summary` / `percentage-tax-summary` is the highest-value code —
  cover it thoroughly.

## Guardrails (do NOT violate)

1. **The Portal never computes authoritative BIR tax.** The BIR Form Generator owns that.
   The Portal's tax computation is a *management estimate*; the *filed* figures come from
   the Generator's push-back.
2. **Tax-classification enums are frozen** and defined once in `packages/shared`
   (`@portal/shared`): `VatClass`, `InputVATCategory`, `InputTaxAttribution`. Import them;
   never retype them.
3. **Transaction amounts are stored net of VAT.** VAT is carried in its own fields.
4. **Integration write endpoints are idempotent**, keyed by `client + form + period`
   (upsert, never duplicate).
5. **The Portal supplies amounts only** for percentage tax — the ATC and rate are owned by
   the Generator. Never send a rate.
6. **Secrets never reach the browser.** The Generator authenticates machine-to-machine.

## Repo layout (target)

A pnpm monorepo. Fill in exact paths as the scaffold lands:

- `apps/api` — NestJS backend
- `apps/web` — React frontend (firm UI + client portal)
- `packages/shared` — **already written and verified** (`@portal/shared`): the frozen
  enums and the full Portal ⇄ Generator contract schemas. Do NOT recreate it; wire the
  workspace around it and import from it. Re-declaring these enums/shapes anywhere else is
  a bug.
- `prisma/` — schema & migrations
- `docs/` — the specs above

## Commands

_To be filled in once the scaffold exists (e.g. `pnpm dev`, `pnpm test`, `pnpm lint`,
`pnpm --filter api prisma migrate dev`)._
