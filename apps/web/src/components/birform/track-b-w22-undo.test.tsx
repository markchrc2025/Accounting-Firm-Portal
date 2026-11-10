// track-b-w22-undo.test.tsx — W22: Undo filing on the confirmation card, its window, the
// History a return keeps, and Delete draft on a draft with history, with the API module
// mocked. The API's sentences are shown as sent. All data is invented.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  undoBirFormFiling: vi.fn(),
  fetchBirForms: vi.fn(),
  fetchUsers: vi.fn(),
  deleteBirForm: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  ...api,
}));
const auth = vi.hoisted(() => ({ perms: new Set<string>() }));
vi.mock("../../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ hasPermission: (p: string) => auth.perms.has(p) }),
}));

import {
  ApiError,
  type BirFormConfirmation,
  type BirFormDetail,
  type FilingUndo,
} from "../../lib/api";
import { ConfirmationCard } from "./BirConfirmation";
import { DeleteDraftButton } from "./DeleteDraftButton";
import { FilingHistory } from "./UndoFiling";
import { UNDO_FILING_TEXT } from "../../lib/undoFiling";

const FORM_ID = "f2200000-0000-4000-8000-0000000000aa";
const detail = (over: Partial<BirFormDetail> = {}): BirFormDetail =>
  ({
    id: FORM_ID,
    clientId: "c1",
    clientName: "INVENTED TWENTY-TWO CO",
    form: "2551Q",
    status: "draft",
    period: "2026-Q1",
    filedAt: null,
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    data: {},
    computed: null,
    exports: [],
    confirmationRequired: true,
    confirmation: null,
    filingUndos: [],
    ...over,
  }) as BirFormDetail;
const conf = (kind: "bir_email" | "override"): BirFormConfirmation => ({
  id: "k1",
  kind,
  birFileName: kind === "bir_email" ? "000111222333-2551Q-032026.xml" : null,
  receivedAt: kind === "bir_email" ? "2026-04-25T07:42:00.000Z" : null,
  filedOn: null,
  originalFilename: null,
  hasFile: false,
  warnings: [],
  overrideReason:
    kind === "override" ? "INVENTED: the BIR email was still in transit." : null,
  filedWithoutConfirmation: kind === "override",
  uploadedByUserId: "u1",
  uploadedAt: "2026-04-26T01:00:00.000Z",
});
const filedByOverride = (over: Partial<BirFormDetail> = {}) =>
  detail({
    status: "filed",
    filedAt: "2026-04-25T07:42:00.000Z",
    confirmation: conf("override"),
    ...over,
  });
const undo = (over: Partial<FilingUndo> = {}): FilingUndo => ({
  id: "x1",
  reason: "INVENTED: eBIRForms never took it, the contact number was blank.",
  filedAt: "2026-04-25T07:42:00.000Z",
  undoneAt: "2026-04-27T02:30:00.000Z",
  undoneByUserId: "u1",
  overrideReason: "INVENTED: the BIR email was still in transit.",
  ...over,
});

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
  return qc;
}
const undoBtn = () => screen.queryByRole("button", { name: "Undo filing" });
const SUPER = ["IntegrationClient:Update"];

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchBirForms.mockResolvedValue([]);
  auth.perms = new Set(SUPER);
});
afterEach(() => cleanup());

