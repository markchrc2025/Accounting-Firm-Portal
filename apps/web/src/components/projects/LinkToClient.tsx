// LinkToClient - on a project whose client is a typed name, the listed clients with that same name
// (PB7, PA8 client-matches). The owner picks one; nothing is linked by itself. Linking saves the
// client at once (a PATCH of clientId) and says so.

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "../ui";
import { ErrorBanner, SuccessBanner } from "./parts";
import { errorLines, fetchClientMatches, updateProject } from "../../lib/projects";

export function LinkToClient({
  projectKey,
  onLinked,
}: {
  projectKey: string;
  onLinked?: (client: { id: string; businessName: string }) => void;
}) {
  const qc = useQueryClient();
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["projects", "client-matches", projectKey],
    queryFn: () => fetchClientMatches(projectKey),
    retry: false,
  });
  const link = useMutation({
    mutationFn: (c: { id: string; businessName: string }) =>
      updateProject(projectKey, { clientId: c.id }).then(() => c),
    onSuccess: (c) => {
      setErrors([]);
      setDone(`Linked to ${c.businessName}.`);
      onLinked?.(c);
      void qc.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (e) => setErrors(errorLines(e, "Could not link the client.")),
  });
  if (done) return <SuccessBanner className="mt-2">{done}</SuccessBanner>;
  const matches = q.data && !q.data.linked ? q.data.matches : [];
  if (matches.length === 0 && errors.length === 0) return null;
  return (
    <div data-link-to-client className="mt-2 space-y-2">
      <ErrorBanner lines={errors} />
      {matches.length === 1 ? (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-content-secondary">
            Matches {matches[0]!.businessName} in your client list.
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={link.isPending}
            onClick={() => link.mutate(matches[0]!)}
          >
            Link to client
          </Button>
        </div>
      ) : (
        <div className="space-y-1.5 text-[12.5px]">
          <span className="text-content-secondary">
            These clients in your list have the same name. Pick the right one:
          </span>
          <div className="flex flex-wrap gap-2">
            {matches.map((m) => (
              <Button
                key={m.id}
                size="sm"
                variant="outline"
                disabled={link.isPending}
                onClick={() => link.mutate(m)}
              >
                Link to {m.businessName}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
