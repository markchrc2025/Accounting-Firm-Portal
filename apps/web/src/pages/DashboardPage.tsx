import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { fetchClients, fetchUsers } from "../lib/api";

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export default function DashboardPage() {
  const { user, permissions, signOut, hasPermission } = useAuth();
  const canReadClients = hasPermission("Clients:Read");
  const canCreateClient = hasPermission("Clients:Create");
  const canReadUsers = hasPermission("Users:Read");

  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
    enabled: canReadClients,
  });
  const users = useQuery({
    queryKey: ["users"],
    queryFn: fetchUsers,
    enabled: canReadUsers,
  });

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-600">
            {user?.fullName} · {user?.email} ·{" "}
            <span className="uppercase">{user?.userType}</span>
          </p>
        </div>
        <button
          onClick={signOut}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Sign out
        </button>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Your access">
          <p className="mb-2 text-sm text-gray-600">
            {permissions?.canViewAllClients
              ? "Firm-wide client visibility"
              : `${permissions?.assignedClientIds.length ?? 0} assigned client(s)`}
          </p>
          <p className="text-sm">
            <span className="font-medium">{permissions?.global.length ?? 0}</span> global
            permission(s)
          </p>
          <details className="mt-2">
            <summary className="cursor-pointer text-sm text-gray-500">
              Show permissions
            </summary>
            <ul className="mt-2 max-h-40 overflow-auto text-xs text-gray-600">
              {permissions?.global.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        </Card>

        {canReadClients && (
          <Card
            title="Clients"
            action={
              canCreateClient && (
                <Link
                  to="/clients/new"
                  className="rounded bg-gray-900 px-3 py-1.5 text-sm font-medium text-white"
                >
                  + Add client
                </Link>
              )
            }
          >
            {clients.isPending && <p className="text-sm text-gray-500">Loading…</p>}
            {clients.isError && (
              <p className="text-sm text-amber-700">Could not load clients.</p>
            )}
            {clients.data && clients.data.length === 0 && (
              <p className="text-sm text-gray-500">No clients yet.</p>
            )}
            <ul className="divide-y divide-gray-100">
              {clients.data?.map((c) => (
                <li key={c.id} className="flex justify-between py-2 text-sm">
                  <Link
                    to={`/clients/${c.id}`}
                    className="font-medium text-gray-900 hover:underline"
                  >
                    {c.businessName}
                  </Link>
                  <span className="text-gray-500">{c.taxType ?? "—"}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {canReadUsers && (
          <Card title="Firm users">
            {users.isPending && <p className="text-sm text-gray-500">Loading…</p>}
            {users.isError && (
              <p className="text-sm text-amber-700">Could not load users.</p>
            )}
            <ul className="divide-y divide-gray-100">
              {users.data?.map((u) => (
                <li key={u.id} className="flex justify-between py-2 text-sm">
                  <span>{u.fullName}</span>
                  <span className="text-gray-500">
                    {u.userRoles.map((r) => r.role.name).join(", ") || "no role"}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </main>
  );
}
