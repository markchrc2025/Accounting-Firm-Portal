import { MailConfig, MailError, SendMailInput, truncateBody } from "./mail.types";

// Plunk transactional send (docs.useplunk.com/api-reference). The current API
// host is next-api.useplunk.com; the older api.useplunk.com also exists — if
// Plunk ever 404s here, check the docs for the active base URL.
const PLUNK_SEND_URL = "https://next-api.useplunk.com/v1/send";

/** POST the message to Plunk; returns the provider emailId (or null). */
export async function sendViaPlunk(cfg: MailConfig, input: SendMailInput): Promise<string | null> {
  const res = await fetch(PLUNK_SEND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.plunkSecretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: input.to,
      subject: input.subject,
      body: input.html,
      from: cfg.fromEmail,
      name: cfg.fromName,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MailError(`Plunk responded ${res.status}: ${truncateBody(body)}`);
  }
  const data: unknown = await res.json().catch(() => null);
  return extractPlunkEmailId(data);
}

/** The send response carries the emailId; be liberal about where it sits. */
function extractPlunkEmailId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.emailId === "string") return d.emailId;
  if (typeof d.id === "string") return d.id;
  if (Array.isArray(d.emails) && d.emails[0] && typeof d.emails[0] === "object") {
    const first = d.emails[0] as Record<string, unknown>;
    if (typeof first.id === "string") return first.id;
    if (typeof first.email === "string") return first.email;
  }
  return null;
}
