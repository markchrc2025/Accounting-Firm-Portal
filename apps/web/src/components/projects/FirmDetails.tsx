// FirmDetails - the small pieces that show a project's firm details (PB7, PA8 / D70) in the
// portfolio and on the overview: the client (a link to a listed client, else the name as typed),
// the category chip, the fee, and the Recurring badge with its frequency.

import { Link } from "react-router-dom";
import { Chip, peso } from "../ui";
import { ColourChip } from "./parts";
import type { ProjectDto } from "../../lib/projects";
import { FREQUENCY_LABELS, isFrequency } from "../../lib/recurrence";

/** The client: a listed client links to its page; a typed name shows as typed. */
export function ClientName({ p }: { p: ProjectDto }) {
  if (p.client) {
    return (
      <Link
        to={`/clients/${encodeURIComponent(p.client.id)}`}
        data-client-link={p.client.id}
        className="text-blue underline-offset-2 hover:underline"
      >
        {p.clientName || p.client.businessName}
      </Link>
    );
  }
  if (p.clientName) return <span data-client-typed>{p.clientName}</span>;
  return null;
}

export function CategoryChip({ p }: { p: ProjectDto }) {
  if (!p.category) return null;
  return (
    <span data-category={p.category.id}>
      <ColourChip name={p.category.name} colour={p.category.colour} />
    </span>
  );
}

export function FeeText({ p }: { p: ProjectDto }) {
  if (p.professionalFee == null) return null;
  return (
    <span data-fee className="font-mono">
      {peso(p.professionalFee)}
    </span>
  );
}

export function RecurringBadge({ p }: { p: ProjectDto }) {
  if (!p.isRecurring) return null;
  const f = p.recurrenceFrequency;
  return (
    <Chip variant="info" data-recurring={f ?? ""}>
      Recurring{f && isFrequency(f) ? ` · ${FREQUENCY_LABELS[f]}` : ""}
    </Chip>
  );
}
