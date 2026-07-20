import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { OAUTH_SCOPES } from "@portal/shared";
import {
  ApiError,
  createIntegration,
  disableMcpConnector,
  fetchIntegrations,
  fetchMcpConnector,
  mcpConnectorUrl,
  revokeIntegration,
  rotateIntegrationSecret,
  rotateMcpConnector,
} from "../lib/api";
import type { Integration, IntegrationReveal, McpConnector } from "../lib/api";
import { useAuth } from "../auth/AuthContext";
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

/** ACTIVE clients read as success; disabled ones fade to neutral. */
function isActive(status: string): boolean {
  return status.trim().toUpperCase() === "ACTIVE";
}

export default function IntegrationsPage() {
  const { hasPermission } = useAuth();
  const canCreate = hasPermission("IntegrationClient:Create");
  const canUpdate = hasPermission("IntegrationClient:Update");
  const canDelete = hasPermission("IntegrationClient:Delete");

  const integrations = useQuery({
    queryKey: ["integrations"],
    queryFn: () => fetchIntegrations(),
  });

  const [createOpen, setCreateOpen] = useState(false);

  // Reveal-once model: secrets are never returned by GET, so a just-revealed
  // plaintext is held only in local memory, keyed by integration id. It is
  // populated exclusively by the create/rotate mutation responses (the only
  // moments the API discloses a secret) and is never fabricated.
  const [revealed, setRevealed] = useState<Map<string, string>>(new Map());
  function rememberSecret(reveal: IntegrationReveal) {
    setRevealed((prev) => {
      const next = new Map(prev);
      next.set(reveal.id, reveal.clientSecret);
      return next;
    });
  }

  return (
    <div className="animate-fade-rise">
      <PageHeader
        title="Integration Credentials"
        eyebrow="FIRM ADMIN"
        description="Machine-to-machine OAuth2 clients (e.g. the BIR Form Generator)."
        actions={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>New integration</Button>
          ) : undefined
        }
      />

      {/* Claude connector — Super Admin only (the API 403s everyone else, and
          only Super Admin holds IntegrationClient:Update). */}
      {canUpdate && <McpConnectorCard />}

      {integrations.isPending && (
        <div className="space-y-6">
          {[0, 1].map((i) => (
            <Card key={i}>
              <div className="space-y-4 px-6 py-5">
                <Skeleton className="h-6 w-56" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-6 w-2/3" />
              </div>
            </Card>
          ))}
        </div>
      )}

      {integrations.isError && (
        <Card>
          <ErrorState
            message="Could not load integration credentials."
            onRetry={() => void integrations.refetch()}
          />
        </Card>
      )}

      {integrations.data && integrations.data.length === 0 && (
        <Card>
          <EmptyState
            title="No integrations yet"
            description="Machine-to-machine OAuth2 clients (like the BIR Form Generator) will appear here once registered. Each one gets a client key and a secret shown only once at creation."
          >
            {canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>New integration</Button>
            ) : null}
          </EmptyState>
        </Card>
      )}

      {integrations.data && integrations.data.length > 0 && (
        <div className="space-y-6">
          {integrations.data.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              revealedSecret={revealed.get(integration.id) ?? null}
              onRevealSecret={rememberSecret}
              canUpdate={canUpdate}
              canDelete={canDelete}
            />
          ))}
        </div>
      )}

      {createOpen && (
        <CreateIntegrationModal
          onClose={() => setCreateOpen(false)}
          onRevealSecret={rememberSecret}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------- Claude (MCP) card */

/**
 * The Claude connector's capability URL. The secret IS the access grant:
 * anyone with the full link can read and write portal data, so it renders
 * masked with an explicit reveal, and rotation kills the old link instantly.
 */
function McpConnectorCard() {
  const qc = useQueryClient();
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connector = useQuery({
    queryKey: ["mcp-connector"],
    queryFn: () => fetchMcpConnector(),
  });

  function onDone(next: McpConnector) {
    setError(null);
    qc.setQueryData(["mcp-connector"], next);
    setShow(next.enabled); // show the fresh link right away after a rotate
  }
  const rotate = useMutation({
    mutationFn: () => rotateMcpConnector(),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not rotate the link."),
  });
  const disable = useMutation({
    mutationFn: () => disableMcpConnector(),
    onSuccess: onDone,
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : "Could not turn the connector off."),
  });
  const busy = rotate.isPending || disable.isPending;

  const data = connector.data;
  const url = data?.secret ? mcpConnectorUrl(data.secret) : null;
  const maskedUrl = data?.secret
    ? mcpConnectorUrl(`${data.secret.slice(0, 4)}…${data.secret.slice(-4)}`)
    : null;

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Copy failed — reveal the link and copy it manually.");
    }
  }

  function confirmRotate() {
    const started = data?.enabled
      ? "This mints a NEW link and the current one stops working immediately — anyone using it (including Claude) must be given the new link.\n\nRotate now?"
      : "This creates the connector link. Anyone holding it can read AND write portal data.\n\nCreate it?";
    if (window.confirm(started)) rotate.mutate();
  }
  function confirmDisable() {
    if (
      window.confirm(
        "Turn the Claude connector OFF? The link stops working immediately. You can re-enable it later by rotating (which mints a new link).",
      )
    ) {
      disable.mutate();
    }
  }

  return (
    <Card className="mb-6">
      <div className="space-y-4 px-6 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 className="font-serif text-[17px] font-medium text-navy">
                Claude Connector (MCP)
              </h2>
              {connector.isSuccess &&
                (data?.enabled ? (
                  <Chip variant="success">Active</Chip>
                ) : (
                  <Chip variant="neutral">Off</Chip>
                ))}
            </div>
            <p className="mt-1 text-[12.5px] text-content-secondary">
              Connect Claude (claude.ai → Settings → Connectors) to the firm&apos;s books.
              The link is the key: <span className="font-semibold">anyone you share it
              with can read and write portal data</span> — rotate it to cut off every
              copy at once.
            </p>
          </div>
          <div className="flex flex-none gap-2">
            <Button size="sm" disabled={busy || connector.isPending} onClick={confirmRotate}>
              {rotate.isPending
                ? "Rotating…"
                : data?.enabled
                  ? "Rotate link"
                  : "Create link"}
            </Button>
            {data?.enabled && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={confirmDisable}>
                {disable.isPending ? "Turning off…" : "Turn off"}
              </Button>
            )}
          </div>
        </div>

        {connector.isPending && <Skeleton className="h-10 w-full" />}
        {connector.isError && (
          <p className="text-[13px] text-content-secondary">
            Could not load the connector status.
          </p>
        )}

        {data?.enabled && (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-input border border-line-input bg-paper px-3 py-2 font-mono text-[12px] text-content">
              {show ? url : maskedUrl}
            </code>
            <Button variant="outline" size="sm" onClick={() => setShow((v) => !v)}>
              {show ? "Hide" : "Reveal"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void copy()}>
              {copied ? "Copied ✓" : "Copy link"}
            </Button>
          </div>
        )}

        {data?.enabled && data.source === "environment" && (
          <p className="text-[12px] text-content-muted">
            This link still comes from the server&apos;s MCP_SHARED_SECRET variable. The
            first rotation switches it to a portal-managed secret (after that, the env
            var is ignored and can be removed).
          </p>
        )}

        {error && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-[13px] text-danger-ink">
            {error}
          </div>
        )}
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------ Integration card */

