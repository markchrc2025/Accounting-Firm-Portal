# @portal/projects-core

Pure helpers for the Projects module. TypeScript only: no database, no network, no Nest. The
only Node API used is `node:crypto` (HMAC and SHA-256). Later phases call these from the API.

Behaviour comes from the owner's Sentire Projects (`src/server/services/importer.ts`,
`github.ts`, `audits.ts`, `src/lib/keys.ts`) and from the security-audit skill it vendors, which
is the public Cloudflare skill (MIT). Where this package differs from Sentire Projects, the
difference is listed under "Decisions" below.

```ts
import {
  parseChecklist,
  extractIssueKeys,
  closingKeys,
  verifyGithubSignature,
  parseFindings,
  mapFinding,
  mapFindings,
  fingerprint,
  summariseAudit,
} from "@portal/projects-core";
```

## Markdown import: `parseChecklist(markdown, { headingsAsMilestones })`

```ts
parseChecklist(markdown: string, options?: { headingsAsMilestones?: boolean }): {
  milestones: string[];
  items: { title: string; closed: boolean; labels: string[]; description: string; milestone: string | null }[];
  warnings: string[];
};
```

- `- [ ] text` is an open item, `- [x]` and `- [X]` closed. `-`, `*` and `+` bullets all work.
- Every `#word` becomes a label (lower case, no `#`, no duplicates) and is removed from the title.
  A label is a letter then letters, digits, `_` or `-`, 2 to 31 characters, after whitespace or at
  the start. Not labels: `C#`, `#123`, `https://x/page#top`, anything inside a `code span`.
- `**` bold marks are removed from the title; other markdown is kept.
- Indented bullets (2 or more spaces; a tab counts as 2) under an item are its description. They are
  kept as written, task boxes and nesting included, with the indent they all share removed.
  Prose under an item is not read.
- A heading (`#` to `######`) is a milestone when `headingsAsMilestones` is true. Items under it
  belong to it; items before the first heading have `milestone: null`. Headings that differ only in
  case are one milestone (first spelling kept). A milestone appears in `milestones` only if it holds
  an item. With the option off, headings are ignored.
- Fenced code blocks are skipped whole.
- More than 500 items throws `ChecklistError`: "That is more than 500 items. Split the import into
  smaller lists." Exactly 500 is fine. Lines that are skipped or cut are reported in `warnings`
  (an item that is only labels, an indented bullet with nothing above it, a title or heading over
  250 characters, no items at all).

## Issue keys: `extractIssueKeys(text, options?)` and `closingKeys(text, options?)`

An issue key is 2 to 10 capital letters or digits starting with a letter, a dash, and a number of
1 to 7 digits with no leading zero: `PAY-12`, `A1-300`. Both functions return unique keys in order
of first appearance.

```ts
interface KeyOptions {
  ignoreCase?: boolean; // accept pay-12 and Pay-12, return PAY-12. Off by default.
  projectKeys?: readonly string[]; // only these projects' keys; replaces the built-in look-alike list
}
```

### Edge cases (each has a test)

| Text | Result | Why |
| --- | --- | --- |
| `feature/PAY-12-add-login`, `feature-PAY-12-x`, `(PAY-3)`, `PAY-4.` at a sentence end | key | the places keys really appear |
| `pay-12`, `Pay-12`, `explain-3`, `utf-8` | not a key | capitals only, unless `ignoreCase` |
| `xPAY-12`, `PAY-12x`, `PAY-12_a`, `9PAY-1`, `ABCDEFGHIJK-1` | not a key | inside a longer word, or a prefix over 10 characters |
| `PAY-0`, `PAY-007`, `PAY-12345678` | not a key | numbers start at 1, no leading zero, at most 7 digits |
| `CVE-2024-1234`, `ABC-12-34` | not a key | a key followed by `-` and a digit is part of a longer number |
| `ABC-1.5`, `PAY-12.md`, `PAY-12.example.com` | not a key | followed by `.` and a letter or digit: a version, file or host |
| `ABC-12@mail.test`, `x@ABC-12.test` | not a key | e-mail address |
| `ISO-IEC-27001`, `X-AB-12` | not a key | preceded by a capital or digit and a dash: a hyphenated name |
| `UTF-8`, `SHA-256`, `ISO-8601`, `COVID-19`, `CWE-79`, `RFC-2119`, `UTC-8`, `MD-5` | not a key | built-in look-alike prefixes (`LOOKALIKE_PREFIXES`), unless `projectKeys` is given |
| `https://t.example/browse/PAY-12`, `.../PAY-12/slug`, `.../PAY-12?x=1`, `.../PAY-12#top` | key | in a link, a whole path segment counts |
| `https://x/files/PAY-12.pdf`, `https://x/PAY-12-slug`, `?ref=PAY-12`, `#PAY-12`, host name | not a key | in a link, anything but a whole path segment does not |

