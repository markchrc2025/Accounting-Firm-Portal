/**
 * Screen 8 — Client detail.
 *
 * Breadcrumb + header + a tab bar. Overview & Users are real in-page panels; the
 * Sales/Expenses/Tax/Billing/Filings tabs are navigation triggers that set the active
 * client then route to the corresponding workspace screen.
 */
import * as React from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "lucide-react";

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  DataTable,
  ErrorState,
  RegimeChip,
  Skeleton,
  StatusChip,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  type ChipVariant,
  type ColumnDef,
} from "@/components/ui";
import { TrendLine } from "@/components/charts";
import { TWO_COLUMN_GRID } from "@/components/shell";
import { api, DASHBOARD } from "@/mock";
import type { ClientStatus, Filing, PortalRole, PortalUser } from "@/types";
import { useSession } from "@/session";
import { cn, initials, peso } from "@/lib/utils";

const TAX_PERIOD = "2026-Q2";

/** Tab values that navigate to a workspace screen instead of showing a panel. */
const NAV_ROUTES: Record<string, string> = {
  sales: "/sales",
  expenses: "/expenses",
  tax: "/tax",
  billing: "/billing",
  filings: "/filings",
};

function statusVariant(status: ClientStatus): ChipVariant {
  if (status === "Active") return "success";
  if (status === "Onboarding") return "warn";
  return "neutral";
}

function roleVariant(role: PortalRole): ChipVariant {
  if (role === "Owner") return "gold";
  if (role === "Manager") return "info";
  return "neutral";
}

const portalUserColumns: ColumnDef<PortalUser>[] = [
  {
    id: "name",
    header: "User",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate font-semibold text-content">{row.original.name}</div>
        <div className="truncate text-[12px] text-content-secondary">
          {row.original.email}
        </div>
      </div>
    ),
  },
  {
    id: "role",
    header: "Role",
    cell: ({ row }) => (
      <Chip variant={roleVariant(row.original.role)}>{row.original.role}</Chip>
    ),
  },
  {
    id: "status",
    header: "Status",
    cell: ({ row }) => (
      <StatusChip
        label={row.original.status}
        variant={row.original.status === "Active" ? "success" : "warn"}
      />
    ),
  },
];

/** One row of the "Filed BIR forms" mini-list. */
function FiledFormRow({ filing }: { filing: Filing }): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-3">
      <Chip variant="neutral" size="sm" className="shrink-0">
        {filing.form}
      </Chip>
      <div className="min-w-0 flex-1 truncate text-[12px] text-content-secondary">
        {filing.period}
      </div>
      <span className="shrink-0 font-mono text-[11px] text-content-muted">
        {filing.filed}
      </span>
    </div>
  );
}

