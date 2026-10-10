/**
 * track-a-sso-proof.spec.ts — both providers prove the email (U9-A1 R4–R6, D46).
 * Microsoft: an organizational token's xms_edov vouches for the email claim only,
 * so without one it is refused (no preferred_username / UPN / userinfo fallback).
 * Google: email_verified must be exactly true. Each refusal redirects with
 * ?sso_error=email-unverified&provider=<provider>.
 * Hermetic: the real SsoController and SsoService; the providers are stubbed at
 * their boundary (fetch).
 */
import { JwtService } from "@nestjs/jwt";
import type { ConfigService } from "@nestjs/config";
import type { Request, Response } from "express";
import { SsoController } from "./sso.controller";
import { SsoService } from "./sso.service";
import { TokenService } from "./token.service";
import type { AuditService } from "../audit/audit.service";
import type { PrismaService } from "../prisma/prisma.service";

const CONSUMER_TID = "9188040d-6c67-4c5b-b112-36a304b66dad";
const ORG_TID = "11111111-2222-4333-8444-555555555555";

const ENV: Record<string, string> = {
  JWT_SECRET: "test-secret-0123456789-0123456789",
  API_PUBLIC_URL: "https://api.test",
  WEB_APP_URL: "https://web.test",
  MS_CLIENT_ID: "mid",
  MS_CLIENT_SECRET: "msecret",
  GOOGLE_CLIENT_ID: "gid",
  GOOGLE_CLIENT_SECRET: "gsecret",
};

function build() {
  const config = {
    get: jest.fn((k: string, d?: string) => ENV[k] ?? d),
  } as unknown as ConfigService;
  const jwt = new JwtService({});
  const prisma = {
    user: {
      findUnique: jest.fn().mockResolvedValue({
        id: "u1",
        firmId: "f1",
        userType: "FIRM",
        email: "test-staff@example.com",
        status: "ACTIVE",
        mfaEnabled: false,
        clientProfile: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
  } as unknown as PrismaService;
  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;
  const svc = new SsoService(prisma, new TokenService(jwt, config), audit, jwt, config);
  return { svc, controller: new SsoController(svc), prisma };
}

const idToken = (claims: Record<string, unknown>) =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

const json = (body: unknown) =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => "",
  }) as unknown as Response;

const UNVERIFIED = (provider: string) =>
  `https://web.test/login?sso_error=email-unverified&provider=${provider}`;

describe("U9-A1 T4 · both providers prove the email", () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch" as never);
  });
  afterEach(() => fetchMock.mockRestore());

  /** Run the real callback route; answer each provider call in turn; return the redirect. */
  async function callback(provider: "microsoft" | "google", ...responses: unknown[]) {
    const { svc, controller, prisma } = build();
    const state = new URL(svc.startUrl(provider)).searchParams.get("state")!;
    for (const r of responses) fetchMock.mockResolvedValueOnce(json(r));
    const redirect = jest.fn();
    await controller.callback(
      provider,
      "code",
      state,
      undefined,
      undefined,
      { ip: "127.0.0.1" } as Request,
      { redirect } as unknown as Response,
    );
    return { url: redirect.mock.calls[0]?.[0] as string, prisma };
  }

  describe("Microsoft", () => {
    it("an organizational token with xms_edov but no email claim is refused — no preferred_username, UPN or userinfo fallback", async () => {
      const { url, prisma } = await callback(
        "microsoft",
        {
          access_token: "t",
          id_token: idToken({
            tid: ORG_TID,
            xms_edov: true,
            preferred_username: "staff@invented-org.example",
            upn: "staff@invented-org.example",
          }),
        },
        { email: "staff@invented-org.example" }, // userinfo — must never be asked
      );
      expect(url).toBe(UNVERIFIED("microsoft"));
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("an organizational token without xms_edov is refused with the provider in the redirect", async () => {
      const { url } = await callback("microsoft", {
        access_token: "t",
        id_token: idToken({ tid: ORG_TID, email: "staff@invented-org.example" }),
      });
      expect(url).toBe(UNVERIFIED("microsoft"));
    });

    it("an organizational token with xms_edov and an email claim signs in", async () => {
      const { url } = await callback("microsoft", {
        access_token: "t",
        id_token: idToken({
          tid: ORG_TID,
          xms_edov: true,
          email: "test-staff@example.com",
        }),
      });
      expect(url).toMatch(/^https:\/\/web\.test\/sso\/callback#sso=access&token=/);
    });

    it("a consumer account is unchanged: preferred_username still signs in", async () => {
      const { url } = await callback("microsoft", {
        access_token: "t",
        id_token: idToken({
          tid: CONSUMER_TID,
          preferred_username: "test-staff@example.com",
        }),
      });
      expect(url).toMatch(/^https:\/\/web\.test\/sso\/callback#sso=access&token=/);
    });
  });

  describe("Google", () => {
    it.each([
      ["missing", {}],
      ["false", { email_verified: false }],
      ['the string "true"', { email_verified: "true" }],
    ])(
      "email_verified %s is refused with the provider in the redirect",
      async (_label, extra) => {
        const { url, prisma } = await callback(
          "google",
          { access_token: "t" },
          { email: "test-staff@example.com", ...extra },
        );
        expect(url).toBe(UNVERIFIED("google"));
        expect(prisma.user.findUnique).not.toHaveBeenCalled();
      },
    );

    it("email_verified exactly true signs in", async () => {
      const { url } = await callback(
        "google",
        { access_token: "t" },
        { email: "test-staff@example.com", email_verified: true },
      );
      expect(url).toMatch(/^https:\/\/web\.test\/sso\/callback#sso=access&token=/);
    });
  });
});
