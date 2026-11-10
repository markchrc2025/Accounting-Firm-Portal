import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { RbacModule } from "../rbac/rbac.module";
import { IssuesService } from "./issues.service";
import { MilestonesService } from "./milestones.service";
import { ProjectsAccess } from "./projects.access";
import { ProjectsActivity } from "./projects-activity.service";
import { ProjectsAdminService } from "./projects-admin.service";
import { ProjectsConfigController, ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";

/**
 * PA1 (D65): the Projects module, inside the Portal. One service layer: every later door (the
 * MCP, personal tokens, the GitHub webhook, the import) calls these same services, so a change is
 * made, checked and logged the same way whoever makes it. The fixed-path controller is first.
 */
@Module({
  imports: [AuditModule, RbacModule],
  controllers: [ProjectsConfigController, ProjectsController],
  providers: [
    ProjectsAccess,
    ProjectsActivity,
    ProjectsService,
    IssuesService,
    MilestonesService,
    ProjectsAdminService,
  ],
  exports: [
    ProjectsAccess,
    ProjectsActivity,
    ProjectsService,
    IssuesService,
    MilestonesService,
    ProjectsAdminService,
  ],
})
export class ProjectsModule {}
