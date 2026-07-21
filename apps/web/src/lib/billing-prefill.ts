import type { ClientSummary, Service } from "./api";

/** The draft line shape used by the New-billing form. */
export interface PrefillLine {
  description: string;
  qty: number;
  rate: number;
}

/** "MONTHLY" → matches a service billingMethod like "Monthly". */
function methodKey(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s_]+/g, "").toUpperCase(); // ASFILING / MONTHLY / QUARTERLY
}

/** Billing-period suffix for the line description, from the billing date. */
export function periodSuffix(billingMethod: string | null | undefined, date: Date): string {
  const key = methodKey(billingMethod);
  if (key === "MONTHLY") {
    return ` — ${date.toLocaleDateString("en-PH", {
      month: "long",
      year: "numeric",
      timeZone: "Asia/Manila",
    })}`;
  }
  if (key === "QUARTERLY") {
    return ` — Q${Math.floor(date.getMonth() / 3) + 1} ${date.getFullYear()}`;
  }
  return "";
}

/**
 * The default line item for a client's new billing, wired from the Services
 * catalog: the client's default service (falling back to the first ACTIVE
 * service whose billing cadence matches the client's), priced at the client's
 * professional fee (falling back to the service's default fee). Returns null
 * when there's nothing sensible to prefill.
 */
export function defaultBillingLine(
  client: Pick<ClientSummary, "professionalFee" | "billingMethod" | "defaultServiceId">,
  services: Service[],
  billingDate: Date,
): PrefillLine | null {
  const active = services.filter((s) => s.status === "Active");
  const byId = client.defaultServiceId
    ? active.find((s) => s.id === client.defaultServiceId)
    : undefined;
  const byMethod = active.find(
    (s) => methodKey(s.billingMethod) === methodKey(client.billingMethod),
  );
  const service = byId ?? byMethod;

  const clientFee =
    client.professionalFee != null && Number(client.professionalFee) > 0
      ? Number(client.professionalFee)
      : null;
  const serviceFee = service && Number(service.defaultFee) > 0 ? Number(service.defaultFee) : null;
  const rate = clientFee ?? serviceFee;

  if (!service && rate == null) return null;
  return {
    description: `${service?.name ?? "Professional services"}${periodSuffix(
      client.billingMethod,
      billingDate,
    )}`,
    qty: 1,
    rate: rate ?? 0,
  };
}
