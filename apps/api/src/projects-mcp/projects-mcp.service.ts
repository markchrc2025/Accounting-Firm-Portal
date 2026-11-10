// projects-mcp.service.ts — PA3 (D67): the Projects MCP server, built fresh for each request.
//
// The tools follow Sentire Projects' tools (names, inputs, plain-text answers) over the Portal's
// own services, so every tool is checked, validated and logged exactly as the web's calls are:
// the caller's permissions apply, a Viewer is read only, client visibility holds. Everything done
// here is written as CLAUDE through the "mcp" channel, as the token's user.
//
// Names are what a person (or Claude) writes: a status "In progress", a type "Bug", a milestone
// "Beta", an assignee by name, e-mail or "me", labels by name. They are resolved to ids here and
// a wrong one answers with the valid names.
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod/v3";
import type { AuthUser } from "../common/auth/auth-user";
import { TOKEN_READ_ONLY } from "../api-tokens/api-tokens.service";
import { errMsg } from "../mcp/mcp-common";
import { PrismaService } from "../prisma/prisma.service";
import { RbacService } from "../rbac/rbac.service";
import { manilaStamp, projectStatusLabel } from "../projects/briefing";
import { SEVERITIES } from "@portal/projects-core";
import type {
  CreateIssueInput,
  UpdateIssueInput,
} from "../projects/dto/projects.schemas";
import { IssuesService } from "../projects/issues.service";
import { MilestonesService } from "../projects/milestones.service";
import type { ProjectsActor } from "../projects/projects.access";
import { ProjectsAdminService } from "../projects/projects-admin.service";
import { ProjectsContextService } from "../projects/projects-context.service";
import {
  ISSUE_KEY_RE,
  MESSAGES,
  PRIORITY_RANK,
  PROJECTS_PERMISSION as P,
} from "../projects/projects.constants";
import { ProjectsService } from "../projects/projects.service";
import { SecurityAuditsService } from "../projects/security-audits.service";
import { WorkSessionsService } from "../projects/work-sessions.service";
import { PROJECTS_MCP_INSTRUCTIONS } from "./instructions";

/** Who is calling, as the endpoint resolved it. */
export interface McpCaller {
  user: AuthUser;
  tokenId: string;
  /** claude-code, claude.ai, or what the x-portal-client header said. */
  client: string;
  /** What the token may do right now (see ApiTokensService.effectiveScope). */
  scope: "read" | "read_write";
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

const RO = { readOnlyHint: true, openWorldHint: false } as const;
const RW = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;

const optStr = z.string().optional();
const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD")
  .or(z.literal(""))
  .nullable()
  .optional();
const priorityArg = z.enum(["low", "normal", "high", "urgent"]).optional();
const URL_RE = /^https?:\/\/\S+$/;
const NOTHING_TO_CHANGE = "Nothing to change: pass at least one field.";

/** "" and null clear a date; undefined leaves it. */
const day = (v: string | null | undefined) =>
  v === undefined ? undefined : v === "" ? null : v;

@Injectable()
export class ProjectsMcpService {
  private readonly logger = new Logger(ProjectsMcpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly projects: ProjectsService,
    private readonly issues: IssuesService,
    private readonly milestones: MilestonesService,
    private readonly admin: ProjectsAdminService,
    private readonly context: ProjectsContextService,
    private readonly sessions: WorkSessionsService,
    private readonly audits: SecurityAuditsService,
  ) {}

