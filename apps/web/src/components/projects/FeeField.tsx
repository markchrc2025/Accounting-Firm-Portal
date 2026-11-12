// FeeField - the project's professional fee (PB7, PA8 / D70): pesos, zero or more, at most 2
// decimals. Only digits and one point can be typed or pasted; anything else is not taken. The API
// makes the final check and its sentence shows if it refuses. The client's own fee is offered as a
// one-click suggestion while the box is empty; it is never filled by itself.

import { useId, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button } from "../ui";
import { feeText, feeTypingOk } from "../../lib/projects";

const ALLOWED = new Set([
  "Backspace",
  "Delete",
  "Tab",
  "Enter",
  "Escape",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
]);

export function FeeField({
  value,
  onChange,
  suggested,
}: {
  value: string;
  onChange: (next: string) => void;
  /** The client's fee ("3500.00") to offer, or null. */
  suggested: string | null;
}) {
  const id = useId();
  function keys(e: KeyboardEvent<HTMLInputElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey || ALLOWED.has(e.key)) return;
    if (!/^[0-9.]$/.test(e.key)) e.preventDefault();
  }
  function paste(e: ClipboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const text = e.clipboardData.getData("text");
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    if (!feeTypingOk(next)) e.preventDefault();
  }
  return (
    <div data-fee-field>
      <label
        htmlFor={`${id}-fee`}
        className="mb-1.5 block text-[13px] font-semibold text-content"
      >
        Professional fee
      </label>
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="font-mono text-[14px] text-content-secondary">
          ₱
        </span>
        <input
          id={`${id}-fee`}
          className="input font-mono"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          aria-describedby={`${id}-hint`}
          value={value}
          onKeyDown={keys}
          onPaste={paste}
          onChange={(e) => {
            if (feeTypingOk(e.target.value)) onChange(e.target.value);
          }}
        />
      </div>
      <span id={`${id}-hint`} className="mt-1 block text-[11.5px] text-content-secondary">
        Pesos. Optional; at most 2 decimals.
      </span>
      {suggested && value.trim() === "" ? (
        <Button
          variant="link"
          size="sm"
          className="mt-1 px-0"
          data-fee-suggestion
          onClick={() => onChange(suggested)}
        >
          Use the client&apos;s fee {feeText(suggested)}
        </Button>
      ) : null}
    </div>
  );
}
