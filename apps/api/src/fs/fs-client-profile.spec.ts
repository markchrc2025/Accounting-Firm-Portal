import { clientEntityName, clientRegisteredAddress, composeClientEntityFacts } from "./fs-client-profile";

const base = {
  businessName: "Invented Test Trading",
  regName: null as string | null,
  kind: "non-individual",
  lastName: null as string | null,
  firstName: null as string | null,
  middleName: null as string | null,
  address: "1 Halimbawa St",
  city: "Lungsod ng Halimbawa",
  province: "Halimbawa Province",
  zip: "0000",
  classification: "Single Proprietorship" as string | null,
};

describe("fs-client-profile — entity facts from a portal client", () => {
  it("prefers the BIR registered name over the display name", () => {
    expect(clientEntityName({ ...base, regName: "Invented Test Holdings OPC" })).toBe("Invented Test Holdings OPC");
    expect(clientEntityName(base)).toBe("Invented Test Trading");
  });

  it("falls back to the individual's full name", () => {
    expect(
      clientEntityName({ ...base, businessName: "", firstName: "Juana", middleName: "T.", lastName: "Testcase" }),
    ).toBe("Juana T. Testcase");
  });

  it("composes a one-line registered address, skipping blanks", () => {
    expect(clientRegisteredAddress(base)).toBe("1 Halimbawa St, Lungsod ng Halimbawa, Halimbawa Province, 0000");
    expect(clientRegisteredAddress({ ...base, address: null, zip: null })).toBe("Lungsod ng Halimbawa, Halimbawa Province");
    expect(clientRegisteredAddress({ ...base, address: null, city: null, province: null, zip: null })).toBeNull();
  });

  it("leaves fields the client DB does not carry as null (placeholders + warnings downstream)", () => {
    const facts = composeClientEntityFacts(base);
    expect(facts.businessDescription).toBeNull();
    expect(facts.entityName).toBe("Invented Test Trading");
  });
});
