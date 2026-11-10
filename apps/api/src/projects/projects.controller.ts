// projects.controller.ts — PA1 (D65): the Projects REST API for the web, under /api/v1/projects.
// Session auth (the Portal's JWT), the Portal's data-driven permissions. A project is addressed by
// its key (PAY), an issue by its key (PAY-12). Every answer is JSON; every refusal is one plain
// sentence in the usual 4xx shape. The services do the work and the checks; the decorators here
// state the permission each route needs.
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { z } from "zod";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  ActivityQuerySchema,
  BoardQuerySchema,
  SearchQuerySchema,
  CommentSchema,
  CreateIssueSchema,
  CreateMilestoneSchema,
  CreateProjectSchema,
  IssueListQuerySchema,
  IssueStatusSchema,
  IssueTypeSchema,
  LabelSchema,
  PostStatusSchema,
  ProjectListQuerySchema,
  QuickIssueSchema,
  ReorderIssueSchema,
  UpdateIssueSchema,
  UpdateIssueStatusSchema,
  UpdateIssueTypeSchema,
  UpdateLabelSchema,
  UpdateMilestoneSchema,
  UpdateProjectSchema,
} from "./dto/projects.schemas";
import { webActor } from "./projects.access";
import { PROJECTS_PERMISSION as P } from "./projects.constants";
import { BoardService } from "./board.service";
import { IssuesService } from "./issues.service";
import { MyWorkService } from "./my-work.service";
import { SearchService } from "./search.service";
import { MilestonesService } from "./milestones.service";
import { ProjectsAdminService } from "./projects-admin.service";
import { ProjectsService } from "./projects.service";

type Body<S extends z.ZodTypeAny> = z.infer<S>;

/** Routes with fixed paths come first, so a project key can never be mistaken for one. */
@ApiTags("projects")
@Controller("projects")
export class ProjectsConfigController {
  constructor(
    private readonly admin: ProjectsAdminService,
    private readonly issues: IssuesService,
    private readonly myWork: MyWorkService,
    private readonly searcher: SearchService,
  ) {}

  /** The lists a screen needs for its filters and forms: types, statuses, labels, assignable users. */
  @Get("meta")
  @RequirePermissions(P.read)
  meta(@CurrentUser() user: AuthUser) {
    return this.admin.meta(webActor(user));
  }

  /** My Work: my open issues, overdue issues, upcoming milestones and recent activity, across the projects I can see. */
  @Get("my-work")
  @RequirePermissions(P.read)
  work(@CurrentUser() user: AuthUser) {
    return this.myWork.myWork(webActor(user));
  }

  /** One search box: issues and projects; an exact issue key answers { jump }. */
  @Get("search")
  @RequirePermissions(P.read)
  search(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(SearchQuerySchema)) q: { q: string },
  ) {
    return this.searcher.search(webActor(user), q.q);
  }

  /** An issue key like PAY-12 turned into what a link needs (title, status, project). */
  @Get("issue-keys/:issueKey")
  @RequirePermissions(P.read)
  lookup(@CurrentUser() user: AuthUser, @Param("issueKey") issueKey: string) {
    return this.issues.lookup(webActor(user), issueKey);
  }

  // ---- Configure: issue types, statuses, labels -------------------------------------------

  @Get("admin/issue-types")
  @RequirePermissions(P.configure)
  listTypes(@CurrentUser() user: AuthUser) {
    return this.admin.listTypes(webActor(user));
  }
  @Post("admin/issue-types")
  @RequirePermissions(P.configure)
  createType(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(IssueTypeSchema)) b: Body<typeof IssueTypeSchema>,
  ) {
    return this.admin.createType(webActor(user), b);
  }
  @Patch("admin/issue-types/:id")
  @RequirePermissions(P.configure)
  updateType(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateIssueTypeSchema))
    b: Body<typeof UpdateIssueTypeSchema>,
  ) {
    return this.admin.updateType(webActor(user), id, b);
  }
  @Delete("admin/issue-types/:id")
  @RequirePermissions(P.configure)
  deleteType(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.admin.deleteType(webActor(user), id);
  }

  @Get("admin/issue-statuses")
  @RequirePermissions(P.configure)
  listStatuses(@CurrentUser() user: AuthUser) {
    return this.admin.listStatuses(webActor(user));
  }
  @Post("admin/issue-statuses")
  @RequirePermissions(P.configure)
  createStatus(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(IssueStatusSchema)) b: Body<typeof IssueStatusSchema>,
  ) {
    return this.admin.createStatus(webActor(user), b);
  }
  @Patch("admin/issue-statuses/:id")
  @RequirePermissions(P.configure)
  updateStatus(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateIssueStatusSchema))
    b: Body<typeof UpdateIssueStatusSchema>,
  ) {
    return this.admin.updateStatus(webActor(user), id, b);
  }
  @Delete("admin/issue-statuses/:id")
  @RequirePermissions(P.configure)
  deleteStatus(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.admin.deleteStatus(webActor(user), id);
  }

  @Get("admin/labels")
  @RequirePermissions(P.configure)
  listLabels(@CurrentUser() user: AuthUser) {
    return this.admin.listLabels(webActor(user));
  }
  @Post("admin/labels")
  @RequirePermissions(P.configure)
  createLabel(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LabelSchema)) b: Body<typeof LabelSchema>,
  ) {
    return this.admin.createLabel(webActor(user), b);
  }
  @Patch("admin/labels/:id")
  @RequirePermissions(P.configure)
  updateLabel(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateLabelSchema)) b: Body<typeof UpdateLabelSchema>,
  ) {
    return this.admin.updateLabel(webActor(user), id, b);
  }
  @Delete("admin/labels/:id")
  @RequirePermissions(P.configure)
  deleteLabel(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.admin.deleteLabel(webActor(user), id);
  }
}