  /** A server for one request. Stateless: nothing here outlives the call. */
  build(caller: McpCaller): McpServer {
    const server = new McpServer(
      { name: "portal-projects", version: "0.1.0" },
      { instructions: PROJECTS_MCP_INSTRUCTIONS },
    );
    const base: ProjectsActor = {
      user: caller.user,
      actorType: "CLAUDE",
      channel: "mcp",
      tokenId: caller.tokenId,
      client: caller.client,
    };

    const run = async (fn: () => Promise<string>): Promise<ToolResult> => {
      try {
        return ok(await fn());
      } catch (e) {
        if (e instanceof HttpException) {
          return fail(errMsg(e));
        }
        this.logger.error(`tool error: ${e instanceof Error ? e.stack : String(e)}`);
        return fail("Internal error. The change was not saved.");
      }
    };
    /** A tool that changes something: a read only caller is refused first, in one sentence. */
    const write = (fn: () => Promise<string>) =>
      run(async () => {
        if (caller.scope === "read") throw new ForbiddenException(TOKEN_READ_ONLY);
        return fn();
      });
    const actorFor = (sessionId?: string) => this.sessions.withSession(base, sessionId);

    // ---------------------------------------------------------------- projects

    server.registerTool(
      "list_projects",
      {
        title: "List projects",
        description:
          "All projects you can see with status, issue counts and next milestone, as a markdown table.",
        inputSchema: {},
        annotations: RO,
      },
      async () =>
        run(async () => {
          const rows = await this.projects.list(base, { includeArchived: false });
          const lines = [
            "| Key | Name | Status | To do | In progress | Done | Overdue | Next milestone |",
            "|---|---|---|---|---|---|---|---|",
          ];
          for (const p of rows) {
            const m = p.nextMilestone;
            const next = m
              ? `${m.name}${m.dueDate ? ` (${m.dueDate})` : ""}, ${m.progress.done}/${m.progress.total}`
              : "";
            lines.push(
              `| ${p.key} | ${p.name} | ${projectStatusLabel(p.status)} | ${p.counts.todo} | ${p.counts.inProgress} | ${p.counts.done} | ${p.counts.overdue} | ${next} |`,
            );
          }
          return lines.join("\n");
        }),
    );

    server.registerTool(
      "get_project",
      {
        title: "Get project settings",
        description:
          "A project's settings: key, name, description, repository URL, live URL, deploy app, status and archive state.",
        inputSchema: { project_key: z.string() },
        annotations: RO,
      },
      async (a) =>
        run(async () => {
          const o = await this.projects.overview(base, a.project_key);
          const p = o.project;
          return [
            `# ${p.key}: ${p.name}`,
            `Status: ${projectStatusLabel(o.status.value)}${o.status.note ? `, "${o.status.note}"` : ""}`,
            `Repository: ${p.repoUrl || "-"}`,
            `Live URL: ${p.liveUrl || "-"}`,
            `Deploy app: ${p.deployAppName || "-"}`,
            `Archived: ${p.archived ? "yes" : "no"}`,
            "",
            p.description || "(no description)",
          ].join("\n");
        }),
    );

    server.registerTool(
      "create_project",
      {
        title: "Create project",
        description:
          "Add a new project. Key is 2 to 10 capital letters or digits starting with a letter, e.g. HR or POS2.",
        inputSchema: {
          key: z.string(),
          name: z.string(),
          description: optStr,
          repo_url: optStr,
          live_url: optStr,
          deploy_app: optStr,
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          urlCheck("repo_url", a.repo_url);
          urlCheck("live_url", a.live_url);
          const p = await this.projects.create(base, {
            key: a.key,
            name: a.name,
            description: a.description,
            repoUrl: a.repo_url?.trim(),
            liveUrl: a.live_url?.trim(),
            deployAppName: a.deploy_app?.trim(),
          });
          return `Created project ${p.key}: ${p.name}`;
        }),
    );

    server.registerTool(
      "update_project",
      {
        title: "Update project settings",
        description:
          "Edit a project's settings: name, description (markdown), repository URL, live URL, deploy app. Only the fields you pass change. The key cannot change. Archiving is done in the app.",
        inputSchema: {
          project_key: z.string(),
          name: optStr,
          description: optStr.describe("Markdown"),
          repo_url: optStr.describe(
            "e.g. https://github.com/owner/repo, or empty string to clear",
          ),
          live_url: optStr.describe("Public URL, or empty string to clear"),
          deploy_app: optStr.describe("Deploy app name, or empty string to clear"),
          session_id: optStr.describe(
            "From start_session, so the change is attributed to the session",
          ),
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          urlCheck("repo_url", a.repo_url);
          urlCheck("live_url", a.live_url);
          const patch = {
            ...(a.name?.trim() ? { name: a.name.trim() } : {}),
            ...(a.description !== undefined ? { description: a.description } : {}),
            ...(a.repo_url !== undefined ? { repoUrl: a.repo_url.trim() } : {}),
            ...(a.live_url !== undefined ? { liveUrl: a.live_url.trim() } : {}),
            ...(a.deploy_app !== undefined ? { deployAppName: a.deploy_app.trim() } : {}),
          };
          if (Object.keys(patch).length === 0)
            throw new BadRequestException(NOTHING_TO_CHANGE);
          const u = await this.projects.update(
            await actorFor(a.session_id),
            a.project_key,
            patch,
          );
          return `${u.key} settings saved. Name: ${u.name} | Repo: ${u.repoUrl || "-"} | Live: ${u.liveUrl || "-"} | Deploy app: ${u.deployAppName || "-"}`;
        }),
    );

    server.registerTool(
      "get_project_context",
      {
        title: "Project briefing",
        description:
          "Compact briefing for one project: status, open milestones with progress, in-progress and top to-do issues, last Claude sessions with next steps, recent activity. Call this at the start of a session.",
        inputSchema: { project_key: z.string().describe("Project key, e.g. PAY") },
        annotations: RO,
      },
      async (a) => run(() => this.context.briefing(base, a.project_key)),
    );

    server.registerTool(
      "post_status_update",
      {
        title: "Project status update",
        description:
          "Set a project's overall status with a short note. Use when the health of the product changes or at the end of a milestone.",
        inputSchema: {
          project_key: z.string(),
          status: z.enum([
            "not_started",
            "on_track",
            "at_risk",
            "off_track",
            "on_hold",
            "finished",
          ]),
          note: z.string().describe("One or two sentences"),
          session_id: optStr,
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          const actor = await actorFor(a.session_id);
          await this.projects.postStatus(actor, a.project_key, {
            status: a.status.toUpperCase() as "ON_TRACK",
            note: a.note,
          });
          return `${a.project_key.trim().toUpperCase()} status set to ${a.status.replace("_", " ")}.`;
        }),
    );

    // ----------------------------------------------------------------- issues

    server.registerTool(
      "search_issues",
      {
        title: "Search issues",
        description:
          "Find issues by text and filters across the projects you can see. Returns one line per issue.",
        inputSchema: {
          query: optStr.describe("Text to match in key, title or description"),
          project_key: optStr,
          state: z.enum(["open", "closed", "all"]).optional().describe("Default open"),
          status: optStr.describe("Exact status name, e.g. In progress"),
          assignee: optStr.describe('User name, email, "me" or "none"'),
          milestone: optStr.describe('Milestone name or "none" (needs project_key)'),
          type: optStr.describe("Task, Bug, Feature, Epic"),
          label: optStr,
          limit: z.number().int().min(1).max(200).optional(),
        },
        annotations: RO,
      },
      async (a) =>
        run(async () => {
          const limit = a.limit ?? 50;
          const keys = a.project_key
            ? [a.project_key]
            : (await this.projects.list(base, { includeArchived: false })).map(
                (p) => p.key,
              );
          if (a.milestone && !a.project_key) {
            throw new BadRequestException("Filtering by milestone needs project_key.");
          }
          const rows: Awaited<ReturnType<IssuesService["list"]>>["items"] = [];
          for (const key of keys) {
            const names = this.names(base, key);
            const assignee = a.assignee
              ? await names.assigneeFilter(a.assignee)
              : undefined;
            const res = await this.issues.list(base, key, {
              q: a.query,
              state: a.state ?? "open",
              statusId: a.status ? await names.status(a.status) : undefined,
              typeId: a.type ? await names.type(a.type) : undefined,
              labelId: a.label ? await names.labelFilter(a.label) : undefined,
              assigneeId: assignee,
              milestoneId: a.milestone
                ? a.milestone === "none"
                  ? "none"
                  : await names.milestone(a.milestone)
                : undefined,
              sort: "priority",
              limit,
              offset: 0,
            });
            rows.push(...res.items);
          }
          if (!a.project_key) {
            rows.sort(
              (x, y) =>
                (PRIORITY_RANK[x.priority] ?? 9) - (PRIORITY_RANK[y.priority] ?? 9) ||
                y.updatedAt.localeCompare(x.updatedAt),
            );
          }
          if (!rows.length) return "No matching issues.";
          return rows
            .slice(0, limit)
            .map(
              (i) =>
                `${i.key} [${i.status.name}] ${i.type.name}${i.priority !== "NORMAL" ? ` ${i.priority}` : ""}: ${i.title}` +
                `${i.assignee ? ` @${i.assignee.fullName}` : ""}${i.milestone ? ` (ms: ${i.milestone.name})` : ""}${i.dueDate ? ` due ${i.dueDate}` : ""}`,
            )
            .join("\n");
        }),
    );

    server.registerTool(
      "get_issue",
      {
        title: "Get issue",
        description:
          "Full issue: fields, description, sub-issues and the last 20 comments.",
        inputSchema: { key: z.string().describe("Issue key, e.g. PAY-12") },
        annotations: RO,
      },
      async (a) =>
        run(async () => {
          const { projectKey, issueKey } = splitKey(a.key);
          const i = await this.issues.get(base, projectKey, issueKey);
          const comments = await this.issues.comments(base, projectKey, issueKey);
          const out = [
            `# ${i.key}: ${i.title}`,
            `Project: ${i.project.key} | Type: ${i.type.name} | Status: ${i.status.name} | Priority: ${i.priority}`,
            `Assignee: ${i.assignee?.fullName ?? "none"} | Milestone: ${i.milestone?.name ?? "none"} | Start: ${i.startDate ?? "-"} | Due: ${i.dueDate ?? "-"}`,
          ];
          if (i.labels.length)
            out.push(`Labels: ${i.labels.map((l) => l.name).join(", ")}`);
          if (i.parent) out.push(`Parent: ${i.parent.key} ${i.parent.title}`);
          out.push("", i.description || "(no description)");
          if (i.children.length) {
            out.push(
              "",
              "## Sub-issues",
              ...i.children.map((c) => `- ${c.key} [${c.status.name}] ${c.title}`),
            );
          }
          if (comments.length) {
            out.push("", "## Comments");
            for (const c of comments.slice(-20)) {
              out.push(
                `- ${manilaStamp(new Date(c.createdAt))} ${c.author?.fullName ?? "someone"}: ${c.body}`,
              );
            }
          }
          return out.join("\n");
        }),
    );

    const issueFields = {
      title: optStr,
      description: optStr.describe("Markdown"),
      type: optStr.describe("Task, Bug, Feature or Epic"),
      status: optStr.describe(
        "Status name, e.g. New, In progress, Blocked, In review, Done, Won't do",
      ),
      priority: priorityArg,
      assignee: z
        .string()
        .nullable()
        .optional()
        .describe('User name or email, "me", or null to unassign'),
      milestone: z
        .string()
        .nullable()
        .optional()
        .describe("Milestone name, or null to clear"),
      parent_key: z
        .string()
        .nullable()
        .optional()
        .describe("Parent issue key, or null to clear"),
      start_date: dateArg,
      due_date: dateArg,
      labels: z
        .array(z.string())
        .optional()
        .describe(
          "Replaces the label list. A label that does not exist is created if you may configure labels.",
        ),
      session_id: optStr.describe(
        "From start_session, so the change is attributed to this session",
      ),
    };
    server.registerTool(
      "create_issue",
      {
        title: "Create issue",
        description:
          "Create an issue (task, bug, feature or epic) in a project. Returns the new key.",
        inputSchema: { project_key: z.string(), ...issueFields, title: z.string() },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          const actor = await actorFor(a.session_id);
          const names = this.names(actor, a.project_key);
          const issue = await this.issues.create(
            actor,
            a.project_key,
            (await this.fields(names, a, true)) as CreateIssueInput,
          );
          return `Created ${issue.key}: ${issue.title}`;
        }),
    );

