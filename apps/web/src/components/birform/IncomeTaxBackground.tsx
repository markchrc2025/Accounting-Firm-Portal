// IncomeTaxBackground — C5 (D55): the income-tax editors' read-only background.
//
// Taxpayer type and ATC are derived (never typed); civil status is the client's own.
// "Spouse has income?" and "Filing status" appear only for a married taxpayer; an
// unanswered one stays blank on the return.

import type { ReactNode } from "react";
import {
  ATC_LABEL,
  CIVIL_LABEL,
  FILER_LABEL,
  civilStatusOf,
  undecidedHint,
  type ClientBackground,
  type FilerType,
  type IncomeTaxAtc,
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

export function IncomeTaxBackground({
  client,
  filer,
  typeItem,
  atcItem,
  civilItems,
  spouseIncome,
  filing,
  onSpouseIncome,
  onFiling,
  disabled,
}: {
  client: ClientBackground | undefined;
  filer: { type: FilerType | null; atc: IncomeTaxAtc | null };
  /** The form's own item numbers for taxpayer type and ATC (1701: 6 and 7; 1701Q: 7 and 8). */
  typeItem: string;
  atcItem: string;
  /** Present on the returns that carry Items 16 to 18 (1701, 1701A). */
  civilItems?: { civil: string; spouseIncome: string; filing: string };
  spouseIncome?: string;
  filing?: string;
  onSpouseIncome?: (v: string) => void;
  onFiling?: (v: string) => void;
  disabled?: boolean;
}) {
  const civil = civilStatusOf(client?.civilStatus);
  const undecided = !filer.type && !filer.atc;
  return (
    <Card>
      <CardContent className="space-y-2">
        <div className="eyebrow">Background · from the client's record</div>
        <Row label={`Item ${typeItem} Taxpayer type`} testId="bg-type">
          {filer.type ? FILER_LABEL[filer.type] : "—"}
        </Row>
        <Row label={`Item ${atcItem} ATC (derived)`} testId="bg-atc">
          {filer.atc ? ATC_LABEL[filer.atc] : "—"}
        </Row>
        {undecided || !filer.type || !filer.atc ? (
          <p className="text-[11.5px] text-content-muted" data-testid="bg-hint">
            {undecidedHint(client)}
          </p>
        ) : null}
        {civilItems ? (
          <>
            <Row label={`Item ${civilItems.civil} Civil status`} testId="bg-civil">
              {civil ? CIVIL_LABEL[civil] : "Not set on the client's record"}
            </Row>
            {civil === "married" ? (
              <div className="grid gap-3 pt-1 sm:grid-cols-2" data-testid="bg-married">
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
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