A key that is a real project key but looks like a standard (a project called `ISO`) needs
`projectKeys: ["ISO"]`; when that list is given it is the only authority.

### Closing keywords

`closingKeys` returns the keys that follow a closing keyword: a keyword, an optional colon, spaces
or tabs, then a key. The key rules above apply.

- Accepted words, any case: `close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`,
  `resolves`, `resolved`. The assignment named `fixes`, `closes` and `resolves`; **the other six are also
  accepted** because GitHub's own list has all nine (docs: "Linking a pull request to an issue") and
  Sentire Projects accepts all nine, so a message that closes an issue on GitHub closes it here.
  Exported as `CLOSING_KEYWORDS`.
- One keyword covers a list on the same line: `fixes PAY-1, PAY-2 and PAY-3`, `closes PAY-1 & PAY-2`,
  `fixes PAY-1 PAY-2`. GitHub itself needs a keyword before each reference; this follows Sentire
  Projects, where `closes PAY-3, PAY-4` closes both.
- A list ends at a full stop, a semicolon, a new line or any other word (`Fixes PAY-1 and also PAY-2`
  closes only `PAY-1`).
- The keyword must stand alone (`prefixes PAY-1`, `unresolved PAY-1` and `fixing PAY-1` do not close).
  The key must be on the same line as the keyword.
- Not detected: a negation such as "does not fix PAY-1".
- Whether to act on a closing keyword (only for a merged pull request, only the default branch) is the
  caller's rule, as in Sentire Projects.

## Webhook signature: `verifyGithubSignature(rawBody, header, secret)`

```ts
verifyGithubSignature(rawBody: Uint8Array, header: string | string[] | null | undefined, secret: string | Uint8Array): boolean
```

Checks `X-Hub-Signature-256` (`sha256=` and 64 hex digits, HMAC-SHA-256 of the raw bytes) with
`timingSafeEqual`. False, never an exception, for: a missing, empty or repeated header; no
`sha256=` prefix (including the old `sha1=` header); a wrong length or non-hex digits; spaces around
the value; an empty secret (it would sign anything); a body that is not bytes; a wrong secret or body.
Pass the body exactly as it arrived: a re-serialised object does not verify. Upper-case hex is accepted.

## Security audit

Source of the shapes: `report-schema.json` of the skill. The fields relied on:

| Field | Used for |
| --- | --- |
| every record: `verdict` (`confirmed`, `needs_validation`, `rejected`), `fingerprint`, `title`, `description` | state, identity, issue title, first paragraph |
| `trace[]` (`kind`, `file`, `line`, `scope`, `description`), `evidence[]` (`file`, `line`, `description`) | Trace and Evidence sections; the fingerprint anchor when a record has none |
| confirmed: `root_cause`, `intended_behavior`, `conditions[]`, `execution` (`attacker_perspective`, `payloads[]`, `instructions[]`, `observed_result`), `remediation` (`strategy`, `code_changes[]` with `file_name`, `fixed_code`), `severity.overall_severity` (`likelihood`, `impact` with `score`, `reason`), `confidence` | Bug description, labels, priority |
| needs_validation: `claimed_root_cause`, `blockers[]`, `validation_plan` (`local`, `deployment`) | Task description |
| rejected: `reason` | stored on the audit record |
| `run-metadata.json`: `run_id`, `source_ref` (the commit), `profile`, `scope_paths`, `run_status`, `incomplete_reason` | `summariseAudit` |
| `coverage-ledger.json`: each unit's `status` | `summariseAudit` coverage counts |

`execution.instructions` is an array of steps in the schema; Sentire Projects reads it as a string and
so drops it. Both forms are read here.

- `parseFindings(input)`: the array or the text of findings.json. Checks what the mapping needs (an array of at
  most 1000 objects, known verdict, a fingerprint matching the skill's pattern and unique in the file, a
  title, a known `overall_severity` on a confirmed record) and throws `AuditImportError` with a sentence.
  The skill's own `validate-findings.cjs` checks the rest of the schema.
