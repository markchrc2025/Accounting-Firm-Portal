// needs.ts — U20 (D60): what is missing for a BIR-form draft, as plain questions.
//
// Every BIR-form tool answer carries a `needs` list. Each need is a question Claude can
// put to the owner as it is, with why it is asked, which tool and field writes the answer,
// and the kind of answer. Needs are built from what the Portal already knows — the client
// record, the draft's data, the form's own compute and refusals — never from a guess, and
// never from the books: a figure the posted records give is not asked for.
//
// Rules are not copied here. The sentences of the Portal's own refusals (a preview, the
// alphalist) become a need as they are, with `question` set to the sentence.
import { compute1601EQ } from "../../bir-forms/engine/compute1601EQ";
import {
  ATC_ITEM,
  INCOME_TAX_ATC,
  type IncomeTaxForm,
} from "../../bir-forms/engine/taxpayer-background";
import { OVER_REMITTANCE_CHOICE_MISSING } from "../../bir-forms/engine/withholding-print";
import type { FilingData } from "../../bir-forms/engine/types";
import type { PayeeNeed } from "../../bir-forms/alphalist/payees";

export type NeedKind = "text" | "number" | "date" | "choice" | "atc" | "tin";

export interface Need {
  /** A stable id: client.rdo, data.overRemittanceChoice, payee.123456789.payeeKind… */
  key: string;
  /** One plain sentence Claude can ask the owner as it is. */
  question: string;
  /** One short sentence naming the form item or rule that needs the answer. */
  why: string;
  /** Which tool and field writes the answer; null when no tool can (the question says what to do). */
  setWith: string | null;
  kind: NeedKind;
  /** For a choice: the Portal's own values. */
  options?: string[];
  /** The ids a write needs (expenses of a payee). */
  refs?: { expenseIds?: string[] };
}

/** The client fields the needs read. */
export interface ClientFacts {
  kind: string;
  tin: string | null;
  rdo: string | null;
  regName: string | null;
  businessName: string;
  lastName: string | null;
  firstName: string | null;
  address: string | null;
  zip: string | null;
  taxType: string | null;
  civilStatus: string | null;
  classification: string | null;
  birthdate: Date | null;
}

const blank = (v: string | null | undefined) => (v ?? "").trim() === "";
const updateClient = (field: string) => `portal_update_client field ${field}`;
const updateDraft = (key: string) => `portal_update_bir_form_draft field data.${key}`;

/** The forms that print the client's civil status, birthdate and classification (the individual's income-tax returns). */
const INDIVIDUAL_RETURNS = new Set(["1701", "1701A", "1701Q"]);
const REGIME: Record<string, "VAT" | "PERCENTAGE"> = { "2550Q": "VAT", "2551Q": "PERCENTAGE" };

/** The client's record, as far as a form prints it. */
export function clientNeeds(form: string, c: ClientFacts): Need[] {
  const out: Need[] = [];
  const printed = `The BIR ${form} prints`;

  if (c.tin === null || c.tin.replace(/\D/g, "").length < 9) {
    out.push({
      key: "client.tin",
      question: "What is the client's TIN (9 digits)?",
      why: `${printed} the client's TIN.`,
      setWith: updateClient("tin"),
      kind: "tin",
    });
  }
  if (c.kind === "individual") {
    if (blank(c.lastName) || blank(c.firstName)) {
      out.push({
        key: "client.name",
        question: "What are the client's last name and first name, as registered with the BIR?",
        why: `${printed} the individual taxpayer's registered name.`,
        setWith: `${updateClient("lastName")} and ${updateClient("firstName")}`,
        kind: "text",
      });
    }
  } else if (blank(c.regName)) {
    out.push({
      key: "client.regName",
      question: "What is the client's registered name, exactly as on its BIR Certificate of Registration?",
      why: `${printed} the registered name.`,
      setWith: updateClient("regName"),
      kind: "text",
    });
  }
  if (blank(c.rdo)) {
    out.push({
      key: "client.rdo",
      question: "What is the client's RDO code (3 digits)?",
      why: `${printed} the Revenue District Office code.`,
      setWith: updateClient("rdo"),
      kind: "text",
    });
  }
  if (blank(c.address)) {
    out.push({
      key: "client.address",
      question: "What is the client's registered address?",
      why: `${printed} the registered address.`,
      setWith: updateClient("address"),
      kind: "text",
    });
  }
  if (blank(c.zip)) {
    out.push({
      key: "client.zip",
      question: "What is the ZIP code of the client's registered address?",
      why: `${printed} the ZIP code.`,
      setWith: updateClient("zip"),
      kind: "text",
    });
  }
  const regime = REGIME[form];
  if (regime && c.taxType === null) {
    out.push({
      key: "client.taxType",
      question: `Is the client registered for VAT or for percentage tax? (The ${form} is the ${regime === "VAT" ? "VAT" : "percentage-tax"} return.)`,
      why: `The ${form} is filed only by a ${regime === "VAT" ? "VAT-registered" : "percentage-tax"} client.`,
      setWith: updateClient("taxType"),
      kind: "choice",
      options: ["VAT", "PERCENTAGE"],
    });
  }
  if (INDIVIDUAL_RETURNS.has(form) && c.kind === "individual") {
    if (blank(c.birthdate?.toISOString())) {
      out.push({
        key: "client.birthdate",
        question: "What is the client's date of birth?",
        why: `${printed} the individual taxpayer's date of birth.`,
        setWith: updateClient("birthdate"),
        kind: "date",
      });
    }
    if (form !== "1701Q" && blank(c.civilStatus)) {
      out.push({
        key: "client.civilStatus",
        question: "What is the client's civil status?",
        why: `Item 16 of the ${form} is the client's civil status.`,
        setWith: updateClient("civilStatus"),
        kind: "choice",
        options: ["Single", "Married", "Widow/Widower", "Legally Separated"],
      });
    }
    if (blank(c.classification)) {
      out.push({
        key: "client.classification",
        question: "Is the client a Professional or a Single Proprietorship?",
        why: `The taxpayer type of the ${form} is the client's classification.`,
        setWith: updateClient("classification"),
        kind: "choice",
        options: ["Professional", "Single Proprietorship"],
      });
    }
  }
  return out;
}

