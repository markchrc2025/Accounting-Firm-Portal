// Shared visual system for all transactional emails (design handoff:
// docs/design_handoff_transactional_emails). Everything here renders
// TABLE-BASED layout with INLINE styles only — email clients strip <style>,
// flexbox, and grid. The prototype's inbox frame / section dividers were
// review scaffolding and are intentionally not reproduced.

// ---------------------------------------------------------------- tokens

export const C = {
  navy: "#0e2a45",
  navy2: "#15395d",
  ink: "#16212c",
  body: "#2b3742",
  muted: "#5b6976",
  muted2: "#7a8894",
  meta: "#8a97a3",
  goldDeep: "#a3781f",
  gold: "#c0902f",
  goldSoft: "#e6c87c",
  paper: "#f6f2ea",
  cardWhite: "#ffffff",
  borderPaper: "#e3dccd",
  rowDivider: "#f0ebe0",
  link: "#2360c8",
  success: "#1f7a4d",
  alertRed: "#c0392b",
  warnBg: "#fff8e8",
  warnBorder: "#e8d9a8",
  warnText: "#6b5a2a",
  confidential: "#9a9078",
  navyMeta: "#8fa4ba",
  navyBody: "#fbfaf7",
} as const;

export const SERIF = `Newsreader, Georgia, 'Times New Roman', serif`;
export const SANS = `'Hanken Grotesk', 'Helvetica Neue', Arial, sans-serif`;
export const MONO = `'IBM Plex Mono', 'Courier New', monospace`;

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap";

/** Resolved per-firm theme (Firm Admin Settings → email settings). */
export interface EmailTheme {
  firmName: string;
  /** Footer support address. Billing emails pass their own footer address. */
  supportEmail: string;
  buttonAccent: "navy" | "gold";
  showBrandLockup: boolean;
}

export function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ------------------------------------------------------------- primitives

/** A full-width single-cell presentation table (the layout workhorse). */
function block(inner: string, tdStyle = ""): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="${tdStyle}">${inner}</td></tr></table>`;
}

export function eyebrow(text: string): string {
  return `<div style="font-family:${MONO}; font-size:11.5px; letter-spacing:.22em; text-transform:uppercase; color:${C.goldDeep};">${esc(
    text,
  )}</div>`;
}

export function heading(text: string): string {
  return `<h1 style="margin:12px 0 0; font-family:${SERIF}; font-weight:600; font-size:31px; line-height:1.1; letter-spacing:-.01em; color:${C.navy};">${esc(
    text,
  )}</h1>`;
}

/** Body paragraph (pass pre-escaped HTML for emphasis spans). */
export function para(html: string, marginTop = 18): string {
  return `<p style="margin:${marginTop}px 0 0; font-family:${SERIF}; font-size:17px; line-height:1.55; color:${C.body};">${html}</p>`;
}

export function finePrint(html: string, marginTop = 18): string {
  return `<p style="margin:${marginTop}px 0 0; font-family:${SANS}; font-size:12.5px; line-height:1.6; color:${C.muted2};">${html}</p>`;
}

export function strong(text: string): string {
  return `<strong style="color:${C.ink}; font-weight:600;">${esc(text)}</strong>`;
}

export function link(label: string, url: string): string {
  return `<a href="${esc(url)}" style="color:${C.link}; text-decoration:underline;">${esc(label)}</a>`;
}

/** Bulletproof CTA button (VML fallback for Outlook). */
export function button(label: string, url: string, theme: EmailTheme, marginTop = 20): string {
  const bg = theme.buttonAccent === "gold" ? C.goldDeep : C.navy;
  return `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr><td style="border-radius:6px; background:${bg};">
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${esc(
    url,
  )}" style="height:44px;v-text-anchor:middle;width:260px;" arcsize="14%" fillcolor="${bg}" stroke="f"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:14px;font-weight:600;">${esc(
    label,
  )}</center></v:roundrect><![endif]--><!--[if !mso]><!--><a href="${esc(
    url,
  )}" style="display:inline-block; background:${bg}; color:#ffffff; font-family:${SANS}; font-weight:600; font-size:14.5px; padding:13px 24px; border-radius:6px; text-decoration:none;">${esc(
    label,
  )}</a><!--<![endif]--></td></tr></table>`;
}

/** "Or copy this link into your browser:" + raw tokenized URL. */
export function rawLinkFallback(url: string): string {
  return `${finePrint("Or copy this link into your browser:", 18)}
