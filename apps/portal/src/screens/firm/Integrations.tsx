/**
 * Screen 18 — Integration credentials (Super Admin).
 *
 * OAuth2 client-credentials cards for machine-to-machine integrations (the BIR
 * Form Generator + a disabled staging integration). Secrets never round-trip to
 * the browser beyond a single "Reveal once" disclosure held in in-session state:
 * once an integration's secret has been revealed it stays revealed for the
 * session and the button is spent (disabled). Disabled integrations render dimmed
 * with their actions inert.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Copy, Eye, KeyRound, RefreshCw, ShieldOff } from "lucide-react";

import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
} from "@/components/ui";
import { api } from "@/mock";
import type { IntegrationClient } from "@/types";
import { cn } from "@/lib/utils";

/** Copy text to the clipboard, swallowing the failure if the API is unavailable. */
async function copyToClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    // Clipboard access can be denied (insecure context / permissions); ignore.
  }
}

function IntegrationCard({
  integration,
  revealed,
  onReveal,
}: {
  integration: IntegrationClient;
  revealed: boolean;
  onReveal: (id: string) => void;
}): React.JSX.Element {
  const disabled = integration.status === "Disabled";

  return (
    <Card className={cn("overflow-hidden", disabled && "opacity-60")}>
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-line px-6 py-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-btn bg-navy text-gold-soft">
          <KeyRound className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-serif text-[15px] font-medium text-navy">
              {integration.name}
            </h3>
            <StatusChip
              label={integration.status}
              variant={disabled ? "neutral" : "success"}
            />
          </div>
          <div className="mt-1 font-mono text-[11px] text-content-tertiary">
            {integration.lastUsed
              ? `Last used ${integration.lastUsed}`
              : "Never used"}
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
            <Button
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => void copyToClipboard(integration.clientKey)}
              aria-label={`Copy client key for ${integration.name}`}
            >
              <Copy className="h-4 w-4" aria-hidden="true" />
              Copy
            </Button>
          </div>
        </div>

        {/* Client secret */}
        <div>
          <div className="eyebrow mb-1.5">Client secret</div>
          {revealed ? (
            <div className="rounded-input border border-line-strong bg-warn-bg-2 px-3 py-2.5">
              <code className="block break-all font-mono text-[12.5px] text-gold-deep">
                {integration.clientSecret}
              </code>
              <div className="mt-1.5 font-mono text-[11px] text-content-tertiary">
                Shown once — store it now
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 rounded-input border border-line bg-sidebar px-3 py-2 font-mono text-[12.5px] tracking-widest text-content-muted">
                ••••••••••••
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={() => onReveal(integration.id)}
                aria-label={`Reveal client secret for ${integration.name} once`}
              >
                <Eye className="h-4 w-4" aria-hidden="true" />
                Reveal once
              </Button>
            </div>
          )}
        </div>

        {/* Scopes */}
        <div>
          <div className="eyebrow mb-1.5">Granted scopes</div>
          <div className="flex flex-wrap gap-1.5">
            {integration.scopes.map((scope) => (
              <Chip key={scope} variant="neutral" size="md">
                {scope}
              </Chip>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-t border-line px-6 py-4">
        <Button variant="outline" size="sm" disabled={disabled}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Rotate secret
        </Button>
        <Button variant="danger" size="sm" disabled={disabled}>
          <ShieldOff className="h-4 w-4" aria-hidden="true" />
          Revoke access
        </Button>
      </div>
    </Card>
  );
}

export function IntegrationsScreen(): React.JSX.Element {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["integrations"],
    queryFn: () => api.getIntegrations(),
  });

  const [revealed, setRevealed] = React.useState<Set<string>>(new Set());

  function reveal(id: string): void {
    setRevealed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  const header = <PageHeader title="Integrations" eyebrow="Firm admin" />;

  let body: React.JSX.Element;
  if (isLoading) {
    body = (
      <div className="space-y-6">
        {[0, 1].map((i) => (
          <Card key={i} className="overflow-hidden p-6">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="mt-4 h-10 w-full" />
            <Skeleton className="mt-3 h-10 w-full" />
          </Card>
        ))}
      </div>
    );
  } else if (isError) {
    body = (
      <Card>
        <ErrorState
          message="Couldn't load integrations."
          onRetry={() => void refetch()}
        />
      </Card>
    );
  } else if ((data ?? []).length === 0) {
    body = (
      <Card>
        <EmptyState
          title="No integrations configured"
          description="Machine-to-machine integrations (like the BIR Form Generator) will appear here once registered."
        />
      </Card>
    );
  } else {
    body = (
      <div className="space-y-6">
        {(data ?? []).map((integration) => (
          <IntegrationCard
            key={integration.id}
            integration={integration}
            revealed={revealed.has(integration.id)}
            onReveal={reveal}
          />
        ))}
      </div>
    );
  }

  return (
    <>
      {header}
      {body}
    </>
  );
}
