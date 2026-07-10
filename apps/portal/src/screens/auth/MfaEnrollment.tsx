import * as React from "react";
import { Check, Copy } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

import { AuthLayout } from "./AuthLayout";

const MANUAL_KEY = "JBSW Y3DP EHPK 3PXP";

/** Faux QR — a deterministic 7×7 grid of navy/transparent cells. */
const QR_CELLS: boolean[] = Array.from({ length: 49 }, (_, i) => {
  const row = Math.floor(i / 7);
  const col = i % 7;
  // Position-detection corners + a repeatable interior pattern.
  const corner =
    (row < 3 && col < 3) || (row < 3 && col > 3) || (row > 3 && col < 3);
  return corner ? (row + col) % 2 === 0 : (row * 3 + col * 5) % 4 === 0;
});

/** First-time MFA enrollment — scan/enter the authenticator secret. */
export function MfaEnrollmentScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const [copied, setCopied] = React.useState(false);

  async function handleCopy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(MANUAL_KEY);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable (e.g. insecure context) — silently ignore.
    }
  }

  return (
    <AuthLayout>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="eyebrow">First-time setup · Step 2 of 2</div>
          <h1 className="font-serif text-[30px] font-medium leading-tight text-navy">
            Set up your authenticator
          </h1>
          <p className="text-[13.5px] leading-relaxed text-content-secondary">
            Scan the QR code with your authenticator app, or enter the key
            manually.
          </p>
        </div>

        <div className="flex items-start gap-5">
          <div className="flex h-[148px] w-[148px] flex-none items-center justify-center rounded-card border border-line-strong bg-card p-3">
            <div className="grid h-full w-full grid-cols-7 gap-[2px]">
              {QR_CELLS.map((filled, i) => (
                <span
                  key={i}
                  className={cn(
                    "rounded-[1px]",
                    filled ? "bg-navy" : "bg-transparent",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2 pt-1">
            <span className="font-mono text-[10px] uppercase tracking-eyebrow text-gold-deep">
              Manual key
            </span>
            <code className="font-mono text-[15px] tracking-wide text-content">
              {MANUAL_KEY}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 w-fit"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4 text-success" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>

        <p className="text-[12.5px] text-content-muted">
          Codes rotate every 30 seconds.
        </p>

        <Button
          type="button"
          className="w-full"
          onClick={() => navigate("/mfa")}
        >
          Continue
        </Button>
      </div>
    </AuthLayout>
  );
}
