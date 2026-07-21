// Design-contract tests for the 17 transactional emails (handoff:
// docs/design_handoff_transactional_emails). Assert the email-client rules —
// table layout, inline styles, no flex/grid, phone-free footer — plus the
// per-email merge fields and the configurable theme switches.
import { EMAIL_TEMPLATES, type RenderedEmail } from "./email-templates";
import type { EmailTheme } from "./email-theme";

const THEME: EmailTheme = {
  firmName: "MCRC Tax & Accounting Services",
  supportEmail: "support@mcrctas.com",
  buttonAccent: "navy",
  showBrandLockup: true,
};

const URL = "https://acctgfirm.mcrctas.com/x";

/** One representative render per template. */
function renderAll(theme: EmailTheme): Record<string, RenderedEmail> {
  return {
    staffInvite: EMAIL_TEMPLATES.staffInvite(
      { inviterName: "Christian Canlubo", role: "Super Admin", acceptUrl: URL, expiryDate: "July 28, 2026" },
      theme,
    ),
    clientInvite: EMAIL_TEMPLATES.clientInvite({ setupUrl: URL }, theme),
    welcomeClient: EMAIL_TEMPLATES.welcomeClient(
      { firstName: "Maria", accountantName: "Angela Cruz, CPA", accountantInitials: "AC", dashboardUrl: URL },
      theme,
    ),
    welcomeStaff: EMAIL_TEMPLATES.welcomeStaff({ role: "Accountant", portalUrl: URL }, theme),
    emailVerification: EMAIL_TEMPLATES.emailVerification({ code: "482 915", verifyUrl: URL }, theme),
    passwordReset: EMAIL_TEMPLATES.passwordReset({ resetUrl: URL }, theme),
    passwordChanged: EMAIL_TEMPLATES.passwordChanged(
      { changedAt: "Jul 21, 2026 · 9:31 AM", device: "Chrome · macOS", location: "Manila, PH · 203.0.•••.•••", secureUrl: URL },
      theme,
    ),
    roleChanged: EMAIL_TEMPLATES.roleChanged(
      { oldRole: "Accountant", newRole: "Manager", permissionsUrl: URL },
      theme,
    ),
    documentRequest: EMAIL_TEMPLATES.documentRequest(
      {
        accountantName: "Angela Cruz",
        periodLabel: "2025",
        items: [
          { label: "2025 income statements", due: "Aug 1" },
          { label: "Business expense summary", due: "Aug 5" },
        ],
        uploadUrl: URL,
      },
      theme,
    ),
    documentReady: EMAIL_TEMPLATES.documentReady(
      { sharedBy: "Angela Cruz", fileName: "2025 Tax Return — Draft.pdf", fileSize: "1.4 MB", sharedDate: "Jul 21", viewUrl: URL },
      theme,
    ),
    esignRequest: EMAIL_TEMPLATES.esignRequest(
      { docName: "Engagement Letter 2025", requestedBy: "Angela Cruz, CPA", signBy: "July 30, 2026", signUrl: URL },
      theme,
    ),
    invoiceDue: EMAIL_TEMPLATES.invoiceDue(
      {
        invoiceNo: "BILL-2026-0142",
        amount: "₱1,250.00",
        dueDate: "August 5, 2026",
        lineItems: [
          { label: "2025 tax return preparation", amount: "₱1,000.00" },
          { label: "Advisory session (1 hr)", amount: "₱250.00" },
        ],
        payUrl: URL,
        billingEmail: "billing@mcrctas.com",
      },
      theme,
    ),
    paymentReceived: EMAIL_TEMPLATES.paymentReceived(
      { invoiceNo: "#2025-0142", method: "Visa •••• 4142", date: "July 21, 2026", amount: "₱1,250.00", receiptUrl: URL, billingEmail: "billing@mcrctas.com" },
      theme,
    ),
    deadlineReminder: EMAIL_TEMPLATES.deadlineReminder(
      {
        items: [
          { label: "Upload business expense summary", due: "Tomorrow", urgency: "high" },
          { label: "Sign 2025 engagement letter", due: "Jul 30", urgency: "medium" },
          { label: "Review draft return", due: "Aug 2", urgency: "low" },
        ],
        tasksUrl: URL,
      },
      theme,
    ),
    appointmentConfirmation: EMAIL_TEMPLATES.appointmentConfirmation(
      {
        staffName: "Angela Cruz",
        tile: { month: "JUL", day: "28", weekday: "MON" },
        time: "2:00 – 2:45 PM",
        format: "Video call",
        calendarUrl: URL,
        rescheduleUrl: URL,
        dateLabel: "Jul 28",
      },
      theme,
    ),
    messageNotification: EMAIL_TEMPLATES.messageNotification(
      { senderName: "Angela Cruz, CPA", senderInitials: "AC", snippet: "Thanks for sending those over.", replyUrl: URL },
      theme,
    ),
    returnFiled: EMAIL_TEMPLATES.returnFiled(
      { taxYear: "2025", filedDate: "July 21, 2026", confirmationNo: "MCRC-25-88147", status: "Accepted", detailsUrl: URL },
      theme,
    ),
  };
}

