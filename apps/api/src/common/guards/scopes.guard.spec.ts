import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY } from "../decorators/require-permissions.decorator";
import { SCOPES_KEY } from "../decorators/require-scopes.decorator";
import { ScopesGuard } from "./scopes.guard";

/** Build a guard whose Reflector returns the given per-route metadata. */
function guardFor(meta: { scopes?: string[]; permissions?: string[] }) {
  const reflector = {
    getAllAndOverride: (key: string) =>
      key === SCOPES_KEY
        ? meta.scopes
        : key === PERMISSIONS_KEY
          ? meta.permissions
          : undefined,
  } as unknown as Reflector;
  return new ScopesGuard(reflector);
}

function ctxFor(request: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const asUser = { user: { id: "u1", firmId: "f1" } };
const asIntegration = (scopes: string[]) => ({
  integration: { id: "ic1", firmId: "f1", scopes },
});

describe("ScopesGuard", () => {
  describe("integration caller", () => {
    it("allows when all required scopes are granted", () => {
      const guard = guardFor({ scopes: ["vat-summary:read"] });
      expect(
        guard.canActivate(ctxFor(asIntegration(["vat-summary:read", "clients:read"]))),
      ).toBe(true);
    });

    it("rejects when a required scope is missing", () => {
      const guard = guardFor({ scopes: ["vat-summary:read"] });
      expect(() => guard.canActivate(ctxFor(asIntegration(["clients:read"])))).toThrow(
        ForbiddenException,
      );
    });

    it("rejects integration tokens on non-integration (user-only) endpoints", () => {
      const guard = guardFor({ permissions: ["Clients:Read"] }); // no scopes
      expect(() => guard.canActivate(ctxFor(asIntegration(["clients:read"])))).toThrow(
        ForbiddenException,
      );
    });
  });

  describe("user caller", () => {
    it("passes plain user endpoints (no scopes declared)", () => {
      const guard = guardFor({ permissions: ["Clients:Read"] });
      expect(guard.canActivate(ctxFor(asUser))).toBe(true);
    });

    it("allows a user on a DUAL endpoint (perms + scopes)", () => {
      const guard = guardFor({ permissions: ["Clients:Read"], scopes: ["clients:read"] });
      expect(guard.canActivate(ctxFor(asUser))).toBe(true);
    });

    it("rejects a user on a scope-only (machine) endpoint", () => {
      const guard = guardFor({ scopes: ["vat-summary:read"] });
      expect(() => guard.canActivate(ctxFor(asUser))).toThrow(ForbiddenException);
    });
  });
});
