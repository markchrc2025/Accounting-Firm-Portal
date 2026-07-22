import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createRole,
  deleteRole,
  fetchPermissionCatalog,
  fetchRoles,
  updateRole,
  type FirmRole,
  type PermissionGroup,
} from "../lib/api";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Chip,
  ErrorState,
  Skeleton,
  cn,
} from "./ui";

/** Editable "Roles & permissions" — create custom roles and toggle what each can do. */
export function RolesManager() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ["roles"], queryFn: fetchRoles });
  const catalog = useQuery({ queryKey: ["permission-catalog"], queryFn: fetchPermissionCatalog });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["roles"] });
  const onErr = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : "That role change could not be saved.");

  const create = useMutation({
    mutationFn: () => createRole({ name: newName.trim(), permissions: [] }),
    onSuccess: () => {
      setError(null);
      setNewName("");
      setCreating(false);
      invalidate();
    },
    onError: onErr,
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <div>
          <CardTitle>Roles &amp; permissions</CardTitle>
          <p className="mt-1 text-[12.5px] text-content-secondary">
            Toggle what each role can do, or create your own. Changes apply the next
            time a user acts.
          </p>
        </div>
        {!creating ? (
          <Button size="sm" onClick={() => setCreating(true)}>
            New role
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? (
          <div className="rounded-card border border-danger/30 bg-danger-bg px-4 py-3 text-[12.5px] text-danger-ink">
            {error}
          </div>
        ) : null}

        {creating ? (
          <div className="flex flex-wrap items-end gap-2 rounded-card border border-line bg-sidebar px-4 py-3">
            <label className="flex-1">
              <span className="mb-1 block text-[12px] font-semibold text-content">New role name</span>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="input"
                placeholder="e.g. Bookkeeper"
              />
            </label>
            <Button
              size="sm"
              disabled={!newName.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Creating…" : "Create"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setNewName("");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : null}

        {(roles.isPending || catalog.isPending) && (
          <div className="space-y-3">
            <Skeleton />
            <Skeleton className="w-2/3" />
          </div>
        )}
        {(roles.isError || catalog.isError) && (
          <ErrorState
            message="Could not load roles."
            onRetry={() => {
              void roles.refetch();
              void catalog.refetch();
            }}
          />
        )}
        {roles.data && catalog.data
          ? roles.data.map((role) => (
              <RolePanel
                key={role.id}
                role={role}
                catalog={catalog.data}
                onDone={invalidate}
                onError={onErr}
                clearError={() => setError(null)}
              />
            ))
          : null}
      </CardContent>
    </Card>
  );
}

function RolePanel({
  role,
  catalog,
  onDone,
  onError,
  clearError,
}: {
  role: FirmRole;
  catalog: PermissionGroup[];
  onDone: () => void;
  onError: (e: unknown) => void;
  clearError: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(role.name);
  const [granted, setGranted] = useState<Set<string>>(() => new Set(role.permissions));

  const initial = useMemo(() => new Set(role.permissions), [role.permissions]);
  const permsDirty =
    granted.size !== initial.size || [...granted].some((p) => !initial.has(p));
  const nameDirty = role.canRename && name.trim() !== role.name;
  const dirty = permsDirty || nameDirty;

  const save = useMutation({
    mutationFn: () =>
      updateRole(role.id, {
        ...(nameDirty ? { name: name.trim() } : {}),
        ...(permsDirty ? { permissions: [...granted] } : {}),
      }),
    onSuccess: () => {
      clearError();
      onDone();
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: () => deleteRole(role.id),
    onSuccess: () => {
      clearError();
      onDone();
    },
    onError,
  });

  function toggle(perm: string): void {
    setGranted((prev) => {
      const next = new Set(prev);
      if (next.has(perm)) next.delete(perm);
      else next.add(perm);
      return next;
    });
  }

  return (
    <div className="rounded-card border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2.5">
          <span className="font-serif text-[15px] font-medium text-navy">{role.name}</span>
          <Chip variant={role.isSystem ? "neutral" : "info"}>
            {role.isSystem ? "Built-in" : "Custom"}
          </Chip>
          <span className="text-[12px] text-content-secondary">
            {role.permissions.length} permission{role.permissions.length === 1 ? "" : "s"} ·{" "}
            {role.assignedUserCount} user{role.assignedUserCount === 1 ? "" : "s"}
          </span>
        </span>
        <span className="font-mono text-[11px] text-content-secondary">
          {open ? "▲ Hide" : "▼ Edit"}
        </span>
      </button>

      {open ? (
        <div className="border-t border-line px-4 py-4">
          {role.locked ? (
            <p className="mb-3 rounded-btn border border-warn/40 bg-warn-bg-2 px-3 py-2 text-[12.5px] text-content">
              The Super Admin role always holds every permission and can&apos;t be edited —
              this keeps someone in control of the firm.
            </p>
          ) : null}

          {role.canRename ? (
            <label className="mb-4 block max-w-sm">
              <span className="mb-1 block text-[12px] font-semibold text-content">Role name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className="input" />
            </label>
          ) : null}

          <div className="space-y-3">
            {catalog.map((group) => (
              <div
                key={group.resource}
                className="grid items-center gap-2 md:grid-cols-[180px_1fr]"
              >
                <span className="font-mono text-[11px] uppercase tracking-[.1em] text-content-secondary">
                  {group.resource}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {group.actions.map((action) => {
                    const perm = `${group.resource}:${action}`;
                    const on = role.locked ? true : granted.has(perm);
                    return (
                      <label
                        key={perm}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1.5 rounded-btn border px-2.5 py-1 text-[12px]",
                          on
                            ? "border-navy/30 bg-navy/5 text-navy"
                            : "border-line text-content-secondary",
                          (role.locked || !role.canEditPermissions) &&
                            "cursor-not-allowed opacity-70",
                        )}
                      >
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={on}
                          disabled={role.locked || !role.canEditPermissions}
                          onChange={() => toggle(perm)}
                        />
                        {action}
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {!role.locked ? (
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
              <div>
                {role.canDelete ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:bg-danger-bg"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete the "${role.name}" role? This can't be undone.`,
                        )
                      ) {
                        remove.mutate();
                      }
                    }}
                  >
                    Delete role
                  </Button>
                ) : (
                  <span className="text-[11.5px] text-content-muted">
                    Built-in role — can&apos;t be renamed or deleted.
                  </span>
                )}
              </div>
              <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
