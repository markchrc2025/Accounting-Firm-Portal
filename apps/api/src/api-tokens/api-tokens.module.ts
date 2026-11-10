import { Global, Module } from "@nestjs/common";
import { ApiTokensController } from "./api-tokens.controller";
import { ApiTokensService } from "./api-tokens.service";

/**
 * PA3 (D67): personal API tokens, generic so other modules can accept them later (a route opts in
 * with @AcceptsApiToken()). Global because the sign-in guard asks it about a token.
 */
@Global()
@Module({
  controllers: [ApiTokensController],
  providers: [ApiTokensService],
  exports: [ApiTokensService],
})
export class ApiTokensModule {}
