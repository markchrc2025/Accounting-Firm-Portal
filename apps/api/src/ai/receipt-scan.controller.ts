import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Response } from "express";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { Public } from "../common/decorators/public.decorator";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { AI_CLOCK, type AiClock } from "./ai.tokens";
import { imageLinkSecret, verifyImageLink } from "./image-link";
import { ReceiptScanPoller } from "./receipt-scan.poller";
import { ReceiptScanPreparer } from "./receipt-scan.preparer";
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
    private readonly preparer: ReceiptScanPreparer,
  ) {}

  /** Route 3: send a pile. 202 { id, status: "preparing", files } once the files are
   *  on disk (U14 R3); the pile is prepared in the background. Accepted, by
   *  content: JPEG, PNG, WebP, GIF, TIFF, BMP, AVIF and HEIC/HEIF photos, and PDFs
   *  of up to 5 pages (prepare.ts). */
  @Post()
  @HttpCode(202)
  @RequirePermissions("Expenses:Create")
  @UseInterceptors(ScanUploadInterceptor)
  async create(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId: string | undefined,
    @Query("periodFrom") periodFrom: string | undefined,
    @Query("periodTo") periodTo: string | undefined,
    @UploadedFiles() files: UploadedScanFile[] | undefined,
  ) {
    const accepted = await this.scans.createUpload(
      user,
      { clientId, periodFrom, periodTo },
      files ?? [],
    );
    this.preparer.enqueue(accepted.id);
    this.poller.wake();
    return accepted;
  }

  /** U14: the client's linked Google Drive folder and what is in it. */
  @Get("drive")
  @RequirePermissions("Expenses:Create")
  driveListing(@CurrentUser() user: AuthUser, @Query("clientId") clientId?: string) {
    return this.scans.driveListing(user, clientId);
  }

  /** U14: send files from the client's Drive folder, body { driveFileIds } (1 to
   *  100). 202 { id, status: "preparing", files }, as an upload. */
  @Post("drive")
  @HttpCode(202)
  @RequirePermissions("Expenses:Create")
  async createDrive(
    @CurrentUser() user: AuthUser,
    @Query("clientId") clientId: string | undefined,
    @Query("periodFrom") periodFrom: string | undefined,
    @Query("periodTo") periodTo: string | undefined,
    @Body() body: unknown,
  ) {
    const accepted = await this.scans.createDrive(
      user,
      { clientId, periodFrom, periodTo },
      body,
    );
    this.preparer.enqueue(accepted.id);
    this.poller.wake();
    return accepted;
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

/**
 * U14 contract C: a Drive file's image behind its signed link. Public (an <img>
 * sends no auth header): the signature and its hour are the authority, and they
 * name one file. A tampered or expired link answers 403; a file Drive no longer
 * has, or no longer shares, 404.
 */
@ApiTags("receipt-scans")
@Controller("receipt-scans/files")
export class ReceiptScanFileController {
  constructor(
    private readonly scans: ReceiptScanService,
    @Inject(AI_CLOCK) private readonly clock: AiClock,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Get(":fileId/content")
  async content(
    @Param("fileId") fileId: string,
    @Query("expires") expires: string | undefined,
    @Query("signature") signature: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (
      !verifyImageLink(
        imageLinkSecret(this.config),
        fileId,
        expires,
        signature,
        this.clock.now(),
      )
    )
      throw new ForbiddenException("This link has expired or is not valid.");
    const file = await this.scans.driveFileContent(fileId);
    if (!file)
      throw new NotFoundException(
        "This file is no longer in Google Drive, or no longer shared with the Portal.",
      );
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.setHeader("Content-Disposition", "inline");
    res.send(file.body);
  }
}
