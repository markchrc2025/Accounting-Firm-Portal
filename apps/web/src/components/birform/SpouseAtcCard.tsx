// SpouseAtcCard — Track A U27 / W27 (D74): the spouse's ATC on the 1701Q (Item 20) and the
// 1701 (Item 4 of Part I on page 2), chosen by the preparer from the choices the BIR printed
// for the spouse (@portal/shared SPOUSE_ATC_CHOICES). Starts empty; nothing picks one. A
// spouse with sales or receipts needs it before the return leaves the Portal.

import { SPOUSE_ATC_CHOICES, SPOUSE_ATC_ITEM, type SpouseAtcForm } from "@portal/shared";
import { Card, CardContent } from "../ui";

export function SpouseAtcCard({
  form,
  atc,
  onAtc,
}: {
  form: SpouseAtcForm;
  atc: string;
  onAtc: (v: string) => void;
}) {
  const choices = SPOUSE_ATC_CHOICES[form];
  const known = choices.some((c) => c.code === atc);
  return (
    <Card>
      <CardContent className="space-y-3">
        <div className="eyebrow">Chosen on this return · Spouse</div>
        <label className="block">
          <span className="mb-1 block text-[12.5px] font-semibold text-content">
            Item {SPOUSE_ATC_ITEM[form]} Spouse&apos;s Alphanumeric Tax Code (ATC)
          </span>
          <select
            className="input w-full"
            data-testid="spouse-atc-select"
            value={atc}
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
      </CardContent>
    </Card>
  );
}
