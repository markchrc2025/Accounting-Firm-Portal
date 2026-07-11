import { useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createService, fetchServices, updateService } from "../lib/api";
import type { Service, ServiceInput } from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  Chip,
  ChipVariant,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  cn,
  peso,
} from "../components/ui";

/** Billing cadence → tone. Monthly reads informational, Quarterly is the firm's
 * default cadence (gold), and "As Filing" ties to a live filing event (success). */
function billingTone(method: string): ChipVariant {
  const m = method.trim().toLowerCase();
  if (m === "monthly") return "info";
  if (m === "quarterly") return "gold";
  if (m === "as filing") return "success";
  return "neutral";
}

/** Active catalog entries read as success; retired ones fade to neutral. */
function statusTone(status: string): ChipVariant {
  return status.trim().toLowerCase() === "active" ? "success" : "neutral";
}

/** Billing cadences, in the segmented-control order. Values are the stored strings. */
const BILLING_METHODS = ["Quarterly", "Monthly", "As Filing"] as const;
type BillingMethod = (typeof BILLING_METHODS)[number];

/** BIR forms a service can bill against. "" is the "None" (unlinked) option. */
const LINKED_FORMS = ["2550Q", "2551Q", "1701Q", "1701", "0619-E"] as const;

/** Normalize a possibly-arbitrary stored billing string to a known cadence. */
function toBillingMethod(value: string | undefined): BillingMethod {
  const match = BILLING_METHODS.find(
    (m) => m.toLowerCase() === (value ?? "").trim().toLowerCase(),
  );
  return match ?? "Quarterly";
}

