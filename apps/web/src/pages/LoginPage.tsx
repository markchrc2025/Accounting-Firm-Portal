import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../lib/api";
import { AuthLayout } from "../components/AuthLayout";

/**
 * Sign-in (design handoff screens 1–2). Password step, then — when the API returns
 * an MFA challenge token — an authenticator-code step, both inside the split brand
 * layout. The real `useAuth` flow (signIn → completeMfa) is preserved verbatim.
 */
export default function LoginPage() {
  const { signIn, completeMfa } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await signIn(email, password);
      if (res.mfaToken) setMfaToken(res.mfaToken);
      else navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleMfa(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await completeMfa(mfaToken!, code);
      navigate("/");
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
          {mfaToken ? "Verify it's you" : "Sign in"}
        </h1>
        <p className="mb-7 mt-1 text-[13.5px] text-content-secondary">
          {mfaToken
            ? "Enter the 6-digit code from your authenticator app."
            : "Sign in to continue to your portal."}
        </p>

        {error && (
          <div className="mb-5 rounded-input border border-danger/40 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
            {error}
          </div>
        )}

        {!mfaToken ? (
          <form onSubmit={handlePassword} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1.5 block text-[13px] font-semibold text-content">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input"
                autoComplete="username"
                placeholder="you@firm.ph"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-[13px] font-semibold text-content">
                  Password
                </label>
                <a
                  href="/forgot-password"
                  className="text-[12.5px] font-semibold text-blue hover:text-navy-hover hover:underline"
                >
                  Forgot password?
                </a>
              </div>
              <input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </div>
            <label className="flex items-center gap-2.5 text-[13px] text-content-secondary">
              <input
                type="checkbox"
                className="h-4 w-4 rounded-[4px] border-line-input accent-navy"
              />
              Remember this device
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-btn bg-navy px-4 py-[11px] text-[13.5px] font-semibold text-white transition-colors hover:bg-navy-hover disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
        ) : (
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
            <button
              type="button"
              onClick={() => {
                setMfaToken(null);
                setCode("");
                setError(null);
              }}
              className="w-full text-center text-[12.5px] font-semibold text-blue hover:text-navy-hover hover:underline"
            >
              Back to sign in
            </button>
          </form>
        )}
      </div>
    </AuthLayout>
  );
}