    server.registerTool(
      "create_issues",
      {
        title: "Create several issues",
        description:
          "Create up to 50 issues at once, for example when breaking a plan into tasks. Each item can carry its own status, so finished work can be recorded as Done in one call.",
        inputSchema: {
          project_key: z.string(),
          milestone: z
            .string()
            .optional()
            .describe("Milestone name applied to every item that has none"),
          items: z
            .array(
              z.object({
                title: z.string(),
                description: z.string().optional(),
                type: z.string().optional(),
                priority: priorityArg,
                labels: z.array(z.string()).optional(),
                milestone: z.string().optional(),
                parent_key: z.string().optional(),
                due_date: z.string().optional(),
                status: z
                  .string()
                  .optional()
                  .describe("Status name, e.g. Done for work already finished"),
              }),
            )
            .min(1)
            .max(50),
          session_id: optStr,
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          const actor = await actorFor(a.session_id);
          const names = this.names(actor, a.project_key);
          const made: string[] = [];
          for (const [n, it] of a.items.entries()) {
            try {
              const input = (await this.fields(
                names,
                { ...it, milestone: it.milestone ?? a.milestone },
                true,
              )) as CreateIssueInput;
              const issue = await this.issues.create(actor, a.project_key, input);
              made.push(`${issue.key} ${issue.title}`);
            } catch (e) {
              const before = made.map((m) => m.split(" ")[0]!);
              const note = before.length
                ? `\n${before.length} issue${before.length === 1 ? " was" : "s were"} created before it: ${before.join(", ")}.`
                : "";
              throw new BadRequestException(`Item ${n + 1}: ${errMsg(e)}${note}`);
            }
          }
          return `Created ${made.length} issues:\n${made.join("\n")}`;
        }),
    );

