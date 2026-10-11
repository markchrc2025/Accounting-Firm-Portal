// track-b-w14.test.ts — W14 R2: the export list names each kind of export.

import { describe, expect, it } from "vitest";
import { exportLabel } from "./birExports";

describe("the export list's labels (W14 R2)", () => {
  it("names the clear copy and the eBIRForms file", () => {
    expect(exportLabel("pdf")).toBe("Clear copy (PDF)");
    expect(exportLabel("xml")).toBe("eBIRForms file (XML)");
  });

  it("shows a kind it does not know as the server sent it", () => {
    expect(exportLabel("csv")).toBe("csv");
  });
});
