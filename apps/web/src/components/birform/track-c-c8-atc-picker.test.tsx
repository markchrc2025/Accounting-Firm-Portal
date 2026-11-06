// track-c-c8-atc-picker.test.tsx — C8: the ATC picker of the 2307's Part III rows. Which codes
// a block offers (by classification, never by the letters of a code), search, the reference
// line, no default and no automatic fill, and a saved ATC that is not in the table.
//
// The codes are an invented subset of the seeded table's shape; no real person's data.

import { useState } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BirAtcCode } from "../../lib/api";
import { AtcPicker, atcOffered, rateText, savedAtcNote, searchAtc } from "./AtcPicker";

const code = (
  atc: string,
  classification: string,
  description: string,
  rate: string | null,
  over: Partial<BirAtcCode> = {},
): BirAtcCode => ({
  atc,
  classification,
  taxTypeCode: "WE",
  payeeType: "any",
  description,
  rate,
  rateBasis: "gross_payment",
  forms: [],
  certificate: "2307",
  status: "active",
  ...over,
});

const TABLE: BirAtcCode[] = [
  code(
    "WI010",
    "ewt",
    "Professional fees paid to individuals - gross income not over 3M",
    "0.050000",
  ),
  code(
    "WC010",
    "ewt",
    "Professional fees paid to corporations - gross income not over 720,000",
    "0.100000",
  ),
  code("WC650", "ewt", "Utility-specific legacy code", "0.150000", { status: "legacy" }),
  // an expanded-withholding code whose letters look like block B's: the classification decides
  code("WB999", "ewt", "Invented expanded code with a business-tax look", "0.020000"),
  code("WI161", "fwt", "Final withholding - invented", "0.200000"),
  code("VB010", "vat", "VAT - invented", "0.120000"),
  code("WB030", "percentage_wt", "Tax on carriers and keepers of garages", "0.030000", {
    taxTypeCode: "WG",
  }),
  code("WB200", "percentage_wt", "Stock transaction tax", "0.001000", {
    taxTypeCode: "ST",
    certificate: null,
  }),
  code("WB201", "percentage_wt", "IPO tax - repealed", "0.040000", {
    taxTypeCode: "SO",
    certificate: null,
    status: "repealed",
  }),
  code("WV010", "wvat", "VAT withheld on purchases of goods - government", "0.050000", {
    taxTypeCode: "WG",
  }),
  code("WV012", "wvat", "VAT withheld on purchase of goods (legacy)", "0.100000", {
    taxTypeCode: "WG",
    status: "legacy",
  }),
  // a business-tax look-alike by its letters whose classification is not offered anywhere
  code("WV999", "vat", "Invented VAT code with a WV prefix", "0.120000"),
];

const codes = (list: BirAtcCode[]) => list.map((c) => c.atc);

afterEach(() => cleanup());

describe("C8 · what each block offers", () => {
  it("block A: the expanded-withholding codes, read from the classification", () => {
    expect(codes(atcOffered(TABLE, "A"))).toEqual(["WI010", "WC010", "WC650", "WB999"]);
  });

  it("block B: the percentage-tax and withholding-VAT codes of the 2307; not WB200 (no 2307), not a repealed code, not a WV-lettered VAT code", () => {
    expect(codes(atcOffered(TABLE, "B"))).toEqual(["WB030", "WV010", "WV012"]);
  });

  it("a code is never offered on the strength of its first letters", () => {
    expect(codes(atcOffered(TABLE, "A"))).toContain("WB999");
    expect(codes(atcOffered(TABLE, "B"))).not.toContain("WB999");
    expect(codes(atcOffered(TABLE, "B"))).not.toContain("WV999");
  });
});

describe("C8 · search and the rate shown for reference", () => {
  const A = atcOffered(TABLE, "A");

  it("finds a code by its code or by words of its description; a code that starts with the text comes first", () => {
    expect(codes(searchAtc(A, "wc"))).toEqual(["WC010", "WC650"]);
    expect(codes(searchAtc(A, "corporations"))).toEqual(["WC010"]);
    expect(codes(searchAtc(A, "010"))).toEqual(["WI010", "WC010"]);
    expect(codes(searchAtc(A, "  "))).toEqual(codes(A));
    expect(searchAtc(A, "zzz")).toEqual([]);
  });

  it("the table rate is a percentage; none is shown as empty", () => {
    expect(rateText("0.030000")).toBe("3%");
    expect(rateText("0.005000")).toBe("0.5%");
    expect(rateText(0.1)).toBe("10%");
    expect(rateText(null)).toBe("");
    expect(rateText("")).toBe("");
  });
});

describe("C8 · a saved ATC that is not offered stays, with a plain note", () => {
  it("not in the table: the note; in the table under another classification: the note names it; offered: none; nothing known yet: none", () => {
    expect(savedAtcNote("WI999", TABLE, "A")).toBe(
      "ATC WI999 is not in the BIR ATC table. It is shown as it was saved.",
    );
    expect(savedAtcNote("WI161", TABLE, "A")).toBe(
      "ATC WI161 is in the BIR ATC table as a final withholding code, not one offered for block A. It is shown as it was saved.",
    );
    expect(savedAtcNote("WI010", TABLE, "B")).toMatch(
      /expanded withholding code, not one offered for block B/,
    );
    expect(savedAtcNote("WI010", TABLE, "A")).toBe("");
    expect(savedAtcNote("", TABLE, "A")).toBe("");
    expect(savedAtcNote("WI999", undefined, "A")).toBe("");
    expect(savedAtcNote("WI999", [], "A")).toBe("");
  });
});

