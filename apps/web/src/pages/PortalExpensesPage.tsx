import { useQuery } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import {
  fetchCategories,
  fetchPortalContext,
  fetchPurchases,
  type Paginated,
  type PurchaseTxn,
} from "../lib/api";
import {
  Card,
  Chip,
  cn,
  EmptyState,
  ErrorState,
  PageHeader,
  peso,
  Skeleton,
} from "../components/ui";

/** VAT when the tax type mentions VAT but is not NON-VAT; otherwise percentage. */
function isVatRegime(taxType?: string | null): boolean {
  const t = (taxType ?? "").toUpperCase();
  return t.includes("VAT") && !t.includes("NON");
}

export default function PortalExpensesPage() {
  const ctxQuery = useQuery({
    queryKey: ["portal-context"],
    queryFn: fetchPortalContext,
  });
  const ctx = ctxQuery.data;
  const clientId = ctx?.id ?? "";
  const isVat = isVatRegime(ctx?.taxType);

  const categories = useQuery({
    queryKey: ["categories", clientId, "EXPENSE"],
    queryFn: () => fetchCategories(clientId, "EXPENSE"),
    enabled: !!clientId,
  });
  const list = useQuery<Paginated<PurchaseTxn>>({
    queryKey: ["purchases", clientId],
    queryFn: () => fetchPurchases(clientId),
    enabled: !!clientId,
  });

  const categoryName = useMemo(() => {
    const map = new Map((categories.data ?? []).map((c) => [c.id, c.name]));
    return (id: string) => map.get(id) ?? "—";
  }, [categories.data]);

  if (ctxQuery.isPending) {
    return (
      <div className="animate-fade-rise space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40" />
      </div>
    );
  }
  if (ctxQuery.isError || !ctx) {
    return (
      <div className="animate-fade-rise">
        <Card>
          <ErrorState
            message="Could not load your organization."
            onRetry={() => void ctxQuery.refetch()}
          />
        </Card>
      </div>
    );
  }

  const rows = list.data?.data ?? [];

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            Expenses
            <Chip variant="neutral">VIEW ONLY</Chip>
          </span>
        }
        description={ctx.businessName}
      />

      <Card className="overflow-hidden">
        {list.isError ? (
          <ErrorState
            message="Could not load expense records."
            onRetry={() => void list.refetch()}
          />
        ) : list.isPending ? (
          <div className="space-y-3 px-6 py-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton
                key={i}
                className={cn(i % 3 === 1 && "w-3/4", i % 3 === 2 && "w-2/3")}
              />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No expense records"
            description="Your recorded expenses will appear here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-line-divider bg-sidebar font-mono text-[10px] uppercase tracking-[.14em] text-content-secondary">
                  <Th>Date</Th>
                  <Th>Ref</Th>
                  <Th>Supplier</Th>
                  <Th>Category</Th>
                  <Th>{isVat ? "Input VAT category" : "Type"}</Th>
                  <Th>Deduct.</Th>
                  <Th className="text-right">Amount</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-divider">
                {rows.map((t) => (
                  <tr
                    key={t.id}
                    className="text-[13px] transition-colors hover:bg-rowhover"
                  >
                    <Td className="font-mono text-[12px] text-content-secondary">
                      {t.txnDate}
                    </Td>
                    <Td className="font-mono text-[12px] text-blue">
                      {t.referenceNo ?? "—"}
                    </Td>
                    <Td className="text-content">{t.vendor ?? "—"}</Td>
                    <Td className="text-content-secondary">
                      {categoryName(t.categoryId)}
                    </Td>
                    <Td>
                      {isVat ? (
                        t.inputVATCategory ? (
                          <Chip variant="neutral">{t.inputVATCategory}</Chip>
                        ) : (
                          <span className="text-content-muted">—</span>
                        )
                      ) : (
                        <span className="text-content-muted">N/A</span>
                      )}
                    </Td>
                    <Td>
                      {t.deductible ? (
                        <span className="font-semibold text-success">✓</span>
                      ) : (
                        <span className="text-content-muted">—</span>
                      )}
                    </Td>
                    <Td className="text-right font-mono tabular-nums text-content">
                      {peso(t.netAmount)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {list.data ? (
        <p className="mt-3 font-mono text-[11px] uppercase tracking-[.14em] text-content-secondary">
          {list.data.total} record(s)
        </p>
      ) : null}
    </div>
  );
}

function Th({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <th className={cn("px-4 py-2.5 font-semibold", className)}>{children}</th>;
}
function Td({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={cn("px-4 py-3", className)}>{children}</td>;
}
