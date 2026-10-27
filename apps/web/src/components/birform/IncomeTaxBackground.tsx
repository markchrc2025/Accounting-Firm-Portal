// IncomeTaxBackground — C5/C6 (D55 and its amendment): what the income-tax editors
// (1701, 1701A, 1701Q) show of the return's background, in two cards.
//
//   "From the client's record"  read-only: the taxpayer type (the client's Classification)
//                               and, on the 1701 and 1701A, the civil status, with a link
//                               to edit the client.
//   "Chosen on this return"     the preparer's choices: the ATC (a selector listing the
//                               choices the BIR printed on the form, starting empty) and,
//                               for a married taxpayer only, "Spouse has income?" and
//                               "Filing status" (unanswered stays blank on the return).
//
// AtcCard is the same selector alone, for the 1702Q and 1702RT editors, which have no
// background of their own.

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ATC_CHOICES,
  CHOOSE_ATC,
  CIVIL_LABEL,
  ITEM_NUMBERS,
  SET_CLASSIFICATION,
  civilStatusOf,
  taxpayerTypeOf,
  type AtcForm,
  type ClientBackground,
  type IncomeTaxForm,
} from "../../lib/incomeTaxBackground";
import { Card, CardContent } from "../ui";

function Row({
  label,
  children,
  testId,
}: {
  label: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 text-[13px]"
      data-testid={testId}
    >
      <span className="text-content-secondary">{label}</span>
      <span className="text-right font-medium text-content">{children}</span>
    </div>
  );
}

/** The ATC selector: the choices the BIR printed on the form, empty until the preparer chooses. */
function AtcSelect({
  form,
  atc,
  onAtc,
  disabled,
}: {
  form: AtcForm;
  atc: string;
  onAtc: (v: string) => void;
  disabled?: boolean;
}) {
  const items = ITEM_NUMBERS[form];
  const choices = ATC_CHOICES[form];
  const known = choices.some((c) => c.code === atc);
  return (
    <div data-testid="bg-atc">
      {!atc ? (
        <p className="mb-1 text-[12.5px] text-content-secondary" data-testid="atc-choose">
          {CHOOSE_ATC(form)}
        </p>
      ) : null}
      <label className="block">
        <span className="mb-1 block text-[12.5px] font-semibold text-content">
          Item {items.atc} Alphanumeric Tax Code (ATC)
        </span>
        <select
          className="input w-full"
          data-testid="atc-select"
          value={atc}
          disabled={disabled}
          onChange={(e) => onAtc(e.target.value)}
        >
          <option value="">Not chosen</option>
          {choices.map((c) => (
            <option key={c.code} value={c.code}>
              {c.label}
            </option>
          ))}
          {atc && !known ? (
            <option value={atc}>{`${atc} — not printed on BIR Form ${form}`}</option>
          ) : null}
        </select>
      </label>
    </div>
  );
}

/** The ATC selector alone, in its own card (1702Q and 1702RT editors). */
export function AtcCard({
  form,
  atc,
  onAtc,
  disabled,
}: {
  form: AtcForm;
  atc: string;
  onAtc: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="eyebrow">Chosen on this return</div>
        <AtcSelect form={form} atc={atc} onAtc={onAtc} disabled={disabled} />
      </CardContent>
    </Card>
  );
}

export function IncomeTaxBackground({
  form,
  client,
  clientId,
  atc,
  onAtc,
  civilItems,
  spouseIncome,
  filing,
  onSpouseIncome,
  onFiling,
  disabled,
}: {
  form: IncomeTaxForm;
  client: ClientBackground | undefined;
  clientId: string;
  /** The ATC saved in the draft (d.atc); "" while none is chosen. */
  atc: string;
  onAtc: (v: string) => void;
  /** Present on the returns that carry Items 16 to 18 (1701, 1701A). */
  civilItems?: { civil: string; spouseIncome: string; filing: string };
  spouseIncome?: string;
  filing?: string;
  onSpouseIncome?: (v: string) => void;
  onFiling?: (v: string) => void;
  disabled?: boolean;
}) {
  const items = ITEM_NUMBERS[form];
  const civil = civilStatusOf(client?.civilStatus);
  const classification = String(client?.classification ?? "").trim();
  const hasBox = taxpayerTypeOf(classification) !== null;
  const editHref = clientId ? `/clients/${clientId}/edit` : "";
  return (
    <>
      <Card>
        <CardContent className="space-y-2">
          <div className="flex items-baseline justify-between gap-3">
            <div className="eyebrow">From the client&apos;s record</div>
            {editHref ? (
              <Link
                to={editHref}
                className="text-[12px] text-blue hover:underline"
                data-testid="bg-edit-client"
              >
                Edit client
              </Link>
            ) : null}
          </div>
          <Row label={`Item ${items.type} Taxpayer type`} testId="bg-type">
            {classification || "Not set"}
          </Row>
          {client && !hasBox ? (
            <p className="text-[11.5px] text-content-muted" data-testid="bg-hint">
              {editHref ? (
                <Link to={editHref} className="text-blue hover:underline">
                  {SET_CLASSIFICATION}
                </Link>
              ) : (
                SET_CLASSIFICATION
              )}
            </p>
          ) : null}
          {civilItems ? (
            <Row label={`Item ${civilItems.civil} Civil status`} testId="bg-civil">
              {civil ? CIVIL_LABEL[civil] : "Not set"}
            </Row>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3">
          <div className="eyebrow">Chosen on this return</div>
          <AtcSelect form={form} atc={atc} onAtc={onAtc} disabled={disabled} />
          {civilItems && civil === "married" ? (
            <div className="grid gap-3 sm:grid-cols-2" data-testid="bg-married">
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-semibold text-content">
                  Item {civilItems.spouseIncome} Spouse has income?
                </span>
                <select
                  className="input w-full"
                  value={spouseIncome ?? ""}
                  disabled={disabled}
                  onChange={(e) => onSpouseIncome?.(e.target.value)}
                >
                  <option value="">Not answered</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[12.5px] font-semibold text-content">
                  Item {civilItems.filing} Filing status
                </span>
                <select
                  className="input w-full"
                  value={filing ?? ""}
                  disabled={disabled}
                  onChange={(e) => onFiling?.(e.target.value)}
                >
                  <option value="">Not answered</option>
                  <option value="joint">Joint filing</option>
                  <option value="separate">Separate filing</option>
                </select>
              </label>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </>
  );
}
