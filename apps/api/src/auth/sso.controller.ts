import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { SSO_PROVIDERS, SsoError, SsoService, type SsoProvider } from "./sso.service";

function asProvider(value: string): SsoProvider | null {
  return (SSO_PROVIDERS as string[]).includes(value) ? (value as SsoProvider) : null;
}

/**
 * SSO endpoints (public — they ARE the sign-in). Start redirects to the
 * provider; the callback exchanges the code and hands the browser back to the
 * web app with the portal token in the URL fragment (or an error code on the
 * login page — never provider details).
 */
@ApiTags("auth")
@Public()
@Controller("auth/sso")
export class SsoController {
  constructor(private readonly sso: SsoService) {}

  @Get("providers")
  providers() {
    return this.sso.providers();
  }

  @Get(":provider/start")
  start(@Param("provider") providerParam: string, @Res() res: Response): void {
    const provider = asProvider(providerParam);
    if (!provider) {
      res.redirect(this.sso.loginRedirect("unavailable"));
      return;
    }
    try {
      res.redirect(this.sso.startUrl(provider));
    } catch {
      res.redirect(this.sso.loginRedirect("unavailable"));
    }
  }

  @Get(":provider/callback")
  async callback(
    @Param("provider") providerParam: string,
    @Query("code") code: string | undefined,
    @Query("state") state: string | undefined,
    @Query("error") providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = asProvider(providerParam);
    if (!provider) {
      res.redirect(this.sso.loginRedirect("unavailable"));
      return;
    }
    if (providerError || !code || !state) {
      // User cancelled at the provider, or the provider returned an error.
      res.redirect(this.sso.loginRedirect(providerError ? "cancelled" : "state"));
      return;
    }
    try {
      const result = await this.sso.handleCallback(provider, code, state, req.ip);
      res.redirect(this.sso.callbackRedirect(result));
    } catch (err) {
      const codeStr = err instanceof SsoError ? err.code : "failed";
      res.redirect(this.sso.loginRedirect(codeStr));
    }
  }
}
