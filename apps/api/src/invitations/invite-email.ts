/** The Invite User email — plain, professional, provider-agnostic content. */

export interface InviteEmailParams {
  firmName: string;
  inviterName: string;
  /** Human role label, e.g. "Accountant" or "Client Owner". */
  roleLabel: string;
  acceptUrl: string;
  expiresAt: Date;
  /** Which side of the portal the invite opens. */
  portalLabel: string; // e.g. "firm portal" | "client portal"
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function expiryText(expiresAt: Date): string {
  return expiresAt.toLocaleDateString("en-PH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Manila",
  });
}

export function inviteEmail(p: InviteEmailParams): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = `${p.firmName} — you're invited to the ${p.portalLabel}`;
  const expiry = expiryText(p.expiresAt);

  const text = [
    `Hello,`,
    ``,
    `${p.inviterName} has invited you to join ${p.firmName}'s ${p.portalLabel} as ${p.roleLabel}.`,
    ``,
    `Accept the invitation and set up your account here:`,
    p.acceptUrl,
    ``,
    `This invitation link expires on ${expiry}. If it expires, ask ${p.inviterName} to send a new one.`,
    ``,
    `If you weren't expecting this invitation, you can ignore this email.`,
    ``,
    `${p.firmName}`,
  ].join("\n");

  const html = `
<div style="margin:0 auto;max-width:560px;padding:32px 24px;font-family:Georgia,'Times New Roman',serif;color:#1c2b36;">
  <p style="margin:0 0 4px;font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:#8a6d1d;font-family:Arial,Helvetica,sans-serif;">
    ${esc(p.firmName)}
  </p>
  <h1 style="margin:0 0 20px;font-size:22px;font-weight:600;color:#0e212c;">You're invited</h1>
  <p style="margin:0 0 14px;font-size:15px;line-height:1.6;">
    ${esc(p.inviterName)} has invited you to join <strong>${esc(p.firmName)}</strong>'s
    ${esc(p.portalLabel)} as <strong>${esc(p.roleLabel)}</strong>.
  </p>
  <p style="margin:0 0 24px;font-size:15px;line-height:1.6;">
    Click below to accept the invitation and set up your account.
  </p>
  <p style="margin:0 0 24px;">
    <a href="${esc(p.acceptUrl)}"
       style="display:inline-block;background:#0e212c;color:#f5efdf;text-decoration:none;padding:11px 22px;border-radius:6px;font-size:14px;font-family:Arial,Helvetica,sans-serif;">
      Accept invitation
    </a>
  </p>
  <p style="margin:0 0 6px;font-size:12.5px;line-height:1.6;color:#5b6b76;font-family:Arial,Helvetica,sans-serif;">
    Or copy this link into your browser:<br>
    <a href="${esc(p.acceptUrl)}" style="color:#1c4f6e;word-break:break-all;">${esc(p.acceptUrl)}</a>
  </p>
  <p style="margin:16px 0 0;font-size:12.5px;line-height:1.6;color:#5b6b76;font-family:Arial,Helvetica,sans-serif;">
    This link expires on <strong>${esc(expiry)}</strong>. If it expires, ask
    ${esc(p.inviterName)} to send a new one. If you weren't expecting this
    invitation, you can safely ignore this email.
  </p>
</div>`.trim();

  return { subject, html, text };
}