const peso = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The 1601-C and the 2307 are typed: the items without which the return is empty. */
export function typedNeeds(form: string, data: FilingData): Need[] {
  const d = data as Record<string, unknown>;
  const empty = (k: string) => String(d[k] ?? "").trim() === "";
  const out: Need[] = [];
  if (form === "1601C") {
    if (empty("compensation")) {
      out.push({
        key: "data.compensation",
        question: "What is the total amount of compensation paid in this month (Item 14)?",
        why: "Item 14 of the 1601-C is typed; the Portal holds no payroll records.",
        setWith: updateDraft("compensation"),
        kind: "number",
      });
    }
    if (empty("taxesWithheld")) {
      out.push({
        key: "data.taxesWithheld",
        question: "How much tax was withheld on compensation this month (Item 25)?",
        why: "Item 25 of the 1601-C is typed; the Portal holds no payroll records.",
        setWith: updateDraft("taxesWithheld"),
        kind: "number",
      });
    }
  }
  if (form === "2307") {
    const certificate: Array<[string, string, string, NeedKind]> = [
      ["payeeName", "Who is the payee of this certificate (the supplier's registered name)?", "Part II of the 2307 is the payee's name.", "text"],
      ["payeeTin", "What is the payee's TIN (9 digits)?", "Part II of the 2307 is the payee's TIN.", "tin"],
      ["payeeBranch", "What is the payee's branch code (00000 is the head office)?", "The payee's branch code is required on the 2307.", "text"],
      ["payeeAddress", "What is the payee's registered address?", "Part II of the 2307 is the payee's address.", "text"],
    ];
    for (const [k, question, why, kind] of certificate) {
      if (empty(k)) out.push({ key: `data.${k}`, question, why, setWith: updateDraft(k), kind });
    }
    const rows = Array.isArray(d.rows) ? d.rows : [];
    if (rows.length === 0) {
      out.push({
        key: "data.rows",
        question: "What income payments were made to the payee this quarter, and how much tax was withheld on each?",
        why: "Part III of the 2307 lists the income payments and the tax withheld.",
        setWith: updateDraft("rows"),
        kind: "text",
      });
    }
  }
  return out;
}

