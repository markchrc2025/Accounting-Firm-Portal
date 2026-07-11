import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { acceptInvitation, ApiError } from "../lib/api";
import { AuthLayout } from "../components/AuthLayout";
import { cn } from "../components/ui";

/**
 * Invitation-accept (public, design handoff screen group A). Reuses the split
 * navy/cream `AuthLayout`. The token handling and the `acceptInvitation` flow are
 * preserved verbatim; only the presentation matches the MCRC design.
 */
export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await acceptInvitation({ token, fullName, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept invitation");
    } finally {
      setBusy(false);
    }
  }

  // Purely presentational password-strength hint (does not gate submission).
  const strength = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  return (
    <AuthLayout>
      <div className="animate-fade-rise">
        <div className="eyebrow mb-2">MCRC Tax &amp; Accounting</div>
        <h1 className="font-serif text-[34px] font-medium text-navy">Accept your invitation</h1>
        <p className="mb-7 mt-1 text-[13.5px] text-content-secondary">
          Set your name and password to activate your client-portal account.
        </p>

        {!token && (
          <div className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
            Missing invitation token in the link.
          </div>
        )}

        {done ? (
          <div className="rounded-card border border-success/30 bg-success-bg px-4 py-3.5 text-[13.5px] text-success">
            Your account is ready.{" "}
            <Link to="/login" className="font-semibold underline hover:text-navy-hover">
              Sign in
            </Link>
            .
          </div>
        ) : (
          token && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
                  {error}
                </div>
              )}
              <div>
                <label
                  htmlFor="fullName"
                  className="mb-1.5 block text-[13px] font-semibold text-content"
                >
                  Full name
                </label>
                <input
                  id="fullName"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input"
                  autoComplete="name"
                  placeholder="Juan dela Cruz"
                />
              </div>
              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-[13px] font-semibold text-content"
                >
                  Password <span className="font-normal text-content-muted">(min 8 chars)</span>
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input"
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
                <div className="mt-2 flex gap-1.5" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={cn(
                        "h-1 flex-1 rounded-full transition-colors",
                        i < strength ? "bg-success" : "bg-line-input",
                      )}
                    />
                  ))}
                </div>
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-btn bg-navy px-4 py-[11px] text-[13.5px] font-semibold text-white transition-colors hover:bg-navy-hover disabled:opacity-50"
              >
                {busy ? "Creating account…" : "Activate account"}
              </button>
              <p className="text-center text-[12px] text-content-muted">
                Multi-factor authentication is required for all MCRC accounts.
              </p>
            </form>
          )
        )}
      </div>
    </AuthLayout>
  );
}
