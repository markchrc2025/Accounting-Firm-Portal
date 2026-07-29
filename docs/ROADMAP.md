# Build Roadmap — Accounting Firm Portal

**Status as of July 2026.** The original ten-phase plan (0–9) is essentially complete, and
a substantial amount was built beyond it — most importantly the **BIR Form Generator**,
which the original plan had explicitly assigned to a *separate* system.

This file now serves two purposes: it records **what was actually built against the
original plan**, and it lists **what is genuinely left**. Detailed requirements live in
`system-design.md`; the retained integration contract is in `bir-integration-spec.md`.

Legend: ✅ done · ⚠️ done differently than planned · ⬜ not built

---

## Part 1 — The original plan, and how it landed

| Phase | Planned | Status |
|---|---|---|
| **0** | Scaffold, `@portal/shared`, Prisma + Postgres, Redis, lint/test/CI, health check | ✅ |
| **1** | Auth (argon2 + JWT + TOTP MFA), data-driven RBAC, users, invitations, audit log | ✅ |
| **2** | `Category`, income/purchase transactions with the frozen enums, regime-aware capture | ✅ |
| **3** | CSV/XLSX import/export with row-level validation | ⚠️ built **synchronously** — see below |
| **4** | Email + billing: invoices, invitations, delivery logging | ⚠️ built **without MJML** — see below |
| **5** | Tax rules, brackets, strategy methods, the client tax page (an *estimate*) | ✅ |
| **6** | OAuth2 client-credentials, integration clients, scoped aggregation endpoints | ✅ |
| **7** | `BIRFiling` + `InputTaxAsset` write receivers, idempotent upsert | ✅ |
| **8** | Client Portal: role-scoped dashboards and read-only visibility | ✅ |
| **9** | Audit coverage, rate limiting, observability, E2E, deployment | ⚠️ partial — see below |

### Where the build diverged from the plan

**Phase 3 — import/export is synchronous.** The plan called for `ImportBatch` +
`ImportError` entities and async processing through **BullMQ**. What shipped is a
client-side parse + preview (`spreadsheet.ts`, `ImportModal`) posting to `POST /import`
endpoints that validate and commit in-request. Redis is wired up but **BullMQ is not
used**. This is fine at the firm's current file sizes; revisit if imports grow large
enough to time out a request.

**Phase 4 — email is provider-agnostic, not MJML.** The plan named MJML + Handlebars and
SES/SendGrid. What shipped is a `MAIL_PROVIDER`-selected adapter (**Postal** self-hosted,
with a Plunk adapter alongside) and hand-built templates in `mail/email-templates.ts`
with a shared theme. Delivery logging is in place.

**Phase 9 — partially complete.**

| Item | Status |
|---|---|
| Audit coverage on integration endpoints | ✅ |
| CI/CD (GitHub Actions → Sliplane) | ✅ |
| E2E tests | ✅ login, home, financial capture, **BIR Forms** |
| Observability | ✅ opt-in **Sentry** (errors + OTel-compatible tracing); inert until `SENTRY_DSN` is set |
| **Rate limiting** | ⬜ **not built** — the main outstanding item |

---

## Part 2 — Built beyond the original plan

None of the following appears in the original roadmap.

### The BIR Form Generator — the biggest addition

The plan listed BIR form layout, eBIRForms XML, and the authoritative BIR tax math as
**out of scope, owned elsewhere**. That changed: the Generator was ported into the Portal
(`apps/api/src/bir-forms` + its Firm Admin UI), and **all nine forms are live**.

| Form | Kind | Output |
|---|---|---|
| **2551Q** | Quarterly percentage tax | eBIRForms XML |
| **2550Q** | Quarterly VAT | eBIRForms XML |
| **1701Q** | Quarterly income tax (individuals) | eBIRForms XML |
| **1701A** | Annual income tax (8% / OSD) | eBIRForms XML |
| **1701** | Annual income tax (mixed income) | eBIRForms XML |
| **1702Q** | Quarterly income tax (corporations) | eBIRForms XML |
| **1702RT** | Annual income tax (corporations, regular) | eBIRForms XML |
| **2307** | Creditable withholding certificate | **Print to PDF** |
| **2316** | Compensation certificate | **Print to PDF** |

Each ported form carries a **parity test against a real eBIRForms export** — namespace,
field keys, package quirks, tail and canonical filename. 1701's asserts the exact 837-row
count. The 2307/2316 certificates are *issued* rather than e-filed, so BIR defines no XML
for them; they render a faithful A4 sheet to PDF instead.

The **filing lifecycle** (draft ⇄ filed, with `filedAt`) publishes a filed form's figures
onto the client's tax view, which is how guardrail #1 is enforced in the UI: the estimate
never overrides a generated form.

### Other additions

- **Chart of Accounts** — seeded catalogue with an authoritative hierarchy registry, CRUD,
  archive/restore, and account→tax-line mappings.
- **Financial Statement Creator** — BS/IS/CF/CE + Notes from client data, with a formula-
  bearing xlsx export.
- **BIR reference data** — tax types and the ATC code table.
- **Services catalogue & billing** — services, invoices with per-line tax selection,
  default-service wiring, PDF/JPEG export, sub-client billing under a parent.
- **Google / Microsoft OIDC SSO** — signs in *existing* accounts matched by verified
  email; no self-provisioning.
- **Roles editor** — create/edit/delete roles with system-role protection.
- **COR upload + OCR auto-fill** for client onboarding.
- **User profiles + avatar upload** to object storage.
- **MCP module** for machine access.

---

## Part 3 — What's actually left

1. **Rate limiting** — the one unbuilt Phase 9 item. `@nestjs/throttler` with tighter
   limits on the auth endpoints (login, MFA, SSO callback, invite accept) and the OAuth2
   token endpoint.
2. **Async imports** — only if file sizes start timing out a request. Would mean the
   planned `ImportBatch`/`ImportError` entities plus BullMQ consumers.
3. **Turn on observability** — set `SENTRY_DSN` (and optionally the environment, sample
   rate and release) in Sliplane. The code is already deployed and inert.
4. **Rotate exposed secrets** — several were pasted into chat/screenshots during
   development: `POSTAL_API_KEY`, `MS_CLIENT_SECRET`, the S3 credentials,
   `MCP_SHARED_SECRET`, and the Maya sandbox key.
5. **Maya payment gateway** — investigated and sandbox-tested; no code shipped. Pick this
   up when client-facing online payment is wanted.
6. **Sentire Tax** — a standalone Generator product, if it is ever built, integrates over
   the retained OAuth2 contract in `bir-integration-spec.md`. Nothing in the Portal
   depends on it.

---

**Scope note.** This Portal is built for the firm's **own use**, deployed as two Docker
services on **Sliplane** (see `DEPLOY-SLIPLANE.md`). Still out of scope: direct e-filing to
the BIR (the XML is uploaded through eBIRForms), payment processing, and a full
double-entry general ledger.
