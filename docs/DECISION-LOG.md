# Decision log

Append-only. Entries are added, never edited or deleted. Old entries stay as written even when later entries supersede them. This file is the sanctioned keep-both-sides merge file: every merge between tracks conflicts here, and the resolution is always to keep both sides in date order.

## 2026-09-08 · D0 · This log
Created in U1 on Track A. Decisions come from the domain owner; the technical partner records them; Claude Code does not change them.

## 2026-09-08 · D1 · What closes a period
Decision: marking a BIR form filed closes the period it covers, for that client.
Consequence: transactions that feed a filed form are locked from edit and delete. The correction path is an amended filing (D3). Whether one filing locks the whole period for every tax type, or only the figures of that form, is decided after U1 reports how forms reference transactions.

## 2026-09-08 · D2 · What the billing is
Decision: the Portal's billing is an internal statement of account. It is not the firm's BIR-registered invoice.
Consequence: BillingCounter is not a BIR series and need not be gapless. Edit-reverts-to-Draft on a Sent billing stands. Paid remains terminal, and a Paid billing needs a snapshot of what was issued.

## 2026-09-08 · D3 · Amended returns
Decision: an amended return is a new filing. The original filing is kept, unchanged.
Consequence: the filing key becomes (client, form, period, sequence). Guardrail #4 in docs/BUILD-PLAN.md ("upsert, never duplicate") is amended when this is implemented: idempotent for the same filing, never overwriting a different one. docs/bir-integration-spec.md changes with it; that contract has no external consumer yet.

## 2026-09-08 · D4 · Who Claude is when it writes through MCP
Decision: MCP runs as one firm identity with Super Admin rights. The shared secret stays.
Consequence: audit rows attribute MCP writes to "Claude (MCP)", not to a person. This is an accepted limit. The control is who holds the URL, and rotating it.

## 2026-09-08 · D5 · TaxRule rates and brackets
Decision: statute. Locked. No form and no API edits them. A change arrives as a seed or migration that names the authority and the effective date, and already-issued records keep the rate that applied when they were issued.
Open: whether a client's elections (8% or graduated, OSD or itemized) stay editable. The technical partner reads yes; the domain owner confirms.

## 2026-09-08 · D6 · Production data
Decision: the live database holds real client data.
Consequence: every migration is additive; no column drops, no data rewrites; a backup precedes every deploy that migrates; development never points at production.

## 2026-09-08 · D7 · Tracks
Decision: two tracks. Track A owns apps/api, prisma, packages/shared and is the only track that changes the schema. Track B owns apps/web. Units are numbered U1, U2… on Track A and W1, W2… on Track B; a number is never reused and fixes become amendments. Test files carry the prefix track-a- or track-b-. Track B never starts the API. Both tracks run as cloud sessions and push their branch at the end of every unit.
