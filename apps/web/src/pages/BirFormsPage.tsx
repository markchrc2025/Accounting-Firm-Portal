import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { fetchBirFormCatalog, fetchBirForms } from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../components/ui";

/**
 * BIR Forms — the internal Generator's home (Phase 0: shell + catalog).
 * Authoring, compute, and export land in later phases; today this surfaces the
 * supported forms and any saved drafts for the firm.
 */
export default function BirFormsPage() {
  const navigate = useNavigate();
  const catalog = useQuery({ queryKey: ["bir-form-catalog"], queryFn: fetchBirFormCatalog });
  const forms = useQuery({ queryKey: ["bir-forms", "all"], queryFn: () => fetchBirForms() });

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="BIR Forms"
        eyebrow="Firm admin"
        description="Generate and file BIR tax forms from your bookkeeping data."
        actions={
          <Button size="sm" onClick={() => navigate("/bir-forms/new")}>
            New 2551Q
          </Button>
        }
      />

      <div className="mb-6 rounded-card border border-warn/40 bg-warn-bg-2 px-4 py-3 text-[12.5px] text-content">
        <span className="font-semibold">Coming online in phases.</span> This is the portal&apos;s
        built-in BIR Form Generator. Forms compute their <em>authoritative</em> figures here —
        your tax estimates remain a management guide and never override a generated form.{" "}
        <span className="font-semibold">2551Q</span> is first.
      </div>

      <div className="space-y-6">
        {/* Saved forms */}
        <Card>
          <CardHeader>
            <CardTitle>Saved forms</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {forms.isPending && (
              <div className="space-y-3 px-6 py-5">
                <Skeleton />
                <Skeleton className="w-2/3" />
              </div>
            )}
            {forms.isError && (
              <ErrorState message="Could not load saved forms." onRetry={() => void forms.refetch()} />
            )}
            {forms.data && forms.data.length === 0 && (
              <EmptyState
                title="No forms yet"
                description="Once form authoring is enabled, drafts and filed forms will appear here."
              />
            )}
            {forms.data && forms.data.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                      <th className="px-6 py-2.5 font-semibold">Form</th>
                      <th className="px-6 py-2.5 font-semibold">Client</th>
                      <th className="px-6 py-2.5 font-semibold">Period</th>
                      <th className="px-6 py-2.5 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-divider">
                    {forms.data.map((f) => (
                      <tr
                        key={f.id}
                        className="cursor-pointer text-[13px] transition-colors hover:bg-rowhover"
                        onClick={() => navigate(`/bir-forms/${f.id}`)}
                      >
                        <td className="px-6 py-3 font-mono font-semibold text-navy">
                          <Link to={`/bir-forms/${f.id}`} onClick={(e) => e.stopPropagation()}>
                            {f.form}
                          </Link>
                        </td>
                        <td className="px-6 py-3 text-content">{f.clientName || "—"}</td>
                        <td className="px-6 py-3 font-mono text-[12px] text-content-secondary">
                          {f.period || "—"}
                        </td>
                        <td className="px-6 py-3">
                          <Chip variant={f.status === "filed" ? "success" : "neutral"}>
                            {f.status}
                          </Chip>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Form catalog */}
        <Card>
          <CardHeader>
            <CardTitle>Supported forms</CardTitle>
          </CardHeader>
          <CardContent>
            {catalog.isPending && (
              <div className="space-y-3">
                <Skeleton />
                <Skeleton className="w-2/3" />
              </div>
            )}
            {catalog.isError && (
              <ErrorState message="Could not load the form catalog." onRetry={() => void catalog.refetch()} />
            )}
            {catalog.data && (
              <div className="grid gap-3 sm:grid-cols-2">
                {catalog.data.map((f) => (
                  <div key={f.code} className="rounded-card border border-line p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-semibold text-navy">{f.code}</span>
                      <Chip variant={f.status === "available" ? "success" : "neutral"}>
                        {f.status === "available" ? "Available" : "Planned"}
                      </Chip>
                    </div>
                    <div className="mt-1 font-serif text-[14px] font-medium text-content">
                      {f.title}
                    </div>
                    <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[.1em] text-content-secondary">
                      {f.category} · {f.frequency}
                    </div>
                    <p className="mt-2 text-[12.5px] text-content-secondary">{f.description}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
