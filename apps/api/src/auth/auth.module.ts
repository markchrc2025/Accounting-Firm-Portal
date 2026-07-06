import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { MfaService } from "./mfa.service";
import { PasswordService } from "./password.service";
import { TokenService } from "./token.service";

@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, MfaService, PasswordService],
  // TokenService is exported for the global JwtAuthGuard; PasswordService for
  // user/invitation modules that set passwords.
  exports: [TokenService, PasswordService, MfaService],
})
export class AuthModule {}
