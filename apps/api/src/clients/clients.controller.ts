import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import type { AuthUser, IntegrationPrincipal } from "../common/auth/auth-user";
import { CurrentIntegration } from "../common/decorators/current-integration.decorator";
import { CurrentUser } from "../common/decorators/current-user.decorator";
import { RequirePermissions } from "../common/decorators/require-permissions.decorator";
import { RequireScopes } from "../common/decorators/require-scopes.decorator";
import { ZodValidationPipe } from "../common/validation/zod-validation.pipe";
import { COR_ALLOWED_TYPES, COR_MAX_BYTES, StorageService } from "../storage/storage.service";
import { ClientsService } from "./clients.service";
import {
  CreateClientInput,
  CreateClientSchema,
  UpdateClientInput,
  UpdateClientSchema,
} from "./dto/client.schemas";

/**
 * Read the raw request body as a Buffer, aborting once it exceeds `maxBytes`.
 * The COR PUT sends raw binary (a File) with the file's own Content-Type — not
 * JSON and not multipart — so Nest's JSON body parser leaves the stream intact
 * (it only consumes application/json), and we drain it here ourselves.
 */
function readRawBody(req: Request, maxBytes: number): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on("data", (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Stop accumulating but DON'T destroy the socket — the response shares it,
        // and tearing it down would prevent the clean 413 from reaching the client.
        aborted = true;
        req.pause();
        reject(
          new PayloadTooLargeException(
            "File is too large — the maximum COR size is 10 MB.",
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (!aborted) resolve(Buffer.concat(chunks));
    });
    req.on("error", (err) => reject(err));
  });
}

@ApiTags("clients")
@Controller("clients")
export class ClientsController {
  constructor(
    private readonly clients: ClientsService,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @RequirePermissions("Clients:Create")
  create(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateClientSchema)) body: CreateClientInput,
  ) {
    return this.clients.create(user, body);
  }

  // Dual-auth reads: a firm USER (RBAC-scoped) or the BIR Generator's machine
  // token (firm-scoped, `clients:read`). Exactly one principal is set by the guards.
  @Get()
  @RequirePermissions("Clients:Read")
  @RequireScopes("clients:read")
  list(
    @CurrentUser() user: AuthUser | undefined,
    @CurrentIntegration() integration: IntegrationPrincipal | undefined,
    @Query("query") query?: string,
  ) {
    if (integration) return this.clients.listForFirm(integration.firmId, query);
    return this.clients.listVisible(user as AuthUser);
  }

  @Get(":clientId")
  @RequirePermissions("Clients:Read")
  @RequireScopes("clients:read")
  get(
    @CurrentUser() user: AuthUser | undefined,
    @CurrentIntegration() integration: IntegrationPrincipal | undefined,
    @Param("clientId") clientId: string,
  ) {
    if (integration) return this.clients.getForFirm(integration.firmId, clientId);
    return this.clients.get(user as AuthUser, clientId);
  }

  @Patch(":clientId")
  @RequirePermissions("Clients:Update")
  update(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Body(new ZodValidationPipe(UpdateClientSchema)) body: UpdateClientInput,
  ) {
    return this.clients.update(user, clientId, body);
  }

  // --- COR file storage ------------------------------------------------------
  // Firm-user only (no @RequireScopes): the BIR Generator never uploads CORs.

  /** Store the uploaded COR file (raw binary body) and record its object key. */
  @Put(":clientId/cor")
  @RequirePermissions("Clients:Update")
  async uploadCor(
    @CurrentUser() user: AuthUser,
    @Param("clientId") clientId: string,
    @Req() req: Request,
  ) {
    if (!this.storage.isEnabled()) {
      throw new ServiceUnavailableException("COR storage not configured");
    }
    // Fast reject on the declared size (browsers set Content-Length on a File PUT)
    // so an oversize upload gets a clean 413 without streaming the whole body.
    const declaredLength = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(declaredLength) && declaredLength > COR_MAX_BYTES) {
      throw new PayloadTooLargeException(
        "File is too large — the maximum COR size is 10 MB.",
      );
    }
    // Media types are case-insensitive (RFC 7231); normalise before matching.
    const contentType = (req.headers["content-type"] ?? "")
      .split(";")[0]
      ?.trim()
      .toLowerCase() ?? "";
    if (!COR_ALLOWED_TYPES.includes(contentType)) {
      throw new BadRequestException(
        "Unsupported file type. Please upload a PDF, PNG, JPEG, or WebP.",
      );
    }
    const bytes = await readRawBody(req, COR_MAX_BYTES);
    if (bytes.byteLength === 0) throw new BadRequestException("Empty file.");
    return this.clients.uploadCor(user, clientId, bytes, contentType);
  }

  /** Return a short-lived signed URL for the stored COR, or `{ url: null }`. */
  @Get(":clientId/cor-url")
  @RequirePermissions("Clients:Read")
  corUrl(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    if (!this.storage.isEnabled()) {
      throw new ServiceUnavailableException("COR storage not configured");
    }
    return this.clients.corSignedUrl(user, clientId);
  }

  /** Delete the stored COR and clear the key on the client. */
  @Delete(":clientId/cor")
  @RequirePermissions("Clients:Update")
  removeCor(@CurrentUser() user: AuthUser, @Param("clientId") clientId: string) {
    if (!this.storage.isEnabled()) {
      throw new ServiceUnavailableException("COR storage not configured");
    }
    return this.clients.removeCor(user, clientId);
  }
}
