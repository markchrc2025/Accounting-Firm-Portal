// track-b-w28.test.tsx — W28 (Track A U28, D75): Mark as filed is held back while the SAVED
// return holds centavos in a whole-peso figure, with the API's own sentence under the button
// and in the filing dialog. The editor's unsaved figures do not count: a save fixes it. All
// data is invented.

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../auth/AuthContext", () => ({
  useOptionalAuth: () => ({ hasPermission: () => true }),
}));

import { centavosBeforeFiling } from "@portal/shared";
import type { BirFormDetail } from "../../lib/api";
import { ConfirmationDialog, MarkAsFiledButton } from "./BirConfirmation";

const SAVE_FIRST =
  "Item 36A has centavos, which the 1701Q paper has no boxes for. Save the draft so the figures are rounded to whole pesos, then mark it filed.";

const detail = (data: Record<string, unknown>, over: Partial<BirFormDetail> = {}) =>
  ({
    id: "f2800000-0000-4000-8000-0000000000aa",
    clientId: "c1",
    clientName: "INVENTED TWENTY-EIGHT",
    form: "1701Q",
    status: "draft",
    period: "2026-Q3",
    filedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
    data,
    computed: null,
    exports: [],
    confirmationRequired: true,
    confirmation: null,
    ...over,
  }) as BirFormDetail;

const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const button = () =>
  screen.getByRole("button", { name: "Mark as filed" }) as HTMLButtonElement;

afterEach(cleanup);

describe("W28 · Mark as filed waits for a save", () => {
  it("is the API's sentence (one source)", () => {
    expect(centavosBeforeFiling("1701Q", { atc: "II012", salesA: "130507.95" })).toEqual([
      SAVE_FIRST,
    ]);
  });

  it("held back, with the sentence under it, while the saved return holds centavos", () => {
    render(
      <QueryClientProvider client={qc()}>
        <MarkAsFiledButton
          detail={detail({ atc: "II012", salesA: "130507.95" })}
          disabled={false}
          pending={false}
          onPlain={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(button().disabled).toBe(true);
    const hint = document.querySelector("[data-centavo-gate]");
    expect(hint?.textContent).toBe(SAVE_FIRST);
  });

  it("free once saved in whole pesos; no sentence", () => {
    render(
      <QueryClientProvider client={qc()}>
        <MarkAsFiledButton
          detail={detail({ atc: "II012", salesA: "130508" })}
          disabled={false}
          pending={false}
          onPlain={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(button().disabled).toBe(false);
    expect(document.querySelector("[data-centavo-gate]")).toBeNull();
  });

  it("a form with centavo boxes is never held for centavos", () => {
    render(
      <QueryClientProvider client={qc()}>
        <MarkAsFiledButton
          detail={detail(
            { rows: [{ atc: "PT010", taxable: "130507.95" }] },
            { form: "2551Q" },
          )}
          disabled={false}
          pending={false}
          onPlain={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(button().disabled).toBe(false);
  });

  it("the filing dialog repeats it on both paths", () => {
    render(
      <QueryClientProvider client={qc()}>
        <ConfirmationDialog
          detail={detail({ atc: "II012", salesA: "130507.95" })}
          mode="mark"
          onClose={() => undefined}
          onDone={() => undefined}
        />
      </QueryClientProvider>,
    );
    expect(document.querySelector("[data-centavo-gate]")?.textContent).toBe(SAVE_FIRST);
  });
});