describe("W22 the button's visibility", () => {
  it("a Super Admin sees it on a return filed without the BIR email", async () => {
    wrap(<ConfirmationCard detail={filedByOverride()} />);
    expect(await screen.findByRole("button", { name: "Undo filing" })).toBeTruthy();
  });

  it("anyone else does not", async () => {
    auth.perms = new Set();
    wrap(<ConfirmationCard detail={filedByOverride()} />);
    await screen.findByText("Filed without BIR confirmation");
    expect(undoBtn()).toBeNull();
  });

  it("not on a return with a BIR email", async () => {
    wrap(
      <ConfirmationCard detail={filedByOverride({ confirmation: conf("bir_email") })} />,
    );
    await screen.findByText("BIR file name");
    expect(undoBtn()).toBeNull();
    expect(api.fetchBirForms).not.toHaveBeenCalled();
  });

  it("not on a draft", () => {
    wrap(<ConfirmationCard detail={detail({ confirmation: null })} />);
    expect(document.querySelector("[data-confirmation-card]")).toBeNull();
    expect(undoBtn()).toBeNull();
  });

  it("not on a return that has an amendment (the client's list names it)", async () => {
    api.fetchBirForms.mockResolvedValue([
      { id: "amend1", amendsId: FORM_ID, status: "draft" },
    ]);
    wrap(<ConfirmationCard detail={filedByOverride()} />);
    await waitFor(() =>
      expect(api.fetchBirForms).toHaveBeenCalledWith({ clientId: "c1" }),
    );
    await screen.findByText("Filed without BIR confirmation");
    await waitFor(() => expect(undoBtn()).toBeNull());
  });

  it("when the list cannot be read the button shows and the API decides", async () => {
    api.fetchBirForms.mockRejectedValue(new Error("INVENTED list trouble"));
    wrap(<ConfirmationCard detail={filedByOverride()} />);
    expect(await screen.findByRole("button", { name: "Undo filing" })).toBeTruthy();
  });
});

