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

## The one rule to remember

The Portal **summarizes**; the BIR Form Generator **computes the filing**. The Portal
classifies transactions and serves aggregates; the Generator does the authoritative BIR
tax math and pushes the filed forms back. Keep that boundary and the rest follows.
