import { useQuery } from "@tanstack/react-query";
import { OAUTH_SCOPES, VatClass } from "@portal/shared";
import { fetchHealth } from "./lib/api";

/**
 * Phase 0 home page. Renders values imported directly from @portal/shared to
 * prove the workspace link is live on the web side, and pings the API health
 * endpoint via TanStack Query to prove end-to-end wiring.
 */
export default function App(): JSX.Element {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    retry: false,
  });

  return (
    <main className="mx-auto max-w-3xl px-6 py-12 font-sans">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Accounting Firm Portal</h1>
        <p className="mt-1 text-gray-600">
          Phase 0 scaffold — monorepo, shared contract, and health check wired up.
        </p>
      </header>

      <section className="mb-8 rounded-lg border border-gray-200 p-5">
        <h2 className="mb-2 text-lg font-semibold">API health</h2>
        {health.isPending && <p className="text-gray-500">Checking…</p>}
        {health.isError && (
          <p className="text-amber-700">
            API not reachable ({String(health.error)}). Start it with{" "}
            <code className="rounded bg-gray-100 px-1">pnpm --filter api dev</code>.
          </p>
        )}
        {health.data && (
          <p className="text-green-700">
            {health.data.service} v{health.data.version} — {health.data.status}
          </p>
        )}
      </section>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-gray-200 p-5">
          <h2 className="mb-2 text-lg font-semibold">
            VAT classes{" "}
            <span className="text-xs font-normal text-gray-500">
              (from @portal/shared)
            </span>
          </h2>
          <ul className="list-inside list-disc text-sm text-gray-700">
            {VatClass.options.map((vc) => (
              <li key={vc}>{vc}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-gray-200 p-5">
          <h2 className="mb-2 text-lg font-semibold">
            Integration scopes{" "}
            <span className="text-xs font-normal text-gray-500">
              (from @portal/shared)
            </span>
          </h2>
          <ul className="list-inside list-disc text-sm text-gray-700">
            {OAUTH_SCOPES.map((scope) => (
              <li key={scope}>{scope}</li>
            ))}
          </ul>
        </div>
      </section>
    </main>
  );
}
