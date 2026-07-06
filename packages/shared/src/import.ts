import { z } from "zod";
import { InputTaxAttribution, InputVATCategory, VatClass } from "./enums";
import { zIsoDate } from "./money";

/**
 * ============================================================================
 * IMPORT ROW SCHEMAS
 * ----------------------------------------------------------------------------
 * Shapes for a single parsed CSV/XLSX row (headers exactly as in the import
 * templates). Cells arrive as strings, so these schemas coerce/normalize before
 * validating. Feed the parsed row into the domain schemas (transactions.ts) after
 * mapping. Column headers match system-design.md §9.
 * ============================================================================
 */

const blankToUndef = (val: unknown): unknown =>
  val === undefined || val === null || String(val).trim() === "" ? undefined : val;

/** Yes/No (or true/false/1/0) → boolean; blank → undefined. */
const toBool = (val: unknown): unknown => {
  if (typeof val === "boolean") return val;
  const b = blankToUndef(val);
  if (b === undefined) return undefined;
  const s = String(b).trim().toLowerCase();
  if (["yes", "y", "true", "1"].includes(s)) return true;
  if (["no", "n", "false", "0"].includes(s)) return false;
  return b; // anything else: let z.boolean() flag it
};

const zText = z.preprocess(blankToUndef, z.string().min(1));
const zTextOptional = z.preprocess(blankToUndef, z.string().optional());
const zMoneyCell = z.preprocess(blankToUndef, z.coerce.number().finite().nonnegative());
const zMoneyCellOptional = z.preprocess(
  blankToUndef,
  z.coerce.number().finite().nonnegative().optional(),
);
const zIntCellOptional = z.preprocess(
  blankToUndef,
  z.coerce.number().int().positive().optional(),
);
const zYesNoOptional = z.preprocess(toBool, z.boolean().optional());
const zDateCell = z.preprocess(blankToUndef, zIsoDate);

const enumCell = <T extends z.ZodTypeAny>(e: T) =>
  z.preprocess(
    (val) => (typeof val === "string" ? val.trim().toUpperCase() : val),
    e,
  );
const enumCellOptional = <T extends z.ZodTypeAny>(e: T) =>
  z.preprocess((val) => {
    const b = blankToUndef(val);
    return b === undefined ? undefined : String(b).trim().toUpperCase();
  }, e.optional());

/** A single row of the Sales / Income import template. */
export const SalesImportRow = z.object({
  Date: zDateCell,
  ReferenceNo: zTextOptional,
  Customer: zTextOptional,
  Description: zText,
  Category: zText,
  NetAmount: zMoneyCell,
  VatClass: enumCell(VatClass),
  OutputVAT: zMoneyCellOptional,
  SaleToGovernment: zYesNoOptional,
  CreditableVATWithheld5pct: zMoneyCellOptional,
  ATC: zTextOptional,
  Currency: zTextOptional,
});
export type SalesImportRow = z.infer<typeof SalesImportRow>;

/** A single row of the Expenses / Purchases import template. */
export const ExpenseImportRow = z
  .object({
    Date: zDateCell,
    ReferenceNo: zTextOptional,
    Vendor: zTextOptional,
    Description: zText,
    Category: zText,
    NetAmount: zMoneyCell,
    InputVATCategory: enumCellOptional(InputVATCategory),
    InputVAT: zMoneyCellOptional,
    IsCapitalGood: zYesNoOptional,
    CapitalGoodAcquisitionCost: zMoneyCellOptional,
    EstimatedUsefulLifeMonths: zIntCellOptional,
    InputTaxAttribution: enumCellOptional(InputTaxAttribution),
    Deductible: zYesNoOptional,
    Currency: zTextOptional,
  })
  .superRefine((v, ctx) => {
    if (v.InputVATCategory === "CAPITAL_GOODS_GT_1M") {
      if (v.CapitalGoodAcquisitionCost === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["CapitalGoodAcquisitionCost"],
          message: "CAPITAL_GOODS_GT_1M requires CapitalGoodAcquisitionCost.",
        });
      }
      if (v.EstimatedUsefulLifeMonths === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["EstimatedUsefulLifeMonths"],
          message: "CAPITAL_GOODS_GT_1M requires EstimatedUsefulLifeMonths.",
        });
      }
    }
  });
export type ExpenseImportRow = z.infer<typeof ExpenseImportRow>;