<div style="margin-top:6px; word-break:break-all; font-family:${MONO}; font-size:11.5px; line-height:1.5;"><a href="${esc(
    url,
  )}" style="color:${C.link}; text-decoration:underline;">${esc(url)}</a></div>`;
}

/** Brand lockup: shield monogram + firm wordmark, gold rule below. */
export function brandLockup(theme: EmailTheme): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px;"><tr>
<td width="26" style="width:26px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="26" height="26" style="width:26px; height:26px; background:${C.navy}; border-radius:8px; font-family:${SERIF}; font-size:14px; font-weight:500; color:${C.goldSoft}; text-align:center; vertical-align:middle;">M</td></tr></table></td>
<td style="padding-left:10px;"><span style="font-family:${SERIF}; font-weight:500; font-size:17px; letter-spacing:.02em; color:${C.navy};">MCRC</span>&nbsp;&nbsp;<span style="font-family:${MONO}; font-size:8px; letter-spacing:.16em; color:${C.goldDeep}; text-transform:uppercase;">Tax &amp; Accounting Services</span></td>
</tr><tr><td colspan="2" style="padding-top:20px; border-bottom:1px solid ${C.borderPaper};"></td></tr></table>`;
}

/** Footer: firm name · support address + confidentiality line. NO phone. */
export function footer(theme: EmailTheme, footerEmail?: string): string {
  const address = footerEmail ?? theme.supportEmail;
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:28px;"><tr><td style="padding-top:18px; border-top:1px solid ${C.borderPaper};">
<div style="font-family:${SANS}; font-size:12.5px; color:${C.muted}; line-height:1.7;">${esc(
    theme.firmName,
  )} &nbsp;·&nbsp; <a href="mailto:${esc(address)}" style="color:${C.muted}; text-decoration:underline;">${esc(
    address,
  )}</a></div>
<div style="margin-top:8px; font-family:${MONO}; font-size:10px; line-height:1.6; color:${C.confidential};">CONFIDENTIAL — This message is intended only for the named recipient. If it reached you in error, please delete it and notify the firm.</div>
</td></tr></table>`;
}

// ---------------------------------------------------------- content boxes

export interface DetailRow {
  label: string;
  valueHtml: string;
}

/** White detail box: label/value rows with soft dividers. */
export function detailBox(rows: DetailRow[], marginTop = 18): string {
  const trs = rows
    .map(
      (r, i) => `<tr>
<td style="padding:11px 0; ${i < rows.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${SANS}; font-size:13.5px; color:${C.muted};">${esc(r.label)}</td>
<td align="right" style="padding:11px 0; ${i < rows.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${SANS}; font-size:13.5px; font-weight:600; color:${C.ink}; text-align:right;">${r.valueHtml}</td>
</tr>`,
    )
    .join("");
  return block(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>`,
    `background:${C.cardWhite}; border:1px solid ${C.borderPaper}; border-radius:8px; padding:6px 18px;`,
  ).replace("<table role", `<table style="margin-top:${marginTop}px;" role`);
}

export function monoValue(text: string, color = C.ink): string {
  return `<span style="font-family:${MONO}; font-weight:500; color:${color};">${esc(text)}</span>`;
}

export function goldValue(text: string): string {
  return `<span style="color:${C.goldDeep}; font-weight:600;">${esc(text)}</span>`;
}

export function statusDot(text: string, color = C.success): string {
  return `<span style="color:${color}; font-weight:600;">&#9679; ${esc(text)}</span>`;
}

/** Dashed-gold verification-code box (mono, 34px, 0.32em). */
export function codeBox(code: string, marginTop = 20): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
<td align="center" style="background:${C.cardWhite}; border:1px dashed ${C.gold}; border-radius:10px; padding:18px; text-align:center;">
<span style="font-family:${MONO}; font-size:34px; letter-spacing:.32em; color:${C.navy}; padding-left:.32em;">${esc(code)}</span>
</td></tr></table>`;
}

/** Warm 2FA-style callout. */
export function warnCallout(html: string, marginTop = 18): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
<td width="24" valign="top" style="background:${C.warnBg}; border:1px solid ${C.warnBorder}; border-right:none; border-radius:8px 0 0 8px; padding:14px 0 14px 16px; font-family:${SANS}; font-weight:700; color:${C.goldDeep};">!</td>
<td style="background:${C.warnBg}; border:1px solid ${C.warnBorder}; border-left:none; border-radius:0 8px 8px 0; padding:14px 16px; font-family:${SANS}; font-size:13px; line-height:1.55; color:${C.warnText};">${html}</td>
</tr></table>`;
}

