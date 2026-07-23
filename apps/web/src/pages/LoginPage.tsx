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
  denied: "You declined access at the provider. Try again and approve the sign-in to continue.",
  provider:
    "The provider rejected the sign-in. Your Microsoft/Google tenant likely requires a one-time admin consent for this app — grant it in the provider's admin console (for Microsoft: Entra ID → Enterprise applications → this app → Permissions → “Grant admin consent”), then try again.",
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
  const ssoDetail = params.get("sso_detail");
  const [error, setError] = useState<string | null>(
    ssoErrorCode
      ? `${SSO_ERRORS[ssoErrorCode] ?? SSO_ERRORS.failed!}${
          ssoDetail ? ` (provider code: ${ssoDetail})` : ""
        }`
      : null,
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

        {/* On an SSO config error, show the exact callback URLs to register — the
            #1 cause is a redirect URI that isn't registered at the provider. */}
        {ssoErrorCode &&
          ssoErrorCode !== "no-account" &&
          ssoProviders.data?.redirectUris && (
            <div className="mb-5 rounded-input border border-line-strong bg-sidebar px-3.5 py-3 text-[12px] text-content-secondary">
              <p className="mb-1.5 font-semibold text-content">
                Admin setup — register these exact callback URLs at the provider:
              </p>
              <ul className="space-y-1">
                <li>
                  <span className="font-semibold">Google:</span>{" "}
                  <code className="break-all font-mono text-[11.5px] text-navy">
                    {ssoProviders.data.redirectUris.google}
                  </code>
                </li>
                <li>
                  <span className="font-semibold">Microsoft:</span>{" "}
                  <code className="break-all font-mono text-[11.5px] text-navy">
                    {ssoProviders.data.redirectUris.microsoft}
                  </code>
                </li>
              </ul>
              <p className="mt-1.5">
                Google Cloud Console → Credentials → OAuth client → Authorized redirect
                URIs. Azure → App registration → Authentication → Web → Redirect URIs.
              </p>
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
                      <svg
                        aria-hidden
                        width="18"
                        height="18"
                        viewBox="0 0 48 48"
                        className="flex-none"
                      >
                        <path
                          fill="#EA4335"
                          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                        />
                        <path
                          fill="#4285F4"
                          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                        />
                        <path
                          fill="#FBBC05"
                          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
                        />
                        <path
                          fill="#34A853"
                          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                        />
                      </svg>
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
