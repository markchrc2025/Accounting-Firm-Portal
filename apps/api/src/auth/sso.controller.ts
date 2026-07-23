import { Controller, Get, Logger, Param, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request, Response } from "express";
import { Public } from "../common/decorators/public.decorator";
import { SSO_PROVIDERS, SsoError, SsoService, type SsoProvider } from "./sso.service";

function asProvider(value: string): SsoProvider | null {
  return (SSO_PROVIDERS as string[]).includes(value) ? (value as SsoProvider) : null;
}

/**
 * Map the provider's callback error to a login-page code. `access_denied` is a
 * genuine user cancel/decline; any other provider error is a configuration or
 * consent problem (e.g. the app needs Azure admin approval) — flagged distinctly
 * so it isn't mistaken for a cancellation.
 */
function callbackErrorCode(
  providerError: string | undefined,
  code: string | undefined,
  state: string | undefined,
): string {
  if (!providerError) return code && state ? "failed" : "state";
  if (providerError === "access_denied") return "denied";
  return "provider";
}

/** Extract the Microsoft AADSTS diagnostic code from an error_description. */
function aadstsCode(description: string | undefined): string | undefined {
  return description?.match(/AADSTS\d+/)?.[0];
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
  private readonly logger = new Logger(SsoController.name);

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
    @Query("error_description") providerErrorDescription: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = asProvider(providerParam);
    if (!provider) {
      res.redirect(this.sso.loginRedirect("unavailable"));
      return;
    }
    if (providerError || !code || !state) {
      // The provider bounced back with an error, or without a code/state. Log the
      // real reason (never shown to the browser) so a misconfigured Azure/Google
      // app can actually be diagnosed, then map it to a specific login message.
      if (providerError) {
        this.logger.warn(
          `${provider} SSO callback error: ${providerError} — ${providerErrorDescription ?? ""}`,
        );
      }
      // Surface the provider's own diagnostic code (e.g. AADSTS65001) so an admin
      // can act on it — this is app-config info, never account-existence info.
      const detail = providerError
        ? aadstsCode(providerErrorDescription) ?? providerError
        : undefined;
      res.redirect(this.sso.loginRedirect(callbackErrorCode(providerError, code, state), detail));
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
