// The portal's 17 transactional emails (design handoff:
// docs/design_handoff_transactional_emails/README.md). Each template returns
// {stream, subject, html, text}: `stream` picks the sender identity from Firm
// Admin Settings, `html` is table-based + inline-CSS, `text` is the plain
// alternative. Copy follows the hi-fi reference; merge variables per email.

import {
  accountantCard,
  amountPanel,
  brandLockup as _lockup, // (used via renderLayout)
  bulletBox,
  button,
  checklist,
  codeBox,
  dateTileWithDetails,
  detailBox,
  esc,
  eyebrow,
  fileCard,
  finePrint,
  goldValue,
  heading,
  lineItemBox,
  link,
  monoValue,
  para,
  quoteCard,
  rawLinkFallback,
  reminderList,
  renderLayout,
  roleChips,
  statusDot,
  strong,
  textFooter,
  warnCallout,
  type EmailTheme,
  type Urgency,
} from "./email-theme";

void _lockup; // re-exported path is renderLayout; keep import graph explicit

/** Sender streams — each maps to a configurable from-address (Firm Settings). */
export type EmailStream =
  | "invites"
  | "hello"
  | "team"
  | "noReply"
  | "notifications"
  | "esign"
  | "billing";

export interface RenderedEmail {
  stream: EmailStream;
  subject: string;
  html: string;
  text: string;
}

function make(
  theme: EmailTheme,
  stream: EmailStream,
  subject: string,
  bodyHtml: string,
  text: string,
  opts: { footerEmail?: string; preheader?: string } = {},
): RenderedEmail {
  return {
    stream,
    subject,
    html: renderLayout({
      theme,
      subject,
      bodyHtml,
      footerEmail: opts.footerEmail,
      preheader: opts.preheader,
    }),
    text: text + textFooter(theme, opts.footerEmail),
  };
}

// ------------------------------------------------ Group 1 · Invite & Onboarding

export function staffInviteEmail(
  v: { inviterName: string; role: string; acceptUrl: string; expiryDate: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow(theme.firmName),
    heading("You're invited"),
    para(
      `${strong(v.inviterName)} has invited you to join ${strong(theme.firmName)}'s firm portal as ${strong(v.role)}. Click below to accept the invitation and set up your account.`,
    ),
    button("Accept invitation", v.acceptUrl, theme),
    rawLinkFallback(v.acceptUrl),
    finePrint(
      `This link expires on <strong>${esc(v.expiryDate)}</strong>. If it expires, ask ${esc(
        v.inviterName,
      )} to send a new one. If you weren't expecting this invitation, you can safely ignore this email.`,
    ),
  ].join("");
  const text = `You're invited\n\n${v.inviterName} has invited you to join ${theme.firmName}'s firm portal as ${v.role}.\n\nAccept the invitation and set up your account:\n${v.acceptUrl}\n\nThis link expires on ${v.expiryDate}. If it expires, ask ${v.inviterName} to send a new one. If you weren't expecting this invitation, you can safely ignore this email.`;
  return make(theme, "invites", `You're invited to the ${theme.firmName} firm portal`, body, text, {
    preheader: `${v.inviterName} invited you to join as ${v.role}`,
  });
}

export function clientInviteEmail(
  v: { setupUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Your secure portal"),
    heading("Access your account"),
    para(
      `${strong(theme.firmName)} has set up a secure portal for you. Use it to share documents, review returns, sign forms and message your team — all in one place.`,
    ),
    para("Set your password to get started."),
    button("Set up my portal", v.setupUrl, theme),
    rawLinkFallback(v.setupUrl),
    finePrint(
      "This invitation expires in 7 days. Your information is encrypted and only visible to you and your MCRC team.",
    ),
  ].join("");
  const text = `Access your account\n\n${theme.firmName} has set up a secure portal for you. Use it to share documents, review returns, sign forms and message your team — all in one place.\n\nSet your password to get started:\n${v.setupUrl}\n\nThis invitation expires in 7 days. Your information is encrypted and only visible to you and your MCRC team.`;
  return make(theme, "invites", "Your MCRC client portal is ready", body, text, {
    preheader: "Set your password to get started",
  });
}

