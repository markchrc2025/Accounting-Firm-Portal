import * as React from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type RowData,
  type TableOptions,
} from "@tanstack/react-table";

import { cn } from "@/lib/utils";

/**
 * Per-column presentation hints. Set `numeric` on money/amount columns to
 * right-align + mono the cell (design token: currency is always mono,
 * right-aligned). `align`/`className` allow finer control.
 */
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- TData/TValue required by the augmented interface signature.
  interface ColumnMeta<TData extends RowData, TValue> {
    align?: "left" | "right";
    numeric?: boolean;
    /** Extra classes applied to both header and body cells of this column. */
    className?: string;
  }
}

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  /** Extra classes on the outer table element. */
  className?: string;
  /** Optional TanStack option overrides (sorting/filtering state, etc.). */
  tableOptions?: Partial<TableOptions<TData>>;
  /** Rendered in the tbody when there are no rows. */
  emptyState?: React.ReactNode;
}

/** Resolve the alignment/mono classes for a column from its meta. */
function cellClasses(meta: ColumnDef<unknown>["meta"]): string {
  const numeric = meta?.numeric ?? false;
  const align = meta?.align ?? (numeric ? "right" : "left");
  return cn(
    align === "right" ? "text-right" : "text-left",
    numeric && "font-mono tabular-nums",
    meta?.className,
  );
}

/**
 * DataTable — generic TanStack Table wrapper matching the MCRC list styling:
 * mono uppercase header row on the sidebar cream, hover-tinted body rows with
 * divider lines, right-aligned mono numeric cells.
 */
export function DataTable<TData, TValue>({
  columns,
  data,
  className,
  tableOptions,
  emptyState,
}: DataTableProps<TData, TValue>) {
  const table = useReactTable<TData>({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    ...tableOptions,
  });

  const rows = table.getRowModel().rows;

  return (
    <table className={cn("w-full border-collapse text-left", className)}>
      <thead>
        {table.getHeaderGroups().map((headerGroup) => (
          <tr
            key={headerGroup.id}
            className="border-b border-line bg-sidebar"
          >
            {headerGroup.headers.map((header) => (
              <th
                key={header.id}
                scope="col"
                className={cn(
                  "px-5 py-2.5 font-mono text-[10px] font-normal uppercase tracking-[.14em] text-content-secondary",
                  cellClasses(header.column.columnDef.meta),
                )}
              >
                {header.isPlaceholder
                  ? null
                  : flexRender(
                      header.column.columnDef.header,
                      header.getContext(),
                    )}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody className="divide-y divide-line-divider">
        {rows.length === 0 && emptyState ? (
          <tr>
            <td colSpan={columns.length} className="p-0">
              {emptyState}
            </td>
          </tr>
        ) : (
          rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-rowhover">
              {row.getVisibleCells().map((cell) => (
                <td
                  key={cell.id}
                  className={cn(
                    "px-5 py-[13px] text-[13px] text-content",
                    cellClasses(cell.column.columnDef.meta),
                  )}
                >
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

export type { ColumnDef } from "@tanstack/react-table";