    server.registerTool(
      "update_issue",
      {
        title: "Update issue",
        description:
          "Change any fields of an issue. Only the fields you pass are changed. Optionally add a comment in the same call.",
        inputSchema: {
          key: z.string(),
          ...issueFields,
          comment: optStr.describe("Optional comment to add after the update"),
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          const { projectKey, issueKey } = splitKey(a.key);
          const actor = await actorFor(a.session_id);
          const names = this.names(actor, projectKey);
          const fields = await this.fields(names, a, false);
          const comment = a.comment?.trim();
          if (Object.keys(fields).length === 0 && !comment) {
            throw new BadRequestException(NOTHING_TO_CHANGE);
          }
          if (Object.keys(fields).length > 0) {
            await this.issues.update(
              actor,
              projectKey,
              issueKey,
              fields as UpdateIssueInput,
            );
          }
          if (comment) await this.issues.addComment(actor, projectKey, issueKey, comment);
          const d = await this.issues.get(actor, projectKey, issueKey);
          return `${d.key} is now [${d.status.name}] ${d.priority} ${d.type.name}: ${d.title}${d.assignee ? ` @${d.assignee.fullName}` : ""}${d.milestone ? ` (ms: ${d.milestone.name})` : ""}${comment ? " (comment added)" : ""}`;
        }),
    );

