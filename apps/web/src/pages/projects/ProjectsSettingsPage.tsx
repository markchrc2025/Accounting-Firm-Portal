// ProjectsSettingsPage - issue types, statuses and labels (PB1), for those who hold
// Projects:Configure. Names and colours; statuses also carry a category (To do, In progress,
// Done) and which one is the default. When the API refuses (a status or type still in use, the
// default one, a name already taken) its sentence shows exactly as sent.

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate } from "react-router-dom";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorState,
  PageHeader,
  Skeleton,
} from "../../components/ui";
import { useAuth } from "../../auth/AuthContext";
import { GithubWebhookHelp } from "../../components/projects/GithubWebhookHelp";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import {
  ColourChip,
  ErrorBanner,
  Field,
  Modal,
  SuccessBanner,
} from "../../components/projects/parts";
import { useProjectsCan } from "../../components/projects/useProjectsCan";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  createAdmin,
  deleteAdmin,
  errorLines,
  listAdmin,
  updateAdmin,
  type AdminKind,
  type AdminLabel,
  type AdminStatus,
  type AdminType,
  type Category,
} from "../../lib/projects";

const DEFAULT_COLOUR = "#57606a";

interface Row {
  id: string;
  name: string;
  colour: string;
  issueCount: number;
  order?: number;
  category?: Category;
  isDefault?: boolean;
}

export default function ProjectsSettingsPage() {
  const can = useProjectsCan();
  const navigate = useNavigate();
  const superAdmin = useAuth().hasPermission("IntegrationClient:Update");
  if (!can.read) return <Navigate to="/" replace />;
  return (
    <div className="animate-fade-rise">
      <PageHeader
        eyebrow="Project management"
        title="Projects settings"
        description="Issue types, statuses and labels, shared by every project."
        actions={
          <Button variant="ghost" onClick={() => navigate("/projects")}>
            Back
          </Button>
        }
      />
      {!can.configure ? (
        <ErrorBanner
          lines={["Missing permission(s): Projects:Configure"]}
          className="mb-4"
        />
      ) : null}
      <div className="space-y-6">
        <Section
          kind="issue-types"
          title="Issue types"
          noun="issue type"
          canWrite={can.configure}
        />
        <Section
          kind="issue-statuses"
          title="Issue statuses"
          noun="issue status"
          canWrite={can.configure}
          withCategory
        />
        <Section kind="labels" title="Labels" noun="label" canWrite={can.configure} />
        {/* PB4: only a Super Admin sees how to connect GitHub (the role that holds IntegrationClient:Update). */}
        {superAdmin ? <GithubWebhookHelp /> : null}
      </div>
    </div>
  );
}

function Section({
  kind,
  title,
  noun,
  canWrite,
  withCategory,
}: {
  kind: AdminKind;
  title: string;
  noun: string;
  canWrite: boolean;
  withCategory?: boolean;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["projects", "admin", kind],
    queryFn: () => listAdmin<AdminType | AdminStatus | AdminLabel>(kind),
    enabled: canWrite,
  });
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [removing, setRemoving] = useState<Row | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["projects", "admin", kind] });
    void qc.invalidateQueries({ queryKey: ["projects", "meta"] });
  };
  const remove = useMutation({
    mutationFn: (id: string) => deleteAdmin(kind, id),
    onSuccess: () => {
      setRemoving(null);
      setErrors([]);
      setNotice(`The ${noun} was deleted.`);
      refresh();
    },
    onError: (e) => {
      setRemoving(null);
      setNotice(null);
      setErrors(errorLines(e, `Could not delete the ${noun}.`));
    },
  });

  return (
    <Card data-settings-section={kind}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {canWrite ? (
          <Button size="sm" onClick={() => setEditing("new")}>
            Add {noun}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {notice ? <SuccessBanner>{notice}</SuccessBanner> : null}
        <ErrorBanner lines={errors} />
        {!canWrite ? (
          <p className="text-[13px] text-content-secondary">You cannot change these.</p>
        ) : q.isPending ? (
          <Skeleton />
        ) : q.isError ? (
          <ErrorState message={errorLines(q.error)[0]} onRetry={() => void q.refetch()} />
        ) : (
          <ul className="divide-y divide-line">
            {(q.data as Row[]).map((r) => (
              <li
                key={r.id}
                data-setting-row={r.id}
                className="flex flex-wrap items-center gap-3 py-2.5"
              >
                <ColourChip name={r.name} colour={r.colour} />
                {withCategory ? (
                  <span className="text-[12px] text-content-secondary">
                    {r.category ? CATEGORY_LABEL[r.category] : ""}
                    {r.isDefault ? " · Default" : ""}
                  </span>
                ) : null}
                <span className="text-[12px] text-content-secondary">
                  Used by {r.issueCount} issue{r.issueCount === 1 ? "" : "s"}
                </span>
                <span className="ml-auto flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setRemoving(r)}>
                    Delete
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      {editing ? (
        <SettingDialog
          kind={kind}
          noun={noun}
          row={editing === "new" ? null : editing}
          withCategory={!!withCategory}
          withOrder={kind !== "labels"}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            setErrors([]);
            setNotice(created ? `The ${noun} was added.` : `The ${noun} was saved.`);
            refresh();
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          question={`Delete ${removing.name}?`}
          confirmLabel={`Delete ${noun}`}
          cancelLabel="Keep it"
          busy={remove.isPending}
          onConfirm={() => remove.mutate(removing.id)}
          onCancel={() => setRemoving(null)}
        />
      ) : null}
    </Card>
  );
}

function SettingDialog({
  kind,
  noun,
  row,
  withCategory,
  withOrder,
  onClose,
  onSaved,
}: {
  kind: AdminKind;
  noun: string;
  row: Row | null;
  withCategory: boolean;
  withOrder: boolean;
  onClose: () => void;
  onSaved: (created: boolean) => void;
}) {
  const [name, setName] = useState(row?.name ?? "");
  const [colour, setColour] = useState(row?.colour ?? DEFAULT_COLOUR);
  const [order, setOrder] = useState(row?.order !== undefined ? String(row.order) : "");
  const [category, setCategory] = useState<Category>(row?.category ?? "TODO");
  const [isDefault, setIsDefault] = useState(row?.isDefault ?? false);
  const [errors, setErrors] = useState<string[]>([]);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { name, colour };
      if (withOrder && order !== "") body.order = Number(order);
      if (withCategory) {
        body.category = category;
        body.isDefault = isDefault;
      }
      return row ? updateAdmin(kind, row.id, body) : createAdmin(kind, body);
    },
    onSuccess: () => onSaved(!row),
    onError: (e) => setErrors(errorLines(e, `Could not save the ${noun}.`)),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setErrors([]);
    save.mutate();
  }
  return (
    <Modal title={row ? `Edit ${noun}` : `Add ${noun}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <ErrorBanner lines={errors} />
        <Field label="Name">
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Colour">
            <input
              type="color"
              className="h-10 w-full cursor-pointer rounded-input border border-line-input bg-card p-1"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
            />
          </Field>
          {withOrder ? (
            <Field label="Order" hint="Smaller comes first.">
              <input
                type="number"
                className="input"
                value={order}
                onChange={(e) => setOrder(e.target.value)}
              />
            </Field>
          ) : null}
        </div>
        {withCategory ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category">
              <select
                className="input"
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 self-end pb-2 text-[13px]">
              <input
                type="checkbox"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
              />
              The default status for new issues
            </label>
          </div>
        ) : null}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
