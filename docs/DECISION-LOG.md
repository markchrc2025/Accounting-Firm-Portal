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

## 2026-09-08 · D8 · The filing record
Decision (technical partner): the internal filing record is BirForm (status, filedAt). BIRFiling and the OAuth2 receiver that writes it have no consumer and are frozen — not changed, not deleted — until one exists. Seal, amendment and snapshot rules apply to BirForm.
Reason: U1 A4 showed the two are disconnected and only BirForm is used.

## 2026-09-08 · D9 · Root files
Decision: Track A owns CLAUDE.md, .github/workflows/ci.yml and scripts/. Track B never edits them.

## 2026-09-08 · D10 · apps/portal
Decision: frozen, owned by no track, pending the domain owner's ruling on what it is.

## 2026-09-08 · C1 · Corrections to the record, from U1
docs/BUILD-PLAN.md is wrong in five places and is left as written: 32 migrations, not 33; four workspaces (apps/portal exists), not three; the parity specs pin structure, row count and filename against hand-written literals, not values against a real export; per-client assignment scope is checked only on routes carrying a :clientId parameter; no internal path writes BIRFiling. Source: U1 report, commit 2a03073.

## 2026-10-09 · D23 · Expenses of a client who is not VAT-registered
Decision: the gross amount is the expense; the VAT shown on the receipt is kept on the record as a non-claimable figure. The treatment is stamped on the record at import (vatClaimable) and does not change if the client's regime later changes.

## 2026-10-09 · D24 · Mixed receipts
Decision: one row per receipt with the breakdown (vatable, VAT, exempt, zero-rated, other non-vatable, gross); the importer splits the row into one record per treatment, all sharing the reference number, date, vendor and source file; the parts must foot to the gross within 0.01 or the row is rejected.

## 2026-10-09 · D25 · Documents that are not official invoices
Decision: recorded, marked by document type, and held unposted until an accountant decides what it is. Held rows are excluded from every total, estimate and report.

## 2026-10-09 · D26 · Personal and non-deductible purchases
Decision: one named account on the client's chart, marked on the COA sheet of the template.

## 2026-10-09 · D27 · Rows that need review
Decision: posted, with the flag and the remarks kept on the record.

## 2026-10-09 · D28 · A receipt with no vendor TIN
Decision: allowed; the row is flagged for review.

## 2026-10-09 · D29 · Withholding columns on the expense template
Decision: ATC and Withholding Amount stay as optional columns; the instructions say to leave them blank for clients who do not withhold.

## 2026-10-09 · D30 · Order
Decision: U6 runs before U3 pass 2 because an encoder is waiting on it. The seal is unaffected.

## 2026-10-09 · D31 · Where the import lives
Decision (technical partner): the Expenses import template is generated by the API and an uploaded file is parsed and validated by the API; the browser downloads, uploads and shows the result. U6 and Track B's W5 reach main in that order. Technical rulings standing with it: a blank account holds the row; Date is required and inside the declared period; Reference Number is required for invoice document types; TIN stored as nine digits plus a five-digit branch; duplicates per R6 of U6; sample rows only on the Instructions sheet.

## 2026-10-09 · D32 · Who merges
Decision: a unit's Claude Code session opens the pull request for its branch and squash-merges it as soon as every check is green, unless the unit's prompt says the merge waits for a paired unit. The domain owner no longer merges by hand. Record: #125 (U1–U2) and #126 (W2) were opened from the domain owner's browser by the technical partner and merged by the domain owner on 2026-10-09; before that, no pull request had been opened from either track.

## 2026-10-09 · C3 · Corrections to the record, from U6 pass 1
U1 knew the import parser lived in apps/web and did not say the import straddled the track boundary set by D7; the Phase 3 divergence was framed as "synchronous, no queue" when the fact that decides ownership is that the API has no file endpoint. The Sales import template labels its customer columns "Vendor TIN" and "Vendor Name" (spreadsheet.ts:11-12); left for Track B.

## 2026-10-10 · D33 · Backups before a migration deploys (interim)
Decision (technical partner, interim until the domain owner names where the production backup is taken): a unit whose pull request carries a migration opens the pull request and waits for green checks, then stops before merging; the merge follows a confirmed backup. A unit without a migration merges itself (D32). U6's #127 merged with a migration and no confirmed backup; the migration was additive and nothing was lost.

## 2026-10-10 · D34 · Expense list filters, firm-only import, server-owned fields
Decision (technical partner): the expense list honours status and needsReview as optional filters; the import template, the import and posting a held row are firm actions, refused to client-side principals with 403; status, needsReview, vatClaimable, importBatchId and sourceFile are server-owned and no edit can set them. Source: Track B's W5 report (F21, F22, F24).

## 2026-10-10 · C4 · Corrections to the record, from U6 pass 3 and W5 pass 2
U6's M2 poll loop never parsed a response (a backslash inside an f-string) and exited 0 after twenty silent polls; the merge decision was taken on a later, correct fetch. The seed has no client, so U6's T6 "seeded client" was an invented client under the seeded firm. W5's adversarial review had one skeptic read origin/track-a against W5's R1; nothing from it was used.
\n
## 2026-10-10 · D35 · Document type decides nothing (reverses D25)
Decision: every row that passes the row rules posts, whatever its document type. Most clients do not receive formal invoices; what the team records is what it records. Document Type is an optional label on the row. A row is held only when it has no account (technical rule from U6). A row with no vendor TIN posts flagged for review (D27, D28). Built in U6-A2.

## 2026-10-10 · D36 · No personal or non-deductible account (reverses D26)
Decision: every receipt a client submits is a business receipt, filtered by the owner before it reaches the team. The importer marks no account as personal and stamps nothing non-deductible; every imported row is deductible. Built in U6-A2.

## 2026-10-10 · D37 · Reference number is optional
Decision (technical partner): a row without a reference number posts; duplicates for such rows are detected on vendor TIN, date and gross (U6 R6). Nothing is flagged for a missing reference.
