import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError, setToken } from "../lib/api";
import { AuthLayout } from "../components/AuthLayout";

/**
 * Lands here from the API's SSO callback redirect. The portal token arrives in
 * the URL FRAGMENT (never sent to any server): `#sso=access&token=…` completes
 * the session immediately; `#sso=mfa&token=…` runs the portal's own TOTP
 * challenge before a session is issued.
 */
export default function SsoCallbackPage() {
  const { completeMfa, refreshUser } = useAuth();
  const navigate = useNavigate();
  const handled = useRef(false);

  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const kind = params.get("sso");
    const token = params.get("token");
    // Consume the fragment so the token never lingers in the address bar.
    window.history.replaceState(null, "", window.location.pathname);
    if (!kind || !token) {
      setError("This sign-in link is incomplete — please start again.");
      return;
    }
    if (kind === "mfa") {
      setMfaToken(token);
      return;
    }
    setToken(token);
    void refreshUser()
      .then(() => navigate("/", { replace: true }))
      .catch(() => {
        setToken(null);
        setError("Could not complete the sign-in — please try again.");
      });
  }, [navigate, refreshUser]);

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await completeMfa(mfaToken!, code);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout>
      <div className="animate-fade-rise">
        <div className="eyebrow mb-2">MCRC Tax &amp; Accounting</div>
        <h1 className="font-serif text-[34px] font-medium text-navy">
          {mfaToken ? "Verify it's you" : "Signing you in…"}
        </h1>
        <p className="mb-7 mt-1 text-[13.5px] text-content-secondary">
          {mfaToken
            ? "You're verified with your provider — now enter the 6-digit code from your authenticator app."
            : error
              ? "Something went wrong."
              : "Completing your secure sign-in."}
        </p>

        {error && (
          <div className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
            {error}
          </div>
        )}

        {mfaToken ? (
          <form onSubmit={handleMfa} className="space-y-4">
            <div>
              <label htmlFor="code" className="mb-1.5 block text-[13px] font-semibold text-content">
                6-digit code
              </label>
              <input
                id="code"
                inputMode="numeric"
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="input text-center font-mono text-[22px] tracking-[.5em]"
                placeholder="——————"
                autoFocus
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-btn bg-navy px-4 py-[11px] text-[13.5px] font-semibold text-white transition-colors hover:bg-navy-hover disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
          </form>
        ) : null}

        {error && (
          <Link
            to="/login"
            className="mt-4 inline-block text-[13px] font-semibold text-blue hover:text-navy-hover hover:underline"
          >
            Back to sign in
          </Link>
        )}
      </div>
    </AuthLayout>
  );
}