/** White box of "+" capability bullets (welcome email). */
export function bulletBox(items: string[], marginTop = 16): string {
  const trs = items
    .map(
      (t, i) => `<tr>
<td width="20" style="padding:12px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} color:${C.goldDeep}; font-family:${SANS}; font-weight:700; font-size:14px;">+</td>
<td style="padding:12px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${SANS}; font-size:14px; color:${C.body};">${esc(t)}</td>
</tr>`,
    )
    .join("");
  return block(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>`,
    `background:${C.cardWhite}; border:1px solid ${C.borderPaper}; border-radius:8px; padding:4px 18px;`,
  ).replace("<table role", `<table style="margin-top:${marginTop}px;" role`);
}

/** Small circular initials avatar as a table cell (client-safe). */
function avatarCell(initials: string, size = 30, bg: string = C.navy): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" width="${size}" height="${size}" style="width:${size}px; height:${size}px; border-radius:50%; background:${bg}; font-family:${SERIF}; color:${C.goldSoft}; font-size:13px; text-align:center; vertical-align:middle;">${esc(
    initials,
  )}</td></tr></table>`;
}

/** Navy "your accountant" card. */
export function accountantCard(initials: string, name: string, marginTop = 20): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
<td width="44" valign="middle" style="background:${C.navy}; border-radius:8px 0 0 8px; padding:16px 0 16px 18px;">${avatarCell(
    initials,
    30,
    C.navy2,
  )}</td>
<td valign="middle" style="background:${C.navy}; border-radius:0 8px 8px 0; padding:16px 18px;">
<div style="font-family:${MONO}; font-size:9.5px; letter-spacing:.16em; text-transform:uppercase; color:${C.goldSoft};">Your accountant</div>
<div style="font-family:${SANS}; font-weight:600; font-size:14.5px; color:${C.paper}; margin-top:3px;">${esc(name)}</div>
</td></tr></table>`;
}

/** Before → after role chips. */
export function roleChips(oldRole: string, newRole: string, marginTop = 20): string {
  // Both boxes are the SAME fixed width and vertically centered, so the pair
  // stays symmetric regardless of how long each role name is.
  const cell = (label: string, value: string, dark: boolean) =>
    `<td width="45%" valign="middle" align="center" style="width:45%; height:78px; background:${dark ? C.navy : C.cardWhite}; border:1px solid ${dark ? C.navy : C.borderPaper}; border-radius:8px; padding:14px 10px; text-align:center;">
<div style="font-family:${MONO}; font-size:9.5px; letter-spacing:.16em; text-transform:uppercase; color:${dark ? C.goldSoft : C.muted2};">${esc(label)}</div>
<div style="font-family:${SERIF}; font-size:19px; line-height:1.2; color:${dark ? C.navyBody : C.muted}; margin-top:5px;">${esc(value)}</div>
</td>`;
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
${cell("Was", oldRole, false)}
<td width="10%" valign="middle" align="center" style="width:10%; color:${C.goldDeep}; font-size:20px; text-align:center;">&rarr;</td>
${cell("Now", newRole, true)}
</tr></table>`;
}

