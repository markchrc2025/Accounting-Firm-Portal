// track-b-w26.test.ts - W26: the name to type is compared the way the API compares it (D72,
// apps/api/src/clients/client-delete.ts foldName), and each kind reads in plain words.
import { CLIENT_DELETE_KINDS, CLIENT_UNLINK_KINDS } from "@portal/shared";
import { describe, expect, it } from "vitest";
import {
  CANNOT_UNDO,
  DELETE_KIND_LABELS,
  DELETED_NOTE,
  deleteLine,
  FILES_NOT_REMOVED_NOTE,
  foldName,
  nameMatches,
  UNLINK_KIND_LABELS,
  unlinkLine,
} from "./clientDelete";

describe("W26 the typed name", () => {
  it("folds case and runs of spaces, tabs and line breaks; nothing else (the API's cases)", () => {
    expect(foldName("  Halimbawa   TRADING\tCorp\n")).toBe("halimbawa trading corp");
    expect(foldName("DELA CRUZ, JUAN")).not.toBe(foldName("DELA CRUZ,JUAN"));
    expect(foldName("")).toBe("");
  });
  it("matches with other case and extra spaces, not with another name or nothing", () => {
    const name = "DELA CRUZ, JUAN SANTOS";
    expect(nameMatches("dela cruz, juan santos", name)).toBe(true);
    expect(nameMatches("  Dela   Cruz,  Juan Santos ", name)).toBe(true);
    expect(nameMatches("DELA CRUZ JUAN SANTOS", name)).toBe(false);
    expect(nameMatches("DELA CRUZ, JUAN", name)).toBe(false);
    expect(nameMatches("   ", name)).toBe(false);
    expect(nameMatches("", "")).toBe(false);
  });
});

describe("W26 the words", () => {
  it("has a label for every kind the API can list, one and many", () => {
    expect(Object.keys(DELETE_KIND_LABELS).sort()).toEqual(
      [...CLIENT_DELETE_KINDS].sort(),
    );
    expect(Object.keys(UNLINK_KIND_LABELS).sort()).toEqual(
      [...CLIENT_UNLINK_KINDS].sort(),
    );
  });
  it("uses these plain words per kind, one and many", () => {
    expect(DELETE_KIND_LABELS).toEqual({
      incomeTransactions: ["income record", "income records"],
      purchaseTransactions: ["purchase record", "purchase records"],
      categories: ["category", "categories"],
      birFormDrafts: ["draft BIR return", "draft BIR returns"],
      birFormDraftFiles: [
        "stored file of a draft BIR return",
        "stored files of draft BIR returns",
      ],
      birFilingsNotFiled: ["BIR filing record not filed", "BIR filing records not filed"],
      receiptScans: ["receipt scan", "receipt scans"],
      receiptScanFiles: ["stored receipt photo", "stored receipt photos"],
      inputTaxAssets: ["input tax asset", "input tax assets"],
      taxRules: ["tax rule", "tax rules"],
      draftInvoices: ["draft invoice", "draft invoices"],
      corFiles: ["COR file", "COR files"],
      clientUserProfiles: ["client portal user profile", "client portal user profiles"],
      invitations: ["invitation", "invitations"],
      clientRoleGrants: ["client role grant", "client role grants"],
      staffAssignments: ["staff assignment", "staff assignments"],
    });
    expect(UNLINK_KIND_LABELS).toEqual({
      fsReports: ["financial statement report", "financial statement reports"],
    });
  });
  it("reads counts in plain words", () => {
    expect(deleteLine("purchaseTransactions", 124)).toBe("124 purchase records");
    expect(deleteLine("birFormDrafts", 2)).toBe("2 draft BIR returns");
    expect(deleteLine("corFiles", 1)).toBe("1 COR file");
    expect(deleteLine("categories", 1)).toBe("1 category");
    expect(unlinkLine("fsReports", 1)).toBe(
      "1 financial statement report, kept and unlinked",
    );
    expect(unlinkLine("fsReports", 3)).toBe(
      "3 financial statement reports, kept and unlinked",
    );
  });
  it("says the owner's sentences", () => {
    expect(DELETED_NOTE).toBe("Client deleted.");
    expect(FILES_NOT_REMOVED_NOTE).toBe(
      "Some stored files could not be removed. They are listed in the server log.",
    );
    expect(CANNOT_UNDO).toBe("This cannot be undone. Type the client's name to confirm:");
  });
});
