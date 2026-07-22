import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import type { AuthUser } from "../common/auth/auth-user";
import { AuditService } from "../audit/audit.service";
import type { EmailTheme } from "../mail/email-theme";
import type { EmailStream } from "../mail/email-templates";
import { PrismaService } from "../prisma/prisma.service";
import {
  EMAIL_STREAMS,
  type EmailStreamKey,
  type UpdateEmailSettingsInput,
} from "./dto/email-settings.schemas";

/** What Firm Admin Settings stores under settingsJson.email (all optional). */
interface StoredEmailSettings {
  supportEmail?: string;
  fromName?: string;
  buttonAccent?: "navy" | "gold";
  showBrandLockup?: boolean;
  senders?: Partial<Record<EmailStreamKey, string>>;
}

/** The merged, defaulted view served to the settings UI. */
export interface EmailSettingsDto {
  /** The firm's display name (firm.name) — shown in every email and the portal. */
  firmName: string;
  supportEmail: string;
  fromName: string;
  buttonAccent: "navy" | "gold";
  showBrandLockup: boolean;
  senders: Record<EmailStreamKey, string>; // "" = fall back to MAIL_FROM_EMAIL
  /** The env fallback address a blank sender resolves to (read-only). */
  fallbackFromEmail: string;
}

/** Everything a sending flow needs: the theme + per-stream sender identity. */
export interface EmailContext {
  theme: EmailTheme;
  /** Footer address for billing-stream emails (billing sender or support). */
  billingFooterEmail: string;
  senderFor(stream: EmailStream): { fromEmail?: string; fromName: string };
}

export const DEFAULT_SUPPORT_EMAIL = "support@mcrctas.com";

/**
 * Firm Admin Settings → transactional-email configuration. supportEmail, the
 * per-stream sender identities, the buttonAccent brand switch, and the brand
 * lockup toggle all live in Firm.settingsJson.email — configurable from the
 * portal, never hard-coded in templates (design-handoff requirement).
 */
@Injectable()
export class EmailSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  private defaults(): Omit<EmailSettingsDto, "senders" | "firmName"> {
    return {
      supportEmail: DEFAULT_SUPPORT_EMAIL,
      fromName: this.config.get<string>("MAIL_FROM_NAME", "MCRC Tax & Accounting") ?? "",
      buttonAccent: "navy",
      showBrandLockup: true,
      // Mirror MailService: MAIL_FROM is primary, MAIL_FROM_EMAIL the fallback.
      fallbackFromEmail:
        this.config.get<string>("MAIL_FROM", "") ||
        this.config.get<string>("MAIL_FROM_EMAIL", "") ||
        "",
    };
  }

  private async stored(firmId: string): Promise<StoredEmailSettings> {
    const firm = await this.prisma.firm.findUnique({
      where: { id: firmId },
      select: { settingsJson: true },
    });
    const s = firm?.settingsJson;
    if (s && typeof s === "object" && !Array.isArray(s)) {
      const email = (s as Record<string, unknown>).email;
      if (email && typeof email === "object" && !Array.isArray(email)) {
        return email as StoredEmailSettings;
      }
    }
    return {};
  }

  async getSettings(firmId: string): Promise<EmailSettingsDto> {
    const [stored, firm] = await Promise.all([
      this.stored(firmId),
      this.prisma.firm.findUnique({ where: { id: firmId }, select: { name: true } }),
    ]);
    const d = this.defaults();
    return {
      firmName: firm?.name ?? "",
      supportEmail: stored.supportEmail || d.supportEmail,
      fromName: stored.fromName || d.fromName,
      buttonAccent: stored.buttonAccent ?? d.buttonAccent,
      showBrandLockup: stored.showBrandLockup ?? d.showBrandLockup,
      senders: Object.fromEntries(
        EMAIL_STREAMS.map((k) => [k, stored.senders?.[k] ?? ""]),
      ) as Record<EmailStreamKey, string>,
      fallbackFromEmail: d.fallbackFromEmail,
    };
  }

  async updateSettings(
    actor: AuthUser,
    input: UpdateEmailSettingsInput,
  ): Promise<EmailSettingsDto> {
    const firm = await this.prisma.firm.findUniqueOrThrow({
      where: { id: actor.firmId },
      select: { settingsJson: true },
    });
    const root =
      firm.settingsJson && typeof firm.settingsJson === "object" && !Array.isArray(firm.settingsJson)
        ? (firm.settingsJson as Record<string, unknown>)
        : {};
    const current = await this.stored(actor.firmId);
    const next: StoredEmailSettings = {
      ...current,
      ...(input.supportEmail !== undefined ? { supportEmail: input.supportEmail } : {}),
      ...(input.fromName !== undefined ? { fromName: input.fromName } : {}),
      ...(input.buttonAccent !== undefined ? { buttonAccent: input.buttonAccent } : {}),
      ...(input.showBrandLockup !== undefined
        ? { showBrandLockup: input.showBrandLockup }
        : {}),
      ...(input.senders !== undefined
        ? { senders: { ...current.senders, ...input.senders } }
        : {}),
    };
    await this.prisma.firm.update({
      where: { id: actor.firmId },
      data: {
        // The firm's display name lives on the firm row, not in settingsJson.
        ...(input.firmName !== undefined ? { name: input.firmName } : {}),
        settingsJson: { ...root, email: next } as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record({
      userId: actor.id,
      action: "settings.email.update",
      entityType: "Firm",
      entityId: actor.firmId,
      metadata: { firmId: actor.firmId, fields: Object.keys(input) },
    });
    return this.getSettings(actor.firmId);
  }

  /** Resolve the theme + sender identities a sending flow should use. */
  async resolveContext(firmId: string): Promise<EmailContext> {
    const [settings, firm] = await Promise.all([
      this.getSettings(firmId),
      this.prisma.firm.findUnique({ where: { id: firmId }, select: { name: true } }),
    ]);
    const theme: EmailTheme = {
      firmName: firm?.name ?? "MCRC Tax & Accounting Services",
      supportEmail: settings.supportEmail,
      buttonAccent: settings.buttonAccent,
      showBrandLockup: settings.showBrandLockup,
    };
    return {
      theme,
      billingFooterEmail: settings.senders.billing || settings.supportEmail,
      senderFor: (stream) => ({
        // Blank override → MailService falls back to MAIL_FROM_EMAIL.
        fromEmail: settings.senders[stream] || undefined,
        fromName: settings.fromName,
      }),
    };
  }
}
