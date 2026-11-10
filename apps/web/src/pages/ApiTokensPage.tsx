// ApiTokensPage - "My API tokens" (PB3), reached from the profile page. A person makes a token to
// let Claude Code, a script or a claude.ai connector act as them in Projects. The token is shown
// once, right after it is made, in a box with a Copy button; it is held only in this page's own
// state and is gone when the box is closed or the page is left. Revoking asks first. A Super Admin
// also sees every token of the firm, with its owner, and can revoke (never see) any of them.

import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useLocation, useSearchParams } from "react-router-dom";
import { apiOrigin } from "../lib/api";
import {
  createApiToken,
  fetchFirmTokens,
  fetchMyTokens,
  revokeApiToken,
  TOKEN_SCOPES,
  tokenScopeLabel,
  type ApiToken,
  type CreatedApiToken,
  type FirmApiToken,
  type TokenScope,
} from "../lib/apiTokens";
import {
  CAPABILITY_WARNING,
  capabilityAddress,
  TOKEN_ONCE_WARNING,
} from "../lib/connectClaude";
import { errorLines, momentText } from "../lib/projects";
import { useAuth } from "../auth/AuthContext";
import { useConfirmAction } from "../components/useConfirmAction";
import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  cn,
} from "../components/ui";
import { ConnectClaudeHelp } from "../components/projects/ConnectClaudeHelp";
import { CopyButton } from "../components/projects/CopyButton";
import { ErrorBanner, Field, Modal, SuccessBanner } from "../components/projects/parts";

/** Super Admin only: the role that holds IntegrationClient:Update (the same test the Portal uses elsewhere). */
function useIsSuperAdmin(): boolean {
  return useAuth().hasPermission("IntegrationClient:Update");
}

type Tab = "mine" | "firm";

