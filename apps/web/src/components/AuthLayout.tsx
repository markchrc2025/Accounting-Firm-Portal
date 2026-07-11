import type { ReactNode } from "react";
import { McrcMark } from "./McrcMark";

/**
 * Split auth layout (design handoff, screen group A): left navy brand panel
 * (radial navy gradient + faint grid overlay, logo, italic serif tagline, mono
 * footer), right form column on cream. The brand panel is hidden below `lg`.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-sidebar">
      {/* Brand panel */}
      <div className="relative hidden w-[42%] flex-col justify-between overflow-hidden bg-navy-hero p-12 lg:flex">
        {/* 52px grid overlay at 4.5% white */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(255,255,255,0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.045) 1px, transparent 1px)",
            backgroundSize: "52px 52px",
          }}
          aria-hidden="true"
        />
        <div className="relative flex items-center gap-3">
          <McrcMark variant="navy" size={34} />
          <div>
            <div className="font-serif text-[19px] font-medium text-white">MCRC</div>
            <div className="font-mono text-[9.5px] uppercase tracking-[.24em] text-gold-soft">
              Tax &amp; Accounting
            </div>
          </div>
        </div>
        <div className="relative">
          <p className="max-w-sm font-serif text-[26px] font-medium italic leading-snug text-white">
            Your growth, accounted for.
          </p>
        </div>
        <div className="relative font-mono text-[10px] uppercase tracking-[.24em] text-blue-soft">
          Client &amp; Firm Portal
        </div>
      </div>

      {/* Form column */}
      <div className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-[420px]">{children}</div>
      </div>
    </div>
  );
}
