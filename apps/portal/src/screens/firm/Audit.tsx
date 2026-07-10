/**
 * Screen 19 — Audit log (Firm Admin).
 *
 * An immutable activity log, filterable by actor / action / entity substring and
 * a date range. The log records both human staff and integration actors (e.g. the
 * "BIR Form Generator" machine identity). Filtering happens server-side via
 * `api.listAudit(filters)`; "Export CSV" is a no-op affordance in the prototype.
 *
 * Radix Select disallows empty-string values, so the "All" options use sentinels
 * that map back to `undefined` when building the filter payload.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import {
  Button,
  Card,
  DataTable,
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
  type ChipVariant,
  type ColumnDef,
} from "@/components/ui";
import { AUDIT, api } from "@/mock";
import type { AuditAction, AuditFilters, AuditRow } from "@/types";

const ALL = "all";

/** The filterable actions, in the order the filter dropdown lists them. */
const ACTIONS: readonly AuditAction[] = [
  "create",
  "update",
  "delete",
  "login",
  "export",
] as const;

/** Distinct actor names present in the log (staff + integration identities). */
const ACTORS: readonly string[] = Array.from(
  new Set(AUDIT.map((row) => row.actor)),
);

/** Audit action → chip tone. */
function actionVariant(action: AuditAction): ChipVariant {
  switch (action) {
    case "create":
      return "success";
    case "update":
      return "info";
    case "delete":
      return "danger";
    case "export":
      return "gold";
    case "login":
      return "neutral";
  }
}

const columns: ColumnDef<AuditRow>[] = [
  {
    id: "timestamp",
    header: "Timestamp",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] text-content-secondary">
        {row.original.timestamp}
      </span>
    ),
  },
  {
    id: "actor",
    header: "Actor",
    cell: ({ row }) => (
      <span className="font-medium text-content">{row.original.actor}</span>
    ),
  },
  {
    id: "action",
    header: "Action",
    cell: ({ row }) => (
      <StatusChip
        label={row.original.action}
        variant={actionVariant(row.original.action)}
      />
    ),
  },
  {
    id: "entity",
    header: "Entity",
    cell: ({ row }) => (
      <span className="text-content">{row.original.entity}</span>
    ),
  },
  {
    id: "ip",
    header: "IP",
    cell: ({ row }) => (
      <span className="font-mono text-[12px] text-content-tertiary">
        {row.original.ip}
      </span>
    ),
  },
];

export function AuditScreen(): React.JSX.Element {
  const [actor, setActor] = React.useState<string>(ALL);
  const [action, setAction] = React.useState<string>(ALL);
  const [entity, setEntity] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");

  const filters: AuditFilters = React.useMemo(
    () => ({
      actor: actor === ALL ? undefined : actor,
      action: action === ALL ? undefined : (action as AuditAction),
      entity: entity.trim() === "" ? undefined : entity.trim(),
      dateFrom: dateFrom === "" ? undefined : dateFrom,
      dateTo: dateTo === "" ? undefined : dateTo,
    }),
    [actor, action, entity, dateFrom, dateTo],
  );

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["audit", filters],
    queryFn: () => api.listAudit(filters),
  });

  const filterBar = (
    <Card className="mb-5 p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="lg:col-span-1">
          <Label htmlFor="audit-actor" className="mb-1.5 block">
            Actor
          </Label>
          <Select value={actor} onValueChange={setActor}>
            <SelectTrigger id="audit-actor">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actors</SelectItem>
              {ACTORS.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="lg:col-span-1">
          <Label htmlFor="audit-action" className="mb-1.5 block">
            Action
          </Label>
          <Select value={action} onValueChange={setAction}>
            <SelectTrigger id="audit-action">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All actions</SelectItem>
              {ACTIONS.map((a) => (
                <SelectItem key={a} value={a}>
                  {a}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="lg:col-span-1">
          <Label htmlFor="audit-entity" className="mb-1.5 block">
            Entity
          </Label>
          <Input
            id="audit-entity"
            type="search"
            value={entity}
            onChange={(e) => setEntity(e.target.value)}
            placeholder="Search entity…"
          />
        </div>

        <div className="lg:col-span-1">
          <Label htmlFor="audit-from" className="mb-1.5 block">
            From
          </Label>
          <Input
            id="audit-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>

        <div className="lg:col-span-1">
          <Label htmlFor="audit-to" className="mb-1.5 block">
            To
          </Label>
          <Input
            id="audit-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        <div className="flex items-end lg:col-span-1">
          <Button variant="outline" size="md" className="w-full">
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </Button>
        </div>
      </div>
    </Card>
  );

  let body: React.JSX.Element;
  if (isLoading) {
    body = (
      <Card className="overflow-hidden">
        <TableSkeleton rows={8} cols={5} />
      </Card>
    );
  } else if (isError) {
    body = (
      <Card>
        <ErrorState
          message="Couldn't load the audit log."
          onRetry={() => void refetch()}
        />
      </Card>
    );
  } else if ((data ?? []).length === 0) {
    body = (
      <Card>
        <EmptyState
          title="No matching entries"
          description="No audit events match the current filters. Try widening the date range or clearing filters."
        />
      </Card>
    );
  } else {
    body = (
      <Card className="overflow-hidden">
        <DataTable columns={columns} data={data ?? []} />
      </Card>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        eyebrow="Firm admin"
        description="An immutable record of every action across the firm, including integration actors."
      />
      {filterBar}
      {body}
    </>
  );
}
