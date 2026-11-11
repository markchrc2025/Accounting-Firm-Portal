// repo-kit.ts: the files a code repository needs so Claude Code works with the Portal's Projects
// module: which project this is, the MCP server, a SessionStart hook that opens a work session
// and prints the briefing, and a CLAUDE.md block that says how to keep issues current.
//
// Pure: strings in, strings out. The Portal and Sentire Projects stay separate apps and may both be
// used in one repository, so every file or entry the kit adds has a name of its own (portal-projects)
// and nothing in the output uses a Sentire Projects name. The shared files (.mcp.json,
// .claude/settings.json, CLAUDE.md) are merged, never replaced: see mergeMcpJson, mergeSettingsJson
// and applyClaudeMdBlock.

export interface RepoKitInput {
  /** The project key, 2 to 10 capital letters or digits starting with a letter: PAY. */
  projectKey: string;
  /** The Portal's address: https://portal.example.test (no path). http is allowed for localhost only. */
  serverUrl: string;
  /** The NAME of the environment variable that holds the personal token, e.g. PORTAL_PROJECTS_TOKEN. Never the token. */
  tokenEnvVar: string;
}

export interface KitFile {
  /** Relative to the repository root, forward slashes. */
  path: string;
  content: string;
}

export class RepoKitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RepoKitError";
  }
}

/** The Projects MCP endpoint, added to the server address. */
export const PROJECTS_MCP_PATH = "/api/v1/projects/mcp";
/** Where the hook starts a work session (POST, `?briefing=1` also returns the briefing). */
export const SESSION_START_PATH = "/api/v1/projects/sessions/start";

export const CONFIG_FILE = ".portal-projects.json";
export const MCP_FILE = ".mcp.json";
export const SETTINGS_FILE = ".claude/settings.json";
export const HOOK_FILE = ".claude/hooks/portal-projects-session-start.mjs";
export const CLAUDE_MD_FILE = "CLAUDE.md";
/** The name of the MCP server entry in `.mcp.json`. */
export const MCP_SERVER_NAME = "portal-projects";

export const CLAUDE_MD_BEGIN =
  "<!-- BEGIN portal-projects: written by the Portal repo kit. Edit outside these markers; the kit replaces what is between them. -->";
export const CLAUDE_MD_END = "<!-- END portal-projects -->";

const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{1,63}$/;

/** Checks the three inputs and returns the server address without a trailing slash. */
export function checkRepoKitInput(input: RepoKitInput): {
  projectKey: string;
  server: string;
  tokenEnvVar: string;
} {
  if (typeof input.projectKey !== "string" || !PROJECT_KEY.test(input.projectKey)) {
    throw new RepoKitError(
      "The project key must be 2 to 10 capital letters or digits, starting with a letter (for example PAY).",
    );
  }
  if (typeof input.tokenEnvVar !== "string" || !ENV_NAME.test(input.tokenEnvVar)) {
    throw new RepoKitError(
      "tokenEnvVar must be the NAME of an environment variable in capitals, digits and underscores (for example PORTAL_PROJECTS_TOKEN), never the token itself.",
    );
  }
  let url: URL;
  try {
    url = new URL(typeof input.serverUrl === "string" ? input.serverUrl.trim() : "");
  } catch {
    throw new RepoKitError(
      "The server address is not a web address. Use something like https://portal.example.test.",
    );
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new RepoKitError(
      "The server address must start with https:// (http:// is allowed only for localhost).",
    );
  }
  if (url.username || url.password) {
    throw new RepoKitError(
      "The server address must not contain a user name or password.",
    );
  }
  if (url.search || url.hash) {
    throw new RepoKitError("The server address must not contain a query or a fragment.");
  }
  if (url.pathname !== "/") {
    throw new RepoKitError(
      "The server address must be the Portal's address only, without a path.",
    );
  }
  return {
    projectKey: input.projectKey,
    server: url.origin,
    tokenEnvVar: input.tokenEnvVar,
  };
}