export default function ApiTokensPage() {
  const { user } = useAuth();
  const superAdmin = useIsSuperAdmin();
  const [sp, setSp] = useSearchParams();
  const tab: Tab = superAdmin && sp.get("tab") === "firm" ? "firm" : "mine";
  const [notice, setNotice] = useState<string | null>(null);
  // The one time a token is shown. Held here and nowhere else.
  const [fresh, setFresh] = useState<CreatedApiToken | null>(null);
  const [creating, setCreating] = useState(false);
  const { ask, dialog } = useConfirmAction();
  const qc = useQueryClient();
  const { hash } = useLocation();
  // The repo kit links to the Connect Claude help (#connect-claude): bring it into view.
  useEffect(() => {
    if (hash === "#connect-claude") {
      document.getElementById("connect-claude")?.scrollIntoView?.({ block: "start" });
    }
  }, [hash]);

  // Tokens are for firm users; a client user has none to make.
  if (user && user.userType !== "FIRM") return <Navigate to="/profile" replace />;

  function revoke(t: ApiToken, whose?: string) {
    ask({
      question: whose
        ? `Revoke the token “${t.name}” of ${whose}? Anything using it stops working at once.`
        : `Revoke the token “${t.name}”? Anything using it stops working at once.`,
      confirmLabel: "Revoke",
      action: async () => {
        await revokeApiToken(t.id);
        await qc.invalidateQueries({ queryKey: ["api-tokens"] });
        setNotice(`Token “${t.name}” revoked.`);
      },
      failure: "Could not revoke the token.",
    });
  }

  return (
    <div className="max-w-[980px] animate-fade-rise">
      <PageHeader
        eyebrow="YOUR ACCOUNT"
        title="My API tokens"
        description="A token lets Claude Code, a script or a Claude connector act as you in Projects, with your permissions."
        actions={
          <>
            <Link
              to="/profile"
              className="text-[13px] text-blue underline-offset-2 hover:underline"
            >
              Back to your profile
            </Link>
            {tab === "mine" ? (
              <Button onClick={() => setCreating(true)}>Create token</Button>
            ) : null}
          </>
        }
      />
      {notice ? <SuccessBanner className="mb-4">{notice}</SuccessBanner> : null}

      {fresh ? <FreshToken token={fresh} onClose={() => setFresh(null)} /> : null}

      {superAdmin ? (
        <div
          role="tablist"
          aria-label="Tokens"
          className="mb-4 flex gap-1 border-b border-line"
        >
          {(
            [
              ["mine", "My tokens"],
              ["firm", "Firm tokens"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => {
                setNotice(null);
                const next = new URLSearchParams(sp);
                if (id === "firm") next.set("tab", "firm");
                else next.delete("tab");
                setSp(next, { replace: true });
              }}
              className={cn(
                "-mb-px border-b-2 px-3.5 py-2 text-[13.5px] font-medium transition-colors",
                tab === id
                  ? "border-gold text-navy"
                  : "border-transparent text-content-secondary hover:text-navy",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {tab === "mine" ? (
        <MyTokens onRevoke={(t) => revoke(t)} />
      ) : (
        <FirmTokens onRevoke={(t) => revoke(t, t.owner.fullName)} />
      )}

      <div className="mt-8">
        <ConnectClaudeHelp />
      </div>

      {creating ? (
        <CreateDialog
          onClose={() => setCreating(false)}
          onCreated={(t) => {
            setCreating(false);
            setNotice(null);
            setFresh(t);
            void qc.invalidateQueries({ queryKey: ["api-tokens"] });
          }}
        />
      ) : null}
      {dialog}
    </div>
  );
}

// --- the box that shows a new token once ---------------------------------------------------------

function FreshToken({ token, onClose }: { token: CreatedApiToken; onClose: () => void }) {
  return (
    <Card
      role="region"
      aria-label="New token"
      data-fresh-token
      className="mb-5 border-gold px-5 py-4"
    >
      <h2 className="font-serif text-[17px] font-medium text-navy">
        Your new token: {token.name}
      </h2>
      <p
        role="alert"
        data-token-warning
        className="mt-2 rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-[13px] font-semibold text-danger-ink"
      >
        {TOKEN_ONCE_WARNING}
      </p>
      <div className="mt-3 space-y-3 text-[13px]">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <code
            data-token-value
            aria-label="The token"
            className="min-w-0 flex-1 select-all break-all rounded-input bg-paper px-2.5 py-2 font-mono text-[12.5px] text-content"
          >
            {token.token}
          </code>
          <CopyButton text={token.token} label="Copy" what="Copy the token" />
        </div>
        <div className="border-t border-line pt-3">
          <p className="mb-1.5 text-content-secondary">
            For a claude.ai custom connector, the address with this token in it:
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <code
              data-token-address
              className="min-w-0 flex-1 break-all rounded-input bg-paper px-2.5 py-2 font-mono text-[12px] text-content"
            >
              {capabilityAddress(apiOrigin(), token.token)}
            </code>
            <CopyButton
              text={capabilityAddress(apiOrigin(), token.token)}
              label="Copy"
              what="Copy the address"
            />
          </div>
          <p className="mt-1.5 font-semibold text-danger-ink">{CAPABILITY_WARNING}</p>
        </div>
      </div>
      <div className="mt-4">
        <Button variant="outline" onClick={onClose}>
          I have copied it
        </Button>
      </div>
    </Card>
  );
}

// --- making a token --------------------------------------------------------------------------------

function CreateDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (t: CreatedApiToken) => void;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<TokenScope>("read");
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Not a mutation hook: the answer holds the token, and a mutation would keep it in the cache.
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    setBusy(true);
    try {
      onCreated(await createApiToken({ name, scope }));
    } catch (err) {
      setErrors(errorLines(err, "Could not make the token."));
      setBusy(false);
    }
  }
  return (
    <Modal title="Create token" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner lines={errors} />
        <Field
          label="Name"
          hint="So you can tell your tokens apart, for example Claude Code laptop."
        >
          <input
            className="input"
            autoFocus
            value={name}
            maxLength={100}
            placeholder="Claude Code laptop"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <fieldset>
          <legend className="mb-1.5 text-[13px] font-semibold text-content">
            What it may do
          </legend>
          <div className="space-y-1.5 text-[13px]">
            {TOKEN_SCOPES.map((s) => (
              <label key={s} className="flex items-start gap-2">
                <input
                  type="radio"
                  name="scope"
                  className="mt-1"
                  checked={scope === s}
                  onChange={() => setScope(s)}
                />
                <span>
                  <span className="font-semibold">{tokenScopeLabel(s)}</span>
                  <span className="block text-[12px] text-content-secondary">
                    {s === "read"
                      ? "Look at projects, issues and activity. Change nothing."
                      : "Also create and change issues, milestones and comments, as far as your own role allows."}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Creating…" : "Create token"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

// --- the lists -----------------------------------------------------------------------------------------

function StatusCell({ t }: { t: ApiToken }) {
  return t.revokedAt ? (
    <span data-revoked className="inline-flex flex-col gap-0.5">
      <Chip variant="danger">Revoked</Chip>
      <span className="font-mono text-[10.5px] text-content-secondary">
        {momentText(t.revokedAt)}
      </span>
    </span>
  ) : (
    <Chip variant="success">Active</Chip>
  );
}

function TokenTable({
  rows,
  onRevoke,
  owners,
}: {
  rows: Array<ApiToken | FirmApiToken>;
  onRevoke: (t: ApiToken & { owner?: FirmApiToken["owner"] }) => void;
  owners?: boolean;
}) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-left text-[13px]" data-token-table>
        <thead>
          <tr className="border-b border-line font-mono text-[10px] uppercase tracking-[.12em] text-content-secondary">
            {owners ? <th className="px-4 py-3 font-medium">Owner</th> : null}
            <th className="px-4 py-3 font-medium">Name</th>
            <th className="px-3 py-3 font-medium">Token starts</th>
            <th className="px-3 py-3 font-medium">May do</th>
            <th className="px-3 py-3 font-medium">Last used</th>
            <th className="px-3 py-3 font-medium">Created</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-3 py-3 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const owner = "owner" in t ? t.owner : undefined;
            return (
              <tr
                key={t.id}
                data-token={t.id}
                className={cn(
                  "border-b border-line last:border-0",
                  t.revokedAt ? "opacity-60" : "",
                )}
              >
                {owners ? (
                  <td className="px-4 py-3" data-owner>
                    <div className="font-semibold text-content">{owner?.fullName}</div>
                    <div className="text-[11.5px] text-content-secondary">
                      {owner?.email}
                    </div>
                  </td>
                ) : null}
                <td className="px-4 py-3 font-semibold text-navy">{t.name}</td>
                <td className="px-3 py-3 font-mono text-[12px]">{t.prefix}…</td>
                <td className="px-3 py-3">{tokenScopeLabel(t.scope)}</td>
                <td className="px-3 py-3 font-mono text-[11.5px]" data-last-used>
                  {t.lastUsedAt ? momentText(t.lastUsedAt) : "Never used"}
                </td>
                <td className="px-3 py-3 font-mono text-[11.5px]">
                  {momentText(t.createdAt)}
                </td>
                <td className="px-3 py-3">
                  <StatusCell t={t} />
                </td>
                <td className="px-3 py-3 text-right">
                  {t.revokedAt ? null : (
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Revoke ${t.name}`}
                      onClick={() => onRevoke({ ...t, owner })}
                    >
                      Revoke
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function MyTokens({ onRevoke }: { onRevoke: (t: ApiToken) => void }) {
  const q = useQuery({
    queryKey: ["api-tokens", "mine"],
    queryFn: fetchMyTokens,
    retry: false,
  });
  if (q.isPending) return <Skeleton />;
  if (q.isError) {
    return (
      <>
        <ErrorBanner lines={errorLines(q.error)} className="mb-3" />
        <ErrorState
          message="Could not load your tokens."
          onRetry={() => void q.refetch()}
        />
      </>
    );
  }
  if (q.data.items.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No tokens yet"
          description="Create a token to connect Claude Code or a Claude connector to Projects."
        />
      </Card>
    );
  }
  return <TokenTable rows={q.data.items} onRevoke={onRevoke} />;
}

function FirmTokens({ onRevoke }: { onRevoke: (t: FirmApiToken) => void }) {
  const q = useQuery({
    queryKey: ["api-tokens", "firm"],
    queryFn: fetchFirmTokens,
    retry: false,
  });
  if (q.isPending) return <Skeleton />;
  if (q.isError) {
    return (
      <>
        <ErrorBanner lines={errorLines(q.error)} className="mb-3" />
        <ErrorState
          message="Could not load the firm's tokens."
          onRetry={() => void q.refetch()}
        />
      </>
    );
  }
  if (q.data.items.length === 0) {
    return (
      <Card>
        <EmptyState title="No tokens in the firm" />
      </Card>
    );
  }
  return (
    <TokenTable
      owners
      rows={q.data.items}
      onRevoke={(t) => onRevoke(t as FirmApiToken)}
    />
  );
}
