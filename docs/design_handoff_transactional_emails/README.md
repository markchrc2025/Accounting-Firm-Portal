# Handoff: MCRC Portal — Transactional Emails (Redesign)

## Overview
This package specifies the full set of **transactional emails** sent by the MCRC Tax & Accounting Services client/firm portal: account invitations, onboarding, security notices, document/e-signature flows, billing, reminders, appointments, messaging, and filing-status updates — **17 emails** in one consistent brand system.

This is a **redesign**. Claude Code has already built some basic versions of these emails. **Replace the existing templates with this design.** Where an email type listed here has **no existing template in the codebase, build it new** from this spec.

## About the Design Files
The file in this bundle (`MCRC Transactional Emails.dc.html`) is a **design reference created in HTML** — a prototype showing the intended look, copy, and structure of every email. It is **not production code to paste in**.

Your task is to **recreate these designs in the codebase's real email stack** using its established patterns (e.g. MJML, React Email, Handlebars/Liquid, Maizzle, or raw table-based HTML — whatever the repo already uses). Transactional email must render across Gmail, Outlook, Apple Mail, and mobile clients, so:
- Use **table-based layout** and inline styles (email clients strip `<style>`, flexbox, and grid). The prototype uses flex/grid for authoring convenience — convert to nested tables + inline CSS.
- The prototype's inbox-list frame and section dividers are **presentation scaffolding for review only** — do not ship them. Each email is a single card's inner content.
- Web fonts fall back on most clients: specify the Google Font `<link>` for clients that support it, but always provide the fallback stack (serif → `Georgia, 'Times New Roman', serif`; sans → `'Helvetica Neue', Arial, sans-serif`; mono → `'Courier New', monospace`).

## Fidelity
**High-fidelity (hifi).** Final colors, typography, spacing, copy, and layout. Recreate pixel-faithfully within email-client constraints.

## Design Tokens

### Colors
| Token | Hex | Use |
|---|---|---|
| Navy (primary) | `#0e2a45` | Buttons, headings, avatar/shield, dark panels |
| Navy 2 | `#15395d` | Avatar circle fill on dark panels |
| Ink | `#16212c` | Sender name, strong body text |
| Body text | `#2b3742` | Paragraph copy |
| Muted | `#5b6976` | Secondary labels, footer line 1 |
| Muted 2 | `#7a8894` | Fine print |
| Meta gray | `#8a97a3` | Timestamps, email addresses, file meta |
| Gold deep | `#a3781f` | Eyebrows, accents, gold button, due dates |
| Gold | `#c0902f` | Divider rules, dashed borders, message accent bar |
| Gold soft | `#e6c87c` | Shield monogram, gold text on navy |
| Paper (body bg) | `#f6f2ea` | Email body background |
| Chrome bg | `#fbfaf7` | Sender/chrome strip background |
| Card white | `#ffffff` | Inner detail boxes, card base |
| Page bg | `#e9e1d2` | Review canvas only (not shipped) |
| Border (paper) | `#e3dccd` | Detail-box borders, footer divider |
| Border (chrome) | `#eee6d6` | Chrome strip bottom border |
| Row divider | `#f0ebe0` | Inner list/table row dividers |
| Link | `#2360c8` (hover `#15395d`) | Hyperlinks |
| Success | `#1f7a4d` | "Accepted" status dot |
| Alert red | `#c0392b` | Urgent due dates |
| Warn bg / border / text | `#fff8e8` / `#e8d9a8` / `#6b5a2a` | 2FA callout |

### Typography
- **Display / body prose:** `Newsreader` (serif). Headings weight 600, ~31px, line-height 1.1, letter-spacing −0.01em. Body 17px, line-height 1.55. Italic used for quoted message snippets.
- **UI / labels / buttons:** `Hanken Grotesk` (sans). Buttons 600 / 14.5px. Detail rows 13.5–14px.
- **Meta / eyebrows / codes:** `IBM Plex Mono`. Eyebrows 11.5px, letter-spacing 0.22em, uppercase, color gold-deep. Verification code 34px, letter-spacing 0.32em.
- Google Fonts import:
  `https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;0,6..72,700;1,6..72,400;1,6..72,500&family=Hanken+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap`

### Spacing / shape
- Card radius 12px; inner detail boxes 8–10px; buttons 6px.
- Email body padding `32px 36px 30px`.
- Button padding `13px 24px`.
- Footer: `margin-top:28px; padding-top:18px; border-top:1px solid #e3dccd`.

