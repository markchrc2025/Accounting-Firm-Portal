import { ForbiddenException } from "@nestjs/common";
import { FirmUserGuard } from "./firm-user.guard";

function ctxFor(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("FirmUserGuard", () => {
  const guard = new FirmUserGuard();

  it("allows a FIRM staff principal", () => {
    expect(
      guard.canActivate(ctxFor({ user: { id: "u1", firmId: "f1", userType: "FIRM" } })),
    ).toBe(true);
  });

  it("rejects a CLIENT-portal principal (same firmId is not enough)", () => {
    expect(() =>
      guard.canActivate(
        ctxFor({ user: { id: "u2", firmId: "f1", userType: "CLIENT", clientId: "c1" } }),
      ),
    ).toThrow(ForbiddenException);
  });

  it("rejects when no user principal is attached", () => {
    expect(() => guard.canActivate(ctxFor({}))).toThrow(ForbiddenException);
  });
});
