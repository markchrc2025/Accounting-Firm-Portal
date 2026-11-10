// W22: the contact-number refusals (Track A U21/U22) come back from Preview PDF and
// Download clear copy; each shows the API's sentence as sent. (Export eBIRForms XML and
// Mark as filed are covered in the browser spec.) Invented data.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  previewBirFormPdf: vi.fn(),
  createClearCopy: vi.fn(),
  fetchBirFormExportUrl: vi.fn(),
}));
vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  ...api,
}));

import { ApiError } from "../../lib/api";
import { ClearCopyButton } from "./ClearCopyButton";
import { PreviewPdfButton } from "./PreviewPdfButton";

const BLANK =
  "Add the client's contact number before this return leaves the Portal. eBIRForms will not submit a return without one.";
const SHORT =
  "The client's contact number must be 11 digits, like 09171234567. eBIRForms accepts no other form.";

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));
afterEach(() => cleanup());

describe.each([[BLANK], [SHORT]])("W22 a contact-number refusal: %s", (SENT) => {
  it("Preview PDF shows it as sent", async () => {
    api.previewBirFormPdf.mockRejectedValue(new ApiError(409, SENT, { message: SENT }));
    render(<PreviewPdfButton formId="f1" dirty={false} save={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Preview PDF" }));
    await waitFor(() =>
      expect(document.querySelector("[data-preview-error]")?.textContent).toBe(SENT),
    );
  });

  it("Download clear copy shows it as sent", async () => {
    api.createClearCopy.mockRejectedValue(new ApiError(409, SENT, { message: SENT }));
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ClearCopyButton formId="f1" />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Download clear copy" }));
    await waitFor(() =>
      expect(document.querySelector("[data-clear-copy-error]")?.textContent).toBe(SENT),
    );
  });
});
