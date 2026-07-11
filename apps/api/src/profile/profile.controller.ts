import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  PayloadTooLargeException,
  Put,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import type { AuthUser } from "../common/auth/auth-user";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { readRawBody } from "../clients/clients.controller";
import {
  AVATAR_ALLOWED_TYPES,
  AVATAR_MAX_BYTES,
  StorageService,
} from "../storage/storage.service";
import { UpdateProfileInput, UpdateProfileSchema } from "./dto/profile.schemas";
import { ProfileService } from "./profile.service";

/**
 * Self-service account endpoints. No `@RequirePermissions`: a user always manages
 * their OWN account, identified by the JWT (`@CurrentUser`).
 */
@ApiTags("profile")
@Controller("profile")
export class ProfileController {
  constructor(
    private readonly profile: ProfileService,
    private readonly storage: StorageService,
  ) {}

  @Get("me")
  getMe(@CurrentUser() user: AuthUser) {
    return this.profile.getMe(user);
  }

  @Patch("me")
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.profile.updateMe(user, body);
  }

  /** Store the uploaded avatar (raw image body) and return a fresh signed URL. */
  @Put("me/avatar")
  async uploadAvatar(@CurrentUser() user: AuthUser, @Req() req: Request) {
    if (!this.storage.isEnabled()) {
      throw new ServiceUnavailableException("Avatar storage not configured");
    }
    // Fast reject on the declared size (browsers set Content-Length on a File PUT)
    // so an oversize upload gets a clean 413 without streaming the whole body.
    const declaredLength = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > AVATAR_MAX_BYTES) {
      throw new PayloadTooLargeException(
        "File is too large — the maximum avatar size is 5 MB.",
      );
    }
    // Media types are case-insensitive (RFC 7231); normalise before matching.
    const contentType = (req.headers["content-type"] ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";
    if (!AVATAR_ALLOWED_TYPES.includes(contentType)) {
      throw new BadRequestException(
        "Unsupported file type. Please upload a PNG, JPEG, or WebP image.",
      );
    }
    const bytes = await readRawBody(req, AVATAR_MAX_BYTES);
    if (bytes.byteLength === 0) throw new BadRequestException("Empty file.");
    return this.profile.uploadAvatar(user, bytes, contentType);
  }

  /** Remove the user's avatar (best-effort delete + clear the key). */
  @Delete("me/avatar")
  removeAvatar(@CurrentUser() user: AuthUser) {
    return this.profile.removeAvatar(user);
  }
}