/** Document-request checklist: empty checkbox + item + gold due date. */
export function checklist(items: { label: string; due: string }[], marginTop = 18): string {
  const trs = items
    .map(
      (it, i) => `<tr>
<td width="32" style="padding:13px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""}"><div style="width:20px; height:20px; border-radius:4px; border:1.5px solid #c8bda6;">&nbsp;</div></td>
<td style="padding:13px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${SANS}; font-size:14px; color:${C.body};">${esc(it.label)}</td>
<td align="right" style="padding:13px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${MONO}; font-size:10.5px; color:${C.goldDeep}; text-align:right; white-space:nowrap;">Due ${esc(it.due)}</td>
</tr>`,
    )
    .join("");
  return block(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>`,
    `background:${C.cardWhite}; border:1px solid ${C.borderPaper}; border-radius:8px; padding:4px 18px;`,
  ).replace("<table role", `<table style="margin-top:${marginTop}px;" role`);
}

/** Shared-file card: navy type chip + file name + meta. */
export function fileCard(
  fileName: string,
  meta: string,
  typeChip = "PDF",
  marginTop = 18,
): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
<td width="60" valign="middle" style="background:${C.cardWhite}; border:1px solid ${C.borderPaper}; border-right:none; border-radius:8px 0 0 8px; padding:16px 0 16px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:${C.navy}; border-radius:6px; padding:8px 9px; font-family:${MONO}; font-size:9.5px; letter-spacing:.16em; color:${C.goldSoft}; text-transform:uppercase;">${esc(
    typeChip,
  )}</td></tr></table></td>
<td valign="middle" style="background:${C.cardWhite}; border:1px solid ${C.borderPaper}; border-left:none; border-radius:0 8px 8px 0; padding:16px 18px;">
<div style="font-family:${SANS}; font-weight:600; font-size:13.5px; color:${C.ink};">${esc(fileName)}</div>
<div style="font-family:${MONO}; font-size:11px; color:${C.meta}; margin-top:3px;">${esc(meta)}</div>
</td></tr></table>`;
}

/** Navy amount-due panel (invoice email). */
export function amountPanel(amount: string, dueDate: string, marginTop = 20): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
<td style="background:${C.navy}; border-radius:10px; padding:22px 24px;">
<div style="font-family:${MONO}; font-size:11px; letter-spacing:.16em; color:${C.navyMeta}; text-transform:uppercase;">Amount due</div>
<div style="font-family:${SERIF}; font-size:42px; color:${C.navyBody}; line-height:1; margin-top:8px;">${esc(amount)}</div>
<div style="font-family:${MONO}; font-size:12px; letter-spacing:.2em; color:${C.goldSoft}; margin-top:10px;">DUE ${esc(dueDate).toUpperCase()}</div>
</td></tr></table>`;
}

/** Line-item box (invoice email): label + right-aligned amount. */
export function lineItemBox(items: { label: string; amount: string }[], marginTop = 16): string {
  const trs = items
    .map(
      (it, i) => `<tr>
<td style="padding:10px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${SANS}; font-size:13.5px; color:${C.body};">${esc(it.label)}</td>
<td align="right" style="padding:10px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${SANS}; font-size:13.5px; font-weight:600; color:${C.ink}; text-align:right; white-space:nowrap;">${esc(it.amount)}</td>
</tr>`,
    )
    .join("");
  return block(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>`,
    `background:${C.cardWhite}; border:1px solid ${C.borderPaper}; border-radius:8px; padding:4px 18px;`,
  ).replace("<table role", `<table style="margin-top:${marginTop}px;" role`);
}

export type Urgency = "high" | "medium" | "low";
const URGENCY_COLOR: Record<Urgency, string> = {
  high: C.alertRed,
  medium: C.goldDeep,
  low: C.meta,
};

