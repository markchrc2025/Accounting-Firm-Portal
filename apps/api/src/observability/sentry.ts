// sentry.ts — optional error tracking + tracing for the API.
//
// Entirely opt-in: with no SENTRY_DSN set this is a no-op, so local dev and CI
// stay offline and nothing is sent anywhere. Sentry's SDK also emits
// OpenTelemetry-compatible spans, so enabling the DSN gives both error capture
// and request tracing without a second agent.
//
// initSentry() must run BEFORE the Nest app is created so the SDK can install
// its instrumentation, hence the side-effect import at the top of main.ts.

import * as Sentry from "@sentry/node";

let enabled = false;

/** True when a DSN was configured and the SDK actually initialised. */
export function sentryEnabled(): boolean {
  return enabled;
}

/**
 * Initialise Sentry when SENTRY_DSN is present. Safe to call more than once.
 *
 * Env:
 *   SENTRY_DSN                  — enables everything; unset = disabled.
 *   SENTRY_ENVIRONMENT          — e.g. "production" (defaults to NODE_ENV).
 *   SENTRY_TRACES_SAMPLE_RATE   — 0..1, defaults to 0.1 (10% of requests).
 *   SENTRY_RELEASE              — optional release/version tag.
 */
export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || enabled) return;

  const rate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1");
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number.isFinite(rate) ? Math.min(Math.max(rate, 0), 1) : 0.1,
    // Financial data: never let the SDK attach request bodies, headers or the
    // authenticated user by default. Errors carry stack + route, nothing more.
    sendDefaultPii: false,
  });
  enabled = true;
}

/**
 * Report an exception when Sentry is on. No-ops otherwise, so call sites don't
 * need to branch.
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, context ? { extra: context } : undefined);
}