export function ClientDetailScreen(): React.JSX.Element {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { setActiveClient } = useSession();
  const [activeTab, setActiveTab] = React.useState("overview");

  const clientQuery = useQuery({
    queryKey: ["client", id],
    queryFn: () => api.getClient(id),
    enabled: id !== "",
  });
  const incomeQuery = useQuery({
    queryKey: ["income", id],
    queryFn: () => api.listIncome(id),
    enabled: id !== "",
  });
  const expensesQuery = useQuery({
    queryKey: ["expenses", id],
    queryFn: () => api.listExpenses(id),
    enabled: id !== "",
  });
  const filingsQuery = useQuery({
    queryKey: ["filings", id],
    queryFn: () => api.listFilings(id),
    enabled: id !== "",
  });
  const taxQuery = useQuery({
    queryKey: ["tax", id, TAX_PERIOD],
    queryFn: () => api.getTaxComputation(id, TAX_PERIOD),
    enabled: id !== "",
  });
  const portalUsersQuery = useQuery({
    queryKey: ["portalUsers", id],
    queryFn: () => api.listPortalUsers(id),
    enabled: id !== "",
  });

  const incomeYtd = React.useMemo(
    () => (incomeQuery.data ?? []).reduce((sum, t) => sum + t.netAmount, 0),
    [incomeQuery.data],
  );
  const expensesYtd = React.useMemo(
    () => (expensesQuery.data ?? []).reduce((sum, t) => sum + t.amount, 0),
    [expensesQuery.data],
  );
  const netYtd = incomeYtd - expensesYtd;

  function openTaxComputation(): void {
    setActiveClient(id);
    navigate("/tax");
  }

  function handleTabChange(value: string): void {
    const route = NAV_ROUTES[value];
    if (route) {
      setActiveClient(id);
      navigate(route);
      return;
    }
    setActiveTab(value);
  }

  if (clientQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-4 w-48" />
        <div className="flex items-center gap-4">
          <Skeleton className="h-[52px] w-[52px]" />
          <div className="space-y-2">
            <Skeleton className="h-7 w-64" />
            <Skeleton className="h-3 w-40" />
          </div>
        </div>
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (clientQuery.isError || !clientQuery.data) {
    return (
      <Card>
        <ErrorState
          title="Client not found"
          message="We couldn't load this client. It may have been removed, or the request failed."
          onRetry={() => void clientQuery.refetch()}
        />
      </Card>
    );
  }

  const client = clientQuery.data;
  const filings = filingsQuery.data ?? [];
  const portalUsers = portalUsersQuery.data ?? [];
  const tax = taxQuery.data;

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-4 text-[12px] text-content-secondary">
        <Link to="/clients" className="text-blue hover:underline">
          Clients
        </Link>
        <span className="px-1.5 text-content-muted">/</span>
        <span className="text-content">{client.name}</span>
      </nav>

      <div className="mb-6 flex items-start justify-between gap-5">
        <div className="flex items-center gap-4">
          <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-card bg-navy font-mono text-[16px] font-bold text-gold-soft">
            {initials(client.name)}
          </span>
          <div className="min-w-0">
            <h1 className="font-serif text-[30px] font-medium text-navy">{client.name}</h1>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-mono text-[12px] text-content-secondary">
                {client.tin}
              </span>
              <RegimeChip regime={client.regime} />
              <StatusChip label={client.status} variant={statusVariant(client.status)} />
            </div>
          </div>
        </div>
        <Button asChild variant="outline" size="sm" className="flex-none">
          <Link to={`/clients/${client.id}/edit`}>Edit client</Link>
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="mb-6">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="sales">Sales</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
          <TabsTrigger value="tax">Tax</TabsTrigger>
          <TabsTrigger value="billing">Billing</TabsTrigger>
          <TabsTrigger value="filings">Filings</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className={TWO_COLUMN_GRID}>
            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>Income vs expenses</CardTitle>
                  <p className="text-[12px] text-content-secondary">
                    Monthly trend · FY 2026
                  </p>
                </CardHeader>
                <CardContent>
                  {/* stand-in: no per-month client series in the mock — reuse the
                      portfolio income/expense trend as an illustrative placeholder. */}
                  <TrendLine data={DASHBOARD.incomeVsExpenses} />
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                <Card className="px-5 py-4">
                  <div className="eyebrow">Income YTD</div>
                  <div className="mt-2 font-mono text-[20px] font-semibold text-content">
                    {peso(incomeYtd)}
                  </div>
                </Card>
                <Card className="px-5 py-4">
                  <div className="eyebrow">Expenses YTD</div>
                  <div className="mt-2 font-mono text-[20px] font-semibold text-content">
                    {peso(expensesYtd)}
                  </div>
                </Card>
                <Card className="px-5 py-4">
                  <div className="eyebrow">Net YTD</div>
                  <div
                    className={cn(
                      "mt-2 font-mono text-[20px] font-semibold",
                      netYtd >= 0 ? "text-success" : "text-danger",
                    )}
                  >
                    {peso(netYtd)}
                  </div>
                </Card>
              </div>
            </div>

            <div className="space-y-5">
              <div className="rounded-card bg-navy px-6 py-5 text-white">
                <div className="font-mono text-[10px] uppercase tracking-[.18em] text-gold-soft">
                  Tax position · {TAX_PERIOD}
                </div>
                <div className="mt-3 font-serif text-[34px] font-medium leading-none">
                  {tax ? peso(tax.estimatedTaxDue) : "—"}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[.18em] text-white/60">
                  Estimate
                </div>
                <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4 text-[12px]">
                  <span className="text-white/70">
                    Filed {tax ? tax.filed.form : "Q1 (1701Q)"}
                  </span>
                  <span className="font-mono text-white">
                    {tax ? peso(tax.filed.figure) : "—"}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={openTaxComputation}
                  className="mt-4 w-full justify-between text-white hover:bg-white/10"
                >
                  Open tax computation
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Filed BIR forms</CardTitle>
                </CardHeader>
                <CardContent className="divide-y divide-line-divider py-0">
                  {filings.length === 0 ? (
                    <p className="py-4 text-[13px] text-content-secondary">
                      No filed forms yet.
                    </p>
                  ) : (
                    filings
                      .slice(0, 4)
                      .map((f) => <FiledFormRow key={f.id} filing={f} />)
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="users">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div>
                <CardTitle>Portal users</CardTitle>
                <p className="mt-1 font-mono text-[12px] text-content-secondary">
                  {portalUsers.length} of {client.seats} seats used
                </p>
              </div>
              <Button variant="primary" size="sm">
                Invite portal user
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable columns={portalUserColumns} data={portalUsers} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
