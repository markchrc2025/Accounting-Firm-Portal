// notifications.service.ts — PA2 (D66): generic notifications for any part of the Portal.
//
// A change that should tell someone calls record() INSIDE its own transaction, so the row is
// written with the change and is gone with it if the change rolls back. record() returns what
// may need an email; the caller calls deliver() AFTER the transaction has committed, which sends
// the email to the people who switched email on. A mail failure is logged and never reaches the
// caller: it can never roll a change back.
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { Prisma } from "@prisma/client";
import { MailService } from "../mail/mail.service";
import { notificationEmail } from "../mail/email-templates";
import { PrismaService } from "../prisma/prisma.service";
import { EmailSettingsService } from "../settings/email-settings.service";

export interface NotificationInput {
  firmId: string;
  /** Who to tell. Repeats are told once. */
  userIds: string[];
  kind: string;
  title: string;
  body?: string;
  /** A path in the web app. */
  link?: string;
  entityType?: string;
  entityId?: string | null;
}

/** A notification written, which may also need an email once the change has committed. */
export interface PendingNotification {
  id: string;
  firmId: string;
  userId: string;
  title: string;
  body: string;
  link: string;
}

export const NOTIFICATION_NOT_FOUND = "Notification not found.";

export function notificationDto(n: {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string;
  entityType: string;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
}) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    entityType: n.entityType,
    entityId: n.entityId,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly config: ConfigService,
  ) {}

  /** Write one notification per person, inside the caller's transaction. */
  async record(
    tx: Prisma.TransactionClient,
    input: NotificationInput,
  ): Promise<PendingNotification[]> {
    const pending: PendingNotification[] = [];
    for (const userId of [...new Set(input.userIds)]) {
      const row = await tx.notification.create({
        data: {
          firmId: input.firmId,
          userId,
          kind: input.kind,
          title: input.title,
          body: input.body ?? "",
          link: input.link ?? "",
          entityType: input.entityType ?? "",
          entityId: input.entityId ?? null,
        },
      });
      pending.push({
        id: row.id,
        firmId: input.firmId,
        userId,
        title: row.title,
        body: row.body,
        link: row.link,
      });
    }
    return pending;
  }

  /**
   * After the transaction has committed: email each person who switched email on. Never throws.
   */
  async deliver(pending: PendingNotification[]): Promise<void> {
    if (pending.length === 0) return;
    try {
      if (!this.mail.isEnabled()) return;
      const prefs = await this.prisma.notificationPreference.findMany({
        where: { userId: { in: pending.map((p) => p.userId) }, emailEnabled: true },
        select: { userId: true },
      });
      const on = new Set(prefs.map((p) => p.userId));
      const webUrl = (
        this.config.get<string>("WEB_APP_URL", "https://acctgfirm.mcrctas.com") ?? ""
      ).replace(/\/+$/, "");
      for (const p of pending.filter((x) => on.has(x.userId))) {
        try {
          const user = await this.prisma.user.findUnique({
            where: { id: p.userId },
            select: { email: true, status: true },
          });
          if (!user?.email || user.status !== "ACTIVE") continue;
          const ctx = await this.emailSettings.resolveContext(p.firmId);
          const rendered = notificationEmail(
            { title: p.title, body: p.body, linkUrl: p.link ? `${webUrl}${p.link}` : "" },
            ctx.theme,
          );
          await this.mail.send({
            to: user.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            ...ctx.senderFor(rendered.stream),
          });
        } catch (err) {
          this.logger.warn(
            `Notification email for ${p.id} failed: ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(`Notification emails failed: ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------------------
  // What a user does with their own notifications
  // ---------------------------------------------------------------------------------------

  async list(
    userId: string,
    opts: { order: "unread-first" | "newest"; page: number; pageSize: number },
  ) {
    const where = { userId };
    const orderBy: Prisma.NotificationOrderByWithRelationInput[] =
      opts.order === "unread-first"
        ? [
            { readAt: { sort: "asc", nulls: "first" } },
            { createdAt: "desc" },
            { id: "desc" },
          ]
        : [{ createdAt: "desc" }, { id: "desc" }];
    const [total, unread, rows] = await Promise.all([
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
      this.prisma.notification.findMany({
        where,
        orderBy,
        skip: (opts.page - 1) * opts.pageSize,
        take: opts.pageSize,
      }),
    ]);
    return {
      items: rows.map(notificationDto),
      page: opts.page,
      pageSize: opts.pageSize,
      total,
      unread,
    };
  }

  async unreadCount(userId: string) {
    return {
      count: await this.prisma.notification.count({ where: { userId, readAt: null } }),
    };
  }

  /** Mark one of the user's own notifications read (again is fine). Someone else's is a 404. */
  async markRead(userId: string, id: string) {
    const row = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.prisma.notification.findFirst({ where: { id, userId } })
      : null;
    if (!row) throw new NotFoundException(NOTIFICATION_NOT_FOUND);
    if (row.readAt) return notificationDto(row);
    return notificationDto(
      await this.prisma.notification.update({
        where: { id: row.id },
        data: { readAt: new Date() },
      }),
    );
  }

  async markAllRead(userId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  }

  async preferences(userId: string) {
    const p = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return { emailEnabled: p?.emailEnabled ?? false };
  }

  async setPreferences(userId: string, firmId: string, emailEnabled: boolean) {
    const p = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: { userId, firmId, emailEnabled },
      update: { emailEnabled },
    });
    return { emailEnabled: p.emailEnabled };
  }
}
