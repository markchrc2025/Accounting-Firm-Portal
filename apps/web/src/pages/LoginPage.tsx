import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "../auth/AuthContext";
import { ApiError, fetchSsoProviders, ssoStartUrl } from "../lib/api";
import { AuthLayout } from "../components/AuthLayout";

/** Friendly copy for the ?sso_error= codes the API callback redirects with. */
const SSO_ERRORS: Record<string, string> = {
  "no-account":
    "No active portal account matches that email. Ask the firm to invite you first, then try again.",
  cancelled: "Sign-in was cancelled at the provider.",
  unavailable: "That sign-in method isn't configured yet.",
  state: "The sign-in attempt expired — please try again.",
  email: "The provider didn't share a verified email address for your account.",
  exchange: "The provider rejected the sign-in — please try again.",
  userinfo: "The provider rejected the sign-in — please try again.",
  failed: "SSO sign-in failed — please try again.",
};

/**
 * Sign-in (design handoff screens 1–2). Password step, then — when the API returns
 * an MFA challenge token — an authenticator-code step, both inside the split brand
 * layout. The real `useAuth` flow (signIn → completeMfa) is preserved verbatim.
 */
export default function LoginPage() {
  const { signIn, completeMfa } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const ssoErrorCode = params.get("sso_error");
  const [error, setError] = useState<string | null>(
    ssoErrorCode ? (SSO_ERRORS[ssoErrorCode] ?? SSO_ERRORS.failed!) : null,
  );
  const [busy, setBusy] = useState(false);

  const ssoProviders = useQuery({
    queryKey: ["sso-providers"],
    queryFn: () => fetchSsoProviders(),
    staleTime: 5 * 60 * 1000,
  });
  const showGoogle = ssoProviders.data?.google ?? false;
  const showMicrosoft = ssoProviders.data?.microsoft ?? false;

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

            {(showGoogle || showMicrosoft) && (
              <>
                <div className="flex items-center gap-3 pt-1">
                  <span className="h-px flex-1 bg-line-strong" />
                  <span className="font-mono text-[10px] uppercase tracking-[.18em] text-content-muted">
                    or continue with
                  </span>
                  <span className="h-px flex-1 bg-line-strong" />
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {showGoogle && (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = ssoStartUrl("google");
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-btn border border-line-strong bg-card px-4 py-[10px] text-[13.5px] font-semibold text-content transition-colors hover:border-navy hover:text-navy"
                    >
                      <span aria-hidden className="font-serif text-[15px] font-bold">
                        G
                      </span>
                      Google
                    </button>
                  )}
                  {showMicrosoft && (
                    <button
                      type="button"
                      onClick={() => {
                        window.location.href = ssoStartUrl("microsoft");
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-btn border border-line-strong bg-card px-4 py-[10px] text-[13.5px] font-semibold text-content transition-colors hover:border-navy hover:text-navy"
                    >
                      <span aria-hidden className="grid grid-cols-2 gap-[1.5px]">
                        <span className="h-[6px] w-[6px] bg-[#f25022]" />
                        <span className="h-[6px] w-[6px] bg-[#7fba00]" />
                        <span className="h-[6px] w-[6px] bg-[#00a4ef]" />
                        <span className="h-[6px] w-[6px] bg-[#ffb900]" />
                      </span>
                      Microsoft
                    </button>
                  )}
                </div>
              </>
            )}
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