## Shared Anatomy (every email)
1. **Chrome strip** (review-only, top): 36px navy shield avatar (gold serif "M" monogram) + sender name & address (mono) + subject line (Newsreader) + timestamp (mono). Drop when shipping — it emulates the inbox row.
2. **Brand lockup** (top of body, optional/toggleable): 26px shield + "MCRC" (Newsreader 500) + "Tax & Accounting Services" (mono, gold, 0.16em, uppercase), with a `1px #e3dccd` bottom rule.
3. **Eyebrow**: mono, uppercase, gold-deep, 0.22em.
4. **Heading**: Newsreader 600, ~31px, navy.
5. **Body paragraphs**: Newsreader 17px, `#2b3742`.
6. **Primary CTA**: solid button, bg = navy (`#0e2a45`) by default or gold (`#a3781f`) — this is a single brand switch (`buttonAccent`).
7. **Footer**: firm name + support email (`·`-separated), then a mono confidentiality line in `#9a9078`, 10px.

### Shield SVG (avatar & lockup)
```
<svg viewBox="0 0 120 120">
  <path d="M60 8 L103 23 L103 58 C103 85 84 103 60 113 C36 103 17 85 17 58 L17 23 Z" fill="#0e2a45"/>
  <text x="60" y="76" text-anchor="middle" font-family="Newsreader,serif" font-size="52" fill="#e6c87c" font-weight="500">M</text>
</svg>
```
For email, prefer a **PNG raster** of this mark (SVG support is inconsistent across clients).

## Configurable values (Firm Admin Settings)
These must be **injected from Firm Admin Settings / template variables**, not hard-coded:
- **`supportEmail`** — footer support address (default `support@mcrctas.com`). Appears in all 15 non-billing footers. *(Explicitly requested to be admin-configurable.)*
- Firm name, sender display name & from-address per stream (`invites@`, `hello@`, `team@`, `no-reply@`, `notifications@`, `esign@`, `billing@`).
- `buttonAccent` brand switch (navy | gold).
- `showBrandLockup` toggle.
- All per-recipient merge fields listed per-email below.

> **Note:** There is **no phone number** in the footer — it was intentionally removed. Footer = firm name · {supportEmail} + confidentiality line only. Billing emails use `billing@mcrctas.com` in place of supportEmail.

## Emails (17)

Roles in the portal: **Super Admin, Manager, Accountant, Staff, Auditor** (internal) + **Client** (external). Currency shown as ₱ (PHP) — swap to the firm's configured currency.

### Group 1 — Invite & Onboarding
1. **Staff invite** — from `invites@mcrctas.com`. Eyebrow "MCRC TAX AND ACCOUNTING SERVICES". H "You're invited". Body: `{inviterName}` invited you to join the firm portal as `{role}`. CTA **Accept invitation**. Below: "Or copy this link into your browser:" + raw tokenized URL (mono, word-break). Fine print: link expires `{expiryDate}`, ask `{inviterName}` for a new one, ignore if unexpected. Merge: inviterName, role, acceptUrl, expiryDate.
2. **Client invite** — from `invites@`. Eyebrow "YOUR SECURE PORTAL". H "Access your account". Body: firm set up a secure portal; share docs, review returns, sign, message. CTA **Set up my portal**. Fine print: expires in 7 days, encrypted. Merge: setupUrl.
3. **Welcome — client** — from `hello@`. Eyebrow "WELCOME". H "Welcome to the portal, `{firstName}`". White bullet box (3 capabilities). Navy accountant card: circular initials avatar + "Your accountant" label + `{accountantName}`. CTA **Go to my dashboard**. Merge: firstName, accountantName, accountantInitials.
4. **Welcome — staff** — from `team@`. Eyebrow "WELCOME TO THE TEAM". H "Your workspace is ready". Body: account active with `{role}` role. Warn callout (`#fff8e8`): enable 2FA (required). CTA **Open the firm portal**. Merge: role.

### Group 2 — Account & Security
5. **Email verification** — from `no-reply@`. Eyebrow "CONFIRM YOUR EMAIL". H "Verify your email address". Dashed-gold code box: 6-digit `{code}` (mono, 34px, 0.32em). CTA **Verify email**. Expires 30 min. Merge: code, verifyUrl.
6. **Password reset** — from `no-reply@`. Eyebrow "ACCOUNT SECURITY". H "Reset your password". CTA **Reset password**. Expires 60 min; ignore if not requested. Merge: resetUrl.
7. **Password changed** — from `no-reply@`. Eyebrow "ACCOUNT SECURITY". H "Your password was changed". Detail box: When / Device / Location (IP partly masked). Body "If this wasn't you…". CTA **Secure my account**. Merge: changedAt, device, location.
8. **Account role changed** — from `no-reply@`. Eyebrow "ACCOUNT UPDATE". H "Your role was updated". Two-chip before→after: "Was `{oldRole}`" (light) → arrow → "Now `{newRole}`" (navy). CTA **View my permissions**. Fine print: contact admin if unexpected. Merge: oldRole, newRole.