    server.registerTool(
      "add_comment",
      {
        title: "Comment on issue",
        description:
          "Add a markdown comment to an issue, e.g. progress notes, decisions, blockers.",
        inputSchema: { key: z.string(), body: z.string(), session_id: optStr },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          const { projectKey, issueKey } = splitKey(a.key);
          await this.issues.addComment(
            await actorFor(a.session_id),
            projectKey,
            issueKey,
            a.body,
          );
          return `Comment added to ${issueKey}.`;
        }),
    );

    // ------------------------------------------------------------- milestones

    server.registerTool(
      "list_milestones",
      {
        title: "List milestones",
        description: "Milestones of a project with progress.",
        inputSchema: { project_key: z.string(), include_closed: z.boolean().optional() },
        annotations: RO,
      },
      async (a) =>
        run(async () => {
          const all = await this.milestones.list(base, a.project_key);
          const ms = a.include_closed ? all : all.filter((m) => m.state !== "CLOSED");
          if (!ms.length) return "No milestones.";
          return ms
            .map(
              (m) =>
                `${m.name} [${m.state}]${m.dueDate ? ` due ${m.dueDate}` : ""}: ${m.progress.done}/${m.progress.total} done${m.description ? `\n  ${m.description}` : ""}`,
            )
            .join("\n");
        }),
    );

    server.registerTool(
      "save_milestone",
      {
        title: "Create or update milestone",
        description:
          "Creates the milestone if no milestone with that name exists in the project, otherwise updates it. Set state closed when it ships.",
        inputSchema: {
          project_key: z.string(),
          name: z.string(),
          new_name: optStr,
          description: optStr,
          start_date: dateArg,
          due_date: dateArg,
          state: z.enum(["open", "locked", "closed"]).optional(),
          session_id: optStr,
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          const actor = await actorFor(a.session_id);
          const all = await this.milestones.list(actor, a.project_key);
          const existing = all.find(
            (m) => m.name.toLowerCase() === a.name.trim().toLowerCase(),
          );
          if (!existing) {
            const m = await this.milestones.create(actor, a.project_key, {
              name: a.new_name ?? a.name,
              description: a.description,
              startDate: day(a.start_date),
              dueDate: day(a.due_date),
            });
            return `Created milestone ${m.name} in ${a.project_key.trim().toUpperCase()}.`;
          }
          const patch = {
            ...(a.new_name !== undefined ? { name: a.new_name } : {}),
            ...(a.description !== undefined ? { description: a.description } : {}),
            ...(a.start_date !== undefined ? { startDate: day(a.start_date) } : {}),
            ...(a.due_date !== undefined ? { dueDate: day(a.due_date) } : {}),
            ...(a.state ? { state: a.state.toUpperCase() as "OPEN" } : {}),
          };
          if (Object.keys(patch).length === 0) {
            return `Milestone ${existing.name} [${existing.state}] is unchanged.`;
          }
          const m = await this.milestones.update(
            actor,
            a.project_key,
            existing.id,
            patch,
          );
          return `Updated milestone ${m.name} [${m.state}].`;
        }),
    );

