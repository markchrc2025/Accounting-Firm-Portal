/**
 * track-a-sso.spec.ts — Microsoft sign-in trusts an email only when the token
 * proves it (U9 R1 e, D44): a consumer account (tid 9188040d-…) or a token carrying
 * xms_edov = true. Hermetic: the real SsoService; the provider's token endpoint is
 * stubbed at its boundary (fetch) and returns an id_token with test claims.
 */
import { JwtService } from "@nestjs/jwt";
import type { ConfigService } from "@nestjs/config";
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
  return {
    svc: new SsoService(prisma, new TokenService(jwt, config), audit, jwt, config),
    prisma,
  };
}

const idToken = (claims: Record<string, unknown>) =>
  `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.sig`;

describe("U9 T3 · Microsoft sign-in trusts a proven email only", () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, "fetch" as never);
  });
  afterEach(() => fetchMock.mockRestore());

  async function signIn(claims: Record<string, unknown>) {
    const { svc, prisma } = build();
    const state = new URL(svc.startUrl("microsoft")).searchParams.get("state")!;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ access_token: "t", id_token: idToken(claims) }),
      text: async () => "",
    } as unknown as Response);
    const result = await svc
      .handleCallback("microsoft", "c", state)
      .catch((e: unknown) => e);
    return { result, prisma };
  }

  it("an organizational token without xms_edov is refused, and no account is looked up", async () => {
    const { result, prisma } = await signIn({
      tid: ORG_TID,
      preferred_username: "test-staff@example.com",
    });
    expect(result).toMatchObject({ code: "email-unverified" });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("an organizational token with xms_edov false is refused", async () => {
    const { result } = await signIn({
      tid: ORG_TID,
      xms_edov: false,
      email: "test-staff@example.com",
    });
    expect(result).toMatchObject({ code: "email-unverified" });
  });

  it("a consumer-tenant token is accepted", async () => {
    const { result } = await signIn({
      tid: CONSUMER_TID,
      email: "test-staff@example.com",
    });
    expect(result).toMatchObject({ kind: "access" });
  });

  it("an organizational token with xms_edov true is accepted", async () => {
    const { result } = await signIn({
      tid: ORG_TID,
      xms_edov: true,
      email: "test-staff@example.com",
    });
    expect(result).toMatchObject({ kind: "access" });
  });
});
