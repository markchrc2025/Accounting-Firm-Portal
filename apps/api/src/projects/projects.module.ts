import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RbacModule } from "../rbac/rbac.module";
import { BoardService } from "./board.service";
import { IssuesService } from "./issues.service";
import { MyWorkService } from "./my-work.service";
import { SearchService } from "./search.service";
import { MilestonesService } from "./milestones.service";
import { ProjectsAccess } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { ProjectsAdminService } from "./projects-admin.service";
import { McpRateLimitService } from "../projects-mcp/mcp-rate-limit.service";
import { ProjectsMcpController } from "../projects-mcp/projects-mcp.controller";
import { ProjectsMcpService } from "../projects-mcp/projects-mcp.service";
import { ProjectsConfigController, ProjectsController } from "./projects.controller";
import { ProjectsContextService } from "./projects-context.service";
import { ProjectsNotifier } from "./projects.notifier";
import { ProjectsRepoKitService } from "./projects-repo-kit.service";
import { ProjectsService } from "./projects.service";
import { WorkSessionsService } from "./work-sessions.service";

/**
 * PA1 (D65): the Projects module, inside the Portal. One service layer: every later door (the
 * MCP, personal tokens, the GitHub webhook, the import) calls these same services, so a change is
 * made, checked and logged the same way whoever makes it. The fixed-path controller is first.
 */
@Module({
  imports: [AuditModule, RbacModule, NotificationsModule],
  // The Projects MCP endpoint is first: /projects/mcp must never be read as a project key.
  controllers: [ProjectsMcpController, ProjectsConfigController, ProjectsController],
  providers: [
    ProjectsAccess,
    ProjectsActivity,
    ProjectsService,
    IssuesService,
    MilestonesService,
    ProjectsAdminService,
    ProjectsNotifier,
    BoardService,
    MyWorkService,
    SearchService,
    WorkSessionsService,
    ProjectsContextService,
    ProjectsRepoKitService,
    ProjectsMcpService,
    McpRateLimitService,
  ],
  exports: [
    ProjectsAccess,
    ProjectsActivity,
    ProjectsService,
    IssuesService,
    MilestonesService,
    ProjectsAdminService,
    SearchService,
    WorkSessionsService,
    ProjectsContextService,
  ],
})
export class ProjectsModule {}
