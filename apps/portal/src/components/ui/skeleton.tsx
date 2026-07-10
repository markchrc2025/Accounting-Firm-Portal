import * as React from "react";

import { cn } from "@/lib/utils";

/** Skeleton — shimmer placeholder using the `.skeleton` gradient from index.css. */
export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("skeleton h-3.5", className)} {...props} />;
}

export interface TableSkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Number of shimmer rows. */
  rows?: number;
  /** Number of shimmer cells per row. */
  cols?: number;
}

/** TableSkeleton — shimmer rows for a loading list, matched to table row padding. */
export function TableSkeleton({
  rows = 6,
  cols = 1,
  className,
  ...props
}: TableSkeletonProps) {
  return (
    <div className={cn("divide-y divide-line-divider", className)} {...props}>
      {Array.from({ length: rows }).map((_, r) => (
        <div
          key={r}
          className="grid items-center gap-4 px-5 py-4"
          style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={c === cols - 1 ? "w-2/3" : "w-full"} />
          ))}
        </div>
      ))}
    </div>
  );
}