    // --------------------------------------------------------------- sessions

    server.registerTool(
      "start_session",
      {
        title: "Start work session",
        description:
          "Call at the start of a coding session. Returns a session_id to pass to later calls, plus the project briefing.",
        inputSchema: {
          project_key: z.string(),
          title: optStr.describe("What this session is about, if known"),
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          const s = await this.sessions.start(base, a.project_key, { title: a.title });
          return `session_id: ${s.id}\n\n${await this.context.briefing(base, a.project_key)}`;
        }),
    );

    server.registerTool(
      "end_session",
      {
        title: "End work session",
        description:
          "Call at the end of a session with what was done and what comes next. The next session's briefing shows it.",
        inputSchema: {
          session_id: optStr,
          project_key: optStr.describe("Used when session_id is unknown"),
          summary: z
            .string()
            .describe("What was done, 1 to 5 sentences. Mention issue keys."),
          next_steps: optStr,
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          await this.sessions.end(base, {
            sessionId: a.session_id,
            projectKey: a.project_key,
            summary: a.summary,
            nextSteps: a.next_steps,
          });
          return "Session closed and summary saved.";
        }),
    );

    // --------------------------------------------------------------- security

    server.registerTool(
      "import_security_audit",
      {
        title: "Import security audit results",
        description:
          "Import the output of the security-audit skill into a project. findings is the findings.json array (confirmed, needs_validation and rejected records). Confirmed findings become Bug issues labelled security and sev-<severity>, needs_validation leads become Tasks labelled security and needs-validation, rejected records are kept on the audit record. Issues are matched by fingerprint, so re-imports update and reopen instead of duplicating.",
        inputSchema: {
          project_key: z.string(),
          findings: z
            .union([z.array(z.record(z.string(), z.unknown())), z.string()])
            .describe("findings.json content: the array, or the file text"),
          run: z
            .object({
              run_id: optStr,
              source_ref: optStr.describe("Commit SHA that was audited"),
              profile: optStr.describe("quick, standard or deep"),
              scope_paths: z
                .array(z.string())
                .optional()
                .describe("Empty or omitted for a whole-repo run"),
              run_status: optStr.describe("complete or incomplete"),
              incomplete_reason: optStr,
            })
            .optional()
            .describe("Fields from run-metadata.json"),
          ledger: z
            .array(z.unknown())
            .optional()
            .describe("coverage-ledger.json: the array of units"),
          coverage: z
            .record(z.string(), z.number())
            .optional()
            .describe(
              "Ledger unit counts by status, e.g. {covered: 40, candidate: 3}, when there is no ledger",
            ),
          session_id: optStr,
        },
        annotations: RW,
      },
      async (a) =>
        write(async () => {
          const r = await this.audits.import(
            await actorFor(a.session_id),
            a.project_key,
            {
              findings: a.findings,
              run: a.run,
              ledger: a.ledger,
              coverage: a.coverage,
            },
          );
          const f = r.findings;
          const sev = SEVERITIES.filter((s) => f.bySeverity[s]).map(
            (s) => `${f.bySeverity[s]} ${s}`,
          );
          return [
            `Imported audit ${r.id} into ${a.project_key.trim().toUpperCase()}.`,
            `Confirmed: ${sev.length ? sev.join(", ") : "none"}. Needs validation: ${f.needsValidation}. Rejected: ${f.rejected}.`,
            r.created.length ? `Created: ${r.created.join(", ")}` : "",
            r.updated.length ? `Updated: ${r.updated.join(", ")}` : "",
            r.reopened.length ? `Reopened: ${r.reopened.join(", ")}` : "",
            r.notReported.length
              ? `Open but not reported this run (check if fixed): ${r.notReported.join(", ")}`
              : "",
            r.rejectedNoted.length
              ? `Open issues this run rejected (comment added): ${r.rejectedNoted.join(", ")}`
              : "",
          ]
            .filter(Boolean)
            .join("\n");
        }),
    );

