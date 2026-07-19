// Sub-client billing-link rules (pure). A sub-client is billed UNDER its main
// client: invoices are recorded against the parent. The link is billing/AR
// only and strictly ONE level deep — no chains, no cycles:
//   - a client cannot be its own billing parent;
//   - the parent must not itself be a sub-client (no chains);
//   - a client that already has sub-clients cannot become a sub-client.

export interface BillingLinkCheck {
  /** The client being linked (null when it is still being created). */
  clientId: string | null;
  /** The prospective parent row, or null when it was not found in the firm. */
  parent: { id: string; billingParentId: string | null } | null;
  /** How many clients already name this client as their billing parent. */
  clientSubCount: number;
}

/** Human-readable violation, or null when the link is valid. */
export function billingLinkError(check: BillingLinkCheck): string | null {
  if (!check.parent) return "The selected main client was not found in this firm.";
  if (check.clientId && check.parent.id === check.clientId) {
    return "A client cannot be billed under itself.";
  }
  if (check.parent.billingParentId) {
    return "The selected main client is itself a sub-client — billing links are one level deep.";
  }
  if (check.clientSubCount > 0) {
    return "This client has sub-clients billed under it, so it cannot become a sub-client itself.";
  }
  return null;
}
