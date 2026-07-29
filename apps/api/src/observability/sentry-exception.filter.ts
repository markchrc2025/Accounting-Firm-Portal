import { ArgumentsHost, Catch, HttpException, HttpStatus } from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import { captureException } from "./sentry";

/**
 * Reports unhandled errors to Sentry, then defers to Nest's default handling so
 * the HTTP response is unchanged.
 *
 * Only *unexpected* failures are reported: an HttpException below 500 is a
 * normal outcome (400 validation, 401/403 auth, 404 missing) and would drown the
 * signal, so those pass straight through.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      const req = host.switchToHttp().getRequest<{ method?: string; url?: string }>();
      captureException(exception, { method: req?.method, url: req?.url });
    }

    super.catch(exception, host);
  }
}
