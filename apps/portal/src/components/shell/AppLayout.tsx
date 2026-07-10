import * as React from "react";
import { Outlet } from "react-router-dom";

import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";

/**
 * The authenticated shell: fixed sidebar + top bar and a scrollable main area
 * (paper background, 30px/36px padding) that renders the routed screen.
 *
 * Two-column screens should use {@link TWO_COLUMN_GRID}: a
 * `minmax(0,1.9fr) minmax(0,1fr)` grid whose children carry `min-width:0` so wide
 * tables/charts can't blow out the layout (the README overflow guard).
 */
export function AppLayout(): React.JSX.Element {
  return (
    <div className="flex h-screen overflow-hidden bg-paper">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 animate-fade-rise overflow-auto bg-paper px-9 py-[30px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Utility class for the standard two-column content grid. Apply to a wrapper:
 * `<div className={TWO_COLUMN_GRID}>…</div>`. Children get `min-width:0` via the
 * `[&>*]` selector so overflowing content scrolls within its column.
 */
export const TWO_COLUMN_GRID =
  "grid gap-6 [grid-template-columns:minmax(0,1.9fr)_minmax(0,1fr)] [&>*]:min-w-0";
