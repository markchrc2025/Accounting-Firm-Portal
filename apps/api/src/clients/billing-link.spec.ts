import { billingLinkError } from "./billing-link";

describe("billingLinkError — sub-client link rules", () => {
  const parent = { id: "A", billingParentId: null };

  it("accepts a plain one-level link", () => {
    expect(billingLinkError({ clientId: "B", parent, clientSubCount: 0 })).toBeNull();
  });

  it("accepts a link while creating a new client (no id yet)", () => {
    expect(billingLinkError({ clientId: null, parent, clientSubCount: 0 })).toBeNull();
  });

  it("rejects a missing / cross-firm parent", () => {
    expect(billingLinkError({ clientId: "B", parent: null, clientSubCount: 0 })).toMatch(/not found/);
  });

  it("rejects self-parenting", () => {
    expect(billingLinkError({ clientId: "A", parent, clientSubCount: 0 })).toMatch(/under itself/);
  });

  it("rejects chains: the parent is itself a sub-client", () => {
    expect(
      billingLinkError({ clientId: "C", parent: { id: "B", billingParentId: "A" }, clientSubCount: 0 }),
    ).toMatch(/one level deep/);
  });

  it("rejects a client that already has sub-clients becoming a sub-client", () => {
    expect(billingLinkError({ clientId: "A", parent: { id: "X", billingParentId: null }, clientSubCount: 2 })).toMatch(
      /has sub-clients/,
    );
  });
});
