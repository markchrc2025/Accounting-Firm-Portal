import { clientEntityName, clientRegisteredAddress, composeClientEntityFacts } from "./fs-client-profile";

const base = {
  businessName: "Hebrews Milktea",
  regName: null as string | null,
  kind: "non-individual",
  lastName: null as string | null,
  firstName: null as string | null,
  middleName: null as string | null,
  address: "76 Cambridge St",
  city: "Quezon City",
  province: "Metro Manila",
  zip: "1102",
  classification: "Single Proprietorship" as string | null,
};

describe("fs-client-profile — entity facts from a portal client", () => {
  it("prefers the BIR registered name over the display name", () => {
    expect(clientEntityName({ ...base, regName: "SAGD Development OPC" })).toBe("SAGD Development OPC");
    expect(clientEntityName(base)).toBe("Hebrews Milktea");
  });

  it("falls back to the individual's full name", () => {
    expect(
      clientEntityName({ ...base, businessName: "", firstName: "Juan", middleName: "S.", lastName: "Dela Cruz" }),
    ).toBe("Juan S. Dela Cruz");
  });

  it("composes a one-line registered address, skipping blanks", () => {
    expect(clientRegisteredAddress(base)).toBe("76 Cambridge St, Quezon City, Metro Manila, 1102");
    expect(clientRegisteredAddress({ ...base, address: null, zip: null })).toBe("Quezon City, Metro Manila");
    expect(clientRegisteredAddress({ ...base, address: null, city: null, province: null, zip: null })).toBeNull();
  });

  it("leaves fields the client DB does not carry as null (placeholders + warnings downstream)", () => {
    const facts = composeClientEntityFacts(base);
    expect(facts.businessDescription).toBeNull();
    expect(facts.entityName).toBe("Hebrews Milktea");
  });
});
