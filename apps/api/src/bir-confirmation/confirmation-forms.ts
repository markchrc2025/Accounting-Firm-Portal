// confirmation-forms.ts — U18 (D58): which returns need the BIR's confirmation e-mail
// before they can be marked filed, the size limit, and every sentence a person reads.
// The words live here once; the checks, the service and the tests all import them.

/**
 * The returns whose Mark as filed needs the BIR's "Tax Return Receipt Confirmation".
 * Not the 1601-C (the BIR sends no e-mail for it), nor the 2307 or the 2316 (certificates
 * the client issues, not returns sent to the BIR).
 */
export const CONFIRMATION_FORMS: ReadonlySet<string> = new Set([
  "1701",
  "1701A",
  "1701Q",
  "1702Q",
  "1702RT",
  "2550Q",
  "2551Q",
  "0619E",
  "1601EQ",
]);

/** A confirmation PDF may be at most 5 MB. */
export const MAX_CONFIRMATION_BYTES = 5 * 1024 * 1024;

/** The hard ceiling the upload itself accepts, so a too-large file is answered in words. */
export const UPLOAD_CEILING_BYTES = 25 * 1024 * 1024;

export const BIR_SENDER = "ebirforms-noreply@bir.gov.ph";
export const BIR_TITLE = "Tax Return Receipt Confirmation";
export const BIR_SENTENCE = "This confirms receipt of your submission";

/** Override reasons are at least this long. */
export const MIN_REASON_LENGTH = 10;

export const MESSAGES = {
  notBirEmail: "This is not a BIR eBIRForms confirmation email.",
  fileNameUnreadable:
    "The BIR file name could not be read. Upload the confirmation email printed from Gmail as a PDF.",
  receivedUnreadable:
    "The date and time the BIR received the return could not be read. Upload the confirmation email printed from Gmail as a PDF.",
  receivedInFuture: "The date the BIR received the return is in the future.",
  notPdf: "The file is not a PDF.",
  tooLarge: "The PDF is larger than 5 MB.",
  picture:
    "This PDF is a picture. Print the email to PDF from Gmail instead of scanning it.",
  clientHasNoTin:
    "This client has no TIN on file, so the confirmation cannot be matched to it.",
  needsConfirmation:
    "Marking this return as filed needs the BIR confirmation email. Upload it with Mark as filed.",
  noFile: 'Attach the BIR confirmation as a PDF in the multipart field "file".',
  alreadyFiled:
    "This return is already filed. To add the BIR confirmation to it, use Attach confirmation.",
  notFiledYet:
    "This return is not filed yet. Mark it as filed with the BIR confirmation.",
  hasOne:
    "This return already has a BIR confirmation. Only a Super Admin can replace it.",
  replaceSuperAdmin: "Only a Super Admin can replace the BIR confirmation.",
  overrideSuperAdmin:
    "Only a Super Admin can file a return without the BIR confirmation.",
  bothGiven: "Send the confirmation PDF or an override reason, not both.",
  shortReason: `Give the reason in at least ${MIN_REASON_LENGTH} characters.`,
  noFileKept: "This return has no BIR confirmation file.",
  uploadFailed: "The confirmation could not be saved. Try again.",
  noStorage: "File storage isn't set up, so the confirmation can't be kept.",
  nothingToUpload: (form: string) =>
    `The BIR sends no confirmation email for the ${form}, so there is nothing to upload.`,
  wrongTin: (shown: string) => `The confirmation is for TIN ${shown}, not this client.`,
  wrongForm: (got: string, want: string) =>
    `The confirmation is for form ${got}, not ${want}.`,
  duplicate: (where: string) => `This confirmation is already attached to ${where}.`,
} as const;
