# Handoff: MCRC Accounting Firm Portal (21 screens)

## Overview
A multi-tenant SaaS portal for **MCRC Tax and Accounting Services** (Philippine accounting firm). Two audiences share one app:

1. **Firm staff** (Super Admin, Manager, Accountant, Bookkeeper, Auditor) manage many client businesses — transactions, tax estimates, invoicing, BIR filings display, users/RBAC, integrations, audit log.
2. **Client users** (Owner, Manager, Viewer) see only their own organization via a simplified **Client Portal**.

Every client business is one of two Philippine tax regimes — **VAT** or **Percentage tax** — and the data-entry UI adapts to the regime (most importantly the Add-Record modal). The app is the system of record for transactions; an external **BIR Form Generator** integration pulls aggregates and pushes back filed forms (2550Q, 2551Q, 1701Q, 1701, 0619-E). The app **displays** filed forms and computes only an **estimate** — it never computes the authoritative tax.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working clickable prototype showing intended look and behavior, not production code to copy directly. Your task is to **recreate these designs in the target codebase's existing environment** (the intended stack is React + Tailwind + shadcn/Radix, TanStack Table for grids, Recharts for charts) using its established patterns and libraries. If no codebase exists yet, that stack is the recommended choice.

`MCRC Portal Prototype.dc.html` is the single-file prototype. It opens in a browser (with `support.js` beside it). All 21 screens, all states, and all sample data live in that one file — markup is inline-styled HTML in the `<x-dc>` template; behavior and data are in the `Component` class in the `<script data-dc-script>` block. Treat the inline styles as the styling spec and the logic class as the data/interaction spec.

**Note:** the prototype includes a floating "prototype bar" (bottom center: STATE / VIEW / SHELL toggles). This is a design-review tool only — do NOT build it in the product.

## Fidelity
**High-fidelity.** Colors, typography, spacing, copy, and interaction states are final intent. Recreate pixel-perfectly using Tailwind tokens mapped from the Design Tokens section below. The bar/line charts are illustrative statics in the prototype — implement them with Recharts bound to real data, keeping the same colors and visual style (navy income, gold expenses, beige gridlines, mono axis labels).

## Two Approved Variants
The prototype contains **two shell/dashboard variants**, toggled via the prototype bar (SHELL A/B):
- **A — Light**: cream sidebar `#fbf8f1` with navy text, gold left-bar on the active item. Dashboard uses 4 white KPI cards.
- **B — Navy**: gradient navy sidebar (`#10304f → #0e2a45 → #0b2239`), light text, gold accents. Dashboard leads with a full-width navy hero stat panel.

Implement one as default (product decision pending); keeping it themeable is a plus.

## App Shell (all authenticated screens)
- **Sidebar** 236px fixed; logo block top (shield mark + "MCRC" serif + "TAX & ACCOUNTING" mono caption); nav grouped under mono uppercase section labels (10px, letter-spacing .18em, gold `#a3781f` in light / `#c8a951` in navy). Items: 13.5px, 8px 10px padding, radius 6px, 3px left border `#c0902f` when active + tinted bg + weight 700. Bottom: signed-in user card (avatar circle navy bg / gold initials, name 13px 600, role 11.5px).
  - Firm nav: **Overview** (Dashboard, Clients) · **Client Workspace** (Client Overview, Sales & Income, Expenses, Tax Computation, Tax Rules, Billing & Invoices, BIR Filings) · **Firm Admin** (Users & Roles, Services, Integrations, Audit Log). Firm Admin is Super-Admin-only; hide items a role can't use.
  - Portal nav: **Your Business** (Home, Sales & Income, Expenses, Tax Estimate, Filed BIR Forms) · **Settings** (Users & Seats — Owner only).
