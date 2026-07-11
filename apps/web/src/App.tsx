import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import AuditPage from "./pages/AuditPage";
import BillingPage from "./pages/BillingPage";
import ClientDetailPage from "./pages/ClientDetailPage";
import ClientFormPage from "./pages/ClientFormPage";
import DashboardPage from "./pages/DashboardPage";
import ExpensesPage from "./pages/ExpensesPage";
import FilingsPage from "./pages/FilingsPage";
import IntegrationsPage from "./pages/IntegrationsPage";
import LoginPage from "./pages/LoginPage";
import SalesPage from "./pages/SalesPage";
import ServicesPage from "./pages/ServicesPage";
import TaxPage from "./pages/TaxPage";
import TaxRulesPage from "./pages/TaxRulesPage";
import UsersPage from "./pages/UsersPage";

/**
 * Routes. Public auth pages render standalone; every authenticated page renders
 * inside `<AppShell>` (sidebar + top bar), which also enforces the auth guard and
 * redirects unauthenticated visitors to /login.
 */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept" element={<AcceptInvitePage />} />

      <Route element={<AppShell />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/integrations" element={<IntegrationsPage />} />
        <Route path="/audit" element={<AuditPage />} />
        <Route path="/clients/new" element={<ClientFormPage />} />
        <Route path="/clients/:clientId/edit" element={<ClientFormPage />} />
        <Route path="/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/clients/:clientId/sales" element={<SalesPage />} />
        <Route path="/clients/:clientId/expenses" element={<ExpensesPage />} />
        <Route path="/clients/:clientId/tax" element={<TaxPage />} />
        <Route path="/clients/:clientId/tax-rules" element={<TaxRulesPage />} />
        <Route path="/clients/:clientId/billing" element={<BillingPage />} />
        <Route path="/clients/:clientId/filings" element={<FilingsPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
