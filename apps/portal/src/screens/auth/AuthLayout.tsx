import * as React from "react";

import { McrcMark } from "@/components/shell";

/**
 * Public auth shell — a full-viewport split layout used by the sign-in,
 * MFA, and invitation screens (rendered OUTSIDE the app shell, so this
 * component owns the whole screen: min-h-screen, background, and column
 * layout).
 *
 * LEFT (≥lg, 42%): navy brand panel on the `navy-hero` radial gradient with a
 * subtle 52px grid-line overlay (the one sanctioned use of rgba-white in a
 * component — a decorative texture, not a token), the white MCRC mark, an
 * italic serif tagline, and a mono footer.
 * RIGHT: the form column on cream (`sidebar`), vertically centered, ~420px wide.
 * Below `lg` the brand panel drops away and the form takes the single column.
 */
export function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-screen bg-sidebar">
      {/* Brand panel */}
      <aside className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-navy-hero p-12 lg:flex">
        {/* 52px grid-line overlay at ~4.5% white (decorative texture) */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "repeating-linear-gradient(0deg, rgba(255,255,255,0.045) 0, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 52px), repeating-linear-gradient(90deg, rgba(255,255,255,0.045) 0, rgba(255,255,255,0.045) 1px, transparent 1px, transparent 52px)",
          }}
        />
        <div className="relative flex items-center gap-3">
          <McrcMark variant="navy" size={40} />
          <div className="flex flex-col">
            <span className="font-serif text-[19px] font-semibold leading-none text-white">
              MCRC
            </span>
            <span className="mt-1 font-mono text-[8.5px] uppercase tracking-eyebrow text-blue-soft">
              Tax &amp; Accounting
            </span>
          </div>
        </div>

        <p className="relative max-w-[22ch] font-serif text-[30px] font-medium italic leading-tight text-white">
          Your growth, accounted for.
        </p>

        <p className="relative font-mono text-[10px] uppercase tracking-eyebrowwide text-blue-muted">
          Client &amp; Firm Portal
        </p>
      </aside>

      {/* Form area */}
      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px]">{children}</div>
      </main>
    </div>
  );
}
