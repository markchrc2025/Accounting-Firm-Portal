// 1601-C — Monthly Remittance Return of Income Taxes Withheld on Compensation.
// Every figure is TYPED: the Portal holds no payroll records, so there is no books
// switch. The server computes the totals. Item 27 and the adjustments can be negative;
// nothing is clamped and the minus sign shows. Printed, not exported.

import type { BirForm1601CComputed } from "../lib/api";
import { Card, CardContent } from "../components/ui";
import {
  Choice,
  Money,
  PartyBlock,
  PaymentBlock,
  PenaltiesBlock,
  ReadOut,
  SignatoryBlock,
  Text,
} from "../components/birform/WithholdingParts";
import { WithholdingFrame } from "../components/birform/WithholdingFrame";
import { useWithholdingDraft } from "../components/birform/useWithholdingDraft";
import {
  NO_PAYROLL_NOTE,
  signedPeso,
  YES_NO,
  type ScheduleRow,
} from "../lib/withholding";

export default function BirForm1601CEditor() {
  const draft = useWithholdingDraft("1601C");
  const { values, set, schedule, setSchedule } = draft;
  const c = draft.computed as BirForm1601CComputed | undefined;

  const setRow = (i: number, patch: Partial<ScheduleRow>) =>
    setSchedule((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <WithholdingFrame
      draft={draft}
      aboveForm={
        <p
          role="status"
          data-no-payroll
          className="mb-5 rounded-input border border-gold/50 bg-warn-bg-2 px-3.5 py-2.5 text-[13px] text-content"
        >
          {NO_PAYROLL_NOTE}
        </p>
      }
      summary={
        <>
          <ReadOut label="Total non-taxable compensation (Item 21)" value={c?.i21} />
          <ReadOut label="Total taxable compensation (Item 22)" value={c?.i22} />
          <ReadOut label="Net taxable compensation (Item 24)" value={c?.i24} />
          <ReadOut label="Adjustment from previous months (Item 26)" value={c?.i26} />
          <ReadOut label="Taxes withheld for remittance (Item 27)" value={c?.i27} />
          <ReadOut label="Total tax remittances made (Item 30)" value={c?.i30} />
          <ReadOut label="Tax still due or (over-remittance) (Item 31)" value={c?.i31} />
          <ReadOut label="Total penalties (Item 35)" value={c?.i35} />
          <div className="border-t border-line-strong pt-2">
            <ReadOut
              label="Total amount still due or (over-remittance) (Item 36)"
              value={c?.i36}
              strong
            />
          </div>
        </>
      }
    >
      {/* Part I */}
      <Card>
        <CardContent className="space-y-4">
          <div className="eyebrow">Part I — Background information</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Choice
              label="Any taxes withheld? (Item 3)"
              value={values.anyWithheld ?? ""}
              onChange={(v) => set("anyWithheld", v)}
              options={YES_NO}
            />
            <Money
              label="Number of sheets attached (Item 4)"
              value={values.sheetsAttached ?? ""}
              onChange={(v) => set("sheetsAttached", v)}
            />
            <Choice
              label="Are there payees availing of tax relief under Special Law or International Tax Treaty? (Item 13)"
              value={values.reliefYesNo ?? ""}
              onChange={(v) => set("reliefYesNo", v)}
              options={YES_NO}
            />
            <Text
              label="If yes, specify (Item 13A)"
              value={values.reliefSpecify ?? ""}
              onChange={(v) => set("reliefSpecify", v)}
            />
          </div>
          <PartyBlock
            values={values}
            set={set}
            items={{ contact: 10, category: 11, email: 12 }}
          />
        </CardContent>
      </Card>

      {/* Part II */}
      <Card>
        <CardContent className="space-y-4">
          <div className="eyebrow">Part II — Computation of tax</div>
          <Money
            label="Total amount of compensation (Item 14)"
            value={values.compensation ?? ""}
            onChange={(v) => set("compensation", v)}
          />
          <div className="text-[12.5px] font-semibold text-content-secondary">
            Less: non-taxable or exempt compensation
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Money
              label="Statutory minimum wage for minimum wage earners (Item 15)"
              value={values.mwe ?? ""}
              onChange={(v) => set("mwe", v)}
            />
            <Money
              label="Holiday pay, overtime pay, night shift differential pay, hazard pay (Item 16)"
              value={values.holiday ?? ""}
              onChange={(v) => set("holiday", v)}
            />
            <Money
              label="13th month pay and other benefits (Item 17)"
              value={values.thirteenth ?? ""}
              onChange={(v) => set("thirteenth", v)}
            />
            <Money
              label="De minimis benefits (Item 18)"
              value={values.deMinimis ?? ""}
              onChange={(v) => set("deMinimis", v)}
            />
            <Money
              label="SSS, GSIS, PHIC, HDMF mandatory contributions and union dues (Item 19)"
              value={values.contributions ?? ""}
              onChange={(v) => set("contributions", v)}
            />
            <Money
              label="Other non-taxable compensation (Item 20)"
              value={values.otherNonTaxable ?? ""}
              onChange={(v) => set("otherNonTaxable", v)}
            />
            <Text
              label="Other non-taxable compensation: specify (Item 20)"
              value={values.otherNonTaxableSpecify ?? ""}
              onChange={(v) => set("otherNonTaxableSpecify", v)}
            />
            <Money
              label="Taxable compensation not subject to withholding tax (Item 23)"
              value={values.notSubjectToWithholding ?? ""}
              onChange={(v) => set("notSubjectToWithholding", v)}
            />
            <Money
              label="Total taxes withheld (Item 25)"
              value={values.taxesWithheld ?? ""}
              onChange={(v) => set("taxesWithheld", v)}
            />
          </div>

          {/* Schedule I */}
          <div className="space-y-2">
            <div className="eyebrow">
              Schedule I — Adjustment of taxes withheld on compensation from previous
              months
            </div>
            {schedule.map((r, i) => (
              <div key={i} data-schedule-row={i} className="grid gap-2 sm:grid-cols-7">
                <Text
                  compact
                  label={`Row ${i + 1}: previous month`}
                  type="month"
                  value={r.month}
                  onChange={(v) => setRow(i, { month: v })}
                />
                <Text
                  compact
                  label={`Row ${i + 1}: date paid`}
                  type="date"
                  value={r.datePaid}
                  onChange={(v) => setRow(i, { datePaid: v })}
                />
                <Text
                  compact
                  label={`Row ${i + 1}: drawee bank or agency`}
                  value={r.bank}
                  onChange={(v) => setRow(i, { bank: v })}
                />
                <Text
                  compact
                  label={`Row ${i + 1}: number`}
                  value={r.number}
                  onChange={(v) => setRow(i, { number: v })}
                />
                <Money
                  compact
                  label={`Row ${i + 1}: tax paid`}
                  value={r.taxPaid}
                  onChange={(v) => setRow(i, { taxPaid: v })}
                />
                <Money
                  compact
                  label={`Row ${i + 1}: should be tax due for the month`}
                  value={r.shouldBe}
                  onChange={(v) => setRow(i, { shouldBe: v })}
                />
                <div>
                  <span className="mb-1.5 block text-[12px] font-semibold text-content-secondary">
                    Row {i + 1}: adjustment
                  </span>
                  <div
                    data-adjustment={i}
                    className="rounded-input bg-sidebar px-3 py-2 text-right font-mono text-[13px] tabular-nums text-content"
                  >
                    {signedPeso(c?.adjustments?.[i])}
                  </div>
                </div>
              </div>
            ))}
            <ReadOut
              label="Total adjustment (Schedule I, Item 4)"
              value={c?.scheduleTotal}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Money
              label="Less: tax remitted in return previously filed, if this is an amended return (Item 28)"
              value={values.previouslyRemitted ?? ""}
              onChange={(v) => set("previouslyRemitted", v)}
            />
            <Money
              label="Other remittances made (Item 29)"
              value={values.otherRemittances ?? ""}
              onChange={(v) => set("otherRemittances", v)}
            />
            <Text
              label="Other remittances made: specify (Item 29)"
              value={values.otherRemittancesSpecify ?? ""}
              onChange={(v) => set("otherRemittancesSpecify", v)}
            />
          </div>
          <PenaltiesBlock values={values} set={set} items={["32", "33", "34"]} />
        </CardContent>
      </Card>

      {/* Signatory */}
      <Card>
        <CardContent className="space-y-4">
          <div className="eyebrow">Signatory and tax agent</div>
          <SignatoryBlock values={values} set={set} />
        </CardContent>
      </Card>

      {/* Part III */}
      <Card>
        <CardContent className="space-y-4">
          <div className="eyebrow">Part III — Details of payment</div>
          <PaymentBlock values={values} set={set} items={[37, 38, 39, 40]} />
        </CardContent>
      </Card>
    </WithholdingFrame>
  );
}
