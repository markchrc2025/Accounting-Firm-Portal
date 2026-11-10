// GithubWebhookHelp - how to connect a GitHub repository to Projects (PB4, Track A PA4 / D68),
// shown to a Super Admin on the Projects settings page. The Portal never holds or shows the
// secret: it is the value set in the server's GITHUB_WEBHOOK_SECRET, and GitHub is given the same
// value when the webhook is made. The Payload URL is built from the API origin the web already uses.

import { apiOrigin } from "../../lib/api";
import { Card } from "../ui";
import { CopyButton } from "./CopyButton";

/** The webhook route, after the API origin (Track A PA4). */
export const GITHUB_WEBHOOK_PATH = "/api/v1/projects/github/webhook";
export const githubWebhookUrl = (origin: string): string => `${origin}${GITHUB_WEBHOOK_PATH}`;

export function GithubWebhookHelp({ origin = apiOrigin() }: { origin?: string }) {
  const url = githubWebhookUrl(origin);
  return (
    <section aria-labelledby="github-webhook-title" data-github-webhook>
      <h2
        id="github-webhook-title"
        className="mb-2 font-serif text-[19px] font-medium text-navy"
      >
        Connect GitHub
      </h2>
      <Card className="space-y-3 px-5 py-4 text-[13px] text-content">
        <p className="text-content-secondary">
          In the repository on GitHub, open Settings, Webhooks, Add webhook, and fill it in like
          this.
        </p>
        <dl className="grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2">
          <dt className="text-content-secondary">Payload URL</dt>
          <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <code
              data-webhook-url
              className="min-w-0 flex-1 break-all rounded-input bg-paper px-2.5 py-1.5 font-mono text-[12px]"
            >
              {url}
            </code>
            <CopyButton text={url} what="Copy the payload URL" />
          </dd>
          <dt className="text-content-secondary">Content type</dt>
          <dd>
            <code className="font-mono text-[12px]">application/json</code>
          </dd>
          <dt className="text-content-secondary">Secret</dt>
          <dd data-webhook-secret>
            The value set in the server&apos;s{" "}
            <code className="font-mono text-[12px]">GITHUB_WEBHOOK_SECRET</code>. The Portal never
            shows it.
          </dd>
          <dt className="text-content-secondary">Events</dt>
          <dd>Pull requests and Pushes.</dd>
        </dl>
        <p className="border-t border-line pt-3" data-webhook-rules>
          Put an issue key such as PAY-12 in branch names, commits and PR titles. A merged PR whose
          description says fixes PAY-12 closes it. The project&apos;s repository URL must match the
          repository.
        </p>
      </Card>
    </section>
  );
}
