// BookFigures — the pieces of "Portal books | Manual" the 2551Q and 2550Q
// editors share (W16): the switch, the notes, the badge under a fed figure,
// the question "Fill from the Portal's books?", and a filed return's one line.
// The state lives in useBookFigures; these only show it. Nothing here prints:
// the badges, the notes and the question exist only in the editor.

import { createContext, useContext, useEffect, useId, useState } from "react";
import { Button, cn } from "../ui";
import { filedLine, fillItemText, staleNote } from "../../lib/bookFigures";
import type { BookFigures } from "./useBookFigures";

const BookContext = createContext<BookFigures | null>(null);
export const BookProvider = BookContext.Provider;

/** The switch, at the top of the input card, with "Refresh from books" and the
 *  books' error where the user is looking. */
export function BookSwitch({ books }: { books: BookFigures }) {
  if (!books.enabled) return null;
  const options: ["books" | "manual", string][] = [
    ["books", "Portal books"],
    ["manual", "Manual"],
  ];
  return (
    <div data-book-switch className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <div
          role="radiogroup"
          className="flex items-center gap-1 rounded-full border border-line bg-sidebar p-0.5"
        >
          {options.map(([value, label]) => {
            const on = books.mode === value;
            return (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={books.fetching}
                onClick={() => books.choose(value)}
                className={cn(
                  "rounded-full px-3 py-1 text-[12px] font-medium transition-colors disabled:opacity-60",
                  on
                    ? "bg-navy text-white shadow-sm"
                    : "text-content-secondary hover:text-content",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        {books.mode === "books" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={books.fetching}
            onClick={books.refresh}
          >
            Refresh from books
          </Button>
        ) : null}
      </div>
      {books.error ? (
        <p
          data-book-error
          role="alert"
          className="rounded-input border border-danger/40 bg-danger-bg px-3 py-2 text-[12.5px] text-danger-ink"
        >
          {books.error}
        </p>
      ) : null}
    </div>
  );
}

/** The quiet notes above the card: the books' own warnings, word for word, and
 *  the note that the books moved on after the draft was filled. */
export function BookNotes({ books }: { books: BookFigures }) {
  if (!books.enabled) return null;
  const showStale = books.mode === "books" && books.stale > 0;
  if (books.warnings.length === 0 && !showStale) return null;
  return (
    <div className="mb-5 space-y-2 text-[12.5px] text-content-secondary">
      {books.warnings.length > 0 ? (
        <ul data-book-warnings className="list-disc space-y-1 pl-5">
          {books.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      ) : null}
      {showStale ? (
        <p data-book-stale className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>{staleNote(books.stale)}</span>
          <Button variant="link" size="sm" className="px-0 py-0" onClick={books.review}>
            Review and refresh
          </Button>
        </p>
      ) : null}
    </div>
  );
}

/** Under a fed figure: where it came from, and a way to the records. */
export function BookBadge({ id }: { id: string }) {
  const books = useContext(BookContext);
  const info = books?.badge(id);
  if (!info) return null;
  return (
    <p
      data-book-badge={id}
      className={cn(
        "mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px]",
        info.edited ? "text-danger-ink" : "text-content-secondary",
      )}
    >
      <span>{info.text}</span>
      {info.href ? (
        <a
          href={info.href}
          target="_blank"
          rel="noreferrer"
          title={info.title ?? undefined}
          className="text-blue underline-offset-2 hover:underline"
        >
          View records
        </a>
      ) : null}
      {info.edited ? (
        <button
          type="button"
          onClick={info.reset}
          className="text-blue underline-offset-2 hover:underline"
        >
          Reset
        </button>
      ) : null}
    </p>
  );
}

/** A filed return that was filled from the books says so, once, quietly. */
export function BookFiledLine({ books }: { books: BookFigures }) {
  if (!books.filledOn) return null;
  return (
    <p data-book-filed-line className="mb-5 text-[12.5px] text-content-secondary">
      {filedLine(books.filledOn)}
    </p>
  );
}

/** "Fill from the Portal's books?" — each changing figure, then two buttons.
 *  A refresh lets the user tick each one; a figure they typed over starts
 *  unticked. Escape and a click outside are "Keep my numbers". */
export function BookQuestionDialog({ books }: { books: BookFigures }) {
  const q = books.question;
  const titleId = useId();
  const [ticked, setTicked] = useState<string[]>([]);
  const kind = q?.kind;
  const items = q?.items;
  useEffect(() => {
    if (items) setTicked(items.filter((i) => !i.edited).map((i) => i.id));
  }, [items]);
  const { answer } = books;
  useEffect(() => {
    if (!q) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") answer(false, []);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [q, answer]);
  if (!q) return null;
  const choose = kind === "refresh";
  const toggle = (id: string) =>
    setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={() => answer(false, [])}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md overflow-hidden rounded-card border border-line bg-card shadow-xl"
      >
        <p id={titleId} className="px-6 pb-2 pt-5 text-[14px] font-medium text-content">
          Fill from the Portal&apos;s books?
        </p>
        <ul className="max-h-72 space-y-1.5 overflow-y-auto px-6 pb-2 text-[13px] text-content-secondary">
          {q.items.map((it) => (
            <li key={it.id} data-book-item>
              {choose ? (
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={ticked.includes(it.id)}
                    onChange={() => toggle(it.id)}
                  />
                  <span>{fillItemText(it.label, it.typed, it.books)}</span>
                </label>
              ) : (
                <span>{fillItemText(it.label, it.typed, it.books)}</span>
              )}
            </li>
          ))}
        </ul>
        <div className="flex justify-end gap-2 px-6 py-4">
          <Button variant="outline" size="sm" onClick={() => answer(false, [])} autoFocus>
            Keep my numbers
          </Button>
          <Button
            size="sm"
            onClick={() => answer(true, choose ? ticked : q.items.map((i) => i.id))}
          >
            Fill from books
          </Button>
        </div>
      </div>
    </div>
  );
}
