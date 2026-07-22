import { MailConfig, MailError, SendMailInput, truncateBody } from "./mail.types";

/**
 * Postal (self-hosted) adapter — same interface as Plunk, selected with
 * MAIL_PROVIDER=postal once that server is ready. The message token from
 * data.messages[<recipient>] is stored as the provider message id.
 */
export async function sendViaPostal(cfg: MailConfig, input: SendMailInput): Promise<string | null> {
  const res = await fetch(cfg.postalSendUrl, {
    method: "POST",
    headers: {
      "X-Server-API-Key": cfg.postalApiKey ?? "",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: [input.to],
      from: `${input.fromName ?? cfg.fromName} <${input.fromEmail ?? cfg.fromEmail}>`,
      subject: input.subject,
      html_body: input.html,
      plain_body: input.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new MailError(`Postal responded ${res.status}: ${truncateBody(body)}`);
  }
  const data: unknown = await res.json().catch(() => null);
  return extractPostalToken(data, input.to);
}

function extractPostalToken(data: unknown, to: string): string | null {
  if (!data || typeof data !== "object") return null;
  const d = data as { status?: unknown; data?: { messages?: Record<string, { token?: unknown; id?: unknown }> } };
  if (d.status && d.status !== "success") {
    throw new MailError(`Postal rejected the message (status ${String(d.status)}).`);
  }
  const msg = d.data?.messages?.[to];
  if (msg && typeof msg.token === "string") return msg.token;
  if (msg && (typeof msg.id === "string" || typeof msg.id === "number")) return String(msg.id);
  return null;
}
