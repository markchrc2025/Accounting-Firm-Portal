// api-tokens.controller.ts — PA3 (D67): the signed-in person's personal API tokens.
// Always the Portal's own sign-in: a token cannot make or revoke tokens.
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { FirmUserGuard } from "../common/guards/firm-user.guard";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { ApiTokensService } from "./api-tokens.service";
import { CreateTokenSchema, type CreateTokenInput } from "./dto/api-tokens.schemas";

@ApiTags("tokens")
@UseGuards(FirmUserGuard)
@Controller("tokens")
export class ApiTokensController {
  constructor(private readonly tokens: ApiTokensService) {}

  /** Your tokens, newest first. Never the token itself. */
  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.tokens.list(user);
  }

  /** Super Admin: every token of the firm, with its owner. Never the token itself. */
  @Get("firm")
  listFirm(@CurrentUser() user: AuthUser) {
    return this.tokens.listFirm(user);
  }

  /** Make a token. The token is in this response and never again (so it is never cached). */
  @Post()
  @Header("Cache-Control", "no-store")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateTokenSchema)) body: CreateTokenInput,
  ) {
    return this.tokens.create(user, body);
  }

  /** Revoke a token: yours, or any token of the firm for a Super Admin. */
  @Post(":id/revoke")
  @HttpCode(200)
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.tokens.revoke(user, id);
  }
}
