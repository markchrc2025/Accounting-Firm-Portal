import * as React from "react";
import { useNavigate } from "react-router-dom";

import { Button, Checkbox, Input, Label } from "@/components/ui";

import { AuthLayout } from "./AuthLayout";

/** Sign-in screen. Credentials submit advances to the MFA challenge. */
export function LoginScreen(): React.JSX.Element {
  const navigate = useNavigate();
  const [remember, setRemember] = React.useState(false);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    navigate("/mfa");
  }

  return (
    <AuthLayout>
      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <div className="eyebrow">MCRC Tax &amp; Accounting</div>
          <h1 className="font-serif text-[34px] font-medium leading-tight text-navy">
            Sign in
          </h1>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              placeholder="you@firm.ph"
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-password">Password</Label>
            <Input
              id="login-password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              required
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <label
            htmlFor="login-remember"
            className="flex cursor-pointer items-center gap-2 text-[13px] text-content-secondary"
          >
            <Checkbox
              id="login-remember"
              checked={remember}
              onCheckedChange={(checked) => setRemember(checked === true)}
            />
            Remember this device
          </label>
          <Button
            type="button"
            variant="link"
            size="sm"
            className="px-0"
            onClick={() => navigate("/forgot-password")}
          >
            Forgot password?
          </Button>
        </div>

        <Button type="submit" className="w-full">
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
