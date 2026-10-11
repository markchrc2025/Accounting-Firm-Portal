// track-b-w15.test.ts — W15's pure helpers: the Delete-draft sentence (R1), the
// Drive tab's defaults, counts and send label (R5), the sizes it shows, and
// the new "preparing" status (R6).

import { describe, expect, it } from "vitest";
import {
  driveCounts,
  driveDefaultTicks,
  driveSendLabel,
  fileSize,
  newFileCount,
  type DriveFile,
} from "./drive";
import { deleteDraftBody } from "./birDraft";
import { scanStatusLabel } from "./receiptScans";

const f = (over: Partial<DriveFile>): DriveFile => ({
  driveFileId: "x",
  name: "x.jpg",
  path: "",
  mimeType: "image/jpeg",
  bytes: 1000,
  modifiedTime: "2026-09-20T03:00:00.000Z",
  alreadyRead: false,
  problem: null,
  ...over,
});

describe("Delete draft (W15 R1)", () => {
  it("names the form, the period and the client", () => {
    expect(
      deleteDraftBody({ form: "2551Q", period: "2026-Q3", clientName: "INVENTED STORE" }),
    ).toBe(
      "The draft 2551Q for 2026-Q3 for INVENTED STORE will be removed. This can't be undone. Filed returns are never affected.",
    );
  });
});

describe("the From Google Drive tab (W15 R5)", () => {
  const files = [
    f({ driveFileId: "a" }),
    f({ driveFileId: "b", mimeType: "application/pdf" }),
    f({ driveFileId: "c", problem: "Larger than 10 MB." }),
    f({ driveFileId: "d", alreadyRead: true }),
  ];

  it("ticks the new files that can be sent, and nothing else", () => {
    expect([...driveDefaultTicks(files)]).toEqual(["a", "b"]);
  });

  it("counts the new files for the header", () => {
    expect(newFileCount(files)).toBe(3);
  });

  it("counts PDFs by mimeType for the estimate", () => {
    expect(driveCounts(files, new Set(["a", "b", "d"]))).toEqual({ images: 2, pdfs: 1 });
  });

  it("words the send button with the ticked count, and stops above 100", () => {
    expect(driveSendLabel(1)).toBe("Send 1 file");
    expect(driveSendLabel(100)).toBe("Send 100 files");
    expect(driveSendLabel(101)).toBe("Up to 100 files per pile.");
  });

  it("shows sizes the way a person reads them", () => {
    expect(fileSize(0)).toBe("0 KB");
    expect(fileSize(250_000)).toBe("244 KB");
    expect(fileSize(1_400_000)).toBe("1.3 MB");
  });
});

describe("piles prepare first (W15 R6)", () => {
  it("names the preparing status", () => {
    expect(scanStatusLabel("preparing")).toBe("Preparing…");
  });
});
