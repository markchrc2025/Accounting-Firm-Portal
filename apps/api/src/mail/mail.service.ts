import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { sendViaPlunk } from "./plunk.adapter";
import { sendViaPostal } from "./postal.adapter";
import {
  MailConfig,
  MailError,
  MailProvider,
  SendMailInput,
  SendMailResult,
} from "./mail.types";

/**
 * Provider-agnostic outbound mail. The active sender is picked by the
 * MAIL_PROVIDER env var ("plunk" today, "postal" when that server is live) —
 * swapping providers is a config change, never a code change.
 *
 * Retry policy: exactly ONE retry after a short pause, then the error
 * propagates to the caller (which records a visible "email failed" state).
 * Never more — no retry storms toward a struggling provider.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly config: ConfigService) {}

  private cfg(): MailConfig {
    const provider = (this.config.get<string>("MAIL_PROVIDER", "plunk") || "plunk")
      .trim()
      .toLowerCase() as MailProvider;
    return {
      provider,
      fromEmail: this.config.get<string>("MAIL_FROM_EMAIL", "") ?? "",
      fromName: this.config.get<string>("MAIL_FROM_NAME", "MCRC Tax & Accounting") ?? "",
      plunkSecretKey: this.config.get<string>("PLUNK_SECRET_KEY") ?? undefined,
      postalApiKey: this.config.get<string>("POSTAL_API_KEY") ?? undefined,
      postalBaseUrl:
        this.config.get<string>("POSTAL_BASE_URL", "https://postal.sentire.solutions") ??
        "https://postal.sentire.solutions",
    };
  }

  /** True when the selected provider has everything it needs to send. */
  isEnabled(): boolean {
    const c = this.cfg();
    if (!c.fromEmail) return false;
    if (c.provider === "plunk") return Boolean(c.plunkSecretKey);
    if (c.provider === "postal") return Boolean(c.postalApiKey);
    return false;
  }

  async send(input: SendMailInput): Promise<SendMailResult> {
    const c = this.cfg();
    if (!this.isEnabled()) {
      throw new MailError(
        "Email sending is not configured — set MAIL_PROVIDER, MAIL_FROM_EMAIL and the " +
          "provider key (PLUNK_SECRET_KEY or POSTAL_API_KEY) in the API environment.",
      );
    }
    try {
      return await this.attempt(c, input);
    } catch (first) {
      this.logger.warn(
        `sendMail via ${c.provider} failed (attempt 1/2): ${(first as Error).message}`,
      );
      await new Promise((r) => setTimeout(r, 500));
      return this.attempt(c, input); // a second failure propagates to the caller
    }
  }

  private async attempt(c: MailConfig, input: SendMailInput): Promise<SendMailResult> {
    if (c.provider === "postal") {
      return { provider: "postal", messageId: await sendViaPostal(c, input) };
    }
    return { provider: "plunk", messageId: await sendViaPlunk(c, input) };
  }
}
