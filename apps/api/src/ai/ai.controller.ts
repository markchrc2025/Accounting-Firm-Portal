import { BadRequestException, Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { AiSettingsService } from "./ai-settings.service";
import { ReceiptScanService } from "./receipt-scan.service";

/** U11: the AI's status and a pile's upper-bound estimate. Firm staff only (R10). */
@ApiTags("ai")
@UseGuards(FirmUserGuard)
@Controller("ai")
export class AiController {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly scans: ReceiptScanService,
  ) {}

  /** Route 1. `configured` says whether the key is present; the key never leaves. */
  @Get("status")
  @RequirePermissions("Expenses:Create")
  status(@CurrentUser() user: AuthUser) {
    return this.settings.status(user.firmId);
  }

  /** Route 2: an upper bound, each PDF at 5 pages. Route 3 re-checks the real files. */
  @Get("estimate")
  @RequirePermissions("Expenses:Create")
  estimate(
    @CurrentUser() user: AuthUser,
    @Query("images") images?: string,
    @Query("pdfs") pdfs?: string,
  ) {
    const count = (v: string | undefined) =>
      v === undefined || v === "" ? 0 : Number(v);
    const i = count(images);
    const p = count(pdfs);
    if (![i, p].every((n) => Number.isInteger(n) && n >= 0 && n <= 100) || i + p > 100) {
      throw new BadRequestException(
        "images and pdfs are whole numbers, together at most 100.",
      );
    }
    return this.scans.estimateRoute(user, i, p);
  }
}
