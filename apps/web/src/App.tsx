import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./components/AppShell";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import AuditPage from "./pages/AuditPage";
import SettingsPage from "./pages/SettingsPage";
import SsoCallbackPage from "./pages/SsoCallbackPage";
import BillingPage from "./pages/BillingPage";
import BirFormsPage from "./pages/BirFormsPage";
import BirFormEditorPage from "./pages/BirFormEditorPage";
import DocumentsPage from "./pages/DocumentsPage";
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
import ReceiptScanPage from "./pages/ReceiptScanPage";
import ReceiptScansPage from "./pages/ReceiptScansPage";
import PortalUsersPage from "./pages/PortalUsersPage";
import ProfilePage from "./pages/ProfilePage";
import SalesPage from "./pages/SalesPage";
import ServicesPage from "./pages/ServicesPage";
import TaxPage from "./pages/TaxPage";
import TaxRulesPage from "./pages/TaxRulesPage";
import UsersPage from "./pages/UsersPage";

// Projects (PB1) loads on its own: the markdown libraries stay out of the main bundle.
const MyWorkPage = lazy(() => import("./pages/projects/MyWorkPage"));
const SearchPage = lazy(() => import("./pages/projects/SearchPage"));
const ApiTokensPage = lazy(() => import("./pages/ApiTokensPage"));
const ProjectsPage = lazy(() => import("./pages/projects/ProjectsPage"));
const ProjectFormPage = lazy(() => import("./pages/projects/ProjectFormPage"));
const ProjectsSettingsPage = lazy(() => import("./pages/projects/ProjectsSettingsPage"));
const ProjectPage = lazy(() => import("./pages/projects/ProjectPage"));

function Later({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={<div className="p-6 text-[13.5px] text-content-secondary">Loading…</div>}
    >
      {children}
    </Suspense>
  );
}

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
/** /settings lands on the first tab the user can see. */
function SettingsIndexRedirect() {
  const { hasPermission } = useAuth();
  const to = hasPermission("Users:Read") ? "/settings/users" : "/settings/documents";
  return <Navigate to={to} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/accept" element={<AcceptInvitePage />} />
      <Route path="/sso/callback" element={<SsoCallbackPage />} />

      <Route element={<AppShell />}>
        {/* Firm */}
        <Route path="/" element={<HomeRoute />} />
        <Route path="/profile" element={<ProfilePage />} />
        {/* PB3: personal API tokens, reached from the profile page. */}
        <Route path="/profile/tokens" element={<Later><ApiTokensPage /></Later>} />
        {/* Settings hub: Users & Roles, Documents, Integrations, Audit Log and
            Email & Senders live as tabs under /settings; old paths redirect. */}
        <Route path="/settings" element={<SettingsIndexRedirect />} />
        <Route path="/settings/users" element={<UsersPage />} />
        <Route path="/settings/documents" element={<DocumentsPage />} />
        <Route path="/settings/integrations" element={<IntegrationsPage />} />
        <Route path="/settings/audit" element={<AuditPage />} />
        <Route path="/settings/email" element={<SettingsPage />} />
        <Route path="/users" element={<Navigate to="/settings/users" replace />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/chart-of-accounts" element={<ChartOfAccountsPage />} />
        <Route path="/financial-statements" element={<FinancialStatementsPage />} />
        <Route path="/financial-statements/:id" element={<FsReportPage />} />
        <Route path="/integrations" element={<Navigate to="/settings/integrations" replace />} />
        <Route path="/audit" element={<Navigate to="/settings/audit" replace />} />
        <Route path="/documents" element={<Navigate to="/settings/documents" replace />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<ClientFormPage />} />
        <Route path="/clients/:clientId/edit" element={<ClientFormPage />} />
        <Route path="/clients/:clientId" element={<ClientDetailPage />} />
        <Route path="/clients/:clientId/sales" element={<SalesPage />} />
        <Route path="/clients/:clientId/expenses" element={<ExpensesPage />} />
        <Route path="/clients/:clientId/tax" element={<TaxPage />} />
        <Route path="/clients/:clientId/tax-rules" element={<TaxRulesPage />} />
        <Route path="/clients/:clientId/filings" element={<FilingsPage />} />
        {/* Scan receipts (W12): firm users who may add expenses. */}
        <Route path="/receipt-scans" element={<ReceiptScansPage />} />
        <Route path="/receipt-scans/:id" element={<ReceiptScanPage />} />
        {/* Billing is centralized (firm admin) — old per-client URLs redirect. */}
        <Route path="/billing" element={<BillingPage />} />
        {/* Projects (PB1): firm users with Projects:Read; each page sends anyone else home. */}
        {/* PB2: My Work is where Projects opens; the portfolio is "All projects". */}
        <Route path="/projects" element={<Later><MyWorkPage /></Later>} />
        <Route path="/projects/all" element={<Later><ProjectsPage /></Later>} />
        <Route path="/projects/search" element={<Later><SearchPage /></Later>} />
        <Route path="/projects/new" element={<Later><ProjectFormPage /></Later>} />
        <Route path="/projects/settings" element={<Later><ProjectsSettingsPage /></Later>} />
        <Route path="/projects/:key" element={<Later><ProjectPage tab="overview" /></Later>} />
        <Route path="/projects/:key/edit" element={<Later><ProjectFormPage /></Later>} />
        <Route path="/projects/:key/issues" element={<Later><ProjectPage tab="issues" /></Later>} />
        <Route
          path="/projects/:key/issues/:issueKey"
          element={<Later><ProjectPage tab="issue" /></Later>}
        />
        <Route path="/projects/:key/board" element={<Later><ProjectPage tab="board" /></Later>} />
        <Route path="/projects/:key/sessions" element={<Later><ProjectPage tab="sessions" /></Later>} />
        <Route path="/projects/:key/security" element={<Later><ProjectPage tab="security" /></Later>} />
        <Route path="/projects/:key/milestones" element={<Later><ProjectPage tab="milestones" /></Later>} />
        <Route path="/projects/:key/activity" element={<Later><ProjectPage tab="activity" /></Later>} />
        <Route path="/bir-forms" element={<BirFormsPage />} />
        <Route path="/bir-forms/new" element={<BirFormEditorPage />} />
        <Route path="/bir-forms/:id" element={<BirFormEditorPage />} />
        <Route
          path="/clients/:clientId/billing"
          element={<Navigate to="/billing" replace />}
        />

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
