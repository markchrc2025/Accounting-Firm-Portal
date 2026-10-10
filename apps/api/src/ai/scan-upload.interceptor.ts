/**
 * scan-upload.interceptor.ts — the multipart "files" field of POST /receipt-scans:
 * 1–100 files, each ≤ 10 MB. They stream to temporary files on disk, not memory
 * (U11-A1 R4): a pile of 100 is up to 1 GB. Every temporary file is removed when the
 * request ends, before the response goes out, whether the pile was sent or refused
 * (multer itself removes them when it refuses a pile). An upload cut off mid-file
 * leaves a partial file multer never hands over: files older than an hour are swept
 * at boot and before every pile. The folder is the API user's alone (0700).
 * multer's own limit errors
 * become the 400 sentences the web shows (the contract answers 400, not 413, for a
 * pile that breaks a limit).
 */
import { chmodSync, mkdirSync } from "node:fs";
import { readdir, rm, stat } from "node:fs/promises";
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

/** A file this old belongs to no live request: a pile is prepared in minutes. */
export const STALE_UPLOAD_MS = 60 * 60 * 1000;

mkdirSync(SCAN_UPLOAD_DIR, { recursive: true, mode: 0o700 });
try {
  chmodSync(SCAN_UPLOAD_DIR, 0o700);
} catch {
  // Not ours to change (another user's folder): multer still writes into it.
}

/** Remove files older than STALE_UPLOAD_MS; returns how many were removed. */
export async function sweepStaleUploads(
  dir = SCAN_UPLOAD_DIR,
  now = Date.now(),
): Promise<number> {
  let removed = 0;
  for (const name of await readdir(dir).catch(() => [] as string[])) {
    const path = join(dir, name);
    const info = await stat(path).catch(() => null);
    if (info?.isFile() && now - info.mtimeMs > STALE_UPLOAD_MS) {
      await rm(path, { force: true }).catch(() => undefined);
      removed++;
    }
  }
  return removed;
}

const Multer = FilesInterceptor("files", MAX_SCAN_FILES, {
  dest: SCAN_UPLOAD_DIR,
  limits: { fileSize: MAX_SCAN_FILE_BYTES, files: MAX_SCAN_FILES },
});

@Injectable()
export class ScanUploadInterceptor implements NestInterceptor {
  private readonly inner = new Multer();

  constructor() {
    void sweepStaleUploads();
  }

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
    await sweepStaleUploads();
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
