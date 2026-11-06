// 1601-EQ — Quarterly Remittance Return of Creditable Income Taxes Withheld (Expanded).
// The books fill Part II's rows (by ATC), Items 20 and 21 (the net of the filed 0619-E
// of the quarter's 1st and 2nd month) and Item 23; the server computes the totals.
// Part II shows EVERY row; the form has six, so a seventh makes the return impossible to
// file, preview or copy — said next to the rows, with those three buttons held back.

import type { BirForm1601EQComputed } from "../lib/api";
import { Button, Card, CardContent } from "../components/ui";
import { AlphalistPanel, AlphalistWarning } from "../components/birform/AlphalistPanel";
import { BookBadge, BookNotes } from "../components/birform/BookFigures";
import {
  Choice,
  Money,
  PartyBlock,
  PaymentBlock,
  PenaltiesBlock,
  ReadOut,
  SignatoryBlock,
} from "../components/birform/WithholdingParts";
import { WithholdingFrame } from "../components/birform/WithholdingFrame";
import { useWithholdingDraft } from "../components/birform/useWithholdingDraft";
import {
  emptyEqRow,
  signedPeso,
  sixRowsSentence,
  YES_NO,
  type EqRow,
} from "../lib/withholding";

export default function BirForm1601EQEditor() {
  const draft = useWithholdingDraft("1601EQ");
  const { values, set, rows, setRows, books } = draft;
  const c = draft.computed as BirForm1601EQComputed | undefined;

  const setRow = (i: number, patch: Partial<EqRow>) =>
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  // The books' own "N ATCs; the form has six rows." is the sentence shown next to the
  // rows; it is not said twice.
  const six = draft.tooManyRows ? sixRowsSentence(draft.rowCount) : null;
  const warned = {
    ...books,
    warnings: books.warnings.filter((w) => w !== six),
  };

  const choiceOptions: [string, string][] = [
    ["refunded", "To be refunded"],
    ["tcc", "To be issued Tax Credit Certificate"],
    // The 4th quarter's cannot be carried over to the next year.
    ...(draft.sub === "Q4"
      ? []
      : ([
          [
            "carried",
            "To be carried over to the next quarter within the same calendar year (not applicable for succeeding year)",
          ],
        ] as [string, string][])),
  ];

  return (
    <WithholdingFrame
      draft={draft}
      aboveForm={
        draft.existing.data ? <AlphalistWarning detail={draft.existing.data} /> : null
      }
      below={
        !draft.isNew && draft.existing.data ? (
          <AlphalistPanel detail={draft.existing.data} />
        ) : null
      }
      summary={
        <>
          <ReadOut
            label="Total taxes withheld for the quarter (Item 19)"
            value={c?.i19}
          />
          <ReadOut label="Total remittances made (Item 25)" value={c?.i25} />
          <ReadOut label="Tax still due or (over-remittance) (Item 26)" value={c?.i26} />
          <ReadOut label="Total penalties (Item 30)" value={c?.i30} />
          <div className="border-t border-line-strong pt-2">
            <ReadOut
              label="Total amount still due or (over-remittance) (Item 31)"
              value={c?.i31}
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
              label="Any taxes withheld? (Item 4)"
              value={values.anyWithheld ?? ""}
              onChange={(v) => set("anyWithheld", v)}
              options={YES_NO}
              bookKey="anyWithheld"
            />
            <Money
              label="Number of sheets attached (Item 5)"
              value={values.sheetsAttached ?? ""}
              onChange={(v) => set("sheetsAttached", v)}
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
          <BookNotes books={warned} />
          <div className="space-y-2">
            {six ? (
              <p
                role="alert"
                data-six-rows
                className="rounded-input border border-danger/40 bg-danger-bg px-3 py-2 text-[12.5px] text-danger-ink"
              >
                {six}
              </p>
            ) : null}
            <div className="overflow-x-auto rounded-card border border-line">
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                    <th className="px-3 py-2.5 font-semibold">ATC</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Tax base</th>
                    <th className="w-28 px-3 py-2.5 text-right font-semibold">
                      Tax rate %
                    </th>
                    <th className="px-3 py-2.5 text-right font-semibold">Tax withheld</th>
                    <th className="w-10 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-divider">
                  {rows.map((r, i) => (
                    <tr key={i} data-eq-row={i}>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Row ${i + 1}: ATC`}
                          className="input w-full font-mono uppercase"
                          value={r.atc}
                          onChange={(e) =>
                            setRow(i, { atc: e.target.value.toUpperCase() })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Row ${i + 1}: tax base`}
                          type="number"
                          min={0}
                          step="0.01"
                          className="input w-full text-right font-mono tabular-nums"
                          value={r.base}
                          onChange={(e) => setRow(i, { base: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        {/* Empty, and the user's to fill, when the table has no rate for the ATC. */}
                        <input
                          aria-label={`Row ${i + 1}: tax rate`}
                          type="number"
                          min={0}
                          step="0.01"
                          className="input w-full text-right font-mono tabular-nums"
                          value={r.rate}
                          onChange={(e) => setRow(i, { rate: e.target.value })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          aria-label={`Row ${i + 1}: tax withheld`}
                          type="number"
                          min={0}
                          step="0.01"
                          className="input w-full text-right font-mono tabular-nums"
                          value={r.withheld}
                          onChange={(e) => setRow(i, { withheld: e.target.value })}
                        />
                        {rows.findIndex((x) => x.atc === r.atc) === i && r.atc !== "" ? (
                          <BookBadge id={`rows.${r.atc}`} />
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="px-2"
                          aria-label={`Remove row ${i + 1}`}
                          disabled={rows.length === 1}
                          onClick={() =>
                            setRows((prev) => prev.filter((_, j) => j !== i))
                          }
                        >
                          ✕
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRows((prev) => [...prev, emptyEqRow()])}
            >
              + Add line
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Money
              label="Remittances made: 1st month of the quarter (Item 20)"
              value={values.remittance1 ?? ""}
              onChange={(v) => set("remittance1", v)}
              bookKey="remittance1"
            />
            <Money
              label="Remittances made: 2nd month of the quarter (Item 21)"
              value={values.remittance2 ?? ""}
              onChange={(v) => set("remittance2", v)}
              bookKey="remittance2"
            />
            <Money
              label="Tax remitted in return previously filed, if this is an amended return (Item 22)"
              value={values.previouslyRemitted ?? ""}
              onChange={(v) => set("previouslyRemitted", v)}
            />
            <Money
              label="Over-remittance from previous quarter of the same taxable year (Item 23)"
              value={values.overRemittancePrior ?? ""}
              onChange={(v) => set("overRemittancePrior", v)}
              bookKey="overRemittancePrior"
            />
            <Money
              label="Other payments made (Item 24)"
              value={values.otherPayments ?? ""}
              onChange={(v) => set("otherPayments", v)}
            />
          </div>
          <PenaltiesBlock values={values} set={set} items={["27", "28", "29"]} />

          {c?.overRemittance ? (
            <div className="space-y-2 rounded-input border border-line bg-sidebar px-3.5 py-3">
              <div className="text-[13px] text-content">
                Over-remittance:{" "}
                <span className="font-mono">{signedPeso(c.overRemittanceAmount)}</span>
              </div>
              <Choice
                label="If over-remittance, mark one (1) box only"
                value={values.overRemittanceChoice ?? ""}
                onChange={(v) => set("overRemittanceChoice", v)}
                options={choiceOptions}
              />
            </div>
          ) : null}
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
          <PaymentBlock values={values} set={set} items={[32, 33, 34, 35]} />
        </CardContent>
      </Card>
    </WithholdingFrame>
  );
}