### Group 3 — Documents & Signing
9. **Document request** — from `notifications@`, sender "Angela Cruz · MCRC". Eyebrow "ACTION REQUESTED". H "We need a few documents". Checklist box: each row = empty checkbox + item + gold "Due `{date}`". CTA **Upload documents**. Merge: accountantName, items[]{label,due}.
10. **Document ready** — from `notifications@`. Eyebrow "READY TO REVIEW". H "A document is ready for you". File card: navy "PDF" chip + `{fileName}` + size/date meta. CTA **View document**. Fine print: opens only inside portal. Merge: sharedBy, fileName, fileSize, sharedDate.
11. **E-signature request** — from `esign@`. Eyebrow "SIGNATURE REQUIRED". H "Please sign your engagement letter". Detail box: Document / Requested by / **Sign by** (gold). CTA **Review & sign**. Merge: docName, requestedBy, signBy.

### Group 4 — Billing & Status
12. **Invoice / payment due** — from `billing@`. Eyebrow "INVOICE #`{invoiceNo}`". H "Invoice from MCRC". Navy amount panel: "Amount due" + big Newsreader `{amount}` + due date (gold). White line-item box. CTA **Pay invoice**. Footer uses `billing@`. Merge: invoiceNo, amount, dueDate, lineItems[].
13. **Payment received** — from `billing@`. Eyebrow "PAYMENT RECEIVED". H "Thank you — payment received". Receipt box: Invoice / Method / Date / bold **Amount paid**. CTA **Download receipt (PDF)**. Merge: invoiceNo, method, date, amount.
14. **Deadline reminder** — from `notifications@`. Eyebrow "REMINDER". H "`{n}` items need your attention". List with colored urgency dots (red/gold/gray) + relative due labels. CTA **Go to my tasks**. Merge: items[]{label,due,urgency}.
15. **Appointment confirmation** — from `notifications@`. Eyebrow "APPOINTMENT CONFIRMED". H "You're booked with `{staffName}`". Navy date tile (MON / 28 / JUL) + detail box: Time / Format / With. CTA **Add to calendar**; "Reschedule" link. Merge: staffName, date, time, format.
16. **Message notification** — from `notifications@`. Eyebrow "NEW MESSAGE". H "`{senderName}` replied". Quote card (gold left bar): avatar + name + italic Newsreader snippet. CTA **Read & reply**. Fine print: reply inside portal. Merge: senderName, snippet.
17. **Return filed / status** — from `notifications@`. Eyebrow "STATUS UPDATE". H "Your `{taxYear}` return was filed". Detail box: Filed on / Confirmation no. (mono) / Status (green "● Accepted"). CTA **View filing details**. Merge: taxYear, filedDate, confirmationNo, status.

## Interactions & Behavior
- Emails are static; the only interactive elements are the primary CTA button and inline links (`#2360c8`, hover `#15395d`, underlined).
- Buttons are `<a>` styled as buttons — for Outlook, wrap in VML/`mso` bulletproof-button markup.
- No animations, no loading/error states (transactional send-only).
- Responsive: single column; at ≤ ~480px let the body padding shrink (`24px 20px`) and stack the appointment date-tile above its detail box.

## State Management
None in-email. All dynamic content arrives as **template merge variables** (listed per email) from the sending service. `supportEmail` and sender identities come from Firm Admin Settings.

## Assets
- **Shield mark** — inline SVG in the prototype; export a 2× PNG for email (`shield-navy@2x.png`). Source geometry above.
- No photography. Avatars are CSS/text initials (render as a small rounded PNG or table cell with bg color for client safety).

## Files
- `MCRC Transactional Emails.dc.html` — the hi-fi design reference (all 17 emails + review scaffolding). Open in a browser to inspect exact values.
- Live source of truth in the project root: `MCRC Transactional Emails.dc.html`.
- Related brand context (not required): `MCRC Brand Identity.dc.html`, `MCRC Portal Prototype.dc.html`.
