import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from "@nestjs/common";
import { sentryEnabled, captureException, initSentry } from "./sentry";
import { SentryExceptionFilter } from "./sentry-exception.filter";

/**
 * Observability is opt-in. These lock in the property that matters for CI and
 * local dev: with no SENTRY_DSN nothing initialises and nothing is sent.
 */
describe("Sentry observability", () => {
  it("stays disabled when SENTRY_DSN is unset", () => {
    delete process.env.SENTRY_DSN;
    initSentry();
    expect(sentryEnabled()).toBe(false);
  });

  it("captureException is a safe no-op while disabled", () => {
    expect(() => captureException(new Error("boom"), { url: "/x" })).not.toThrow();
  });
});

describe("SentryExceptionFilter", () => {
  /** Minimal host + adapter so the filter can run without a Nest app. */
  function makeHost(): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ method: "GET", url: "/api/v1/thing" }),
        getResponse: () => ({}),
      }),
    } as unknown as ArgumentsHost;
  }

  function makeFilter() {
    const filter = new SentryExceptionFilter({} as never);
    const superCatch = jest
      .spyOn(Object.getPrototypeOf(SentryExceptionFilter.prototype), "catch")
      .mockImplementation(() => undefined);
    return { filter, superCatch };
  }

  afterEach(() => jest.restoreAllMocks());

  it("passes a 4xx straight through to the default handler", () => {
    const { filter, superCatch } = makeFilter();
    const err = new BadRequestException("nope");
    filter.catch(err, makeHost());
    expect(superCatch).toHaveBeenCalledWith(err, expect.anything());
  });

  it("still delegates for a 5xx so the HTTP response is unchanged", () => {
    const { filter, superCatch } = makeFilter();
    const err = new HttpException("kaboom", HttpStatus.INTERNAL_SERVER_ERROR);
    filter.catch(err, makeHost());
    expect(superCatch).toHaveBeenCalledWith(err, expect.anything());
  });

  it("handles a non-HttpException (treated as 500) without throwing", () => {
    const { filter, superCatch } = makeFilter();
    const err = new Error("unexpected");
    expect(() => filter.catch(err, makeHost())).not.toThrow();
    expect(superCatch).toHaveBeenCalled();
  });
});
