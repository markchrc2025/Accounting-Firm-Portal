import { JwtService } from "@nestjs/jwt";
import type { ConfigService } from "@nestjs/config";
import { SsoError, SsoService } from "./sso.service";
import { TokenService } from "./token.service";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../prisma/prisma.service";

const ENV: Record<string, string> = {
  JWT_SECRET: "test-secret-0123456789-0123456789",
  API_PUBLIC_URL: "https://api.test",
  WEB_APP_URL: "https://web.test",
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
  MS_CLIENT_ID: "mid",
  MS_CLIENT_SECRET: "msecret",
};

function configStub(overrides: Record<string, string | undefined> = {}) {
  const values = { ...ENV, ...overrides };
  return {
    get: jest.fn((key: string, def?: string) => values[key] ?? def),
  } as unknown as ConfigService;
}

const ACTIVE_USER = {
  id: "u1",
  firmId: "f1",
  userType: "FIRM" as const,
  email: "mark@mcrctas.com",
  status: "ACTIVE",
  mfaEnabled: false,
  clientProfile: null,
};

function build(overrides: {
  config?: Record<string, string | undefined>;
  user?: unknown;
} = {}) {
  const config = configStub(overrides.config);
  const jwt = new JwtService({});
  const tokens = new TokenService(jwt, config);
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue(
        overrides.user === undefined ? ACTIVE_USER : overrides.user,
      ),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  const svc = new SsoService(prisma, tokens, audit, jwt, config);
  return { svc, prisma, audit, tokens, jwt };
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Pull the signed state out of a generated authorize URL. */
function stateOf(url: string): string {
  return new URL(url).searchParams.get("state")!;
}

/** A minimal unsigned id_token carrying the given claims (header.payload.sig). */
function fakeIdToken(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `eyJhbGciOiJub25lIn0.${payload}.sig`;
}

describe("SsoService", () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch" as never);
  });
  afterEach(() => fetchMock.mockRestore());

  it("reports providers as available only when fully configured", () => {
    expect(build().svc.providers()).toEqual({ google: true, microsoft: true });
    expect(
      build({ config: { GOOGLE_CLIENT_SECRET: "" } }).svc.providers().google,
    ).toBe(false);
    expect(
      build({ config: { API_PUBLIC_URL: "" } }).svc.providers(),
    ).toEqual({ google: false, microsoft: false });
  });

  it("builds a Google authorize URL with the registered redirect and signed state", () => {
    const { svc } = build();
    const url = new URL(svc.startUrl("google"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe("gid");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://api.test/api/v1/auth/sso/google/callback",
    );
    expect(url.searchParams.get("scope")).toBe("openid email profile");
    expect(url.searchParams.get("state")).toBeTruthy();
  });

  it("signs in an active user: code exchange → userinfo → portal access token", async () => {
    const { svc, prisma, tokens } = build();
    const state = stateOf(svc.startUrl("google"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "prov-token" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { email: "Mark@MCRCTAS.com", email_verified: true }),
      );
    const result = await svc.handleCallback("google", "auth-code", state);
    expect(result.kind).toBe("access");
    expect(tokens.verify(result.token, "access").sub).toBe("u1");
    // Email is matched lowercased.
    expect((prisma.user.findUnique as jest.Mock).mock.calls[0]![0]).toEqual(
      expect.objectContaining({ where: { email: "mark@mcrctas.com" } }),
    );
    // The code exchange posted the client credentials form.
    const [tokenUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
    expect(String(init.body)).toContain("grant_type=authorization_code");
  });

  it("routes MFA-enabled accounts through the portal's TOTP challenge", async () => {
    const { svc, tokens } = build({ user: { ...ACTIVE_USER, mfaEnabled: true } });
    const state = stateOf(svc.startUrl("google"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "t" }))
      .mockResolvedValueOnce(jsonResponse(200, { email: "mark@mcrctas.com" }));
    const result = await svc.handleCallback("google", "c", state);
    expect(result.kind).toBe("mfa");
    expect(tokens.verify(result.token, "mfa").sub).toBe("u1");
  });

  it("rejects unknown or inactive accounts uniformly (no account leak)", async () => {
    const { svc } = build({ user: null });
    const state = stateOf(svc.startUrl("google"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "t" }))
      .mockResolvedValueOnce(jsonResponse(200, { email: "stranger@x.test" }));
    await expect(svc.handleCallback("google", "c", state)).rejects.toMatchObject({
      code: "no-account",
    });
  });

  it("rejects a tampered or cross-provider state", async () => {
    const { svc } = build();
    await expect(svc.handleCallback("google", "c", "garbage")).rejects.toMatchObject({
      code: "state",
    });
    const msState = stateOf(svc.startUrl("microsoft"));
    await expect(svc.handleCallback("google", "c", msState)).rejects.toMatchObject({
      code: "state",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reads the Microsoft email from the id_token (preferred_username / UPN)", async () => {
    const { svc, prisma } = build();
    const state = stateOf(svc.startUrl("microsoft"));
    // Single call: the token exchange. Email comes from the id_token — no Graph.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        access_token: "t",
        id_token: fakeIdToken({ preferred_username: "Mark@mcrctas.com" }),
      }),
    );
    const result = await svc.handleCallback("microsoft", "c", state);
    expect(result.kind).toBe("access");
    expect(fetchMock).toHaveBeenCalledTimes(1); // no userinfo / Graph round-trip
    expect((prisma.user.findUnique as jest.Mock).mock.calls[0]![0]).toEqual(
      expect.objectContaining({ where: { email: "mark@mcrctas.com" } }),
    );
  });

  it("requests only the consentable OIDC scopes for Microsoft (no Graph User.Read)", () => {
    const scope = new URL(build().svc.startUrl("microsoft")).searchParams.get("scope");
    expect(scope).toBe("openid profile email");
  });

  it("falls back to Microsoft OIDC userinfo when the id_token lacks an email", async () => {
    const { svc } = build();
    const state = stateOf(svc.startUrl("microsoft"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "t", id_token: fakeIdToken({ sub: "x" }) }))
      .mockResolvedValueOnce(jsonResponse(200, { email: "mark@mcrctas.com" }));
    const result = await svc.handleCallback("microsoft", "c", state);
    expect(result.kind).toBe("access");
    expect((fetchMock.mock.calls[1] as [string])[0]).toBe(
      "https://graph.microsoft.com/oidc/userinfo",
    );
  });

  it("rejects unverified Google emails", async () => {
    const { svc } = build();
    const state = stateOf(svc.startUrl("google"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "t" }))
      .mockResolvedValueOnce(
        jsonResponse(200, { email: "mark@mcrctas.com", email_verified: false }),
      );
    await expect(svc.handleCallback("google", "c", state)).rejects.toBeInstanceOf(SsoError);
  });

  it("puts the portal token in the URL fragment on the callback redirect", () => {
    const { svc } = build();
    expect(svc.callbackRedirect({ kind: "access", token: "tok" })).toBe(
      "https://web.test/sso/callback#sso=access&token=tok",
    );
    expect(svc.loginRedirect("no-account")).toBe(
      "https://web.test/login?sso_error=no-account",
    );
  });
});
