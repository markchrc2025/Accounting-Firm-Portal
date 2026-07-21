import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchAuditLogs } from "../lib/api";
import type { AuditFilters, AuditRow } from "../lib/api";
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
} from "../components/ui";
import { SettingsTabs } from "../components/SettingsTabs";

/** Two-digit padding for date/time parts. */
function pad(n: number): string {
  return n.toString().padStart(2, "0");
}

/** ISO timestamp → `YYYY-MM-DD HH:mm:ss` (local). Invalid input → "—". */
function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  );
}

/** Action → chip tone. Case-tolerant; anything unknown reads neutral. */
function actionTone(action: string): ChipVariant {
  switch (action.trim().toLowerCase()) {
    case "create":
      return "success";
    case "update":
      return "info";
    case "delete":
      return "danger";
    case "login":
      return "neutral";
    case "export":
      return "gold";
    default:
      return "neutral";
  }
}

/** Short, human-friendly entity id (`a1b2c3…`) — full ids are long UUIDs. */
function shortId(id: string): string {
  return id.length > 6 ? `${id.slice(0, 6)}…` : id;
}

/** Actions offered in the filter dropdown (value "" = all). */
const ACTION_OPTIONS = ["create", "update", "delete", "login", "export"] as const;

/** Escape a single CSV field per RFC 4180 (quote when it contains , " or newline). */
function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Serialize the loaded rows to a CSV string with a header line. */
function rowsToCsv(rows: AuditRow[]): string {
  const header = ["timestamp", "actor", "action", "entityType", "entityId", "ipAddress"];
  const lines = rows.map((r) =>
    [r.timestamp, r.actor, r.action, r.entityType, r.entityId ?? "", r.ipAddress ?? ""]
      .map(csvField)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n");
}

export default function AuditPage() {
  const [actor, setActor] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Build the query filter, omitting empty fields entirely.
  const filters = useMemo<AuditFilters>(() => {
    const f: AuditFilters = {};
    if (actor.trim()) f.actor = actor.trim();
    if (action) f.action = action;
    if (entity.trim()) f.entity = entity.trim();
    if (from) f.from = from;
    if (to) f.to = to;
    return f;
  }, [actor, action, entity, from, to]);

  const audit = useQuery({
    queryKey: ["audit", filters],
    queryFn: () => fetchAuditLogs(filters),
  });

  const rows = audit.data ?? [];

  function exportCsv() {
    if (rows.length === 0) return;
    const blob = new Blob([rowsToCsv(rows)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const labelCls = "mb-1.5 block text-[13px] font-semibold text-content";

  return (
    <div className="animate-fade-rise">
      <SettingsTabs />
      <PageHeader
        title="Audit Log"
        eyebrow="FIRM ADMIN"
        description="Immutable record of activity across the firm."
        actions={
          <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
            Export CSV
          </Button>
        }
      />

      <div className="space-y-6">
        {/* Filter bar */}
        <Card>
          <CardContent>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <label className={labelCls} htmlFor="audit-actor">
                  Actor
                </label>
                <input
                  id="audit-actor"
                  className="input"
                  type="text"
                  placeholder="Contains…"
                  value={actor}
                  onChange={(e) => setActor(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="audit-action">
                  Action
                </label>
                <select
                  id="audit-action"
                  className="input"
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="">All</option>
                  {ACTION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="audit-entity">
                  Entity
                </label>
                <input
                  id="audit-entity"
                  className="input"
                  type="text"
                  placeholder="Contains…"
                  value={entity}
                  onChange={(e) => setEntity(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="audit-from">
                  From
                </label>
                <input
                  id="audit-from"
                  className="input"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="audit-to">
                  To
                </label>
                <input
                  id="audit-to"
                  className="input"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {audit.isPending && (
              <div className="space-y-3 px-6 py-5">
                <Skeleton />
                <Skeleton className="w-5/6" />
                <Skeleton className="w-3/4" />
                <Skeleton className="w-2/3" />
              </div>
            )}
            {audit.isError && (
              <ErrorState
                message="Could not load audit entries."
                onRetry={() => void audit.refetch()}
              />
            )}
            {audit.data && audit.data.length === 0 && (
              <EmptyState
                title="No audit entries"
                description="Activity matching these filters will appear here."
              />
            )}
            {audit.data && audit.data.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                      <th className="px-6 py-2.5 font-semibold">Timestamp</th>
                      <th className="px-6 py-2.5 font-semibold">Actor</th>
                      <th className="px-6 py-2.5 font-semibold">Action</th>
                      <th className="px-6 py-2.5 font-semibold">Entity</th>
                      <th className="px-6 py-2.5 font-semibold">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {audit.data.map((r) => (
                      <tr
                        key={r.id}
                        className="text-[13px] transition-colors hover:bg-rowhover"
                      >
                        <td className="whitespace-nowrap px-6 py-3 font-mono text-[12px] text-content-secondary">
                          {formatTimestamp(r.timestamp)}
                        </td>
                        <td className="px-6 py-3 font-medium text-content">{r.actor}</td>
                        <td className="px-6 py-3">
                          <Chip variant={actionTone(r.action)}>{r.action}</Chip>
                        </td>
                        <td className="px-6 py-3">
                          <span className="text-content">{r.entityType}</span>
                          {r.entityId ? (
                            <>
                              <span className="px-1 text-content-muted">·</span>
                              <span className="font-mono text-[12px] text-content-secondary">
                                {shortId(r.entityId)}
                              </span>
                            </>
                          ) : null}
                        </td>
                        <td className="px-6 py-3 font-mono text-[12px] text-content-secondary">
                          {r.ipAddress ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
