// WithholdingParts — the boxes the 0619-E, 1601-EQ and 1601-C editors share (W17):
// an amount, a text, a date, a Yes/No or one-of choice, a computed read-out, and the
// blocks every one of the three has (who files, penalties, who signs, how it was paid).
// Amounts are text with up to two decimals, as the server wants them; the page adds
// nothing up — the computed read-outs are the server's.

import type { ReactNode } from "react";
import { cn } from "../ui";
import { BookBadge } from "./BookFigures";
import { signedPeso, type Values } from "../../lib/withholding";

const INPUT = "input w-full";
const LABEL = "mb-1.5 block text-[13px] font-semibold text-content";
const SMALL_LABEL = "mb-1.5 block text-[12px] font-semibold text-content-secondary";

/** A peso amount, to the centavo. `bookKey` hangs the "From books" badge under it. */
export function Money({
  label,
  value,
  onChange,
  bookKey,
  compact,
  min = 0,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  bookKey?: string;
  compact?: boolean;
  min?: number;
}) {
  return (
    <div>
      <label className="block">
        <span className={compact ? SMALL_LABEL : LABEL}>{label}</span>
        <input
          type="number"
          min={min}
          step="0.01"
          inputMode="decimal"
          className={cn(INPUT, "text-right font-mono tabular-nums")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {bookKey ? <BookBadge id={bookKey} /> : null}
    </div>
  );
}

/** A line of text, or a date (ISO, yyyy-mm-dd), or a month (yyyy-mm). */
export function Text({
  label,
  value,
  onChange,
  type = "text",
  compact,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: "text" | "date" | "month" | "email" | "tel";
  compact?: boolean;
  hint?: string;
}) {
  return (
    <div>
      <label className="block">
        <span className={compact ? SMALL_LABEL : LABEL}>{label}</span>
        <input
          type={type}
          className={cn(INPUT, type === "text" ? "" : "font-mono")}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {hint ? <p className="mt-1 text-[11.5px] text-content-secondary">{hint}</p> : null}
    </div>
  );
}

/** One of a few boxes, as a radio group named by its label. */
export function Choice({
  label,
  value,
  onChange,
  options,
  bookKey,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [value: string, label: string][];
  bookKey?: string;
}) {
  return (
    <div>
      <span className={LABEL}>{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="flex flex-wrap gap-x-5 gap-y-1.5"
      >
        {options.map(([v, text]) => (
          <label key={v} className="flex items-center gap-2 text-[13px] text-content">
            <input
              type="radio"
              name={label}
              checked={value === v}
              onChange={() => onChange(v)}
            />
            {text}
          </label>
        ))}
      </div>
      {bookKey ? <BookBadge id={bookKey} /> : null}
    </div>
  );
}

/** A read-only line of the server's computation. A negative amount shows its minus sign. */
export function ReadOut({
  label,
  value,
  strong,
  note,
}: {
  label: string;
  value: number | null | undefined;
  strong?: boolean;
  note?: ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <span
          className={cn(
            "text-[13px]",
            strong ? "font-semibold text-navy" : "text-content-secondary",
          )}
        >
          {label}
        </span>
        <span
          data-readout={label}
          className={cn(
            "font-mono tabular-nums",
            strong ? "text-[15px] font-semibold text-navy" : "text-content",
          )}
        >
          {signedPeso(value)}
        </span>
      </div>
      {note ? (
        <div className="mt-0.5 text-[11.5px] text-content-secondary">{note}</div>
      ) : null}
    </div>
  );
}

/** Who the withholding agent is, as far as the draft keeps it: the background (TIN,
 *  name, address) comes from the client, not from here. */
export function PartyBlock({
  values,
  set,
  items,
}: {
  values: Values;
  set: (k: string, v: string) => void;
  /** The printed item numbers: contact number, category, email address. */
  items: { contact: number; category: number; email: number };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Text
        label={`Contact number (Item ${items.contact})`}
        type="tel"
        value={values.contact ?? ""}
        onChange={(v) => set("contact", v)}
      />
      <Text
        label={`Email address (Item ${items.email})`}
        type="email"
        value={values.email ?? ""}
        onChange={(v) => set("email", v)}
      />
      <Choice
        label={`Category of withholding agent (Item ${items.category})`}
        value={values.category ?? ""}
        onChange={(v) => set("category", v)}
        options={[
          ["private", "Private"],
          ["government", "Government"],
        ]}
      />
    </div>
  );
}

/** Add: Penalties (surcharge, interest, compromise). */
export function PenaltiesBlock({
  values,
  set,
  items,
}: {
  values: Values;
  set: (k: string, v: string) => void;
  items: [string, string, string];
}) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <Money
        compact
        label={`Surcharge (Item ${items[0]})`}
        value={values.surcharge ?? ""}
        onChange={(v) => set("surcharge", v)}
      />
      <Money
        compact
        label={`Interest (Item ${items[1]})`}
        value={values.interest ?? ""}
        onChange={(v) => set("interest", v)}
      />
      <Money
        compact
        label={`Compromise (Item ${items[2]})`}
        value={values.compromise ?? ""}
        onChange={(v) => set("compromise", v)}
      />
    </div>
  );
}

