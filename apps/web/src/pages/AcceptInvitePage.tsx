import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { acceptInvitation, ApiError } from "../lib/api";

export default function AcceptInvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await acceptInvitation({ token, fullName, password });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not accept invitation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-bold">Accept your invitation</h1>

      {!token && (
        <p className="text-sm text-red-700">Missing invitation token in the link.</p>
      )}

      {done ? (
        <div className="rounded border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          Your account is ready.{" "}
          <Link to="/login" className="font-medium underline">
            Sign in
          </Link>
          .
        </div>
      ) : (
        token && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <p className="text-sm text-gray-600">
              Set your name and password to activate your client-portal account.
            </p>
            {error && (
              <div className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <label className="block">
              <span className="text-sm font-medium">Full name</span>
              <input
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium">Password (min 8 chars)</span>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-3 py-2"
                autoComplete="new-password"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded bg-gray-900 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              {busy ? "Creating account…" : "Activate account"}
            </button>
          </form>
        )
      )}
    </div>
  );
}
