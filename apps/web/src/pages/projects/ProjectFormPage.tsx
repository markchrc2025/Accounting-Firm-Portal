// ProjectFormPage - create and edit a project (PB1, PB7). A project is one of the firm's
// engagements: key, name, description, the client (a listed client, or any typed name), the
// professional fee, the parent project, the category and whether it recurs. The key is typed once,
// on create, and is never editable after; the API makes the final check of everything.

import { useEffect, useMemo, useState, type FormEvent } from "react";
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
import { ClientField } from "../../components/projects/ClientField";
import { FeeField } from "../../components/projects/FeeField";
import { LinkToClient } from "../../components/projects/LinkToClient";
import {
  RecurrenceFields,
  type Schedule,
} from "../../components/projects/RecurrenceFields";
import { useProjectsCan } from "../../components/projects/useProjectsCan";
import { fetchClients, type ClientSummary } from "../../lib/api";
import {
  archiveProject,
  createProject,
  errorLines,
  feeForBox,
  feeToSend,
  fetchProject,
  fetchProjects,
  fetchProjectsMeta,
  PROJECT_KEY_HINT,
  PROJECT_KEY_RE,
  projectPath,
  updateProject,
  type ProjectInput,
} from "../../lib/projects";
import { validateRecurrence } from "../../lib/recurrence";

const NO_SCHEDULE: Schedule = { on: false, start: "", end: "", frequency: "MONTHLY" };

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
  const meta = useQuery({
    queryKey: ["projects", "meta"],
    queryFn: fetchProjectsMeta,
    enabled: can.read,
  });

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [parentKey, setParentKey] = useState("");
  const [clientId, setClientId] = useState<string | null>(null);
  const [clientName, setClientName] = useState("");
  const [fee, setFee] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [schedule, setSchedule] = useState<Schedule>(NO_SCHEDULE);
  const [errors, setErrors] = useState<string[]>([]);

  // Fill the boxes once from the saved project.
  const loaded = current.data?.project;
  const saved: Schedule = useMemo(
    () =>
      loaded?.isRecurring
        ? {
            on: true,
            start: loaded.recurrenceStart ?? "",
            end: loaded.recurrenceEnd ?? "",
            frequency: loaded.recurrenceFrequency ?? "MONTHLY",
          }
        : NO_SCHEDULE,
    [loaded],
  );
  useEffect(() => {
    if (!loaded) return;
    setKey(loaded.key);
    setName(loaded.name);
    setDescription(loaded.description);
    setParentKey(loaded.parent?.key ?? "");
    setClientId(loaded.client?.id ?? null);
    setClientName(loaded.clientName ?? loaded.client?.businessName ?? "");
    setFee(feeForBox(loaded.professionalFee));
    setCategoryId(loaded.category?.id ?? "");
    setSchedule(saved);
  }, [loaded, saved]);

  // The client's own fee, offered (never filled by itself) while the fee box is empty: from the
  // client list for a client picked here, or the API's suggestion for the saved one.
  const clientList: ClientSummary[] = clients.data ?? [];
  const picked = clientId ? clientList.find((c) => c.id === clientId) : undefined;
  const suggestedFee =
    fee.trim() !== "" || !clientId
      ? null
      : feeForBox(picked?.professionalFee) ||
        (loaded && loaded.client?.id === clientId
          ? feeForBox(loaded.suggestedProfessionalFee)
          : "") ||
        null;

  const save = useMutation({
    mutationFn: () => {
      const body: ProjectInput = {
        name,
        description,
        parentKey: parentKey || null,
        clientId,
        clientName: clientName.trim() === "" ? null : clientName.trim(),
        professionalFee: feeToSend(fee),
        categoryId: categoryId || null,
        isRecurring: schedule.on,
        ...(schedule.on
          ? {
              recurrenceStart: schedule.start || null,
              recurrenceEnd: schedule.end || null,
              recurrenceFrequency: schedule.frequency,
            }
          : {}),
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
  const categories = meta.data?.projectCategories ?? [];

  function submit(e: FormEvent) {
    e.preventDefault();
    // The schedule is checked with the same rules as the API (projects-core) before it is sent.
    const problems = validateRecurrence({
      recurring: schedule.on,
      start: schedule.start,
      end: schedule.end,
      frequency: schedule.frequency,
    });
    if (problems.length > 0) {
      setErrors(problems);
      return;
    }
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
              <div className="sm:col-span-2">
                <ClientField
                  clients={clientList}
                  name={clientName}
                  clientId={clientId}
                  onType={(text) => {
                    setClientName(text);
                    setClientId(null); // a typed name is not a listed client until one is picked
                  }}
                  onPick={(c) => {
                    setClientName(c.businessName);
                    setClientId(c.id);
                  }}
                />
                {editing && loaded && !loaded.client && loaded.clientName ? (
                  <LinkToClient
                    projectKey={loaded.key}
                    onLinked={(c) => {
                      setClientId(c.id);
                      setClientName(c.businessName);
                    }}
                  />
                ) : null}
              </div>
              <FeeField value={fee} onChange={setFee} suggested={suggestedFee} />
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
              <Field label="Category">
                <select
                  className="input"
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                >
                  <option value="">No category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </CardContent>
          </Card>
          <RecurrenceFields
            value={schedule}
            onChange={setSchedule}
            savedKey={editing && loaded?.isRecurring ? loaded.key : null}
            saved={saved}
          />
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
