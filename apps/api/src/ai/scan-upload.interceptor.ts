/**
 * scan-upload.interceptor.ts — the multipart "files" field of POST /receipt-scans:
 * 1–100 files, each ≤ 10 MB. They stream to temporary files on disk, not memory
 * (U11-A1 R4): a pile of 100 is up to 1 GB. Every temporary file is removed when the
 * request ends, before the response goes out, whether the pile was sent or refused
 * (multer itself removes them when it refuses a pile). multer's own limit errors
 * become the 400 sentences the web shows (the contract answers 400, not 413, for a
 * pile that breaks a limit).
 */
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BadRequestException,
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import { catchError, from, map, mergeMap, throwError, type Observable } from "rxjs";

export const MAX_SCAN_FILES = 100;
export const MAX_SCAN_FILE_BYTES = 10 * 1024 * 1024;

/** Where a pile's files wait while their request is handled. */
export const SCAN_UPLOAD_DIR = join(tmpdir(), "portal-receipt-uploads");

const Multer = FilesInterceptor("files", MAX_SCAN_FILES, {
  dest: SCAN_UPLOAD_DIR,
  limits: { fileSize: MAX_SCAN_FILE_BYTES, files: MAX_SCAN_FILES },
});

@Injectable()
export class ScanUploadInterceptor implements NestInterceptor {
  private readonly inner = new Multer();

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const req = context.switchToHttp().getRequest<{ files?: Array<{ path?: string }> }>();
    const removeFiles = () =>
      Promise.all(
        (req.files ?? []).map((f) =>
          f.path ? rm(f.path, { force: true }).catch(() => undefined) : undefined,
        ),
      );
    try {
      const handled = await this.inner.intercept(context, next);
      return handled.pipe(
        mergeMap((body) => from(removeFiles()).pipe(map(() => body))),
        catchError((err: unknown) =>
          from(removeFiles()).pipe(mergeMap(() => throwError(() => err))),
        ),
      );
    } catch (err) {
      await removeFiles();
      const msg =
        err instanceof HttpException
          ? String((err.getResponse() as { message?: unknown }).message ?? err.message)
          : "";
      if (/too large/i.test(msg)) {
        throw new BadRequestException(
          "One of the files is larger than 10 MB. Each file must be 10 MB or smaller.",
        );
      }
      if (/too many files|unexpected field/i.test(msg)) {
        throw new BadRequestException(
          `A pile holds at most ${MAX_SCAN_FILES} files, sent in the "files" field.`,
        );
      }
      throw err;
    }
  }
}
