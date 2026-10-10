import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { ReceiptScanPoller } from "./receipt-scan.poller";
import { ReceiptScanService, type UploadedScanFile } from "./receipt-scan.service";
import { ScanUploadInterceptor } from "./scan-upload.interceptor";

/**
 * U11: piles of receipt photos read overnight by AI. Firm staff only; every route
 * needs Expenses:Create and assignment to the client (R10, D42). Nothing here
 * writes to the books.
 */
@ApiTags("receipt-scans")
@UseGuards(FirmUserGuard)
@Controller("receipt-scans")
export class ReceiptScanController {
  constructor(
    private readonly scans: ReceiptScanService,
    private readonly poller: ReceiptScanPoller,
  ) {}

  /** Route 3: send a pile. 201 with status "reading". Accepted, by content: JPEG,
   *  PNG, WebP, GIF, TIFF, BMP, AVIF and HEIC/HEIF photos, and PDFs of up to 5
   *  pages (prepare.ts). */
  @Post()
  @RequirePermissions("Expenses:Create")
  @UseInterceptors(ScanUploadInterceptor)
  async create(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId: string | undefined,
    @Query("periodFrom") periodFrom: string | undefined,
    @Query("periodTo") periodTo: string | undefined,
    @UploadedFiles() files: UploadedScanFile[] | undefined,
  ) {
    const summary = await this.scans.create(
      user,
      { clientId, periodFrom, periodTo },
      files ?? [],
    );
    if (summary.status === "reading") this.poller.wake();
    return summary;
  }

  /** Route 4: the caller's assigned clients' piles, newest first. */
  @Get()
  @RequirePermissions("Expenses:Create")
  list(@CurrentUser() user: AuthUser, @Query("clientId") clientId?: string) {
    return this.scans.list(user, clientId);
  }

  /** Route 5: one pile, its files and their rows. */
  @Get(":id")
  @RequirePermissions("Expenses:Create")
  detail(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.scans.detail(user, id);
  }
}
