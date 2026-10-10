// The field-map format. One JSON file per blank form version lives in
// maps/<form>-<version>.json; it holds resolved numbers only (PDF points,
// origin bottom-left, exactly what pdf-lib uses). Nothing is detected at run
// time. See README.md "How a map is made".

/** A condition on another key of the same export: true when its value equals `equals`. */
export interface Condition {
  key: string;
  equals: string;
}

interface Placed {
  /** The full eBIRForms key, namespace included ("frm2551Qv2018:txtTIN1") or global ("drpATC1"). */
  key: string;
  /** The item label printed on the paper ("6", "14", "Sch1 r1 E"): used in errors and proofs. */
  item: string;
  /** Font size in points; the map's `size` when absent. */
  size?: number;
  /** Print nothing when every condition holds (for example an unused schedule row). */
  blankIf?: Condition[];
}

/** One row of character boxes: `cells` are the n+1 x-boundaries of n boxes. */
export interface CombRow {
  page: number;
  /** Text baseline. */
  y: number;
  cells: number[];
}

/** One character per box. Several rows are filled in order (an address continues on its next line). */
export interface CombField extends Placed {
  kind: "comb";
  rows: CombRow[];
  /** Single-row combs only; default "left". */
  align?: "left" | "right";
  /** Left-pad a non-empty value with this character to fill every box (a 3-digit branch code in 5 boxes). */
  pad?: string;
  /** Characters removed before placing ("/" between the boxes of a date). */
  drop?: string;
  /** The value is an eBIRForms date (M/D/YYYY or MM/DD/YYYY): printed MMDDYYYY, zero-padded. */
  date?: boolean;
  /** How several rows fill: "chars" (default) runs on box by box; "words" breaks between words. */
  wrap?: "chars" | "words";
  /** Default "upper": the forms ask for CAPITAL LETTERS. "keep" leaves case alone (an email address). */
  case?: "upper" | "keep";
  /** The proof's ghost character: "8" for digit boxes, "W" for letter boxes. Default "W". */
  ghost?: "8" | "W";
}

/** An amount: pesos right-aligned in `cells`, centavos after the printed point in `cents`. */
export interface MoneyField extends Placed {
  kind: "money";
  page: number;
  y: number;
  cells: number[];
  /** The centavo boxes after the paper's decimal point. Absent: the paper has none. */
  cents?: number[];
}

/** An "X" centred in a checkbox when the value equals `when` (default "true"). */
export interface MarkField extends Placed {
  kind: "mark";
  page: number;
  /** [x0, y0, x1, y1] of the checkbox square. */
  box: [number, number, number, number];
  when?: "true" | "false";
}

/** A dropdown index printed as its label, one character per box. */
export interface ChoiceField extends Placed {
  kind: "choice";
  page: number;
  y: number;
  cells: number[];
  /** eBIRForms index (as text) → printed label. "" prints nothing. */
  options: Record<string, string>;
  align?: "left" | "right";
}

/** Free text on a line or in a table cell. Shrinks down to `minSize`; below that it is an error. */
export interface TextField extends Placed {
  kind: "text";
  page: number;
  y: number;
  x0: number;
  x1: number;
  align?: "left" | "center" | "right";
  minSize: number;
  case?: "upper" | "keep";
}

/** A key the builder emits that has no place on the paper. */
export interface NoneField {
  key: string;
  kind: "none";
  /** Why it is not printed. Required: every unprinted key is a decision. */
  reason: string;
  /** Optional regular expression the value must match; anything else is an error, never silently dropped. */
  expect?: string;
}

export type Field =
  CombField | MoneyField | MarkField | ChoiceField | TextField | NoneField;
export type PlacedField = Exclude<Field, NoneField>;

export interface FormMap {
  form: string;
  version: string;
  /** File name in templates/. */
  template: string;
  /** Document title written into the PDF's metadata. */
  title: string;
  /** Page sizes of the template, checked at render time. */
  pages: { width: number; height: number }[];
  /** Default font size (points). */
  size: number;
  fields: Field[];
}

/** One piece of text to draw: the layout's output and the renderer's input. */
export interface DrawOp {
  page: number;
  x: number;
  y: number;
  text: string;
  size: number;
}

/** A thrown problem with a field: the message always names the key. */
export class BirPdfError extends Error {
  constructor(
    message: string,
    readonly key?: string,
  ) {
    super(message);
    this.name = "BirPdfError";
  }
}
