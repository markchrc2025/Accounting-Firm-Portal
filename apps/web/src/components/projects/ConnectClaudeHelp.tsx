// ConnectClaudeHelp - how to point Claude at the Portal's Projects (PB3): Claude Code (an address
// and a header that reads the token from an environment variable) and a claude.ai custom connector
// (an address that holds the token). The addresses are built from the API origin this web app
// already uses. No token appears here; the help shows where it goes.

import { apiOrigin } from "../../lib/api";
import {
  bearerHeader,
  CAPABILITY_WARNING,
  capabilityAddress,
  claudeCodeAddress,
  TOKEN_ENV_VAR,
  TOKEN_PLACEHOLDER,
} from "../../lib/connectClaude";
import { Card } from "../ui";
import { CopyButton } from "./CopyButton";

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="w-24 flex-none text-[12px] text-content-secondary">{label}</span>
      <code
        data-connect-line={label}
        className="min-w-0 flex-1 break-all rounded-input bg-paper px-2.5 py-1.5 font-mono text-[12px] text-content"
      >
        {value}
      </code>
      <CopyButton text={value} what={`Copy the ${label.toLowerCase()}`} />
    </div>
  );
}

export function ConnectClaudeHelp({
  origin = apiOrigin(),
  envVar = TOKEN_ENV_VAR,
}: {
  origin?: string;
  envVar?: string;
}) {
  return (
    <section
      id="connect-claude"
      aria-labelledby="connect-claude-title"
      data-connect-claude
    >
      <h2
        id="connect-claude-title"
        className="mb-2 font-serif text-[19px] font-medium text-navy"
      >
        Connect Claude
      </h2>
      <Card className="space-y-6 px-5 py-4 text-[13px] text-content">
        <div className="space-y-2.5">
          <h3 className="font-semibold text-navy">Claude Code</h3>
          <p className="text-content-secondary">
            Add the Portal as an MCP server. Claude Code sends your token in a header and
            reads it from the environment variable{" "}
            <code className="font-mono">{envVar}</code> on your computer, so the token is
            never written into a file.
          </p>
          <Line label="Address" value={claudeCodeAddress(origin)} />
          <Line label="Header" value={bearerHeader(envVar)} />
        </div>
        <div className="space-y-2.5 border-t border-line pt-4">
          <h3 className="font-semibold text-navy">claude.ai custom connector</h3>
          <p className="text-content-secondary">
            A custom connector has no header to fill in, so its address holds the token.
            Replace <code className="font-mono">{TOKEN_PLACEHOLDER}</code> with a token
            you made.
          </p>
          <Line label="Address" value={capabilityAddress(origin)} />
          <p
            role="note"
            data-capability-warning
            className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 font-semibold text-danger-ink"
          >
            {CAPABILITY_WARNING}
          </p>
        </div>
      </Card>
    </section>
  );
}