export function welcomeClientEmail(
  v: { firstName: string; accountantName: string; accountantInitials: string; dashboardUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const capabilities = [
    "Upload and organize your tax documents",
    "Review and e-sign returns and forms",
    "Message your accountant year-round",
  ];
  const body = [
    eyebrow("Welcome"),
    heading(`Welcome to the portal, ${v.firstName}`),
    para("Your account is active. Here's what you can do from your dashboard:"),
    bulletBox(capabilities),
    accountantCard(v.accountantInitials, v.accountantName),
    button("Go to my dashboard", v.dashboardUrl, theme),
  ].join("");
  const text = `Welcome to the portal, ${v.firstName}\n\nYour account is active. Here's what you can do from your dashboard:\n${capabilities.map((c) => `+ ${c}`).join("\n")}\n\nYour accountant: ${v.accountantName}\n\nGo to my dashboard:\n${v.dashboardUrl}`;
  return make(theme, "hello", `You're all set — welcome to ${theme.firmName}`, body, text);
}

export function welcomeStaffEmail(
  v: { role: string; portalUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Welcome to the team"),
    heading("Your workspace is ready"),
    para(
      `Your MCRC portal account is active with the ${strong(v.role)} role. You can manage client files, prepare returns and collaborate with the team.`,
    ),
    warnCallout(
      "Before you start, enable two-factor authentication. Client data protection is required for all staff accounts.",
    ),
    button("Open the firm portal", v.portalUrl, theme),
  ].join("");
  const text = `Your workspace is ready\n\nYour MCRC portal account is active with the ${v.role} role. You can manage client files, prepare returns and collaborate with the team.\n\n! Before you start, enable two-factor authentication. Client data protection is required for all staff accounts.\n\nOpen the firm portal:\n${v.portalUrl}`;
  return make(theme, "team", `Welcome to ${theme.firmName} — your portal access`, body, text);
}

// ------------------------------------------------ Group 2 · Account & Security

export function emailVerificationEmail(
  v: { code: string; verifyUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Confirm your email"),
    heading("Verify your email address"),
    para("Enter this code in the portal to confirm your email, or use the button below."),
    codeBox(v.code),
    button("Verify email", v.verifyUrl, theme),
    finePrint(
      "This code expires in 30 minutes. If you didn't create an MCRC account, you can ignore this email.",
    ),
  ].join("");
  const text = `Verify your email address\n\nEnter this code in the portal to confirm your email:\n\n${v.code}\n\nOr open:\n${v.verifyUrl}\n\nThis code expires in 30 minutes. If you didn't create an MCRC account, you can ignore this email.`;
  return make(theme, "noReply", "Verify your email address", body, text);
}

export function passwordResetEmail(
  v: { resetUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Account security"),
    heading("Reset your password"),
    para(
      "We received a request to reset the password for your MCRC portal account. Click below to choose a new one.",
    ),
    button("Reset password", v.resetUrl, theme),
    rawLinkFallback(v.resetUrl),
    finePrint(
      "This link expires in 60 minutes. If you didn't request a reset, no action is needed — your password stays the same.",
    ),
  ].join("");
  const text = `Reset your password\n\nWe received a request to reset the password for your MCRC portal account. Choose a new one here:\n${v.resetUrl}\n\nThis link expires in 60 minutes. If you didn't request a reset, no action is needed — your password stays the same.`;
  return make(theme, "noReply", "Reset your MCRC portal password", body, text);
}

export function passwordChangedEmail(
  v: { changedAt: string; device: string; location: string; secureUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Account security"),
    heading("Your password was changed"),
    para("The password for your MCRC portal account was updated. Here are the details:"),
    detailBox([
      { label: "When", valueHtml: esc(v.changedAt) },
      { label: "Device", valueHtml: esc(v.device) },
      { label: "Location", valueHtml: monoValue(v.location) },
    ]),
    para("If this wasn't you, secure your account immediately."),
    button("Secure my account", v.secureUrl, theme),
  ].join("");
  const text = `Your password was changed\n\nThe password for your MCRC portal account was updated.\nWhen: ${v.changedAt}\nDevice: ${v.device}\nLocation: ${v.location}\n\nIf this wasn't you, secure your account immediately:\n${v.secureUrl}`;
  return make(theme, "noReply", "Your password was changed", body, text);
}

export function roleChangedEmail(
  v: { oldRole: string; newRole: string; permissionsUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Account update"),
    heading("Your role was updated"),
    para(`A Super Admin changed your role in the ${esc(theme.firmName)} portal.`),
    roleChips(v.oldRole, v.newRole),
    button("View my permissions", v.permissionsUrl, theme),
    finePrint("If you weren't expecting this change, contact your firm administrator."),
  ].join("");
  const text = `Your role was updated\n\nA Super Admin changed your role in the ${theme.firmName} portal.\nWas: ${v.oldRole}\nNow: ${v.newRole}\n\nView my permissions:\n${v.permissionsUrl}\n\nIf you weren't expecting this change, contact your firm administrator.`;
  return make(theme, "noReply", "Your portal role was updated", body, text);
}

// ---------------------------------------------- Group 3 · Documents & Signing

export function documentRequestEmail(
  v: {
    accountantName: string;
    periodLabel: string;
    items: { label: string; due: string }[];
    uploadUrl: string;
  },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Action requested"),
    heading("We need a few documents"),
    para(
      `To keep your ${esc(v.periodLabel)} return on track, ${strong(v.accountantName)} has requested the following. Upload them securely to your portal.`,
    ),
    checklist(v.items),
    button("Upload documents", v.uploadUrl, theme),
  ].join("");
  const text = `We need a few documents\n\nTo keep your ${v.periodLabel} return on track, ${v.accountantName} has requested the following. Upload them securely to your portal.\n${v.items.map((i) => `[ ] ${i.label} — Due ${i.due}`).join("\n")}\n\nUpload documents:\n${v.uploadUrl}`;
  return make(
    theme,
    "notifications",
    `Documents requested for your ${v.periodLabel} return`,
    body,
    text,
  );
}