/** The picker in a row, holding its own value like the editor does. */
function Harness({
  block = "A",
  initial = "",
  table = TABLE,
  onChange,
  loading,
  failed,
}: {
  block?: "A" | "B";
  initial?: string;
  table?: BirAtcCode[] | null;
  onChange?: (v: string) => void;
  loading?: boolean;
  failed?: boolean;
}) {
  const [v, setV] = useState(initial);
  return (
    <AtcPicker
      label="ATC, row 1"
      block={block}
      value={v}
      onChange={(c) => {
        setV(c);
        onChange?.(c);
      }}
      table={table ?? undefined}
      loading={loading}
      failed={failed}
    />
  );
}
const input = () => screen.getByLabelText("ATC, row 1") as HTMLInputElement;

describe("C8 · the picker", () => {
  it("has no default: a new row is empty, opening it lists the codes and chooses none, closing it leaves it empty", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(input().value).toBe("");
    expect(input().placeholder).toBe("Select ATC…");
    fireEvent.focus(input());
    expect(screen.getAllByTestId("atc-option")).toHaveLength(4);
    expect(screen.queryByTestId("atc-reference")).toBeNull();
    fireEvent.blur(input());
    expect(input().value).toBe("");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("typing narrows the list by code or description; choosing sets the code and nothing else", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "corporations" } });
    const options = screen.getAllByTestId("atc-option");
    expect(options).toHaveLength(1);
    expect(options[0]!.textContent).toContain("WC010");
    expect(options[0]!.textContent).toContain("10%");
    fireEvent.click(options[0]!);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("WC010");
    expect(input().value).toBe("WC010");
  });

  it("shows the description and the table rate for reference, and says the tax withheld is typed", () => {
    render(<Harness initial="WI010" />);
    const ref = screen.getByTestId("atc-reference").textContent!;
    expect(ref).toContain("Professional fees paid to individuals");
    expect(ref).toContain("table rate 5%");
    expect(ref).toContain("the tax withheld is typed");
    expect(screen.queryByTestId("atc-note")).toBeNull();
  });

  it("the arrow keys and Enter choose; Escape closes without choosing", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: "ArrowDown" });
    fireEvent.keyDown(input(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("WC010");
    fireEvent.focus(input());
    fireEvent.keyDown(input(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("block B lists its own codes, legacy ones marked", () => {
    render(<Harness block="B" />);
    fireEvent.focus(input());
    const text = screen.getAllByTestId("atc-option").map((o) => o.textContent);
    expect(text).toHaveLength(3);
    expect(text[2]).toContain("WV012");
    expect(text[2]).toContain("legacy");
  });

  it("a chosen ATC can be cleared on purpose, and nothing fills it again", () => {
    const onChange = vi.fn();
    render(<Harness initial="WI010" onChange={onChange} />);
    fireEvent.focus(input());
    fireEvent.click(screen.getByTestId("atc-clear"));
    expect(onChange).toHaveBeenCalledWith("");
    expect(input().value).toBe("");
    fireEvent.blur(input());
    expect(input().value).toBe("");
    // searching and abandoning, without choosing, never changes a saved code
    cleanup();
    const other = vi.fn();
    render(<Harness initial="WI010" onChange={other} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "" } });
    fireEvent.blur(input());
    expect(other).not.toHaveBeenCalled();
    expect(input().value).toBe("WI010");
  });

  it("a saved ATC that is not in the table stays shown as it was, with the note; abandoning a search never loses it", () => {
    render(<Harness initial="WI999" />);
    expect(input().value).toBe("WI999");
    expect(screen.getByTestId("atc-note").textContent).toBe(
      "ATC WI999 is not in the BIR ATC table. It is shown as it was saved.",
    );
    expect(screen.queryByTestId("atc-reference")).toBeNull();
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "wc" } });
    fireEvent.blur(input());
    expect(input().value).toBe("WI999");
  });

  it("while the table loads, or if it cannot, the saved code stays and no false note is shown", () => {
    const { rerender } = render(<Harness initial="WI999" table={null} loading />);
    expect(input().value).toBe("WI999");
    expect(screen.queryByTestId("atc-note")).toBeNull();
    fireEvent.focus(input());
    expect(
      within(screen.getByRole("listbox")).getByText("Loading the ATC table…"),
    ).toBeTruthy();
    rerender(<Harness initial="WI999" table={null} failed />);
    fireEvent.focus(input());
    expect(screen.getByText("The ATC table could not be loaded.")).toBeTruthy();
    expect(screen.queryByTestId("atc-note")).toBeNull();
  });

  it("no match is said in words", () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: "nothing like this" } });
    expect(screen.getByText("No ATC matches “nothing like this”.")).toBeTruthy();
  });
});
