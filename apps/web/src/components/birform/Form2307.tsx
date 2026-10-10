// Form2307.tsx — a faithful replica of BIR Form 2307, January 2018 (ENCS),
// page 1, built against the official workbook inventory (W2 pass 2).
//
// SOURCE OF TRUTH: e2e/fixtures/bir-2307-jan-2018-encs.json, which carries the
// inventory read cell by cell from the BIR's own workbook. The Sentire
// generator's Form2307.tsx was the starting point for the *atoms* only; it fit
// A4 by omitting item 5, the second Part III block, the five lines under each
// signature, the date and ZIP digit boxes, and by adding an ATC reference list
// the official form does not carry. None of that is reproduced here.
//
// GEOMETRY: long bond 8.5 x 13 in -> 816 x 1248 px at 96 px/in, so 1 CSS px is
// 0.75 pt on paper with no scaling. See styles/bir-form.css.
//
// PROPS ONLY. This component fetches nothing, reads no store and no context.
// Every value arrives as a prop, so that when Track A adds the seal-time
// snapshot the data source changes in exactly one place (the editor) and not
// here.
//
// PAYOR vs PAYEE: on this form the PAYOR is the withholding agent — the firm's
// client — and the PAYEE is the party the certificate is issued to. That is the
// opposite way round from the Sentire generator, where the taxpayer record fills
// Part I. Keeping both blocks as explicit props is what prevents the two
// parties being silently swapped on a mandated certificate.

import { titleTinLine } from "../../lib/certificateRules";
import { mmddyyyy, tin14 } from "./format";
import { BirAmtVal, BirBoxes, BirVal } from "./formkit";

/** The official BIR seal, served from /public/assets. */
export const SEAL_SRC = "/assets/bir-seal.png";
/** The official barcode image, when one has been supplied. */
export const BARCODE_SRC = "/assets/bir-2307-barcode.png";

/** One Part III income-payment row as the editor holds it. */
export interface Form2307Row {
  desc?: string;
  atc?: string;
  m1?: string;
  m2?: string;
  m3?: string;
  tax?: string;
}

/** The six per-certificate signatory fields, for either party. */
export interface Form2307Signatory {
  /** Printed name over the signature line. */
  name?: string;
  /** "(Indicate Title/Designation and TIN)" — the title half. */
  title?: string;
  /** "(Indicate Title/Designation and TIN)" — the TIN half. */
  tin?: string;
  /** Tax Agent Accreditation No. / Attorney's Roll No. (if applicable). */
  taxAgentNo?: string;
  /** Date of Issue, MM/DD/YYYY. */
  issued?: string;
  /** Date of Expiry, MM/DD/YYYY. */
  expiry?: string;
}

export interface Form2307Props {
  /** Period covered, as MM/DD/YYYY strings for items 1 From and 1 To. */
  periodFrom?: string;
  periodTo?: string;

  /** Part I — the payee, typed into the certificate. */
  payee: {
    tin?: string;
    branch?: string;
    name?: string;
    address?: string;
    zip?: string;
    foreignAddress?: string;
  };

  /** Part II — the payor: the firm's client, the withholding agent. */
  payor: {
    tin?: string;
    branch?: string;
    name?: string;
    address?: string;
    zip?: string;
  };

  /** Part III block A — income payments subject to expanded withholding tax. */
  rows: Form2307Row[];
  /** Per-row quarter totals, from the server's Comp2307Row.total. */
  rowTotals: number[];
  /** Block A totals, from the server's Comp2307. */
  totals: { m1: number; m2: number; m3: number; income: number; tax: number };

  payorSignatory?: Form2307Signatory;
  payeeSignatory?: Form2307Signatory;

  /** True once the official barcode PNG is present under /public/assets. */
  hasBarcode?: boolean;
}

/** The official form prints ten data rows in each Part III block. */
const BLOCK_ROWS = 10;

/** An amount the operator actually entered, or undefined for an empty box. */
function entered(v: string | undefined): number | undefined {
  if (v == null || String(v).trim() === "") return undefined;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isNaN(n) ? undefined : n;
}

/** Whether a row carries any figure at all. An untouched row prints blank. */
function rowHasAmount(r: Form2307Row): boolean {
  return [r.m1, r.m2, r.m3, r.tax].some((v) => entered(v) !== undefined);
}

/* ------------------------------------------------------------------ atoms */

function ItemCap({ no, children }: { no: string; children: React.ReactNode }) {
  return (
    <span className="lblgrp">
      <span className="bir-ino">{no}</span> <span className="bir-cap">{children}</span>
    </span>
  );
}

/** A stacked cell: item number + caption above, the answer below. */
function StackCell({
  no,
  cap,
  children,
  className = "",
}: {
  no: string;
  cap: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={"bir-cell stack " + className}>
      <ItemCap no={no}>{cap}</ItemCap>
      <div className="fld">{children}</div>
    </div>
  );
}