export function documentReadyEmail(
  v: { sharedBy: string; fileName: string; fileSize: string; sharedDate: string; viewUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Ready to review"),
    heading("A document is ready for you"),
    para(`${strong(v.sharedBy)} shared a document in your secure portal.`),
    fileCard(v.fileName, `${v.fileSize} · Shared ${v.sharedDate}`),
    button("View document", v.viewUrl, theme),
    finePrint(
      "For your security, documents open only inside your portal — never as an email attachment.",
    ),
  ].join("");
  const text = `A document is ready for you\n\n${v.sharedBy} shared a document in your secure portal.\n${v.fileName} (${v.fileSize} · Shared ${v.sharedDate})\n\nView document:\n${v.viewUrl}\n\nFor your security, documents open only inside your portal — never as an email attachment.`;
  return make(theme, "notifications", "A new document was shared with you", body, text);
}

export function esignRequestEmail(
  v: { docName: string; requestedBy: string; signBy: string; signUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Signature required"),
    heading("Please sign your engagement letter"),
    para(
      `Your ${esc(v.docName)} is ready for signature. Review and sign it electronically in a few minutes.`,
    ),
    detailBox([
      { label: "Document", valueHtml: esc(v.docName) },
      { label: "Requested by", valueHtml: esc(v.requestedBy) },
      { label: "Sign by", valueHtml: goldValue(v.signBy) },
    ]),
    button("Review & sign", v.signUrl, theme),
  ].join("");
  const text = `Please sign your engagement letter\n\nYour ${v.docName} is ready for signature. Review and sign it electronically in a few minutes.\nDocument: ${v.docName}\nRequested by: ${v.requestedBy}\nSign by: ${v.signBy}\n\nReview & sign:\n${v.signUrl}`;
  return make(theme, "esign", `Signature requested — ${v.docName}`, body, text);
}

// ------------------------------------------------ Group 4 · Billing & Status

export function invoiceDueEmail(
  v: {
    invoiceNo: string;
    amount: string;
    dueDate: string;
    lineItems: { label: string; amount: string }[];
    payUrl: string;
    billingEmail: string;
  },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow(`Invoice ${v.invoiceNo}`),
    heading("Invoice from MCRC"),
    amountPanel(v.amount, v.dueDate),
    lineItemBox(v.lineItems),
    button("Pay invoice", v.payUrl, theme),
  ].join("");
  const text = `Invoice from MCRC\n\nInvoice ${v.invoiceNo}\nAmount due: ${v.amount}\nDue: ${v.dueDate}\n\n${v.lineItems.map((li) => `${li.label} — ${li.amount}`).join("\n")}\n\nPay invoice:\n${v.payUrl}`;
  return make(
    theme,
    "billing",
    `Invoice ${v.invoiceNo} — ${v.amount} due ${v.dueDate}`,
    body,
    text,
    { footerEmail: v.billingEmail },
  );
}

export function paymentReceivedEmail(
  v: {
    invoiceNo: string;
    method: string;
    date: string;
    amount: string;
    receiptUrl: string;
    billingEmail: string;
  },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Payment received"),
    heading("Thank you — payment received"),
    para("We've received your payment. A copy of this receipt is saved in your portal."),
    detailBox([
      { label: "Invoice", valueHtml: monoValue(v.invoiceNo) },
      { label: "Method", valueHtml: esc(v.method) },
      { label: "Date", valueHtml: esc(v.date) },
      { label: "Amount paid", valueHtml: `<strong>${esc(v.amount)}</strong>` },
    ]),
    button("Download receipt (PDF)", v.receiptUrl, theme),
  ].join("");
  const text = `Thank you — payment received\n\nWe've received your payment. A copy of this receipt is saved in your portal.\nInvoice: ${v.invoiceNo}\nMethod: ${v.method}\nDate: ${v.date}\nAmount paid: ${v.amount}\n\nDownload receipt:\n${v.receiptUrl}`;
  return make(theme, "billing", `Receipt for your payment — ${v.amount}`, body, text, {
    footerEmail: v.billingEmail,
  });
}

