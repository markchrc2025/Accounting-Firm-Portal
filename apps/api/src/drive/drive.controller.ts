import { Body, Controller, Delete, Get, Param, Put, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { DriveService } from "./drive.service";

/**
 * U14 (D51): the Portal's read-only Google Drive robot, and each client's folder of
 * receipt photos. Firm staff only. Every error body is { message }.
 */
@ApiTags("drive")
@UseGuards(FirmUserGuard)
@Controller()
export class DriveController {
  constructor(private readonly drive: DriveService) {}

  /** { configured, robotEmail, problem }: the key checked once, remembered 5 minutes. */
  @Get("drive/status")
  @RequirePermissions("Expenses:Create")
  status() {
    return this.drive.status();
  }

  /** Link a client's Drive folder: 200 { id, name, link }; 400, 409 or 503. */
  @Put("clients/:clientId/drive-folder")
  @RequirePermissions("Clients:Update")
  link(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body() body: { link?: unknown } | undefined,
  ) {
    return this.drive.linkFolder(user, clientId, body?.link);
  }

  /** Unlink it: 200 { driveFolder: null }. Nothing in Drive changes. */
  @Delete("clients/:clientId/drive-folder")
  @RequirePermissions("Clients:Update")
  unlink(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    return this.drive.unlinkFolder(user, clientId);
  }
}
