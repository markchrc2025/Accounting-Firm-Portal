// track-b-pb3-logic.test.ts - PB3: the zip writer, the Connect Claude addresses, the clipboard
// helper and the exact calls of the token routes. All data is invented.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createApiToken,
  fetchFirmTokens,
  fetchMyTokens,
  revokeApiToken,
  tokenScopeLabel,
} from "./apiTokens";
import { copyText } from "./clipboard";
import {
  bearerHeader,
  capabilityAddress,
  claudeCodeAddress,
  MCP_PATH,
  TOKEN_ENV_VAR,
  TOKEN_PLACEHOLDER,
} from "./connectClaude";
import { fetchRepoKit } from "./projects";
import { crc32, dosDateTime, makeZip } from "./zip";

// --- a small reader for the archives makeZip writes, so the tests check the bytes -------------------

interface Entry {
  name: string;
  data: string;
  crc: number;
  method: number;
  flags: number;
}
function readZip(bytes: Uint8Array): Entry[] {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  const eocd = bytes.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true);
  let at = v.getUint32(eocd + 16, true);
  const out: Entry[] = [];
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(at, true)).toBe(0x02014b50);
    const flags = v.getUint16(at + 8, true);
    const method = v.getUint16(at + 10, true);
    const crc = v.getUint32(at + 16, true);
    const size = v.getUint32(at + 24, true);
    const nameLen = v.getUint16(at + 28, true);
    const local = v.getUint32(at + 42, true);
    const name = dec.decode(bytes.subarray(at + 46, at + 46 + nameLen));
    expect(v.getUint32(local, true)).toBe(0x04034b50);
    const lNameLen = v.getUint16(local + 26, true);
    const start = local + 30 + lNameLen;
    out.push({
      name,
      data: dec.decode(bytes.subarray(start, start + size)),
      crc,
      method,
      flags,
    });
    at += 46 + nameLen;
  }
  return out;
}

describe("PB3 zip", () => {
  it("crc32 matches the known check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it("writes every file back as it was, with its path and a correct checksum", () => {
    const files = [
      { path: ".sentire-projects.json", content: '{"project":"PAY"}\n' },
      {
        path: ".claude/hooks/start.mjs",
        content: "// héllo, naïve text\nconsole.log('ok');\n",
      },
      { path: "CLAUDE.md", content: "" },
    ];
    const read = readZip(makeZip(files, new Date("2026-11-10T04:00:00Z")));
    expect(read.map((e) => e.name)).toEqual(files.map((f) => f.path));
    expect(read.map((e) => e.data)).toEqual(files.map((f) => f.content));
    for (const [i, e] of read.entries()) {
      expect(e.crc).toBe(crc32(new TextEncoder().encode(files[i]!.content)));
      expect(e.method).toBe(0);
      expect(e.flags & 0x0800).toBe(0x0800); // names are UTF-8
    }
  });

  it("an empty list is a valid, empty archive", () => {
    const z = makeZip([]);
    expect(z.length).toBe(22);
    expect(readZip(z)).toEqual([]);
  });

  it("reads the times on the Manila clock", () => {
    // 2026-11-10 16:30:20 UTC is 2026-11-11 00:30:20 in Manila
    const { time, date } = dosDateTime(new Date("2026-11-10T16:30:20Z"));
    expect(time >> 11).toBe(0);
    expect((time >> 5) & 0x3f).toBe(30);
    expect((time & 0x1f) * 2).toBe(20);
    expect((date >> 9) + 1980).toBe(2026);
    expect((date >> 5) & 0x0f).toBe(11);
    expect(date & 0x1f).toBe(11);
  });
});

