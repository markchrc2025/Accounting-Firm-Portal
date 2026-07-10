import * as React from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { PageHeader } from "@/components/ui";
import { AppLayout } from "@/components/shell";
import { SessionProvider } from "@/session";

/**
 * App routing. The public auth routes render standalone placeholders (built in the
 * auth phase); every authenticated route renders inside the `<AppLayout>` shell.
 * Screens not yet built render a typed `<ScreenStub>` so the shell — sidebar,
 * client switcher, top bar, RBAC-gated nav — is fully navigable now.
 */

/** Placeholder for a not-yet-built screen; keeps the shell navigable. */
function ScreenStub({ name }: { name: string }): React.JSX.Element {
  return (
    <div>
      <PageHeader eyebrow="SCREEN STUB" title={name} />
      <div className="rounded-card border border-dashed border-line-strong bg-card p-10 text-center">
        <p className="font-serif text-[21px] font-medium text-navy">
          Screen: {name}
        </p>
        <p className="mt-2 text-[13.5px] text-content-secondary">
          This screen is stubbed. It ships in the screen-building phase on top of
          the app shell.
        </p>
      </div>
    </div>
  );
}

/** Placeholder for a public auth screen (Login / MFA / Accept). */
function AuthStub({ name }: { name: string }): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper p-6">
      <div className="w-full max-w-md rounded-card border border-line-strong bg-card p-10 text-center">
        <p className="eyebrow mb-2">MCRC TAX &amp; ACCOUNTING</p>
        <h1 className="font-serif text-[26px] font-medium text-navy">
          Screen: {name}
        </h1>
        <p className="mt-2 text-[13.5px] text-content-secondary">
          Coming in the auth phase.
        </p>
      </div>
    </div>
  );
}

export default function App(): React.JSX.Element {
  return (
    <SessionProvider>
      <Routes>
        {/* Public auth routes (standalone) */}
        <Route path="/login" element={<AuthStub name="Login" />} />
        <Route path="/mfa" element={<AuthStub name="MFA challenge" />} />
        <Route path="/mfa-enroll" element={<AuthStub name="MFA enrollment" />} />
        <Route path="/accept" element={<AuthStub name="Invitation accept" />} />

        {/* Authenticated shell */}
        <Route element={<AppLayout />}>
          {/* Firm — Overview */}
          <Route index element={<ScreenStub name="Firm Dashboard" />} />
          <Route path="clients" element={<ScreenStub name="Clients" />} />
          <Route path="clients/new" element={<ScreenStub name="New Client" />} />
          <Route path="clients/:id" element={<ScreenStub name="Client Detail" />} />
          <Route
            path="clients/:id/edit"
            element={<ScreenStub name="Edit Client" />}
          />

          {/* Firm — Client Workspace */}
          <Route path="sales" element={<ScreenStub name="Sales & Income" />} />
          <Route path="expenses" element={<ScreenStub name="Expenses" />} />
          <Route path="tax" element={<ScreenStub name="Tax Computation" />} />
          <Route path="tax-rules" element={<ScreenStub name="Tax Rules" />} />
          <Route path="billing" element={<ScreenStub name="Billing & Invoices" />} />
          <Route path="filings" element={<ScreenStub name="BIR Filings" />} />

          {/* Firm — Firm Admin */}
          <Route path="admin/users" element={<ScreenStub name="Users & Roles" />} />
          <Route path="admin/services" element={<ScreenStub name="Services" />} />
          <Route
            path="admin/integrations"
            element={<ScreenStub name="Integration Credentials" />}
          />
          <Route path="admin/audit" element={<ScreenStub name="Audit Log" />} />

          {/* Client Portal */}
          <Route path="portal" element={<ScreenStub name="Portal Home" />} />
          <Route path="portal/sales" element={<ScreenStub name="Portal Sales & Income" />} />
          <Route
            path="portal/expenses"
            element={<ScreenStub name="Portal Expenses" />}
          />
          <Route path="portal/tax" element={<ScreenStub name="Portal Tax Estimate" />} />
          <Route
            path="portal/filings"
            element={<ScreenStub name="Filed BIR Forms" />}
          />
          <Route path="portal/users" element={<ScreenStub name="Users & Seats" />} />
        </Route>

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </SessionProvider>
  );
}
