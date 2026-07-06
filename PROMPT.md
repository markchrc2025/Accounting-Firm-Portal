# Claude Code — Kickoff Prompt

Paste the block below into Claude Code from the repo root (with these files in place).
It kicks off planning + Phase 0. Follow-up prompts for later phases are at the bottom.

---

You are helping me build the **Accounting Firm Portal** — a multi-tenant web app for an
accounting firm to manage clients, their sales/income and expenses, tax estimates, a
self-service client portal, and a machine-to-machine integration with an external **BIR
Form Generator**.

**Read these first — they are the source of truth:**
- `CLAUDE.md` — conventions, tech stack, and guardrails
- `docs/system-design.md` — the full system design
- `docs/bir-integration-spec.md` — the exact API/data contract for the BIR integration
- `docs/ROADMAP.md` — the phased build plan

**Tech stack is already decided (see CLAUDE.md) — do not re-derive it.** In short:
React 18 + TS + Vite on the frontend; NestJS + Prisma + PostgreSQL on the backend;
Redis + BullMQ for async work; OAuth2 client-credentials for the integration; pnpm monorepo.

**`packages/shared` (`@portal/shared`) is already written and verified** — it holds the
frozen tax-classification enums and the full Portal ⇄ Generator contract as Zod schemas,
with a passing typecheck and Vitest suite. **Do not recreate it.** Wire the workspace
around it and import from it; never re-declare those enums or payload shapes.

**Hard constraints (do not violate):**
1. The Portal never computes authoritative BIR tax — the Generator owns that. The Portal's
   tax computation is a *management estimate*; the *filed* figures come from push-back.
2. Keep the tax-classification enums (`VatClass`, `InputVATCategory`, `InputTaxAttribution`)
   exactly as specified in the docs — they must match the integration contract.
3. Transaction amounts are stored **net of VAT**; VAT is carried in its own fields.
4. Integration write endpoints (`bir-filings`, `input-tax-asset`) are **idempotent**,
   keyed by `client + form + period`.
5. Enforce **per-client RBAC** on every endpoint; integration tokens are firm-scoped
   OAuth2 client-credentials, still bounded by assigned-client visibility.
6. Secrets never reach the browser.

**How I want you to work:**
- Start in **plan mode**. Read the docs above, then give me a concise phased plan that
  follows `docs/ROADMAP.md`, plus the exact monorepo structure and package choices you'll
  scaffold. **Stop and wait for my approval before writing any code.**
- After I approve, implement **Phase 0 only**: the pnpm monorepo scaffold — the NestJS API
  app, the React (Vite) app, `pnpm-workspace.yaml` wiring in the **existing**
  `packages/shared`, Prisma with an initial schema for the core entities (Firm,
  User/FirmUser/ClientUser, Client, Role/Permission), lint + test + CI config, and a
  working health check on both apps. Prove the wiring by importing something from
  `@portal/shared` in both apps. Add a short README on how to run everything, and update
  `CLAUDE.md`'s "Commands" section with the real scripts.
- Then stop for review. We'll go phase by phase.
- Write tests for anything with real logic — especially the aggregation that turns
  classified transactions into `vat-summary` / `percentage-tax-summary`.
- Ask before any large architectural decision not already settled in the docs.

Begin by reading the docs and proposing the plan.

---

## Follow-up prompts (use one per phase, after Phase 0)

- "Proceed to **Phase 1** (Identity, Access & Tenancy) per `docs/ROADMAP.md`. Plan briefly,
  then implement, with tests. Stop for review when done."
- "Proceed to **Phase 2** (financial data & capture). Implement `IncomeTransaction` /
  `PurchaseTransaction` with tax classification and the regime-aware entry modal."
- "Proceed to **Phase 6** (BIR integration — read): the OAuth2 token service and the
  aggregation endpoints. Match `docs/bir-integration-spec.md` byte-for-byte and cover the
  aggregation with tests."
- "Proceed to **Phase 7** (BIR integration — write): `BIRFiling` + `InputTaxAsset` with
  idempotent upsert keyed by client + form + period."

Tip: at the end of a good session, tell Claude Code "update CLAUDE.md with what you learned
about our setup today" so the project memory stays current.