- **Top bar** 60px, bg `#fffdf8`, 1px bottom border `#e4dbc9`:
  - Firm mode: **client switcher** button (mono "CLIENT" label, client name 13.5px 600 navy, regime chip, chevron) opening a 340px dropdown — search input + client rows (initials tile, name, mono TIN, regime chip); selected row tinted `#f6f2ea`. Switching client re-contextualizes the whole Client Workspace.
  - Portal mode: static client name + regime chip + outlined gold "CLIENT PORTAL" pill (no switcher).
  - Right: global search input (max 420px, placeholder "Search transactions, clients, filings…  ⌘K", bg `#f6f2ea`, focus → white + blue ring), notification bell (36px square, red dot), avatar menu (Profile & security / Preferences / Sign out).
- **Main area**: bg `#f6f2ea`, padding 30px 36px, scrollable. Two-column content grids use `grid-template-columns: minmax(0,1.9fr) minmax(0,1fr)` with `min-width:0` children (overflow guard — keep this).

## Screens

### A. Auth (split layout: left 42% navy brand panel — radial navy gradient, 52px grid-line overlay at 4.5% white, logo, italic serif tagline "Your growth, accounted for.", mono footer "CLIENT & FIRM PORTAL"; right: form on cream)
1. **Login** — "Sign in" serif 34px, email + password, "Remember this device" checkbox, "Forgot password?" link, navy submit. Submit → MFA challenge.
2. **MFA challenge** — 6 digit boxes 50×58px (filled: mono 22px; active: 2px blue border + blue ring); "Verify & continue"; links: backup code, back to sign in.
3. **MFA enrollment** — step label "FIRST-TIME SETUP · STEP 2 OF 2"; QR block 148px + manual key `JBSW Y3DP EHPK 3PXP` in mono with Copy button; note "Codes rotate every 30 seconds"; continue → challenge.
4. **Invitation accept** — blue info banner "«Inviter» invited you to join MCRC … as «Role»"; full name, password (4-segment strength meter, green segments `#1f7a4d`), confirm; footnote "Multi-factor authentication is required for all MCRC accounts." → MFA enrollment.