    server.registerTool(
      "get_security_status",
      {
        title: "Security status",
        description:
          "Last security audit and open security issues for a project, and whether a milestone can close.",
        inputSchema: { project_key: z.string() },
        annotations: RO,
      },
      async (a) =>
        run(async () => {
          const s = await this.audits.status(base, a.project_key);
          const hist = (await this.audits.list(base, a.project_key, 5)).items;
          const lines = [`# ${s.projectKey} security`];
          const last = s.lastAudit;
          if (!last) lines.push("Never audited.");
          else {
            lines.push(
              `Last audit: ${manilaStamp(new Date(last.createdAt))}, ${last.profile}, ${last.scope.length ? `scoped: ${last.scope.join(", ")}` : "whole repo"}, commit ${last.commit.slice(0, 12) || "?"}${last.complete ? "" : `, INCOMPLETE${last.incompleteReason ? ` (${last.incompleteReason})` : ""}`}`,
            );
          }
          lines.push(
            `Release gate: ${s.blockedBy.length ? `BLOCKED by ${s.blockedBy.join(", ")}` : "clear (no open critical or high security issues)"}`,
            "",
            "## Open security issues",
            ...(s.open.length
              ? s.open.map(
                  (i) =>
                    `- ${i.key} [${i.severity ?? (i.needsValidation ? "needs validation" : "unrated")}] ${i.title}`,
                )
              : ["- none"]),
          );
          if (hist.length > 1) {
            lines.push("", "## Recent audits");
            for (const au of hist) {
              const sev = SEVERITIES.filter((x) => au.findings.bySeverity[x]).map(
                (x) => `${au.findings.bySeverity[x]} ${x}`,
              );
              lines.push(
                `- ${au.createdAt.slice(0, 10)} ${au.profile}${au.scope.length ? " scoped" : ""} @ ${au.commit.slice(0, 12) || "?"}: ${sev.join(", ") || "no confirmed"}, ${au.findings.needsValidation} needs validation`,
              );
            }
          }
          return lines.join("\n");
        }),
    );

    return server;
  }

  // ------------------------------------------------------------------ helpers

  /** The issue fields as the service takes them, names turned into ids. Only what was passed. */
  private async fields(
    names: Names,
    a: {
      title?: string;
      description?: string;
      type?: string;
      status?: string;
      priority?: "low" | "normal" | "high" | "urgent";
      assignee?: string | null;
      milestone?: string | null;
      parent_key?: string | null;
      start_date?: string | null;
      due_date?: string | null;
      labels?: string[];
    },
    creating: boolean,
  ): Promise<Record<string, unknown>> {
    const out: Record<string, unknown> = {};
    if (a.title !== undefined) out.title = a.title;
    if (a.description !== undefined) out.description = a.description;
    if (a.type) out.typeId = await names.type(a.type);
    if (a.status) out.statusId = await names.status(a.status);
    if (a.priority) out.priority = a.priority.toUpperCase();
    if (a.assignee !== undefined)
      out.assigneeId = a.assignee === null ? null : await names.assignee(a.assignee);
    if (a.milestone !== undefined)
      out.milestoneId = a.milestone === null ? null : await names.milestone(a.milestone);
    if (a.parent_key !== undefined)
      out.parentKey = a.parent_key === null ? null : a.parent_key.trim().toUpperCase();
    if (a.start_date !== undefined) out.startDate = day(a.start_date);
    if (a.due_date !== undefined) out.dueDate = day(a.due_date);
    if (a.labels !== undefined) out.labelIds = await names.labels(a.labels);
    if (creating && out.title === undefined) out.title = "";
    return out;
  }

  private names(actor: ProjectsActor, projectKey: string): Names {
    return new Names(this.prisma, this.rbac, this.admin, actor, projectKey);
  }
}

/** Turns the names a person writes into ids, loading each list once per call. */
class Names {
  private lists: {
    statuses?: { id: string; name: string }[];
    types?: { id: string; name: string }[];
    labels?: { id: string; name: string }[];
    users?: { id: string; fullName: string; email: string }[];
    milestones?: { id: string; name: string; state: string }[];
  } = {};