/** The choices a form's compute cannot make for the owner. */
export function choiceNeeds(form: string, data: FilingData, period: string): Need[] {
  const d = data as Record<string, unknown>;
  const out: Need[] = [];
  if (form === "1601EQ") {
    const c = compute1601EQ(data);
    const quarter = /-Q([1-4])$/i.exec(period)?.[1];
    const choice = String(d.overRemittanceChoice ?? "").trim();
    if (c.overRemittance && choice === "") {
      const noCarry = quarter === "4";
      out.push({
        key: "data.overRemittanceChoice",
        question: noCarry
          ? `Item 31 is an over-remittance of ${peso(c.overRemittanceAmount)}. Should it be refunded or issued as a Tax Credit Certificate? (It cannot be carried over in the 4th quarter.)`
          : `Item 31 is an over-remittance of ${peso(c.overRemittanceAmount)}. Should it be refunded, issued as a Tax Credit Certificate, or carried over to the next quarter?`,
        why: OVER_REMITTANCE_CHOICE_MISSING,
        setWith: updateDraft("overRemittanceChoice"),
        kind: "choice",
        options: noCarry ? ["refunded", "tcc"] : ["refunded", "tcc", "carried"],
      });
    }
  }
  if (form in INCOME_TAX_ATC) {
    const f = form as IncomeTaxForm;
    if (String(d.atc ?? "").trim() === "") {
      out.push({
        key: "data.atc",
        question: `Which ATC applies to Item ${ATC_ITEM[f]} of the ${form}? (${INCOME_TAX_ATC[f].join(", ")})`,
        why: `Item ${ATC_ITEM[f]} of the ${form} is chosen by the preparer; the Portal never picks it.`,
        setWith: updateDraft("atc"),
        kind: "atc",
        options: [...INCOME_TAX_ATC[f]],
      });
    }
  }
  return out;
}

/** A refusal the Portal gives today that is not a question: the sentence is the need. */
export function refusalNeed(sentence: string, index: number): Need {
  return {
    key: `refusal.${index + 1}`,
    question: sentence,
    why: "The Portal refuses this today.",
    setWith: null,
    kind: "text",
  };
}

/** The 1601-EQ's alphalist: one need per payee whose details are missing or disagree. */
export function alphalistNeeds(payees: PayeeNeed[], refusals: string[]): Need[] {
  const out: Need[] = [];
  const expenses = (p: PayeeNeed) => `portal_update_expense on the payee's expenses (${p.expenseIds.slice(0, 5).join(", ")}${p.expenseIds.length > 5 ? ", …" : ""})`;
  for (const p of payees) {
    const refs = { expenseIds: p.expenseIds };
    if (p.type === "conflict") {
      out.push({
        key: `payee.${p.tin}.conflict`,
        question: `The expenses of payee ${p.shown} carry different details. Which is right: the payee's kind, last, first and middle names (or its company name)?`,
        why: "The alphalist lists each payee once, with one set of details.",
        setWith: `${expenses(p)} fields payeeKind, payeeLastName, payeeFirstName, payeeMiddleName, vendor`,
        kind: "text",
        refs,
      });
    } else if (p.missing.includes("kind")) {
      out.push({
        key: `payee.${p.tin}.payeeKind`,
        question: `Is payee ${p.shown} an individual or a company?`,
        why: "The alphalist writes a company's registered name or an individual's last, first and middle names.",
        setWith: `${expenses(p)} field payeeKind (and payeeLastName and payeeFirstName for an individual)`,
        kind: "choice",
        options: ["individual", "non_individual"],
        refs,
      });
    } else if (p.missing.includes("company")) {
      out.push({
        key: `payee.${p.tin}.vendor`,
        question: `What is the registered name of company ${p.shown}?`,
        why: "The alphalist writes a company payee's registered name.",
        setWith: `${expenses(p)} field vendor`,
        kind: "text",
        refs,
      });
    } else {
      const which = p.missing.join(" and ");
      out.push({
        key: `payee.${p.tin}.${p.missing[0] === "last" ? "payeeLastName" : "payeeFirstName"}`,
        question: `What is the ${which} name of payee ${p.shown}?`,
        why: "The alphalist writes an individual payee's last and first names.",
        setWith: `${expenses(p)} fields payeeLastName, payeeFirstName (payeeMiddleName if any)`,
        kind: "text",
        refs,
      });
    }
  }
  // Every other refusal of the alphalist (formula, zero amount, total…) is a need as it is.
  const sentences = new Set(refusals.filter((r) => !/^These payees /.test(r)));
  let n = 0;
  for (const s of sentences) {
    out.push({
      key: `alphalist.${++n}`,
      question: s,
      why: "The BIR Validation program would reject the alphalist otherwise.",
      setWith: null,
      kind: "text",
    });
  }
  return out;
}

/** No posted records for the period of a books-fed form: say so, and ask. */
export function noRecordsNeed(form: string, typingAllowed: boolean): Need {
  return {
    key: "books.noRecords",
    question: typingAllowed
      ? `The Portal has no posted records for this period, so the ${form} would be empty. Should the figures be typed instead, or are records missing?`
      : `The Portal has no posted records for this period, so the ${form} would be empty. Are records missing?`,
    why: "The figures of this return come from the client's posted records.",
    setWith: typingAllowed ? updateDraft("<item>") : "portal_record_expense",
    kind: "text",
  };
}
