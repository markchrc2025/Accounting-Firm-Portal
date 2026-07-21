import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MfaService } from "./mfa.service";
import { PasswordService } from "./password.service";
import { SsoController } from "./sso.controller";
import { SsoService } from "./sso.service";
import { TokenService } from "./token.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController, SsoController],
  providers: [AuthService, TokenService, MfaService, PasswordService, SsoService],
  // TokenService is exported for the global JwtAuthGuard; PasswordService for
  // user/invitation modules that set passwords.
  exports: [TokenService, PasswordService, MfaService],
})
export class AuthModule {}