export default function ServicesPage() {
  const services = useQuery({ queryKey: ["services"], queryFn: () => fetchServices() });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);

  function openAdd() {
    setEditing(null);
    setModalOpen(true);
  }
  function openEdit(service: Service) {
    setEditing(service);
    setModalOpen(true);
  }

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Services"
        eyebrow="FIRM ADMIN"
        description="Your firm's service catalog — seeds engagement fees and invoice line items."
        actions={<Button onClick={openAdd}>+ Add service</Button>}
      />

      <Card>
        <CardContent className="p-0">
          {services.isPending && (
            <div className="space-y-3 px-6 py-5">
              <Skeleton />
              <Skeleton className="w-5/6" />
              <Skeleton className="w-2/3" />
              <Skeleton className="w-1/2" />
            </div>
          )}

          {services.isError && (
            <ErrorState
              message="Could not load the service catalog."
              onRetry={() => void services.refetch()}
            />
          )}

          {services.data && services.data.length === 0 && (
            <EmptyState
              title="No services yet"
              description="Add the engagements your firm bills for — monthly bookkeeping, quarterly filings, annual returns — and they'll seed client engagement fees and invoice lines."
            >
              <Button onClick={openAdd}>+ Add service</Button>
            </EmptyState>
          )}

          {services.data && services.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                    <th className="px-6 py-2.5 font-semibold">Service</th>
                    <th className="px-6 py-2.5 font-semibold">Description</th>
                    <th className="px-6 py-2.5 text-right font-semibold">Default fee</th>
                    <th className="px-6 py-2.5 font-semibold">Billing</th>
                    <th className="px-6 py-2.5 font-semibold">Status</th>
                    <th className="px-6 py-2.5 text-right font-semibold">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-divider">
                  {services.data.map((s) => (
                    <tr
                      key={s.id}
                      className="text-[13px] transition-colors hover:bg-rowhover"
                    >
                      <td className="px-6 py-3">
                        <div className="font-medium text-content">{s.name}</div>
                        {s.linkedForm ? (
                          <div className="mt-0.5 font-mono text-[11px] text-content-tertiary">
                            {s.linkedForm}
                          </div>
                        ) : null}
                      </td>
                      <td className="max-w-[280px] px-6 py-3">
                        <span
                          className="block truncate text-content-secondary"
                          title={s.description}
                        >
                          {s.description || "—"}
                        </span>
                      </td>
                      <td className="px-6 py-3 text-right font-mono text-content">
                        {peso(s.defaultFee)}
                      </td>
                      <td className="px-6 py-3">
                        <Chip variant={billingTone(s.billingMethod)}>{s.billingMethod}</Chip>
                      </td>
                      <td className="px-6 py-3">
                        <Chip variant={statusTone(s.status)}>{s.status}</Chip>
                      </td>
                      <td className="px-6 py-3 text-right">
                        <Button variant="link" size="sm" onClick={() => openEdit(s)}>
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="mt-3 text-[12.5px] text-content-muted">
        Fees seed the client Engagement card and invoice line items, overridable per
        client.
      </p>

      {modalOpen && (
        <ServiceModal
          existing={editing}
          onClose={() => setModalOpen(false)}
          onSaved={() => setModalOpen(false)}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Add/Edit modal */

function ServiceModal({
  existing,
  onClose,
  onSaved,
}: {
  existing: Service | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [defaultFee, setDefaultFee] = useState(
    existing != null ? String(existing.defaultFee) : "",
  );
  const [billingMethod, setBillingMethod] = useState<BillingMethod>(
    toBillingMethod(existing?.billingMethod),
  );
  const [linkedForm, setLinkedForm] = useState(existing?.linkedForm ?? "");
  const [active, setActive] = useState(
    existing != null ? existing.status.trim().toLowerCase() === "active" : true,
  );

  const mutation = useMutation({
    mutationFn: (body: ServiceInput) =>
      existing ? updateService(existing.id, body) : createService(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["services"] });
      onSaved();
    },
  });

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body: ServiceInput = {
      name: name.trim(),
      description: description.trim() || undefined,
      defaultFee: Number(defaultFee),
      billingMethod,
      linkedForm: linkedForm || null,
      status: active ? "Active" : "Retired",
    };
    mutation.mutate(body);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${existing ? "Edit" : "Add"} service`}
        className="flex max-h-[90vh] w-full max-w-[520px] animate-fade-rise flex-col overflow-hidden rounded-modal bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex flex-none items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h2 className="font-serif text-[19px] font-medium text-navy">
            {existing ? "Edit service" : "Add service"}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-btn border border-line-strong bg-card text-lg leading-none text-content-secondary transition-colors hover:border-navy hover:text-navy"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Scrollable body */}
          <div className="flex-1 space-y-4 overflow-auto px-6 py-5">
            {mutation.isError && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-sm text-danger-ink">
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Could not save this service."}
              </div>
            )}

            <Field label="Service name">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input"
                placeholder="Quarterly VAT filing"
              />
            </Field>

            <Field label="Description">
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="input resize-y"
                placeholder="What this engagement covers."
              />
            </Field>

            <Field label="Default fee">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-content-secondary">
                  ₱
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  value={defaultFee}
                  onChange={(e) => setDefaultFee(e.target.value)}
                  className="input pl-7 font-mono"
                  placeholder="0.00"
                />
              </div>
            </Field>

            <Field label="Billing method">
              <div className="inline-flex rounded-input border border-line-input bg-card p-0.5">
                {BILLING_METHODS.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setBillingMethod(m)}
                    className={cn(
                      "rounded-[6px] px-3 py-1.5 text-[13px] font-semibold transition-colors",
                      billingMethod === m
                        ? "bg-navy text-white"
                        : "text-content-secondary hover:text-navy",
                    )}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </Field>

            {billingMethod === "As Filing" && (
              <p className="rounded-input bg-warn-bg-2 px-3.5 py-2.5 text-[12.5px] text-warn">
                Bills automatically each time the linked form is filed.
              </p>
            )}

            <Field label="Linked BIR form">
              <select
                value={linkedForm}
                onChange={(e) => setLinkedForm(e.target.value)}
                className="input"
              >
                <option value="">None</option>
                {LINKED_FORMS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>

            <label className="flex items-center gap-2.5 text-[13px] text-content">
              <input
                type="checkbox"
                checked={active}
                onChange={(e) => setActive(e.target.checked)}
              />
              Active
            </label>
          </div>

          {/* Sticky footer */}
          <div className="flex flex-none justify-end gap-2 border-t border-line px-6 py-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-[13px] font-semibold text-content">{label}</span>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}