- `mapFinding(finding, { runId?, commit? })`:
  - confirmed: type `Bug`, labels `["security", "sev-<severity>"]`, priority critical `URGENT`, high `HIGH`,
    medium `NORMAL`, low and informational `LOW`;
  - needs_validation: type `Task`, labels `["security", "needs-validation"]`, no severity, priority `NORMAL`;
  - rejected: `{ kind: "rejected", fingerprint, title, reason }`, no issue.
  The description is markdown with only the sections the finding has: the finding's own text, severity and
  confidence, Root cause, Intended behaviour, Trace, Evidence, Conditions, Reproduction, Fix (or, for a
  lead: Claimed root cause, Trace, Evidence, Blockers, How to resolve). Lists stop at 40 entries, the whole
  description at 60,000 characters, the title at 250.
- `mapFindings(findings, context)`: the same for a whole file, as `{ issues, rejected }`.
- `fingerprint(finding)` and the rule: **the skill's own `fingerprint` field is the identity** and is returned
  unchanged. The schema defines it as "a stable source-derived identifier that does not change between
  validation states", and the skill's rules require the same root cause to keep it in every state and on every
  re-run (VALIDATION-AND-REPORTING.md). It never reads a line number, so moved code does not change it.
  Only a record with no fingerprint gets one made: `sha256:` plus the SHA-256 of its sorted, de-duplicated
  trace anchors `kind|file|scope` (file path normalised, no line number). No trace falls back to the
  evidence files, then to the lower-cased title. A fingerprint that is present but malformed throws, because
  inventing a new identity would split one issue in two.
- `summariseAudit(findingsJson, { run?, ledger?, coverage? })`: findings.json has no run information, so the
  run metadata and ledger come as a second argument. Returns `runId`, `commit`, `profile`, `scope`,
  `status` (`complete` or `incomplete`), `incompleteReason`, `partial`, `coverage` (units by status) and
  `findings` (`total`, `confirmed`, `needsValidation`, `rejected`, `bySeverity`). `coverageCounts(ledger)` is
  exported. `partial` is true for a quick run, a scoped run or an incomplete run: such a run not reporting a
  finding is not evidence that it was fixed.

## Repo kit: `repoKit({ projectKey, serverUrl, tokenEnvVar })`

```ts
repoKit(input: { projectKey: string; serverUrl: string; tokenEnvVar: string }): { path: string; content: string }[]
applyClaudeMdBlock(existing: string | undefined, block: string): string
claudeMdBlock(projectKey: string): string
```

Returns the five files a code repository needs so Claude Code works with the Portal's Projects
module. Write each at its path. For `CLAUDE.md` use `applyClaudeMdBlock`, because most repositories have
one: it adds the block at the end, or replaces the one between the markers, and never touches the text
outside them.

| Path                                                | What it is                                                                                                                                                                                                                                   |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.sentire-projects.json`                            | `{ "project": "PAY", "server": "https://portal.example.test" }`. Same name and shape Sentire Projects uses (its hook, its MCP instructions and its CLAUDE.md snippet all read it), so a repository that has one only changes `server`.        |
| `.mcp.json`                                         | One HTTP server, `portal-projects`, at `<server>/api/v1/projects/mcp`, with `Authorization: Bearer ${TOKEN_VAR}`. Claude Code reads the variable at run time; the token is never written.                                                    |
| `.claude/settings.json`                             | A `SessionStart` hook that runs the script below (15 second timeout).                                                                                                                                                                        |
| `.claude/hooks/portal-projects-session-start.mjs`   | Node, no dependency. Starts a work session (`POST <server>/api/v1/projects/sessions/start?briefing=1` with `{ "project_key" }`, header `Authorization: Bearer <token>`), prints the session id and the briefing. Fails quietly. See below. |
| `CLAUDE.md`                                         | The managed block, between `<!-- BEGIN portal-projects ... -->` and `<!-- END portal-projects -->`: start a session, keep issues current, keys in branches, commits and PR titles, `fixes KEY` in PR bodies, end the session with a summary and next steps. |

The hook follows Sentire Projects' kit (`kit/.claude/hooks/sentire-session-start.mjs`): it reads
`.sentire-projects.json`, does nothing if there is none, says the session is not tracked if the token variable
is not set, skips the `compact` restart (resume and clear start a session again), and prints a sentence instead
of failing if the server answers an error or cannot be reached. Tests run the generated script against a
local server.

Inputs are checked and refused with a sentence: the project key (2 to 10 capital letters or digits, starting
with a letter); `tokenEnvVar` must be a variable NAME in capitals, digits and underscores (a token such as
`spk_abc` is refused); `serverUrl` must be an `https://` origin with no path, query, fragment or user name
(`http://` only for localhost). A trailing slash is dropped.

