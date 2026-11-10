// SessionLink - the small link on an activity entry made in a Claude work session (PB5): it shows
// the session's title (or the word Session) and opens that session in the project's Sessions tab.

import { Link } from "react-router-dom";
import { sessionPath, sessionTitle } from "../../lib/projects";

export function SessionLink({
  projectKey,
  session,
}: {
  projectKey: string;
  session: { id: string; title: string } | null;
}) {
  if (!session) return null;
  return (
    <Link
      to={sessionPath(projectKey, session.id)}
      data-session-link={session.id}
      className="rounded-chip border border-line px-2 py-0.5 text-[11px] text-content-secondary underline-offset-2 hover:border-navy hover:text-navy hover:underline"
    >
      <span className="sr-only">Claude work session: </span>
      {sessionTitle(session)}
    </Link>
  );
}