describe("email templates — design contract", () => {
  const all = renderAll(THEME);

  it("covers all 17 emails from the handoff", () => {
    expect(Object.keys(EMAIL_TEMPLATES)).toHaveLength(17);
    expect(Object.keys(all)).toHaveLength(17);
  });

  it.each(Object.entries(all))("%s renders email-client-safe HTML", (_name, email) => {
    // Table-based, no review-scaffolding layout primitives.
    expect(email.html).toContain('<table role="presentation"');
    expect(email.html).not.toMatch(/display:\s*(flex|grid)/i);
    expect(email.html).not.toMatch(/<style/i);
    // Fonts: Google link plus fallback stacks.
    expect(email.html).toContain("fonts.googleapis.com");
    expect(email.html).toContain("Georgia");
    // Non-empty plain-text alternative + subject.
    expect(email.subject.length).toBeGreaterThan(4);
    expect(email.text.length).toBeGreaterThan(20);
  });

  it.each(Object.entries(all))("%s footer is phone-number-free", (_name, email) => {
    expect(email.html).toContain("CONFIDENTIAL");
    // No phone-looking sequences anywhere in the shipped footer/body copy.
    expect(email.html).not.toMatch(/\+63|\(0\d{2}\)|\b09\d{2}[- ]\d{3}\b/);
  });

  it("non-billing emails use supportEmail; billing emails use the billing address", () => {
    expect(all.staffInvite!.html).toContain("support@mcrctas.com");
    expect(all.invoiceDue!.html).toContain("billing@mcrctas.com");
    expect(all.invoiceDue!.html).not.toContain("support@mcrctas.com");
    expect(all.paymentReceived!.text).toContain("billing@mcrctas.com");
  });

  it("routes each email to its configured sender stream", () => {
    expect(all.staffInvite!.stream).toBe("invites");
    expect(all.clientInvite!.stream).toBe("invites");
    expect(all.welcomeClient!.stream).toBe("hello");
    expect(all.welcomeStaff!.stream).toBe("team");
    expect(all.passwordReset!.stream).toBe("noReply");
    expect(all.esignRequest!.stream).toBe("esign");
    expect(all.invoiceDue!.stream).toBe("billing");
    expect(all.returnFiled!.stream).toBe("notifications");
  });

  it("buttonAccent switches every CTA between navy and gold", () => {
    expect(all.staffInvite!.html).toContain("background:#0e2a45");
    const gold = renderAll({ ...THEME, buttonAccent: "gold" });
    expect(gold.staffInvite!.html).toContain("background:#a3781f");
  });

  it("showBrandLockup toggles the header lockup", () => {
    // The lockup's 8px mono wordmark subtitle only exists when the lockup renders.
    expect(all.staffInvite!.html).toContain("font-size:8px");
    const bare = renderAll({ ...THEME, showBrandLockup: false });
    expect(bare.passwordReset!.html).not.toContain("font-size:8px");
  });

  it("spot-checks the signature blocks of key emails", () => {
    // Staff invite: inviter, role, raw tokenized link, expiry.
    expect(all.staffInvite!.html).toContain("Christian Canlubo");
    expect(all.staffInvite!.html).toContain("Super Admin");
    expect(all.staffInvite!.html).toContain("Or copy this link into your browser:");
    expect(all.staffInvite!.html).toContain("July 28, 2026");
    // Verification: 34px mono code with .32em tracking.
    expect(all.emailVerification!.html).toContain("482 915");
    expect(all.emailVerification!.html).toMatch(/font-size:34px; letter-spacing:\.32em/);
    // Role change: before → after chips.
    expect(all.roleChanged!.html).toContain("Was");
    expect(all.roleChanged!.html).toContain("Now");
    expect(all.roleChanged!.html).toContain("Manager");
    // Invoice: navy amount panel + due date + line items.
    expect(all.invoiceDue!.html).toContain("₱1,250.00");
    expect(all.invoiceDue!.html).toContain("Amount due");
    expect(all.invoiceDue!.html).toContain("2025 tax return preparation");
    expect(all.invoiceDue!.subject).toContain("BILL-2026-0142");
    // Filed return: green accepted dot + mono confirmation number.
    expect(all.returnFiled!.html).toContain("#1f7a4d");
    expect(all.returnFiled!.html).toContain("MCRC-25-88147");
    // Appointment: navy date tile.
    expect(all.appointmentConfirmation!.html).toContain(">28<");
    // Message: italic quoted snippet.
    expect(all.messageNotification!.html).toMatch(/font-style:italic/);
    // 2FA callout on staff welcome.
    expect(all.welcomeStaff!.html).toContain("two-factor authentication");
    expect(all.welcomeStaff!.html).toContain("#fff8e8");
  });

  it("escapes HTML in merge variables", () => {
    const sneaky = EMAIL_TEMPLATES.staffInvite(
      { inviterName: "<script>x</script>", role: "Staff", acceptUrl: URL, expiryDate: "July 28, 2026" },
      THEME,
    );
    expect(sneaky.html).not.toContain("<script>x</script>");
    expect(sneaky.html).toContain("&lt;script&gt;");
  });
});