## Sentire Projects import: `mapSentireExport(exportJson)` and `validateImportPlan(plan)`

```ts
mapSentireExport(exportJson: unknown): ImportPlan            // throws SentireExportError for a non-export
validateImportPlan(plan: unknown, o?: { maxMessages?: number }): string[]   // plain sentences; [] means ready
```

Sentire Projects has no export of its own, so the input format is defined here: the tables of its
`src/db/schema.ts` as arrays of rows (`projects`, `statusUpdates`, `milestones`, `issueTypes`, `statuses`,
`issues`, `labels`, `issueLabels`, `comments`, `activities`, `workSessions`, `githubLinks`, `securityAudits`,
`users`, `organizations`), at the top level or under `tables`; table and column names camelCase or SQL
snake_case; dates as ISO text or `Date`. For `users` only `id`, `name` and `email` are read, so leave the rest out.
`notifications`, `apiTokens` and `sessions` (logins) are never read. An export script on the Sentire side is
not part of this package.

The plan (`format: "portal-projects-import-plan"`, `version: 1`) has these lists, to be applied in the order of
`applyOrder`: `projects`, `issueTypes`, `statuses`, `labels`, `milestones`, `issues`, `comments`,
`statusUpdates`, `sessions`, `activities`, `githubLinks`, `securityAudits` (and `people`, the e-mail list that
people are matched by). Also `counts`, `warnings` and `unmapped`.

- Every reference is by key or name: project key, issue key, type and status and milestone and label name, a
  person's e-mail (lower case). No Sentire id appears. The one made-up label is a work session's `ref`
  (`PAY#1`, in start order), because a session has no natural key.
- Issues keep their key and number, and are sorted so a parent comes before its children (also across
  projects). A project's `issueCounter` is at least its highest issue number.
- Values are in the Portal's words: priorities `LOW` to `URGENT`, project statuses `NOT_STARTED` to `FINISHED`,
  status categories `TODO`, `IN_PROGRESS`, `DONE`, milestone states `OPEN`, `LOCKED`, `CLOSED`, actors `USER`,
  `CLAUDE`, `GITHUB`, `SYSTEM`; activity changes as `[{ field, old, new }]`; a project's `archived` flag.
- A project's current status comes from its latest status update in the Portal. When the history does not end
  with the current status (or there is none), one status update by `SYSTEM` is added, dated at the project's last
  change, and a warning says so.
- Rows whose parent is missing are left out, or have the link emptied, and a sentence in `warnings` says how
  many (and names up to five). Duplicate keys and numbers are NOT repaired: they stay in the plan so
  `validateImportPlan` reports them.
- Passwords and token hashes are never read. A plan that holds one is refused by the validator.

