/**
 * ============================================================================
 * DELETE A CLIENT (U25, D72): the kinds the API names
 * ----------------------------------------------------------------------------
 * GET /clients/:clientId/delete-check answers
 *   { canDelete, nameToType, blockers: [{ kind, count, sentence }],
 *     willDelete: [{ kind, count }], willUnlink: [{ kind, count }] }
 * and DELETE /clients/:clientId answers
 *   { deleted: [{ kind, count }], unlinked: [{ kind, count }], filesNotRemoved: [{ key }] }.
 * Each `kind` is one of the lists below, in the order the API lists them. The
 * sentences are the API's; the web shows them word for word.
 * ============================================================================
 */

/** What refuses a delete. */
export const CLIENT_DELETE_BLOCKER_KINDS = [
  "filedBirReturns",
  "sentInvoices",
  "billedForInvoices",
  "linkedProjects",
  "subClients",
] as const;
export type ClientDeleteBlockerKind = (typeof CLIENT_DELETE_BLOCKER_KINDS)[number];

/** What goes with the client. */
export const CLIENT_DELETE_KINDS = [
  "incomeTransactions",
  "purchaseTransactions",
  "categories",
  "birFormDrafts",
  "birFormDraftFiles",
  "birFilingsNotFiled",
  "receiptScans",
  "receiptScanFiles",
  "inputTaxAssets",
  "taxRules",
  "draftInvoices",
  "corFiles",
  "clientUserProfiles",
  "invitations",
  "clientRoleGrants",
  "staffAssignments",
] as const;
export type ClientDeleteKind = (typeof CLIENT_DELETE_KINDS)[number];

/** What stays, with its link to the client cleared. */
export const CLIENT_UNLINK_KINDS = ["fsReports"] as const;
export type ClientUnlinkKind = (typeof CLIENT_UNLINK_KINDS)[number];
