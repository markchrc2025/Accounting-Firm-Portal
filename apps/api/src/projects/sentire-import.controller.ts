// sentire-import.controller.ts — PA5 (D69): POST /projects/import/sentire.
// A Super Admin, signed in to the Portal. Deliberately NOT @AcceptsApiToken: a personal token,
// even a Super Admin's, is refused by the guard with "Personal tokens cannot be used on this route."
import { Body, Controller, HttpCode, Post, Res, UseGuards } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { SentireImportService } from "./sentire-import.service";

@ApiTags("projects")
@UseGuards(FirmUserGuard)
@Controller("projects/import")
export class SentireImportController {
  constructor(private readonly importer: SentireImportService) {}

  /**
   * Import an export of Sentire Projects: the tables as JSON (see projects-core, SentireExport).
   * `"dryRun": true` answers 200 with the counts and writes nothing; a real import answers 201.
   */
  @Post("sentire")
  @HttpCode(201)
  async sentire(
    @CurrentUser() user: AuthUser,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const report = await this.importer.import(user, body);
    if (report.dryRun) res.status(200);
    return report;
  }
}
