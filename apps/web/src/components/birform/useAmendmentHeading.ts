// useAmendmentHeading.ts — the header line of an amendment draft (W3 R2).

import { useQuery } from "@tanstack/react-query";
import { fetchBirForm, type BirFormDetail } from "../../lib/api";
import { amendmentHeading } from "../../lib/birFiling";

/**
 * The header line of an amendment draft — "Amendment 2 of the 2551Q filed on
 * Apr 20, 2026" — or null for an original. The date is the AMENDED form's, so
 * that form is read once by id.
 */
export function useAmendmentHeading(detail: BirFormDetail | undefined): string | null {
  const amendsId = detail?.amendsId ?? null;
  const amended = useQuery({
    queryKey: ["bir-form", amendsId],
    queryFn: () => fetchBirForm(amendsId!),
    enabled: !!amendsId,
  });
  if (!detail || !amendsId) return null;
  return amendmentHeading(detail.sequence, detail.form, amended.data?.filedAt);
}
