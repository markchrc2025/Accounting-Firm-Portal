/** Provider-agnostic outbound email. Adapters implement one function each and
 *  are selected by MAIL_PROVIDER — swapping senders is config, not code. */

export interface SendMailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  provider: MailProvider;
  /** Provider-side id of the accepted message (Plunk emailId / Postal token),
   *  or null when the provider accepted without one. */
  messageId: string | null;
}

export type MailProvider = "plunk" | "postal";

export interface MailConfig {
  provider: MailProvider;
  fromEmail: string;
  fromName: string;
  plunkSecretKey?: string;
  postalApiKey?: string;
  postalBaseUrl: string;
}

/** Actionable, provider-labeled failure (no secrets, truncated bodies). */
export class MailError extends Error {}

/** Keep provider error bodies short enough for a status column / log line. */
export function truncateBody(body: string, max = 300): string {
  const oneLine = body.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}