  constructor(
    private readonly prisma: PrismaService,
    private readonly rbac: RbacService,
    private readonly admin: ProjectsAdminService,
    private readonly actor: ProjectsActor,
    private readonly projectKey: string,
  ) {}

  private get firmId() {
    return this.actor.user.firmId;
  }

  private pick(list: { id: string; name: string }[], v: string, what: string): string {
    const hit = list.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
    if (!hit) {
      throw new BadRequestException(
        `Unknown ${what} "${v}". Valid: ${list.map((x) => x.name).join(", ")}`,
      );
    }
    return hit.id;
  }

  async status(v: string) {
    this.lists.statuses ??= await this.prisma.issueStatus.findMany({
      where: { firmId: this.firmId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
    return this.pick(this.lists.statuses, v, "status");
  }

  async type(v: string) {
    this.lists.types ??= await this.prisma.issueType.findMany({
      where: { firmId: this.firmId },
      orderBy: [{ order: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    });
    return this.pick(this.lists.types, v, "type");
  }

  private async labelList() {
    this.lists.labels ??= await this.prisma.label.findMany({
      where: { firmId: this.firmId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
    return this.lists.labels;
  }

  async labelFilter(v: string) {
    return this.pick(await this.labelList(), v, "label");
  }

  /** Label names to ids. A name that does not exist is created for a person who may configure labels. */
  async labels(values: string[]): Promise<string[]> {
    const list = await this.labelList();
    const ids: string[] = [];
    for (const v of values) {
      const hit = list.find((x) => x.name.toLowerCase() === v.trim().toLowerCase());
      if (hit) {
        ids.push(hit.id);
        continue;
      }
      if (!(await this.rbac.authorize(this.actor.user, [P.configure]))) {
        throw new BadRequestException(
          `Unknown label "${v}". Valid: ${list.map((x) => x.name).join(", ") || "none"}. Creating a label needs ${P.configure}.`,
        );
      }
      const made = await this.admin.createLabel(this.actor, { name: v.trim() });
      list.push({ id: made.id, name: made.name });
      ids.push(made.id);
    }
    return [...new Set(ids)];
  }

  private async userList() {
    this.lists.users ??= await this.prisma.user.findMany({
      where: { firmId: this.firmId, userType: "FIRM", status: "ACTIVE" },
      select: { id: true, fullName: true, email: true },
      orderBy: { fullName: "asc" },
    });
    return this.lists.users;
  }

  /** A person by name or e-mail, or "me". */
  async assignee(v: string): Promise<string> {
    if (v.trim().toLowerCase() === "me") return this.actor.user.id;
    const key = v.trim().toLowerCase();
    const hit = (await this.userList()).find(
      (u) => u.fullName.toLowerCase() === key || u.email.toLowerCase() === key,
    );
    if (!hit) throw new BadRequestException(`No user "${v}".`);
    return hit.id;
  }

  /** The assignee filter of a search: a person, "me" or "none". */
  async assigneeFilter(v: string): Promise<string> {
    if (v === "none") return "none";
    if (v === "me") return "me";
    return this.assignee(v);
  }

  async milestone(v: string): Promise<string> {
    this.lists.milestones ??= await this.prisma.milestone.findMany({
      where: {
        project: { key: this.projectKey.trim().toUpperCase(), firmId: this.firmId },
      },
      orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      select: { id: true, name: true, state: true },
    });
    const open = this.lists.milestones;
    const hit = open.find((m) => m.name.toLowerCase() === v.trim().toLowerCase());
    if (!hit) {
      const valid = open.filter((m) => m.state !== "CLOSED").map((m) => m.name);
      throw new BadRequestException(
        `Unknown milestone "${v}". Valid: ${valid.join(", ")}`,
      );
    }
    return hit.id;
  }
}

function urlCheck(field: string, v: string | undefined) {
  if (v && !URL_RE.test(v.trim())) {
    throw new BadRequestException(`${field} must start with http:// or https://`);
  }
}

/** PAY-12 (any case) into the project key and the issue key; else the Portal's sentence. */
function splitKey(raw: string): { projectKey: string; issueKey: string } {
  const issueKey = (raw ?? "").trim().toUpperCase();
  const m = ISSUE_KEY_RE.exec(issueKey);
  if (!m) throw new BadRequestException(MESSAGES.badIssueKey(issueKey));
  return { projectKey: m[1]!, issueKey };
}