describe("W22 the window", () => {
  async function open() {
    wrap(<ConfirmationCard detail={filedByOverride()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo filing" }));
    return screen.getByRole("dialog");
  }
  const box = () => screen.getByLabelText(/Reason for undoing/) as HTMLTextAreaElement;
  const undoInDialog = () =>
    within(screen.getByRole("dialog")).getByRole("button", { name: "Undo filing" });

  it("says the owner's words, counts n / 10, and has Undo filing and Cancel", async () => {
    const dialog = await open();
    expect(dialog.querySelector("[data-undo-text]")!.textContent).toBe(UNDO_FILING_TEXT);
    expect(dialog.querySelector("[data-reason-counter]")!.textContent).toBe("0 / 10");
    fireEvent.change(box(), { target: { value: "  short " } });
    expect(dialog.querySelector("[data-reason-counter]")!.textContent).toBe("5 / 10");
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(undoInDialog()).toBeTruthy();
  });

  it("Cancel sends nothing and closes", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.undoBirFormFiling).not.toHaveBeenCalled();
  });

  it("a short reason is still sent: the API refuses it, in its own words", async () => {
    const SENT = "Give the reason in at least 10 characters.";
    api.undoBirFormFiling.mockRejectedValue(new ApiError(400, SENT, { message: SENT }));
    await open();
    fireEvent.change(box(), { target: { value: "too short" } });
    fireEvent.click(undoInDialog());
    const err = await waitFor(() => {
      const el = document.querySelector("[data-undo-error]");
      if (!el) throw new Error("not yet");
      return el;
    });
    expect(err.textContent).toBe(SENT);
    expect(api.undoBirFormFiling).toHaveBeenCalledWith(FORM_ID, "too short");
  });

  it.each([
    [403, "Only a Super Admin can undo a filing."],
    [
      409,
      "The filing can only be undone when it was marked filed without the BIR confirmation email. A return with an attached BIR email can never be undone; it is corrected by amending.",
    ],
    [409, "This return has an amendment, so its filing cannot be undone."],
    [404, "Form not found."],
  ])("a %i is shown as sent: %s", async (status, SENT) => {
    api.undoBirFormFiling.mockRejectedValue(
      new ApiError(status, SENT, { message: SENT }),
    );
    await open();
    fireEvent.change(box(), { target: { value: "A long enough reason." } });
    fireEvent.click(undoInDialog());
    await waitFor(() =>
      expect(document.querySelector("[data-undo-error]")?.textContent).toBe(SENT),
    );
    // The window stays open, the reason stays typed.
    expect(box().value).toBe("A long enough reason.");
  });

  it("success: sends the reason once, closes, and hands the draft on", async () => {
    const draft = detail({ filingUndos: [undo()] });
    api.undoBirFormFiling.mockResolvedValue(draft);
    const qc = wrap(<ConfirmationCard detail={filedByOverride()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Undo filing" }));
    fireEvent.change(box(), { target: { value: "The BIR never got it." } });
    fireEvent.click(undoInDialog());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.undoBirFormFiling).toHaveBeenCalledTimes(1);
    expect(api.undoBirFormFiling).toHaveBeenCalledWith(FORM_ID, "The BIR never got it.");
    expect(qc.getQueryData(["bir-form", FORM_ID])).toBe(draft);
  });
});

describe("W22 the History", () => {
  it("lists each filing taken back: filed on, undone on, by, the reason and the override reason", async () => {
    auth.perms = new Set(["Users:Read"]);
    api.fetchUsers.mockResolvedValue([{ id: "u1", fullName: "Test Operator" }]);
    wrap(
      <FilingHistory
        detail={detail({
          filingUndos: [
            undo(),
            undo({
              id: "x2",
              reason: "INVENTED second reason, long enough.",
              undoneByUserId: "u2",
              overrideReason: null,
            }),
          ],
        })}
      />,
    );
    const rows = document.querySelectorAll("[data-filing-undo]");
    expect(rows).toHaveLength(2);
    const first = rows[0]!;
    expect(first.querySelector("[data-undo-filed-at]")!.textContent).toBe(
      "Apr 25, 2026, 3:42 PM",
    );
    expect(first.querySelector("[data-undo-undone-at]")!.textContent).toBe(
      "Apr 27, 2026, 10:30 AM",
    );
    await waitFor(() =>
      expect(first.querySelector("[data-undo-by]")!.textContent).toBe("Test Operator"),
    );
    expect(first.querySelector("[data-undo-reason]")!.textContent).toBe(undo().reason);
    expect(first.querySelector("[data-undo-override-reason]")!.textContent).toBe(
      undo().overrideReason,
    );
    // The second: an id the caller cannot name, and no override reason to show.
    expect(rows[1]!.querySelector("[data-undo-by]")!.textContent).toBe("u2");
    expect(rows[1]!.querySelector("[data-undo-override-reason]")).toBeNull();
  });

  it("without Users:Read the id is shown, and users are never asked for", () => {
    auth.perms = new Set();
    wrap(<FilingHistory detail={detail({ filingUndos: [undo()] })} />);
    expect(document.querySelector("[data-undo-by]")!.textContent).toBe("u1");
    expect(api.fetchUsers).not.toHaveBeenCalled();
  });

  it("shows nothing when no filing was taken back", () => {
    wrap(<FilingHistory detail={detail({ filingUndos: [] })} />);
    wrap(<FilingHistory detail={detail({ filingUndos: undefined })} />);
    expect(document.querySelector("[data-filing-history]")).toBeNull();
  });
});

describe("W22 Delete draft on a draft with history", () => {
  it("is not offered", () => {
    wrap(
      <DeleteDraftButton detail={detail({ canDelete: true, filingUndos: [undo()] })} />,
    );
    expect(screen.queryByRole("button", { name: "Delete draft" })).toBeNull();
  });

  it("is offered on a draft without history", () => {
    wrap(<DeleteDraftButton detail={detail({ canDelete: true })} />);
    expect(screen.getByRole("button", { name: "Delete draft" })).toBeTruthy();
  });

  it("if the API ever refuses, its sentence shows as sent", async () => {
    const SENT =
      "This return was filed and the filing was undone. Its history is kept, so it cannot be deleted.";
    api.deleteBirForm.mockRejectedValue(new ApiError(409, SENT, { message: SENT }));
    wrap(<DeleteDraftButton detail={detail({ canDelete: true })} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete draft" }));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Delete draft" }),
    );
    expect((await screen.findByRole("alert")).textContent).toBe(SENT);
  });
});
