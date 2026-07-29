import "reflect-metadata";
// Sentry must initialise before Nest builds the app so its instrumentation can
// hook in. No-ops entirely when SENTRY_DSN is unset.
import { initSentry, sentryEnabled } from "./observability/sentry";
initSentry();

import { Logger } from "@nestjs/common";
import { HttpAdapterHost, NestFactory } from "@nestjs/core";
import { SentryExceptionFilter } from "./observability/sentry-exception.filter";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module";

const API_PREFIX = "api/v1";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.setGlobalPrefix(API_PREFIX);
  // NOTE: request validation is done with Zod schemas from @portal/shared via a
  // dedicated pipe added in Phase 1 — we intentionally avoid class-validator.
  // Expose Content-Disposition so the browser can read download filenames
  // (e.g. the FS xlsx export) cross-origin.
  app.enableCors({ exposedHeaders: ["Content-Disposition", "X-Export-Warnings"] });

  // Report 5xx to Sentry (no-op without a DSN) without changing the response.
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Accounting Firm Portal API")
    .setDescription("REST/JSON API for the Accounting Firm Portal.")
    .setVersion("0.1.0")
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, document);

  const port = Number(process.env.API_PORT ?? 3000);
  // Bind to 0.0.0.0 so the container is reachable from outside (Sliplane/Docker
  // route the exposed port to the container's external interface, not loopback).
  await app.listen(port, "0.0.0.0");
  Logger.log(
    `API listening on http://0.0.0.0:${port}/${API_PREFIX} (docs at /${API_PREFIX}/docs)`,
    "Bootstrap",
  );
  Logger.log(
    sentryEnabled()
      ? "Sentry error tracking + tracing enabled"
      : "Sentry disabled (set SENTRY_DSN to enable)",
    "Bootstrap",
  );
}

void bootstrap();