/** An empty Part III cell — block B is blank by design (R3). */
function EmptyCell({ cls, last }: { cls: string; last?: boolean }) {
  return <div className={cls + (last ? "" : " br")} />;
}

/** One of the five lines under a signature. */
function SignatureBlock({
  who,
  sig,
}: {
  who: "Payor" | "Payee";
  sig: Form2307Signatory | undefined;
}) {
  const s = sig ?? {};
  // "TITLE / TIN 000-000-000-00000" (W3 R6); either half alone prints alone.
  const titleTin = titleTinLine(s.title, s.tin);
  return (
    <div className="grow">
      {/* 1 — the signature space itself: blank by design, wet ink. */}
      <div className="bir-sign bir-signspace">
        <BirVal value={s.name} blank />
      </div>
      {/* 2 — the printed caption under the rule. */}
      <div className="bir-sign bir-signline">
        Signature over Printed Name of {who}/{who}&rsquo;s Authorized Representative/Tax
        Agent
      </div>
      {/* 3 — title / designation and TIN. */}
      <div className="bir-sign">
        <BirVal value={titleTin} blank />
        <div className="bir-capi">(Indicate Title/Designation and TIN)</div>
      </div>
      {/* 4 and 5 — accreditation number, then the two date-box rows. */}
      <div className="row b bir-agent" style={{ borderTop: 0 }}>
        <div className="grow br" style={{ padding: "1px 4px" }}>
          <div>Tax Agent Accreditation No./</div>
          <div>Attorney&rsquo;s Roll No. (if applicable)</div>
          <div className="fld">
            <BirVal value={s.taxAgentNo} blank />
          </div>
        </div>
        <div className="br" style={{ width: 132, flex: "none", padding: "1px 4px" }}>
          <div>Date of Issue</div>
          <div className="bir-capi">(MM/DD/YYYY)</div>
          <BirBoxes value={mmddyyyy(s.issued)} count={8} kind="taxAgentDate" />
        </div>
        <div style={{ width: 132, flex: "none", padding: "1px 4px" }}>
          <div>Date of Expiry</div>
          <div className="bir-capi">(MM/DD/YYYY)</div>
          <BirBoxes value={mmddyyyy(s.expiry)} count={8} kind="taxAgentDate" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- sheet */

export function Form2307({
  periodFrom,
  periodTo,
  payee,
  payor,
  rows,
  rowTotals,
  totals,
  payorSignatory,
  payeeSignatory,
  hasBarcode = false,
}: Form2307Props) {
  // Ten printed rows, whatever the editor holds.
  // Block A's Total row prints only once there is something to total — a
  // certificate with no figures entered prints no figures.
  const anyAmount = rows.some(rowHasAmount);
  const blockA: Form2307Row[] = Array.from(
    { length: BLOCK_ROWS },
    (_, i) => rows[i] ?? {},
  );

  return (
    <div className="bir-sheet" data-form="2307" data-revision="January 2018 (ENCS)">
      {/* ---------------------------------------------------------- header */}
      <div className="row b">
        {/* For BIR Use Only — the Bureau's stamping box, blank by design. */}
        <div className="bir-biruse br" style={{ width: 92, flex: "none" }}>
          <div>For BIR</div>
          <div>Use Only</div>
          <div style={{ marginTop: 6 }}>BCS/</div>
          <div>Item:</div>
        </div>
        <div className="bir-formno br">
          <div className="lbl">BIR Form No.</div>
          <div className="no">2307</div>
          <div className="date">January 2018 (ENCS)</div>
        </div>
        <div className="grow col">
          <div
            className="bir-gov bb"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              minHeight: 42,
            }}
          >
            <img src={SEAL_SRC} alt="" style={{ width: 40, height: 40, flex: "none" }} />
            <div style={{ textAlign: "center" }}>
              <div className="rep">Republic of the Philippines</div>
              <div className="dof">Department of Finance</div>
              <div className="bureau">Bureau of Internal Revenue</div>
            </div>
          </div>
          <div className="bir-title">
            <div className="t">Certificate of Creditable Tax Withheld at Source</div>
          </div>
        </div>
        <div className="col bl" style={{ width: 148, flex: "none", padding: "3px 4px" }}>
          {hasBarcode ? (
            <img className="bir-barcode" src={BARCODE_SRC} alt="" />
          ) : (
            // Drawn at the official size and left empty: the barcode image was
            // not supplied, and a mandated form gets no invented artwork.
            <span className="bir-barcode" data-barcode="empty" />
          )}
          <div className="bir-barcode-code">2307 01/18ENCS</div>
        </div>
      </div>

      <div className="bir-instr b" style={{ borderTop: 0 }}>
        Fill in all applicable spaces. Mark all appropriate boxes with an &quot;X&quot;.
      </div>

      {/* ------------------------------------------------- 1 For the Period */}
      <div className="row b" style={{ borderTop: 0 }}>
        <div className="bir-cell inline grow">
          <ItemCap no="1">For the Period</ItemCap>
          <div className="fld" style={{ gap: 8 }}>
            <span>From</span>
            <BirBoxes value={mmddyyyy(periodFrom)} count={8} kind="period" />
            <span className="bir-capi">(MM/DD/YYYY)</span>
            <span style={{ marginLeft: 14 }}>To</span>
            <BirBoxes value={mmddyyyy(periodTo)} count={8} kind="period" />
            <span className="bir-capi">(MM/DD/YYYY)</span>
          </div>
        </div>
      </div>

      {/* --------------------------------------------- Part I — Payee */}
      <div className="bir-part b" style={{ borderTop: 0 }}>
        Part I – Payee Information
      </div>

      <div className="bir-cell inline b" style={{ borderTop: 0 }}>
        <ItemCap no="2">Taxpayer Identification Number (TIN)</ItemCap>
        <div className="fld">
          <BirBoxes
            value={tin14(payee.tin, payee.branch)}
            count={14}
            groups={[3, 3, 3, 5]}
            kind="tin"
          />
        </div>
      </div>

      <StackCell
        no="3"
        cap="Payee’s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)"
        className="b"
      >
        <BirVal value={payee.name} fit blank />
      </StackCell>

      <div className="row b" style={{ borderTop: 0 }}>
        <StackCell no="4" cap="Registered Address" className="br grow">
          <BirVal value={payee.address} fit blank />
        </StackCell>
        <div className="bir-cell stack" style={{ width: 164, flex: "none" }}>
          <ItemCap no="4A">ZIP Code</ItemCap>
          <div className="fld">
            <BirBoxes value={payee.zip} count={4} kind="zip" />
          </div>
        </div>
      </div>

      <StackCell no="5" cap="Foreign Address, if applicable" className="b">
        <BirVal value={payee.foreignAddress} fit blank />
      </StackCell>

      {/* --------------------------------------------- Part II — Payor */}
      <div className="bir-part b" style={{ borderTop: 0 }}>
        Part II – Payor Information
      </div>

      <div className="bir-cell inline b" style={{ borderTop: 0 }}>
        <ItemCap no="6">Taxpayer Identification Number (TIN)</ItemCap>
        <div className="fld">
          <BirBoxes
            value={tin14(payor.tin, payor.branch)}
            count={14}
            groups={[3, 3, 3, 5]}
            kind="tin"
          />
        </div>
      </div>

      <StackCell
        no="7"
        cap="Payor’s Name (Last Name, First Name, Middle Name for Individual OR Registered Name for Non-Individual)"
        className="b"
      >
        <BirVal value={payor.name} fit blank />
      </StackCell>

      <div className="row b" style={{ borderTop: 0 }}>
        <StackCell no="8" cap="Registered Address" className="br grow">
          <BirVal value={payor.address} fit blank />
        </StackCell>
        <div className="bir-cell stack" style={{ width: 164, flex: "none" }}>
          <ItemCap no="8A">ZIP Code</ItemCap>
          <div className="fld">
            <BirBoxes value={payor.zip} count={4} kind="zip" />
          </div>
        </div>
      </div>

      {/* --------------------------------------------- Part III */}
      <div className="bir-part b" style={{ borderTop: 0 }}>
        Part III – Details of Monthly Income Payments and Taxes Withheld
      </div>

      {/* Header, two rows: the AMOUNT OF INCOME PAYMENTS span over the three
          month columns, then the month captions beneath it. */}
      <div className="row b bir-p3head bir-p3headrow" style={{ borderTop: 0 }}>
        <div className="c-desc br cell" style={{ minHeight: 26 }}>
          Income Payments Subject to Expanded Withholding Tax
        </div>
        <div className="c-atc br cell" style={{ minHeight: 26 }}>
          ATC
        </div>
        <div className="col br" style={{ width: 268, flex: "none" }}>
          <div className="cell bb" style={{ minHeight: 13 }}>
            AMOUNT OF INCOME PAYMENTS
          </div>
          <div className="row grow">
            <div className="c-m1 br cell">1st Month of the Quarter</div>
            <div className="c-m2 br cell">2nd Month of the Quarter</div>
            <div className="c-m3 cell">3rd Month of the Quarter</div>
          </div>
        </div>
        <div className="c-tot br cell" style={{ minHeight: 26 }}>
          Total
        </div>
        <div className="c-tax cell" style={{ minHeight: 26 }}>
          Tax Withheld for the Quarter
        </div>
      </div>

      {/* --- Block A: ten data rows, then Total --- */}
      {blockA.map((r, i) => (
        <div
          className="row b bir-p3row"
          style={{ borderTop: 0 }}
          key={"a" + i}
          data-p3-row="A"
        >
          <div className="c-desc br" style={{ padding: "0 4px" }}>
            <BirVal value={r.desc} lower blank />
          </div>
          <div className="c-atc br" style={{ padding: "0 3px" }}>
            {/* An ATC prints only once its row has an amount: an ATC chosen on
                a row with no figures is not an income payment. (Since W3 the
                editor no longer seeds a default ATC; R6.) */}
            <BirVal value={rowHasAmount(r) ? r.atc : ""} blank />
          </div>
          <div className="c-m1 br">
            <BirAmtVal value={entered(r.m1)} />
          </div>
          <div className="c-m2 br">
            <BirAmtVal value={entered(r.m2)} />
          </div>
          <div className="c-m3 br">
            <BirAmtVal value={entered(r.m3)} />
          </div>
          <div className="c-tot br">
            <BirAmtVal value={rowHasAmount(r) ? rowTotals[i] : undefined} />
          </div>
          <div className="c-tax">
            <BirAmtVal value={entered(r.tax)} />
          </div>
        </div>
      ))}
      <div className="row b bir-totalrow" style={{ borderTop: 0 }} data-total-row="A">
        <div className="c-desc br lbl">Total</div>
        <div className="c-atc br" />
        <div className="c-m1 br">
          <BirAmtVal value={anyAmount ? totals.m1 : undefined} bold />
        </div>
        <div className="c-m2 br">
          <BirAmtVal value={anyAmount ? totals.m2 : undefined} bold />
        </div>
        <div className="c-m3 br">
          <BirAmtVal value={anyAmount ? totals.m3 : undefined} bold />
        </div>
        <div className="c-tot br">
          <BirAmtVal value={anyAmount ? totals.income : undefined} bold />
        </div>
        <div className="c-tax">
          <BirAmtVal value={anyAmount ? totals.tax : undefined} bold />
        </div>
      </div>

      {/* --- Block B: header, ten data rows, Total. Blank by design (R3). --- */}
      <div className="row b" style={{ borderTop: 0 }}>
        <div className="c-desc br bir-blockb-head">
          Money Payments Subject to Withholding of Business Tax (Government &amp; Private)
        </div>
        <div className="c-atc br bir-blockb-head" />
        <div className="c-m1 br bir-blockb-head" />
        <div className="c-m2 br bir-blockb-head" />
        <div className="c-m3 br bir-blockb-head" />
        <div className="c-tot br bir-blockb-head" />
        <div className="c-tax bir-blockb-head" />
      </div>
      {Array.from({ length: BLOCK_ROWS }).map((_, i) => (
        <div
          className="row b bir-p3row"
          style={{ borderTop: 0 }}
          key={"b" + i}
          data-p3-row="B"
        >
          <EmptyCell cls="c-desc" />
          <EmptyCell cls="c-atc" />
          <EmptyCell cls="c-m1" />
          <EmptyCell cls="c-m2" />
          <EmptyCell cls="c-m3" />
          <EmptyCell cls="c-tot" />
          <EmptyCell cls="c-tax" last />
        </div>
      ))}
      <div className="row b bir-totalrow" style={{ borderTop: 0 }} data-total-row="B">
        <div className="c-desc br lbl">Total</div>
        <EmptyCell cls="c-atc" />
        <EmptyCell cls="c-m1" />
        <EmptyCell cls="c-m2" />
        <EmptyCell cls="c-m3" />
        <EmptyCell cls="c-tot" />
        <EmptyCell cls="c-tax" last />
      </div>

      {/* --------------------------------------------- declaration */}
      <div className="bir-perjury b" style={{ borderTop: 0 }}>
        We declare under the penalties of perjury that this certificate has been made in
        good faith, verified by us, and to the best of our knowledge and belief, is true
        and correct, pursuant to the provisions of the National Internal Revenue Code, as
        amended, and the regulations issued under authority thereof. Further, we give our
        consent to the processing of our information as contemplated under the *Data
        Privacy Act of 2012 (R.A. No. 10173) for legitimate and lawful purposes.
      </div>

      {/* --------------------------------------------- payor signature */}
      <div className="row b" style={{ borderTop: 0 }}>
        <SignatureBlock who="Payor" sig={payorSignatory} />
      </div>

      <div className="bir-conforme b" style={{ borderTop: 0 }}>
        CONFORME:
      </div>

      {/* --------------------------------------------- payee signature */}
      <div className="row b" style={{ borderTop: 0 }}>
        <SignatureBlock who="Payee" sig={payeeSignatory} />
      </div>

      <div className="bir-foot">
        *NOTE: The BIR Data Privacy is in the BIR website (www.bir.gov.ph)
      </div>
    </div>
  );
}

export default Form2307;
