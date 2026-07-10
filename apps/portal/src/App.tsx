import { Navigate, Route, Routes } from "react-router-dom";

/**
 * Router skeleton. Screens land in later phases per the handoff build order:
 * theme + primitives (this PR) → app shell → auth → firm 5–19 → portal 20–21.
 * This placeholder verifies the theme, fonts, and token mapping are wired.
 */
function ThemePreview() {
  return (
    <div className="min-h-screen animate-fade-rise p-10">
      <p className="eyebrow">MCRC TAX &amp; ACCOUNTING · DESIGN SYSTEM</p>
      <h1 className="mt-2 font-serif text-[30px] font-medium text-navy">
        Portal foundation is online.
      </h1>
      <p className="mt-2 max-w-xl text-content-secondary">
        Tokens, fonts (Newsreader / Hanken Grotesk / IBM Plex Mono), and the
        Tailwind theme are mapped. Screens are built on top of this in the next
        phases.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        {(
          [
            ["Navy", "bg-navy text-white"],
            ["Gold", "bg-gold text-white"],
            ["Blue", "bg-blue text-white"],
            ["Success", "bg-success-bg text-success"],
            ["Warn", "bg-warn-bg text-warn"],
            ["Danger", "bg-danger-bg text-danger"],
            ["VAT chip", "bg-vatchip-bg text-vatchip"],
          ] as const
        ).map(([label, cls]) => (
          <span
            key={label}
            className={`rounded-chip px-3 py-1 font-mono text-[11px] ${cls}`}
          >
            {label}
          </span>
        ))}
      </div>

      <div className="mt-8 rounded-card border border-line-strong bg-card p-6">
        <p className="eyebrow">SAMPLE FIGURE</p>
        <p className="font-serif text-[36px] font-medium text-navy">
          ₱1,284,500.00
        </p>
        <p className="font-mono text-[12px] text-content-muted">
          TIN 004-215-889-000 · VAT REGIME
        </p>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ThemePreview />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
