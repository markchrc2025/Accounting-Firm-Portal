// PB1: the existing role editor offers the four Projects permissions (item 10). The editor draws
// its list from the API's permission catalog, so it follows the API: this renders the real role
// editor with the catalog the API builds from its permission table (Projects: Read, Create,
// Update, Configure) and checks the four are there, as boxes a role can be given. Invented data.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  fetchRoles: vi.fn(),
  fetchPermissionCatalog: vi.fn(),
}));
vi.mock("../lib/api", async (orig) => ({
  ...(await orig<typeof import("../lib/api")>()),
  ...api,
}));

import { RolesManager } from "./RolesManager";

describe("PB1 the role editor and the Projects permissions", () => {
  it("shows Projects with Read, Create, Update and Configure, and a role can hold each", async () => {
    api.fetchPermissionCatalog.mockResolvedValue([
      { resource: "Clients", actions: ["Create", "Read", "Update", "Delete"] },
      { resource: "Projects", actions: ["Read", "Create", "Update", "Configure"] },
    ]);
    api.fetchRoles.mockResolvedValue([
      {
        id: "r1",
        name: "Project Manager",
        isSystem: false,
        locked: false,
        canEditPermissions: true,
        canRename: true,
        canDelete: true,
        assignedUserCount: 2,
        permissions: ["Projects:Read", "Projects:Update"],
      },
    ]);
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <RolesManager />
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /Project Manager/ }));
    const label = await screen.findByText("Projects");
    const row = label.parentElement as HTMLElement;
    const boxes = within(row).getAllByRole("checkbox") as HTMLInputElement[];
    const byName = Object.fromEntries(
      boxes.map((b) => [b.closest("label")!.textContent, b.checked]),
    );
    expect(byName).toEqual({ Read: true, Create: false, Update: true, Configure: false });
    expect(boxes.every((b) => !b.disabled)).toBe(true);
  });
});