/**
 * The files a repository needs. Write each at its path; for `CLAUDE.md` use
 * {@link applyClaudeMdBlock}, and for `.mcp.json` and `.claude/settings.json` use
 * {@link mergeMcpJson} and {@link mergeSettingsJson}, because a repository may already have them
 * (with Sentire Projects' entries in them).
 *
 * - `.portal-projects.json`: `{ "project", "server" }`. Its own name, so it never meets the
 *   `.sentire-projects.json` of Sentire Projects; the hook reads only this file.
 * - `.mcp.json`: an HTTP MCP server at `<server>/api/v1/projects/mcp`, the Authorization header
 *   read from the environment variable at run time (`Bearer ${NAME}`).
 * - `.claude/settings.json`: a SessionStart hook that runs the script below.
 * - `.claude/hooks/portal-projects-session-start.mjs`: Node, no dependency; starts a work session
 *   and prints the briefing. Reads the token from the environment variable. Fails quietly.
 * - `CLAUDE.md`: the managed block only.
 *
 * Nothing in the output is a secret: the token is only ever named, never written.
 */
export function repoKit(input: RepoKitInput): KitFile[] {
  const { projectKey, server, tokenEnvVar } = checkRepoKitInput(input);
  return [
    { path: CONFIG_FILE, content: json({ project: projectKey, server }) },
    {
      path: MCP_FILE,
      content: json({
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: "http",
            url: `${server}${PROJECTS_MCP_PATH}`,
            headers: { Authorization: `Bearer \${${tokenEnvVar}}` },
          },
        },
      }),
    },
    {
      path: SETTINGS_FILE,
      content: json({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: "command",
                  command: `node "$CLAUDE_PROJECT_DIR/${HOOK_FILE}"`,
                  timeout: 15,
                },
              ],
            },
          ],
        },
      }),
    },
    { path: HOOK_FILE, content: hookScript(server, tokenEnvVar) },
    { path: CLAUDE_MD_FILE, content: claudeMdBlock(projectKey) },
  ];
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** What the hook prints when the config file names another server. Also used by the tests. */
export const HOOK_SERVER_MISMATCH =
  "Portal Projects: the server in .portal-projects.json does not match this kit's server, so the session was not started. Regenerate the kit from the Portal if the address changed.";
/** What the hook prints when its own server is not https (and not this computer). */
export const HOOK_SERVER_NOT_HTTPS =
  "Portal Projects: this kit's server does not use https, so the session was not started. Regenerate the kit from the Portal.";

