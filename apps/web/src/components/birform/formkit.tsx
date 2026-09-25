// formkit/index.tsx — shared faithful-form primitives.
// Ported from bir-formkit.jsx (BirBoxes, BirAmt, BirText, BirVal, BirCk, BirCkRow).

import { useState, type CSSProperties, type ReactNode } from "react";
import type { FilingData, FilingRow } from "./types";
import { fmtAmt, num, roundPeso } from "./format";

/**
 * Form-level setter. Most fields take a raw string; the repeating-row tables
 * (2307, 2551Q) pass their whole array under the "rows" key. Used by form/guided
 * components and forwarded down to the field atoms (which use `FieldSetFn`).
 */
export type SetFn = (field: string, value: string | FilingRow[]) => void;

/** Atom-level setter — only ever receives a string. */
export type FieldSetFn = (field: string, value: string) => void;

/** Read a raw string field value from filing data. */
function raw(data: FilingData | undefined, field: string): string {
  const v = data?.[field];
  return v == null || typeof v !== "string" ? "" : v;
}

/**
 * What a run of digit boxes holds. Rendered onto the group as
 * `data-box-group`, so a test can count the boxes the official form requires
 * without reaching into the layout.
 */
export type BoxKind = "tin" | "period" | "zip" | "taxAgentDate" | "other";

/** Boxed digits/letters (TIN, RDO, dates, ZIP). */
export function BirBoxes({
  value,
  count,
  groups,
  kind = "other",
}: {
  value?: string;
  count: number;
  groups?: number[];
  kind?: BoxKind;
}) {
  const chars = String(value == null ? "" : value)
    .replace(/[^0-9A-Za-z]/g, "")
    .toUpperCase()
    .split("");
  const cells: string[] = [];
  for (let i = 0; i < count; i++) cells.push(chars[i] || "");
  if (groups && groups.length) {
    const out: ReactNode[] = [];
    let idx = 0;
    groups.forEach((g, gi) => {
      out.push(
        <div className="grp" key={"g" + gi}>
          {Array.from({ length: g }).map((_, j) => (
            <div className="bir-box" key={j}>
              {cells[idx++] || ""}
            </div>
          ))}
        </div>,
      );
      if (gi < groups.length - 1)
        out.push(
          <span className="sep" key={"s" + gi}>
            -
          </span>,
        );
    });
    return (
      <div className="bir-boxes" data-box-group={kind} data-box-count={count}>
        {out}
      </div>
    );
  }
  return (
    <div className="bir-boxes" data-box-group={kind} data-box-count={count}>
      {cells.map((c, i) => (
        <div className="bir-box" key={i}>
          {c}
        </div>
      ))}
    </div>
  );
}

/** Editable amount field bound to data, or read-only computed value. */
export function BirAmt({
  field,
  data,
  set,
  ro,
  value,
  dim,
}: {
  field?: string;
  data?: FilingData;
  set?: FieldSetFn;
  ro?: boolean;
  value?: number;
  dim?: boolean;
}) {
  if (ro) {
    const v = value == null ? 0 : value;
    const neg = num(v) < 0;
    return (
      <input
        className={"bir-amt ro" + (neg ? " neg" : "")}
        value={fmtAmt(v)}
        readOnly
        tabIndex={-1}
        style={dim ? { opacity: 0.5 } : undefined}
      />
    );
  }
  return <AmtInput field={field} data={data} set={set} />;
}

/**
 * A read-only amount printed as TEXT, for a print-faithful sheet.
 *
 * Differs from `<BirAmt ro>` in two ways that matter on a mandated form:
 *  - an absent value renders as NOTHING, not "0" — a zero nobody entered is
 *    content on the paper, and an unused row on the BIR's form is blank;
 *  - it is a `<span>`, not an `<input>`, so the figure is a real text node:
 *    selectable in the browser, found by a test, and rasterised as text.
 */
