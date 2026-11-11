import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLAUDE_MD_BEGIN,
  CLAUDE_MD_END,
  HOOK_SERVER_MISMATCH,
  HOOK_SERVER_NOT_HTTPS,
  PROJECTS_MCP_PATH,
  RepoKitError,
  SESSION_START_PATH,
  applyClaudeMdBlock,
  mergeMcpJson,
  mergeSettingsJson,
  claudeMdBlock,
  repoKit,
  type KitFile,
} from "../src";
import { DASHES } from "./helpers";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const golden = (path: string): string =>
  readFileSync(join(here, "golden", "kit", `${path}.golden`), "utf8");

const INPUT = {
  projectKey: "PAY",
  serverUrl: "https://portal.example.test",
  tokenEnvVar: "PORTAL_PROJECTS_TOKEN",
};
const kit = (over: Partial<typeof INPUT> = {}): KitFile[] =>
  repoKit({ ...INPUT, ...over });
const file = (files: KitFile[], path: string): string =>
  files.find((f) => f.path === path)!.content;

describe("repoKit: the files (golden)", () => {
  const files = kit();

  it("makes exactly these five files, in this order", () => {
    expect(files.map((f) => f.path)).toEqual([
      ".portal-projects.json",
      ".mcp.json",
      ".claude/settings.json",
      ".claude/hooks/portal-projects-session-start.mjs",
      "CLAUDE.md",
    ]);
  });

  it.each([
    ".portal-projects.json",
    ".mcp.json",
    ".claude/settings.json",
    ".claude/hooks/portal-projects-session-start.mjs",
    "CLAUDE.md",
  ])("%s matches its golden file", (path) => {
    expect(file(files, path)).toBe(golden(path));
  });

  it(".portal-projects.json has its own name and the shape project and server", () => {
    expect(JSON.parse(file(files, ".portal-projects.json"))).toEqual({
      project: "PAY",
      server: "https://portal.example.test",
    });
  });

  it(".mcp.json points at the projects MCP url and reads the token from the environment", () => {
    const mcp = JSON.parse(file(files, ".mcp.json")) as {
      mcpServers: Record<
        string,
        { type: string; url: string; headers: Record<string, string> }
      >;
    };
    expect(Object.keys(mcp.mcpServers)).toEqual(["portal-projects"]);
    expect(mcp.mcpServers["portal-projects"]).toEqual({
      type: "http",
      url: `https://portal.example.test${PROJECTS_MCP_PATH}`,
      headers: { Authorization: "Bearer ${PORTAL_PROJECTS_TOKEN}" },
    });
    expect(PROJECTS_MCP_PATH).toBe("/api/v1/projects/mcp");
  });

  it("the settings run the hook on SessionStart", () => {
    const s = JSON.parse(file(files, ".claude/settings.json")) as {
      hooks: { SessionStart: { hooks: { type: string; command: string }[] }[] };
    };
    expect(s.hooks.SessionStart[0]!.hooks[0]!.command).toBe(
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/portal-projects-session-start.mjs"',
    );
  });

  it("is the same on every call and follows its inputs", () => {
    expect(kit()).toEqual(kit());
    const other = kit({
      projectKey: "BKS2",
      serverUrl: "https://other.example.test/",
      tokenEnvVar: "OTHER_TOKEN",
    });
    expect(file(other, ".portal-projects.json")).toContain('"BKS2"');
    expect(file(other, ".portal-projects.json")).toContain(
      '"https://other.example.test"',
    );
    expect(file(other, ".mcp.json")).toContain(
      "https://other.example.test/api/v1/projects/mcp",
    );
    expect(file(other, ".mcp.json")).toContain("Bearer ${OTHER_TOKEN}");
    expect(file(other, ".claude/hooks/portal-projects-session-start.mjs")).toContain(
      '"OTHER_TOKEN"',
    );
    expect(file(other, "CLAUDE.md")).toContain("BKS2-12");
  });
});