function IntegrationCard({
  integration,
  revealedSecret,
  onRevealSecret,
  canUpdate,
  canDelete,
}: {
  integration: Integration;
  revealedSecret: string | null;
  onRevealSecret: (reveal: IntegrationReveal) => void;
  canUpdate: boolean;
  canDelete: boolean;
}) {
  const qc = useQueryClient();
  const active = isActive(integration.status);

  const rotate = useMutation({
    mutationFn: () => rotateIntegrationSecret(integration.id),
    onSuccess: (reveal) => {
      onRevealSecret(reveal);
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });

  const revoke = useMutation({
    mutationFn: () => revokeIntegration(integration.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["integrations"] });
    },
  });

  function handleRevoke() {
    if (
      window.confirm(
        `Revoke access for "${integration.name}"? Its client key and secret will stop working immediately.`,
      )
    ) {
      revoke.mutate();
    }
  }

  return (
    <Card className={cn("overflow-hidden", !active && "opacity-70")}>
      {/* Header: name + status + last-used */}
      <div className="flex items-start justify-between gap-3 border-b border-line px-6 py-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-btn bg-navy font-mono text-[15px] font-semibold text-gold-soft">
            {integration.name.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-serif text-[16px] font-medium text-navy">
                {integration.name}
              </h3>
              <Chip variant={active ? "success" : "neutral"}>{integration.status}</Chip>
            </div>
            <div className="mt-1 font-mono text-[11px] text-content-tertiary">
              {integration.lastUsedAt
                ? `Last used ${integration.lastUsedAt}`
                : "Never used"}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-5 px-6 py-5">
        {/* Client key */}
        <div>
          <div className="eyebrow mb-1.5">Client key</div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-input border border-line bg-sidebar px-3 py-2 font-mono text-[12.5px] text-content">
              {integration.clientKey}
            </code>
            <CopyButton
              value={integration.clientKey}
              ariaLabel={`Copy client key for ${integration.name}`}
            />
          </div>
        </div>

        {/* Client secret — reveal-once */}
        <div>
          <div className="eyebrow mb-1.5">Client secret</div>
          {revealedSecret != null ? (
            <div className="rounded-input border border-line-strong bg-warn-bg-2 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <code className="min-w-0 flex-1 break-all font-mono text-[12.5px] text-gold-deep">
                  {revealedSecret}
                </code>
                <CopyButton
                  value={revealedSecret}
                  ariaLabel={`Copy client secret for ${integration.name}`}
                />
              </div>
              <div className="mt-1.5 font-mono text-[11px] text-content-tertiary">
                Shown once — store it now
              </div>
            </div>
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 rounded-input border border-line bg-sidebar px-3 py-2 font-mono text-[12.5px] tracking-widest text-content-muted">
                  ••••••••••••
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled
                  aria-label={`Reveal client secret for ${integration.name}`}
                >
                  Reveal once
                </Button>
              </div>
              <p className="mt-1.5 font-mono text-[11px] text-content-tertiary">
                Available only at creation or rotation.
              </p>
            </div>
          )}
        </div>

        {/* Granted scopes */}
        <div>
          <div className="eyebrow mb-1.5">Granted scopes</div>
          {integration.scopes.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {integration.scopes.map((scope) => (
                <Chip key={scope} variant="info">
                  {scope}
                </Chip>
              ))}
            </div>
          ) : (
            <span className="text-[13px] text-content-muted">No scopes granted</span>
          )}
        </div>
      </div>

      {/* Actions */}
      {(canUpdate || (canDelete && active)) && (
        <div className="flex items-center gap-2 border-t border-line px-6 py-4">
          {canUpdate && (
            <Button
              variant="outline"
              size="sm"
              disabled={rotate.isPending || revoke.isPending}
              onClick={() => rotate.mutate()}
            >
              {rotate.isPending ? "Rotating…" : "Rotate secret"}
            </Button>
          )}
          {canDelete && active && (
            <Button
              variant="danger"
              size="sm"
              disabled={revoke.isPending || rotate.isPending}
              onClick={handleRevoke}
            >
              {revoke.isPending ? "Revoking…" : "Revoke access"}
            </Button>
          )}
        </div>
      )}

      {(rotate.isError || revoke.isError) && (
        <div className="border-t border-line px-6 py-3">
          <p className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2 text-[12.5px] text-danger-ink">
            {rotate.isError
              ? "Could not rotate the secret. Try again."
              : "Could not revoke access. Try again."}
          </p>
        </div>
      )}
    </Card>
  );
}

