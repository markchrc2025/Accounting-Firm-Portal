# Build Roadmap — Accounting Firm Portal

Phased plan. Build one phase at a time; each ends in a reviewable, working state with
tests. Detailed requirements are in `system-design.md`; the integration contract is in
`bir-integration-spec.md`.

## Phase 0 — Scaffold & foundations
- pnpm monorepo: `apps/api` (NestJS), `apps/web` (React + Vite), `prisma/`.
- `packages/shared` (`@portal/shared`) is **already written and verified** — wire the
  workspace around it (add it to `pnpm-workspace.yaml`, reference it from both apps); do
  not recreate it. Its typecheck + tests already pass.
- Prisma + PostgreSQL connection; initial schema for core entities (Firm, User/FirmUser/
  ClientUser, Client, Role, Permission, UserRole, RolePermission).
- Redis wired up (for later BullMQ use).
- ESLint + Prettier, Vitest/Jest, Supertest, Playwright, GitHub Actions (typecheck + test
  + build). Health-check endpoint + a rendered home page.

## Phase 1 — Identity, Access & Tenancy
- Auth: email + password (argon2), JWT sessions, TOTP MFA.
- RBAC: data-driven roles/permissions; NestJS guards; per-client scoping for firm users.
- User management (CRUD), client-user invitations with expiring tokens, audit log.

## Phase 2 — Financial data & capture
- `Category`; `IncomeTransaction` (extends SalesRecord) and `PurchaseTransaction` (extends
  ExpenseRecord) with the frozen tax-classification enums; amounts stored **net of VAT**.
- Regime-aware entry modal (VAT vs percentage client); list/filter/grid views.

## Phase 3 — Import / Export
- CSV/XLSX templates with the tax-classification columns (see `system-design.md` §9).
- Row-level validation (incl. enums + conditional capital-goods fields); ImportBatch +
  ImportError; async processing via BullMQ for large files; CSV/XLSX export.

## Phase 4 — Email & billing
- MJML templates + Handlebars; Invoice + InvoiceLineItem; send billing + invitations;
  EmailMessage logging with delivery status.

## Phase 5 — Tax estimate
- TaxRule + TaxBracket; strategy methods (graduated / flat / percentage / simplified);
  TaxComputation; the client Tax page. Clearly labelled as an **estimate**.

## Phase 6 — BIR integration (read)
- OAuth2 client-credentials token service; IntegrationClient management (Firm Admin).
- Aggregation service + endpoints: `vat-summary`, `percentage-tax-summary`,
  `tax-computations`, `income-transactions`, `purchase-transactions`. Enforce scopes +
  per-client RBAC. **Cover aggregation with tests.**

## Phase 7 — BIR integration (write)
- `BIRFiling` + `InputTaxAsset` entities; `POST`/`PUT /clients/{id}/bir-filings`
  (idempotent upsert by client + form + period); `POST /clients/{id}/input-tax-asset`;
  surface filings + Input Tax Asset on the client profile.

## Phase 8 — Client Portal
- Client-user UI: dashboards, read-only visibility of sales/expenses/reports and filed BIR
  forms; role-based access (Owner/Manager/Viewer); seat management (min 3).

## Phase 9 — Hardening & delivery
- Audit coverage on all integration endpoints; rate limiting; observability (Sentry +
  OpenTelemetry); E2E tests; deployment (containers + CI/CD).

---

**Not in this build (owned elsewhere):** BIR form layout, eBIRForms XML/PDF, and the
authoritative BIR tax math — all owned by the BIR Form Generator. Direct e-filing and
payment processing are also out of scope.
