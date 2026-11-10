// github.service.ts — PA4 (D68): what a GitHub delivery (pull_request, push) does in the Portal.
//
// A repository is mapped to projects by their repository address (repoUrl). Issue keys written in a
// pull request's title, body and branch name, or in a commit's message, link that pull request or
// commit to the issue (one row per issue and url, updated by later events, never duplicated). A
// merged pull request into the default branch whose title or body says "fixes KEY" moves the issue
// to the firm's first done status, as GitHub, and tells the people involved. Only issues of a
// project linked to this very repository count: the key of another repository's project, of a
// project with no repository, of another firm, or an unknown key is ignored and said so.
import { Injectable } from "@nestjs/common";
import { closingKeys, extractIssueKeys } from "@portal/projects-core";
import { PrismaService } from "../prisma/prisma.service";
import { githubActor, type Tx } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { ProjectsNotifier } from "./projects.notifier";
import { normaliseRepo } from "./repo-match";
import type { PendingNotification } from "../notifications/notifications.service";

export interface GithubResult {
  ok: true;
  repo: string;
  linked: { key: string; kind: "pr" | "commit"; ref: string; created: boolean }[];
  closed: string[];
  ignored: { key: string; reason: string }[];
}

export const UNKNOWN_KEY =
  "No issue with this key in a project linked to this repository.";
const IGNORED_LIMIT = 50;
const COMMIT_LIMIT = 50;

interface PullRequestPayload {
  number?: number;
  title?: string | null;
  body?: string | null;
  html_url?: string;
  state?: string;
  merged?: boolean;
  merged_at?: string | null;
  head?: { ref?: string };
  base?: { ref?: string };
}
interface CommitPayload {
  id?: string;
  message?: string;
  url?: string;
}
interface Payload {
  action?: string;
  repository?: { full_name?: string; default_branch?: string };
  pull_request?: PullRequestPayload;
  commits?: CommitPayload[];
}

/** A pull request or commit that may name issues. */
interface Source {
  kind: "pr" | "commit";
  ref: string;
  number: number | null;
  sha: string | null;
  url: string;
  title: string;
  state: string;
  merged: boolean;
  /** Where keys are looked for. */
  texts: string[];
  /** Where a closing word counts (a pull request's title and body). */
  closingText: string;
  /** Set when this delivery merged the pull request into the default branch. */
  closesOnMerge: boolean;
}