/* --------------------------------------------------------------- Copy button */

/** Copies `value` to the clipboard and flashes a transient "Copied" label. */
function CopyButton({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied (insecure context / permissions); ignore.
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="flex-none"
      onClick={() => void handleCopy()}
      aria-label={ariaLabel}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

/* ---------------------------------------------------------------- Create modal */

function CreateIntegrationModal({
  onClose,
  onRevealSecret,
}: {
  onClose: () => void;
  onRevealSecret: (reveal: IntegrationReveal) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const mutation = useMutation({
    mutationFn: (body: { name: string; scopes: string[] }) => createIntegration(body),
    onSuccess: (reveal) => {
      onRevealSecret(reveal);
      void qc.invalidateQueries({ queryKey: ["integrations"] });
      onClose();
    },
  });

  function toggleScope(scope: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(scope)) next.delete(scope);
      else next.add(scope);
      return next;
    });
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    // Preserve the canonical scope order from the frozen shared enum.
    const scopes = OAUTH_SCOPES.filter((s) => selected.has(s));
    mutation.mutate({ name: name.trim(), scopes });
  }

  const canSave = name.trim().length > 0 && selected.size > 0 && !mutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(14,33,44,0.45)] p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New integration"
        className="flex max-h-[90vh] w-full max-w-[520px] animate-fade-rise flex-col overflow-hidden rounded-modal bg-card shadow-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex flex-none items-center justify-between gap-3 border-b border-line px-6 py-4">
          <h2 className="font-serif text-[19px] font-medium text-navy">New integration</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="flex h-8 w-8 flex-none items-center justify-center rounded-btn border border-line-strong bg-card text-lg leading-none text-content-secondary transition-colors hover:border-navy hover:text-navy"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Scrollable body */}
          <div className="flex-1 space-y-4 overflow-auto px-6 py-5">
            {mutation.isError && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3.5 py-2.5 text-sm text-danger-ink">
                {mutation.error instanceof Error
                  ? mutation.error.message
                  : "Could not create this integration."}
              </div>
            )}

            <label className="block">
              <span className="text-[13px] font-semibold text-content">Name</span>
              <div className="mt-1.5">
                <input
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input"
                  placeholder="BIR Form Generator"
                />
              </div>
            </label>

            <div>
              <span className="text-[13px] font-semibold text-content">Granted scopes</span>
              <p className="mt-1 text-[12.5px] text-content-secondary">
                Grant only what the connector needs — the Portal still enforces
                per-client visibility.
              </p>
              <div className="mt-2 space-y-1.5 rounded-input border border-line-input bg-card p-3">
                {OAUTH_SCOPES.map((scope) => (
                  <label
                    key={scope}
                    className="flex items-center gap-2.5 rounded-[6px] px-1.5 py-1 text-[13px] text-content transition-colors hover:bg-rowhover"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(scope)}
                      onChange={() => toggleScope(scope)}
                    />
                    <span className="font-mono text-[12.5px]">{scope}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>

          {/* Sticky footer */}
          <div className="flex flex-none items-center justify-between gap-2 border-t border-line px-6 py-4">
            <span className="font-mono text-[11px] text-content-tertiary">
              {selected.size} scope{selected.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={!canSave}>
                {mutation.isPending ? "Creating…" : "Create integration"}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
