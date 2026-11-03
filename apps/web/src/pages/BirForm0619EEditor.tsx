// 0619-E — Monthly Remittance Form of Creditable Income Taxes Withheld (Expanded).
// Filed for the 1st and 2nd month of a quarter (the 3rd is the 1601-EQ's). Printed,
// not exported. The books fill Items 4 and 14; the server computes Items 16 to 18 and
// the due date's default.

import type { BirForm0619EComputed } from "../lib/api";
import { Card, CardContent } from "../components/ui";
import { BookNotes } from "../components/birform/BookFigures";
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
import { DUE_DATE_NOTE, YES_NO } from "../lib/withholding";

export default function BirForm0619EEditor() {
  const draft = useWithholdingDraft("0619E");
  const { values, set, books } = draft;
  const c = draft.computed as BirForm0619EComputed | undefined;

  return (
    <WithholdingFrame
      draft={draft}
      summary={
        <>
          <ReadOut label="Net amount of remittance (Item 16)" value={c?.i16} />
          <ReadOut label="Total penalties (Item 17D)" value={c?.i17d} />
          <div className="border-t border-line-strong pt-2">
            <ReadOut label="Total amount of remittance (Item 18)" value={c?.i18} strong />
          </div>
        </>
      }
    >
      {/* Part I */}
      <Card>
        <CardContent className="space-y-4">
          <div className="eyebrow">Part I — Background information</div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Text
              label="Due date (Item 2)"
              type="date"
              value={draft.dueDate}
              onChange={(v) => set("dueDate", v)}
              hint={DUE_DATE_NOTE}
            />
            <Choice
              label="Any taxes withheld? (Item 4)"
              value={values.anyWithheld ?? ""}
              onChange={(v) => set("anyWithheld", v)}
              options={YES_NO}
              bookKey="anyWithheld"
            />
          </div>
          <PartyBlock
            values={values}
            set={set}
            items={{ contact: 11, category: 12, email: 13 }}
          />
        </CardContent>
      </Card>

      {/* Part II */}
      <Card>
        <CardContent className="space-y-4">
          <div className="eyebrow">Part II — Tax remittance</div>
          <BookNotes books={books} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Money
              label="Amount of remittance (Item 14)"
              value={values.remittance ?? ""}
              onChange={(v) => set("remittance", v)}
              bookKey="remittance"
            />
            <Money
              label="Less: amount remitted from previously filed form, if this is an amended form (Item 15)"
              value={values.previouslyRemitted ?? ""}
              onChange={(v) => set("previouslyRemitted", v)}
            />
          </div>
          <PenaltiesBlock values={values} set={set} items={["17A", "17B", "17C"]} />
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
          <PaymentBlock values={values} set={set} items={[19, 20, 21, 22]} />
        </CardContent>
      </Card>
    </WithholdingFrame>
  );
}
