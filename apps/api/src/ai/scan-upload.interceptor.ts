/**
 * scan-upload.interceptor.ts — the multipart "files" field of POST /receipt-scans:
 * 1–100 files, each ≤ 10 MB, held in memory (they are prepared before anything is
 * stored). multer's own limit errors become the 400 sentences the web shows (the
 * contract answers 400, not 413, for a pile that breaks a limit).
 */
import {
  BadRequestException,
  HttpException,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { FilesInterceptor } from "@nestjs/platform-express";
import type { Observable } from "rxjs";

export const MAX_SCAN_FILES = 100;
export const MAX_SCAN_FILE_BYTES = 10 * 1024 * 1024;

const Multer = FilesInterceptor("files", MAX_SCAN_FILES, {
  limits: { fileSize: MAX_SCAN_FILE_BYTES, files: MAX_SCAN_FILES },
});

@Injectable()
export class ScanUploadInterceptor implements NestInterceptor {
  private readonly inner = new Multer();

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    try {
      return await this.inner.intercept(context, next);
    } catch (err) {
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
