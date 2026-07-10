/**
 * Screen 19a — Services catalog (Firm Admin).
 *
 * The firm's service catalog whose default fees seed client engagements and
 * invoice line items. A DataTable (4 states) lists each service with its billing
 * cadence + status; "+ Add service" opens a modal for capturing a new one. The
 * modal is a self-contained form — "Save service" simply closes it (no
 * persistence in the prototype).
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import {
  Button,
  Card,
  Checkbox,
  DataTable,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Input,
  Label,
  PageHeader,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  StatusChip,
  TableSkeleton,
  Textarea,
  type ChipVariant,
  type ColumnDef,
} from "@/components/ui";
import { api } from "@/mock";
import type { BillingMethod, FilingForm, Service } from "@/types";
import { cn, peso } from "@/lib/utils";

/** Billing cadence → chip tone. */
function billingVariant(method: BillingMethod): ChipVariant {
  if (method === "Monthly") return "info";
  if (method === "Quarterly") return "gold";
  return "success"; // As Filing
}

const columns: ColumnDef<Service>[] = [
  {
    id: "name",
    header: "Service",
    cell: ({ row }) => (
      <span className="font-semibold text-content">{row.original.name}</span>
    ),
  },
  {
    id: "description",
    header: "Description",
    cell: ({ row }) => (
      <span className="text-content-secondary">{row.original.description}</span>
    ),
  },
  {
    id: "defaultFee",
    header: "Default fee",
    meta: { numeric: true },
    cell: ({ row }) => peso(row.original.defaultFee),
  },
  {
    id: "billing",
    header: "Billing",
    cell: ({ row }) => (
      <StatusChip
        label={row.original.billingMethod}
        variant={billingVariant(row.original.billingMethod)}
      />
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusChip
        label={row.original.status}
        variant={row.original.status === "Active" ? "success" : "neutral"}
      />
    ),
  },
  {
    id: "actions",
    header: "",
    meta: { align: "right" },
    cell: ({ row }) => (
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          aria-label={`Edit ${row.original.name}`}
        >
          Edit
        </Button>
      </div>
    ),
  },
];

/* ------------------------------------------------------------------------- *
 * Add Service modal
 * ------------------------------------------------------------------------- */

const BILLING_METHODS: readonly BillingMethod[] = [
  "Quarterly",
  "Monthly",
  "As Filing",
] as const;

const LINKED_FORMS: readonly FilingForm[] = [
  "2550Q",
  "2551Q",
  "1701Q",
  "1701",
  "0619-E",
] as const;

/** Radix Select forbids empty-string values, so "None" maps to this sentinel. */
const NO_FORM = "none";

function AddServiceModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): React.JSX.Element {
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [fee, setFee] = React.useState("");
  const [billing, setBilling] = React.useState<BillingMethod>("Quarterly");
  const [linkedForm, setLinkedForm] = React.useState<string>(NO_FORM);
  const [active, setActive] = React.useState(true);

  function reset(): void {
    setName("");
    setDescription("");
    setFee("");
    setBilling("Quarterly");
    setLinkedForm(NO_FORM);
    setActive(true);
  }

  function handleOpenChange(next: boolean): void {
    if (!next) reset();
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Add service</DialogTitle>
        </DialogHeader>
        <DialogBody className="space-y-5">
          <div>
            <Label htmlFor="service-name" className="mb-1.5 block">
              Service name
            </Label>
            <Input
              id="service-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Quarterly VAT Filing (2550Q)"
            />
          </div>

          <div>
            <Label htmlFor="service-description" className="mb-1.5 block">
              Description
            </Label>
            <Textarea
              id="service-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this service covers…"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="service-fee" className="mb-1.5 block">
                Default fee
              </Label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-content-tertiary">
                  ₱
                </span>
                <Input
                  id="service-fee"
                  inputMode="decimal"
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  placeholder="0.00"
                  className="pl-7 font-mono tabular-nums"
                />
              </div>
            </div>

            <div>
              <span className="mb-1.5 block text-[13px] font-medium text-content">
                Billing method
              </span>
              <div
                role="group"
                aria-label="Billing method"
                className="flex rounded-input border border-line-input p-0.5"
              >
                {BILLING_METHODS.map((method) => (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={billing === method}
                    onClick={() => setBilling(method)}
                    className={cn(
                      "flex-1 rounded-[6px] px-2 py-1.5 text-[12px] font-medium transition-colors",
                      billing === method
                        ? "bg-navy text-white"
                        : "text-content-secondary hover:bg-rowhover",
                    )}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="service-linked-form" className="mb-1.5 block">
              Linked BIR form <span className="text-content-tertiary">(optional)</span>
            </Label>
            <Select value={linkedForm} onValueChange={setLinkedForm}>
              <SelectTrigger id="service-linked-form">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_FORM}>None</SelectItem>
                {LINKED_FORMS.map((form) => (
                  <SelectItem key={form} value={form}>
                    {form}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {billing === "As Filing" ? (
            <p className="text-[12.5px] text-gold-deep">
              Bills automatically each time the linked form is filed.
            </p>
          ) : null}

          <div className="flex items-center gap-2.5">
            <Checkbox
              id="service-active"
              checked={active}
              onCheckedChange={(checked) => setActive(checked === true)}
            />
            <Label htmlFor="service-active" className="cursor-pointer">
              Active
            </Label>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button
            variant="ghost"
            size="md"
            onClick={() => handleOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            size="md"
            onClick={() => handleOpenChange(false)}
          >
            Save service
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------------- *
 * Screen
 * ------------------------------------------------------------------------- */

export function ServicesScreen(): React.JSX.Element {
  const [modalOpen, setModalOpen] = React.useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["services"],
    queryFn: () => api.listServices(),
  });

  const header = (
    <PageHeader
      title="Services"
      eyebrow="Firm admin"
      actions={
        <Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Add service
        </Button>
      }
    />
  );

  let body: React.JSX.Element;
  if (isLoading) {
    body = (
      <Card className="overflow-hidden">
        <TableSkeleton rows={6} cols={6} />
      </Card>
    );
  } else if (isError) {
    body = (
      <Card>
        <ErrorState
          message="Couldn't load services."
          onRetry={() => void refetch()}
        />
      </Card>
    );
  } else if ((data ?? []).length === 0) {
    body = (
      <Card>
        <EmptyState
          title="No services yet"
          description="Add the firm's first service to seed engagements and invoice line items."
        >
          <Button variant="primary" size="md" onClick={() => setModalOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add service
          </Button>
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <>
        <Card className="overflow-hidden">
          <DataTable columns={columns} data={data ?? []} />
        </Card>
        <p className="mt-3 text-[12.5px] text-content-muted">
          Default fees seed the client Engagement card and invoice line items, and
          can be overridden per client.
        </p>
      </>
    );
  }

  return (
    <>
      {header}
      {body}
      <AddServiceModal open={modalOpen} onOpenChange={setModalOpen} />
    </>
  );
}
