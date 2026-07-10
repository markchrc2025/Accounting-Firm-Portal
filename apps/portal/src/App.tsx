import * as React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppLayout } from "@/components/shell";
import { SessionProvider } from "@/session";
import {
  InvitationAcceptScreen,
  LoginScreen,
  MfaChallengeScreen,
  MfaEnrollmentScreen,
} from "@/screens/auth";
import {
  AuditScreen,
  BillingScreen,
  ClientDetailScreen,
  ClientFormScreen,
  ClientsListScreen,
  DashboardScreen,
  ExpensesListScreen,
  FilingsScreen,
  IntegrationsScreen,
  SalesListScreen,
  ServicesScreen,
  TaxComputationScreen,
  TaxRulesScreen,
  UsersScreen,
} from "@/screens/firm";
import {
  PortalExpensesScreen,
  PortalFilingsScreen,
  PortalHomeScreen,
  PortalSalesScreen,
  PortalTaxScreen,
  PortalUsersScreen,
} from "@/screens/portal";

/**
 * App routing. The public auth routes render standalone (each screen wraps itself in the
 * split-panel `<AuthLayout>`); every authenticated route renders inside the `<AppLayout>`
 * shell (sidebar, client switcher, top bar, RBAC-gated nav). The client switcher
 * re-contextualizes the whole Client Workspace via the session's active client + regime.
 */
export default function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <Routes>
        {/* Public auth routes (standalone split layout) */}
        <Route path="/login" element={<LoginScreen />} />
        <Route path="/mfa" element={<MfaChallengeScreen />} />
        <Route path="/mfa-enroll" element={<MfaEnrollmentScreen />} />
        <Route path="/accept" element={<InvitationAcceptScreen />} />

        {/* Authenticated shell */}
        <Route element={<AppLayout />}>
          {/* Firm — Overview */}
          <Route index element={<DashboardScreen />} />
          <Route path="clients" element={<ClientsListScreen />} />
          <Route path="clients/new" element={<ClientFormScreen />} />
          <Route path="clients/:id" element={<ClientDetailScreen />} />
          <Route path="clients/:id/edit" element={<ClientFormScreen />} />

          {/* Firm — Client Workspace */}
          <Route path="sales" element={<SalesListScreen />} />
          <Route path="expenses" element={<ExpensesListScreen />} />
          <Route path="tax" element={<TaxComputationScreen />} />
          <Route path="tax-rules" element={<TaxRulesScreen />} />
          <Route path="billing" element={<BillingScreen />} />
          <Route path="filings" element={<FilingsScreen />} />

          {/* Firm — Firm Admin */}
          <Route path="admin/users" element={<UsersScreen />} />
          <Route path="admin/services" element={<ServicesScreen />} />
          <Route path="admin/integrations" element={<IntegrationsScreen />} />
          <Route path="admin/audit" element={<AuditScreen />} />

          {/* Client Portal */}
          <Route path="portal" element={<PortalHomeScreen />} />
          <Route path="portal/sales" element={<PortalSalesScreen />} />
          <Route path="portal/expenses" element={<PortalExpensesScreen />} />
          <Route path="portal/tax" element={<PortalTaxScreen />} />
          <Route path="portal/filings" element={<PortalFilingsScreen />} />
          <Route path="portal/users" element={<PortalUsersScreen />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
