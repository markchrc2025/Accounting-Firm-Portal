import * as React from "react";
import { useNavigate } from "react-router-dom";

import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

import { AuthLayout } from "./AuthLayout";

const CODE_LENGTH = 6;

/** Two-factor challenge — six single-digit boxes with auto-advancing focus. */
export function MfaChallengeScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const [digits, setDigits] = React.useState<string[]>(() =>
    Array.from({ length: CODE_LENGTH }, () => ""),
  );
  const [active, setActive] = React.useState(0);
  const inputsRef = React.useRef<Array<HTMLInputElement | null>>([]);

  function focusBox(index: number): void {
    const clamped = Math.max(0, Math.min(CODE_LENGTH - 1, index));
    inputsRef.current[clamped]?.focus();
  }

  function handleChange(
    index: number,
    event: React.ChangeEvent<HTMLInputElement>,
  ): void {
    const raw = event.target.value.replace(/\D/g, "");
    if (raw === "") return;
    const value = raw.slice(-1);
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
    if (index < CODE_LENGTH - 1) focusBox(index + 1);
  }

  function handleKeyDown(
    index: number,
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void {
    if (event.key === "Backspace") {
      event.preventDefault();
      setDigits((prev) => {
        const next = [...prev];
        if (next[index]) {
          next[index] = "";
        } else if (index > 0) {
          next[index - 1] = "";
        }
        return next;
      });
      if (!digits[index] && index > 0) focusBox(index - 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusBox(index - 1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      focusBox(index + 1);
    }
  }

  function handleVerify(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    navigate("/");
  }

  return (
    <AuthLayout>
      <form onSubmit={handleVerify} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-[30px] font-medium leading-tight text-navy">
            Two-factor authentication
          </h1>
          <p className="text-[13.5px] leading-relaxed text-content-secondary">
            Enter the 6-digit code from your authenticator app to finish signing
            in.
          </p>
        </div>

        <div className="flex gap-2.5">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(el) => {
                inputsRef.current[index] = el;
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={1}
              aria-label={`Digit ${index + 1}`}
              value={digit}
              onChange={(event) => handleChange(index, event)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onFocus={() => setActive(index)}
              className={cn(
                "h-[58px] w-[50px] rounded-input border bg-card text-center font-mono text-[22px] text-content transition-colors outline-none",
                active === index
                  ? "border-2 border-blue ring-[3px] ring-blue/[0.14]"
                  : "border-line-input",
              )}
            />
          ))}
        </div>

        <Button type="submit" className="w-full">
          Verify &amp; continue
        </Button>

        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => navigate("/mfa-backup")}
          >
            Use a backup code
          </Button>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => navigate("/login")}
          >
            Back to sign in
          </Button>
        </div>
      </form>
    </AuthLayout>
  );
}