### B. Firm core
5. **Firm dashboard** — serif greeting + mono context line "PORTFOLIO · FY 2026 · AS OF …" + "+ Add client". Variant A: 4 KPI cards (mono gold label / serif 36px value / 12px delta). Variant B: navy hero panel (serif 52px income, dividers, gold filings count). Below: income-vs-expenses grouped bar chart (6 mo), Recent activity feed (avatar initials, text, mono time), Upcoming filings list (form chip + client + period + due pill: urgent gold `#f9ecd0/#a3781f`, normal blue `#eef3fb/#2360c8`), Regime mix bar (navy vs gold segments).
6. **Clients list** — toolbar: search (name/TIN), selects (regime, status, staff), mono count. Table columns: BUSINESS (initials tile + name + city) / TIN (mono) / REGIME chip / STATUS chip / ASSIGNED / actions (Open → client detail; ✎ → edit form). Pagination footer.
7. **Client create/edit form (BIR "Add Filer")** — max 940px, mirrors a BIR filer-registration record so a client maps 1:1 onto a Sentire taxpayer. Header row: title + segmented toggle **Individual / Non-Individual (Company)** that switches identity fields.
    - **COR upload (top, prominent)**: card with dashed dropzone "Upload BIR COR (2303) — PDF / PNG / JPG". Four states: *empty* (dropzone + "Browse files"), *uploading* (blue card, "Reading COR… 62%" + progress bar + "Extracting TIN, RDO code, and registered tax types…"), *auto-filled* (green card "Auto-filled from COR", filename, fields/tax-types count, "View current COR" link + Remove), *error* (red card "Couldn't read this COR" + Try again / Enter manually). Upload simulates → uploading → auto-filled after ~1.6s. Auto-fill pre-fills every field below and the Tax Types table; small gold mono "FROM COR" chips appear next to auto-filled field labels (Registered/Last Name, TIN, Branch, RDO, Address, Tax Types). The prototype has small state links in the card corner (prototype-only).
    - **Filer identity**: Company → Registered Name + Trade Name (optional); Individual → Last / First / Middle Name + Trade Name. Shared row: TIN (mono, `000-000-000`), Branch Code (`00000`), RDO Code, Classification (Small/Medium/Large), Citizenship. Individual only: Date of Birth + Civil Status. Company only: Taxpayer Type (Corporation/Partnership/OPC/Cooperative) + Date of Incorporation. Contact: Registered Address / City / ZIP, Email, Phone.
    - **Tax Types table** (from the COR's tax-types grid): repeating editor — Tax Type · Form (e.g. 2550Q) · Frequency (Monthly/Quarterly/Annually) · Start Date, remove per row + "+ Add tax type". This drives which BIR forms apply to the client — and the client's tax regime is derived from it (2550Q registered → **VAT**; 2551Q → **Percentage tax**).
    - **Engagement card (firm-internal)**: visually distinct — cream-gold card `#fdfaf1` border `#eadfbe`, gold "FIRM-INTERNAL" badge, note "Not part of the BIR filer profile — never exported to BIR forms." Fields: **Professional Fee** (₱ mono input) and **Billing Method** segmented control (**Quarterly · Monthly · As Filing**).
    - Footer: Cancel / Save client. Two-column on desktop, single column on tablet.
8. **Client detail** — breadcrumb; header (52px initials tile, serif name, mono TIN, regime + status chips, "Edit client"); tab bar: Overview · Sales · Expenses · Tax · Billing · Filings · Users (active = gold 2.5px underline; Sales/Expenses/Tax/Billing/Filings navigate to those screens with this client in context). Overview tab: income/expense line chart, 3 stat cards (Income/Expenses/Net YTD, net in green), navy TAX POSITION card (serif estimate + "ESTIMATE" caption, filed Q1 figure row, "Open tax computation" ghost button), Filed BIR forms mini-list. Users tab: seats summary + portal-users table (role chips: Owner gold / Manager blue / Viewer neutral) + "Invite portal user".
9. **Sales / Income list** — header shows client + mono regime note ("VAT REGIME · 2550Q QUARTERLY" or "PERCENTAGE TAX · 2551Q QUARTERLY"). Buttons: Import / Export / + Add record. Toolbar: period select, VAT-class filter (**VAT clients only**), search, mono quarter total. Columns: DATE / REF (mono blue) / CUSTOMER / CATEGORY / VAT CLASS chip / NET AMOUNT (VAT) — for Percentage clients the class column shows NON-VAT chips and the amount column is titled **GROSS RECEIPTS**.
10. **Expenses list** — same pattern; extra columns: input-VAT category chip + DEDUCT. flag (green ✓ / muted —). Percentage clients: category chip column becomes TYPE = "N/A" (input VAT not tracked).
11. **Add-Record modal (regime-aware)** — 600px, overlay `rgba(14,33,44,.45)`, sticky header (title + client + regime chip + ×) and footer (Cancel / Save & add another / Save record). Segmented Income⁄Expense toggle. Common fields: date, reference (mono), customer/supplier, category, amount (₱ prefix, mono). Amount label adapts: "Net amount (net of VAT)" (VAT) / "Gross receipts" (PCT income) / "Expense amount" (PCT expense).
    - **VAT + Income**: `VAT class` select — exact values `VATABLE_12, ZERO_RATED, EXEMPT, NON_VAT` with friendly labels ("Vatable sales — 12% (VATABLE_12)" etc.). Checkbox "Sale to government or GOCC" reveals gold info row "5% final VAT withheld by government buyer — ₱…".
    - **VAT + Expense**: `Input VAT category` select — exact values `DOMESTIC_PURCHASES, SERVICES_NONRESIDENT, IMPORTATION_GOODS, OTHERS_WITH_INPUT_TAX, DOMESTIC_NO_INPUT_TAX, VAT_EXEMPT_IMPORTATION, CAPITAL_GOODS_GT_1M`. Choosing CAPITAL_GOODS_GT_1M reveals: useful life (months) + disabled computed "Monthly amortized input VAT" + helper "spread over useful life (max 60 mo)". `Input tax attribution` select — `VATABLE, EXEMPT, MIXED`. "Deductible for income tax" checkbox.
    - **PCT + Income**: classification locked to a NON_VAT chip + explainer ("always non-VAT; 3% percentage tax via 2551Q"). No selects.
    - **PCT + Expense**: deductible checkbox + note "Input VAT is not tracked…".
    - **Live summary card** (cream, bordered) recomputes 3 lines: VAT income → Net / Output VAT (12%) / Invoice total; VAT expense → Net / Input VAT / Invoice total; PCT income → Gross receipts / Percentage tax (3%) / Net of percentage tax; PCT expense → Expense amount / Deductible portion / Recorded total.
12. **Import wizard** — 3-step stepper (numbered dots; done = ✓ navy, active = gold underline). Step 1: dashed dropzone (CSV/XLSX, expected columns, 10k row cap) + regime-specific template download. Step 2: validation preview — file chip, "212 valid" green + "2 errors" red pills; rows tinted green `#f7fbf5` (✓ dot) or red `#fdf4f2` (! dot) with an indented error line `field — message` (e.g. `date — Invalid format — expected YYYY-MM-DD…`, `vat_class — Unknown value "ZERO-RATED" — did you mean ZERO_RATED?`); Back / "Import 212 valid rows". Step 3: success check circle, "212 records imported", skipped-rows note, summary grid (total value, period, duplicates merged), Import another / View sales list.
13. **Tax Computation** — period select; **gold ESTIMATE banner**: "This computation is an in-app estimate for planning. The authoritative figure comes from the BIR Form Generator when the return is filed." Ledger card: Gross income − Deductions = Taxable income (bold), graduated brackets applied line-items, "Estimated tax due" with serif 34px figure. Right rail: navy FILED card (1701Q figure, filed date, "Accepted by eFPS", estimate-vs-filed variance) + Assumptions card + "Configure tax rules →".
14. **Tax Rules** — 4 method radio cards: **Graduated / Flat rate / Percentage / Simplified 8%** (selected = navy border). Graduated → bracket editor table (OVER / NOT OVER / BASE TAX / RATE % inputs per row, remove buttons, "+ Add bracket", "Reset to TRAIN defaults", Save). Other methods → single rate input with helper text.
15. **Billing / Invoices** — 3 views. List: table (INVOICE mono / DESCRIPTION / ISSUED / DUE / AMOUNT / STATUS chip: Paid green, Sent blue, Overdue red, Draft neutral / Send + PDF actions) + "New invoice". Create: **Bill to is a type-to-search combobox** (search icon + chevron; typing filters clients by name or TIN, dropdown rows show initials tile / name / mono TIN / regime chip; empty result offers "add a new client"), invoice/due dates, LINE ITEMS editable grid (desc/qty/rate/amount, add/remove), totals block (Subtotal, VAT 12%, Total due), Cancel / Save draft / "Preview & send →". Email preview: From `MCRC Billing <billing@mcrc.ph>` / To / Subject rows, then a rendered branded email (navy header w/ logo, "AMOUNT DUE" panel with serif figure, navy CTA button, engagement-lead footer); Back to edit / Send email.
16. **BIR Filings** — per current client, filterable by form. Columns: FORM chip / PERIOD / FILED / REFERENCE (mono, EFPS-…) / STATUS chip (Accepted green, Amended gold) / XML + PDF download buttons. Forms differ by regime (2550Q vs 2551Q).
17. **Users & RBAC** (Super Admin) — firm users table (USER / EMAIL / ROLE chip — Super Admin gold, others blue / MFA: Enrolled green, Pending gold / STATUS / Edit) + "Invite user". Below: **Roles & permissions matrix** — rows (Manage firm users & roles, Create/edit clients, Enter & edit transactions, Approve imports, Configure tax rules, Send invoices, View audit log, Manage integrations) × columns (Super Admin, Manager, Accountant, Bookkeeper, Auditor); ✓ green `#1f7a4d`, — muted `#c9bfa9`. See prototype for the exact matrix values.
18. **Integration credentials** — OAuth2 client cards. Primary: "BIR Form Generator" (Active chip, last-used caption), CLIENT KEY mono + Copy, CLIENT SECRET masked with **"Reveal once"** → gold-tinted revealed value + "Shown once — store it now", GRANTED SCOPES chips (`aggregates:read`, `filings:write`, `clients:read`), Rotate secret / Revoke access (red). Secondary disabled card ("Payroll Sync (staging)").
19a. **Services** (Firm Admin) — the firm's service catalog used to seed invoices/engagements. Table: SERVICE / DESCRIPTION / DEFAULT FEE (mono, right-aligned) / BILLING chip (Monthly blue, Quarterly gold, As Filing green) / STATUS (Active/Retired) / Edit; "+ Add service". Footer note: fees seed the client Engagement card and invoice line items, overridable per client. **Add Service modal** (520px): service name, description textarea, default fee (₱ mono) + Billing method segmented (Quarterly · Monthly · As Filing), optional Linked BIR form select (None/2550Q/2551Q/1701Q/1701/0619-E) — when billing is "As Filing" a gold hint explains it bills automatically each time the linked form is filed — and an "Active" checkbox. Cancel / Save service.
19. **Audit log** — filter bar (actor / action / entity selects, date range, Export CSV). Columns: TIMESTAMP (mono `YYYY-MM-DD HH:mm:ss`) / ACTOR / ACTION chip (create green, update blue, delete red, login neutral, export gold) / ENTITY / IP (mono). Immutable; include integration actors (BIR Form Generator).

### C. Client Portal
20. **Portal home** — greeting ("Magandang hapon, Ramon."), 3 stat cards (Income, Expenses, navy "ESTIMATED TAX · prepared by your MCRC team"), trend chart, Filed BIR forms list.
21. **Portal sales** — entry enabled: "+ Add record" + blue banner "Direct entry is enabled for your organization. Records you add are reviewed by MCRC before filing." **Portal expenses** — read-only ("VIEW ONLY" pill, no actions). **Portal tax estimate** — read-only ledger + ESTIMATE banner + engagement-lead contact line. **Portal filings** — PDF downloads only. **Users & Seats** (Owner only) — seat meter "3 of 5 seats used" (min 3), Request more seats, users table + Invite, role legend (Owner / Manager / Viewer).

## Interactions & Behavior
- Routing: auth → shell; sidebar + breadcrumbs + tab bar navigate; client switcher swaps workspace context (data, regime-conditional columns, filings set).
- Modal opens from Sales (income default) / Expenses (expense default) / Portal sales; Escape/×/Cancel close; regime + type drive conditional sections and the live summary (see #11).
- Import wizard is linear with back navigation; commit only imports valid rows.
- Billing: list ⇄ create ⇄ email preview; Send returns to list.
- Reveal-once secret: irreversible in-session; server should only return the secret at creation/rotation.
- Sign out (avatar menu) → login.
- Hover states throughout: rows tint `#fbf8f1`; outlined buttons darken border to navy; primary navy buttons → `#15395d`; links `#2360c8` → `#15395d` underline.
- Screen entrance: 300ms fade + 6px rise (`opacity 0→1, translateY(6px)→0`); dropdowns/modal 180ms fade.
- **Every list screen has 4 states**: default, **loading** (shimmer skeleton rows — gradient `#ece4d2→#f5efe2`, 1.4s linear loop), **empty** (serif headline + helper + CTA(s); dashboard empty uses a dashed-border card with faded logo), **error** (red !-circle, serif headline, cause line, Retry). Dashboard error is an inline banner.
- Accessibility: WCAG 2.1 AA — visible focus rings (blue `rgba(35,96,200,.12-.14)` 3px), labeled inputs, aria-labels on icon buttons, ≥4.5:1 text contrast. Responsive desktop + tablet; keep the `min-width:0` grid guards.

## State Management
- Session: user, firm role, MFA status; portal users scoped to one org.
- Global: active client id (firm), regime derived from client; drives conditional UI everywhere.
- Per-screen: list filters/pagination/loading/error; modal (open, type, vatClass, inputCat, attribution, saleToGov, capital-goods fields); import step + validation results; billing view mode; tax method + brackets; revealed-secret flag.
- Data fetching: lists per client + period; dashboard aggregates; filings pushed by integration (read-only); estimates computed server-side from tax rules.

## Design Tokens
**Colors**
- Ink `#16212c` · Navy (primary) `#0e2a45` · Navy hover `#15395d` · Navy hero gradient `radial-gradient(120% 100% at 20% 0%, #1a4570, #0e2a45 62%)`
- Blue accent (links/active/focus) `#2360c8` · Light blue `#8fbbe8` / `#8fa4ba` / `#9fb2c6` (on-navy secondary text)
- Gold `#c0902f` · Gold deep `#a3781f` · Gold soft `#e6c87c` / `#c8a951`
- Paper (app bg) `#f6f2ea` · Sidebar cream `#fbf8f1` · Topbar `#fffdf8` · Card `#ffffff` · Borders `#e4dbc9` (strong) / `#efe8d8`, `#f2ecdf` (row dividers) · Input border `#d8cfbd`
- Text secondary `#5b6976` · `#3c4855` · muted `#8a94a0` · placeholder `#a5ad98`
- Success `#1f7a4d` on `#e3f0e8` · Error `#b3372f` on `#faf0ee`/`#fdf4f2` (dark text `#7c2620`) · Warn `#a3781f` on `#f9ecd0`/`#f9f4e6` · Info `#2360c8` on `#eef3fb` · Neutral chip `#5b6976` on `#eee9dd` · VAT chip `#15395d` on `#e7eef6`

**Typography** (Google Fonts)
- Headings / big figures: **Newsreader** serif, weight 500, letter-spacing −.01em — page titles 30px, modal titles 21px, KPI values 27–36px, hero 52px, empty-state 21–26px
- UI / body: **Hanken Grotesk** — body 13–14.5px, buttons 13–13.5px/600, labels 12.5–13px/600
- Data / labels: **IBM Plex Mono** — TINs, refs, amounts, timestamps 11.5–13px; section eyebrows 9.5–11px uppercase, letter-spacing .14–.24em

**Spacing & shape**: cards radius 10px pad 20–26px; modal radius 14px; buttons radius 7px, pad 10px 16px; inputs radius 6px, pad 9–11px; chips fully rounded (99px), mono 10px; table rows pad 13px 20px; column-header rows: bg `#fbf8f1`, mono 10px, letter-spacing .14em. Shadows only on overlays: dropdown `0 16px 40px rgba(14,33,44,.16)`, modal `0 32px 80px rgba(0,0,0,.35)`. No card shadows — 1px borders only.

**Currency**: `₱1,234,567.00`, always mono, right-aligned in tables.

## Assets
- `assets/MCRC-mark-color.svg` — shield mark (navy shield, gold triple-chevron) for light backgrounds
- `assets/MCRC-mark-mono-white.svg` — mark for navy backgrounds
- `assets/MCRC-lockup-horizontal.svg` — full lockup (marketing/email use)
- The prototype also inlines the mark as SVG paths (see any `<svg viewBox="0 0 120 120">` in the prototype) — either approach is fine.
- All other icons (search, bell, chevrons, checks, upload) are simple inline SVG strokes; replace with the codebase's icon set (e.g. lucide) at matched sizes.

## Files
- `MCRC Portal Prototype.dc.html` — the full 21-screen prototype (open in a browser with `support.js` in the same folder). Template = markup/styling spec; `Component` class = data, routing, and interaction spec, including all sample Philippine data (clients, TINs, transactions, filings, users, audit entries).
- `support.js` — prototype runtime only; not part of the product.
- `PROMPT.md` — a ready-to-paste prompt for Claude Code.
