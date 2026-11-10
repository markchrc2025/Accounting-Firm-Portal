# @portal/projects-core

Pure helpers for the Projects module. TypeScript only: no database, no network, no Nest. The
only Node API used is `node:crypto` (HMAC and SHA-256). Later phases call these from the API.

Behaviour comes from the owner's Sentire Projects (`src/server/services/importer.ts`,
`github.ts`, `audits.ts`, `src/lib/keys.ts`) and from the security-audit skill it vendors, which
is the public Cloudflare skill (MIT). Where this package differs from Sentire Projects, the
difference is listed under "Decisions" below. The Portal replicates Sentire Projects' features and logic; it does
not take its data, and Sentire Projects stays a separate app (so there is no import from it here).

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
  repoKit,
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
mergeMcpJson(existing: string | undefined, kitContent: string): string
mergeSettingsJson(existing: string | undefined, kitContent: string): string
applyClaudeMdBlock(existing: string | undefined, block: string): string
claudeMdBlock(projectKey: string): string
```

Returns the five files a code repository needs so Claude Code works with the Portal's Projects module.

The Portal and Sentire Projects are separate apps and a repository may use both, so **every file, entry and
marker the kit adds has a name of its own (`portal-projects`), and nothing in its output uses a Sentire Projects
name** (a test checks every path and every line). Three files are shared by nature; they are merged, never
replaced.

| Path                                              | What it is                                                                                                                                                                                                                                                 | Shared with Sentire's kit?                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `.portal-projects.json`                           | `{ "project": "PAY", "server": "https://portal.example.test" }`. The hook reads only this file.                                                                                                                                                            | No. Sentire uses `.sentire-projects.json`.                                       |
| `.claude/hooks/portal-projects-session-start.mjs` | Node, no dependency. Starts a work session (`POST <server>/api/v1/projects/sessions/start?briefing=1` with `{ "project_key" }`, header `Authorization: Bearer <token>`), prints the session id and the briefing. Fails quietly. See below.                  | No. Sentire's is `sentire-session-start.mjs`.                                    |
| `.mcp.json`                                       | One HTTP server named `portal-projects`, at `<server>/api/v1/projects/mcp`, with `Authorization: Bearer ${TOKEN_VAR}`. Claude Code reads the variable at run time; the token is never written.                                                            | The file, yes; the entry no (Sentire's is `sentire-projects`).                   |
| `.claude/settings.json`                           | A `SessionStart` hook that runs the script above (15 second timeout).                                                                                                                                                                                      | The file, yes; the hook no.                                                      |
| `CLAUDE.md`                                       | The managed block between `<!-- BEGIN portal-projects ... -->` and `<!-- END portal-projects -->`: start a session, keep issues current, keys in branches, commits and PR titles, `fixes KEY` in PR bodies, end the session with a summary and next steps. | The file, yes; Sentire's snippet has no markers, so the two blocks never meet. |

The token variable is the caller's choice (the Portal's own screens use `PORTAL_PROJECTS_TOKEN`); Sentire's is
`SENTIRE_PROJECTS_TOKEN`, so the two tokens do not meet either.

### A repository that already has Sentire's entries keeps both

Write `.portal-projects.json` and the hook file as they are (they are new files). For the three shared files:

- `.mcp.json`: `mergeMcpJson(existingText, kitFileContent)` adds the `portal-projects` server next to
  `sentire-projects`, or replaces its own entry if it is already there.
- `.claude/settings.json`: `mergeSettingsJson(existingText, kitFileContent)` adds the Portal's `SessionStart` hook
  next to Sentire's, so both run at session start. Other settings and other hooks stay. Running it again never
  duplicates the hook.
- `CLAUDE.md`: `applyClaudeMdBlock(existingText, block)` adds the block after the existing text, or replaces the
  block between the markers. Sentire's snippet is left as it is.

By hand it is the same: add a `"portal-projects"` key under `mcpServers`, add the Portal's hook group to
`hooks.SessionStart` beside Sentire's, and paste the block into `CLAUDE.md`. With no existing file, the helpers
return the kit's file. A file that is not valid JSON, or has the wrong shape, is refused with a sentence and not
changed.

### The hook

The hook follows the idea of Sentire Projects' kit hook: it reads `.portal-projects.json` (and only that file),
does nothing if there is none, says the session is not tracked if the token variable is not set, skips the `compact`
restart (resume and clear start a session again), and prints a sentence instead of failing if the server answers an
error or cannot be reached. Tests run the generated script against a local server.

Inputs are checked and refused with a sentence: the project key (2 to 10 capital letters or digits, starting
with a letter); `tokenEnvVar` must be a variable NAME in capitals, digits and underscores (a token such as
`spk_abc` is refused); `serverUrl` must be an `https://` origin with no path, query, fragment or user name
(`http://` only for localhost). A trailing slash is dropped.

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

PC2 and PC4 (repo kit):

10. **Own names (PC4).** Nothing the kit writes uses a Sentire Projects name: config `.portal-projects.json`
    (project and server), hook `portal-projects-session-start.mjs`, MCP server `portal-projects`, CLAUDE.md markers
    `portal-projects`. A repository that has Sentire's kit keeps both; see "A repository that already has Sentire's
    entries keeps both". `mergeMcpJson` and `mergeSettingsJson` are additions to the brief, as is `applyClaudeMdBlock`.
11. **Paths the Portal serves** (Track A): the MCP endpoint `/api/v1/projects/mcp` as given, and for the hook
    `POST /api/v1/projects/sessions/start?briefing=1` answering `{ session: { id }, briefing }`, with `{ "project_key" }`
    in the body. Both paths are exported constants (`PROJECTS_MCP_PATH`, `SESSION_START_PATH`). The hook sends
    `x-portal-client: claude-code`.
12. **The CLAUDE.md block** follows Sentire's snippet without its last bullet (run the security-audit skill before
    closing a release milestone), which was not in the brief.

## Tests

`pnpm --filter @portal/projects-core test`. The fixtures in `test/fixtures` are invented: a findings.json with one
confirmed finding per severity, a lead that needs validation and a rejection, a run-metadata.json and a coverage
ledger. The findings and the ledger pass the skill's own `validate-findings.cjs` and `validate-coverage-ledger.cjs`.
