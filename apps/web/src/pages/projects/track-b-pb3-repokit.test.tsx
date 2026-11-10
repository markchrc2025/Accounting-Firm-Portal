// track-b-pb3-repokit.test.tsx - PB3: the "Connect a code repository" panel (files, Copy, the zip
// made in the browser, the steps) and the actor labels of the activity (Claude, GitHub, System),
// with the API mocked. The API's sentences are shown as sent. All data is invented.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ fetchRepoKit: vi.fn() }));
vi.mock("../../lib/projects", async (orig) => ({
  ...(await orig<typeof import("../../lib/projects")>()),
  ...api,
}));

import { ApiError } from "../../lib/api";
import type { ActivityItem, RepoKit } from "../../lib/projects";
import { ActivityEntries } from "./ActivityTab";
import { RepoKitPanel } from "./RepoKitPanel";

const KIT: RepoKit = {
  projectKey: "PAY",
  serverUrl: "https://portal.example.test",
  tokenEnvVar: "PORTAL_PROJECTS_TOKEN",
  files: [
    { path: ".portal-projects.json", content: '{\n  "project": "PAY"\n}\n' },
    {
      path: ".mcp.json",
      content:
        '{\n  "url": "https://portal.example.test/api/v1/projects/mcp",\n  "auth": "Bearer ${PORTAL_PROJECTS_TOKEN}"\n}\n',
    },
    {
      path: ".claude/hooks/portal-projects-session-start.mjs",
      content: "// hook\nconsole.log('hi');\n",
    },
  ],
};

const clipboard = vi.hoisted(() => ({ writeText: vi.fn() }));
const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");

function mount(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.fetchRepoKit.mockReset().mockResolvedValue(KIT);
  clipboard.writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  if (original) Object.defineProperty(navigator, "clipboard", original);
});

const show = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Show the files" }));
  await screen.findByText(".mcp.json");
};
const arrayBuffer = (blob: Blob): Promise<ArrayBuffer> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });

describe("PB3 the repo kit panel", () => {
  it("shows the four steps first and asks for nothing until the files are wanted", () => {
    mount(<RepoKitPanel projectKey="PAY" />);
    expect(screen.getByText("Connect a code repository")).toBeTruthy();
    const steps = within(document.querySelector("[data-repo-kit-steps]") as HTMLElement);
    const items = steps.getAllByRole("listitem").map((li) => li.textContent);
    expect(items[0]).toBe("Create a token on My API tokens.");
    expect(items[1]).toBe(
      "Put it in the environment variable named in the files below on your computer (never in the repository).",
    );
    expect(items[2]).toBe("Add these files to the repository and commit them.");
    expect(items[3]).toBe("Open the repository in Claude Code.");
    expect(steps.getByRole("link", { name: "My API tokens" }).getAttribute("href")).toBe(
      "/profile/tokens",
    );
    expect(api.fetchRepoKit).not.toHaveBeenCalled();
  });

  it("links to the Connect Claude help", () => {
    mount(<RepoKitPanel projectKey="PAY" />);
    expect(
      screen.getByRole("link", { name: "Connect Claude help" }).getAttribute("href"),
    ).toBe("/profile/tokens#connect-claude");
  });

  it("asks for the kit of the project when the files are wanted, and shows each file with its path", async () => {
    mount(<RepoKitPanel projectKey="PAY" />);
    await show();
    expect(api.fetchRepoKit).toHaveBeenCalledWith("PAY");
    const paths = Array.from(document.querySelectorAll("[data-kit-file]")).map((e) =>
      e.getAttribute("data-kit-file"),
    );
    expect(paths).toEqual(KIT.files.map((f) => f.path));
    const mcp = within(
      document.querySelector('[data-kit-file=".mcp.json"]') as HTMLElement,
    );
    expect(mcp.getByLabelText("Contents of .mcp.json").textContent).toBe(
      KIT.files[1]!.content,
    );
    // the variable is named in step 2, and the kit's address is said
    expect(
      screen.getByText("PORTAL_PROJECTS_TOKEN", { selector: "li code" }),
    ).toBeTruthy();
    expect(screen.getByText(/Made for https:\/\/portal\.example\.test\./)).toBeTruthy();
  });

  it("each file has its own Copy button, which copies that file's text and says so", async () => {
    mount(<RepoKitPanel projectKey="PAY" />);
    await show();
    for (const f of KIT.files) {
      clipboard.writeText.mockClear();
      const row = within(
        document.querySelector(`[data-kit-file="${f.path}"]`) as HTMLElement,
      );
      fireEvent.click(row.getByRole("button", { name: `Copy ${f.path}` }));
      await waitFor(() => expect(clipboard.writeText).toHaveBeenCalledWith(f.content));
      expect(await row.findByText("Copied to the clipboard.")).toBeTruthy();
    }
  });

  it("says when the browser would not copy", async () => {
    clipboard.writeText.mockRejectedValue(new Error("no"));
    (document as unknown as { execCommand: unknown }).execCommand = vi
      .fn()
      .mockReturnValue(false);
    mount(<RepoKitPanel projectKey="PAY" />);
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Copy .mcp.json" }));
    expect(await screen.findByText(/Could not copy/)).toBeTruthy();
  });

  it("Download all as a zip hands over one archive with every file, named for the project", async () => {
    let blob: Blob | null = null;
    let name = "";
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: (b: Blob) => {
        blob = b;
        return "blob:test";
      },
      revokeObjectURL: () => undefined,
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      name = this.download;
    });
    mount(<RepoKitPanel projectKey="PAY" />);
    await show();
    fireEvent.click(screen.getByRole("button", { name: "Download all as a zip" }));
    expect(name).toBe("PAY-repo-kit.zip");
    const bytes = new Uint8Array(await arrayBuffer(blob!));
    const text = new TextDecoder().decode(bytes);
    for (const f of KIT.files) {
      expect(text).toContain(f.path);
      expect(text).toContain(f.content);
    }
    expect(new DataView(bytes.buffer).getUint32(0, true)).toBe(0x04034b50);
    vi.unstubAllGlobals();
  });

  it("shows the API's sentence as sent when it cannot make the files", async () => {
    api.fetchRepoKit.mockRejectedValue(
      new ApiError(409, "The Portal's address must be https unless it is localhost.", {}),
    );
    mount(<RepoKitPanel projectKey="PAY" />);
    fireEvent.click(screen.getByRole("button", { name: "Show the files" }));
    await waitFor(() =>
      expect(document.querySelector("[data-projects-error]")!.textContent).toBe(
        "The Portal's address must be https unless it is localhost.",
      ),
    );
    expect(document.querySelector("[data-kit-file]")).toBeNull();
  });

  it("never shows a token: nothing on the panel looks like one", async () => {
    mount(<RepoKitPanel projectKey="PAY" />);
    await show();
    expect(document.body.textContent).not.toMatch(/ppt_[A-Za-z0-9_-]{10}/);
  });
});

describe("PB3 who did it, in the activity", () => {
  const entry = (
    id: string,
    actorType: ActivityItem["actorType"],
    actor: ActivityItem["actor"],
  ): ActivityItem => ({
    id,
    projectId: "p1",
    issueKey: "PAY-1",
    issueTitle: "Fix login",
    action: "issue.updated",
    actorType,
    actor,
    channel: "mcp",
    changes: [],
    session: null, // PB5
    createdAt: "2026-11-10T16:30:00.000Z",
  });
  it("entries made by Claude say Claude, even though a person's account made them; GitHub and System say so too", () => {
    mount(
      <ActivityEntries
        items={[
          entry("a", "CLAUDE", { id: "u1", fullName: "Ana Reyes" }),
          entry("b", "GITHUB", null),
          entry("c", "SYSTEM", null),
          entry("d", "USER", { id: "u1", fullName: "Ana Reyes" }),
        ]}
      />,
    );
    const who = (id: string) =>
      document.querySelector(`[data-activity="${id}"] .font-semibold`)!.textContent;
    expect(who("a")).toBe("Claude");
    expect(who("b")).toBe("GitHub");
    expect(who("c")).toBe("System");
    expect(who("d")).toBe("Ana Reyes");
  });
});
