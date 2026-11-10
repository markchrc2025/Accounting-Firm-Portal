// RepoKitPanel - "Connect a code repository" on a project's overview (PB3). The Portal makes the
// few files a repository needs so Claude Code can work on this project (which project it is, the
// MCP server, a start-of-session hook, a CLAUDE.md block). The kit holds no secret: it only names
// the environment variable the person puts their own token in. Each file has a Copy button, and
// all of them can be downloaded as one zip (made in the browser, no library).

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Skeleton,
} from "../../components/ui";
import { CopyButton } from "../../components/projects/CopyButton";
import { ErrorBanner } from "../../components/projects/parts";
import { downloadZip } from "../../lib/zip";
import { errorLines, fetchRepoKit } from "../../lib/projects";

export function RepoKitPanel({ projectKey }: { projectKey: string }) {
  const [open, setOpen] = useState(false);
  const kit = useQuery({
    queryKey: ["projects", "repo-kit", projectKey],
    queryFn: () => fetchRepoKit(projectKey),
    enabled: open,
    // a refusal (the address is not https, no access) is final: say it at once
    retry: false,
  });
  const envVar = kit.data?.tokenEnvVar;

  return (
    <Card data-repo-kit>
      <CardHeader>
        <CardTitle>Connect a code repository</CardTitle>
        <Link
          to="/profile/tokens#connect-claude"
          className="text-[12.5px] text-blue underline-offset-2 hover:underline"
        >
          Connect Claude help
        </Link>
      </CardHeader>
      <CardContent className="space-y-4 text-[13px]">
        <p className="text-content-secondary">
          Let Claude Code in your repository read this project, keep its issues current
          and note what it did and what comes next.
        </p>
        <ol className="list-decimal space-y-1 pl-5" data-repo-kit-steps>
          <li>
            Create a token on{" "}
            <Link
              to="/profile/tokens"
              className="text-blue underline-offset-2 hover:underline"
            >
              My API tokens
            </Link>
            .
          </li>
          <li>
            Put it in the environment variable{" "}
            <code className="font-mono">{envVar ?? "named in the files below"}</code> on
            your computer (never in the repository).
          </li>
          <li>Add these files to the repository and commit them.</li>
          <li>Open the repository in Claude Code.</li>
        </ol>

        {!open ? (
          <Button variant="outline" onClick={() => setOpen(true)}>
            Show the files
          </Button>
        ) : kit.isPending ? (
          <Skeleton />
        ) : kit.isError ? (
          <ErrorBanner lines={errorLines(kit.error, "Could not make the files.")} />
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="outline"
                onClick={() =>
                  downloadZip(`${kit.data.projectKey}-repo-kit.zip`, kit.data.files)
                }
              >
                Download all as a zip
              </Button>
              <span className="text-[12px] text-content-secondary">
                Made for {kit.data.serverUrl}. Unzip it in the root of the repository.
              </span>
            </div>
            <ul className="space-y-3" data-repo-kit-files>
              {kit.data.files.map((f) => (
                <li
                  key={f.path}
                  data-kit-file={f.path}
                  className="rounded-input border border-line"
                >
                  <div className="flex items-center justify-between gap-3 border-b border-line px-3 py-2">
                    <code className="break-all font-mono text-[12px] font-semibold text-navy">
                      {f.path}
                    </code>
                    <CopyButton text={f.content} what={`Copy ${f.path}`} />
                  </div>
                  <pre
                    tabIndex={0}
                    aria-label={`Contents of ${f.path}`}
                    className="max-h-64 overflow-auto whitespace-pre bg-paper px-3 py-2 font-mono text-[11.5px] leading-relaxed text-content"
                  >
                    {f.content}
                  </pre>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
