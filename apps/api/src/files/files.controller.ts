import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { FilesService } from "./files.service";

/**
 * Firm document browser (read-only). Firm users only — client-portal tokens
 * carry a firmId too, so FirmUserGuard rejects CLIENT principals outright.
 */
@ApiTags("files")
@UseGuards(FirmUserGuard)
@Controller("files")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /** Every stored document in the firm's bucket prefix, mapped to clients. */
  @Get()
  @RequirePermissions("Clients:Read")
  list(@CurrentUser() user: AuthUser) {
    return this.files.list(user);
  }

  /** Short-lived signed view/download URL for one stored object. */
  @Get("url")
  @RequirePermissions("Clients:Read")
  url(@CurrentUser() user: AuthUser, @Query("key") key?: string) {
    if (!key) throw new BadRequestException("key is required");
    return this.files.signedUrl(user, key);
  }
}
