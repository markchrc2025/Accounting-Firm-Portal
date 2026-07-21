import { Body, Controller, Get, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import {
  UpdateEmailSettingsInput,
  UpdateEmailSettingsSchema,
} from "./dto/email-settings.schemas";
import { EmailSettingsService } from "./email-settings.service";

/**
 * Firm Admin Settings. Gated by Users:* permissions — held only by the Super
 * Admin role (there is no dedicated Settings permission in the catalog).
 */
@ApiTags("settings")
@Controller("firm-settings")
export class SettingsController {
  constructor(private readonly emailSettings: EmailSettingsService) {}

  @Get("email")
  @RequirePermissions("Users:Read")
  getEmail(@CurrentUser() user: AuthUser) {
    return this.emailSettings.getSettings(user.firmId);
  }

  @Put("email")
  @RequirePermissions("Users:Update")
  updateEmail(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateEmailSettingsSchema)) body: UpdateEmailSettingsInput,
  ) {
    return this.emailSettings.updateSettings(user, body);
  }
}