/** Who signs, and the tax agent's accreditation if there is one. */
export function SignatoryBlock({
  values,
  set,
}: {
  values: Values;
  set: (k: string, v: string) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Text
        label="Signatory: printed name"
        value={values.signatoryName ?? ""}
        onChange={(v) => set("signatoryName", v)}
      />
      <Text
        label="Signatory: title or designation"
        value={values.signatoryTitle ?? ""}
        onChange={(v) => set("signatoryTitle", v)}
      />
      <Text
        label="Signatory: TIN"
        value={values.signatoryTin ?? ""}
        onChange={(v) => set("signatoryTin", v)}
      />
      <Text
        label="Tax agent accreditation no. or attorney's roll no. (if applicable)"
        value={values.taxAgentNo ?? ""}
        onChange={(v) => set("taxAgentNo", v)}
      />
      <Text
        label="Tax agent: date of issue"
        type="date"
        value={values.taxAgentIssueDate ?? ""}
        onChange={(v) => set("taxAgentIssueDate", v)}
      />
      <Text
        label="Tax agent: date of expiry"
        type="date"
        value={values.taxAgentExpiryDate ?? ""}
        onChange={(v) => set("taxAgentExpiryDate", v)}
      />
    </div>
  );
}

const PAY_ROWS: [prefix: string, label: string][] = [
  ["payCash", "Cash/Bank Debit Memo"],
  ["payCheck", "Check"],
  ["payTaxDebit", "Tax Debit Memo"],
];

/** Part III, details of payment: cash or bank debit memo, check, tax debit memo, others. */
export function PaymentBlock({
  values,
  set,
  items,
}: {
  values: Values;
  set: (k: string, v: string) => void;
  /** The printed item numbers of the four rows. */
  items: [number, number, number, number];
}) {
  return (
    <div className="space-y-4">
      {PAY_ROWS.map(([prefix, label], i) => (
        <div key={prefix}>
          <div className="mb-1.5 text-[13px] font-semibold text-content">
            {label} (Item {items[i]})
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Text
              compact
              label={`${label}: drawee bank or agency`}
              value={values[`${prefix}Bank`] ?? ""}
              onChange={(v) => set(`${prefix}Bank`, v)}
            />
            <Text
              compact
              label={`${label}: number`}
              value={values[`${prefix}Number`] ?? ""}
              onChange={(v) => set(`${prefix}Number`, v)}
            />
            <Text
              compact
              label={`${label}: date`}
              type="date"
              value={values[`${prefix}Date`] ?? ""}
              onChange={(v) => set(`${prefix}Date`, v)}
            />
            <Money
              compact
              label={`${label}: amount`}
              value={values[`${prefix}Amount`] ?? ""}
              onChange={(v) => set(`${prefix}Amount`, v)}
            />
          </div>
        </div>
      ))}
      <div>
        <div className="mb-1.5 text-[13px] font-semibold text-content">
          Others (Item {items[3]})
        </div>
        <div className="grid gap-2 sm:grid-cols-5">
          <Text
            compact
            label="Others: specify"
            value={values.payOthersSpecify ?? ""}
            onChange={(v) => set("payOthersSpecify", v)}
          />
          <Text
            compact
            label="Others: drawee bank or agency"
            value={values.payOthersBank ?? ""}
            onChange={(v) => set("payOthersBank", v)}
          />
          <Text
            compact
            label="Others: number"
            value={values.payOthersNumber ?? ""}
            onChange={(v) => set("payOthersNumber", v)}
          />
          <Text
            compact
            label="Others: date"
            type="date"
            value={values.payOthersDate ?? ""}
            onChange={(v) => set("payOthersDate", v)}
          />
          <Money
            compact
            label="Others: amount"
            value={values.payOthersAmount ?? ""}
            onChange={(v) => set("payOthersAmount", v)}
          />
        </div>
      </div>
    </div>
  );
}