export function BirAmtVal({ value, bold }: { value?: number | null; bold?: boolean }) {
  const empty = value == null || Number.isNaN(value);
  return (
    <span
      className="bir-amt ro"
      style={{ display: "block", fontWeight: bold ? 700 : undefined }}
      data-amount={empty ? "" : String(value)}
    >
      {empty ? "" : fmtAmt(value)}
    </span>
  );
}

/** Editable amount input: comma-formatted when idle, raw while being typed. */
function AmtInput({ field, data, set }: { field?: string; data?: FilingData; set?: FieldSetFn }) {
  const [focused, setFocused] = useState(false);
  const value0 = field ? raw(data, field) : "";
  const display = focused || value0.trim() === "" ? value0 : fmtAmt(num(value0));
  return (
    <input
      className="bir-amt"
      inputMode="decimal"
      value={display}
      placeholder="0"
      onFocus={() => setFocused(true)}
      onChange={(e) => field && set?.(field, e.target.value.replace(/[^0-9.-]/g, ""))}
      onBlur={(e) => {
        setFocused(false);
        if (!field || !set) return;
        const n = num(e.target.value);
        set(field, n === 0 && e.target.value.trim() === "" ? "" : String(roundPeso(n)));
      }}
    />
  );
}

/** Editable text field bound to data. */
export function BirText({
  field,
  data,
  set,
  placeholder,
  lower,
}: {
  field: string;
  data: FilingData;
  set: FieldSetFn;
  placeholder?: string;
  lower?: boolean;
}) {
  return (
    <input
      className={"bir-in" + (lower ? " lower" : "")}
      value={raw(data, field)}
      placeholder={placeholder || ""}
      onChange={(e) => set(field, e.target.value)}
    />
  );
}

/** Read-only profile value (auto-filled from the taxpayer record). */
export function BirVal({
  value,
  lower,
  fit,
  blank,
}: {
  value?: string | null;
  lower?: boolean;
  /** Shrink the font stepwise for long values so the text fits its cell instead
   *  of pushing neighbouring cells (matches how the official form's long
   *  answers are simply written smaller). Ported from the Sentire generator. */
  fit?: boolean;
  /** Render an empty value as nothing at all, not as an em-dash placeholder.
   *  Required on a print-faithful sheet: a blank box on a mandated form is
   *  blank, and a placeholder glyph would be read as content. */
  blank?: boolean;
}) {
  const empty = value == null || value === "";
  const len = empty ? 0 : String(value).length;
  const fitStyle =
    fit && len > 46
      ? { fontSize: len > 88 ? 9 : len > 64 ? 10.5 : 12, letterSpacing: 0 }
      : undefined;
  return (
    <span
      className={"bir-val" + (lower ? " lower" : "") + (empty ? " empty" : "")}
      style={fitStyle}
    >
      {empty ? (blank ? "" : "—") : value}
    </span>
  );
}

/** A clickable / static checkbox. */
export function BirCk({ on, onClick }: { on?: boolean; onClick?: () => void }) {
  return (
    <span
      className={"bir-ck" + (onClick ? " sel" : "") + (on ? " on" : "")}
      onClick={onClick || undefined}
    />
  );
}

/** Checkbox + label row. `before` puts the label before the box. */
export function BirCkRow({
  on,
  onClick,
  children,
  before,
  style,
}: {
  on?: boolean;
  onClick?: () => void;
  children: ReactNode;
  before?: boolean;
  style?: CSSProperties;
}) {
  const ck = <BirCk on={on} onClick={onClick} />;
  return (
    <span
      className={"bir-ckwrap" + (onClick ? " click" : "")}
      onClick={onClick || undefined}
      style={style}
    >
      {before ? (
        <>
          <span>{children}</span>
          {ck}
        </>
      ) : (
        <>
          {ck}
          <span>{children}</span>
        </>
      )}
    </span>
  );
}