describe("repoKit: no secrets, no dashes", () => {
  const files = kit();

  it("never writes a token: the variable is only named", () => {
    for (const f of files) {
      expect(f.content, f.path).not.toMatch(
        /spk_|ghp_|github_pat_|sk-[A-Za-z0-9]|\b[A-Za-z0-9]{32,}\b/,
      );
    }
    expect(file(files, ".mcp.json").match(/Bearer [^"]*/g)).toEqual([
      "Bearer ${PORTAL_PROJECTS_TOKEN}",
    ]);
    const hook = file(files, ".claude/hooks/portal-projects-session-start.mjs");
    expect(hook.match(/Bearer [^\n]*/g)).toEqual(['Bearer " + token,']);
  });

  it("has no em dash or en dash anywhere", () => {
    for (const f of files) expect(f.content, f.path).not.toMatch(DASHES);
  });

  it("refuses a token where the variable name belongs", () => {
    for (const bad of [
      "spk_abc123",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "my token",
      "portal_projects_token",
      "1TOKEN",
      "",
      "A",
    ]) {
      expect(() => kit({ tokenEnvVar: bad }), bad).toThrow(RepoKitError);
    }
    expect(() => kit({ tokenEnvVar: "spk_abc123" })).toThrow(
      /NAME of an environment variable/,
    );
  });
});

describe("repoKit: inputs", () => {
  it("accepts 2 to 10 capitals or digits starting with a letter", () => {
    for (const ok of ["PA", "PAY", "A1", "ABCDEFGHIJ", "P9"])
      expect(() => kit({ projectKey: ok }), ok).not.toThrow();
  });

  it("refuses any other project key with a sentence", () => {
    for (const bad of ["P", "pay", "9PAY", "ABCDEFGHIJK", "PAY-1", "PA Y", "", "PAY\n"]) {
      expect(() => kit({ projectKey: bad }), bad).toThrow(
        "The project key must be 2 to 10 capital letters or digits, starting with a letter (for example PAY).",
      );
    }
  });

  it("takes an https address, or http for localhost, and drops a trailing slash", () => {
    expect(
      file(kit({ serverUrl: "https://portal.example.test/" }), ".portal-projects.json"),
    ).toContain('"https://portal.example.test"');
    expect(
      file(
        kit({ serverUrl: "  https://portal.example.test  " }),
        ".portal-projects.json",
      ),
    ).toContain('"https://portal.example.test"');
    expect(
      file(kit({ serverUrl: "http://localhost:3000" }), ".portal-projects.json"),
    ).toContain('"http://localhost:3000"');
    expect(file(kit({ serverUrl: "http://127.0.0.1:8080/" }), ".mcp.json")).toContain(
      "http://127.0.0.1:8080/api/v1/projects/mcp",
    );
    expect(
      file(
        kit({ serverUrl: "https://Portal.Example.test:8443" }),
        ".portal-projects.json",
      ),
    ).toContain('"https://portal.example.test:8443"');
  });

  it("refuses an address that is not a plain https origin", () => {
    const cases: [string, RegExp][] = [
      ["portal.example.test", /not a web address/],
      ["", /not a web address/],
      ["http://portal.example.test", /must start with https/],
      ["ftp://portal.example.test", /must start with https/],
      ["https://user:pass@portal.example.test", /user name or password/],
      ["https://portal.example.test/app", /without a path/],
      ["https://portal.example.test/?a=1", /query or a fragment/],
      ["https://portal.example.test/#x", /query or a fragment/],
    ];
    for (const [url, message] of cases)
      expect(() => kit({ serverUrl: url }), url).toThrow(message);
  });
});

describe("repoKit: no collision with Sentire Projects in the same repository", () => {
  const files = kit();

  it("no path, entry name, marker or text of the kit uses a Sentire Projects name", () => {
    for (const f of files) {
      expect(f.path.toLowerCase(), f.path).not.toContain("sentire");
      expect(f.content.toLowerCase(), f.path).not.toContain("sentire");
    }
    expect(files.map((f) => f.path)).not.toContain(".sentire-projects.json");
  });

  it("uses portal-projects for the config, the hook, the MCP server and the CLAUDE.md markers", () => {
    expect(files.map((f) => f.path)).toEqual([
      ".portal-projects.json",
      ".mcp.json",
      ".claude/settings.json",
      ".claude/hooks/portal-projects-session-start.mjs",
      "CLAUDE.md",
    ]);
    expect(Object.keys(JSON.parse(file(files, ".mcp.json")).mcpServers)).toEqual([
      "portal-projects",
    ]);
    expect(CLAUDE_MD_BEGIN).toContain("BEGIN portal-projects");
    expect(CLAUDE_MD_END).toBe("<!-- END portal-projects -->");
  });

  it("its token variable is not Sentire's", () => {
    expect(file(files, ".mcp.json")).not.toContain("SENTIRE_PROJECTS_TOKEN");
    expect(file(files, ".claude/hooks/portal-projects-session-start.mjs")).not.toContain(
      "SENTIRE_PROJECTS_TOKEN",
    );
  });
});

// What Sentire Projects' own repo kit leaves in a repository (its .mcp.json and .claude/settings.json).
const SENTIRE_MCP = `${JSON.stringify(
  {
    mcpServers: {
      "sentire-projects": {
        type: "http",
        url: "https://projects.example.test/mcp",
        headers: { Authorization: "Bearer ${SENTIRE_PROJECTS_TOKEN}" },
      },
    },
  },
  null,
  2,
)}\n`;
const SENTIRE_SETTINGS = `${JSON.stringify(
  {
    permissions: { allow: ["Bash(npm test)"] },
    hooks: {
      SessionStart: [
        {
          hooks: [
            {
              type: "command",
              command:
                'node "$CLAUDE_PROJECT_DIR/.claude/hooks/sentire-session-start.mjs"',
              timeout: 15,
            },
          ],
        },
      ],
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "echo checking" }] },
      ],
    },
  },
  null,
  2,
)}\n`;

describe("merging into files the repository already has", () => {
  const files = kit();
  const kitMcp = file(files, ".mcp.json");
  const kitSettings = file(files, ".claude/settings.json");

  it(".mcp.json: with no existing file the result is the kit's file", () => {
    expect(mergeMcpJson(undefined, kitMcp)).toBe(kitMcp);
    expect(mergeMcpJson("", kitMcp)).toBe(kitMcp);
    expect(mergeMcpJson("  \n", kitMcp)).toBe(kitMcp);
  });

  it(".mcp.json: a repository with Sentire's entry keeps both servers", () => {
    const merged = JSON.parse(mergeMcpJson(SENTIRE_MCP, kitMcp));
    expect(Object.keys(merged.mcpServers)).toEqual([
      "sentire-projects",
      "portal-projects",
    ]);
    expect(merged.mcpServers["sentire-projects"]).toEqual(
      JSON.parse(SENTIRE_MCP).mcpServers["sentire-projects"],
    );
    expect(merged.mcpServers["portal-projects"]).toEqual(
      JSON.parse(kitMcp).mcpServers["portal-projects"],
    );
  });

  it(".mcp.json: other keys and servers stay; applying twice, or with a new address, never duplicates", () => {
    const existing = JSON.stringify({
      other: 1,
      mcpServers: { mine: { type: "stdio", command: "x" } },
    });
    const once = mergeMcpJson(existing, kitMcp);
    expect(JSON.parse(once).other).toBe(1);
    expect(Object.keys(JSON.parse(once).mcpServers)).toEqual(["mine", "portal-projects"]);
    expect(mergeMcpJson(once, kitMcp)).toBe(once);
    const moved = mergeMcpJson(
      once,
      file(kit({ serverUrl: "https://other.example.test" }), ".mcp.json"),
    );
    expect(Object.keys(JSON.parse(moved).mcpServers)).toEqual([
      "mine",
      "portal-projects",
    ]);
    expect(JSON.parse(moved).mcpServers["portal-projects"].url).toBe(
      "https://other.example.test/api/v1/projects/mcp",
    );
  });

  it(".mcp.json: refuses a file it cannot read, with a sentence", () => {
    expect(() => mergeMcpJson("{nope", kitMcp)).toThrow(
      ".mcp.json is not valid JSON. Fix it, then try again.",
    );
    expect(() => mergeMcpJson("[]", kitMcp)).toThrow(
      ".mcp.json must hold a JSON object. Fix it, then try again.",
    );
    expect(() => mergeMcpJson('{"mcpServers":[]}', kitMcp)).toThrow(
      "has an mcpServers that is not an object",
    );
  });

  it("settings: with no existing file the result is the kit's file", () => {
    expect(mergeSettingsJson(undefined, kitSettings)).toBe(kitSettings);
  });

  it("settings: a repository with Sentire's SessionStart hook keeps it and gets ours, so both run", () => {
    const merged = JSON.parse(mergeSettingsJson(SENTIRE_SETTINGS, kitSettings));
    const commands = merged.hooks.SessionStart.flatMap(
      (g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command),
    );
    expect(commands).toEqual([
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/sentire-session-start.mjs"',
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/portal-projects-session-start.mjs"',
    ]);
    expect(merged.permissions).toEqual({ allow: ["Bash(npm test)"] });
    expect(merged.hooks.PreToolUse).toHaveLength(1);
  });

  it("settings: applying twice never duplicates our hook, and a group of other hooks is kept whole", () => {
    const once = mergeSettingsJson(SENTIRE_SETTINGS, kitSettings);
    expect(mergeSettingsJson(once, kitSettings)).toBe(once);
    const shared = JSON.stringify({
      hooks: {
        SessionStart: [
          {
            hooks: [
              { type: "command", command: "echo mine" },
              {
                type: "command",
                command:
                  'node "$CLAUDE_PROJECT_DIR/.claude/hooks/portal-projects-session-start.mjs"',
              },
            ],
          },
        ],
      },
    });
    const merged = JSON.parse(mergeSettingsJson(shared, kitSettings));
    const commands = merged.hooks.SessionStart.flatMap(
      (g: { hooks: { command: string }[] }) => g.hooks.map((h) => h.command),
    );
    expect(commands).toEqual([
      "echo mine",
      'node "$CLAUDE_PROJECT_DIR/.claude/hooks/portal-projects-session-start.mjs"',
    ]);
  });

  it("settings: refuses a file it cannot read, with a sentence", () => {
    expect(() => mergeSettingsJson("{nope", kitSettings)).toThrow(
      ".claude/settings.json is not valid JSON",
    );
    expect(() => mergeSettingsJson('{"hooks":[]}', kitSettings)).toThrow(
      "has hooks that is not an object",
    );
    expect(() => mergeSettingsJson('{"hooks":{"SessionStart":{}}}', kitSettings)).toThrow(
      "hooks.SessionStart that is not a list",
    );
  });

  it("CLAUDE.md: Sentire's snippet (no markers) stays and our block is added after it", () => {
    const sentire =
      "## Project tracking (Sentire Projects)\nThis repo is tracked in Sentire Projects.\n";
    const out = applyClaudeMdBlock(sentire, file(files, "CLAUDE.md"));
    expect(out.startsWith(sentire.trimEnd())).toBe(true);
    expect(out).toContain(CLAUDE_MD_BEGIN);
    expect(applyClaudeMdBlock(out, file(files, "CLAUDE.md"))).toBe(out);
  });

  it("the merged files have no em dash or en dash", () => {
    for (const text of [
      mergeMcpJson(SENTIRE_MCP, kitMcp),
      mergeSettingsJson(SENTIRE_SETTINGS, kitSettings),
    ]) {
      expect(text).not.toMatch(DASHES);
    }
  });
});

describe("CLAUDE.md block", () => {
  const block = claudeMdBlock("PAY");

  it("starts and ends with the markers, and says what Claude must do", () => {
    expect(block.startsWith(CLAUDE_MD_BEGIN)).toBe(true);
    expect(block.endsWith(`${CLAUDE_MD_END}\n`)).toBe(true);
    for (const phrase of [
      "call start_session with the project key PAY",
      "update_issue",
      "add_comment",
      "create_issue",
      "branch names, commit messages and pull request titles",
      "fixes PAY-12",
      "call end_session with a short summary of what was done and the next steps",
      "session_id",
    ]) {
      expect(block, phrase).toContain(phrase);
    }
  });

  it("is used by the kit as the CLAUDE.md file", () => {
    expect(file(kit(), "CLAUDE.md")).toBe(block);
  });

  it("is added to a file that has none of it, after a blank line", () => {
    expect(applyClaudeMdBlock(undefined, block)).toBe(block);
    expect(applyClaudeMdBlock("", block)).toBe(block);
    expect(applyClaudeMdBlock("  \n", block)).toBe(block);
    expect(applyClaudeMdBlock("# Mine\n\nRules.\n", block)).toBe(
      `# Mine\n\nRules.\n\n${block}`,
    );
    expect(applyClaudeMdBlock("# Mine\nRules.", block)).toBe(
      `# Mine\nRules.\n\n${block}`,
    );
  });

  it("is replaced in place, leaving the text around it as it was", () => {
    const first = applyClaudeMdBlock("# Top\n\nBefore.\n", claudeMdBlock("OLD1"));
    const withAfter = `${first}\n## After\nMore rules.\n`;
    const next = applyClaudeMdBlock(withAfter, claudeMdBlock("PAY"));
    expect(next).toBe(
      `# Top\n\nBefore.\n\n${claudeMdBlock("PAY")}\n## After\nMore rules.\n`,
    );
    expect(next).not.toContain("OLD1");
    expect(next.match(/BEGIN portal-projects/g)).toHaveLength(1);
  });

  it("changes nothing when applied twice", () => {
    const once = applyClaudeMdBlock("# Top\n", block);
    expect(applyClaudeMdBlock(once, block)).toBe(once);
  });

  it("refuses a file whose markers are damaged", () => {
    expect(() => applyClaudeMdBlock(`text\n${CLAUDE_MD_BEGIN}\nhalf`, block)).toThrow(
      RepoKitError,
    );
    expect(() => applyClaudeMdBlock(`text\n${CLAUDE_MD_END}\nhalf`, block)).toThrow(
      /damaged portal-projects block/,
    );
    expect(() =>
      applyClaudeMdBlock(`${CLAUDE_MD_END}\n${CLAUDE_MD_BEGIN}\n`, block),
    ).toThrow(/wrong order/);
  });

  it("refuses a bad project key", () => {
    expect(() => claudeMdBlock("pay")).toThrow(RepoKitError);
  });
});

describe("the hook script, run for real against a local server", () => {
  interface Seen {
    method: string | undefined;
    url: string | undefined;
    headers: IncomingMessage["headers"];
    body: string;
  }
  const dirs: string[] = [];
  const closers: (() => void)[] = [];
  afterEach(() => {
    for (const c of closers.splice(0)) c();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  interface Reply {
    status: number;
    json?: unknown;
    /** A raw body instead of JSON. */
    raw?: string;
    headers?: Record<string, string>;
  }

  /** A local server that records what it receives, and a repository with the kit for it. */
  async function setup(reply: Reply, host = "127.0.0.1") {
    const seen: Seen[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        seen.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString(),
        });
        res.writeHead(reply.status, {
          "content-type": reply.raw !== undefined ? "text/html" : "application/json",
          ...reply.headers,
        });
        res.end(reply.raw !== undefined ? reply.raw : JSON.stringify(reply.json ?? {}));
      });
    });
    await new Promise<void>((r) => server.listen(0, host, r));
    closers.push(() => server.close());
    const url = `http://${host}:${(server.address() as AddressInfo).port}`;
    const dir = mkdtempSync(join(tmpdir(), "kit-hook-"));
    dirs.push(dir);
    // The kit is always made for a local address the generator accepts; a test may then change it.
    const kitUrl = host === "127.0.0.1" ? url : "http://127.0.0.1:1";
    for (const f of kit({ serverUrl: kitUrl })) {
      if (f.path === "CLAUDE.md") continue;
      mkdirSync(dirname(join(dir, f.path)), { recursive: true });
      writeFileSync(join(dir, f.path), f.content);
    }
    return { seen, dir, url };
  }

  const config = (dir: string, value: unknown) =>
    writeFileSync(join(dir, ".portal-projects.json"), JSON.stringify(value));
  const hookFile = (dir: string) =>
    join(dir, ".claude/hooks/portal-projects-session-start.mjs");

  async function runHook(
    dir: string,
    env: Record<string, string>,
    stdin = '{"source":"startup"}',
  ) {
    const child = run(
      process.execPath,
      [join(dir, ".claude/hooks/portal-projects-session-start.mjs")],
      {
        env: {
          PATH: process.env.PATH ?? "",
          CLAUDE_PROJECT_DIR: dir,
          NO_PROXY: "127.0.0.1",
          ...env,
        },
        timeout: 20_000,
      },
    );
    child.child.stdin?.end(stdin);
    const r = await child;
    for (const v of Object.values(env)) {
      if (v.length > 3) {
        expect(r.stdout, "the token is never printed").not.toContain(v);
        expect(r.stderr, "the token is never printed").not.toContain(v);
      }
    }
    return r;
  }

  const ok = {
    status: 201,
    json: {
      session: { id: "session-1" },
      briefing: "# PAY briefing\n- PAY-1 [New] First issue",
    },
  };

  it("is valid JavaScript", async () => {
    const { dir } = await setup(ok);
    const r = await run(process.execPath, [
      "--check",
      join(dir, ".claude/hooks/portal-projects-session-start.mjs"),
    ]);
    expect(r.stderr).toBe("");
  });

  it("starts a session with the token from the environment and prints the briefing", async () => {
    const { seen, dir } = await setup(ok);
    const r = await runHook(dir, { PORTAL_PROJECTS_TOKEN: "invented-token-value" });
    expect(r.stdout).toBe(
      "Portal Projects session_id: session-1 (pass it to update_issue, add_comment and end_session)\n\n# PAY briefing\n- PAY-1 [New] First issue\n",
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe("POST");
    expect(seen[0]!.url).toBe(`${SESSION_START_PATH}?briefing=1`);
    expect(seen[0]!.headers.authorization).toBe("Bearer invented-token-value");
    expect(seen[0]!.headers["x-portal-client"]).toBe("claude-code");
    expect(JSON.parse(seen[0]!.body)).toEqual({ project_key: "PAY" });
  });

  it("says the session is not tracked when the token variable is not set, and sends nothing", async () => {
    const { seen, dir } = await setup(ok);
    const r = await runHook(dir, {});
    expect(r.stdout).toBe(
      "Portal Projects: PORTAL_PROJECTS_TOKEN is not set, so this session is not tracked. Call start_session if the MCP server is connected.\n",
    );
    expect(seen).toHaveLength(0);
  });

  it("does nothing on a compact restart", async () => {
    const { seen, dir } = await setup(ok);
    const r = await runHook(dir, { PORTAL_PROJECTS_TOKEN: "t" }, '{"source":"compact"}');
    expect(r.stdout).toBe("");
    expect(seen).toHaveLength(0);
  });

  it("starts again on resume and on clear", async () => {
    const { seen, dir } = await setup(ok);
    await runHook(dir, { PORTAL_PROJECTS_TOKEN: "t" }, '{"source":"resume"}');
    await runHook(dir, { PORTAL_PROJECTS_TOKEN: "t" }, "not json");
    expect(seen).toHaveLength(2);
  });

  it("reports a refusal in a sentence and exits quietly", async () => {
    const { dir } = await setup({ status: 401, json: { error: "no" } });
    const r = await runHook(dir, { PORTAL_PROJECTS_TOKEN: "t" });
    expect(r.stdout).toBe("Portal Projects: could not start a session (401).\n");
  });

  it("exits quietly when the repository has no .portal-projects.json", async () => {
    const { seen, dir } = await setup(ok);
    rmSync(join(dir, ".portal-projects.json"));
    const r = await runHook(dir, { PORTAL_PROJECTS_TOKEN: "t" });
    expect(r.stdout).toBe("");
    expect(seen).toHaveLength(0);
  });

  it("reads only .portal-projects.json: a repository with just Sentire's config is left alone", async () => {
    const { seen, dir } = await setup(ok);
    rmSync(join(dir, ".portal-projects.json"));
    writeFileSync(
      join(dir, ".sentire-projects.json"),
      JSON.stringify({ project: "PAY", server: `http://127.0.0.1:1` }),
    );
    const r = await runHook(dir, {
      PORTAL_PROJECTS_TOKEN: "t",
      SENTIRE_PROJECTS_TOKEN: "t",
    });
    expect(r.stdout).toBe("");
    expect(seen).toHaveLength(0);
  });

  it("a config naming another server sends nothing anywhere and prints one line", async () => {
    const a = await setup(ok);
    const b = await setup(ok);
    config(a.dir, { project: "PAY", server: b.url });
    const r = await runHook(a.dir, { PORTAL_PROJECTS_TOKEN: "invented-token-value" });
    expect(r.stdout).toBe(`${HOOK_SERVER_MISMATCH}\n`);
    expect(a.seen).toHaveLength(0);
    expect(b.seen).toHaveLength(0);
  });

  it("the same for another port, another scheme, or something that is not an address", async () => {
    const a = await setup(ok);
    const port = new URL(a.url).port;
    for (const server of [
      "http://127.0.0.1:1",
      `https://127.0.0.1:${port}`,
      `http://localhost:${port}`,
      "not an address",
      "file:///etc/passwd",
      42,
    ]) {
      config(a.dir, { project: "PAY", server });
      const r = await runHook(a.dir, { PORTAL_PROJECTS_TOKEN: "invented-token-value" });
      expect(r.stdout, String(server)).toBe(`${HOOK_SERVER_MISMATCH}\n`);
    }
    expect(a.seen).toHaveLength(0);
  });

  it("the config's server is compared as an origin: case, a trailing slash or a path do not matter", async () => {
    const a = await setup(ok);
    for (const server of [`${a.url}/`, a.url.toUpperCase(), `${a.url}/some/path`]) {
      config(a.dir, { project: "PAY", server });
      const r = await runHook(a.dir, { PORTAL_PROJECTS_TOKEN: "t" });
      expect(r.stdout, server).toContain("Portal Projects session_id: session-1");
    }
    expect(a.seen).toHaveLength(3);
    expect(a.seen.every((s) => s.url === `${SESSION_START_PATH}?briefing=1`)).toBe(true);
  });

  it("a config with no server uses the kit's server: the field is only for people to read", async () => {
    const a = await setup(ok);
    for (const value of [
      { project: "PAY" },
      { project: "PAY", server: "" },
      { project: "PAY", server: null },
    ]) {
      config(a.dir, value);
      const r = await runHook(a.dir, { PORTAL_PROJECTS_TOKEN: "t" });
      expect(r.stdout).toContain("Portal Projects session_id: session-1");
    }
    expect(a.seen).toHaveLength(3);
  });

  it("refuses a kit server that is plain http and not this computer, even when the config agrees", async () => {
    // A server on 127.0.0.2 is a loopback address but not one of the names the kit allows plain http for.
    const target = await setup(ok, "127.0.0.2");
    const hook = readFileSync(hookFile(target.dir), "utf8").replace(
      'const KIT_SERVER = "http://127.0.0.1:1";',
      `const KIT_SERVER = ${JSON.stringify(target.url)};`,
    );
    expect(hook).toContain(`const KIT_SERVER = ${JSON.stringify(target.url)};`);
    writeFileSync(hookFile(target.dir), hook);
    config(target.dir, { project: "PAY", server: target.url });
    const r = await runHook(target.dir, {
      PORTAL_PROJECTS_TOKEN: "invented-token-value",
    });
    expect(r.stdout).toBe(`${HOOK_SERVER_NOT_HTTPS}\n`);
    expect(target.seen).toHaveLength(0);
    for (const kitServer of [
      "http://portal.example.test",
      "ftp://127.0.0.1:1",
      "nonsense",
    ]) {
      writeFileSync(
        hookFile(target.dir),
        hook.replace(
          `const KIT_SERVER = ${JSON.stringify(target.url)};`,
          `const KIT_SERVER = ${JSON.stringify(kitServer)};`,
        ),
      );
      config(target.dir, { project: "PAY" });
      const again = await runHook(target.dir, {
        PORTAL_PROJECTS_TOKEN: "invented-token-value",
      });
      expect(again.stdout, kitServer).toBe(`${HOOK_SERVER_NOT_HTTPS}\n`);
    }
  });

  it("does not follow a redirect, so the token cannot be passed on", async () => {
    const b = await setup(ok);
    const a = await setup({
      status: 307,
      headers: { location: `${b.url}${SESSION_START_PATH}?briefing=1` },
    });
    const r = await runHook(a.dir, { PORTAL_PROJECTS_TOKEN: "invented-token-value" });
    expect(r.stdout).toBe(
      "Portal Projects: the server could not be reached, so the session was not started.\n",
    );
    expect(a.seen).toHaveLength(1);
    expect(b.seen).toHaveLength(0);
  });

  it("an unreachable server: one line, no error text", async () => {
    const a = await setup(ok);
    for (const close of closers.splice(0)) close();
    await new Promise((r) => setTimeout(r, 50));
    const r = await runHook(a.dir, { PORTAL_PROJECTS_TOKEN: "invented-token-value" });
    expect(r.stdout).toBe(
      "Portal Projects: the server could not be reached, so the session was not started.\n",
    );
  });

  it("never prints a response body in an error", async () => {
    const refused = await setup({
      status: 500,
      json: { error: "INVENTED-SERVER-SECRET" },
    });
    const r1 = await runHook(refused.dir, { PORTAL_PROJECTS_TOKEN: "t" });
    expect(r1.stdout).toBe("Portal Projects: could not start a session (500).\n");
    const html = await setup({ status: 201, raw: "<html>INVENTED-SERVER-SECRET</html>" });
    const r2 = await runHook(html.dir, { PORTAL_PROJECTS_TOKEN: "t" });
    expect(r2.stdout).toBe(
      "Portal Projects: the server's answer could not be read, so the session was not started.\n",
    );
    const odd = await setup({
      status: 201,
      json: { session: { id: 7 }, note: "INVENTED-SERVER-SECRET" },
    });
    const r3 = await runHook(odd.dir, { PORTAL_PROJECTS_TOKEN: "t" });
    expect(r3.stdout).toBe(
      "Portal Projects: the server's answer could not be read, so the session was not started.\n",
    );
    for (const r of [r1, r2, r3])
      expect(r.stdout + r.stderr).not.toContain("INVENTED-SERVER-SECRET");
  });

  it("puts the token only in the Authorization header, never in the address or the body", async () => {
    const a = await setup(ok);
    await runHook(a.dir, { PORTAL_PROJECTS_TOKEN: "invented-token-value" });
    expect(a.seen).toHaveLength(1);
    expect(a.seen[0]!.url).not.toContain("invented-token-value");
    expect(a.seen[0]!.body).not.toContain("invented-token-value");
    expect(a.seen[0]!.headers.authorization).toBe("Bearer invented-token-value");
  });
});
