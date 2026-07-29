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

/** Boxed digits/letters (TIN, RDO, etc.). */
export function BirBoxes({
  value,
  count,
  groups,
}: {
  value?: string;
  count: number;
  groups?: number[];
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
    return <div className="bir-boxes">{out}</div>;
  }
  return (
    <div className="bir-boxes">
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
export function BirVal({ value, lower }: { value?: string | null; lower?: boolean }) {
  const empty = value == null || value === "";
  return (
    <span className={"bir-val" + (lower ? " lower" : "") + (empty ? " empty" : "")}>
      {empty ? "—" : value}
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
