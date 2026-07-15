import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import AuditPage from "./pages/AuditPage";
import BillingPage from "./pages/BillingPage";
import ChartOfAccountsPage from "./pages/ChartOfAccountsPage";
import FinancialStatementsPage from "./pages/FinancialStatementsPage";
import FsReportPage from "./pages/FsReportPage";
import ClientDetailPage from "./pages/ClientDetailPage";
import ClientsPage from "./pages/ClientsPage";
import ClientFormPage from "./pages/ClientFormPage";
import DashboardPage from "./pages/DashboardPage";
import ExpensesPage from "./pages/ExpensesPage";
import FilingsPage from "./pages/FilingsPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import LoginPage from "./pages/LoginPage";
import PortalExpensesPage from "./pages/PortalExpensesPage";
import PortalFilingsPage from "./pages/PortalFilingsPage";
import PortalHomePage from "./pages/PortalHomePage";
import PortalSalesPage from "./pages/PortalSalesPage";
import PortalTaxPage from "./pages/PortalTaxPage";
import PortalUsersPage from "./pages/PortalUsersPage";
import ProfilePage from "./pages/ProfilePage";
import SalesPage from "./pages/SalesPage";
import ServicesPage from "./pages/ServicesPage";
import TaxPage from "./pages/TaxPage";
import TaxRulesPage from "./pages/TaxRulesPage";
import UsersPage from "./pages/UsersPage";

/** Home route: firm users get the dashboard; client users go to their portal. */
function HomeRoute() {
  const { user } = useAuth();
  if (user?.userType === "CLIENT") return <Navigate to="/portal" replace />;
  return <DashboardPage />;
}

/**
 * Routes. Public auth pages render standalone; every authenticated page renders
 * inside `<AppShell>` (sidebar + top bar), which also enforces the auth guard and
 * redirects unauthenticated visitors to /login. Firm staff and client-portal users
 * share the shell; the shell swaps its nav by `user.userType`.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept" element={<AcceptInvitePage />} />

      <Route element={<AppShell />}>
        {/* Firm */}
        <Route path="/" element={<HomeRoute />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/chart-of-accounts" element={<ChartOfAccountsPage />} />
        <Route path="/financial-statements" element={<FinancialStatementsPage />} />
        <Route path="/financial-statements/:id" element={<FsReportPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<ClientFormPage />} />
        <Route path="/clients/:clientId/edit" element={<ClientFormPage />} />
        <Route path="/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/clients/:clientId/sales" element={<SalesPage />} />
        <Route path="/clients/:clientId/expenses" element={<ExpensesPage />} />
        <Route path="/clients/:clientId/tax" element={<TaxPage />} />
        <Route path="/clients/:clientId/tax-rules" element={<TaxRulesPage />} />
        <Route path="/clients/:clientId/billing" element={<BillingPage />} />
        <Route path="/clients/:clientId/filings" element={<FilingsPage />} />

        {/* Client portal (CLIENT users — scoped to their own org) */}
        <Route path="/portal" element={<PortalHomePage />} />
        <Route path="/portal/sales" element={<PortalSalesPage />} />
        <Route path="/portal/expenses" element={<PortalExpensesPage />} />
        <Route path="/portal/tax" element={<PortalTaxPage />} />
        <Route path="/portal/filings" element={<PortalFilingsPage />} />
        <Route path="/portal/users" element={<PortalUsersPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
