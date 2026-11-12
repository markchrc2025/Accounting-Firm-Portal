// client-delete.spec.ts — U25 (D72): the words of a client delete, and who may do it.
import {
  CLIENT_DELETE_BLOCKER_KINDS,
  CLIENT_DELETE_KINDS,
  CLIENT_UNLINK_KINDS,
} from "@portal/shared";
import {
  NAME_MISMATCH,
  blockerPhrase,
  foldName,
  nameToType,
  refusalSentence,
} from "./client-delete";
import { DEFAULT_ROLES } from "../rbac/permissions.constants";

describe("U25 · the sentences of a refused delete", () => {
  it("each blocker, one and many", () => {
    expect(blockerPhrase("filedBirReturns", 1)).toBe("1 filed BIR return");
    expect(blockerPhrase("filedBirReturns", 3)).toBe("3 filed BIR returns");
    expect(blockerPhrase("sentInvoices", 1)).toBe("1 sent invoice");
    expect(blockerPhrase("sentInvoices", 2)).toBe("2 sent invoices");
    expect(blockerPhrase("billedForInvoices", 1)).toBe(
      "1 invoice billed for it under another client",
    );
    expect(blockerPhrase("billedForInvoices", 4)).toBe(
      "4 invoices billed for it under another client",
    );
    expect(blockerPhrase("linkedProjects", 1)).toBe("1 linked project");
    expect(blockerPhrase("linkedProjects", 2)).toBe("2 linked projects");
    expect(blockerPhrase("subClients", 1)).toBe("1 sub-client billed under it");
    expect(blockerPhrase("subClients", 5)).toBe("5 sub-clients billed under it");
  });

  it("one, two and three blockers make one sentence, the owner's example word for word", () => {
    expect(refusalSentence([{ kind: "linkedProjects", count: 1 }])).toBe(
      "This client cannot be deleted: it has 1 linked project. Archive it instead.",
    );
    expect(
      refusalSentence([
        { kind: "filedBirReturns", count: 3 },
        { kind: "sentInvoices", count: 2 },
      ]),
    ).toBe(
      "This client cannot be deleted: it has 3 filed BIR returns and 2 sent invoices. Archive it instead.",
    );
    expect(
      refusalSentence([
        { kind: "filedBirReturns", count: 1 },
        { kind: "sentInvoices", count: 1 },
        { kind: "subClients", count: 2 },
      ]),
    ).toBe(
      "This client cannot be deleted: it has 1 filed BIR return, 1 sent invoice and 2 sub-clients billed under it. Archive it instead.",
    );
  });

  it("the name sentence", () => {
    expect(NAME_MISMATCH).toBe("Type the client's name exactly to delete it.");
  });
});

describe("U25 · the name to type", () => {
  it("folds case and runs of spaces, tabs and line breaks; nothing else", () => {
    expect(foldName("  Halimbawa   TRADING\tCorp\n")).toBe("halimbawa trading corp");
    expect(foldName("DELA CRUZ, JUAN")).not.toBe(foldName("DELA CRUZ,JUAN"));
    expect(foldName(undefined)).toBe("");
  });

  it("a company's registered name; an individual's LAST, FIRST MIDDLE; else the client's name", () => {
    expect(
      nameToType({
        kind: "non-individual",
        regName: " SAMPLE CORP ",
        businessName: "Sample",
      }),
    ).toBe("SAMPLE CORP");
    expect(
      nameToType({
        kind: "individual",
        lastName: "DELA CRUZ",
        firstName: "JUAN",
        middleName: null,
        businessName: "Juan's Store",
      }),
    ).toBe("DELA CRUZ, JUAN");
    expect(
      nameToType({ kind: "non-individual", regName: null, businessName: "Sample" }),
    ).toBe("Sample");
    expect(
      nameToType({
        kind: "individual",
        lastName: "DELA CRUZ",
        businessName: "Juan's Store",
      }),
    ).toBe("Juan's Store");
  });
});

describe("U25 · the lists and the permission", () => {
  it("the shared lists hold the kinds the API names, once each", () => {
    for (const list of [
      CLIENT_DELETE_BLOCKER_KINDS,
      CLIENT_DELETE_KINDS,
      CLIENT_UNLINK_KINDS,
    ]) {
      expect(new Set(list).size).toBe(list.length);
    }
    expect([...CLIENT_DELETE_BLOCKER_KINDS]).toEqual([
      "filedBirReturns",
      "sentInvoices",
      "billedForInvoices",
      "linkedProjects",
      "subClients",
    ]);
    expect([...CLIENT_UNLINK_KINDS]).toEqual(["fsReports"]);
  });

  it("Super Admin is the only default role that holds Clients:Delete", () => {
    const holders = DEFAULT_ROLES.filter((r) => r.permissions.includes("Clients:Delete"));
    expect(holders.map((r) => r.name)).toEqual(["Super Admin"]);
  });
});
