// ssoErrors.ts — what the sign-in page says when a provider sign-in was refused.
// The API's SSO callback redirects to /login?sso_error=<code>[&provider=…]
// [&sso_detail=…]; only the code (and provider) choose the words.

/** Friendly copy for the ?sso_error= codes the API callback redirects with. */
export const SSO_ERRORS: Record<string, string> = {
  "no-account":
    "No active portal account matches that email. Ask the firm to invite you first, then try again.",
  cancelled: "Sign-in was cancelled at the provider.",
  denied:
    "You declined access at the provider. Try again and approve the sign-in to continue.",
  provider:
    "The provider rejected the sign-in. Your Microsoft/Google tenant likely requires a one-time admin consent for this app — grant it in the provider's admin console (for Microsoft: Entra ID → Enterprise applications → this app → Permissions → “Grant admin consent”), then try again.",
  unavailable: "That sign-in method isn't configured yet.",
  state: "The sign-in attempt expired — please try again.",
  email: "The provider didn't share a verified email address for your account.",
  exchange: "The provider rejected the sign-in — please try again.",
  userinfo: "The provider rejected the sign-in — please try again.",
  failed: "SSO sign-in failed — please try again.",
};

/** U9 (D44): the provider's account email is not verified. */
export const EMAIL_UNVERIFIED = "email-unverified";

/**
 * The sign-in page's message for an `sso_error` (W9 R1). An unverified email
 * names the provider that refused it and offers the other ways in; U9 as first
 * deployed sends no provider, and it was Microsoft that refused. Every other
 * code keeps its own text, and an unknown one the generic failure.
 */
export function ssoErrorMessage(
  code: string,
  provider?: string | null,
  detail?: string | null,
): string {
  let text: string;
  if (code === EMAIL_UNVERIFIED) {
    text =
      provider === "google"
        ? "This Google account's email is not verified. Sign in with your email and password, or with Microsoft."
        : "This Microsoft account's email is not verified. Sign in with your email and password, or with Google.";
  } else {
    text = SSO_ERRORS[code] ?? SSO_ERRORS.failed!;
  }
  return detail ? `${text} (provider code: ${detail})` : text;
}