export function deadlineReminderEmail(
  v: { items: { label: string; due: string; urgency: Urgency }[]; tasksUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const n = v.items.length;
  const body = [
    eyebrow("Reminder"),
    heading(`${n} item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your attention`),
    para("A few tasks are coming due on your account this week."),
    reminderList(v.items),
    button("Go to my tasks", v.tasksUrl, theme),
  ].join("");
  const text = `${n} item${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your attention\n\nA few tasks are coming due on your account this week.\n${v.items.map((i) => `• ${i.label} — ${i.due}`).join("\n")}\n\nGo to my tasks:\n${v.tasksUrl}`;
  return make(theme, "notifications", "Reminder — items due this week", body, text);
}

export function appointmentConfirmationEmail(
  v: {
    staffName: string;
    tile: { month: string; day: string; weekday: string };
    time: string;
    format: string;
    calendarUrl: string;
    rescheduleUrl: string;
    dateLabel: string;
  },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Appointment confirmed"),
    heading(`You're booked with ${v.staffName}`),
    dateTileWithDetails(v.tile, [
      { label: "Time", valueHtml: esc(v.time) },
      { label: "Format", valueHtml: esc(v.format) },
      { label: "With", valueHtml: esc(v.staffName) },
    ]),
    button("Add to calendar", v.calendarUrl, theme),
    finePrint(`Need a different time? ${link("Reschedule", v.rescheduleUrl)} from your portal.`),
  ].join("");
  const text = `You're booked with ${v.staffName}\n\nDate: ${v.dateLabel}\nTime: ${v.time}\nFormat: ${v.format}\nWith: ${v.staffName}\n\nAdd to calendar:\n${v.calendarUrl}\nNeed a different time? Reschedule from your portal:\n${v.rescheduleUrl}`;
  return make(
    theme,
    "notifications",
    `Confirmed — your appointment on ${v.dateLabel}`,
    body,
    text,
  );
}

export function messageNotificationEmail(
  v: { senderName: string; senderInitials: string; snippet: string; replyUrl: string },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("New message"),
    heading(`${v.senderName} replied`),
    quoteCard(v.senderInitials, v.senderName, v.snippet),
    button("Read & reply", v.replyUrl, theme),
    finePrint("Please reply inside the portal to keep your information secure."),
  ].join("");
  const text = `${v.senderName} replied\n\n"${v.snippet}"\n\nRead & reply:\n${v.replyUrl}\n\nPlease reply inside the portal to keep your information secure.`;
  return make(theme, "notifications", "New message from your MCRC team", body, text);
}

export function returnFiledEmail(
  v: {
    taxYear: string;
    filedDate: string;
    confirmationNo: string;
    status: string;
    detailsUrl: string;
  },
  theme: EmailTheme,
): RenderedEmail {
  const body = [
    eyebrow("Status update"),
    heading(`Your ${v.taxYear} return was filed`),
    para(
      `Good news — MCRC has submitted your ${esc(v.taxYear)} tax return. Here's your confirmation.`,
    ),
    detailBox([
      { label: "Filed on", valueHtml: esc(v.filedDate) },
      { label: "Confirmation no.", valueHtml: monoValue(v.confirmationNo) },
      { label: "Status", valueHtml: statusDot(v.status) },
    ]),
    button("View filing details", v.detailsUrl, theme),
  ].join("");
  const text = `Your ${v.taxYear} return was filed\n\nGood news — MCRC has submitted your ${v.taxYear} tax return.\nFiled on: ${v.filedDate}\nConfirmation no.: ${v.confirmationNo}\nStatus: ${v.status}\n\nView filing details:\n${v.detailsUrl}`;
  return make(theme, "notifications", `Filed — your ${v.taxYear} tax return`, body, text);
}

/** Registry of all 17 templates (used by tests and future flows). */
export const EMAIL_TEMPLATES = {
  staffInvite: staffInviteEmail,
  clientInvite: clientInviteEmail,
  welcomeClient: welcomeClientEmail,
  welcomeStaff: welcomeStaffEmail,
  emailVerification: emailVerificationEmail,
  passwordReset: passwordResetEmail,
  passwordChanged: passwordChangedEmail,
  roleChanged: roleChangedEmail,
  documentRequest: documentRequestEmail,
  documentReady: documentReadyEmail,
  esignRequest: esignRequestEmail,
  invoiceDue: invoiceDueEmail,
  paymentReceived: paymentReceivedEmail,
  deadlineReminder: deadlineReminderEmail,
  appointmentConfirmation: appointmentConfirmationEmail,
  messageNotification: messageNotificationEmail,
  returnFiled: returnFiledEmail,
} as const;