describe("PB3 Connect Claude addresses", () => {
  const origin = "https://portal.example.test";
  it("Claude Code: the MCP address and a header that reads the token from the environment", () => {
    expect(MCP_PATH).toBe("/api/v1/projects/mcp");
    expect(claudeCodeAddress(origin)).toBe(
      "https://portal.example.test/api/v1/projects/mcp",
    );
    expect(bearerHeader()).toBe("Authorization: Bearer ${PORTAL_PROJECTS_TOKEN}");
    expect(bearerHeader("MY_VAR")).toBe("Authorization: Bearer ${MY_VAR}");
    expect(TOKEN_ENV_VAR).toBe("PORTAL_PROJECTS_TOKEN");
  });
  it("claude.ai: the address holds the token only when a token is passed in", () => {
    expect(capabilityAddress(origin)).toBe(
      `https://portal.example.test/api/v1/projects/mcp/${TOKEN_PLACEHOLDER}`,
    );
    expect(capabilityAddress(origin, "ppt_abc")).toBe(
      "https://portal.example.test/api/v1/projects/mcp/ppt_abc",
    );
    expect(claudeCodeAddress(origin)).not.toContain("ppt_");
  });
});

describe("PB3 the API origin", () => {
  afterEach(() => {
    vi.resetModules();
    delete (window as unknown as { __PORTAL_ENV__?: unknown }).__PORTAL_ENV__;
  });
  const originFor = async (base: string) => {
    vi.resetModules();
    (window as unknown as { __PORTAL_ENV__?: unknown }).__PORTAL_ENV__ = {
      API_BASE_URL: base,
    };
    return (await import("./api")).apiOrigin();
  };
  it("is the scheme, host and port of the base the web app talks to, without the path", async () => {
    expect(await originFor("https://api.portal.example.test/api/v1")).toBe(
      "https://api.portal.example.test",
    );
    expect(await originFor("http://localhost:3000/api/v1")).toBe("http://localhost:3000");
  });
  it("a relative base is read against the page's own origin", async () => {
    expect(await originFor("/api/v1")).toBe(window.location.origin);
  });
});

describe("PB3 clipboard", () => {
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  afterEach(() => {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete (navigator as unknown as { clipboard?: unknown }).clipboard;
    vi.restoreAllMocks();
  });
  it("uses the browser clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    expect(await copyText("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });
  it("falls back to selecting a field when the clipboard is refused", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("no")) },
      configurable: true,
    });
    const exec = vi.fn().mockReturnValue(true);
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    expect(await copyText("hello")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
    expect(document.querySelector("textarea")).toBeNull(); // the hidden field is removed again
  });
  it("says false when nothing can copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    });
    (document as unknown as { execCommand: unknown }).execCommand = vi
      .fn()
      .mockReturnValue(false);
    expect(await copyText("hello")).toBe(false);
  });
});

describe("PB3 calls", () => {
  let calls: Array<{ url: string; init: RequestInit }> = [];
  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init: RequestInit = {}) => {
        calls.push({ url: String(url), init });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const last = () => {
    const c = calls.at(-1)!;
    return { path: new URL(c.url).pathname.replace(/^.*\/api\/v1/, ""), init: c.init };
  };

  it("lists, makes and revokes tokens, and a Super Admin lists the firm's", async () => {
    await fetchMyTokens();
    expect(last().path).toBe("/tokens");
    await fetchFirmTokens();
    expect(last().path).toBe("/tokens/firm");
    await createApiToken({ name: "Laptop", scope: "read_write" });
    expect(last().path).toBe("/tokens");
    expect(last().init.method).toBe("POST");
    expect(JSON.parse(last().init.body as string)).toEqual({
      name: "Laptop",
      scope: "read_write",
    });
    await revokeApiToken("t 1");
    expect(last().path).toBe("/tokens/t%201/revoke");
    expect(last().init.method).toBe("POST");
  });

  it("asks for the repo kit of a project", async () => {
    await fetchRepoKit("PAY");
    expect(last().path).toBe("/projects/PAY/repo-kit");
  });

  it("names the two scopes", () => {
    expect(tokenScopeLabel("read")).toBe("Read");
    expect(tokenScopeLabel("read_write")).toBe("Read and write");
    expect(tokenScopeLabel("other")).toBe("other");
  });
});
