// GithubLinks - the pull requests and commits that name an issue (PB4, Track A PA4 / D68): what
// kind, the repository and number (or short commit id), the title, and whether it is open, closed,
// merged or pushed. Each opens GitHub in a new tab. The API sends them latest first; they are shown
// in that order. An address that is not a web address is shown as text, never as a link.

import { Chip } from "../ui";
import {
  githubRef,
  githubStateLabel,
  momentText,
  safeWebUrl,
  type GithubLink,
} from "../../lib/projects";

export function GithubLinks({ links }: { links: GithubLink[] }) {
  if (links.length === 0) return null;
  return (
    <div data-github-links>
      <span className="mb-1.5 block text-[13px] font-semibold text-content">GitHub</span>
      <ul className="divide-y divide-line rounded-input border border-line">
        {links.map((l) => {
          const href = safeWebUrl(l.url);
          const ref = githubRef(l);
          const state = githubStateLabel(l);
          return (
            <li
              key={l.url}
              data-github-link={l.url}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px]"
            >
              <Chip variant="neutral">{l.kind === "pr" ? "Pull request" : "Commit"}</Chip>
              {href ? (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-[12px] text-blue underline-offset-2 hover:underline"
                >
                  {ref}
                  <span className="sr-only"> (opens GitHub in a new tab)</span>
                </a>
              ) : (
                <span className="font-mono text-[12px]">{ref}</span>
              )}
              <span className="min-w-0 flex-1 truncate" title={l.title}>
                {l.title}
              </span>
              <Chip
                variant={l.merged ? "success" : l.state === "open" ? "info" : "neutral"}
                data-github-state={state}
              >
                {state}
              </Chip>
              <span className="font-mono text-[10.5px] text-content-secondary">
                {momentText(l.updatedAt)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
