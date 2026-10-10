/**
 * answer.ts — the shape of the AI's answer for one file (U11 R6): a JSON schema
 * sent as structured outputs (output_config.format, json_schema; generally
 * available on claude-sonnet-5-5 and claude-haiku-5-5 —
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs), and
 * the zod schema the reply is parsed with. Structured outputs require
 * additionalProperties: false on every object and allow no length or range
 * keywords, so every field is required and nullable instead.
 */
import { EXPENSES_V2_HEADERS } from "@portal/shared";
import { z } from "zod";

const text = { type: ["string", "null"] } as const;
const amount = { type: ["number", "null"] } as const;
const obj = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

export const ANSWER_JSON_SCHEMA = obj({
  result: { type: "string", enum: ["read", "not-a-receipt", "unreadable"] },
  problem: text,
  receipts: {
    type: "array",
    items: obj({
      date: text,
      documentType: text,
      vendor: obj({
        tin: text,
        branch: text,
        registeredName: text,
        lastName: text,
        firstName: text,
        middleName: text,
        tradeName: text,
        address: text,
        city: text,
        province: text,
        postalCode: text,
      }),
      referenceNumber: text,
      amounts: obj({
        vatableSales: amount,
        vat: amount,
        vatExempt: amount,
        zeroRated: amount,
        total: amount,
      }),
      sellerVatStatus: { type: "string", enum: ["VAT_REGISTERED", "NON_VAT", "UNKNOWN"] },
      description: text,
      coaCode: text,
      soldTo: text,
      doubts: {
        type: "array",
        items: obj({
          field: { type: "string", enum: [...EXPENSES_V2_HEADERS] },
          reason: { type: "string" },
        }),
      },
    }),
  },
});

const t = z.string().nullable();
const n = z.number().nullable();
export const AnswerReceipt = z.object({
  date: t,
  documentType: t,
  vendor: z.object({
    tin: t,
    branch: t,
    registeredName: t,
    lastName: t,
    firstName: t,
    middleName: t,
    tradeName: t,
    address: t,
    city: t,
    province: t,
    postalCode: t,
  }),
  referenceNumber: t,
  amounts: z.object({ vatableSales: n, vat: n, vatExempt: n, zeroRated: n, total: n }),
  sellerVatStatus: z.enum(["VAT_REGISTERED", "NON_VAT", "UNKNOWN"]),
  description: t,
  coaCode: t,
  soldTo: t,
  doubts: z.array(z.object({ field: z.enum(EXPENSES_V2_HEADERS), reason: z.string() })),
});
export type AnswerReceipt = z.infer<typeof AnswerReceipt>;

export const Answer = z.object({
  result: z.enum(["read", "not-a-receipt", "unreadable"]),
  problem: t,
  receipts: z.array(AnswerReceipt),
});
export type Answer = z.infer<typeof Answer>;

/** Strings with every NUL removed (PostgreSQL text and JSONB cannot hold one). */
function withoutNul(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/\u0000/g, "");
  if (Array.isArray(v)) return v.map(withoutNul);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, withoutNul(x)]));
  }
  return v;
}

/** The answer from a succeeded result's text block, or null when it does not parse. */
export function parseAnswer(
  content: Array<{ type: string; text?: string }>,
): Answer | null {
  const block = content.find((c) => c.type === "text" && typeof c.text === "string");
  if (!block?.text) return null;
  try {
    const parsed = Answer.safeParse(withoutNul(JSON.parse(block.text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