@Injectable()
export class GithubService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ProjectsActivity,
    private readonly notifier: ProjectsNotifier,
  ) {}

  async handle(event: "pull_request" | "push", payload: Payload): Promise<GithubResult> {
    const repo = normaliseRepo(payload.repository?.full_name ?? "");
    const result: GithubResult = {
      ok: true,
      repo: repo ?? "",
      linked: [],
      closed: [],
      ignored: [],
    };
    if (!repo) return result;

    // the projects of this repository, and every project of the firms they belong to
    const candidates = (
      await this.prisma.project.findMany({
        where: { repoUrl: { contains: repo.split("/")[1]!, mode: "insensitive" } },
        select: { id: true, key: true, firmId: true, repoUrl: true, clientId: true },
      })
    ).filter((p) => normaliseRepo(p.repoUrl) === repo);
    if (candidates.length === 0) return result;
    const firms = [...new Set(candidates.map((c) => c.firmId))];
    const siblings = await this.prisma.project.findMany({
      where: { firmId: { in: firms } },
      select: { key: true, repoUrl: true },
    });
    const ownKeys = [...new Set(siblings.map((p) => p.key))];

    const sources = this.sources(event, payload, repo);
    if (sources.length === 0) return result;
    const keysIn = (text: string) => [
      ...new Set([
        ...extractIssueKeys(text),
        ...extractIssueKeys(text, { projectKeys: ownKeys }),
      ]),
    ];
    const closingIn = (text: string) =>
      new Set([...closingKeys(text), ...closingKeys(text, { projectKeys: ownKeys })]);

    const pending: PendingNotification[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const src of sources) {
        const keys = [...new Set(src.texts.flatMap(keysIn))];
        const closing = src.closesOnMerge
          ? closingIn(src.closingText)
          : new Set<string>();
        for (const key of keys) {
          const pk = key.slice(0, key.lastIndexOf("-"));
          const owners = candidates.filter((c) => c.key === pk);
          if (owners.length === 0) {
            this.ignore(result, key, this.mismatch(pk, siblings));
            continue;
          }
          let found = false;
          for (const owner of owners) {
            const issue = await tx.issue.findFirst({
              where: { firmId: owner.firmId, key, deleted: false },
              include: { status: true },
            });
            if (!issue) continue;
            found = true;
            const created = await this.link(tx, owner, issue, src, repo);
            result.linked.push({ key, kind: src.kind, ref: src.ref, created });
            if (
              closing.has(key) &&
              (await this.close(tx, owner, issue, src, repo, pending))
            ) {
              result.closed.push(key);
            }
          }
          if (!found) this.ignore(result, key, UNKNOWN_KEY);
        }
      }
    });
    await this.notifier.deliver(pending);
    return result;
  }

  private ignore(result: GithubResult, key: string, reason: string) {
    if (
      result.ignored.length < IGNORED_LIMIT &&
      !result.ignored.some((i) => i.key === key)
    ) {
      result.ignored.push({ key, reason });
    }
  }

  /** Why a key's project is not one of this repository's. Unknown projects are not told apart. */
  private mismatch(pk: string, siblings: { key: string; repoUrl: string }[]): string {
    const p = siblings.find((s) => s.key === pk);
    if (!p) return UNKNOWN_KEY;
    return p.repoUrl.trim()
      ? `Project ${pk} is linked to another repository.`
      : `Project ${pk} is not linked to a repository.`;
  }

  private sources(
    event: "pull_request" | "push",
    payload: Payload,
    repo: string,
  ): Source[] {
    if (event === "push") {
      return (payload.commits ?? [])
        .slice(0, COMMIT_LIMIT)
        .filter((c) => c.id && typeof c.message === "string")
        .map((c) => ({
          kind: "commit" as const,
          ref: c.id!,
          number: null,
          sha: c.id!,
          url: c.url ?? `https://github.com/${repo}/commit/${c.id}`,
          title: c.message!.split("\n")[0]!.slice(0, 200),
          state: "pushed",
          merged: false,
          texts: [c.message!],
          closingText: "",
          closesOnMerge: false,
        }));
    }
    const pr = payload.pull_request;
    if (!pr || typeof pr.number !== "number") return [];
    const merged = pr.merged === true || !!pr.merged_at;
    const base = pr.base?.ref;
    const def = payload.repository?.default_branch;
    const title = pr.title ?? "";
    const body = pr.body ?? "";
    return [
      {
        kind: "pr",
        ref: String(pr.number),
        number: pr.number,
        sha: null,
        url: pr.html_url ?? `https://github.com/${repo}/pull/${pr.number}`,
        title,
        state: merged ? "merged" : (pr.state ?? "open"),
        merged,
        texts: [title, body, pr.head?.ref ?? ""],
        closingText: `${title}\n${body}`,
        // GitHub closes issues only for a pull request merged into the default branch
        closesOnMerge:
          payload.action === "closed" && merged && (!base || !def || base === def),
      },
    ];
  }

  /** Insert or update the link; log it when it is new or its state moved. Returns whether it is new. */
  private async link(
    tx: Tx,
    project: { id: string; firmId: string },
    issue: { id: string },
    src: Source,
    repo: string,
  ): Promise<boolean> {
    const existing = await tx.githubLink.findUnique({
      where: { issueId_url: { issueId: issue.id, url: src.url } },
    });
    const data = { title: src.title.slice(0, 300), state: src.state, merged: src.merged };
    if (!existing) {
      await tx.githubLink.create({
        data: {
          firmId: project.firmId,
          projectId: project.id,
          issueId: issue.id,
          kind: src.kind,
          repo,
          number: src.number,
          sha: src.sha,
          url: src.url,
          ...data,
        },
      });
    } else if (
      existing.title !== data.title ||
      existing.state !== data.state ||
      existing.merged !== data.merged
    ) {
      await tx.githubLink.update({
        where: { id: existing.id },
        data: { ...data, updatedAt: new Date() },
      });
    }
    if (!existing || existing.state !== data.state) {
      await this.activity.log(tx, githubActor(project.firmId), {
        projectId: project.id,
        issueId: issue.id,
        action: "github.linked",
        changes: [
          {
            field: src.kind === "pr" ? "pullRequest" : "commit",
            old: null,
            new:
              src.kind === "pr"
                ? `${repo}#${src.number}`
                : `${repo}@${src.sha!.slice(0, 7)}`,
          },
          { field: "state", old: existing?.state ?? null, new: src.state },
        ],
      });
    }
    return !existing;
  }

  /** Move the issue to the first done status. False when it is already done or the firm has none. */
  private async close(
    tx: Tx,
    project: { id: string; firmId: string; key: string; clientId: string | null },
    issue: {
      id: string;
      key: string;
      title: string;
      assigneeId: string | null;
      authorId: string | null;
      status: { name: string; category: string };
    },
    src: Source,
    repo: string,
    pending: PendingNotification[],
  ): Promise<boolean> {
    if (issue.status.category === "DONE") return false;
    const done = await tx.issueStatus.findFirst({
      where: { firmId: project.firmId, category: "DONE" },
      orderBy: [{ order: "asc" }, { name: "asc" }],
    });
    if (!done) return false;
    const actor = githubActor(project.firmId);
    await tx.issue.update({
      where: { id: issue.id },
      data: { statusId: done.id, closedAt: new Date() },
    });
    await this.activity.log(tx, actor, {
      projectId: project.id,
      issueId: issue.id,
      action: "issue.updated",
      changes: [
        { field: "status", old: issue.status.name, new: done.name },
        { field: "closedBy", old: null, new: `${repo}#${src.number}` },
      ],
    });
    pending.push(
      ...(await this.notifier.plan(
        tx,
        actor,
        {
          id: issue.id,
          key: issue.key,
          title: issue.title,
          assigneeId: issue.assigneeId,
          authorId: issue.authorId,
          project: { key: project.key, clientId: project.clientId },
        },
        [{ type: "status", statusName: done.name, closed: true }],
      )),
    );
    return true;
  }
}
