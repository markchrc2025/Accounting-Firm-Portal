// notifications.controller.ts — PA2 (D66): a user's own notifications, under /api/v1/notifications.
// Any signed-in person (firm or client portal) has their own; nobody sees another's.
import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  NotificationListQuerySchema,
  NotificationPreferencesSchema,
} from "./dto/notifications.schemas";
import type { NotificationListQuery } from "./dto/notifications.schemas";
import { NotificationsService } from "./notifications.service";

const mine = (user: AuthUser | undefined): AuthUser => {
  if (!user) throw new ForbiddenException("Not authenticated");
  return user;
};

@ApiTags("notifications")
@Controller("notifications")
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(NotificationListQuerySchema)) q: NotificationListQuery,
  ) {
    return this.notifications.list(mine(user).id, q);
  }

  @Get("unread-count")
  unreadCount(@CurrentUser() user: AuthUser) {
    return this.notifications.unreadCount(mine(user).id);
  }

  @Post("read-all")
  @HttpCode(200)
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(mine(user).id);
  }

  @Get("preferences")
  preferences(@CurrentUser() user: AuthUser) {
    return this.notifications.preferences(mine(user).id);
  }

  @Patch("preferences")
  setPreferences(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(NotificationPreferencesSchema))
    b: { emailEnabled: boolean },
  ) {
    const u = mine(user);
    return this.notifications.setPreferences(u.id, u.firmId, b.emailEnabled);
  }

  @Post(":id/read")
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.notifications.markRead(mine(user).id, id);
  }
}
