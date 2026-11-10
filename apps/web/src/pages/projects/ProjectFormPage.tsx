// ProjectFormPage - create and edit a project (PB1). The key is typed once, on create, and is
// never editable after; the format shown is a hint, the API decides. A project can be linked to a
// Portal client the caller can see, and the link can be cleared.

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../../components/ui";
import { ErrorBanner, Field } from "../../components/projects/parts";
import { useProjectsCan } from "../../components/projects/useProjectsCan";
import { fetchClients, type ClientSummary } from "../../lib/api";
import {
  archiveProject,
  createProject,
  errorLines,
  fetchProject,
  fetchProjects,
  PROJECT_KEY_HINT,
  PROJECT_KEY_RE,
  projectPath,
  updateProject,
  type ProjectInput,
} from "../../lib/projects";

export default function ProjectFormPage() {
  const { key: editKey } = useParams<{ key: string }>();
  const editing = !!editKey;
  const can = useProjectsCan();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const current = useQuery({
    queryKey: ["projects", "overview", editKey],
    queryFn: () => fetchProject(editKey!),
    enabled: editing && can.read,
  });
  const clients = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
    enabled: can.read,
  });
  const parents = useQuery({
    queryKey: ["projects", "portfolio", true],
    queryFn: () => fetchProjects(true),
    enabled: can.read,
  });

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [deployAppName, setDeployAppName] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [clientId, setClientId] = useState("");
  const [errors, setErrors] = useState<string[]>([]);

  // Fill the boxes once from the saved project.
  const loaded = current.data?.project;
  useEffect(() => {
    if (!loaded) return;
    setKey(loaded.key);
    setName(loaded.name);
    setDescription(loaded.description);
    setRepoUrl(loaded.repoUrl);
    setLiveUrl(loaded.liveUrl);
    setDeployAppName(loaded.deployAppName);
    setParentKey(loaded.parent?.key ?? "");
    setClientId(loaded.client?.id ?? "");
  }, [loaded]);

  const save = useMutation({
    mutationFn: () => {
      const body: ProjectInput = {
        name,
        description,
        repoUrl,
        liveUrl,
        deployAppName,
        parentKey: parentKey || null,
        clientId: clientId || null,
      };
      return editing ? updateProject(editKey!, body) : createProject({ ...body, key });
    },
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(projectPath(p.key), {
        state: { notice: editing ? "Project saved." : `Project ${p.key} created.` },
      });
    },
    onError: (e) => setErrors(errorLines(e, "Could not save the project.")),
  });

  const archive = useMutation({
    mutationFn: (archived: boolean) => archiveProject(editKey!, archived),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ["projects"] });
      navigate(projectPath(p.key), {
        state: {
          notice: p.archived
            ? "Project archived."
            : "Project brought back from the archive.",
        },
      });
    },
    onError: (e) => setErrors(errorLines(e, "Could not change the archive.")),
  });

  if (!can.read) return <Navigate to="/" replace />;
  if (editing && current.isPending) {
    return (
      <div className="space-y-3">
        <Skeleton />
        <Skeleton className="w-2/3" />
      </div>
    );
  }
  if (editing && current.isError) {
    return (
      <>
        <ErrorBanner lines={errorLines(current.error)} className="mb-4" />
        <ErrorState
          message="Could not load this project."
          onRetry={() => void current.refetch()}
        />
      </>
    );
  }

  const canWrite = editing ? can.update : can.create;
  const keyLooksWrong = !editing && key !== "" && !PROJECT_KEY_RE.test(key);

  function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    save.mutate();
  }

  return (
    <div className="animate-fade-rise">
      <PageHeader
        eyebrow="Project management"
        title={editing ? `Edit ${editKey}` : "New project"}
        actions={
          <Button
            variant="ghost"
            onClick={() => navigate(editing ? projectPath(editKey!) : "/projects/all")}
          >
            Back
          </Button>
        }
      />
      <ErrorBanner lines={errors} className="mb-4" />
      <form onSubmit={submit}>
        <fieldset disabled={!canWrite || save.isPending} className="space-y-6">
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {editing ? (
                <div data-key-fixed>
                  <span className="mb-1.5 block text-[13px] font-semibold text-content">
                    Key
                  </span>
                  <p className="font-mono text-[14px] text-navy">{key}</p>
                  <span className="mt-1 block text-[11.5px] text-content-secondary">
                    A project key cannot be changed.
                  </span>
                </div>
              ) : (
                <Field label="Key" hint={PROJECT_KEY_HINT}>
                  <input
                    className="input font-mono uppercase"
                    value={key}
                    maxLength={10}
                    onChange={(e) => setKey(e.target.value.toUpperCase())}
                  />
                  {keyLooksWrong ? (
                    <span data-key-hint className="mt-1 block text-[11.5px] text-warn">
                      This does not look like a key yet. The API makes the final check.
                    </span>
                  ) : null}
                </Field>
              )}
              <Field label="Name" className="sm:col-span-2">
                <input
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
              <Field
                label="Description"
                hint="Markdown is supported."
                className="sm:col-span-3"
              >
                <textarea
                  className="input min-h-[120px]"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Field>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              <Field label="Repository URL">
                <input
                  className="input"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                />
              </Field>
              <Field label="Live URL">
                <input
                  className="input"
                  value={liveUrl}
                  onChange={(e) => setLiveUrl(e.target.value)}
                />
              </Field>
              <Field label="Deployment app name">
                <input
                  className="input"
                  value={deployAppName}
                  onChange={(e) => setDeployAppName(e.target.value)}
                />
              </Field>
              <Field label="Parent project">
                <select
                  className="input"
                  value={parentKey}
                  onChange={(e) => setParentKey(e.target.value)}
                >
                  <option value="">No parent</option>
                  {(parents.data ?? [])
                    .filter((p) => p.key !== editKey)
                    .map((p) => (
                      <option key={p.key} value={p.key}>
                        {p.key} {p.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field
                label="Client"
                hint="Optional. Only people who can see the client can see the project."
              >
                <select
                  className="input"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                >
                  <option value="">No client</option>
                  {(clients.data ?? []).map((c: ClientSummary) => (
                    <option key={c.id} value={c.id}>
                      {c.businessName}
                    </option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>
        </fieldset>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {canWrite ? (
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : editing ? "Save changes" : "Create project"}
            </Button>
          ) : null}
          {editing && can.update && loaded ? (
            <Button
              variant="outline"
              disabled={archive.isPending}
              onClick={() => archive.mutate(!loaded.archived)}
            >
              {loaded.archived ? "Unarchive project" : "Archive project"}
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  );
}
