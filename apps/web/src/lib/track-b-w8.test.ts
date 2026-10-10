// track-b-w8.test.ts — the pure helpers behind W8: the Users page's Clients
// column and the assignment search (R1), and the name a 2307 payor block prints
// (R3). All data is invented.

import { describe, expect, it } from "vitest";
import { payorPrintName, type PrintParty } from "./birFiling";
import { clientsLabel, isSuperAdmin, matchesClientSearch } from "./userClients";

const roles = (...names: string[]) =>
  names.map((name) => ({ role: { name }, clientScopeId: null as string | null }));

describe("clientsLabel — the Users page's Clients column (R1)", () => {
  it("a Super Admin sees all clients, whatever its count", () => {
    expect(
      clientsLabel({ userRoles: roles("Super Admin"), assignedClientCount: 0 }),
    ).toBe("All clients");
  });
  it("any other firm user reads its count", () => {
    const u = (n: number) => ({
      userRoles: roles("Manager"),
      userType: "FIRM",
      assignedClientCount: n,
    });
    expect(clientsLabel(u(0))).toBe("No clients");
    expect(clientsLabel(u(1))).toBe("1 client");
    expect(clientsLabel(u(12))).toBe("12 clients");
  });
  it("a portal user, or an unknown count, shows nothing", () => {
    expect(
      clientsLabel({
        userRoles: roles("Client Owner"),
        userType: "CLIENT",
        assignedClientCount: 3,
      }),
    ).toBe("");
    expect(clientsLabel({ userRoles: roles("Staff") })).toBe("");
  });
  it("a Super Admin role scoped to one client is not a firm-wide Super Admin", () => {
    const scoped = [{ role: { name: "Super Admin" }, clientScopeId: "c-1" }];
    expect(isSuperAdmin({ userRoles: scoped })).toBe(false);
    expect(clientsLabel({ userRoles: scoped, assignedClientCount: 1 })).toBe("1 client");
  });
});

describe("matchesClientSearch — the assignment checklist's search (R1)", () => {
  const c = { businessName: "INVENTED ALPHA TRADING", tin: "000-101-202-00000" };
  it("matches the name, case-insensitively", () => {
    expect(matchesClientSearch(c, "alpha")).toBe(true);
    expect(matchesClientSearch(c, "bravo")).toBe(false);
  });
  it("matches the TIN with or without dashes", () => {
    expect(matchesClientSearch(c, "000-101")).toBe(true);
    expect(matchesClientSearch(c, "000101202")).toBe(true);
    expect(matchesClientSearch(c, "999")).toBe(false);
  });
  it("an empty search shows everything", () => {
    expect(matchesClientSearch(c, "  ")).toBe(true);
  });
});

describe("payorPrintName — a filed certificate always reprints (R3)", () => {
  const party = (registeredName: string, businessName: string): PrintParty => ({
    businessName,
    registeredName,
    tin: "000-121-232",
    branch: "00000",
    address: "",
    city: "",
    zip: "",
    rdo: "",
    source: "snapshot",
  });
  it("prints the registered name when the source carries it, filed or not", () => {
    expect(payorPrintName(party("INVENTED CORP", "INVENTED DISPLAY"), true)).toBe(
      "INVENTED CORP",
    );
    expect(payorPrintName(party("INVENTED CORP", "INVENTED DISPLAY"), false)).toBe(
      "INVENTED CORP",
    );
  });
  it("a filed certificate without the name fields prints its source's businessName", () => {
    expect(payorPrintName(party("", "INVENTED DISPLAY"), true)).toBe("INVENTED DISPLAY");
  });
  it("a draft without the name fields prints nothing, so it is refused", () => {
    expect(payorPrintName(party("", "INVENTED DISPLAY"), false)).toBe("");
  });
});
