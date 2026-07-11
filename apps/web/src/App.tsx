import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import AcceptInvitePage from "./pages/AcceptInvitePage";
import ClientDetailPage from "./pages/ClientDetailPage";
import ClientFormPage from "./pages/ClientFormPage";
import DashboardPage from "./pages/DashboardPage";
import LoginPage from "./pages/LoginPage";

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
        <Route path="/clients/new" element={<ClientFormPage />} />
        <Route path="/clients/:clientId/edit" element={<ClientFormPage />} />
        <Route path="/clients/:clientId" element={<ClientDetailPage />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