/** Deadline-reminder list with colored urgency dots. */
export function reminderList(
  items: { label: string; due: string; urgency: Urgency }[],
  marginTop = 18,
): string {
  const trs = items
    .map(
      (it, i) => `<tr>
<td width="20" style="padding:12px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} color:${URGENCY_COLOR[it.urgency]}; font-size:13px;">&#9679;</td>
<td style="padding:12px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${SANS}; font-size:14px; color:${C.body};">${esc(it.label)}</td>
<td align="right" style="padding:12px 0; ${i < items.length - 1 ? `border-bottom:1px solid ${C.rowDivider};` : ""} font-family:${MONO}; font-size:10.5px; color:${URGENCY_COLOR[it.urgency]}; text-align:right; white-space:nowrap;">${esc(it.due)}</td>
</tr>`,
    )
    .join("");
  return block(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${trs}</table>`,
    `background:${C.cardWhite}; border:1px solid ${C.borderPaper}; border-radius:8px; padding:4px 18px;`,
  ).replace("<table role", `<table style="margin-top:${marginTop}px;" role`);
}

/** Appointment: navy date tile beside a detail box. */
export function dateTileWithDetails(
  tile: { month: string; day: string; weekday: string },
  rows: DetailRow[],
  marginTop = 20,
): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
<td width="74" valign="top" style="width:74px;">
<table role="presentation" width="74" cellpadding="0" cellspacing="0" border="0"><tr><td align="center" style="background:${C.navy}; border-radius:10px; text-align:center; padding:12px 0;">
<div style="font-family:${MONO}; font-size:9.5px; letter-spacing:.18em; text-transform:uppercase; color:${C.goldSoft};">${esc(tile.month)}</div>
<div style="font-family:${SERIF}; font-size:32px; color:${C.navyBody}; line-height:1; margin-top:2px;">${esc(tile.day)}</div>
<div style="font-family:${MONO}; font-size:9px; color:${C.navyMeta}; margin-top:4px;">${esc(tile.weekday)}</div>
</td></tr></table></td>
<td width="16" style="width:16px;">&nbsp;</td>
<td valign="top">${detailBox(rows, 0)}</td>
</tr></table>`;
}

/** Message-notification quote card (gold left accent bar). */
export function quoteCard(
  initials: string,
  senderName: string,
  snippet: string,
  marginTop = 20,
): string {
  return `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${marginTop}px;"><tr>
<td width="3" style="width:3px; background:${C.gold}; border-radius:8px 0 0 8px;">&nbsp;</td>
<td style="background:${C.cardWhite}; border:1px solid ${C.borderPaper}; border-left:none; border-radius:0 8px 8px 0; padding:16px 18px;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="30" valign="middle">${avatarCell(initials)}</td>
<td valign="middle" style="padding-left:12px; font-family:${SANS}; font-weight:600; font-size:13.5px; color:${C.ink};">${esc(senderName)}</td>
</tr></table>
<p style="margin:12px 0 0; font-family:${SERIF}; font-style:italic; font-size:16px; line-height:1.5; color:#3c4855;">&ldquo;${esc(
    snippet,
  )}&rdquo;</p>
</td></tr></table>`;
}

// ----------------------------------------------------------------- layout

/** Wrap rendered body content into the full email document. */
export function renderLayout(p: {
  theme: EmailTheme;
  subject: string;
  bodyHtml: string;
  /** Footer address override (billing stream uses billing@). */
  footerEmail?: string;
  preheader?: string;
}): string {
  const lockup = p.theme.showBrandLockup ? brandLockup(p.theme) : "";
  const preheader = p.preheader
    ? `<div style="display:none; max-height:0; overflow:hidden; mso-hide:all;">${esc(p.preheader)}</div>`
    : "";
  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${esc(p.subject)}</title>
<link href="${FONTS_HREF}" rel="stylesheet">
</head>
<body style="margin:0; padding:0; background:${C.paper};">
${preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${C.paper};"><tr><td align="center" style="padding:28px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:100%; background:${C.paper}; border:1px solid #dcd3c0; border-radius:12px;">
<tr><td style="padding:32px 36px 30px;">
${lockup}
${p.bodyHtml}
${footer(p.theme, p.footerEmail)}
</td></tr></table>
</td></tr></table>
</body>
</html>`;
}

/** Plain-text footer shared by every template's text alternative. */
export function textFooter(theme: EmailTheme, footerEmail?: string): string {
  return `\n\n${theme.firmName} · ${footerEmail ?? theme.supportEmail}\nCONFIDENTIAL — This message is intended only for the named recipient. If it reached you in error, please delete it and notify the firm.`;
}
