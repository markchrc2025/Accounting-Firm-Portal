import { Body, Controller, Get, Ip, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { AuthService } from "./auth.service";
import {
  LoginInput,
  LoginSchema,
  MfaConfirmInput,
  MfaConfirmSchema,
  MfaVerifyInput,
  MfaVerifySchema,
} from "./dto/auth.schemas";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("login")
  login(@Body(new ZodValidationPipe(LoginSchema)) body: LoginInput, @Ip() ip: string) {
    return this.auth.login(body.email, body.password, ip);
  }

  @Public()
  @Post("mfa/verify")
  verifyMfa(
    @Body(new ZodValidationPipe(MfaVerifySchema)) body: MfaVerifyInput,
    @Ip() ip: string,
  ) {
    return this.auth.verifyMfa(body.mfaToken, body.code, ip);
  }

  @Get("me")
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  @Post("mfa/enroll")
  enrollMfa(@CurrentUser() user: AuthUser) {
    return this.auth.enrollMfa(user);
  }

  @Post("mfa/confirm")
  confirmMfa(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(MfaConfirmSchema)) body: MfaConfirmInput,
  ) {
    return this.auth.confirmMfa(user, body.code);
  }
}