@ApiTags("projects")
@Controller("projects")
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly issues: IssuesService,
    private readonly milestones: MilestonesService,
    private readonly boards: BoardService,
  ) {}

  // ---- Projects ---------------------------------------------------------------------------

  /** The portfolio: every project the caller can see, with status, progress, counts, next milestone. */
  @Get()
  @RequirePermissions(P.read)
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ProjectListQuerySchema))
    q: Body<typeof ProjectListQuerySchema>,
  ) {
    return this.projects.list(webActor(user), { includeArchived: q.includeArchived });
  }

  @Post()
  @RequirePermissions(P.create)
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateProjectSchema)) b: Body<typeof CreateProjectSchema>,
  ) {
    return this.projects.create(webActor(user), b);
  }

  @Get(":key")
  @RequirePermissions(P.read)
  overview(@CurrentUser() user: AuthUser, @Param("key") key: string) {
    return this.projects.overview(webActor(user), key);
  }

  @Patch(":key")
  @RequirePermissions(P.update)
  update(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(UpdateProjectSchema)) b: Body<typeof UpdateProjectSchema>,
  ) {
    return this.projects.update(webActor(user), key, b);
  }

  @Post(":key/archive")
  @HttpCode(200)
  @RequirePermissions(P.update)
  archive(@CurrentUser() user: AuthUser, @Param("key") key: string) {
    return this.projects.setArchived(webActor(user), key, true);
  }

  @Post(":key/unarchive")
  @HttpCode(200)
  @RequirePermissions(P.update)
  unarchive(@CurrentUser() user: AuthUser, @Param("key") key: string) {
    return this.projects.setArchived(webActor(user), key, false);
  }

  // ---- Status updates ---------------------------------------------------------------------

  @Get(":key/status-updates")
  @RequirePermissions(P.read)
  statusUpdates(@CurrentUser() user: AuthUser, @Param("key") key: string) {
    return this.projects.statusUpdates(webActor(user), key);
  }

  @Post(":key/status-updates")
  @RequirePermissions(P.update)
  postStatus(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(PostStatusSchema)) b: Body<typeof PostStatusSchema>,
  ) {
    return this.projects.postStatus(webActor(user), key, b);
  }

  // ---- Activity ---------------------------------------------------------------------------

  @Get(":key/activity")
  @RequirePermissions(P.read)
  activity(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Query(new ZodValidationPipe(ActivityQuerySchema))
    q: Body<typeof ActivityQuerySchema>,
  ) {
    return this.projects.activityOf(webActor(user), key, q);
  }

  // ---- Milestones -------------------------------------------------------------------------

  @Get(":key/milestones")
  @RequirePermissions(P.read)
  milestoneList(@CurrentUser() user: AuthUser, @Param("key") key: string) {
    return this.milestones.list(webActor(user), key);
  }

  @Post(":key/milestones")
  @RequirePermissions(P.update)
  milestoneCreate(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(CreateMilestoneSchema))
    b: Body<typeof CreateMilestoneSchema>,
  ) {
    return this.milestones.create(webActor(user), key, b);
  }

  @Patch(":key/milestones/:id")
  @RequirePermissions(P.update)
  milestoneUpdate(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Param("id") id: string,
    @Body(new ZodValidationPipe(UpdateMilestoneSchema))
    b: Body<typeof UpdateMilestoneSchema>,
  ) {
    return this.milestones.update(webActor(user), key, id, b);
  }

  @Get(":key/roadmap")
  @RequirePermissions(P.read)
  roadmap(@CurrentUser() user: AuthUser, @Param("key") key: string) {
    return this.milestones.roadmap(webActor(user), key);
  }

  // ---- Board ------------------------------------------------------------------------------

  /** The board: a column per status, cards by position; Done columns hold the last 14 days unless doneRange=all. */
  @Get(":key/board")
  @RequirePermissions(P.read)
  board(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Query(new ZodValidationPipe(BoardQuerySchema)) q: Body<typeof BoardQuerySchema>,
  ) {
    return this.boards.board(webActor(user), key, q);
  }

  // ---- Issues -----------------------------------------------------------------------------

  @Get(":key/issues")
  @RequirePermissions(P.read)
  issueList(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Query(new ZodValidationPipe(IssueListQuerySchema))
    q: Body<typeof IssueListQuerySchema>,
  ) {
    return this.issues.list(webActor(user), key, q);
  }

  /** Quick create: the title and nothing else; the defaults do the rest. */
  @Post(":key/issues/quick")
  @RequirePermissions(P.create)
  issueQuick(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(QuickIssueSchema)) b: Body<typeof QuickIssueSchema>,
  ) {
    return this.issues.create(webActor(user), key, { title: b.title });
  }

  @Post(":key/issues")
  @RequirePermissions(P.create)
  issueCreate(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Body(new ZodValidationPipe(CreateIssueSchema)) b: Body<typeof CreateIssueSchema>,
  ) {
    return this.issues.create(webActor(user), key, b);
  }

  @Get(":key/issues/:issueKey")
  @RequirePermissions(P.read)
  issueGet(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Param("issueKey") issueKey: string,
  ) {
    return this.issues.get(webActor(user), key, issueKey);
  }

  @Patch(":key/issues/:issueKey")
  @RequirePermissions(P.update)
  issueUpdate(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Param("issueKey") issueKey: string,
    @Body(new ZodValidationPipe(UpdateIssueSchema)) b: Body<typeof UpdateIssueSchema>,
  ) {
    return this.issues.update(webActor(user), key, issueKey, b);
  }

  /** A place on the board: a position within a status (and the status, if it moves). */
  @Post(":key/issues/:issueKey/reorder")
  @HttpCode(200)
  @RequirePermissions(P.update)
  issueReorder(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Param("issueKey") issueKey: string,
    @Body(new ZodValidationPipe(ReorderIssueSchema)) b: Body<typeof ReorderIssueSchema>,
  ) {
    return this.issues.reorder(webActor(user), key, issueKey, b);
  }

  /** Soft delete: the issue disappears from every list, its number is never reused. */
  @Delete(":key/issues/:issueKey")
  @RequirePermissions(P.update)
  issueDelete(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Param("issueKey") issueKey: string,
  ) {
    return this.issues.remove(webActor(user), key, issueKey);
  }

  // ---- Comments ---------------------------------------------------------------------------

  @Get(":key/issues/:issueKey/comments")
  @RequirePermissions(P.read)
  commentList(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Param("issueKey") issueKey: string,
  ) {
    return this.issues.comments(webActor(user), key, issueKey);
  }

  @Post(":key/issues/:issueKey/comments")
  @RequirePermissions(P.update)
  commentAdd(
    @CurrentUser() user: AuthUser,
    @Param("key") key: string,
    @Param("issueKey") issueKey: string,
    @Body(new ZodValidationPipe(CommentSchema)) b: Body<typeof CommentSchema>,
  ) {
    return this.issues.addComment(webActor(user), key, issueKey, b.body);
  }
}
