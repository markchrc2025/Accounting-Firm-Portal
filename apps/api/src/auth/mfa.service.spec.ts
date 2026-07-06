import { authenticator } from "otplib";
import { MfaService } from "./mfa.service";

describe("MfaService", () => {
  const svc = new MfaService();

  it("enrolls with a secret and otpauth URI, and verifies a current code", () => {
    const { secret, otpauthUrl } = svc.enroll("user@example.com");
    expect(secret).toBeTruthy();
    expect(otpauthUrl).toContain("otpauth://totp/");
    // The account label is URL-encoded in the provisioning URI.
    expect(decodeURIComponent(otpauthUrl)).toContain("user@example.com");

    const code = authenticator.generate(secret);
    expect(svc.verify(secret, code)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const { secret } = svc.enroll("user@example.com");
    expect(svc.verify(secret, "000000")).toBe(false);
  });
});