function hookScript(server: string, tokenEnvVar: string): string {
  return `// Portal Projects SessionStart hook for Claude Code (written by the Portal repo kit).
// Starts a work session for this repository's project and prints the briefing, which Claude Code
// adds to the context.
// Needs: ${CONFIG_FILE} in the repository root and ${tokenEnvVar} in the environment.
// Fails quietly: a tracking problem must never block a coding session.
//
// The token is sent ONLY to KIT_SERVER, the Portal address this kit was made for. The server named
// in ${CONFIG_FILE} is a file anyone can change in a pull request, so it is only compared with
// KIT_SERVER: if it names another address, nothing is sent anywhere.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN_ENV_VAR = ${JSON.stringify(tokenEnvVar)};
const KIT_SERVER = ${JSON.stringify(server)};
const SESSION_START_PATH = ${JSON.stringify(SESSION_START_PATH)};
const SERVER_MISMATCH = ${JSON.stringify(HOOK_SERVER_MISMATCH)};
const SERVER_NOT_HTTPS = ${JSON.stringify(HOOK_SERVER_NOT_HTTPS)};

/** scheme://host:port with the host in lower case and a default port dropped; null if not an address. */
function originOf(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : null;
  } catch {
    return null;
  }
}

const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
let cfg;
try {
  cfg = JSON.parse(readFileSync(join(root, ${JSON.stringify(CONFIG_FILE)}), "utf8"));
} catch {
  process.exit(0);
}
if (!cfg || typeof cfg !== "object") process.exit(0);

// Start one work session per Claude Code session (resume and compact fire SessionStart again).
let input = "";
try {
  input = readFileSync(0, "utf8");
} catch {}
let source = "startup";
try {
  source = JSON.parse(input).source || "startup";
} catch {}
if (source === "compact") process.exit(0);

const kitOrigin = originOf(KIT_SERVER);
const kitHost = kitOrigin ? new URL(kitOrigin).hostname : "";
const local = kitHost === "localhost" || kitHost === "127.0.0.1" || kitHost === "[::1]";
if (!kitOrigin || !(kitOrigin.startsWith("https://") || (kitOrigin.startsWith("http://") && local))) {
  console.log(SERVER_NOT_HTTPS);
  process.exit(0);
}
// The config file's server is for people to read; it never chooses where the token goes.
if (cfg.server !== undefined && cfg.server !== null && String(cfg.server).trim() !== "") {
  if (originOf(String(cfg.server).trim()) !== kitOrigin) {
    console.log(SERVER_MISMATCH);
    process.exit(0);
  }
}

const token = process.env[TOKEN_ENV_VAR];
if (!token) {
  console.log(
    "Portal Projects: " + TOKEN_ENV_VAR + " is not set, so this session is not tracked. Call start_session if the MCP server is connected.",
  );
  process.exit(0);
}

let res;
try {
  res = await fetch(kitOrigin + SESSION_START_PATH + "?briefing=1", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "content-type": "application/json",
      "x-portal-client": "claude-code",
    },
    body: JSON.stringify({ project_key: cfg.project }),
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
} catch {
  console.log("Portal Projects: the server could not be reached, so the session was not started.");
  process.exit(0);
}
if (!res.ok) {
  console.log("Portal Projects: could not start a session (" + res.status + ").");
  process.exit(0);
}
let data;
try {
  data = await res.json();
} catch {
  data = null;
}
if (!data || !data.session || typeof data.session.id !== "string") {
  console.log("Portal Projects: the server's answer could not be read, so the session was not started.");
  process.exit(0);
}
console.log(
  "Portal Projects session_id: " + data.session.id + " (pass it to update_issue, add_comment and end_session)\\n",
);
console.log(typeof data.briefing === "string" ? data.briefing : "");
`;
}

/** The block of CLAUDE.md, markers included, ending with a newline. */
export function claudeMdBlock(projectKey: string): string {
  if (!PROJECT_KEY.test(projectKey)) {
    throw new RepoKitError(
      "The project key must be 2 to 10 capital letters or digits, starting with a letter (for example PAY).",
    );
  }
  return `${CLAUDE_MD_BEGIN}
## Project tracking (Portal Projects)

This repository is tracked in the Portal's Projects module. The project key is ${projectKey}; it is also in ${CONFIG_FILE}.

- At the start of a session, if the SessionStart hook did not already print a briefing with a session_id, call start_session with the project key ${projectKey}. Then read the briefing: open issues, milestones and the last session's next steps.
- Keep issues current while you work. Move the status with update_issue (In progress when you start, In review when a pull request is open, Done when it is merged). Use add_comment for decisions and blockers, and create_issue for bugs or follow-ups you find. Search before you create, to avoid duplicates. Do not invent issue keys; look them up.
- Put the issue key in branch names, commit messages and pull request titles, for example ${projectKey}-12: add the 2316 export.
- Write fixes ${projectKey}-12 in the pull request body. The issue closes when the pull request is merged.
- Before you finish, call end_session with a short summary of what was done and the next steps, passing the session_id.
${CLAUDE_MD_END}
`;
}

/**
 * Puts the kit's block into an existing CLAUDE.md. A block between the markers is replaced; with
 * no block the new one is added at the end, after a blank line. Text outside the markers is never
 * changed. With no existing file (`undefined` or empty) the result is the block alone.
 * Throws {@link RepoKitError} if the markers are damaged (one without the other, or in the wrong order).
 */
