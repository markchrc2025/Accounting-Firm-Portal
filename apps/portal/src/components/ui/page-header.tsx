import * as React from "react";

import { cn } from "@/lib/utils";

export interface PageHeaderProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /** Serif page title (Newsreader, navy). */
  title: React.ReactNode;
  /** Mono uppercase context line above the title (e.g. "PORTFOLIO · FY 2026"). */
  eyebrow?: React.ReactNode;
  /** Optional sub-line under the title (client name, regime note). */
  description?: React.ReactNode;
  /** Right-aligned actions slot (buttons). */
  actions?: React.ReactNode;
}

/** PageHeader — serif title with a mono eyebrow and a right-aligned actions slot. */
export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "mb-6 flex items-end justify-between gap-5",
        className,
      )}
      {...props}
    >
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-1.5">{eyebrow}</div> : null}
        <h1 className="font-serif text-[30px] font-medium text-navy">
          {title}
        </h1>
        {description ? (
          <div className="mt-1.5 text-[13.5px] text-content-secondary">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-none items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
