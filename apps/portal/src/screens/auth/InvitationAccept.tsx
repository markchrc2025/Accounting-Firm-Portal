import * as React from "react";
import { useNavigate } from "react-router-dom";

import { Button, Input, Label } from "@/components/ui";
import { cn } from "@/lib/utils";

import { AuthLayout } from "./AuthLayout";

/** Simple 0–4 password strength from length + character-class variety. */
function scorePassword(value: string): number {
  if (!value) return 0;
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value) && /[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(4, score);
}

/** Invitation acceptance — the invitee sets a name + password, then enrolls MFA. */
export function InvitationAcceptScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const [password, setPassword] = React.useState("");
  const strength = scorePassword(password);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    navigate("/mfa-enroll");
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="font-serif text-[30px] font-medium leading-tight text-navy">
            Create your account
          </h1>
        </div>

        <div className="rounded-card bg-info-bg px-4 py-3 text-[13px] leading-relaxed text-info">
          Marielle Reyes-Cruz invited you to join MCRC Tax &amp; Accounting as an
          Accountant.
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-name">Full name</Label>
            <Input
              id="invite-name"
              type="text"
              autoComplete="name"
              placeholder="Juan dela Cruz"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-password">Password</Label>
            <Input
              id="invite-password"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            <div
              className="mt-1 flex gap-1.5"
              role="meter"
              aria-label="Password strength"
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={strength}
            >
              {[0, 1, 2, 3].map((segment) => (
                <span
                  key={segment}
                  className={cn(
                    "h-1.5 flex-1 rounded-chip transition-colors",
                    segment < strength ? "bg-success" : "bg-line-strong",
                  )}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-confirm">Confirm password</Label>
            <Input
              id="invite-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        <p className="text-[12.5px] text-content-muted">
          Multi-factor authentication is required for all MCRC accounts.
        </p>

        <Button type="submit" className="w-full">
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}