`validateImportPlan` returns one sentence per problem, at most `maxMessages` (default 100, then "And N more
problems."). It checks: format and version; project keys valid, unique, parents present, no loops; issue types,
statuses and labels unique by name (case folded), `#rrggbb` colours, valid status categories, exactly one
default status; milestones unique per project, valid state, start not after due; issue keys valid and unique,
numbers whole, unique per project and equal to the key, project, type, status, priority, milestone and labels
present, assignee and author in the people list, parents present and no loops; the same for what comments,
status updates, sessions, activity, GitHub links and audits point to; every date a real calendar date or time
(`2026-02-30` is refused); counters not below the highest number.

### Sentire Projects fields that cannot be mapped

The same list is in every plan as `unmapped` (exported as `UNMAPPED_SENTIRE_FIELDS`). "Carried" means the plan
holds the value for a later phase, but the Portal's PA1 tables have no place for it today.

| Sentire Projects field                                                  | Why                                                                                                                         |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `organizations`                                                         | The import goes into the firm that runs it.                                                                                 |
| `users.passwordHash`                                                    | A secret; never read.                                                                                                       |
| `users.role` (owner, member, viewer)                                    | Portal permissions are `Projects:*` grants on Portal roles; no automatic mapping.                                           |
| `users.createdAt`, `lastLoginAt`, `disabledAt`, `users.id`              | Portal users are separate accounts, matched by e-mail.                                                                      |
| `sessions` (logins)                                                     | Temporary, tied to its cookies.                                                                                             |
| `apiTokens`                                                             | Hashes are secrets and the tokens do not work on the Portal; issue new ones.                                                |
| `notifications`                                                         | The Portal has no notifications table yet.                                                                                  |
| `projects.archivedAt`                                                   | The Portal has an archived flag only; the time is lost.                                                                     |
| `issues.deletedAt`                                                      | The Portal has a deleted flag only; the time is lost. Deleted issues are imported so their numbers stay used.               |
| `issues.fingerprint`                                                    | No column yet. Carried, so the security-audit phase can match re-imports.                                                   |
| `milestones.closedAt`                                                   | The Portal's milestone has no closing time.                                                                                 |
| `comments.actorKind`, `comments.sessionId`                              | The Portal's comment has neither yet. Carried.                                                                              |
| `activities.client`                                                     | The Portal records a channel instead; worked out from the actor type (github, system, mcp for Claude, web for users). Carried. |
| `activities` with no project                                            | The Portal's activity log needs a project; left out and counted in `warnings`.                                              |
| `workSessions`, `githubLinks`, `securityAudits`                         | No tables in the Portal yet. Carried whole.                                                                                 |
| `projects.status`, `projects.statusNote`                                | The Portal derives status from the latest update; see the added update above.                                               |

## Decisions that were not given

1. **Key case.** Capitals only by default (the task says "capital letters"). Sentire Projects upper-cases the text
   first, so `pay-12` is a key there; here that is `ignoreCase: true`.
2. **Look-alike prefixes.** A built-in list (`UTF`, `SHA`, `ISO`, `COVID`, `CWE`, ...) is skipped; `projectKeys` replaces it.
3. **Numbers** start at 1 with no leading zero (`PAY-007` is not a key; Sentire Projects reads it as 7).
4. **Link rule** (whole path segment only) and the other edge cases in the table.
5. **Closing keywords**: all nine, lists on one line, no crossing of new lines (Sentire Projects lets `\s` cross a line).
6. **Checklist**: fenced code is skipped; headings go to level 6 (Sentire Projects: 4); descriptions keep the
   bullets as written (Sentire Projects flattens them and turns a ticked sub-box into `~~text~~`); a paragraph or
   plain bullet ends an item; labels inside code spans stay; an item that is only labels is skipped with a warning;
   an empty input is a warning, not an error (Sentire Projects throws); milestones are listed only if they hold an item.
7. **Run status.** `complete` only when the metadata says so. Sentire Projects defaults to complete; a run that is
   `in_progress` or has no metadata is `incomplete` here, the safe side for "not reported, so maybe fixed".
8. **Priority names** are upper case (`URGENT`, `HIGH`, `NORMAL`, `LOW`) as the task gave them; a lead is `NORMAL`.
9. **Extras not asked for**: `parseFindings`, `mapFindings`, `coverageCounts`, `scanIssueKeys`, label colours
   (`SECURITY_LABEL_COLORS`, from Sentire Projects).

PC2 (repo kit and import mapping):

10. **Config file** keeps the Sentire name and shape, `.sentire-projects.json` with `project` and `server`, so
    existing repositories keep working; the hook and MCP entry are new Portal-named files (`portal-projects-session-start.mjs`,
    server `portal-projects`), so both can sit side by side. A repository that still has Sentire's hook must replace it.
11. **Paths the Portal does not have yet** (Track A builds them): the MCP endpoint `/api/v1/projects/mcp` as given, and
    for the hook `POST /api/v1/projects/sessions/start?briefing=1` answering `{ session: { id }, briefing }`, with
    `{ "project_key" }` in the body. This copies Sentire Projects' `/api/v1/sessions/start` under the Projects prefix.
    Both paths are exported constants (`PROJECTS_MCP_PATH`, `SESSION_START_PATH`). The hook sends `x-portal-client: claude-code`.
12. **The CLAUDE.md block** follows Sentire's snippet without its last bullet (run the security-audit skill before
    closing a release milestone), which was not in the brief.
13. **Import input format** is defined here, since Sentire Projects has no export.
14. **Plan choices**: work sessions are named by a made-up `ref`; the channel of an activity is worked out from the
    actor type; a status update is added when the history does not end with the current status; people are matched by
    e-mail; a duplicate is kept for the validator; rows with a missing parent are dropped or emptied with a warning.

## Tests

`pnpm --filter @portal/projects-core test`. The fixtures in `test/fixtures` are invented: a findings.json with one
confirmed finding per severity, a lead that needs validation and a rejection, a run-metadata.json and a coverage
ledger. The findings and the ledger pass the skill's own `validate-findings.cjs` and `validate-coverage-ledger.cjs`.