export function applyClaudeMdBlock(existing: string | undefined, block: string): string {
  if (!existing || !existing.trim()) return block;
  const begin = existing.indexOf(CLAUDE_MD_BEGIN);
  const end = existing.indexOf(CLAUDE_MD_END);
  if (begin === -1 && end === -1) {
    return `${existing.replace(/\s*$/, "")}\n\n${block}`;
  }
  if (begin === -1 || end === -1 || end < begin) {
    throw new RepoKitError(
      "CLAUDE.md has a damaged portal-projects block: one marker is missing or they are in the wrong order. Fix or remove the markers, then try again.",
    );
  }
  const after = existing.slice(end + CLAUDE_MD_END.length).replace(/^\n/, "");
  return `${existing.slice(0, begin)}${block}${after}`;
}

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject =>
  !!v && typeof v === "object" && !Array.isArray(v);

/** An existing JSON file as an object; a missing or empty file is `{}`. */
function readJsonObject(text: string | undefined, file: string): JsonObject {
  if (!text || !text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new RepoKitError(`${file} is not valid JSON. Fix it, then try again.`);
  }
  if (!isObject(value))
    throw new RepoKitError(`${file} must hold a JSON object. Fix it, then try again.`);
  return value;
}

/**
 * Adds the kit's `portal-projects` server to an existing `.mcp.json` (the kit's own file content is
 * the second argument) and keeps everything else, so a repository that already has Sentire Projects'
 * `sentire-projects` entry keeps both. The entry is replaced if it is already there, so applying
 * the kit twice, or again with a new address, never duplicates it. With no existing file the result
 * is the kit's file.
 */
export function mergeMcpJson(existing: string | undefined, kitContent: string): string {
  const current = readJsonObject(existing, MCP_FILE);
  const kit = readJsonObject(kitContent, MCP_FILE);
  const ours = (kit.mcpServers as JsonObject | undefined)?.[MCP_SERVER_NAME];
  if (current.mcpServers !== undefined && !isObject(current.mcpServers)) {
    throw new RepoKitError(
      `${MCP_FILE} has an mcpServers that is not an object. Fix it, then try again.`,
    );
  }
  return json({
    ...current,
    mcpServers: {
      ...(current.mcpServers as JsonObject | undefined),
      [MCP_SERVER_NAME]: ours,
    },
  });
}

/**
 * Adds the kit's SessionStart hook to an existing `.claude/settings.json` and keeps everything else
 * (other settings, other hooks, Sentire Projects' own SessionStart hook), so both hooks run. A hook
 * of the kit that is already there is replaced, never duplicated. With no existing file the result
 * is the kit's file.
 */
export function mergeSettingsJson(
  existing: string | undefined,
  kitContent: string,
): string {
  const current = readJsonObject(existing, SETTINGS_FILE);
  const kit = readJsonObject(kitContent, SETTINGS_FILE);
  const ours = ((kit.hooks as JsonObject).SessionStart as unknown[]) ?? [];
  if (current.hooks !== undefined && !isObject(current.hooks)) {
    throw new RepoKitError(
      `${SETTINGS_FILE} has hooks that is not an object. Fix it, then try again.`,
    );
  }
  const hooks = (current.hooks as JsonObject | undefined) ?? {};
  if (hooks.SessionStart !== undefined && !Array.isArray(hooks.SessionStart)) {
    throw new RepoKitError(
      `${SETTINGS_FILE} has hooks.SessionStart that is not a list. Fix it, then try again.`,
    );
  }
  const isOurs = (h: unknown) =>
    isObject(h) && typeof h.command === "string" && h.command.includes(HOOK_FILE);
  const kept = ((hooks.SessionStart as unknown[] | undefined) ?? [])
    .map((group) =>
      isObject(group) && Array.isArray(group.hooks)
        ? { ...group, hooks: group.hooks.filter((h) => !isOurs(h)) }
        : group,
    )
    .filter(
      (group) =>
        !(isObject(group) && Array.isArray(group.hooks) && group.hooks.length === 0),
    );
  return json({ ...current, hooks: { ...hooks, SessionStart: [...kept, ...ours] } });
}
