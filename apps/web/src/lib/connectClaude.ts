// connectClaude.ts - the addresses a person puts into Claude (PB3), built from the API origin the
// web app already uses. A token is in an address only when the caller passes it in, and the only
// caller that does is the box shown right after a token is made.

/** The Projects MCP server, after the API origin (Track A PA3, D67; the same path the repo kit uses). */
export const MCP_PATH = "/api/v1/projects/mcp";
/** What the repo kit calls the environment variable that holds the token (the kit names it too). */
export const TOKEN_ENV_VAR = "PORTAL_PROJECTS_TOKEN";
/** Stands where a token would be, in help that is shown at any time. */
export const TOKEN_PLACEHOLDER = "<your token>";

/** For Claude Code: the address, with the token sent in a header. */
export const claudeCodeAddress = (origin: string): string => `${origin}${MCP_PATH}`;
/** The header Claude Code sends, reading the token from the environment at run time. */
export const bearerHeader = (envVar: string = TOKEN_ENV_VAR): string =>
  `Authorization: Bearer \${${envVar}}`;
/** For a claude.ai custom connector: the address holds the token, so it is as secret as the token. */
export const capabilityAddress = (
  origin: string,
  token: string = TOKEN_PLACEHOLDER,
): string => `${origin}${MCP_PATH}/${token}`;

export const CAPABILITY_WARNING =
  "This address contains your token. Anyone who has it can act as you. Do not share it.";
export const TOKEN_ONCE_WARNING =
  "This token is shown only once. Copy it now and keep it somewhere safe.";

/** The GitHub webhook route, after the API origin (Track A PA4, D68). */
export const GITHUB_WEBHOOK_PATH = "/api/v1/projects/github/webhook";
export const githubWebhookUrl = (origin: string): string =>
  `${origin}${GITHUB_WEBHOOK_PATH}`;
