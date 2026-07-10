# Prompt for Claude Code

Copy everything below into Claude Code, run from the folder containing this handoff bundle (or adjust paths).

---

I have a high-fidelity design handoff for an accounting-firm SaaS portal. The bundle is in `design_handoff_accounting_portal/`:

- `README.md` — the full spec: 21 screens, design tokens, interactions, states, and data model notes. Read it first, end to end.
- `MCRC Portal Prototype.dc.html` — a working HTML prototype of every screen. Treat its inline styles as the styling spec and the `Component` class inside it as the interaction/data spec (routes, conditional UI, sample Philippine data). It is a design reference, NOT code to copy — do not reuse its runtime (`support.js`) or its floating prototype bar.
- `assets/` — MCRC logo SVGs.

## Task
Implement this as a production web app:

- **Stack**: React + TypeScript + Tailwind + shadcn/ui (Radix), TanStack Table for all data grids, Recharts for charts, React Router (or the app's existing router). If I already have a codebase open, follow its existing conventions instead.
- **Map the design tokens** from README.md into the Tailwind theme (colors, fonts: Newsreader / Hanken Grotesk / IBM Plex Mono via Google Fonts, radii, borders). No hardcoded hex values in components.
- **Build in this order**: (1) theme + shared primitives (button, input, select, chip/badge, card, table shell, page header, skeleton), (2) app shell — sidebar variant A (light) as default, top bar with client switcher, (3) auth screens, (4) firm screens 5–19 per README numbering, (5) client portal screens 20–21.
- **Multi-tenancy & roles**: mock a session layer with switchable role (firm roles: Super Admin, Manager, Accountant, Bookkeeper, Auditor; portal roles: Owner, Manager, Viewer). Sidebar sections and actions must respect the RBAC matrix in README.md.
- **Tax regime awareness is the core requirement**: every client is `VAT` or `PERCENTAGE`. The sales/expenses tables, filings list, and especially the Add-Record modal must adapt exactly as specified — keep the exact enum values (`VATABLE_12`, `ZERO_RATED`, `EXEMPT`, `NON_VAT`; `DOMESTIC_PURCHASES`, `SERVICES_NONRESIDENT`, `IMPORTATION_GOODS`, `OTHERS_WITH_INPUT_TAX`, `DOMESTIC_NO_INPUT_TAX`, `VAT_EXEMPT_IMPORTATION`, `CAPITAL_GOODS_GT_1M`; `VATABLE`, `EXEMPT`, `MIXED`) with the friendly labels from the prototype.
- **Data**: no backend yet — create a typed mock API layer (in-memory or MSW) seeded with the sample data from the prototype's `Component` class (clients, transactions, filings, invoices, users, audit rows), with simulated latency so loading skeletons are visible. Structure it so a real API can replace it.
- **States**: every list screen needs default / loading (skeleton) / empty / error variants as designed, reachable through the mock API (e.g. a dev query flag), not a debug UI.
- **Estimates vs filed**: tax computation must always be labeled ESTIMATE with the gold banner; filed BIR figures are read-only records pushed by the "BIR Form Generator" integration.
- **Accessibility**: WCAG 2.1 AA — labeled inputs, focus rings, aria on icon buttons, keyboard-navigable modal and menus.
- **Match the prototype pixel-perfectly** at desktop, and keep it usable at tablet widths (the content grids use `minmax(0,…)` + `min-width:0` guards — preserve that).

Open the prototype in a browser side by side while building and compare each screen. When done, give me a route map and a short summary of any spec ambiguities you resolved.
